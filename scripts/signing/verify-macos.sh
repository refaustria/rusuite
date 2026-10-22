#!/usr/bin/env bash
# release.yml, macOS runners, after tauri-action when signing is on (P10-S1): checks the bundled .app really carries a
# Developer ID signature with hardened runtime (and, when notarization was requested, a stapled ticket that Gatekeeper
# accepts) and writes the leg's signing record for the `signing-manifest` job.
# Usage: verify-macos.sh <bundle/macos dir> <record.json> <notarize: true|false>
set -euo pipefail
dir="$1" record="$2" notarize="$3"
shopt -s nullglob
apps=("$dir"/*.app)
[ "${#apps[@]}" -gt 0 ] || { echo "verify-macos: no .app in $dir" >&2; exit 1; }
notarized=false
for app in "${apps[@]}"; do
  codesign --verify --deep --strict --verbose=2 "$app"
  info="$(codesign --display --verbose=4 "$app" 2>&1)"
  grep -q '^Authority=Developer ID Application:' <<<"$info" || { echo "verify-macos: $app is not signed with a Developer ID Application certificate" >&2; exit 1; }
  grep -Eq 'flags=.*runtime' <<<"$info" || { echo "verify-macos: $app lacks the hardened runtime" >&2; exit 1; }
  if [ "$notarize" = true ]; then
    xcrun stapler validate "$app"
    spctl --assess --type execute --verbose=4 "$app"
    notarized=true
  fi
done
mkdir -p "$(dirname "$record")"
printf '{"os":"macos","signed":true,"notarized":%s}\n' "$notarized" >"$record"
echo "verify-macos: ${#apps[@]} app(s) signed, notarized $notarized"
