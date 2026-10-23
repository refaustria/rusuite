#!/usr/bin/env bash
# Version and build number of a mobile build (P10-M1/M8, docs/mobile.md), shared by mobile.yml and
# mobile-release.yml: VERSION = tauri.conf.json `version` (Android versionName, iOS CFBundleShortVersionString),
# VERSION_CODE = major·1 000 000 + minor·1 000 + patch (Android versionCode, iOS CFBundleVersion).
# Usage: scripts/mobile/version-code.sh <calc|write|show>   (appends both to $GITHUB_ENV when set)
set -euo pipefail
app=${1:?usage: version-code.sh <calc|write|show>}
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
v=$(node -p "require('./apps/$app/src-tauri/tauri.conf.json').version")
code=$(node -e 'const [a,b,c]=process.argv[1].split("-")[0].split(".").map(Number); console.log(a*1e6+b*1e3+c)' "$v")
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "VERSION=$v" >>"$GITHUB_ENV"
  echo "VERSION_CODE=$code" >>"$GITHUB_ENV"
fi
echo "$v → versionCode / CFBundleVersion $code"
