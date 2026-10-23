# Releasing Rusuite

Releases are cut from `main` by the PM (agents never tag, publish or deploy). A release is a draft, pre-release GitHub
Release built by `.github/workflows/release.yml`; nothing is public until someone presses **Publish release**.

**Version numbers (π scheme, [versioning.md](versioning.md)):** one release per cycle, public name with one more digit
of π – **3.141** (semver `3.141.0`, tag `v3.141.0`), then 3.1415, 3.14159. The public name (no trailing `.0`) is used in
the release title (`releaseName` in release.yml), the Downloads page, the apps' File view and the portal footer; tags,
`Cargo.toml`/`tauri.conf.json`/`package.json` and the installer file names keep the full semver. One rule derives it
everywhere: ui-shared `publicVersion`, `scripts/gen-downloads.mjs` `publicName`, `scripts/versions-lib.sh`
`public_version`, apps/portal/version.js and the `tag` step of release.yml. A hotfix inside a cycle bumps the patch
(`3.141.1`, shown as "3.141.1").

## Release 3.1415 – the steps of this cycle
Prepared by P10-R1 on `p10/r1-release-31415` (versions `3.1415.0`, MSI `3.14.15.0`, notes `docs/release-notes/3.1415.md`,
CHANGELOG, NOTICE, portal "New in 3.1415", Downloads "Phones and tablets", Office check pack in
`/home/bojan/rusuite-office-check/rusuite-office-check-3.1415.0.zip`). After that branch is merged:
1. `pnpm i18n:check:strict`, `scripts/check-versions.sh 3.1415.0`, `scripts/versions-lib.test.sh` and CI green on `main`;
   put the **public** GPG key into `keys/rusuite-release-key.asc` (from `~/rusuite-signing/`, [signing.md](signing.md))
   so `deploy-web.sh` ships `https://rusuit.es/rusuite-release-key.asc`; deploy the web (`scripts/deploy-web.sh --e2e`).
2. Secrets present? (`gh secret list -R refaustria/rusuite`; the lists in [signing.md](signing.md) and
   [store/README.md](store/README.md)). Trim the three signing lines of `docs/release-notes/3.1415.md` (and the
   "Coming soon: Windows signing" item of the portal, `portal.soon.item8`) to what the run will really sign.
3. Owner: open the Office check pack (no new file features this cycle; it re-validates the 3.141 files).
4. Optional test run of release.yml with `v0.0.0-test` (section 2), then delete the draft.
5. Tag and push: `git tag -a v3.1415.0 -m "Rusuite 3.1415" && git push origin v3.1415.0`. This starts **both**
   `release.yml` (desktop draft "Rusuite 3.1415", `signing.json`) and `mobile-release.yml` (signed AAB → Play internal
   track, IPA → TestFlight; skipped with a notice where secrets are missing).
6. Review the desktop draft (section 4): `signing.json` says what you expect, paste `docs/release-notes/3.1415.md`
   (fill nothing yet in the store links, see 9), untick the pre-release box, *Publish release*.
7. Redeploy the web from `main` (`scripts/deploy-web.sh --e2e`): Downloads lists 3.1415 with the per-OS signed state.
8. Store work (section 6, details in [store/README.md](store/README.md)): `play.mjs status` / `validate`,
   `play.mjs listing push --app <app>`, `asc.mjs app-info push`, `asc.mjs version ensure|push --version 3.1415`,
   `asc.mjs build attach --version 3.1415 --build 4415000`, review notes; testers on Play internal and TestFlight.
9. Submit with the owner's go per store (`play.mjs upload --track production --rollout 0.2`, `asc.mjs submit … --yes`).
   After approval: put the store URLs into `docs/store/links.json` (`calc|write|show` × `play|appstore`), replace
   `<Play Store link>` / `<App Store link>` in the published release text, merge and redeploy the web – the Downloads
   page then shows the buttons instead of "coming soon".

## Release 3.141 – the steps of this cycle (done 2026-10-18)
Prepared by P9-R1 on `p9/r1-release-3141` (versions `3.141.0`, notes `docs/release-notes/3.141.md`, CHANGELOG, NOTICE,
Office check pack in `/home/bojan/rusuite-office-check/rusuite-office-check-3.141.0.zip`). After that branch is merged:
1. `pnpm i18n:check:strict` green on `main` (the portal's "New in 3.141" / signing keys need translating, see the
   P9-R1 report), CI green, the live site deployed from `main` and its e2e green.
2. Owner: open the Office check pack in Excel/Word/PowerPoint (README.txt lists the 3.141 files first).
3. Optional test run of release.yml (section 2) with *Release tag name* `v0.0.0-test`, then delete the draft.
4. Tag and push: `git tag -a v3.141.0 -m "Rusuite 3.141" && git push origin v3.141.0` – the workflow builds the draft
   release "Rusuite 3.141".
5. Review the draft (section 4): paste `docs/release-notes/3.141.md` as the text, **untick "Set as a pre-release"**
   (3.141 is a release), *Publish release*.
6. Redeploy the web from `main` (`scripts/deploy-web.sh --e2e`): the Downloads page then lists 3.141 (section 5), the
   portal footer shows "Rusuite 3.141 · Build …".

## 1. Prepare `main`
1. `main` is green in CI (`rust`, `frontend`, `e2e`), and `pnpm i18n:check:strict` passes (no pending translation keys, docs/i18n.md). Last green: 2026-10-23 (P10-LF, cycle 3.1415: the 48 keys of the compact layout and bottom sheets, Calc/Write/Show touch, PDF export and the portal's signing/Downloads texts in all 22 translated languages; the i18n e2e now also scans the compact layout at 412 px in every language). Earlier: 2026-10-18 (P9-LF pass 2); a release task that adds keys ("New in …" on the portal) needs another pass before the tag.
2. Set the version everywhere and commit it:
   ```
   scripts/set-version.sh 3.141.0         # workspace Cargo.toml (+ members with a literal version), Cargo.lock,
                                          # tauri.conf.json x3 (+ bundle.windows.wix.version), package.json x4
   scripts/check-versions.sh              # also run by CI and by the release workflow (against the tag)
   ```
   MSI (WiX) accepts only numeric versions, so a pre-release `X.Y.Z-pre.N` gets `bundle.windows.wix.version` =
   `X.Y.Z.N` (`0.1.0-rc.1` → `0.1.0.1`); a release gets `X.Y.Z`. Windows Installer compares only the first three
   fields, so an rc and its final release upgrade each other.
   **π versions (docs/versioning.md):** `3.141.0` is a valid MSI version as is (MINOR 141 ≤ 255). WiX limits MINOR to
   255, so `wix_version` in `scripts/versions-lib.sh` maps larger minors: the first two digits after "3." stay MINOR,
   the rest becomes BUILD, PATCH becomes REV – `3.1415.0` → `3.14.15.0`, `3.14159.0` → `3.14.159.0`,
   `3.141592.0` → `3.14.1592.0` (test: `scripts/versions-lib.test.sh`).
   **MSI upgrade 3.141 → 3.1415 (decision 2026-10-23, PM):** Windows Installer compares MAJOR.MINOR.BUILD; `3.141.0`
   (old scheme, MINOR 141) is greater than `3.14.15.0` (MINOR 14), so the MSI of 3.1415 is **not** recognised as an
   upgrade. Accepted once, because the MSI is the secondary Windows installer: the NSIS `.exe` upgrades fine; MSI users
   uninstall 3.141 first (the release notes say so). From 3.1415 on the mapping is monotonic (14.15 < 14.159 < 14.1592
   as BUILD grows).
   `check-versions.sh` also asserts that the Android `versionCode` / iOS build number (major·10⁶ + minor·10³ + patch,
   `scripts/mobile/version-code.sh`; 3.1415.0 → 4415000) is greater than that of every release with a
   `docs/release-notes/` file (3.141 → 3141000).
3. Regenerate `NOTICE`: `scripts/gen-notice.sh` (needs `cargo-license`, docs/setup.md); it also writes the "Data
   sources" paragraph (docs/legal-notes.md).
4. Build the Office check pack for the owner: `scripts/office-check-pack.sh /home/bojan/rusuite-office-check` (release
   builds of the three format crates' examples, ~2 min); add the cycle's new features to its README text.
5. Update `CHANGELOG.md`: move the finished items from **Unreleased** into the version's section (user language, no
   task ids; the source is the task board in STATUS.md and `git log`), refresh **Known limitations** from ROADMAP.md and
   the QA logs in `docs/qa/`. `docs/release-notes/<public name>.md` (e.g. `3.141.md`; format of `0.1.0.md`) is the
   GitHub release text.
6. Owner checks on real Office and real machines: [testing.md › Before tagging](testing.md#before-tagging-owner-checklist).

## 2. Test run of the workflow (`workflow_dispatch`)
Do this after any change to `release.yml` and before the first tag of a version. The repository token used by the
agents cannot dispatch workflows, so the owner/PM clicks:

1. <https://github.com/refaustria/rusuite/actions/workflows/release.yml> → **Run workflow** (top right of the run list).
2. *Use workflow from*: `main` (or the branch to test). *Git ref to build*: leave empty (= that branch) or a tag/commit.
   *Release tag name for the draft release*: keep `v0.0.0-test` (the draft is thrown away afterwards).
3. **Run workflow**. The run has 19 jobs: `version strings`, 12 builds (`calc|write|show / <runner>`),
   `sign / GPG + SHA256SUMS` (skipped without the `GPG_PRIVATE_KEY` secret), `sign / signing.json` and
   `smoke / <runner>` for `ubuntu-22.04`, `windows-latest`, `macos-latest`, `macos-15-intel`. It takes ~25 minutes
   (signing and notarization add a few minutes, [signing.md](signing.md)).
4. Every `smoke / …` job must be green: its log ends with `ok   calc: --smoke start: Rusuite Calc <version> | …`
   (and write, show) and `all passed`. While `continue-on-error: true` is set on the smoke job, a failing smoke job is
   shown red but the run is still green – look at the jobs, not only at the run.
5. After the first run where all four smoke jobs passed: set `continue-on-error: false` on the `smoke` job in
   `release.yml` (commit "release: smoke job blocking"), so that a binary that cannot start blocks the release.
6. Delete the test draft: `gh release delete v0.0.0-test --yes` (the tag is not created for drafts).

## 3. Tag
```
git tag -a v3.141.0 -m "Rusuite 3.141"
git push origin v3.141.0
```
The `Release` workflow runs on the tag: `version strings` fails at once if the tag does not match the version files;
then each app (Calc, Write, Show) is built on

| Runner | Bundles |
| --- | --- |
| `ubuntu-22.04` | `.deb`, `.rpm`, `.AppImage` |
| `windows-latest` | `.msi`, NSIS `.exe` |
| `macos-latest` | Apple Silicon `.dmg` (+ `.app.tar.gz`) |
| `macos-15-intel` | Intel `.dmg` (+ `.app.tar.gz`) |

and attached to a **draft, pre-release** GitHub Release named `Rusuite <public name>` (e.g. "Rusuite 3.141";
<https://github.com/refaustria/rusuite/releases>).
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
   `.app.tar.gz`; once per release `signing.json`; with the GPG key also `SHA256SUMS`, `SHA256SUMS.asc` and a
   `<file>.asc` per Linux package) and download one installer per OS for a last start. `signing.json` must say
   `true` for every OS whose secrets are set ([signing.md](signing.md)).
2. Replace the release text with `docs/release-notes/<public name>.md` (adapt the heading for an rc). Keep **Set as a
   pre-release** ticked for alpha/rc builds; untick it for a cycle release such as 3.141.
3. **Publish release**. The SHA-256 digests of the assets then show under *Assets*.

## 5. Portal downloads page
The portal's `downloads.html` is static and generated at deploy time from the newest **published** release:
`scripts/deploy-web.sh` runs `scripts/gen-downloads.sh --out /var/www/resuite/downloads.html`, which reads
`gh release view <tag> --json …`, the asset digests (`gh api`) and the release's `signing.json` (per-OS signed state,
[signing.md](signing.md); absent = unsigned), so the page itself never contacts GitHub (ADR 0009).
After publishing, the PM redeploys from `main` (`scripts/deploy-web.sh`). `DOWNLOADS_TAG=<tag>` picks a specific release;
without `gh` or without a published release the page says "no release yet" and links to GitHub Releases (that page is
also the committed `apps/portal/downloads.html`). Preview locally:
`DOWNLOADS_TAG=v3.141.0 scripts/gen-downloads.sh --out /tmp/downloads.html` (the lead line then reads "Rusuite 3.141 for
Windows, macOS and Linux") (drafts work for the PM's token, but
their download links work only for repository members).

## 6. Mobile stores (from 3.1415, P10-M8)
The same tag also starts **`mobile-release.yml`**: signed Android App Bundles → Google Play **internal** track and
signed iOS builds → **TestFlight**, for Calc, Write and Show (artifacts `android-<app>` / `ios-<app>`, 14 days; each
upload is skipped with a notice when its secrets are missing). Its `version strings` job fails when the tag does not
match the version files, exactly like `release.yml`. Then, per app and only with the owner's go per store
(details and commands: **[docs/store/README.md](store/README.md)**; first release: the console checklists
[checklist-play.md](store/checklist-play.md) and [checklist-appstore.md](store/checklist-appstore.md)):
1. `node scripts/store/play.mjs status` – the internal track has the new version code; testers check it.
2. Listings: `play.mjs listing push --app <app>`; `asc.mjs app-info push`, `asc.mjs version ensure|push --version <public name>`.
3. App Store: `asc.mjs build attach --version <public name> --build <versionCode>`, `asc.mjs review notes …`.
4. Submit: `play.mjs upload --track production [--rollout 0.2]` (or promote in the console); `asc.mjs submit … --yes`.
5. After approval: Play rolls out (or *Publish changes* with managed publishing); App Store *Release This Version*.
A manual run (*Actions › Mobile release › Run workflow*, inputs *tag* and *track*) rebuilds and re-uploads a tag –
it needs a new version code if the previous upload went through (Play and TestFlight refuse a used one).

## Report relay URL (P8-43)
The desktop apps post "Report a problem" to the relay URL baked in at build time: `REPORT_RELAY_URL` (Vite exposes it
through the apps' `envPrefix`), default `https://rusuit.es/api/report`. Set it in the environment of the
release build to point a build at another relay (`REPORT_RELAY_URL=https://example.org/api/report pnpm --filter calc
tauri build`). The web builds always use the relative `/api/report` of the site they are served from. The relay
itself is deployed separately (`scripts/deploy-relay.sh`, docs/setup.md "Report relay").

## Signing
Signing is conditional on repository secrets: **[signing.md](signing.md)** lists them, how the PM produces them and
how a download is verified. Without them the builds are unsigned as up to 3.141, and the Downloads page shows the
Gatekeeper/SmartScreen steps (macOS 15+: *Done*, then System Settings › Privacy & Security › *Open Anyway*; macOS 14:
right-click › *Open*; Windows: *More info* › *Run anyway*). The release adds these assets beside the installers:

| Asset | When | Content |
| --- | --- | --- |
| `signing.json` | every release from 3.1415 on | per OS `signed`/`notarized`/`method`, the GPG fingerprint, `sha256sums` – read by `scripts/gen-downloads.sh` |
| `SHA256SUMS`, `SHA256SUMS.asc` | GPG key set | `sha256sum` lines for every installer of every OS, and its detached signature |
| `<file>.asc` | GPG key set | detached signature of each `.deb`, `.rpm`, `.AppImage` |

The default release text (`releaseBody`) still speaks of unsigned builds; it is replaced by the release notes anyway
(section 4) – say there which platforms are signed.

## Known risks of pre-release versions in bundles
- **RPM**: RPM versions cannot contain `-`; the bundler has to map `0.1.0-rc.1` to an RPM version/release. If the
  `ubuntu-22.04` build fails in the rpm step, the test run of section 2 shows it before tagging.
- **macOS** shows the version string as is in *About*; Apple's numeric-only rule applies to the App Store only.


Test run 2026-10-16: https://github.com/refaustria/rusuite/actions/runs/38911314761 – 12 builds + 4 smoke jobs green (RPM accepted `0.1.0-rc.1` as `0.1.0-rc.1-1`, MSI uses `0.1.0.1`); the smoke job is blocking since then.
