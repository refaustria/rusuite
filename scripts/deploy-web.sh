#!/usr/bin/env bash
# Build the Calc and Write web targets and publish it to /var/www/resuite (ADR 0005).
# Usage: scripts/deploy-web.sh [--no-build]
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
HOST="${DEPLOY_HOST:-resuite.inceptum.at}"
TARGET="${DEPLOY_ROOT:-/var/www/resuite}"

build=1
case "${1:-}" in
  "") ;;
  --no-build) build=0 ;;
  *) echo "usage: $0 [--no-build]" >&2; exit 2 ;;
esac

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
commit="$(git rev-parse --short HEAD)"

apps=(calc write)

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
