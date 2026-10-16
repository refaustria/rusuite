#!/usr/bin/env bash
# Build and install the "Report a problem" relay (P8-43, ADR 0009 amendment): services/report-relay →
# /usr/local/bin/rusuite-report-relay, run by systemd (rusuite-report-relay.service, dedicated system user), reached
# through nginx `location /api/report` → 127.0.0.1:8787 on the resuite vhost (snippet
# /etc/nginx/snippets/rusuite-report.conf, included from the vhost). Idempotent: re-running updates the binary,
# the unit and the snippet and restarts the service.
#
# The GitHub token lives ONLY in /etc/rusuite/report-relay.env (root:root 0600; GITHUB_TOKEN, GITHUB_REPO). This
# script never reads it: systemd loads it as root before dropping to the service user.
#
# Usage: scripts/deploy-relay.sh [--build-only | --no-build]
#   --build-only  build the release binary and stop (prints its path)
#   --no-build    install an existing target/release/rusuite-report-relay
# Env: SITE (default https://rusuit.es), VHOST (default /etc/nginx/sites-available/rusuit.es),
#      RELAY_LISTEN (default 127.0.0.1:8787).
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
SITE="${SITE:-https://rusuit.es}"
VHOST="${VHOST:-/etc/nginx/sites-available/rusuit.es}"
LISTEN="${RELAY_LISTEN:-127.0.0.1:8787}"
NAME=rusuite-report-relay
BIN=/usr/local/bin/$NAME
UNIT=/etc/systemd/system/$NAME.service
SNIPPET=/etc/nginx/snippets/rusuite-report.conf
ENV_FILE=/etc/rusuite/report-relay.env
SERVICE_USER=rusuite-relay

build=1
install=1
for arg in "$@"; do
  case "$arg" in
    --build-only) install=0 ;;
    --no-build) build=0 ;;
    *) echo "usage: $0 [--build-only | --no-build]" >&2; exit 2 ;;
  esac
done

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
built="${CARGO_TARGET_DIR:-target}/release/$NAME"

if [ "$build" = 1 ]; then
  cargo build --release --locked -p report-relay
fi
[ -x "$built" ] || { echo "missing $built (run without --no-build)" >&2; exit 1; }
if [ "$install" = 0 ]; then
  echo "built: $built"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. The environment file must exist (created by the owner; never read here).
sudo test -f "$ENV_FILE" || { echo "missing $ENV_FILE (GITHUB_TOKEN=…, GITHUB_REPO=owner/name; root:root 0600)" >&2; exit 1; }
sudo chown root:root "$ENV_FILE"
sudo chmod 0600 "$ENV_FILE"

# 2. A dedicated system user without a shell or home.
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# 3. The binary.
sudo install -m 0755 -o root -g root "$built" "$BIN.new"
sudo mv -f "$BIN.new" "$BIN"

# 4. The systemd unit.
cat > "$tmp/unit" <<UNIT
[Unit]
Description=Rusuite report relay ("Report a problem" → GitHub issues)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
Environment=REPORT_LISTEN=$LISTEN
EnvironmentFile=$ENV_FILE
ExecStart=$BIN
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
CapabilityBoundingSet=
AmbientCapabilities=
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
if ! sudo cmp -s "$tmp/unit" "$UNIT"; then
  sudo install -m 0644 -o root -g root "$tmp/unit" "$UNIT"
  sudo systemctl daemon-reload
fi
sudo systemctl enable "$NAME.service" >/dev/null
sudo systemctl restart "$NAME.service"

# 5. nginx: the snippet, included from the TLS server block of the vhost.
cat > "$tmp/snippet" <<NGINX
# Rusuite "Report a problem" relay (P8-43; written by scripts/deploy-relay.sh). Same origin as the apps, so the
# web CSP stays connect-src 'self'. X-Forwarded-For is SET (not appended) to the client address: the relay trusts
# its first hop from loopback only.
location = /api/report {
    limit_except POST OPTIONS { deny all; }
    client_max_body_size 8m;
    proxy_pass http://$LISTEN;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 90s;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
}
location = /api/report/health {
    proxy_pass http://$LISTEN;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
}
NGINX
sudo mkdir -p "$(dirname "$SNIPPET")"
snippet_old="$tmp/snippet.old"
# shellcheck disable=SC2024 # the redirect writes our own temp file on purpose
sudo cat "$SNIPPET" > "$snippet_old" 2>/dev/null || : > "$snippet_old"
sudo install -m 0644 -o root -g root "$tmp/snippet" "$SNIPPET"

vhost_backup=""
if ! sudo grep -q 'snippets/rusuite-report' "$VHOST"; then
  vhost_backup="$VHOST.bak-$(date +%Y%m%d%H%M%S)"
  sudo cp -p "$VHOST" "$vhost_backup"
  # The first server block (the TLS one, which certbot manages) gets the include after its server_name line.
  sudo sed -i '0,/^\(\s*\)server_name resuite\.inceptum\.at;/s//&\n\n\1# "Report a problem" relay (P8-43); the glob keeps nginx -t passing without the snippet.\n\1include \/etc\/nginx\/snippets\/rusuite-report*.conf;/' "$VHOST"
  sudo grep -q 'snippets/rusuite-report' "$VHOST" || { echo "could not add the include to $VHOST" >&2; exit 1; }
fi
if ! sudo nginx -t; then
  echo "nginx -t failed: restoring the previous snippet and vhost" >&2
  if [ -s "$snippet_old" ]; then sudo install -m 0644 "$snippet_old" "$SNIPPET"; else sudo rm -f "$SNIPPET"; fi
  [ -n "$vhost_backup" ] && sudo cp -p "$vhost_backup" "$VHOST"
  exit 1
fi
sudo systemctl reload nginx

# 6. Health checks: the service itself, then through nginx.
for i in $(seq 1 20); do
  if curl -fsS "http://$LISTEN/api/report/health" >/dev/null 2>&1; then break; fi
  [ "$i" = 20 ] && { echo "the relay does not answer on $LISTEN (journalctl -u $NAME)" >&2; exit 1; }
  sleep 0.5
done
echo "ok: http://$LISTEN/api/report/health $(curl -fsS "http://$LISTEN/api/report/health")"
health="$(curl -fsS "$SITE/api/report/health")" || { echo "error: $SITE/api/report/health is not reachable through nginx" >&2; exit 1; }
echo "ok: $SITE/api/report/health $health"
