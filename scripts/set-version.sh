#!/usr/bin/env bash
# Sets the release version everywhere (P8-41): the Cargo workspace version (and any member with its own literal
# version), Cargo.lock, the three tauri.conf.json files (`version` + the MSI-safe `bundle.windows.wix.version`) and the
# shipped package.json files; then runs scripts/check-versions.sh. Only the version lines change (no reformatting).
# Usage: scripts/set-version.sh <version>     e.g. scripts/set-version.sh 0.1.0-rc.1
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
# shellcheck source=scripts/versions-lib.sh
source scripts/versions-lib.sh

version=${1:-}
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "usage: $0 <major.minor.patch[-pre]>  (got '${version}')" >&2
  exit 2
fi
wix=$(wix_version "$version")

# Cargo: the [workspace.package] version line, then members with a literal version in [package].
replace_toml_version() { # file section
  awk -v sec="$2" -v v="$version" '/^\[/{s=($0==sec)} s && /^version *=/ && !done {sub(/"[^"]*"/, "\"" v "\""); done=1} {print}' "$1" >"$1.tmp"
  mv "$1.tmp" "$1"
}
replace_toml_version Cargo.toml "[workspace.package]"
while read -r dir; do
  [ "$(member_version "$dir")" = workspace ] || replace_toml_version "$dir/Cargo.toml" "[package]"
done < <(workspace_members)
cargo update --workspace --offline --quiet

# JSON: only the top-level "version" line (the first one) and the wix line; the rest of each file is untouched.
mapfile -t files < <(tauri_confs; package_jsons)
node - "$version" "$wix" "${files[@]}" <<'JS'
const fs = require("fs");
const [version, wix, ...files] = process.argv.slice(2);
for (const file of files) {
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
  if (file.endsWith("tauri.conf.json")) {
    const line = `"windows": { "wix": { "version": "${wix}" } },`;
    if (/"windows":\s*\{\s*"wix":\s*\{\s*"version":\s*"[^"]*"\s*\}\s*\},/.test(text)) {
      text = text.replace(/"windows":\s*\{\s*"wix":\s*\{\s*"version":\s*"[^"]*"\s*\}\s*\},/, line);
    } else {
      // MSI needs a numeric version (WiX); Tauri derives it from `version` unless this is set.
      text = text.replace(/^(\s*)"bundle":\s*\{\n/m, (all, indent) => `${all}${indent}  ${line}\n`);
    }
  }
  JSON.parse(text);
  fs.writeFileSync(file, text);
}
JS

scripts/check-versions.sh "$version"
