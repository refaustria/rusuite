# Releasing Rusuite

Releases are cut from `main` by the PM (agents never tag, publish or deploy). A release is a draft, pre-release GitHub
Release built by `.github/workflows/release.yml`; nothing is public until someone presses **Publish release**.

## 1. Prepare `main`
1. `main` is green in CI (`rust`, `frontend`, `e2e`), and `pnpm i18n:check:strict` passes (no pending translation keys, docs/i18n.md).
2. Set the version everywhere and commit it:
   ```
   scripts/set-version.sh 0.1.0-rc.1      # workspace Cargo.toml (+ members with a literal version), Cargo.lock,
                                          # tauri.conf.json x3 (+ bundle.windows.wix.version), package.json x4
   scripts/check-versions.sh              # also run by CI and by the release workflow (against the tag)
   ```
   MSI (WiX) accepts only numeric versions, so a pre-release `X.Y.Z-pre.N` gets `bundle.windows.wix.version` =
   `X.Y.Z.N` (`0.1.0-rc.1` → `0.1.0.1`); a release gets `X.Y.Z`. Windows Installer compares only the first three
   fields, so an rc and its final release upgrade each other.
3. Regenerate `NOTICE` if dependencies changed: `scripts/gen-notice.sh` (needs `cargo-license`, docs/setup.md).
4. Update `CHANGELOG.md`: move the finished items from **Unreleased** into the version's section (user language, no
   task ids; the source is the task board in STATUS.md and `git log`), refresh **Known limitations** from ROADMAP.md and
   the QA logs in `docs/qa/`. `docs/release-notes/0.1.0.md` is the GitHub release text.
5. Owner checks on real Office and real machines: [testing.md › Before tagging](testing.md#before-tagging-owner-checklist).

## 2. Test run of the workflow (`workflow_dispatch`)
Do this after any change to `release.yml` and before the first tag of a version. The repository token used by the
agents cannot dispatch workflows, so the owner/PM clicks:

1. <https://github.com/refaustria/rusuite/actions/workflows/release.yml> → **Run workflow** (top right of the run list).
2. *Use workflow from*: `main` (or the branch to test). *Git ref to build*: leave empty (= that branch) or a tag/commit.
   *Release tag name for the draft release*: keep `v0.0.0-test` (the draft is thrown away afterwards).
3. **Run workflow**. The run has 17 jobs: `version strings`, 12 builds (`calc|write|show / <runner>`) and
   `smoke / <runner>` for `ubuntu-22.04`, `windows-latest`, `macos-latest`, `macos-15-intel`. It takes ~25 minutes.
4. Every `smoke / …` job must be green: its log ends with `ok   calc: --smoke start: Rusuite Calc <version> | …`
   (and write, show) and `all passed`. While `continue-on-error: true` is set on the smoke job, a failing smoke job is
   shown red but the run is still green – look at the jobs, not only at the run.
5. After the first run where all four smoke jobs passed: set `continue-on-error: false` on the `smoke` job in
   `release.yml` (commit "release: smoke job blocking"), so that a binary that cannot start blocks the release.
6. Delete the test draft: `gh release delete v0.0.0-test --yes` (the tag is not created for drafts).

## 3. Tag
```
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```
The `Release` workflow runs on the tag: `version strings` fails at once if the tag does not match the version files;
then each app (Calc, Write, Show) is built on

| Runner | Bundles |
| --- | --- |
| `ubuntu-22.04` | `.deb`, `.rpm`, `.AppImage` |
| `windows-latest` | `.msi`, NSIS `.exe` |
| `macos-latest` | Apple Silicon `.dmg` (+ `.app.tar.gz`) |
| `macos-15-intel` | Intel `.dmg` (+ `.app.tar.gz`) |

and attached to a **draft, pre-release** GitHub Release named `Rusuite <tag>` (<https://github.com/refaustria/rusuite/releases>).
The `smoke` job then starts every built binary on its OS with `--smoke`.

### The smoke job
`app-<name> --smoke` (apps/*/src-tauri/src/smoke.rs) opens the normal window; once the page has loaded, a script waits for
the UI to render and makes a real IPC round trip (`ping`, then `dispatch` with `documentState`); the binary checks the
reply, that the native window title names the app and that `ping` reports the version from `tauri.conf.json`, prints
`ok <ping> | <title>` and exits 0 (1 on a failed check, 2 after 120 s). The job runs
`scripts/desktop-smoke.sh --start-only` on the binaries the build jobs kept as artifacts (`smoke-bin-<app>-<runner>`,
3 days), under xvfb on Linux. The same check runs locally as the first step of `scripts/desktop-smoke.sh`.

## 4. Review and publish
1. Open the draft. Check the asset list (per app: `.deb`, `.rpm`, `.AppImage`, `.msi`, `.exe`, two `.dmg`, two
   `.app.tar.gz`) and download one installer per OS for a last start.
2. Replace the release text with `docs/release-notes/0.1.0.md` (adapt the heading for an rc). Keep **Set as a
   pre-release** ticked for alpha/rc builds.
3. **Publish release**. The SHA-256 digests of the assets then show under *Assets*.

## 5. Portal downloads page
The portal's `downloads.html` is static and generated at deploy time from the newest **published** release:
`scripts/deploy-web.sh` runs `scripts/gen-downloads.sh --out /var/www/resuite/downloads.html`, which reads
`gh release view <tag> --json …` and the asset digests (`gh api`), so the page itself never contacts GitHub (ADR 0009).
After publishing, the PM redeploys from `main` (`scripts/deploy-web.sh`). `DOWNLOADS_TAG=<tag>` picks a specific release;
without `gh` or without a published release the page says "no release yet" and links to GitHub Releases (that page is
also the committed `apps/portal/downloads.html`). Preview locally:
`DOWNLOADS_TAG=v0.1.0-alpha.3 scripts/gen-downloads.sh --out /tmp/downloads.html` (drafts work for the PM's token, but
their download links work only for repository members).

## Report relay URL (P8-43)
The desktop apps post "Report a problem" to the relay URL baked in at build time: `REPORT_RELAY_URL` (Vite exposes it
through the apps' `envPrefix`), default `https://rusuit.es/api/report`. Set it in the environment of the
release build to point a build at another relay (`REPORT_RELAY_URL=https://example.org/api/report pnpm --filter calc
tauri build`). The web builds always use the relative `/api/report` of the site they are served from. The relay
itself is deployed separately (`scripts/deploy-relay.sh`, docs/setup.md "Report relay").

## Signing caveats
Builds are **not code-signed**; the downloads page (notice box plus per-OS steps next to the buttons) and the release notes
say so plainly:
- **macOS 15 Sequoia and later**: opening the app shows "Not Opened" – click *Done* (not "Move to Bin"), then System
  Settings › Privacy & Security › Security › *Open Anyway* › password › *Open*. Alternative in Terminal:
  `xattr -dr com.apple.quarantine "/Applications/Rusuite Calc.app"` (likewise Write, Show).
- **macOS 14 and earlier**: right-click the app › *Open* › *Open*.
- **Windows SmartScreen**: "Windows protected your PC" – *More info* › *Run anyway*.
- **Linux**: no warning; make the AppImage executable (`chmod +x`), install deb/rpm as usual.

Code signing, notarization and auto-update are on the ROADMAP.

## Known risks of pre-release versions in bundles
- **RPM**: RPM versions cannot contain `-`; the bundler has to map `0.1.0-rc.1` to an RPM version/release. If the
  `ubuntu-22.04` build fails in the rpm step, the test run of section 2 shows it before tagging.
- **macOS** shows the version string as is in *About*; Apple's numeric-only rule applies to the App Store only.


Test run 2026-10-16: https://github.com/refaustria/rusuite/actions/runs/38911314761 – 12 builds + 4 smoke jobs green (RPM accepted `0.1.0-rc.1` as `0.1.0-rc.1-1`, MSI uses `0.1.0.1`); the smoke job is blocking since then.
