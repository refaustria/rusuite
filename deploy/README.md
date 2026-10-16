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
