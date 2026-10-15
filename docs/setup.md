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

## LibreOffice headless (roundtrip harness)
```
sudo apt-get install -y --no-install-recommends \
  libreoffice-calc libreoffice-writer libreoffice-impress \
  libreoffice-java-common default-jre-headless fonts-liberation
```
Verify with `soffice --headless --convert-to pdf --outdir /tmp some.docx`. The harness (`scripts/roundtrip.sh`) uses a private `-env:UserInstallation` profile so concurrent runs do not collide.

## Not installed
- Microsoft Office (not available on Linux). Reference files in `testdata/` must be created elsewhere; provisional ones are generated with LibreOffice and marked as such in STATUS.md.
