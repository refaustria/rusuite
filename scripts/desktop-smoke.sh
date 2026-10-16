#!/usr/bin/env bash
# Smoke test of the desktop shells' release binaries (P7-7, P8-41).
#
#   pnpm --filter calc tauri build --no-bundle   # and write, show
#   scripts/desktop-smoke.sh [--start-only] [calc|write|show ...]
#
# 1. Start check (every platform, no WebDriver): `app-<name> --smoke` opens
#    the window, the page makes a ping + dispatch IPC round trip, the binary
#    checks the window title and version, prints `ok …` and exits 0
#    (apps/*/src-tauri/src/smoke.rs). On Linux it runs under xvfb when there
#    is no display. `--start-only` stops here – that is what the release
#    workflow runs on Linux, Windows and macOS (job `smoke`).
# 2. Linux only: real-window tests driven through tauri-driver +
#    WebKitWebDriver (scripts/desktop-smoke.mjs; setup in docs/setup.md,
#    details in docs/testing.md): close guard, and Open → edit → Save →
#    reopen of a testdata file.
#
# SMOKE_BIN_DIR (default target/release) and SMOKE_PORT (default 4444)
# override the binaries and the driver port.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export SMOKE_BIN_DIR=${SMOKE_BIN_DIR:-$ROOT/target/release}
export SMOKE_PORT=${SMOKE_PORT:-4444}

start_only=0
apps=()
for arg in "$@"; do
  case "$arg" in
    --start-only) start_only=1 ;;
    calc | write | show) apps+=("$arg") ;;
    *) echo "usage: $0 [--start-only] [calc|write|show ...]" >&2; exit 2 ;;
  esac
done
[ ${#apps[@]} -gt 0 ] || apps=(calc write show)

exe=""
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) exe=.exe ;;
esac
linux=0
[ "$(uname -s)" = Linux ] && linux=1

need=(node)
[ "$linux" = 1 ] && [ -z "${DISPLAY:-}" ] && need+=(xvfb-run)
[ "$start_only" = 0 ] && need+=(tauri-driver WebKitWebDriver xvfb-run)
for tool in "${need[@]}"; do
  command -v "$tool" >/dev/null || { echo "missing $tool (see docs/setup.md)" >&2; exit 2; }
done
if [ "$start_only" = 0 ] && [ "$linux" = 0 ]; then
  echo "the WebDriver tests run on Linux only; use --start-only here" >&2
  exit 2
fi
for app in "${apps[@]}"; do
  [ -x "$SMOKE_BIN_DIR/app-$app$exe" ] || { echo "missing $SMOKE_BIN_DIR/app-$app$exe: pnpm --filter $app tauri build --no-bundle" >&2; exit 2; }
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
xvfb=(xvfb-run -a --server-args="-screen 0 1440x900x24")
dbus=()
wrap=()
if [ "$linux" = 1 ]; then
  command -v dbus-run-session >/dev/null && dbus=(dbus-run-session --)
  [ -z "${DISPLAY:-}" ] && wrap+=("${xvfb[@]}")
  wrap+=(${dbus[@]+"${dbus[@]}"})
fi

# --- 1. start check --------------------------------------------------------------
failed=0
for app in "${apps[@]}"; do
  case "$app" in calc) title="Rusuite Calc" ;; write) title="Rusuite Write" ;; show) title="Rusuite Show" ;; esac
  version=$(node -p "require(process.argv[1]).version" "$ROOT/apps/$app/src-tauri/tauri.conf.json")
  out="$SMOKE_WORK/start-$app.txt"
  t0=$(date +%s)
  status=0
  RUSUITE_SMOKE_OUT="$out" ${wrap[@]+"${wrap[@]}"} "$SMOKE_BIN_DIR/app-$app$exe" --smoke >"$SMOKE_WORK/start-$app.log" 2>&1 || status=$?
  line=$(head -n1 "$out" 2>/dev/null || true)
  case "$status:$line" in
    "0:ok $title $version |"*) echo "ok   $app: --smoke start: ${line#ok } ($(($(date +%s) - t0)) s)" ;;
    *)
      failed=$((failed + 1))
      echo "FAIL $app: --smoke start: exit $status, '${line:-no result line}' (expected 'ok $title $version | …')"
      tail -n 20 "$SMOKE_WORK/start-$app.log" | sed 's/^/     /'
      ;;
  esac
done
if [ "$start_only" = 1 ]; then
  [ "$failed" = 0 ] && echo "all passed"
  exit "$((failed > 0))"
fi

# --- 2. WebDriver tests (Linux) ---------------------------------------------------------
# shellcheck disable=SC2016 # expanded by the inner shell
"${xvfb[@]}" ${dbus[@]+"${dbus[@]}"} bash -c '
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
[ "$failed" = 0 ] || { echo "$failed start check(s) failed" >&2; exit 1; }
