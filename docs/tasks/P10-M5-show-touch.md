# Task P10-M5 – Show touch editing and phone presentation

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"), then `docs/ui.md` ("Compact layout for phones (P10-M2)", the Show sections incl. presenter view P7-8 / P9-S5), `docs/mobile.md` (presenter window has no permission on mobile; single-window fallback untested), `packages/ui-shared/src/compact/*`, `apps/show/src/**` (Konva stage, slide sidebar/thumbnails, transforms, text overlay editor, presentation mode, presenter view, animations/transitions playback), `packages/e2e/tests/compact.spec.ts` + `playwright.config.ts` (projects `mobile`, `tablet`), the P10-M2 report notes in STATUS.md (rough edges: the slide list takes half the phone width; Timing group makes the bar taller).

Branch `p10/m5-show-touch`, worktree `/home/bojan/rusuite-wt/p10-m5-show-touch`. Model: Opus. e2e port 5015.

## Goal
Show works with fingers: a phone shows one slide at a time with a thumbnail strip, shapes can be selected, moved, resized and rotated by touch, text edited, and a presentation runs full-screen with swipe – the natural mobile use ("present from the tablet/phone"). Desktop behaviour is unchanged.

## Items (one commit each)
1. **Compact Show chrome.** On compact: the slide sidebar becomes a horizontal **thumbnail strip** (72 px high) above the command bar (or below the top bar – pick and justify), scrollable, current slide highlighted, long-press → the slide context sheet (New, Duplicate, Delete, Hide, Layout ▾, Transition…), drag-and-drop reorder by long-press-drag; the slide canvas fits the remaining area (fit-width, letterboxed); notes become a sheet from a "Notes" chip in the status footer; the Transitions/Animations "Timing" group's inputs become a single "Timing…" button opening a sheet so the command bar keeps one height (coordinate in the ribbon definition – app side; if the group needs a ui-shared change, keep it minimal and say which).
2. **Touch transforms on the canvas.** Tap selects a shape, tap on empty area deselects, long-press → shape context sheet (desktop context menu items), tap on a selected text shape → edit text (the text overlay editor sized to the shape, keyboard-aware via `visualViewport`); Konva transformer with 44 px touch hit areas for the 8 anchors and the rotate handle; **two-finger pinch on a selected shape** scales it, **two-finger twist** rotates it (snap at 0/90/180/270 ± 3°), two-finger pinch on empty area zooms the canvas (50–300 %), one-finger drag on empty area pans when zoomed; smart guides/snapping stay. Multi-select by tapping with the "Select" chip held (a toggle in the command bar's Home tab on compact – the equivalent of Shift-click).
3. **Full-screen presentation on touch.** "Present" (top bar right slot) starts the existing presentation mode in the same window on compact/mobile (never `window.open` there; the single-window fallback must work – test it): swipe left/right = next/previous (also for animation steps), tap right/left third = next/previous, long-press → a small overlay with slide number, "Go to slide…" grid of thumbnails, pen/laser toggle (the presenter ink tool reused for single-finger drawing when the pen is on), Exit; the Fullscreen API where available; orientation lock to landscape where the API exists (ignore failures); media (audio/video) plays on tap when autoplay is blocked.
4. **Tablet with touch (≥ 900 px, ribbon):** transforms, long-press and the presentation gestures work; the presenter view remains available on desktop only (hide the Presenter View command when `isMobile()` from ui-shared is true or `window.open` is unavailable – read `capabilities` defensively; the M1 backend exposes `isMobile()`).

## In scope
`apps/show/src/**`, `packages/ui-shared/src/compact/**` only if unavoidable (say which), `packages/e2e/tests/compact.spec.ts` (Show part) or a new `show-touch.spec.ts` in the `mobile` and `tablet` projects, `docs/ui.md` (Show touch section), `docs/mobile-plan.md` status. New i18n keys en/de only.

## Acceptance (e2e, `mobile` 412×915 unless noted)
1. Open a fixture deck: thumbnail strip with all slides, canvas fits the width (no sideways scroll); tap thumbnail 3 → slide 3; long-press thumbnail → sheet with the listed items; Duplicate adds a slide.
2. Tap a shape → transformer visible with anchors whose hit areas are ≥ 44 px; drag → moved (assert the shape's x/y via the state/dispatch log); two-pointer pinch → scaled; twist → rotated (snapped); long-press → context sheet with desktop items; tap text shape → overlay editor, typing changes the text.
3. Present: slide full-screen in the same window; swipe left → slide 2; tap left third → slide 1; long-press → overlay with the slide grid, tapping slide 4 jumps; Exit returns to editing; the command bar is hidden while presenting.
4. Timing group: one "Timing…" button on compact, the sheet exposes duration/delay/advance-after; the bar height is the same on every tab (assert bounding boxes).
5. `tablet` project: items 2–3 with the ribbon; Presenter View hidden when `window.open` is stubbed to undefined; desktop `chromium` Show suites stay green (full `pnpm e2e` on port 5015).
6. en and de; all new controls ≥ 44 px.

## Verification you must run
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; `cargo fmt --all --check`; web build of Show; full e2e on port 5015; screenshots `shots/P10-M5-*.png` (strip + canvas, transformer, presentation overlay, tablet).

## Report (≤ 40 lines): what differs from PowerPoint mobile, desktop-only items, rough edges, ideas.
