# Releasing Rusuite

## Cutting a release
1. Make sure `main` is green (CI workflow) and the versions in `apps/*/src-tauri/tauri.conf.json` are right.
2. Tag and push from `main`:
   ```
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. The `Release` workflow (`.github/workflows/release.yml`) builds each app (Calc, Write, Show) on:
   - `ubuntu-22.04` (`.deb`, `.AppImage`, `.rpm`)
   - `windows-latest` (`.msi`, NSIS `.exe`)
   - `macos-latest` (Apple Silicon `.dmg`)
   - `macos-15-intel` (Intel `.dmg`)
4. Bundles are attached to a **draft, pre-release** GitHub Release named `Rusuite <tag>`
   (https://github.com/refaustria/rusuite/releases). Review it, then publish.

The workflow can also be started manually (Actions > Release > Run workflow) with a `ref` and a `tag`
(default `v0.0.0-test`); delete the resulting draft with `gh release delete <tag>`.

## Signing caveats
Builds are **not code-signed**. Windows SmartScreen shows "unknown publisher" (More info > Run anyway);
macOS Gatekeeper blocks the app on first launch (right-click > Open, or `xattr -dr com.apple.quarantine <app>`).
Code signing and notarization are on the ROADMAP.
