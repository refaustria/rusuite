# Deployment of the web target

`https://resuite.inceptum.at/{calc,write,show}/` serves static files from `/var/www/resuite` (ADR 0005). Only Calc exists so far.

## nginx vhost
`deploy/nginx/resuite.inceptum.at.conf` is the source of truth. It is symlinked into nginx and certbot edited it in place, so the committed file contains the `# managed by Certbot` TLS blocks (on a fresh host with no certificate, delete those first, run certbot, and it re-adds them). The stock `mime.types` already maps `wasm`; do not add a local `types {}` block, it replaces all other types.

```
sudo mkdir -p /var/www/resuite && sudo chown $USER: /var/www/resuite
sudo ln -sf "$PWD/deploy/nginx/resuite.inceptum.at.conf" /etc/nginx/sites-enabled/resuite.inceptum.at
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d resuite.inceptum.at --non-interactive --agree-tos -m bojan@referee.at --redirect
```
Note: the symlink points into the checkout it was created from; re-run the `ln -sf` from the main checkout once the file is on `main`. Renewal is handled by certbot's scheduled task.

## Redeploy
From a checkout of `main`: `scripts/deploy-web.sh` (builds, rsyncs `apps/calc/dist-web/` to `/var/www/resuite/calc/`, writes `/var/www/resuite/version.json`, smoke-checks the page and the `application/wasm` content type). `--no-build` reuses an existing `dist-web`. Env overrides: `DEPLOY_HOST`, `DEPLOY_ROOT`.

## Logs
`/var/log/nginx/resuite.access.log` and `/var/log/nginx/resuite.error.log`.
