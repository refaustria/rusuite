#!/usr/bin/env bash
# Upload a signed .ipa to App Store Connect / TestFlight (P10-M8, docs/store/README.md) with altool and an App Store
# Connect API key: APPLE_API_KEY (key id), APPLE_API_ISSUER (issuer id), APPLE_API_KEY_CONTENT (the .p8 text, written
# to $RUNNER_TEMP/private_keys/AuthKey_<id>.p8 for the upload and deleted afterwards). Never prints the key.
# Usage: scripts/mobile/testflight-upload.sh <file.ipa>
set -euo pipefail
ipa=${1:?usage: testflight-upload.sh <file.ipa>}
# shellcheck source=scripts/signing/lib.sh
source "$(dirname "$0")/../signing/lib.sh"
need APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_CONTENT
keys="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/private_keys"
mkdir -p "$keys"
trap 'rm -f "$keys/AuthKey_$APPLE_API_KEY.p8"' EXIT
(umask 077 && printf '%s\n' "$APPLE_API_KEY_CONTENT" >"$keys/AuthKey_$APPLE_API_KEY.p8")
# altool looks for AuthKey_<id>.p8 in API_PRIVATE_KEYS_DIR (and ./private_keys, ~/.private_keys, …).
API_PRIVATE_KEYS_DIR="$keys" xcrun altool --upload-app --type ios --file "$ipa" --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
