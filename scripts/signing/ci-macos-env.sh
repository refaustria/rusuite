#!/usr/bin/env bash
# release.yml, macOS runners, only when the APPLE_CERTIFICATE secret exists (P10-S1, docs/signing.md): hands the
# Developer ID certificate and – when APPLE_API_KEY_CONTENT exists too – the App Store Connect API key for notarization
# to the following tauri-action step through $GITHUB_ENV (Tauri reads APPLE_* from the environment, signs with
# hardened runtime and notarizes + staples). Without the API key the app is signed but not notarized.
#
# Input (step env): APPLE_CERTIFICATE (base64 .p12), APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY,
#   APPLE_TEAM_ID; optional APPLE_API_ISSUER, APPLE_API_KEY (key id), APPLE_API_KEY_CONTENT (.p8 text).
# Output: $GITHUB_ENV entries; the .p8 at $RUNNER_TEMP/AuthKey.p8 (mode 600); `notarize=true|false` on $GITHUB_OUTPUT.
set -euo pipefail
# shellcheck source=scripts/signing/lib.sh
source "$(dirname "$0")/lib.sh"

need APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_TEAM_ID
# Tauri base64-decodes the certificate itself; line breaks (e.g. from `base64` without -w0) would break that.
put APPLE_CERTIFICATE "$(printf '%s' "$APPLE_CERTIFICATE" | tr -d ' \r\n')"
put APPLE_CERTIFICATE_PASSWORD "$APPLE_CERTIFICATE_PASSWORD"
put APPLE_SIGNING_IDENTITY "$APPLE_SIGNING_IDENTITY"
put APPLE_TEAM_ID "$APPLE_TEAM_ID"

notarize=false
if [ -n "${APPLE_API_KEY_CONTENT:-}" ]; then
  need APPLE_API_ISSUER APPLE_API_KEY
  key="${RUNNER_TEMP:?}/AuthKey.p8"
  (umask 077 && printf '%s\n' "$APPLE_API_KEY_CONTENT" >"$key")
  put APPLE_API_ISSUER "$APPLE_API_ISSUER"
  put APPLE_API_KEY "$APPLE_API_KEY"
  put APPLE_API_KEY_PATH "$key"
  notarize=true
fi
echo "notarize=$notarize" >>"${GITHUB_OUTPUT:-/dev/null}"
echo "signing: macOS Developer ID signing on, notarization $notarize"
