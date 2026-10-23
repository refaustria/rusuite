# Mobile and tablet (Android, iOS) – assessment and plan

- Status: **in progress – cycle 3.1415** ([plan-3.1415.md](plan-3.1415.md), Block M). Done: **P10-M1** mobile shells, mobile
  `Backend` and mobile CI ([mobile.md](mobile.md)); **P10-M2** compact layout under 900 px (top bar, bottom command bar from
  the ribbon definitions, bottom sheets, 44 px targets, soft-keyboard handling via `visualViewport`, safe areas, long-press
  context menus; see [ui.md › Compact layout](ui.md#compact-layout-for-phones-p10-m2)); **P10-M3** Calc touch editing
  (handles, pinch, touch fill handle, formula keys with Ref mode, compact formula bar / sheet strip / Sum chip; see
  [ui.md › Calc with touch](ui.md#calc-with-touch-p10-m3)); **P10-M4** Write touch editing (fit-width page, long-press
  selection with floating bar and handles, picture/table handles; see [ui.md › Write touch](ui.md#write-touch-p10-m4));
  **P10-M5** Show touch editing and presenting (thumbnail strip, notes and Timing sheets, tap/drag/pinch/twist with 44 px
  handles, canvas pinch zoom and pan, swipe/tap/long-press slide show in the same window, presenter view only where a
  second window can open; see [ui.md › Show with touch](ui.md#show-with-touch-p10-m5)). Next: PDF export (M6),
  PDF for mobile (M6), store assets and publishing (M7–M9). *Was: considered, not scheduled (owner, 2026-10-15).*
- **P10-M4 (Write touch): done** – fit-width page with pinch and double tap, long-press word selection with selection
  handles and a floating format bar, 44 px picture handles, column border strips and table gutters, the caret kept above
  the keyboard, sheets and the find bar; the same touch handling on tablets with the ribbon
  ([ui.md › Write touch](ui.md#write-touch-p10-m4)).
- Owner of this document: PM.

## What we already have that carries over
- **Tauri 2 supports Android and iOS** with the same `src-tauri` crates (`tauri android init` / `tauri ios init` add the platform projects). Our Rust cores (`*-core`, models, formats, engine) are platform-neutral and already compile for wasm32, so they will compile for `aarch64-linux-android` and `aarch64-apple-ios` as well.
- The frontend already runs through the `Backend` abstraction (ADR 0005): file open/save, storage, printing and the dispatcher are behind one interface, so mobile needs a third implementation only where the Tauri mobile APIs differ (document picker instead of a file dialog, share sheet instead of print).
- i18n (P7-11), autosave/recovery, unsaved-changes safety and the e2e suite are reusable as they are.

## What mobile needs (estimate for one developer or an agent team; after v0.1.0)
| Area | Work | Rough size |
|---|---|---|
| Build & distribution | Android SDK/NDK + Java in CI (ubuntu), Xcode on `macos-latest` for iOS; signing keys, Play Console and App Store Connect accounts, TestFlight; app ids per app (`dev.rusuite.calc` …) | 1–2 weeks incl. store setup; accounts are the owner's |
| File access | Android Storage Access Framework / iOS document picker via `tauri-plugin-dialog` mobile support or `tauri-plugin-fs` scoped paths; "Open with" intents / document types registration for .xlsx/.docx/.pptx; share sheet for Save a copy and PDF | 1–2 weeks |
| UI: phone + tablet layouts | A compact command bar replacing the ribbon under ~900 px (the ribbon groups already map to actions; keep the backstage), bottom sheets for dialogs, larger hit targets, no hover-only affordances | 2–3 weeks |
| Touch editing | Calc: touch selection handles, pinch zoom, fill handle drag, on-screen formula keyboard row (`= + - * / ( ) : ;`); Write: Tiptap works with touch, but the page view and image/table handles need touch sizes; Show: Konva touch transforms (pinch rotate/scale), presenter view on a second screen via AirPlay/Chromecast is out of scope initially | 3–4 weeks |
| Printing / PDF | No `window.print()` on mobile webviews: render the existing print pages to PDF with the webview's own renderer (P10-M6, guardrail 7; *was*: in Rust) and hand it to the picker, print service or share sheet | 1–2 weeks |
| Performance & memory | Native Rust (not wasm) on mobile is faster, but memory limits are tighter (iOS ~1–1.5 GB): keep documents sparse (they are), lazy media (ROADMAP), avoid full-document JSON for Write on load (ADR 0007 §6 revisit) | 1 week + ongoing |
| Testing | Android emulator in CI (headless), iOS simulator on macOS runners; Playwright-style flows via WebDriver on the emulator (tauri-driver has no mobile support yet) | 1–2 weeks |
Total: roughly 10–16 weeks of focused work for all three apps, less if phones are deferred and tablets come first (tablets keep the ribbon and most desktop interactions).

## Guardrails to apply from now on (cheap, keeps the door open)
1. Pointer events, not mouse events, in new UI; no hover-only controls; hit targets ≥ 32 px in toolbars and handles.
2. Keep the ribbon responsive: finish the "groups collapse on narrow windows" item in ROADMAP; never hard-code ≥ 1280 px layouts.
3. Everything platform-specific stays behind `Backend` (no direct `@tauri-apps/api` imports in app code; already enforced by convention).
4. Do not depend on `window.open` for core features (the presenter view has a single-window fallback – keep it).
5. Keep the app crates free of desktop-only Rust dependencies outside `src-tauri`; `print_webview` and native dialogs are desktop-only commands and must degrade gracefully.
6. Keep the generated icon sets: `tauri icon` already produces Android/iOS icons – **done (P10-M1)**: the Android mipmaps live in
   `gen/android/app/src/main/res`, the iOS set in `src-tauri/icons/ios` and the Xcode asset catalog; nothing deletes them.
7. PDF: the webview's own PDF renderer (P10-M6 decision, supersedes "PDF in Rust"): the print pages are HTML, and the
   platform renderers (Android `createPrintDocumentAdapter`, iOS `UIPrintPageRenderer`, WebKitGTK print-to-file) give the
   highest fidelity with real text. A Rust PDF writer stays a ROADMAP idea.

## Open questions for the owner (when scheduling)
- Phones and tablets, or tablets first? (Tablets are much cheaper.)
- Which app first (Show for presenting from a tablet is the most natural mobile case; Calc the hardest for touch)?
- Store publishing accounts and signing certificates (Apple Developer Program, Google Play) – the owner must provide these.
