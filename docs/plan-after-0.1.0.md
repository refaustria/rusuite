# Plan after v0.1.0 (written 2026-10-16 for the owner's follow-up activities starting the week of 2026-10-19)

Status at v0.1.0: Phase 8 parity batches, three quality passes, cloud connectors v1 (WebDAV, desktop), AI assistant v1 (desktop), in-app "Report a problem", portal at **https://rusuit.es** (free, open source MIT, informal German). Everything below is ordered by my recommendation; each block is one or more agent tasks that I run the usual way (brief → agent → verification → merge → deploy). Owner inputs are marked **Owner**.

## Block 0 – Release and feedback loop (week 1)
- **Code signing & notarization (top priority after the owner hit macOS Gatekeeper on 2026-10-16):** Apple Developer ID certificate + notarization in release.yml (tauri-action supports `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` secrets); Windows Authenticode (OV certificate or Azure Trusted Signing) optional. **Owner**: Apple Developer Program enrolment (99 USD/year; also needed for iOS), then the secrets. Until then the Downloads page explains Gatekeeper/SmartScreen (P8-50).
- Tag `v0.1.0` once the fix batches P8-44/45/46 and the "du" sweep (P8-48) are merged and the release test run is green. Release notes: `docs/release-notes/0.1.0.md`; Downloads page regenerates at deploy.
- **Owner**: install the Windows and macOS builds once; open the Office check pack (`scripts/office-check-pack.sh`) in Excel/Word/PowerPoint; promote rusuit.es.
- Triage incoming GitHub issues from the report button twice a week into fix batches (label `from-app`). First fix release `v0.1.1` ~2 weeks after v0.1.0.
- Add "Contents: read & write" to the report token so screenshots attach (**Owner**).

## Block 1 – Mobile (Android first, then iOS) – 6–8 weeks
Per `docs/mobile-plan.md` (guardrails already honoured in the UI: pointer events, responsive ribbon, everything platform-specific behind `Backend`, no `window.open`).
1. Tauri 2 mobile shells for the three apps (Android Gradle project, iOS Xcode project), same Rust cores, file open/save via the platform document pickers (SAF on Android, UIDocumentPicker on iOS), share-sheet "Open with".
2. Touch layout: ribbon becomes a bottom toolbar + tab sheet on < 700 px, 44 px targets, long-press context menus, pinch zoom on grid/page/slide, on-screen keyboard handling (formula bar and text editor must stay visible), selection handles.
3. Per app: Calc cell selection handles + formula keyboard row; Write caret/selection handles + simplified toolbar; Show thumbnails strip + full-screen presentation with swipe.
4. Store readiness: app icons/splash, privacy labels (no data collection), signing (**Owner**: Google Play and Apple developer accounts; signing keys), TestFlight/internal testing tracks, CI jobs building APK/AAB and IPA.
Decision needed (**Owner**): Android-only first release vs both at once; whether tablets get the desktop layout above 900 px (recommended yes).

## Block 2 – Connectors round 2 – 3–4 weeks
- Generic OAuth PKCE connector with the user's own client id (Google Drive, OneDrive, Dropbox), documented setup pages; S3-compatible connector; shared connection records across the three desktop apps; CORS guide for Nextcloud/ownCloud; desktop smoke for the connector commands and the keyring.
- Decision (**Owner**): stay desktop-only (current) or revisit the web CSP later.

## Block 3 – AI assistant round 2 – 2 weeks
- Prompt caching for whole-document context; reasoning-effort choice for 5.5 models; attach a selected image (Write/Show); "explain this chart"; desktop smoke with a real key (**Owner** provides a test key once).

## Block 4 – Deferred parity (from the QA logs and ROADMAP) – rolling, 1 task per app per week
- Calc: slicers, Flash Fill, Consolidate, Auto Outline; custom table styles; structured-ref rewrite on column delete; sparklines; cell/sheet protection; German decimal input (if the locale decision changes).
- Write: linked text boxes, group shapes, templates (.dotx), Manage Styles, equations (later), hyphenation dictionary, endnotes per section, editable footnote continuations.
- Show: exact PowerPoint table styles, freeform tool, media trimming, custom shows, outline view with rich text, per-layout guides, "Reuse slides" with source theme.
- Cross-app: rotate handles with shapes, shared preset geometry in core-model, contextual spacing model, translated reader warnings everywhere.

## Block 5 – Platform and quality – continuous
- Performance budgets in CI (`scripts/perf.sh` incl. Write pagination and Show wasm load); accessibility pass (keyboard-only journeys, screen-reader labels, contrast) per app; more UI languages when wanted (catalog-only work); Safari/Firefox e2e in CI; the WebDriver desktop smoke under xvfb in CI; dependency update cadence (monthly).

## Not planned (unchanged non-goals)
Macros/VBA, Power Query, track changes, real-time co-authoring, a Rusuite cloud.

## Owner decisions summary
1. Android-only first or both platforms; tablet layout threshold.
2. Developer accounts and signing (Google Play, Apple).
3. Report token Contents permission.
4. Any new languages beyond EN/DE.
5. Whether v0.1.1 waits for the first mobile preview or ships on its own (recommended: ships on its own).
