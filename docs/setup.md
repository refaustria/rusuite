# Development server setup

What has been installed on the dev server for Rusuite, so it can be reproduced. Debian 13 (trixie), x86_64.

## Rust
```
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --component clippy,rustfmt
```
Installs to `~/.cargo` and `~/.rustup`; the project pins `stable` via `rust-toolchain.toml`. Non-interactive shells need `export PATH="$HOME/.cargo/bin:$PATH"` (or `source ~/.cargo/env`).

## Node / pnpm
Node 24 was already present. pnpm installed globally:
```
sudo npm install -g pnpm@latest
```
The exact version is pinned in `package.json` (`packageManager`).

## Tauri system dependencies
Already present on the server: `build-essential`, `pkg-config`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`. For a fresh machine follow https://tauri.app/start/prerequisites/ (also needs `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev` on Debian/Ubuntu).

Cloud connectors (P8-36): the desktop shells link `libdbus-1` (the `keyring` crate's Secret Service backend; `libdbus-1-dev`
is already present, Tauri needs it too) and reach HTTPS servers with rustls + `ring` (only a C compiler, no cmake). At run
time remembered passwords need a Secret Service (GNOME Keyring, KWallet); without one the app says so and asks for the
password each session.

## LibreOffice headless (roundtrip harness)
```
sudo apt-get install -y --no-install-recommends \
  libreoffice-calc libreoffice-writer libreoffice-impress \
  libreoffice-java-common default-jre-headless fonts-liberation
```
Verify with `soffice --headless --convert-to pdf --outdir /tmp some.docx`. The harness (`scripts/roundtrip.sh`) uses a private `-env:UserInstallation` profile so concurrent runs do not collide.

## Not installed
- Microsoft Office (not available on Linux). Reference files in `testdata/` must be created elsewhere; provisional ones are generated with LibreOffice and marked as such in STATUS.md.

## Harness helpers
```
sudo apt-get install -y libxml2-utils shellcheck
```
`xmllint` normalizes XML for the structural diff in `scripts/roundtrip.sh`; `shellcheck` lints the scripts. ImageMagick (`convert`) was already present and is used by `scripts/gen-testdata.sh` for the test PNG.

## openpyxl (chart reference workbooks, P8-18)
```
pip3 install --user --break-system-packages openpyxl   # 3.1.5; Debian 13 needs the flag (PEP 668)
```
Used only by `scripts/testdata-src/xlsx/charts.py`, which writes the provisional chart workbooks
(`python3 -I scripts/testdata-src/xlsx/charts.py testdata/xlsx`). LibreOffice cannot be used for
them: its chart export is not what Excel writes. `-I` ignores the user site directory, so the
script adds it back itself.

## Logo exports (P7-10)
```
sudo apt-get install -y librsvg2-bin    # rsvg-convert 2.60.0 (Debian 13)
```
`rsvg-convert -w 1024 -h 1024 apps/portal/logos/<app>.svg -o apps/portal/logos/<app>.png` renders the logo PNGs; the desktop icons come from them via `pnpm --filter <app> tauri icon ../portal/logos/<app>.png` (delete the generated `android/` and `ios/` folders, only desktop icons are committed).

## Tauri app scaffold (P2-3)
Additional apt packages for building `apps/calc` (Tauri 2) and smoke-testing it headless:
```
sudo apt-get install -y libayatana-appindicator3-dev librsvg2-dev libssl-dev patchelf xvfb
```
(`xvfb` was already present here.) The Tauri CLI comes from the npm package `@tauri-apps/cli` (prebuilt binary, no `cargo install`). Build with `pnpm --filter calc tauri build --no-bundle`; smoke test with `timeout 15 xvfb-run -a target/release/app-calc` (expect exit 124, no panic). Icons were generated from a 1024x1024 ImageMagick PNG via `pnpm --filter calc tauri icon`; only desktop icons are committed.

## Desktop smoke test (P7-7)
`scripts/desktop-smoke.sh` drives the release binaries through WebDriver:
```
sudo apt-get install -y webkit2gtk-driver        # WebKitWebDriver 2.54.0 (Debian 13)
cargo install tauri-driver --version 2.1.0 --locked
```
`tauri-driver` (2.1.0, released 2026-09-26) lands in `~/.cargo/bin`. `xvfb-run` and `dbus-run-session` were already present;
without a D-Bus session every WebKit start waits ~30 s for the accessibility bus.

## Web (WASM) target
Needed for `pnpm --filter calc build:web` / `dev:web` (ADR 0005):
```
rustup target add wasm32-unknown-unknown
```
`wasm-pack` comes from the npm devDependency `wasm-pack@0.15.0` in `apps/calc` (its postinstall downloads the prebuilt binary from github.com/wasm-bindgen/wasm-pack; pnpm needs `allowBuilds: wasm-pack` in `pnpm-workspace.yaml`). Versions before 0.15.0 download from a dead URL (404). wasm-pack fetches the `wasm-bindgen` CLI matching the pinned crate version itself. Output: `apps/calc/src-wasm/pkg/` (wasm package, gitignored) and `apps/calc/dist-web/` (static site, base path `/calc/`, gitignored). Quick check: `cargo check --target wasm32-unknown-unknown -p app-calc-wasm`.

## Web deployment (nginx + certbot, P2-W3)
The vhost `deploy/nginx/resuite.inceptum.at.conf` is symlinked into `/etc/nginx/sites-enabled/`, static root `/var/www/resuite` (owned by the deploy user). TLS: `sudo certbot --nginx -d resuite.inceptum.at --non-interactive --agree-tos -m bojan@referee.at --redirect` (nginx plugin is installed; renewal is automatic). Deploy with `scripts/deploy-web.sh`; details in `deploy/README.md`.

## ffmpeg (test media clips, 2026-10-16)

`sudo apt-get install -y ffmpeg` (Debian 13: 7.1). Used only to generate the small MP4/H.264 test clip for the pptx media reference deck (`scripts/testdata-src/pptx/gen.py`); PowerPoint plays MP4/H.264, not WebM.

## Report relay (P8-43)

`services/report-relay` (binary `rusuite-report-relay`, axum + tokio + reqwest/rustls) turns the apps' "Report a
problem" into GitHub issues. It listens on `127.0.0.1:8787`; nginx forwards `location = /api/report` and
`/api/report/health` from the resuite vhost (`/etc/nginx/snippets/rusuite-report.conf`, included by the vhost line
`include /etc/nginx/snippets/rusuite-report*.conf;` – a glob, so `nginx -t` passes without the snippet).

- **Secrets**: `/etc/rusuite/report-relay.env`, `root:root 0600`, created by the owner and never committed:
  ```
  GITHUB_TOKEN=<fine-grained token: Issues read/write, Contents read/write (screenshots) on the repository>
  GITHUB_REPO=refaustria/rusuite
  ```
  Optional: `REPORT_LISTEN` (default `127.0.0.1:8787`), `REPORT_SITE_ORIGIN` (default `https://resuite.inceptum.at`),
  `REPORT_EXTRA_ORIGINS` (comma-separated, e.g. a dev server), `REPORT_ATTACHMENT_BRANCH` (default
  `issue-attachments`), `GITHUB_API` (tests). Without Contents permission issues are created without screenshots and
  the app says so.
- **Install / update**: `scripts/deploy-relay.sh` (release build → `/usr/local/bin/rusuite-report-relay`; system user
  `rusuite-relay`; unit `/etc/systemd/system/rusuite-report-relay.service` with `EnvironmentFile=` and systemd
  sandboxing; the nginx snippet and the vhost include (backup `<vhost>.bak-<time>`, restored if `nginx -t` fails);
  reload; health checks on `127.0.0.1:8787` and `https://resuite.inceptum.at/api/report/health`). Idempotent;
  `--build-only` just builds, `--no-build` installs an existing build. Needs `sudo`.
- **Operations**: `systemctl status rusuite-report-relay`, `journalctl -u rusuite-report-relay` (one line per request:
  status, app, kind, an 8-character hash of the instance, duration – never text, images or IP addresses).
  `curl -s https://resuite.inceptum.at/api/report/health` → `{"ok":true,"version":"0.1.0"}`.
- **Limits** (in memory, reset by a restart): 1 report per app instance, 5 per client IP (`X-Forwarded-For`, set by
  nginx to `$remote_addr` and trusted from loopback only), 100 in total per hour; body ≤ 8 MB, ≤ 3 screenshots of
  ≤ 2 MB (5 MB together). CORS: the site, `tauri://localhost` and `https://tauri.localhost` only.
- **Rotating the token**: edit the env file, `sudo systemctl restart rusuite-report-relay`.
- **Removing it**: `sudo systemctl disable --now rusuite-report-relay`, delete the snippet, `sudo nginx -t && sudo
  systemctl reload nginx` (the Help entry then shows "The report service could not be reached").
