#!/usr/bin/env bash
# Smoke test of an iOS build on macOS (P10-M1/M8, docs/mobile.md): `plutil` on the built Info.plist (bundle id,
# versions from VERSION/VERSION_CODE, document types, open in place, file sharing); then copies the signed .ipa
# (HAS_IOS_SIGNING=true) or the zipped simulator .app to dist/.
# Usage: VERSION=… VERSION_CODE=… [HAS_IOS_SIGNING=true] scripts/mobile/ios-smoke.sh <calc|write|show>
set -euo pipefail
app=${1:?usage: ios-smoke.sh <calc|write|show>}
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
: "${VERSION:?}" "${VERSION_CODE:?}"
gen=apps/$app/src-tauri/gen/apple
bundle=$(find "$gen/build" "$HOME/Library/Developer/Xcode/DerivedData" -name "*.app" -path "*$app*" -not -path "*/PlugIns/*" 2>/dev/null | head -1 || true)
[ -n "$bundle" ] || bundle=$(find "$gen/build" -name "*.app" | head -1)
echo "app bundle: $bundle"
plist="$bundle/Info.plist"
for key in CFBundleIdentifier CFBundleShortVersionString CFBundleVersion MinimumOSVersion; do
  echo "$key: $(plutil -extract $key raw -o - "$plist")"
done
echo "CFBundleDocumentTypes: $(plutil -extract CFBundleDocumentTypes json -o - "$plist")"
echo "LSSupportsOpeningDocumentsInPlace: $(plutil -extract LSSupportsOpeningDocumentsInPlace raw -o - "$plist")"
[ "$(plutil -extract CFBundleIdentifier raw -o - "$plist")" = "dev.rusuite.$app" ]
[ "$(plutil -extract CFBundleShortVersionString raw -o - "$plist")" = "$VERSION" ]
[ "$(plutil -extract CFBundleVersion raw -o - "$plist")" = "$VERSION_CODE" ]
[ "$(plutil -extract LSSupportsOpeningDocumentsInPlace raw -o - "$plist")" = true ]
[ "$(plutil -extract UIFileSharingEnabled raw -o - "$plist")" = true ]
plutil -extract CFBundleDocumentTypes json -o - "$plist" | grep -q "org.openxmlformats"
mkdir -p dist
if [ "${HAS_IOS_SIGNING:-}" = true ]; then
  cp "$(find "$gen/build" -name '*.ipa' | head -1)" "dist/rusuite-$app-$VERSION-ios.ipa"
else
  ditto -c -k --keepParent "$bundle" "dist/rusuite-$app-$VERSION-ios-simulator.zip"
fi
