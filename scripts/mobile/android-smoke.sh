#!/usr/bin/env bash
# Smoke test of an Android build (P10-M1/M8, docs/mobile.md): `aapt dump badging` (package, versionCode/Name from
# VERSION/VERSION_CODE, minSdk 26, targetSdk 36, ABIs), the VIEW/EDIT intent filters with the app's MIME type and
# `apksigner` (not the debug key when HAS_KEYSTORE=true); then copies the APK and the AAB to dist/ as
# rusuite-<app>-<version>-android.{apk,aab}.
# Usage: VERSION=… VERSION_CODE=… [HAS_KEYSTORE=true] scripts/mobile/android-smoke.sh <calc|write|show>
set -euo pipefail
app=${1:?usage: android-smoke.sh <calc|write|show>}
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
: "${ANDROID_HOME:?}" "${VERSION:?}" "${VERSION_CODE:?}"
bt="$ANDROID_HOME/build-tools/36.0.0"
out=apps/$app/src-tauri/gen/android/app/build/outputs
apk=$(find "$out/apk/universal/release" -name '*.apk' | sort | head -1)
aab=$(find "$out/bundle/universalRelease" -name '*.aab' | sort | head -1)
if [ -z "$apk" ] || [ -z "$aab" ]; then echo "android-smoke.sh: no APK/AAB under $out" >&2; exit 1; fi
ls -la "$apk" "$aab"
badging=$("$bt/aapt" dump badging "$apk")
echo "$badging" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label|uses-permission|native-code):"
echo "$badging" | grep -q "^package: name='dev.rusuite.$app' versionCode='$VERSION_CODE' versionName='$VERSION'"
echo "$badging" | grep -q "^sdkVersion:'26'"
echo "$badging" | grep -q "^targetSdkVersion:'36'"
echo "$badging" | grep -q "native-code: 'arm64-v8a' 'x86_64'"
# No new permission (P10-M6: printing and PDF export need none): exactly INTERNET plus androidx's own receiver
# permission.
perms=$(echo "$badging" | sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" | sort | tr '\n' ' ')
expected="android.permission.INTERNET dev.rusuite.$app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION "
if [ "$perms" != "$expected" ]; then echo "::error::$app: unexpected permissions: $perms (expected: $expected)"; exit 1; fi
tree=$("$bt/aapt" dump xmltree "$apk" AndroidManifest.xml)
echo "$tree" | grep -E 'android.intent.action.(VIEW|EDIT)|mimeType|pathPattern' | sed 's/ (Raw.*//'
echo "$tree" | grep -q 'android.intent.action.VIEW'
echo "$tree" | grep -q 'android.intent.action.EDIT'
case $app in
  calc) mime=spreadsheetml.sheet ;;
  write) mime=wordprocessingml.document ;;
  show) mime=presentationml.presentation ;;
  *) echo "android-smoke.sh: unknown app $app" >&2; exit 2 ;;
esac
echo "$tree" | grep -q "mimeType(0x01010026)=\"application/vnd.openxmlformats-officedocument.$mime\""
"$bt/apksigner" verify --print-certs "$apk" | grep -E "certificate DN"
# (mobile.yml's inline `! … | grep -q` never failed: a negated pipeline does not trigger errexit.)
if [ "${HAS_KEYSTORE:-}" = true ] && "$bt/apksigner" verify --print-certs "$apk" | grep -q "CN=Android Debug"; then
  echo "::error::$app: the release build is signed with the debug key although the keystore secrets are set"
  exit 1
fi
mkdir -p dist
cp "$apk" "dist/rusuite-$app-$VERSION-android.apk"
cp "$aab" "dist/rusuite-$app-$VERSION-android.aab"
