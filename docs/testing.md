# End-to-end tests

`packages/e2e` is a Playwright suite (Chromium only, `@playwright/test` pinned in its `package.json`) that drives the three
real web builds, including the wasm cores: Calc, Write, Show and a few cross-app flows (shortcut help, crash recovery).
Specs live in `packages/e2e/tests`, helpers in `packages/e2e/support` (grid geometry for Calc's canvas, a 40-line zip reader
used to inspect downloaded xlsx/docx/pptx files, `window.print` interception). Test files come from `testdata/`.

## Running locally

```
pnpm --filter calc build:web && pnpm --filter write build:web && pnpm --filter show build:web   # once, and after app changes
pnpm e2e                                                                                         # starts packages/e2e/serve.mjs
```

`serve.mjs` serves each `apps/<app>/dist-web` under `/calc/`, `/write/`, `/show/` on `127.0.0.1:4173` (`E2E_PORT` changes it).
The first run needs a browser: `pnpm --filter e2e exec playwright install chromium`. Single spec: `pnpm e2e calc`; headed:
`pnpm e2e --headed`; failure traces: `pnpm --filter e2e exec playwright show-trace test-results/<test>/trace.zip`.

Cloud connectors (P8-36): `tests/connectors.spec.ts` starts its own in-memory WebDAV server (`support/webdav.ts`:
PROPFIND/GET/PUT/MKCOL/DELETE/MOVE, CORS for the page origin, Basic auth) on `127.0.0.1:4846` (`DAV_PORT`), runs its
tests serially and serves the app pages with the prepared CSP (`connect-src 'self' https:` plus the plain-http test
server, via `page.route`; the routed pages need Chromium's `local-network-access` permission) – except the CSP test,
which keeps the live policy and expects the "security policy" message. `CONNECTORS_SHOTS=<dir>` saves screenshots.
The Open page lists "This device" first: `openViaBackstage` clicks it before the file chooser.

## Against the live site

`BASE_URL=https://rusuit.es pnpm e2e` skips the local server. `scripts/deploy-web.sh --e2e` runs exactly that after
publishing (`E2E_BASE_URL` overrides the URL).

## Conventions

- Production builds expose no store globals, so tests use the UI only: selectors are roles/labels and the existing
  `data-testid`s (`grid`, `cell-address`, `backstage`, `editor-stage`, `slide-count`, ...). `editor-stage` also carries
  `data-guides` (the number of snap guides currently drawn).
- Calc's grid is a canvas: cells are addressed by pixel geometry (`Grid` in `support/calc.ts`), inputs are read from the formula
  bar, displayed values by copy + paste-values into a scratch cell, number formats and results by saving and unzipping.
- No fixed sleeps beyond 400 ms; wait with `expect`/`expect.poll`. Downloads are parsed in Node (`support/zip.ts`).
- Printing is asserted through a stubbed `window.print` (`interceptPrint`); the File › Print page count is read from
  `print-page-count`, and `previewPdf(page, name)` renders the preview's `srcdoc` with headless `page.pdf()` (saved to
  `PRINT_PDF_DIR`, default `test-results/print-pdfs`) and returns the PDF's page count.

## Writing stable e2e tests

CI runs the suite with 2 workers on a 2-core runner: anything that is quick on a laptop can be slow there. A test that
passes "most of the time" usually races the app (P9-Q1 found four: a lost shortcut, a rule not applied yet, a stale
menu, a wall-clock wait).

- **Wait on state, never on time.** After an action, wait for what it changes (`toHaveCount`, `toHaveAttribute`,
  `toBeEnabled`, `expect.poll`) before the next step. No `waitForTimeout`, no retries, no looser assertions.
- **Calc: `grid.waitIdle()`** (`support/calc.ts`) resolves once the grid has no `data-busy`: no request to the core
  pending, no region re-fetch queued (conditional formatting / validation results only arrive with snapshots) and no
  rule change settling. Call it after a dialog's OK (Data Validation, Conditional Formatting, ...) before you type or
  click on the result. The store itself also waits: a commit right after Data Validation OK is checked against the new
  rule (`rulesSettling`), but the test should not depend on that timing.
- **Focus after dialogs.** `Dialog` (ui-shared) gives the focus back synchronously when it closes, unless the close
  handler already put it somewhere else (Write's dialogs focus the editor at once, `focusNow`). Before a keyboard
  shortcut after a dialog, assert where the keys go: `await expect(dlg).toHaveCount(0)` and
  `await expect(editor(page)).toBeFocused()`.
- **Selections and ribbons.** A ribbon command reads the selection from the last render: wait for the visible selection
  state first (Write drawings: `.drawing-wrap.selected`, `multi-selected`; the drawing tool is disarmed when the editor
  has no `data-draw-tool`), and for a menu item use `toBeEnabled()` before clicking it, so a stale menu fails fast with a
  clear message instead of a 45 s click timeout.
- **Time-based features use the page clock.** Rehearse Timings, auto-advance and similar measure wall-clock time:
  `page.clock.install()` before loading, `page.clock.pauseAt(...)` / `runFor(ms)` while the measurement runs, then
  `resume()`. A `waitForTimeout(1200)` between key presses turns into 1.6 s on a busy runner (rounded to 2 s).
- **Reproduce flakes under load:** `--repeat-each 30 --workers 12` (or `CI=1` for the CI worker count) usually turns a
  1-in-3 live-site flake into a reliable failure; the trace in `test-results/` shows the last action and the DOM.

## Desktop shells (real windows)

`scripts/desktop-smoke.sh [--start-only] [calc|write|show ...]` runs the release binaries (`pnpm --filter <app> tauri build
--no-bundle`; `SMOKE_BIN_DIR` points elsewhere). Data/config/cache dirs are private temp dirs. Per app:

- **Start check** (every OS, P8-41): `app-<name> --smoke` opens the window; the page renders, calls `ping` and
  `dispatch` (`documentState`) over the real IPC bridge; the binary checks the reply, the native window title and that
  `ping` reports the version in `tauri.conf.json`, prints `ok Rusuite Calc 0.1.0-rc.1 | Untitled – Rusuite Calc` and
  exits 0 (`apps/*/src-tauri/src/smoke.rs`; also written to `$RUSUITE_SMOKE_OUT`). Under xvfb on Linux without a
  display. `--start-only` stops after this step: that is what the release workflow's `smoke` job runs on Linux,
  Windows and macOS (docs/release.md).
- **Close guard** (Linux, WebDriver): an edit (Calc: type + Enter on the grid; Write: Enter in the editor; Show: New
  slide) puts `•` in the native window title → a close request (`Window.close()`, which raises `CloseRequested` like the
  window manager's close button) → the "Save changes to …?" dialog → **Don't save** → the process exits.
- **Open → edit → Save → reopen** (Linux, WebDriver): the app data dir is seeded with a recent entry for a copy of a
  `testdata/` file; File › that entry opens it by path, an edit, **Ctrl+S** must rewrite the file without a dialog, the
  title shows the file name and the clean window closes without asking. A second start opens the saved file the same way
  and must show the edit: one more cell showing `7` (Calc, `findCells` through `dispatch`), one more paragraph (Write,
  `getDocument`), one more slide (Show, the status bar).

The WebDriver steps run under `xvfb-run` + `dbus-run-session`, driven by `tauri-driver` → `WebKitWebDriver` (setup:
docs/setup.md); the driver, `scripts/desktop-smoke.mjs`, speaks plain W3C WebDriver over `fetch`. Limitations: GTK's
native file dialogs cannot be driven through WebDriver, so Save As and saving an untitled document are covered by unit
tests only (the shells' `DocPath` in `apps/*/src-tauri/src/lib.rs`, the stores' save flows with a desktop-like fake
backend). WebKitWebDriver's key events reach `keydown` handlers but insert no text (no `beforeinput`), hence the edits
above. A full run takes ~30 s. The start check runs in the release workflow; the WebDriver steps are not part of CI yet.

## Before tagging (owner checklist)

What only the owner can check (real Office, Windows, macOS). Do it on the build from the `workflow_dispatch` test run
(docs/release.md, section 2) – its draft has every installer – and report each line as OK or with a screenshot.

**Office: reopen what Rusuite wrote.** `scripts/office-check-pack.sh` builds `target/office-check/rusuite-office-check-<version>.zip`
(68 files: every reference workbook and deck, the feature-rich documents 47–64, all rewritten by Rusuite's writers, plus
the decks built in code). On Windows or macOS with Microsoft 365:
- [ ] **Excel**: open each file in `excel/` – no repair dialog; values, formats, charts, PivotTables (refresh one),
  comments/notes, tables and names are there. Edit a cell, save, reopen in Rusuite Calc.
- [ ] **Word**: open each file in `word/` – no repair dialog; numbering, sections, headers/footers, footnotes, TOC,
  merged tables, floating pictures, comments as in the source. Save in Word, reopen in Rusuite Write.
- [ ] **PowerPoint**: open each file in `powerpoint/` – no repair dialog; layouts, themes, shapes, connectors, tables,
  charts, media; play `rusuite-anim_deck.pptx` (transitions and animations, push/cover directions). Save, reopen in
  Rusuite Show.
- [ ] One of your own real Office files per app: open in Rusuite (desktop), edit, Save, reopen in Office.

**Installers** (from the test draft; unsigned, so expect the warnings the downloads page describes):
- [ ] **Windows 10/11**: the `.exe` installs per user and starts from the Start menu; the `.msi` installs; uninstall
  removes the app. Open/Save/Save As with the native dialogs, print, PDF export, close with unsaved changes asks.
- [ ] **macOS Apple Silicon** and **macOS Intel**: the `.dmg` mounts, drag to Applications, right-click › Open starts it;
  the same file and print checks; the presenter view opens a second window on a second screen (Show).
- [ ] **Linux** (Ubuntu 22.04+): `.deb` via `sudo apt install ./…deb`, the `.AppImage` after `chmod +x`.
- [ ] Desktop-only features once: Settings › AI with your own key (one action), a WebDAV connection (open + save).

**Web** (<https://rusuit.es/> after the PM's deploy):
- [ ] **Chrome**, **Firefox** and **Safari** (macOS): open one reference file per app, edit, save (download), reopen;
  print preview; the language switch; File › Privacy › remove local copies. Firefox/Safari are not covered by the e2e
  suite (Chromium only).
- [ ] The portal: the Downloads page lists the release's installers with checksums and puts your OS first.

## Snapshot digests of floating-point geometry

Digests of floating-point geometry (the `geometry_equivalence` tests) must be quantised before hashing: every `f64` is
rounded to the nearest integer EMU. Trigonometric presets (`cloud`, `star5`, `cloudCallout`) give last-bit-different
results with other libm/FMA implementations, so a digest of the exact bits passes on the dev server and fails on the CI
runner.

## CI

The `frontend` job packs the three `dist-web` directories as an artifact; the `e2e` job (needs `frontend`) installs Chromium,
runs `pnpm e2e` with 2 workers and one retry, and uploads `test-results` (screenshots, traces) and the HTML report on failure.

The `frontend` job also runs `scripts/check-versions.sh` (every version string equal) and the Downloads page generator's
tests (`node --test scripts/gen-downloads.test.mjs`) and `pnpm typecheck` (`tsc --noEmit` in every package with a tsconfig,
tests and specs included). The release workflow checks the tag against the versions and
starts every built app once per OS (`smoke` job, see Desktop shells above).
