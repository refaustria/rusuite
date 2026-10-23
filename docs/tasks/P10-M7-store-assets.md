# Task P10-M7 – Store assets and listing texts (Google Play, App Store) in 24 languages

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"), then `docs/i18n.md` (tone: informal in every language; glossaries `docs/i18n-glossary/<lang>.md`), `apps/portal/locales/en.json` + `de.json` (portal wording to stay consistent with), `README.md` (feature scope, licence, privacy statements), `apps/portal/privacy.html`, `docs/mobile.md`, `docs/ui.md` ("Compact layout for phones"), `packages/e2e/playwright.config.ts` (projects `mobile`, `tablet`), `packages/e2e/tests/compact.spec.ts` (how fixtures are opened at phone size), `apps/*/src-tauri/icons/`, `docs/plan-3.1415.md` (Block M, M7), `docs/tasks/P10-M8-store-publishing.md` (the file layout the publishing scripts read – you define it, M8 consumes it; keep exactly the paths below).

Branch `p10/m7-store-assets`, worktree `/home/bojan/rusuite-wt/p10-m7-store-assets`. Model: Sonnet. e2e port 5017.

## Deliverables (file layout consumed by P10-M8)
```
docs/store/
  listing/<lang>.json          one per language (24): { "calc": {...}, "write": {...}, "show": {...} } with
                               title (≤30), shortDescription (≤80, Play), subtitle (≤30, App Store), fullDescription
                               (≤4000, Play), description (≤4000, App Store), keywords (≤100 chars comma-separated, App Store),
                               promotionalText (≤170), whatsNew (≤4000, the 3.1415 notes), privacyAnswer (one line)
  release-notes/<lang>.txt     Play release notes (≤500 chars) for 3.1415
  review-notes.txt             App Store review notes (en): what the app does, no account needed, no data collected, how to open a sample file
  screenshots/<app>/phone/*.png        1080×2340 (Play phone, also fits App Store 6.5" after scaling → generate 1284×2778 variants)
  screenshots/<app>/phone-67/*.png     1290×2796 (App Store iPhone 6.7")
  screenshots/<app>/tablet-7/*.png     1200×1920 (Play 7")
  screenshots/<app>/tablet-10/*.png    2048×2732 (Play 10" + App Store iPad Pro 12.9")
  graphics/<app>/icon-512.png          Play icon 512×512 (no alpha), from src-tauri/icons/icon.png
  graphics/<app>/feature-1024x500.png  Play feature graphic
  graphics/<app>/appstore-1024.png     App Store icon 1024×1024 (no alpha, no rounded corners)
  SCREENSHOTS.md                       how they are generated (the script below) and which fixture/state each shows
```
Screenshots: generated with Playwright (`scripts/store/screenshots.mjs`, run against a local web build of the three apps served by `packages/e2e/serve.mjs` on port 5017, viewports with `deviceScaleFactor` to hit the exact pixel sizes, compact layout forced via `__RUSUITE_FORCE_COMPACT__` at phone sizes, the desktop ribbon at tablet-10), 4–6 per app per form factor, in **en and de** (sub-folders `en/`, `de/`; the other languages reuse en – M8 uploads en for them): a real document open (use the existing e2e fixtures: a workbook with a chart, a formatted report, a slide deck), one editing moment (selected cells with handles if M3 is merged, else a selected range; a dialog as a sheet; the slide thumbnail strip), one "Open with"/share moment is not needed. Add an optional caption bar (24 px, app colour, 6–8 words, translated) at the top of each screenshot – Play and App Store allow it. Graphics with `sharp` **only if already in the lockfile**; otherwise generate with the browser (Playwright screenshot of an HTML template) so no dependency is added.

## Texts
- Written first in **en** and **de** (informal "du"), then translated into the other 22 languages following the glossaries (same product names "Rusuite Calc/Write/Show" everywhere, untranslated; "Rusuite" never declined). Store-specific facts: free, open source (MIT), works offline, no account, no ads, no tracking, documents stay on the device (ADR 0009), opens and saves .xlsx/.docx/.pptx (Excel/Word/PowerPoint files), 24 languages; "New in 3.1415": signed desktop apps, phone and tablet apps, touch editing, PDF export (only list what docs/plan-3.1415.md delivers; mark the PDF line to be removed if M6 is not merged at release – the PM edits). Keywords (App Store): spreadsheet, excel, xlsx, document, word, docx, presentation, pptx, office, offline, open source – translated where sensible, ≤ 100 chars.
- A `scripts/store/check-listing.mjs` that validates lengths, required fields, placeholder leftovers and that every language file has all three apps (run in your verification; M8 may call it too).

## In scope
`docs/store/**`, `scripts/store/screenshots.mjs`, `scripts/store/check-listing.mjs` (+ tests), `scripts/i18n-check.mjs` only if you need to exclude `docs/store` from a scan (unlikely). No app code.

## Verification you must run
`node --test scripts/store/check-listing.test.mjs`; `node scripts/store/check-listing.mjs` passes for all 24 files; the screenshot script runs end to end here and writes every listed size (verify dimensions with `identify` or a Node PNG header read; list the counts per folder in the report); `pnpm i18n:check` unchanged; `scripts/privacy-check.sh`; total size of `docs/store/screenshots` ≤ 60 MB (optimise PNGs with `optipng`/`pngquant` if available, else Playwright's `quality` for JPEG is not allowed by the stores for screenshots – keep PNG).

## Report (≤ 40 lines): per-language status (translated by you vs. copied from en), screenshot inventory, store limits you hit, ideas.
