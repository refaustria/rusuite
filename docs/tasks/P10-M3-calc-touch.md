# Task P10-M3 – Calc touch editing (phones and tablets)

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"), then `docs/ui.md` ("Compact layout for phones (P10-M2)"), `docs/mobile.md`, `docs/mobile-plan.md`, `packages/ui-shared/src/compact/*` (`useCompact`, `BottomSheet`, `longPress`, `visualViewport`), `apps/calc/src/grid/*` (canvas grid, selection, fill handle, scrolling, `focusGrid`), `apps/calc/src/FormulaBar.tsx`, `apps/calc/src/formula/*` (point mode, reference insertion), `packages/e2e/tests/compact.spec.ts` + `playwright.config.ts` (projects `mobile`, `tablet`), the P10-M2 report notes in STATUS.md (rough edges: `focusGrid()` pops the soft keyboard; colour grids < 44 px).

Branch `p10/m3-calc-touch`, worktree `/home/bojan/rusuite-wt/p10-m3-calc-touch`. Model: Opus. e2e port 5013.

## Goal
Calc is usable with fingers: selecting, moving, editing cells and writing formulas on a phone (412 px, compact layout) and on a tablet with touch (1024 px, ribbon). Desktop mouse behaviour is unchanged.

## Items (one commit each)
1. **Touch selection.** Tap selects a cell; a second tap on the selected cell starts editing; long-press opens the context menu (already via `longPress` – verify on the grid); **selection handles**: two round 24 px handles (44 px hit area) at the top-left and bottom-right corners of the active range on touch devices (`pointerType === "touch"` seen at least once, or `navigator.maxTouchPoints > 0` and compact) – dragging a handle extends the range cell by cell with auto-scroll at the edges; a drag that starts inside the selection but not on a handle **scrolls** the grid (pan), it does not select (Excel mobile behaviour); row/column header taps select the row/column, drag on headers extends. Pinch-zoom (two pointers) scales the grid zoom between 50 % and 200 % (reuse the existing zoom state; `touch-action: none` on the canvas while pinching, `pan-x pan-y` otherwise); double-tap on a column border autofits like a double-click.
2. **Fill handle on touch.** The fill handle gets a 44 px hit area on touch; dragging it fills as with the mouse; a tap on the handle shows a small sheet "Fill down / Fill right / Fill series / Copy cells" acting on the selection as the next range would.
3. **Formula keyboard row.** When a cell editor or the formula bar has focus on a compact layout, a row of 44 px keys appears above the command bar (pinned with `visualViewport` like the bar): `= + - * / ( ) : ; , $ %` and `fx` (opens the existing function autocomplete/insert dialog as a sheet), `↵` (commit), `✕` (cancel), plus **Ref** mode toggle: in Ref mode, tapping or dragging cells inserts/replaces the reference at the caret (reuse the point-mode logic), the handles extend the referenced range, and the key row shows `⇤ ⇥` to move the caret by one token. The soft keyboard is not forced open by `focusGrid()` after a command on touch devices (keep focus on a non-editable element; the editor focuses only on explicit double-tap/typing).
4. **Compact Calc chrome.** The formula bar on compact: one line with the name box as a tap-to-edit chip and an expand button for multi-line formulas; the sheet tabs become a scrollable strip above the command bar with "+" and a long-press menu (rename, delete, move, colour → sheets); the status bar's Sum/Average/Count show in a tappable chip (tap cycles). Colour grids and the table-size picker in sheets get ≥ 40 px cells on compact (shared ui-shared control – touch only the Calc usages or the shared control if trivial and safe for Write/Show; say which).
5. **Tablet with touch (≥ 900 px, ribbon):** handles, long-press and pinch work there too (no key row; the ribbon stays).

## In scope
`apps/calc/src/**` (grid, formula bar, sheets strip, status chips, styles), `packages/ui-shared/src/compact/**` only for the formula-key-row container if it must be shared (prefer app-local), `packages/ui-shared/src/styles.css` only for the colour-grid cell size on compact, `packages/e2e/tests/compact.spec.ts` (Calc part) or a new `calc-touch.spec.ts` in the `mobile` and `tablet` projects, `docs/ui.md` (Calc touch section), `docs/mobile-plan.md` status. New i18n keys en/de only.

## Acceptance (e2e, `mobile` project 412×915 unless noted; use Playwright `touchscreen` + `dispatchEvent` pointer events with `pointerType: "touch"`)
1. Tap B2 → selected; drag the bottom-right handle to D5 → range B2:D5 (assert via the name box / state); drag inside the selection → grid scrolled, selection unchanged; long-press C3 → context sheet with the desktop items.
2. Pinch (two synthetic pointers) → zoom changed and clamped; double-tap on a column border → autofit.
3. Fill handle drag B2 (value 1) to B5 → series 1..4 as with the mouse; tap the handle → sheet with the four actions, "Fill series" fills.
4. Type `=SUM(` via the key row into B6 (editing started by double-tap), Ref mode on, tap B2 then drag handle to B5 → text `=SUM(B2:B5`, key `)` then `↵` → 10; `✕` cancels an edit without changing the cell; the key row's bottom equals the visual viewport bottom in the keyboard simulation.
5. Sheet strip: "+" adds a sheet; long-press a tab → rename via the sheet; chips show Sum of a selected range.
6. `tablet` project: handles and long-press work with the ribbon present; the desktop `chromium` suites for Calc stay green (full `pnpm e2e` on port 5013).
7. No horizontal page scroll; all new controls ≥ 44 px hit areas; en and de.

## Verification you must run
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; `cargo fmt --all --check` (no Rust expected); web build of Calc; full e2e (all projects) on port 5013; screenshots `shots/P10-M3-*.png` (selection with handles, key row, fill sheet, tablet).

## Report (≤ 40 lines): behaviour differences from Excel mobile you chose, what is desktop-only, rough edges, ideas.
