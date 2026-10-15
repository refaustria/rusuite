#!/usr/bin/env bash
# Real-window smoke test of the desktop shells (P7-7): runs the release
# binaries under xvfb, driven through tauri-driver + WebKitWebDriver
# (scripts/desktop-smoke.mjs; setup in docs/setup.md, details in
# docs/testing.md).
#
#   pnpm --filter calc tauri build --no-bundle   # and write, show
#   scripts/desktop-smoke.sh [calc|write|show ...]
#
# SMOKE_BIN_DIR (default target/release) and SMOKE_PORT (default 4444)
# override the binaries and the driver port.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export SMOKE_BIN_DIR=${SMOKE_BIN_DIR:-$ROOT/target/release}
export SMOKE_PORT=${SMOKE_PORT:-4444}

for tool in tauri-driver WebKitWebDriver xvfb-run node; do
  command -v "$tool" >/dev/null || { echo "missing $tool (see docs/setup.md)" >&2; exit 2; }
done
apps=("$@")
[ ${#apps[@]} -gt 0 ] || apps=(calc write show)
for app in "${apps[@]}"; do
  [ -x "$SMOKE_BIN_DIR/app-$app" ] || { echo "missing $SMOKE_BIN_DIR/app-$app: pnpm --filter $app tauri build --no-bundle" >&2; exit 2; }
done

# Private data/config/cache dirs: the apps' recent lists and recovery
# entries, and WebKit's caches, never touch the user's.
SMOKE_WORK=$(mktemp -d)
export SMOKE_WORK
trap 'rm -rf "$SMOKE_WORK"' EXIT
export XDG_DATA_HOME=$SMOKE_WORK/data XDG_CONFIG_HOME=$SMOKE_WORK/config XDG_CACHE_HOME=$SMOKE_WORK/cache
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

# A private D-Bus session: without one each WebKit start waits ~30 s for
# the accessibility bus.
dbus=()
command -v dbus-run-session >/dev/null && dbus=(dbus-run-session --)

# shellcheck disable=SC2016 # expanded by the inner shell
xvfb-run -a --server-args="-screen 0 1440x900x24" "${dbus[@]}" bash -c '
  tauri-driver --port "$SMOKE_PORT" >"$SMOKE_WORK/driver.log" 2>&1 &
  driver=$!
  trap "kill $driver 2>/dev/null || true" EXIT
  node "$0" "$@"
' "$ROOT/scripts/desktop-smoke.mjs" "${apps[@]}" || {
  status=$?
  echo "--- tauri-driver log (tail)" >&2
  tail -n 30 "$SMOKE_WORK/driver.log" >&2 || true
  exit "$status"
}
