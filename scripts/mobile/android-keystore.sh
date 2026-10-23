#!/usr/bin/env bash
# Release keystore of an Android build (P10-M1/M8, docs/mobile.md): `write` decodes KEYSTORE_BASE64 to
# $RUNNER_TEMP/release.jks and writes the git-ignored keystore.properties next to the app's Gradle project from
# KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD; `remove` deletes both. Never prints a value.
# Usage: scripts/mobile/android-keystore.sh write|remove <calc|write|show>
set -euo pipefail
cmd=${1:?usage: android-keystore.sh write|remove <app>}
app=${2:?usage: android-keystore.sh write|remove <app>}
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
jks="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release.jks"
props="apps/$app/src-tauri/gen/android/keystore.properties"
case "$cmd" in
  write)
    # shellcheck source=scripts/signing/lib.sh
    source scripts/signing/lib.sh
    need KEYSTORE_BASE64 KEYSTORE_PASSWORD KEY_ALIAS KEY_PASSWORD
    umask 077
    printf '%s' "$KEYSTORE_BASE64" | base64 --decode >"$jks"
    {
      echo "storeFile=$jks"
      echo "storePassword=$KEYSTORE_PASSWORD"
      echo "keyAlias=$KEY_ALIAS"
      echo "keyPassword=$KEY_PASSWORD"
    } >"$props"
    echo "keystore.properties written for $app"
    ;;
  remove) rm -f "$jks" "$props" ;;
  *) echo "android-keystore.sh: unknown command $cmd" >&2; exit 2 ;;
esac
