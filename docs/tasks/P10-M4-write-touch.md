# Task P10-M4 – Write touch editing and phone page view

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"), then `docs/ui.md` ("Compact layout for phones (P10-M2)", the Write sections), `docs/write-layout.md`, `docs/mobile.md`, `packages/ui-shared/src/compact/*`, `apps/write/src/**` (editor setup – Tiptap/ProseMirror –, page view / print layout, selection toolbar if any, image and table handles, ruler, find bar), `packages/e2e/tests/compact.spec.ts` + `playwright.config.ts` (projects `mobile`, `tablet`), the P10-M2 report notes in STATUS.md (rough edge: the Write page is wider than the phone and scrolls sideways).

Branch `p10/m4-write-touch`, worktree `/home/bojan/rusuite-wt/p10-m4-write-touch`. Model: Opus. e2e port 5014.

## Goal
Write is readable and editable with fingers on a phone and a touch tablet: the page fits the screen, the caret and selection can be placed and extended by touch, pictures and tables can be handled, and the keyboard never hides the caret or the formatting controls. Desktop behaviour is unchanged.

## Items (one commit each)
1. **Page fits the phone.** On compact, the print layout scales the page to the viewport width minus 16 px (zoom = fit-width, recomputed on resize/orientation; the existing zoom state if there is one, else a transform on the page container with correct hit testing for ProseMirror – text must stay selectable and the caret positions right). Pinch zoom between fit-width and 200 %, double-tap toggles fit-width ↔ 100 %. Draft view (no pages) is the alternative the user can pick from View; remember the choice. Gaps between pages shrink to 8 px on compact; headers/footers remain double-tap editable.
2. **Caret and selection by touch.** Tap places the caret (browser default) – ensure nothing of ours intercepts it; long-press on a word selects the word and opens a **selection toolbar** sheet-less floating bar above the selection with Bold, Italic, Underline, Highlight, Link, Copy/Cut/Paste (clipboard via the existing commands), Comment, "⋯" (opens the context sheet with the full desktop context menu); **selection handles**: two 24 px round handles (44 px hit area) at the selection ends on touch devices, dragging them extends character-wise with auto-scroll; the floating bar re-positions with the selection and hides while dragging. On tables the long-press context sheet shows the table items (the desktop context menu content).
3. **Pictures and tables by touch.** Selected picture: 8 resize handles with 44 px hit areas on touch, drag to move floating pictures (existing), the Layout Options button ≥ 44 px; table: column borders draggable with a 44 px hit strip, a row/column selection via tap on the table's edge gutters, the Table tab (contextual) appears in the command bar chips as on desktop. Image insert from the camera roll on mobile uses the existing file input (`accept="image/*"`) – verify it works in the mobile shells' webview (M1 Backend `openFile` is for documents only; keep `<input type=file>` for images).
4. **Keyboard handling.** When the soft keyboard opens (visualViewport shrinks), the caret stays visible (scroll the page container so the caret rectangle is ≥ 60 px above the command bar) and the floating selection bar stays inside the viewport; the find bar and Paragraph/Font sheets do not overlap the caret line. The Styles gallery and Font size pickers in sheets have ≥ 44 px rows.
5. **Tablet with touch (≥ 900 px, ribbon):** long-press selection, handles and pinch work there too.

## In scope
`apps/write/src/**`, `packages/ui-shared/src/compact/**` only if a shared piece is unavoidable (say which), `packages/e2e/tests/compact.spec.ts` (Write part) or a new `write-touch.spec.ts` in the `mobile` and `tablet` projects, `docs/ui.md` (Write touch section), `docs/write-layout.md` (fit-width note), `docs/mobile-plan.md` status. New i18n keys en/de only.

## Acceptance (e2e, `mobile` 412×915 unless noted)
1. Open a fixture document: page width ≤ viewport width (no sideways scroll of the page area), text readable (font ≥ 10 px rendered); pinch → zoom changes; double-tap → 100 % then fit.
2. Long-press a word → word selected, floating bar visible with the listed buttons, Bold toggles bold on the word; drag the end handle two words further → selection grows; "⋯" opens the context sheet with the desktop menu items.
3. Table fixture: long-press a cell → table items in the sheet; drag a column border → width changed; Table chip appears in the command bar when the caret is in a table.
4. Picture fixture: tap the picture → 8 handles with ≥ 44 px hit areas; drag a corner → size changes; Layout Options button ≥ 44 px.
5. Keyboard simulation (M2's `__RUSUITE_VISUAL_VIEWPORT__` hook): caret at the last paragraph stays ≥ 60 px above the command bar.
6. `tablet` project: items 2–4 with the ribbon; the desktop `chromium` Write suites stay green (full `pnpm e2e` on port 5014).
7. en and de; no horizontal page scroll; all new controls ≥ 44 px.

## Verification you must run
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; `cargo fmt --all --check`; web build of Write; full e2e on port 5014; screenshots `shots/P10-M4-*.png` (fit-width page, selection bar + handles, table, tablet).

## Report (≤ 40 lines): what differs from Word mobile, what stays desktop-only, rough edges, ideas.
