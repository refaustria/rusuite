#!/usr/bin/env bash
# Builds the owner-only stats served (basic auth) at https://rusuit.es/stats/:
#   rusuit.es.html  GoAccess report of the rusuit.es access log (all requests, crawlers included)
#   usage.html      usage.py: visitors per day, which apps are opened, countries, referrers (bots left out)
#   downloads.html  downloads.py: GitHub release download counts, with a daily history
# Runs hourly from rusuite-stats.timer as the system user rusuite-stats (group adm reads the 0640
# www-data:adm nginx logs). No GoAccess database is kept, so the traffic pages cover the 14 days of
# rotated logs; the download history lives in /var/lib/rusuite-stats/downloads.jsonl. See deploy/README.md
# "Traffic and download stats".
#
# Usage: rusuite-stats.sh [LOG_DIR [OUT_DIR]]   (defaults: /var/log/nginx, /var/www/rusuite-stats)
set -euo pipefail

LOG_DIR="${1:-/var/log/nginx}"
OUT_DIR="${2:-/var/www/rusuite-stats}"
HERE="$(dirname "$(readlink -f "$0")")"
LOG_NAME="${LOG_NAME:-resuite.access.log}"
# Country database: the DaisyChess one on the same host (DB-IP Country Lite, refreshed monthly by
# daisychess-geoip.timer). Everything works without it (countries show as "??").
GEOIP_DB="${GEOIP_DB:-/var/lib/daisychess-stats/dbip-country-lite.mmdb}"
EXCLUDE_IPS_FILE="${EXCLUDE_IPS_FILE:-/etc/rusuite-stats/exclude-ips}"
STATE_DIR="${STATE_DIR:-/var/lib/rusuite-stats}"
REPO="${REPO:-refaustria/rusuite}"

mkdir -p "$OUT_DIR"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
generated="$(date '+%Y-%m-%d %H:%M %Z')"
links=""

emit_logs() {
  local f
  for f in "$LOG_DIR/$LOG_NAME" "$LOG_DIR/$LOG_NAME".*; do
    [ -f "$f" ] || continue
    case "$f" in
      *.gz) zcat -- "$f" ;;
      *) cat -- "$f" ;;
    esac
  done
}

# `|| true`: a file rotated away between the glob and the read must not abort the run.
emit_logs >"$tmp_dir/access.log" 2>/dev/null || true

if [ -s "$tmp_dir/access.log" ]; then
  geo_args=()
  [ -f "$GEOIP_DB" ] && geo_args=(--geoip-database="$GEOIP_DB")
  # nginx default "combined" format. Reports embed their own JS/CSS (no external resources).
  goaccess "$tmp_dir/access.log" --log-format=COMBINED \
    "${geo_args[@]}" --real-os --no-query-string --no-progress --no-global-config \
    --html-report-title="Rusuite stats - rusuit.es" \
    -o "$tmp_dir/rusuit.es.html"
  chmod 0644 "$tmp_dir/rusuit.es.html"
  mv -f "$tmp_dir/rusuit.es.html" "$OUT_DIR/rusuit.es.html"
  links+="      <li><a href=\"rusuit.es.html\">All requests</a> - GoAccess report of every request (crawlers and scanners included)</li>"$'\n'
else
  echo "no logs in $LOG_DIR/$LOG_NAME*, skipping the GoAccess report" >&2
fi

# A failure in one page keeps the previous version of that page and never loses the others.
if python3 "$HERE/usage.py" --log "$tmp_dir/access.log" --out "$tmp_dir/usage.html" --mmdb "$GEOIP_DB" \
    --exclude-file "$EXCLUDE_IPS_FILE" --generated "$generated"; then
  chmod 0644 "$tmp_dir/usage.html"
  mv -f "$tmp_dir/usage.html" "$OUT_DIR/usage.html"
else
  echo "usage.py failed, keeping the previous usage.html" >&2
fi
[ -f "$OUT_DIR/usage.html" ] && links="      <li><a href=\"usage.html\">Visitors and apps</a> - people per day, which apps they open, countries, where they come from (bots left out)</li>"$'\n'"$links"

if python3 "$HERE/downloads.py" --repo "$REPO" --history "$STATE_DIR/downloads.jsonl" \
    --out "$tmp_dir/downloads.html" --generated "$generated"; then
  chmod 0644 "$tmp_dir/downloads.html"
  mv -f "$tmp_dir/downloads.html" "$OUT_DIR/downloads.html"
else
  echo "downloads.py failed, keeping the previous downloads.html" >&2
fi
[ -f "$OUT_DIR/downloads.html" ] && links="      <li><a href=\"downloads.html\">Downloads</a> - desktop installers from GitHub Releases, per app, platform and day</li>"$'\n'"$links"

cat >"$tmp_dir/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Rusuite stats</title>
  <style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}</style>
</head>
<body>
  <h1>Rusuite stats</h1>
  <ul>
${links}  </ul>
  <p>Traffic pages: last 14 days of the rusuit.es access log. Downloads: GitHub's counters, history since the
  stats were set up. Generated $generated, every hour.</p>
  <p><small>IP geolocation by <a href="https://db-ip.com">DB-IP</a> (IP to Country Lite, CC BY 4.0).</small></p>
</body>
</html>
HTML
chmod 0644 "$tmp_dir/index.html"
mv -f "$tmp_dir/index.html" "$OUT_DIR/index.html"
