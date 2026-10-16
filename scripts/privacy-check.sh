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
# 2026-10-16) – nothing runs until the user adds a connection; the opt-in AI assistant's transport talks only to the
# provider the user configured, only when an AI action runs or Settings › AI › Test is pressed (P8-37); the
# "Report a problem" client posts to the site's own relay (/api/report) only when the user submits the dialog (P8-43).
ALLOW='^(apps/portal/version\.js|apps/portal/i18n\.js|packages/ui-shared/src/connectors/webdav-fetch\.ts|packages/ui-shared/src/ai/providers/http\.ts|packages/ui-shared/src/report/client\.ts):'

fail=0
hits="$(git grep --untracked -nE "$PATTERN" -- 'apps/*/src/*' 'apps/*/index.html' 'apps/portal/*' 'packages/*/src/*' \
  ':!*.test.ts' ':!*.test.tsx' ':!*/generated/*' | grep -vE "$ALLOW" || true)"
if [ -n "$hits" ]; then
  echo "privacy-check: network API outside the allow-list (ADR 0009):" >&2
  echo "$hits" >&2
  fail=1
fi

# The AI transport is reachable only from the provider adapters (they run only from `Assistant.run`/`test`).
ai_hits="$(git grep --untracked -nE '\baiFetch\b|providers/http' -- 'apps/*/src/*' 'packages/*/src/*' \
  ':!*.test.ts' ':!*.test.tsx' ':!packages/ui-shared/src/ai/providers/*.ts' || true)"
if [ -n "$ai_hits" ]; then
  echo "privacy-check: the AI transport used outside packages/ui-shared/src/ai/providers (P8-37):" >&2
  echo "$ai_hits" >&2
  fail=1
fi
if git grep -nE 'export \{[^}]*\baiFetch\b' -- 'packages/ui-shared/src/ai/providers/index.ts' >/dev/null; then
  echo "privacy-check: aiFetch must not be exported from the providers module" >&2
  fail=1
fi

# The report transport is reachable only from the report controller (it runs only when the user submits, P8-43).
report_hits="$(git grep --untracked -nE '\bsendReport\b|report/client' -- 'apps/*/src/*' 'packages/*/src/*' \
  ':!*.test.ts' ':!*.test.tsx' ':!packages/ui-shared/src/report/client.ts' ':!packages/ui-shared/src/report/controller.ts' \
  || true)"
if [ -n "$report_hits" ]; then
  echo "privacy-check: the report transport used outside the report controller (P8-43):" >&2
  echo "$report_hits" >&2
  fail=1
fi
if git grep -nE 'export \{[^}]*\bsendReport\b' -- 'packages/ui-shared/src/report/index.ts' >/dev/null; then
  echo "privacy-check: sendReport must not be exported from the report module" >&2
  fail=1
fi

http_hits="$(git grep -nEi '^\s*(reqwest|hyper|ureq|tauri-plugin-http|isahc|surf|attohttpc)\b|tauri-plugin-http' -- 'apps/*/src-tauri/Cargo.toml' || true)"
if [ -n "$http_hits" ]; then
  echo "privacy-check: HTTP client in a desktop shell (ADR 0009):" >&2
  echo "$http_hits" >&2
  fail=1
fi

# The desktop WebDAV client lives in app-common behind the opt-in `webdav` feature only (P8-36). The report relay
# (services/report-relay, P8-43) is a server program, not part of any app: it talks to GitHub only.
dep_hits="$(git grep -nE '^\s*(reqwest|hyper|ureq|isahc|surf|attohttpc)\b' -- '*/Cargo.toml' ':!crates/app-common/Cargo.toml' ':!services/report-relay/Cargo.toml' || true)"
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
