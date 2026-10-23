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

# The MSI version WiX accepts (major.minor.build[.rev], numbers only; MINOR ≤ 255, BUILD ≤ 65535):
#  - a pre-release maps to the trailing number of the pre-release (`0.1.0-rc.1` → `0.1.0.1`), a release stays as is;
#  - π versions (docs/versioning.md): MINOR > 255 is split after its first two digits, MINOR' = `14`, BUILD = the rest,
#    REV = PATCH: `3.1415.0` → `3.14.15.0`, `3.14159.0` → `3.14.159.0`, `3.141592.0` → `3.14.1592.0`; `3.141.0` stays.
wix_version() {
  local core=${1%%-*} pre="" n=0
  [[ "$1" == *-* ]] && pre=${1#*-}
  if [ -n "$pre" ]; then n=$(grep -oE '[0-9]+$' <<<"$pre" || echo 0); fi
  if [[ "$core" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] && [ "${BASH_REMATCH[2]}" -gt 255 ]; then
    local major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
    echo "$major.${minor:0:2}.${minor:2}.$patch"
  elif [ -n "$pre" ]; then
    echo "$core.$n"
  else
    echo "$1"
  fi
}

# Android versionCode / iOS CFBundleVersion (Tauri formula, scripts/mobile/version-code.sh): major·1 000 000 + minor·1 000 + patch.
version_code() {
  node -e 'const [a,b,c]=process.argv[1].split("-")[0].split(".").map(Number); console.log(a*1e6+b*1e3+c)' "$1"
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

