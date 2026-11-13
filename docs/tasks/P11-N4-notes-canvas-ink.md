# Task P11-N4 – Notes: canvas pages and ink (Draw tab)

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec (page model: flowing by default, canvas per page),
`docs/notes-format.md` (canvas items `"canvas"`, strokes `"ink"`, `canvasItem` block attr, §7), `crates/model-notes`
(canvas/ink accessors), `crates/notes-convert` (what the OneNote import writes for canvas pages – your renderer must
show those correctly), the N2 code `apps/notes/src/**`, `packages/ui-shared/src/geometry/handles.ts` (resize/rotate
handles used by Write/Show), Show's Konva usage (`apps/show/src`) for reference.

Branch `p11/n4-notes-canvas-ink`, worktree `/home/bojan/rusuite-wt/p11-n4-notes-canvas-ink`. Model: Opus. e2e port 5114.
P11-N3 runs in parallel in the editor/navigation code – keep your code in `apps/notes/src/canvas/**` plus a small
hook into the page view and the Draw ribbon tab; expect a small merge in the ribbon definition.

## Goal
Any page can be switched to a **canvas** (Draw › "Free canvas" toggle, or set by the OneNote import): an infinite-
right/down surface where text boxes, images and ink strokes are freely placed. Flowing pages can also have ink?
No – ink requires canvas mode (PM decision: keeps flowing pages clean); switching a flowing page to canvas turns its
content into one text box at (0,0); switching back flows all boxes in reading order (top-to-bottom, left-to-right)
and keeps strokes in the data but hides them with a notice ("Drawings are hidden on flowing pages").

## Items
1. **Canvas renderer**: positioned items from the page doc: text boxes (each a Tiptap editor bound to the blocks with
   that `canvasItem` id – one shared Loro doc; verify with the binding that per-box editing works, else choose the
   simplest correct approach and explain), images, attachments; click on empty space creates a text box there and
   starts typing (OneNote behaviour); move by the box's top bar, resize width (height grows with content); selection,
   multi-select (rubber band), delete, z-order; snap to a 8 px grid with Alt to disable. Zoom 25–400 % with
   Ctrl+wheel/pinch; scroll extends the surface.
2. **Ink**: Draw tab with pen (3 widths × palette incl. the suite colours), highlighter (transparent, drawn under
   text), eraser (stroke eraser; point eraser optional), lasso select (move/delete/recolour strokes and boxes), ruler
   not needed. Pointer events with pressure (`pressure`, fallback constant), coalesced events for smoothness,
   palm-rejection-lite (ignore touch while a pen is active). Strokes stored on pointer-up: points quantised to
   0.1 px, simplified (Ramer–Douglas–Peucker, ε 0.5 px) – write the stroke as one Loro op batch; render with
   perfect-freehand-like outline (implement a small smoothing yourself or use `perfect-freehand` (MIT) if its size is
   small – state it). Live stroke rendering at pointer rate on canvas 2D; committed strokes on an SVG or canvas layer
   (your choice by performance – 2 000 strokes must pan/zoom at 60 fps on a mid laptop; measure in e2e with a
   generated page and report).
3. **Undo/redo** through the mirror's UndoManager (stroke = one undo step; box move = one step).
4. **Imported OneNote canvas pages** (from N6a) render with their positions and ink; e2e with a page imported via the
   core's `importOneNote` from `testdata/onenote/handwriting_recognition.one` (call the core directly in the test
   setup if the import UI is not there yet – N6b adds it).
5. **Print/PDF of canvas pages**: render the surface's bounding box to the print pipeline (scale to page width).
6. Compact layout: canvas pages are viewable and pannable at 412 px; drawing with touch is allowed (simple), no
   further touch work.

## Verification
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check` (en/de); `scripts/privacy-check.sh`; `cargo fmt --all --check` (+
clippy/tests if you touch Rust – only bug fixes); `pnpm --filter notes build:web`; full e2e (all projects) with
`BASE_URL=http://127.0.0.1:5114` and your own `E2E_PORT=5114 node packages/e2e/serve.mjs`; screenshots
`shots/P11-N4-*.png` (canvas with boxes + ink, highlighter, lasso, imported OneNote page).

## In scope
`apps/notes/src/canvas/**`, the page-view hook and the Draw tab in `apps/notes/src/**` (minimal), `apps/notes/package.json`
(if adding `perfect-freehand`), `packages/e2e/tests/notes-canvas.spec.ts`, `docs/ui.md` (canvas section), `NOTICE` if a
dependency is added.

## Report (≤ 50 lines): approach for per-box editing, rendering choice + fps numbers, deviations, rough edges.
