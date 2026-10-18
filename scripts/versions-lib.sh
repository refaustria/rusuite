# Helpers shared by scripts/check-versions.sh and scripts/set-version.sh (P8-41); sourced from the repository root.
# shellcheck shell=bash

# The workspace version: the `version = "…"` line inside [workspace.package].
workspace_version() {
  awk '/^\[/{s=($0=="[workspace.package]")} s && /^version *=/{gsub(/.*= *"|".*/,""); print; exit}' Cargo.toml
}

# Workspace member directories (one per line).
workspace_members() {
  awk '/^members *= *\[/{s=1; next} s && /^\]/{exit} s' Cargo.toml | grep -oE '"[^"]+"' | tr -d '"' |
    while read -r pattern; do
      # shellcheck disable=SC2086 # globs in member paths are intended
      for dir in $pattern; do [ -f "$dir/Cargo.toml" ] && echo "$dir"; done
    done
}

# `version` of a member's [package]: "workspace" for `version.workspace = true`, else the literal.
member_version() {
  awk '/^\[/{s=($0=="[package]")} s && /^version\.workspace *= *true/{print "workspace"; exit} s && /^version *=/{gsub(/.*= *"|".*/,""); print; exit}' "$1/Cargo.toml"
}

member_name() {
  awk '/^\[/{s=($0=="[package]")} s && /^name *=/{gsub(/.*= *"|".*/,""); print; exit}' "$1/Cargo.toml"
}

# The version Cargo.lock records for a package name (workspace members appear once, without a source).
lock_version() {
  awk -v n="$1" '$0=="name = \""n"\""{getline; gsub(/.*= *"|".*/,""); print; exit}' Cargo.lock
}

# The MSI version WiX accepts (major.minor.patch.build, numbers only): the trailing number of a pre-release
# (`0.1.0-rc.1` → `0.1.0.1`), nothing for a release (`0.1.0`).
wix_version() {
  case "$1" in
    *-*) local core=${1%%-*} pre=${1#*-}; local n; n=$(grep -oE '[0-9]+$' <<<"$pre" || echo 0); echo "$core.$n" ;;
    *) echo "$1" ;;
  esac
}

# The public name of a version (docs/versioning.md): a trailing `.0` patch dropped (`3.141.0` → `3.141`); hotfixes and
# pre-releases unchanged. Same rule as ui-shared's publicVersion, scripts/gen-downloads.mjs and release.yml.
public_version() {
  local v=${1#v}
  if [[ "$v" =~ ^([0-9]+\.[0-9]+)\.0$ ]]; then echo "${BASH_REMATCH[1]}"; else echo "$v"; fi
}

tauri_confs() { for f in apps/*/src-tauri/tauri.conf.json; do echo "$f"; done; }
# Shipped packages: everything but the e2e test harness.
package_jsons() { for f in apps/*/package.json packages/*/package.json; do [ "$f" = packages/e2e/package.json ] || echo "$f"; done; }
json_version() { node -e 'const j=require(require("path").resolve(process.argv[1])); console.log(process.argv[2].split(".").reduce((o,k)=>o?.[k],j) ?? "")' "$1" "$2"; }

