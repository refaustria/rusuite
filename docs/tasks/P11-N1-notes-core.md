# Task P11-N1 – `model-notes` + `notes-core` + WASM shell (the Rust core of Rusuite Notes)

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec `docs/superpowers/specs/2026-11-12-notes-design.md`,
**the spike report `docs/notes-spike-report.md` (binding rules, measurements, pitfalls)** and the spike code on branch
`p11/n0-loro-spike` (`git show p11/n0-loro-spike:spikes/notes-loro/...`, esp. `rust/` and `src/`), `docs/architecture.md`,
ADR 0001/0002/0003/0005, an existing core for patterns (`apps/write/core`, `apps/write/src-wasm`, ts-rs type
generation, `dispatch`), `crates/fmt-onenote/src/model.rs` (what the importer will deliver later – do not map it yet).

Branch `p11/n1-notes-core`, worktree `/home/bojan/rusuite-wt/p11-n1-notes-core`. Model: Opus. No e2e.

## Architecture decisions (PM, from the spike)
- **Doc of record in Rust, editor mirror in the webview.** `notes-core` holds every `LoroDoc` (crate `loro` = 1.17.1).
  The editor (P11-N2) holds a mirror `LoroDoc` from npm `loro-crdt` 1.17.1 bound with `loro-prosemirror` 0.4.4;
  both sides exchange **Loro update bytes** (export from version vector / import). Same path on web and desktop.
- **Docs:** one notebook doc + one doc per page (lazy: a page doc is loaded only when opened, searched or exported).
- **Storage-agnostic core.** The core never touches IndexedDB or the filesystem itself; it returns `Persist` effects
  (doc id + update bytes to append, or a compacted snapshot to replace the log) and is loaded from
  `(doc_id, snapshot, updates[])`. The web TS side (N2) stores effects in IndexedDB; a `FolderStore` behind the
  cargo feature `fs` (not built for wasm) implements the desktop folder layout and is used by tests now and the Tauri
  shell in N7. Specify the layout in `docs/notes-format.md` (folder: `notebook.json` manifest with format version,
  `docs/<docId>.snapshot`, `docs/<docId>.log` append-only length-prefixed updates, `blobs/<sha256>`; backup archive =
  zip of the same tree, `.rnotes`).
- **Page genesis** (spike rule b): a new page doc is created with a deterministic genesis (fixed peer id 0, identical
  ops on every peer) containing the root structure `loro-prosemirror` expects plus one empty paragraph with an empty
  text container (avoids the undo pitfall). Expose `page_genesis()` so the TS side can verify it matches.
- Binary transport: `dispatch(json) -> json` for commands as in the other apps, plus binary functions in the shells
  (`import_updates(doc_id, bytes) -> json`, `export_updates(doc_id, version_vector_bytes) -> bytes`,
  `take_persist_effects() -> ...`) – avoid base64 for updates on the hot path.

## `crates/model-notes` (pure model, wasm-compatible, `#![forbid(unsafe_code)]`)
- Notebook doc schema: `LoroTree` `"tree"`; node meta map `{ kind: "group"|"section"|"page", title, color (sections),
  pageDoc (pages: doc id), created, modified, deleted (soft delete → recycle bin, kept 60 days, restore) }`; map
  `"notebook"` `{ name, color, formatVersion }`; list `"tags"` (definitions: id, label, icon, colour, built-in kind
  like fmt-onenote's `TagKind`).
- Page doc schema: the `loro-prosemirror` container layout (copy it from the binding's source/docs – write a short
  section in `docs/notes-format.md`); map `"meta"` `{ title, created, modified, canvas: bool }`; containers reserved
  for canvas items and ink (`"canvas"` movable list of maps; `"ink"` list of strokes) – only the schema and
  accessors now, UI in N4.
- Readers over the ProseMirror-shaped content: plain text extraction, headings outline, `[[page links]]`
  (node/mark name `pageLink` with attr `pageId`), tags on blocks (attr `tags: [tagId]`, checked state for to-dos),
  image/attachment blob refs (attr `blob: sha256`). Document the node/mark names and attrs N2 must use.
- Typed API (names indicative): `NotebookDoc::{new, create_section, create_page, create_group, move_node,
  rename, set_color, delete, restore, purge_expired, tree() -> Vec<TreeNode>}`, `PageDoc::{genesis, title,
  plain_text, outline, links, tags, blobs, set_canvas}`.

## `apps/notes/core` (`notes-core`)
- `NotesHost` with open notebooks, lazily loaded page docs, effects queue, undo is NOT here (Loro `UndoManager`
  lives in the editor mirror for content; structural undo for tree operations: Rust-side `UndoManager` on the
  notebook doc, local-peer only).
- Commands (serde, ts-rs types): notebook create/open(load from parts)/close/list; section/group/page
  create/rename/colour/move (index + parent)/delete/restore/purge; `GetTree`; `OpenPage` (returns doc id + version)
  `ClosePage`; `Search { query, notebook?: id }` → hits with page id, title, snippet with match ranges;
  `Tasks { filter: open|done|all }` → to-do items across all loaded notebooks (load page docs as needed);
  `Backlinks { pageId }`; `History { docId }` → list of change groups (time, peer/author id, op count; merge
  adjacent changes of the same peer within 60 s); `CheckoutPreview { docId, frontiers }` → plain-text/PM JSON of
  that version; `Restore { docId, frontiers }` → new ops that bring the doc back to that state (never rewrites
  history); `Compact { docId }` (snapshot with full history, no shallow snapshots – spec "history retention");
  `ExportBackup` / `ImportBackup` (`.rnotes`, see format).
- Search index: in-memory, built when a notebook opens (page docs read once), updated on imports; case- and
  diacritics-insensitive (Unicode NFKD + strip marks + lowercase), prefix match per word, AND across words, phrase
  match with quotes; target `< 100 ms` for 500 pages × 2 000 words (bench test, release mode, report the number).
- Author identity: peer id ↔ device id mapping is stored in the notebook doc map `"peers"` (`peerId → deviceId`);
  display names come later from the member list (N5) – keep the API (`History` returns peer ids + device id if known).

## `apps/notes/src-wasm` (`app-notes-wasm`)
wasm-bindgen exports mirroring `app-write-wasm` + the binary functions; `cargo check --target wasm32-unknown-unknown`
in CI's list. Report the `.wasm` size (release, opt-level s) – the Loro crate is big; the JS mirror adds
`loro-crdt` (1.2 MB gz) on top, accepted by the PM.

## Tests (TDD; the definition of done in COMMON.md)
- Tree: concurrent moves of the same page by two peers → one node; move into concurrently deleted section →
  deleted (recoverable from recycle bin); cycles impossible (from the spike's `tree_moves`).
- Genesis: two peers create the "same" new page independently → no text vanishes (the spike's failure case).
- Interop: page updates exported by the browser in the spike (`spikes/notes-loro/fixtures/` on the spike branch – copy
  the needed fixture files into `apps/notes/core/tests/fixtures/`) import, plain text and tags read correctly.
- Search: diacritics/case, prefix, phrase, ranking (title hit before body), perf bench.
- Tasks/backlinks/blobs readers; history grouping; restore produces the old text while keeping history; compaction
  keeps history; backup round trip incl. blobs; `FolderStore` round trip and append-after-crash (truncated last log
  record is ignored with a warning, never a failed load).
- Review focus 2 from `docs/plan-3.14159.md` (concurrent move) is owned here.

## In scope
`crates/model-notes/**`, `apps/notes/core/**`, `apps/notes/src-wasm/**`, workspace `Cargo.toml`/`Cargo.lock`,
`.github/workflows/ci.yml` (wasm check list only), `docs/notes-format.md`, `docs/architecture.md` (crate table rows for
the new crates). Generated TS types go to `apps/notes/src/generated/` (create only that folder).

## Report (≤ 50 lines): API summary, schema decisions N2 must follow (node/mark names, attrs), perf numbers, wasm size.
