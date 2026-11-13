# Task P11-N3 – Notes: rich content, tags & tasks, search, page links, history, print

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec, `docs/notes-format.md` (§4–7), `docs/notes-spike-report.md`,
the N2 code in `apps/notes/src/**` (editor, navigation, persistence, ribbon) and `docs/ui.md` (Notes section),
`apps/notes/core` commands (`Search`, `Tasks`, `Backlinks`, `History`, `CheckoutPreview`, `Restore`, blobs),
`packages/ui-shared/src/print*`, Write's table UI (`apps/write/src/**` tables, image handles) for look & feel reuse.

Branch `p11/n3-notes-rich-content`, worktree `/home/bojan/rusuite-wt/p11-n3-notes-rich-content`. Model: Opus. e2e port 5113.
P11-N4 (canvas + ink) runs in parallel in `apps/notes/src/canvas/**` and the Draw ribbon tab – do not touch those;
expect a small merge in the ribbon definition.

## Items (each with tests)
1. **Tables**: insert (grid picker as in Write), add/delete rows/cols, header row, merge/split (colspan/rowspan per
   schema), column resize, Tab navigation, context menu. Reuse Write/ui-shared components where possible.
2. **Images**: paste, drop, Insert › Picture (file picker) → blob (sha256 via the core's `blob_id`) stored through
   the core's blob effect, rendered from IndexedDB blobs as object URLs; resize handles (keep aspect), alt text,
   alignment left/center. Large images: downscale > 4096 px on insert (keep original? no – store downscaled, say so).
3. **Attachments**: Insert › File, drop of non-image files → `attachment` node card (icon, name, size, open/download).
   Size limit 25 MB (same as the relay's blob limit), clear message above it.
4. **Tags & tasks**: show tags as icons before the block (OneNote style), click toggles to-do; tag picker in Home;
   custom tags (create/rename/colour/icon) in a "Customize tags" dialog stored in the notebook doc; **Tasks view**
   (View › Tasks or a nav entry): all to-dos across open notebooks grouped by notebook/section/page, filter
   open/done/all and by tag, click jumps to the block (scroll + highlight); checking in the view updates the page.
   Fix the core double-listing of `taskItem` + to-do tag (core bug from N1 report) – small core change allowed.
5. **Search UI**: search box at the top of the navigation pane (Ctrl+E like OneNote, Ctrl+F = find on page), results
   while typing (debounced 120 ms) with page title, path, snippet with highlights; scope current notebook/all;
   Enter opens the page and highlights matches in the editor; find-on-page bar with next/previous.
6. **Page links & backlinks**: "Linked from" footer on each page (core `Backlinks`), broken-link styling when the
   target page is deleted, rename keeps links (titles are read live).
7. **Page history**: Share/View › Page history panel: list of versions (time, author colour/device id until names
   exist in N5b), click shows a read-only preview with changed paragraphs highlighted against the current version,
   Restore (core `Restore`, never rewrites history); keyboard accessible.
8. **Print & PDF**: page / section print through the ui-shared print pipeline with a preview; Export PDF like the
   other apps.
9. **Follow-ups from N2** (small): core command `PurgeNode` (delete one recycle-bin entry permanently) and use it;
   single-tab safety: a `BroadcastChannel` lock – a second tab shows "Notes is open in another tab" with "Use here"
   (takes over, the other tab goes read-only); report relay accepts `app: "notes"` (`services/report-relay`); every
   block created by the editor gets its text container at creation (spike pitfall Q5) – test with the UndoManager
   that undoing a new block's first keystroke does not delete remote/other text (simulate a second peer).
10. **Perf (review focus 5)**: a generated notebook with 500 pages, 200 images (small), history of 50 changes per page:
   open page < 300 ms, search < 100 ms (in the browser, e2e measurement, report numbers).

## Verification
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check` (en/de only, others pending); `scripts/privacy-check.sh`;
`cargo fmt --all --check` + clippy/tests for Rust you touch; `pnpm --filter notes build:web`; full e2e (all projects)
on port 5113 – run it with `BASE_URL=http://127.0.0.1:5113` and your own `node packages/e2e/serve.mjs`
(`E2E_PORT=5113`); screenshots `shots/P11-N3-*.png`.

## In scope
`apps/notes/src/**` except `canvas/**`, small `apps/notes/core` changes (named above), `services/report-relay`
(app list), `packages/ui-shared/**` for generic additions only (say which), `packages/e2e/tests/notes*.spec.ts`,
`docs/ui.md`, `docs/shortcuts.md`.

## Report (≤ 50 lines): what works, perf numbers, deviations, rough edges.
