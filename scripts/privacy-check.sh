#!/usr/bin/env bash
# ADR 0009 guard: documents never leave the device. Fails when app sources contain a network API
# outside the allow-list, or a desktop shell depends on an HTTP client.
# Usage: scripts/privacy-check.sh
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# Network APIs. `navigator.share` is included: sharing is an owner decision (new ADR) – add it to the allow-list then.
PATTERN='fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|navigator\.share'
# Allowed: the portal reads /version.json (version.js) and its own translation catalogs (i18n.js); the opt-in
# cloud connectors' browser WebDAV transport talks only to servers the user configured (P8-36, ADR 0009 amendment
# 2026-10-16) – nothing runs until the user adds a connection.
ALLOW='^(apps/portal/version\.js|apps/portal/i18n\.js|packages/ui-shared/src/connectors/webdav-fetch\.ts):'

fail=0
hits="$(git grep --untracked -nE "$PATTERN" -- 'apps/*/src/*' 'apps/*/index.html' 'apps/portal/*' 'packages/*/src/*' \
  ':!*.test.ts' ':!*.test.tsx' ':!*/generated/*' | grep -vE "$ALLOW" || true)"
if [ -n "$hits" ]; then
  echo "privacy-check: network API outside the allow-list (ADR 0009):" >&2
  echo "$hits" >&2
  fail=1
fi

http_hits="$(git grep -nEi '^\s*(reqwest|hyper|ureq|tauri-plugin-http|isahc|surf|attohttpc)\b|tauri-plugin-http' -- 'apps/*/src-tauri/Cargo.toml' || true)"
if [ -n "$http_hits" ]; then
  echo "privacy-check: HTTP client in a desktop shell (ADR 0009):" >&2
  echo "$http_hits" >&2
  fail=1
fi

# The desktop WebDAV client lives in app-common behind the opt-in `webdav` feature only (P8-36).
dep_hits="$(git grep -nE '^\s*(reqwest|hyper|ureq|isahc|surf|attohttpc)\b' -- '*/Cargo.toml' ':!crates/app-common/Cargo.toml' || true)"
if [ -n "$dep_hits" ]; then
  echo "privacy-check: HTTP client outside app-common's webdav feature (ADR 0009):" >&2
  echo "$dep_hits" >&2
  fail=1
fi
if git grep -nE '^\s*default\s*=.*webdav' -- crates/app-common/Cargo.toml >/dev/null; then
  echo "privacy-check: app-common's webdav feature must stay opt-in" >&2
  fail=1
fi

if [ "$fail" = 0 ]; then echo "privacy-check: ok"; fi
exit "$fail"
