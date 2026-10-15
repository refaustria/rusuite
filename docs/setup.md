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

## Harness helpers
```
sudo apt-get install -y libxml2-utils shellcheck
```
`xmllint` normalizes XML for the structural diff in `scripts/roundtrip.sh`; `shellcheck` lints the scripts. ImageMagick (`convert`) was already present and is used by `scripts/gen-testdata.sh` for the test PNG.

## Tauri app scaffold (P2-3)
Additional apt packages for building `apps/calc` (Tauri 2) and smoke-testing it headless:
```
sudo apt-get install -y libayatana-appindicator3-dev librsvg2-dev libssl-dev patchelf xvfb
```
(`xvfb` was already present here.) The Tauri CLI comes from the npm package `@tauri-apps/cli` (prebuilt binary, no `cargo install`). Build with `pnpm --filter calc tauri build --no-bundle`; smoke test with `timeout 15 xvfb-run -a target/release/app-calc` (expect exit 124, no panic). Icons were generated from a 1024x1024 ImageMagick PNG via `pnpm --filter calc tauri icon`; only desktop icons are committed.
