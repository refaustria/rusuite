#!/usr/bin/env bash
# Checks that every version string of the release is the same (P8-41): the Cargo workspace version
# ([workspace.package]), each workspace member (`version.workspace = true` or the same literal, and its Cargo.lock
# entry), the three tauri.conf.json files (`version` and the MSI-safe `bundle.windows.wix.version` derived from it)
# and the shipped package.json files (apps/*, packages/* except the e2e test harness).
# Usage: scripts/check-versions.sh [expected-version]   (e.g. `${GITHUB_REF_NAME#v}` in the release workflow)
# Members are read from the root Cargo.toml (globs expanded), so new crates are covered without changes here.
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# shellcheck source=scripts/versions-lib.sh
source scripts/versions-lib.sh

expected=${1:-$(workspace_version)}
[ -n "$expected" ] || { echo "check-versions: no [workspace.package] version in Cargo.toml" >&2; exit 2; }
fail=0
mismatch() { echo "check-versions: $1 is '$2', expected '$3'" >&2; fail=1; }

ws=$(workspace_version)
[ "$ws" = "$expected" ] || mismatch "Cargo.toml [workspace.package] version" "$ws" "$expected"
count=0
while read -r dir; do
  count=$((count + 1))
  v=$(member_version "$dir")
  [ "$v" = workspace ] || [ "$v" = "$expected" ] || mismatch "$dir/Cargo.toml version" "$v" "$expected (or version.workspace = true)"
  name=$(member_name "$dir")
  lv=$(lock_version "$name")
  [ "$lv" = "$expected" ] || mismatch "Cargo.lock entry of $name" "$lv" "$expected (run cargo update --workspace)"
done < <(workspace_members)
mapfile -t confs < <(tauri_confs)
mapfile -t pkgs < <(package_jsons)
for conf in "${confs[@]}"; do
  v=$(json_version "$conf" version)
  [ "$v" = "$expected" ] || mismatch "$conf version" "$v" "$expected"
  w=$(json_version "$conf" bundle.windows.wix.version)
  [ "$w" = "$(wix_version "$expected")" ] || mismatch "$conf bundle.windows.wix.version" "$w" "$(wix_version "$expected")"
done
for pkg in "${pkgs[@]}"; do
  v=$(json_version "$pkg" version)
  [ "$v" = "$expected" ] || mismatch "$pkg version" "$v" "$expected"
done

# Android versionCode / iOS build number must stay monotonic (P10-R1): greater than the code of every earlier release,
# read from the docs/release-notes/<public-name>.md files (the notes of the version being checked are skipped).
if ! [[ "$expected" == *-* ]]; then
  code=$(version_code "$expected")
  for notes in docs/release-notes/*.md; do
    prev=$(basename "$notes" .md)
    [ "$prev" = "$(public_version "$expected")" ] && continue
    [[ "$prev" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || continue
    [[ "$prev" =~ ^[0-9]+\.[0-9]+$ ]] && prev="$prev.0"
    prev_code=$(version_code "$prev")
    [ "$code" -gt "$prev_code" ] || mismatch "mobile version code of $expected" "$code" "> $prev_code (release $prev)"
  done
fi

if [ "$fail" = 0 ]; then echo "check-versions: $expected everywhere ($count crates, ${#confs[@]} tauri.conf.json, ${#pkgs[@]} package.json)"; fi
exit "$fail"
