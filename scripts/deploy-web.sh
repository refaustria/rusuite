#!/usr/bin/env bash
# Build the Calc, Write and Show web targets and publish it to /var/www/resuite (ADR 0005).
# Usage: scripts/deploy-web.sh [--no-build] [--e2e]
#   --e2e  after publishing, run the Playwright smoke suite (packages/e2e) against the live site
#          (base URL from E2E_BASE_URL, default <scheme>://$DEPLOY_HOST).
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
HOST="${DEPLOY_HOST:-resuite.inceptum.at}"
TARGET="${DEPLOY_ROOT:-/var/www/resuite}"

build=1
e2e=0
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --e2e) e2e=1 ;;
    *) echo "usage: $0 [--no-build] [--e2e]" >&2; exit 2 ;;
  esac
done

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
commit="$(git rev-parse --short HEAD)"

apps=(calc write show)

if [ "$build" = 1 ]; then
  pnpm install --frozen-lockfile
  for app in "${apps[@]}"; do pnpm --filter "$app" build:web; done
fi

for app in "${apps[@]}"; do
  [ -f "apps/$app/dist-web/index.html" ] || { echo "missing apps/$app/dist-web/index.html (run without --no-build)" >&2; exit 1; }
done

for app in "${apps[@]}"; do
  mkdir -p "$TARGET/$app"
  rsync -a --delete "apps/$app/dist-web/" "$TARGET/$app/"
done
printf '{"commit":"%s","builtAt":"%s"}\n' "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TARGET/version.json"

scheme=https
if ! curl -fsS -o /dev/null "https://$HOST/calc/" 2>/dev/null; then
  scheme=http
  echo "warning: https not available, falling back to http" >&2
fi

for app in "${apps[@]}"; do
  dist="apps/$app/dist-web"
  curl -fsS -o /dev/null "$scheme://$HOST/$app/"
  echo "ok: $scheme://$HOST/$app/ (commit $commit)"

  wasm="$(cd "$dist" && find assets -name '*.wasm' | sort | head -n1)"
  if [ -n "$wasm" ]; then
    ctype="$(curl -fsSI "$scheme://$HOST/$app/$wasm" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
    case "$ctype" in
      application/wasm*) echo "ok: $app/$wasm served as $ctype" ;;
      *) echo "error: $app/$wasm served as '$ctype'" >&2; exit 1 ;;
    esac
  else
    echo "error: no .wasm in $dist/assets" >&2; exit 1
  fi
done

if [ "$e2e" = 1 ]; then
  base="${E2E_BASE_URL:-$scheme://$HOST}"
  echo "e2e smoke against $base"
  pnpm --filter e2e exec playwright install chromium
  BASE_URL="$base" pnpm e2e
fi
