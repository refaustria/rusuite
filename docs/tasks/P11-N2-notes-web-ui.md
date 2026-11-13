# Task P11-N2 – Rusuite Notes web app (UI shell, navigation, editor, local storage)

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec `docs/superpowers/specs/2026-11-12-notes-design.md`,
`docs/notes-spike-report.md` (binding rules!), `docs/notes-format.md` (§4–5: schema rules the editor MUST follow),
`apps/notes/core` + `apps/notes/src-wasm` (the API; TS types in `apps/notes/src/generated/`), the spike UI on branch
`p11/n0-loro-spike` (`spikes/notes-loro/src/` – binding + IME guard), and how Write is built: `apps/write/`
(`package.json`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, backend selection, i18n, backstage, shortcuts,
autosave/recovery, print), `packages/ui-shared/src/{ribbon,backend.ts,i18n,recent,settings,report,compact,print}`,
`docs/ui.md`, `packages/e2e` (config, a Write spec), `scripts/deploy-web.sh`, `scripts/privacy-check.sh`.

Branch `p11/n2-notes-web-ui`, worktree `/home/bojan/rusuite-wt/p11-n2-notes-web-ui`. Model: Opus. e2e port 5112.

## Goal
`apps/notes` is a working single-user web app with the suite's look & feel: create notebooks, sections (coloured
tabs, section groups) and pages (sub-pages), write rich text, everything persists in the browser, survives reloads,
can be backed up and restored. Same React/Vite/ui-shared stack and conventions as Write.

## Architecture (PM decisions, binding)
- Rust `notes-core` (WASM) is the document of record; the page editor uses a **mirror** `LoroDoc` (npm `loro-crdt`
  1.17.1) bound with `loro-prosemirror` 0.4.4 on Tiptap 3.31.3. Mirror ↔ core exchange update bytes
  (`export_updates`/`import_updates`, in-process on the web). Follow notes-format.md: mirror peer id =
  `OpenedPage.mirrorPeer`, `setRecordTimestamp(true)`, `setChangeMergeInterval(10)`, seed from
  `export_updates(docId, empty)`, never let the binding initialise an empty doc, verify the genesis text container is
  reused. StarterKit **`trailingNode` off**. Hold remote/imported updates while an IME composition is active (spike
  fix – there are no remote peers yet, but build the queue now; N5b uses it).
- Undo/redo in the editor = Loro `UndoManager` on the mirror (local peer only); tree operations undo through the core.
- Persistence: apply the core's `PersistEffect`s to IndexedDB (`rusuite-notes` DB: stores `docs` (snapshot + log
  records), `blobs`, `meta` (open notebooks, recent, settings)); load on start. Writes are batched (≤ 250 ms) and
  flushed on `visibilitychange`/`pagehide`. Request `navigator.storage.persist()`; if it is denied, show a dismissable
  hint "Your notes are stored only in this browser. Download a backup regularly." with a "Download backup" button.
- Backend: a `NotesBackend` interface (web implementation now; Tauri later in N7) like ui-shared's Backend pattern.
- Clock: pass `now` with requests (the core has none).

## UI (en + de strings, informal German)
1. **Ribbon** (ui-shared): File (backstage) · Home (clipboard, font styles B/I/U/S, highlight, text colour, clear
   formatting, paragraph styles Heading 1–3/Normal/Quote/Code, lists, checklist, indent, tags dropdown – the tag
   *picker* applies `tags` attrs per notes-format; tag display and tasks view come in N3) · Insert (link, divider, code
   block, date/time, `[[page link]]` via a page picker) · View (navigation pane toggle, page width normal/wide, zoom,
   dark mode as in the other apps). Draw and Share tabs: not yet.
2. **Navigation pane** (left, resizable, collapsible; OneNote-like but cleaner): notebook switcher at the top (list,
   new, rename, colour, close), section tabs as a vertical coloured list with section groups (expand/collapse), page
   list for the current section with sub-page indentation (levels 0–2, Tab/Shift+Tab or drag to change level).
   Drag & drop: reorder sections/pages, move a page to another section (also across notebooks: copy then delete is
   acceptable if a cross-notebook move is not in the core – say which), drop onto a section tab. Context menus
   (ui-shared ContextMenu): rename, colour, delete (to recycle bin), move to…, copy link to page. Recycle bin view
   (restore, delete permanently).
3. **Page**: title field (bound to `meta.title`, Enter moves into the body), created date under the title, Tiptap
   editor with the notes-format schema: paragraph, heading 1–3, bullet/ordered list, task list/items, blockquote,
   code block, horizontal rule, hard break, link, pageLink (inline node with title, click navigates). Block drag
   handle (⋮⋮ on hover) to move blocks. Keyboard: Office/OneNote shortcuts (Ctrl+1 to-do tag, Ctrl+Alt+1–3 headings,
   Ctrl+N new page, Ctrl+Shift+N new sub-page? – check docs/shortcuts.md conventions and add a Notes section).
4. **Backstage**: New notebook, Open (list of notebooks in this browser), Recent, Download backup (`.rnotes`), Open
   backup, Options (shared settings), About, Report a problem (as the other apps), "Remove local data from this
   browser" (ADR 0009 rule 4).
5. **Status bar**: saved state ("Saved in this browser"), word count of the page.
6. Empty states: first start creates "My notebook" with a section "Quick notes" and a welcome page (short, en/de).
7. Compact layout (< 900 px): use the existing compact components so the app is usable (navigation as a drawer);
   no touch-specific work (mobile is later).

## Build & deploy wiring
- `apps/notes/package.json` (name `notes`, scripts like Write's: `build:wasm`, `build:web`, `dev:web`, `test`),
  `vite.config.ts` with base `/notes/`, `index.html`, icons/logo placeholder (reuse the portal logo style; a proper
  logo comes with N7).
- `scripts/deploy-web.sh`: add `notes` to `apps` (deployed to `/notes/`, **not** linked from the portal – do not
  touch `apps/portal`).
- `scripts/privacy-check.sh`: notes included in the scans; no network code in this task at all.
- pnpm workspace entry if needed.

## Tests
- Vitest: mapping/persistence units (effects → IndexedDB with `fake-indexeddb` if already available, else an
  in-memory adapter test), backup round trip, IME queue.
- e2e `packages/e2e/tests/notes.spec.ts` (port 5112): first start shows the welcome page; create notebook/section/
  page, type formatted text + checklist, reload → everything there; drag a page to another section; sub-page
  indent; delete → recycle bin → restore; undo/redo typing and a structural op; search box absent or disabled
  (N3); download backup, clear local data, open backup → identical tree and text (**review focus 3**); request
  audit: only same-origin static requests (extend the existing privacy e2e to `/notes/`); de UI smoke; no console
  errors; a 412 px compact smoke (drawer opens, page editable).
- Typing latency check: 200 characters typed into a page with 5 000 words – no long task > 50 ms in the
  Performance API (report the number).

## Verification you must run
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; `cargo fmt --all --check`; clippy for
any Rust you touch; `pnpm --filter notes build:web`; full e2e (all projects) on port 5112; screenshots
`shots/P11-N2-*.png` (navigation + page, backstage, dark mode, compact).

## In scope
`apps/notes/**` (not `core`/`src-wasm` except for bug fixes you must explain), `packages/ui-shared/**` only for
small generic additions (say which), `packages/e2e/**` (notes specs + privacy audit extension), `scripts/deploy-web.sh`,
`scripts/privacy-check.sh`, `pnpm-workspace.yaml`/lockfile, `docs/ui.md` (Notes section), `docs/shortcuts.md`.

## Report (≤ 50 lines): what works, deviations, measured typing latency, rough edges, ideas.
