# Deployment of the web target

`https://rusuit.es/{calc,write,show}/` serves static files from `/var/www/resuite` (ADR 0005); the root `/` is the portal (`apps/portal`: `index.html`, `styles.css`, `logos/`) listing the three apps.

## nginx vhost
`deploy/nginx/rusuit.es.conf` is the source of truth. It is symlinked into nginx and certbot edited it in place, so the committed file contains the `# managed by Certbot` TLS blocks (on a fresh host with no certificate, delete those first, run certbot, and it re-adds them). The stock `mime.types` already maps `wasm`; do not add a local `types {}` block, it replaces all other types.

```
sudo mkdir -p /var/www/resuite && sudo chown $USER: /var/www/resuite
sudo cp deploy/nginx/rusuit.es.conf /etc/nginx/sites-available/rusuit.es
sudo ln -sfn /etc/nginx/sites-available/rusuit.es /etc/nginx/sites-enabled/rusuit.es
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d rusuit.es -d www.rusuit.es -d resuite.inceptum.at --non-interactive --agree-tos -m bojan@referee.at --redirect
```
Note: the live config is a copy in `/etc/nginx/sites-available/` (not a symlink into the repo), so moving or removing checkouts cannot break nginx. After editing the committed file, re-run the `cp` + `sudo nginx -t && sudo systemctl reload nginx`. Renewal is handled by certbot's scheduled task; certbot edits the live copy – if it changes, copy it back into the repo.

Hosts: the main server block answers `rusuit.es` only; `www.rusuit.es` and the retired `resuite.inceptum.at` (ports 80 and 443) return 301 to `https://rusuit.es$request_uri`. The certificate must list all three names. On the live server the old `sites-available/resuite.inceptum.at` file is replaced by `rusuit.es` (`scripts/deploy-relay.sh` expects that path; override with `VHOST`).

## Security headers
The vhost sends `Content-Security-Policy` (ADR 0009: `connect-src 'self'`, no third-party origins), `Referrer-Policy: no-referrer`, `Permissions-Policy` and `nosniff`. nginx drops server-level `add_header` lines in locations that define their own, so every location repeats them; the policy strings are the `set $csp...` lines at the top of the server block (`$csp_connect` is the marked line for future provider origins). After changing them, run the e2e suite against the live site: `BASE_URL=https://rusuit.es pnpm e2e`.

## Redeploy
From a checkout of `main`: `scripts/deploy-web.sh` (builds, rsyncs `apps/{calc,write,show}/dist-web/` to `/var/www/resuite/{calc,write,show}/` and `apps/portal/` to the root, writes `/var/www/resuite/version.json`, smoke-checks `/` (200 `text/html`, no redirect), each app page and the `application/wasm` content type). `--no-build` reuses an existing `dist-web`. Env overrides: `DEPLOY_HOST`, `DEPLOY_ROOT`.

## Report relay
`/api/report` (the apps' "Report a problem", P8-43) is proxied to a local service; install and update it with `scripts/deploy-relay.sh` (it adds `/etc/nginx/snippets/rusuite-report.conf`, included by the vhost's glob `include`). Details: `docs/setup.md` "Report relay".

## Logs
`/var/log/nginx/resuite.access.log` and `/var/log/nginx/resuite.error.log`.

## Traffic and download stats
Owner-only pages at `https://rusuit.es/stats/` (basic auth), rebuilt hourly by `rusuite-stats.timer`
(`deploy/stats/rusuite-stats.sh`, user `rusuite-stats`, group `adm` reads the nginx logs):
- `usage.html` (`usage.py`): people per day (new / returning), which apps they open (Calc, Write, Show, Notes,
  portal, downloads page), countries, devices, referring sites, a per-IP table. A person is an IP with a browser
  user agent that ran our JavaScript (`/version.json` or an app's `/assets/*.js`); bots, scanners and the IPs in
  `/etc/rusuite-stats/exclude-ips` (one per line, `#` comments) are left out. IPs, not people: shared or
  changing addresses skew it.
- `downloads.html` (`downloads.py`): GitHub release download counters per app, platform, release and file.
  GitHub only keeps totals, so each run stores the day's totals in `/var/lib/rusuite-stats/downloads.jsonl` and
  the page shows the daily increase from that history.
- `rusuit.es.html`: GoAccess report of every request (crawlers included).

The traffic pages cover the 14 days of rotated logs (`/var/log/nginx/resuite.access.log*`); countries come from
the DaisyChess DB-IP database on the same host (`/var/lib/daisychess-stats/dbip-country-lite.mmdb`), offline.
Privacy: the pages only aggregate the web log the privacy page already mentions; nothing is sent anywhere.

```bash
sudo apt install goaccess apache2-utils python3-maxminddb
sudo useradd --system --no-create-home --shell /usr/sbin/nologin --groups adm rusuite-stats
sudo install -d -o rusuite-stats -g www-data -m 0750 /var/www/rusuite-stats
sudo install -D -m 0755 -t /usr/local/lib/rusuite-stats deploy/stats/rusuite-stats.sh deploy/stats/usage.py deploy/stats/downloads.py
sudo install -m 0644 deploy/stats/rusuite-stats.service deploy/stats/rusuite-stats.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now rusuite-stats.timer
sudo systemctl start rusuite-stats.service          # first build now; check: journalctl -u rusuite-stats
sudo htpasswd -c /etc/nginx/rusuite-stats.htpasswd <user>   # password prompted, never on a command line
sudo chown root:www-data /etc/nginx/rusuite-stats.htpasswd && sudo chmod 0640 /etc/nginx/rusuite-stats.htpasswd
sudo install -m 0644 deploy/nginx/stats.conf /etc/nginx/snippets/rusuite-stats.conf
sudo nginx -t && sudo systemctl reload nginx
```
Manual run: `STATE_DIR=/tmp/s deploy/stats/rusuite-stats.sh /var/log/nginx /tmp/stats-out`.
Tests: `python3 -m unittest discover -s deploy/stats`.
