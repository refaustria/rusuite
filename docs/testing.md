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

`BASE_URL=https://resuite.inceptum.at pnpm e2e` skips the local server. `scripts/deploy-web.sh --e2e` runs exactly that after
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

## Desktop shells (real windows)

`scripts/desktop-smoke.sh [calc|write|show ...]` runs the release binaries (`pnpm --filter <app> tauri build --no-bundle`)
under `xvfb-run` + `dbus-run-session`, driven by `tauri-driver` → `WebKitWebDriver` (setup: docs/setup.md). The driver,
`scripts/desktop-smoke.mjs`, speaks plain W3C WebDriver over `fetch`; data/config/cache dirs are private temp dirs. Per app:

- **Close guard**: an edit (Calc: type + Enter on the grid; Write: Enter in the editor; Show: New slide) puts `•` in the native
  window title → a close request (`Window.close()`, which raises `CloseRequested` like the window manager's close button) →
  the "Save changes to …?" dialog → **Don't save** → the process exits.
- **Save to the remembered file**: the app data dir is seeded with a recent entry for a copy of a `testdata/` file; File › that
  entry opens it by path, an edit, **Ctrl+S** must rewrite the file without a dialog, the title shows the file name and the
  clean window closes without asking.

Limitations: GTK's native file dialogs cannot be driven through WebDriver, so Save As and saving an untitled document are
covered by unit tests only (the shells' `DocPath` in `apps/*/src-tauri/src/lib.rs`, the stores' save flows with a desktop-like
fake backend). WebKitWebDriver's key events reach `keydown` handlers but insert no text (no `beforeinput`), hence the edits
above. A run takes ~10 s; it is not part of CI (no display server there).

## CI

The `frontend` job packs the three `dist-web` directories as an artifact; the `e2e` job (needs `frontend`) installs Chromium,
runs `pnpm e2e` with 2 workers and one retry, and uploads `test-results` (screenshots, traces) and the HTML report on failure.
