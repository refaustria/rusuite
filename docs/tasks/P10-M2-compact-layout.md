# Task P10-M2 – Compact touch layout under 900 px (phones; web and mobile shells)

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"), then `docs/mobile-plan.md` (guardrails, UI table), `docs/ui.md`, `packages/ui-shared/src/ribbon/*` (Ribbon, groups collapse logic, Backstage, controls, gallery), `Dialog.tsx`, `ContextMenu.tsx`, `Popover.tsx`, `Dropdown.tsx`, `styles.css`, the three apps' `App.tsx` and their ribbon definitions (`apps/*/src/ui/` or wherever the tabs are declared), `packages/e2e/playwright.config.ts` + `tests/i18n.spec.ts` (viewport/clipping scan pattern), `docs/plan-3.1415.md` (Block M).

Branch `p10/m2-compact-layout`, worktree `/home/bojan/rusuite-wt/p10-m2-compact-layout`. Model: Opus. e2e port 5012.

## Goal
Below **900 px** viewport width every app switches to a compact, touch-first layout; at ≥ 900 px nothing changes (tablets in landscape and the desktop keep the ribbon). The compact layout is shared in ui-shared and driven by the apps' existing ribbon definitions (tabs → groups → controls), so no command is declared twice. It applies to the web build on phones and to the mobile shells (P10-M1, in parallel – do not depend on its code; detect the breakpoint with `matchMedia`, and read an optional `backend.capabilities?.print === false` to hide Print if that field exists at merge time, otherwise ignore).

## Design (decided)
- **Top bar** (44 px): File/backstage button (icon), document title (ellipsis, tap = rename where the app supports it, else nothing), Undo, Redo, overflow "⋯" (Settings, Help/shortcuts, Report a problem, language). Status bar items of the apps move into the overflow or a one-line footer, app's choice, but nothing may be lost that the desktop shows.
- **Bottom command bar**: row 1 = the ribbon's **tabs** as horizontally scrollable chips (active one highlighted); row 2 = the active tab's **controls**, flattened across groups, as a horizontally scrolling strip of 44×44 icon buttons with 10 px labels under them; groups separated by a thin divider with the group name as a tiny caption; galleries and split buttons open **bottom sheets**; toggles show their state; disabled controls dimmed. The strip remembers the scroll position per tab. The bar sits above the on-screen keyboard: use `visualViewport` (`resize`/`scroll`) to pin it, and keep the formula bar (Calc) / selection toolbar (Write) / slide (Show) visible when the keyboard opens.
- **Dialogs** → full-width bottom sheets with a drag handle and a sticky action row; **context menus** → bottom sheets (long-press = right-click already maps through pointer events – verify); **popovers/dropdowns** → bottom sheets. Focus management/ARIA of `Dialog` unchanged (role dialog, focus return – the P9-Q1 fixes must keep passing).
- **Safe areas**: `env(safe-area-inset-*)`, `viewport-fit=cover` in the three `index.html`; `touch-action` set so pinch inside the document area is not swallowed by the browser (the apps' own pinch handling comes with M3–M5).
- **Hit targets** ≥ 44 px, text ≥ 13 px; no hover-only affordances (tooltips become long-press hints or nothing); the Backstage becomes a full-screen view with a back button; the recent-files list and Open/Save keep working (Open = `backend.openFile`, Save/Save As as today).
- Breakpoint constant `COMPACT_MAX_WIDTH = 899` exported from ui-shared; a `useCompact()` hook; e2e/test override `window.__RUSUITE_FORCE_COMPACT__ = true|false` (`addInitScript`), like the existing `__RUSUITE_PLATFORM__`.
- i18n: new keys in `en.json`/`de.json` of ui-shared only (informal German "du"); other catalogs via the pending policy.

## In scope
`packages/ui-shared/src/**` (new `compact/` folder: `TopBar.tsx`, `CommandBar.tsx`, `BottomSheet.tsx`, `useCompact.ts`, `visualViewport.ts`, styles), `packages/ui-shared/src/styles.css`, `Dialog.tsx`/`ContextMenu.tsx`/`Popover.tsx`/`Dropdown.tsx` (render as sheets when compact), the three apps' `App.tsx`/`index.html`/`styles.css` and their ribbon/status-bar wiring (no new app commands), `packages/e2e/playwright.config.ts` (new project `mobile`: chromium with `devices["Pixel 7"]` incl. `hasTouch`, `isMobile`; and a `tablet` check at 1024×768 proving the ribbon is still there), new `packages/e2e/tests/compact.spec.ts`, `docs/ui.md` (compact layout section), `docs/mobile-plan.md` (status).

## Acceptance (e2e `compact.spec.ts`, mobile project, per app)
1. At 412×915 the ribbon is gone, top bar + bottom command bar present; every ribbon tab of the app appears as a chip; tapping a chip shows that tab's controls; every control of the desktop ribbon is reachable (walk the ribbon definition and assert a button per control id – the same source of truth as the ribbon).
2. Open a document via the file chooser (existing fixtures), make an edit through the command bar (Calc: bold a cell; Write: bold a word; Show: insert a rectangle), Save → download happens; the title shows the document name.
3. A dialog (Calc: Number format or Data validation; Write: Paragraph; Show: Transitions or Slide size) opens as a bottom sheet, is operable, closes with the handle/Escape and returns focus.
4. Context menu via long-press (Playwright `touchscreen` tap + hold, or the pointer events the suite can emit) opens as a sheet with the same items as the desktop menu.
5. No horizontal page scroll; the clipping scan from `i18n.spec.ts` (adapted) passes at 412 px for en and de; all hit targets in the bars ≥ 44 px (assert bounding boxes).
6. Keyboard: focus the Calc formula bar / Write editor with a simulated `visualViewport` height change (expose a test hook or dispatch the event) → the command bar's bottom equals the visual viewport bottom.
7. Tablet project at 1024×768: the desktop ribbon renders (regression guard), and the existing desktop e2e suites (`pnpm e2e` for the three apps on port 5012) stay green.

## Verification you must run
`pnpm typecheck`; `pnpm test` (unit tests for `useCompact`, the flattening of the ribbon definition, BottomSheet focus handling); `pnpm i18n:check`; `scripts/privacy-check.sh`; `cargo fmt --all --check` (no Rust expected); web builds for the three apps; full e2e (existing projects + the new `mobile`/`tablet` projects) on port 5012 against the local build; screenshots `shots/P10-M2-<app>-<view>.png` at 412×915 for the report (en + de, one dialog, one sheet).

## Report (≤ 50 lines)
What changed per app, what is hidden on compact (list every command, must be none except Print behind the capability), known rough edges for M3–M5, ideas.
