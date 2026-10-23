# Store screenshots and graphics

Generated, not drawn: `scripts/store/screenshots.mjs` drives the local web builds of Calc, Write and Show with
Playwright (the same `@playwright/test` as `packages/e2e`) and writes every file below. Re-run it after UI changes
(for example when P10-M3/M4/M5 touch editing lands) and commit the result.

```bash
for a in calc write show; do pnpm --filter $a build:web; done
E2E_PORT=5017 node packages/e2e/serve.mjs &            # serves apps/*/dist-web under /calc/, /write/, /show/
node scripts/store/screenshots.mjs all                 # shots + graphics; or: shots | graphics
#   --apps calc,write   --forms phone,tablet-10   --langs en,de   --base http://127.0.0.1:5017   --out docs/store
kill %1; rm -rf apps/*/dist-web                        # the builds are git-ignored
node --test scripts/store/png.test.mjs                 # the PNG helper (alpha stripping)
```

No dependency is added: graphics come from an HTML template rendered in the browser, and `scripts/store/png.mjs`
re-encodes every PNG as opaque RGB (the stores reject alpha channels) with adaptive row filters.

## Folders and sizes (`docs/store/screenshots/<app>/<form>/<lang>/<nn>-<name>.png`)

| Form | Pixels | CSS viewport × scale | Store use | Layout |
|---|---|---|---|---|
| `phone` | 1080 × 2340 | 360 × 780 @3 | Google Play phone | compact (forced with `__RUSUITE_FORCE_COMPACT__`) |
| `phone-65` | 1284 × 2778 | 428 × 926 @3 | App Store iPhone 6.5" (`IPHONE_65`) | compact |
| `phone-67` | 1290 × 2796 | 430 × 932 @3 | App Store iPhone 6.7" (`IPHONE_67`) | compact |
| `tablet-7` | 1200 × 1920 | 600 × 960 @2 | Google Play 7" tablet | compact |
| `tablet-10` | 2048 × 2732 | 1024 × 1366 @2 | Google Play 10" tablet, App Store iPad Pro 12.9" | desktop ribbon (≥ 900 px) |

`<lang>` is `en` or `de`; the other 22 languages upload the `en` set. Each image has a 24 px caption bar in the app
colour (Calc `#1E7A46`, Write `#1F4E9A`, Show `#C2410C`) above the app, 5–7 words, in the language of the folder.
Every shot starts from a fresh browser context (locale `en-US` / `de-DE`, touch on for the compact forms) and opens
the fixture through File → Open.

## What each shot shows

| App | # | Name | Fixture | State |
|---|---|---|---|---|
| Calc | 01 | `chart` | `testdata/xlsx/provisional-charts-c6.xlsx` | chart sheet "Chart1" (pie chart of the regions) |
| | 02 | `select` | `provisional-chart-combo.xlsx` | range A1:C7 selected, the chart next to it |
| | 03 | `insert` | same | A1:C7 selected, Insert tab |
| | 04 | `formulas` | same | B2:B7 selected, Formulas tab |
| | 05 | `dialog` | same | "Create PivotTable" as a bottom sheet |
| Write | 01 | `page` | `testdata/docx/provisional-47-report.docx` | the report in page view (fit-width on phones and the 7" tablet as the app opens it, 100 % on the 10") |
| | 02 | `format` | same | a paragraph selected and set bold (Home tab) |
| | 03 | `styles` | same | the Styles pane (compact) / the styles gallery (ribbon) |
| | 04 | `insert` | same | heading selected, Insert tab |
| | 05 | `layout` | same | Layout tab |
| Show | 01 | `slides` | `testdata/pptx/provisional-25-pitch-deck.pptx` | slide 4 selected, thumbnail strip |
| | 02 | `sorter` | same | slide sorter view |
| | 03 | `insert` | same | slide 3, Insert tab |
| | 04 | `transitions` | same | slide 5, Transitions tab |
| | 05 | `reading` | same | reading view of slide 2 |

3 apps × 5 forms × 2 languages × 5 shots = 150 PNGs, about 15 MB.

Refreshed after the touch tasks (P10-M2…M5, P10-X1): Write's page is fit-width, Calc shows selection handles and the formula key
row, Show the thumbnail strip with the compact Home tab.

## Graphics (`docs/store/graphics/<app>/`)

| File | Size | Use |
|---|---|---|
| `icon-512.png` | 512 × 512, no alpha | Play icon: `src-tauri/icons/icon-fullbleed.png` (the logo tile without rounded corners, RGB) scaled down; Google masks it |
| `feature-1024x500.png` | 1024 × 500, no alpha | Play feature graphic (English text, app colour gradient, icon) |
| `appstore-1024.png` | 1024 × 1024, no alpha, square | App Store icon: `src-tauri/icons/icon-fullbleed.png` as is (full-bleed square without baked-in corners; Apple applies its own mask) |
