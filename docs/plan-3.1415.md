# Plan 3.1415 – signed desktop apps, mobile apps in the stores (owner direction 2026-10-22)

**Owner direction (2026-10-22):** "Finish what we started. Sign the apps, create mobile apps and upload those into
Play Store and App Store Connect. Register the apps and fill out all that is necessary for submit." and "Also sign
macOS, Windows and Linux apps". Credentials: the Apple team (`PM7LTV7M72`), an iOS distribution certificate, a Play
service account and an Android upload keystore exist from the gitref project (home folder). Version at the end of
the cycle: **3.1415** (semver `3.1415.0`, tag `v3.1415.0`, [versioning.md](versioning.md)); installers and store
builds only at the end of the cycle, the web at rusuit.es is deployed from `main` after every verified merge.

Working mode unchanged (STATUS.md): PM briefs → agent in a worktree → PM verifies → `--no-ff` merge → deploy. Max 3
agents in parallel. Task ids `P10-*`; e2e ports `50nn` (see docs/tasks/COMMON.md).

## Block S – Signing of the desktop builds (macOS, Windows, Linux)
| Task | Content | Model |
|---|---|---|
| **P10-S1** | `release.yml` signs when the secrets exist, unsigned otherwise: macOS Developer ID + notarization (tauri-action `APPLE_*` env), Windows Authenticode (PFX via `certificateThumbprint`, or Azure Trusted Signing via `bundle.windows.signCommand`), Linux GPG (detached `.asc` per bundle + signed `SHA256SUMS`), a `signing.json` release asset the Downloads page reads (per-OS "signed/notarized" or the Gatekeeper/SmartScreen steps), `scripts/signing/asc.mjs` (App Store Connect API: list/create certificates from a CSR, register bundle ids, create profiles), docs | Opus |
| **P10-S2** (PM, no code) | Signing material in `~/rusuite-signing/` (never in the repo): GPG release key, Android upload keystore, CSR + Developer ID Application certificate, repository secrets via `gh secret set`. **Owner inputs:** the App Store Connect API key (`.p8`, key id, issuer id – only stored as a GitHub secret of gitref-v2 so far), a Windows code-signing certificate (OV/EV PFX or Azure Trusted Signing account – none exists yet) | – |

## Block M – Mobile apps (Android + iOS, all three apps)
Per [mobile-plan.md](mobile-plan.md). Decisions taken by the PM where the owner has not decided (flagged in STATUS):
both platforms at once; tablets ≥ 900 px keep the desktop ribbon; phones get the compact layout; the web build gets
the same compact layout on phones. Connectors and the AI assistant stay desktop-only (owner rule), so the store
privacy declarations are "no data collected".

| Task | Content | Model |
|---|---|---|
| **P10-M1** | Tauri 2 mobile shells for Calc/Write/Show (`tauri android init`, `tauri ios init`, generated projects committed), ids `dev.rusuite.<app>`, mobile capabilities, the mobile `Backend` (document picker, write-back to the opened document, export via the system picker/share sheet, "Open with" for .xlsx/.docx/.pptx), icons from `tauri icon`, `mobile.yml` CI (Android AAB/APK on ubuntu, iOS simulator build + signed IPA on macOS when secrets exist), signing hooks (keystore/`key.properties`, iOS certificate + profiles from secrets) | Opus |
| **P10-M2** | Compact layout in ui-shared under 900 px: top bar + bottom command bar replacing the ribbon, bottom-sheet dialogs and menus, 44 px targets, soft-keyboard handling, safe areas; Playwright "mobile" project (phone + tablet emulation) | Opus |
| **P10-M3** | Calc touch editing: selection handles, pinch zoom, fill handle, formula keyboard row | Opus |
| **P10-M4** | Write touch editing: caret/selection handles, page view at phone width, image/table handles | Opus |
| **P10-M5** | Show touch editing: thumbnail strip, pinch/rotate transforms, full-screen presentation with swipe | Opus |
| **P10-M6** | PDF generation in Rust (print pages → PDF → share sheet) so mobile has Print/"Save as PDF"; desktop gets "Export PDF" without the print dialog | Opus |
| **P10-M7** | Store assets: adaptive icons, feature graphic, screenshots generated with Playwright (phone + tablet sizes for Play and App Store), listing texts (title, short/full description, keywords, release notes) in en/de + the 22 other languages from the glossaries, privacy declarations text, `docs/store/` | Sonnet |
| **P10-M8** | Store publishing: `scripts/store/play.mjs` (Android Publisher API: edit → upload AAB → internal track → listings/images → commit), `scripts/store/asc.mjs` extension (app metadata, localizations, screenshots, build attach, submit), `mobile-release.yml` on tags (signed AAB + IPA → Play internal track + TestFlight) | Opus |
| **P10-M9** (PM/owner, UI only) | Create the three apps in Play Console and App Store Connect, grant the service account/API key access, content questionnaires (data safety, content rating, target audience, app privacy, age rating), review notes, submit. Done through the owner's browser (Claude in Chrome) or by the owner with the checklists in `docs/store/` | – |

## Block R – Release 3.1415
| Task | Content | Model |
|---|---|---|
| **P10-R1** | `wix_version` mapping for MINOR > 255 (`3.1415.0` → `3.14.15.0`, documented; the MSI does not upgrade 3.141), `set-version.sh 3.1415.0`, release notes/CHANGELOG/NOTICE, Office check pack, portal "New in 3.1415", release.yml body without the unsigned note where signed | Sonnet |
| PM | Tag `v3.1415.0`, release run, publish, deploy web, `mobile-release.yml`, store submissions (with the owner's explicit go per store) | – |

## Order
S1 ∥ M1 ∥ M2 → M3 ∥ M4 ∥ M5 → M6 ∥ M7 ∥ M8 → M9 (needs the owner's browser or the owner) → R1 → release + store
submission.

## Owner inputs needed (tracked in STATUS.md)
1. App Store Connect API key (`.p8` file + key id + issuer id) – needed for notarization, iOS signing in CI, bundle
   ids/profiles and the store upload. The gitref key exists only as a GitHub secret; either copy the `.p8` to
   `~/rusuite-signing/` or create a second key (App Store Connect → Users and Access → Integrations → App Store Connect
   API, role Admin).
2. Windows code signing: buy an OV/EV certificate (PFX or cloud HSM) or set up Azure Trusted Signing; until then the
   Windows builds stay unsigned and the Downloads page says so.
3. Store registration (P10-M9) is browser-only: connect Chrome (Claude in Chrome extension) logged into Play Console
   and App Store Connect, or follow `docs/store/checklist-*.md` yourself.
4. Decisions assumed: both platforms at once; tablets ≥ 900 px get the desktop layout; free apps, no in-app purchases,
   age rating "Everyone"/4+, category Productivity/Business.

## Closing status (P10-R1, 2026-10-23)
| Task | Result | Open points (carried into the release notes) |
|---|---|---|
| P10-S1 | merged: signing workflow, every path off without secrets; `signing.json` read by the Downloads page | Windows signing needs the Azure Trusted Signing account (or a PFX); macOS notarization needs the App Store Connect API key |
| P10-S2 (PM) | material in `~/rusuite-signing/` (Android keystore, GPG key, Developer ID CSR) | public GPG key to `keys/rusuite-release-key.asc` before the deploy |
| P10-M1 | merged: Android/iOS shells, mobile Backend, `mobile.yml` | nothing has run on a device or emulator |
| P10-M2 | merged: compact layout below 900 px, mobile/tablet e2e projects | – |
| P10-M3 / M4 / M5 | merged: Calc, Write, Show touch editing | Write fit-width is small on a phone; Show pinch only in Fit mode; no presenter second window |
| P10-M6 | merged: PDF export/print/share on mobile, Linux desktop without dialog, Report a problem hidden on mobile | Windows/macOS desktop PDF still use the print dialog |
| P10-M7 | merged: listings in 24 languages, release notes, review notes, screenshots, graphics | native review wanted for mt/ga/et/lv |
| P10-M8 | merged: `play.mjs`, `asc.mjs`, `mobile-release.yml` | Play takes 22/24 languages (no ga, mt), App Store 18/24 (also no bg, et, lt, lv) |
| P10-M9 (PM/owner) | console registration, questionnaires, submission | store links into `docs/store/links.json` after approval |
| P10-X1 / X2 / LF | merged: polish, touch e2e stability, 22 languages strict | native checks wanted: mt, ga, et, lv, hu/el wording |
| P10-R1 | versions 3.1415.0 (MSI 3.14.15.0), notes, CHANGELOG, NOTICE (+ Android/iOS section), portal and Downloads (store buttons), check pack | PM steps: docs/release.md "Release 3.1415" |
