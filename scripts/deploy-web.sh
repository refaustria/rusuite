#!/usr/bin/env bash
# Build the Calc, Write and Show web targets and publish them, plus the portal (apps/portal) at the root,
# to /var/www/resuite (ADR 0005). The portal's downloads.html is generated from the GitHub release
# (scripts/gen-downloads.sh).
# Usage: scripts/deploy-web.sh [--no-build] [--e2e]
#   --e2e  after publishing, run the Playwright smoke suite (packages/e2e) against the live site
#          (base URL from E2E_BASE_URL, default <scheme>://$DEPLOY_HOST).
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
HOST="${DEPLOY_HOST:-rusuit.es}"
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
# Portal: static files, no build step. No --delete at the root (it holds the app folders).
[ -f apps/portal/index.html ] || { echo "missing apps/portal/index.html" >&2; exit 1; }
mkdir -p "$TARGET/logos" "$TARGET/locales"
rsync -a apps/portal/index.html apps/portal/privacy.html apps/portal/styles.css apps/portal/i18n.js apps/portal/version.js apps/portal/downloads.js "$TARGET/"
# Downloads page: generated from the GitHub release now (gh), so the page itself fetches nothing (P8-41, ADR 0009).
# DOWNLOADS_TAG picks the release (default: the newest published one); without gh it is the "no release yet" page.
scripts/gen-downloads.sh --out "$TARGET/downloads.html"
rsync -a --delete apps/portal/logos/ "$TARGET/logos/"
rsync -a --delete apps/portal/locales/ "$TARGET/locales/"
printf '{"commit":"%s","builtAt":"%s"}\n' "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TARGET/version.json"

scheme=https
if ! curl -fsS -o /dev/null "https://$HOST/calc/" 2>/dev/null; then
  scheme=http
  echo "warning: https not available, falling back to http" >&2
fi

root="$(curl -fsS -o /dev/null -w '%{http_code} %{content_type}' "$scheme://$HOST/")"
case "$root" in
  "200 text/html"*) echo "ok: $scheme://$HOST/ portal ($root)" ;;
  *) echo "error: $scheme://$HOST/ answered '$root' (expected 200 text/html)" >&2; exit 1 ;;
esac

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
