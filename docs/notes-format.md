# Rusuite Notes – storage format and document schema

Format version **1** (`model_notes::FORMAT_VERSION`). Crates: `crates/model-notes` (schema, readers),
`apps/notes/core` (`notes-core`: host, effects, folder store, backups). Spec:
[`superpowers/specs/2026-11-12-notes-design.md`](superpowers/specs/2026-11-12-notes-design.md); CRDT decision and
pitfalls: [`notes-spike-report.md`](notes-spike-report.md). CRDT: Loro 1.17.1 (Rust crate `loro` = npm
`loro-crdt`, kept in lockstep).

## 1. Documents and ids

A notebook is **one notebook document plus one document per page**, each a Loro document.

| Id | Form | Notes |
|---|---|---|
| notebook id = notebook doc id | `nb-<16 hex>` (or chosen by the caller) | random; also the folder's `notebookId` |
| page doc id | `pg-<16 hex>` | random, global across notebooks; stored in the page's tree node (`pageDoc`); used by page links |
| tree node id | `counter@peer` (Loro `TreeID` string) | changes when an undone *create* is redone (Loro re-creates the node) |
| blob id | SHA-256 hex of the bytes (64 chars) | content addressed |
| frontiers / op ids | `counter@peer` strings | peer ids are u64 → decimal strings on the wire |

Every id that becomes a file name matches `[A-Za-z0-9_-]{1,128}` (blob ids: 64 hex digits); anything else is
rejected (`notes_core::is_safe_id`).

## 2. Notebook folder (desktop) and backup archive

```
<folder>/
  notebook.json            manifest
  docs/<docId>.snapshot    Loro snapshot with full history (ExportMode::Snapshot), optional
  docs/<docId>.log         append-only update records since that snapshot, optional
  blobs/<sha256>           images and attachments, raw bytes
```

`notebook.json`:

```json
{ "format": "rusuite-notes", "formatVersion": 1, "notebookId": "nb-…", "name": "Work" }
```

`name` is a cache for "recent notebooks" lists; the notebook doc is authoritative. A reader refuses a
`formatVersion` newer than its own.

**Log records**: `len: u32 little-endian` followed by `len` bytes of one Loro update (`ExportMode::updates`). A
document is loaded as `import(snapshot)` then `import_batch(records)`. A **truncated last record** (crash during an
append) is ignored with the warning `truncated_log`, never a failed load; `FolderStore` also truncates the file to
its last complete record so later appends stay aligned. Re-importing records already contained in the snapshot is
harmless (op-id dedupe).

**Compaction** (`Compact` command, or automatically after 500 appended records): the new snapshot is written
atomically (temp file + rename), then the log is removed. A crash in between leaves snapshot + old log, which loads
fine. Snapshots always keep the **full history** – no shallow snapshots (spec "history retention").

**Backup** (`.rnotes`, web "Download backup" / "Open backup", desktop export): a zip (deflate, fixed timestamps) of
exactly the folder tree above. Entries other than `notebook.json`, `docs/<safe id>.snapshot|log` and
`blobs/<sha256>` are skipped with `unknown_entry`; blobs whose hash does not match are skipped with
`blob_mismatch`. A backup never overwrites an open notebook or an existing notebook folder.

Web (IndexedDB) stores the same units – per doc a snapshot and a list of records, per notebook the manifest and
blobs – and hands them to the core the same way (§5).

## 3. Notebook document

| Container | Type | Content |
|---|---|---|
| `"notebook"` | map | `name`, `color?` (`#RRGGBB`), `formatVersion`, `created` (Unix ms) |
| `"tree"` | movable tree (fractional index on) | the hierarchy, node data in the node's meta map |
| `"tags"` | list of maps | tag definitions `{ id, kind, label, icon?, color? }` |
| `"peers"` | map | `"<peer id decimal>" → deviceId` (who wrote: history "who"; display names come with the member list, N5) |

Tree node meta: `kind` (`group` \| `section` \| `page`), `title`, `color?`, `pageDoc` (pages), `created`,
`modified` (Unix ms), `deleted?` (Unix ms – soft delete).

- Structure: groups and sections at the root or in groups; pages in sections or under pages (sub-pages). Moves
  that break this or would create a cycle are refused; concurrent moves resolve in Loro's tree CRDT (a page
  moved concurrently to two sections ends up in exactly one; concurrent x→y / y→x leaves one root).
- **Recycle bin**: `delete` sets `deleted`; the node and its subtree disappear from the tree but stay restorable.
  A page moved concurrently into a deleted section is deleted with it and comes back when the section is
  restored (or individually with `RestoreNode { to }`). Entries older than **60 days** are purged
  (`Purge`: Loro tree delete; their page docs are dropped).
- Built-in tags (fixed ids, empty label → the UI shows its catalog text): `todo` (toDo, check box), `important`,
  `question`, `idea`, `critical`, `contact`, `address`, `phone`, `remember`, `definition`, `highlight`. Custom
  tags: kind `custom` or `customToDo`, id `t-<peer hex>-<counter>`. Kinds mirror `fmt-onenote`'s `TagKind`.
- The page title in the tree is authoritative for navigation; `Rename` keeps the page doc's `meta.title` equal.

## 4. Page document

### 4.1 Containers

| Container | Type | Content |
|---|---|---|
| `"doc"` | map | the ProseMirror document in **`loro-prosemirror` 0.4.4's layout** (below) |
| `"meta"` | map | `title`, `created`, `modified` (Unix ms), `canvas` (bool: freeform canvas page) |
| `"canvas"` | movable list of maps | positioned items `{ id, kind: text\|image\|attachment, x, y, w, h (0 = auto), blob? }` (points) |
| `"ink"` | list of maps | strokes `{ id, tool: pen\|highlighter, color, width (1/10 pt), points: [x, y, pressure, …] }` – x/y in 1/10 pt, pressure 0–255, integers |

Canvas and ink have schema and accessors only (UI: P11-N4).

### 4.2 Content layout (must match the binding exactly)

- A non-text PM node is a `LoroMap { nodeName: string, attributes: LoroMap, children: LoroList }`. Attributes
  whose value is `null` are not written.
- A run of adjacent PM text nodes is **one `LoroText`** in the parent's `children`; each PM mark is a text style
  whose key is the mark name and whose value is the mark's `attrs` object (an empty map for marks without
  attributes). Inline non-text nodes (`hardBreak`, `pageLink`, …) are maps between texts.
- Mark expand behaviour (`configTextStyle`, as `configLoroTextStyle` derives it from the schema): inclusive marks
  `after`, `link` and `pageLink` `none`.

### 4.3 Genesis (spike rule b)

Every page doc begins with the **genesis update** (`page_genesis()`): written by peer **0** at timestamp 0, ops in
this order – `doc.nodeName = "doc"`, `doc.attributes = {}`, `doc.children = []`, insert at 0 a paragraph map with
`nodeName`, `attributes`, `children`, and in its `children` one **empty `LoroText`**. The bytes are identical on
every peer, so two peers creating the "same" page merge instead of one `children` list winning (text loss), and
the first keystroke never creates the text container (the undo pitfall). Peer 0 is reserved for this; history
hides it. The editor must start its mirror from these exact bytes (seeded from `export_updates`, compare with the
wasm export `page_genesis()`), never let the binding initialise an empty doc. P11-N0 spike pages used a genesis
*without* the text container and are not compatible with it (only fresh docs may import them).

### 4.4 Node and mark names the core reads (contract for the editor)

| Name | Kind | Attributes the core reads |
|---|---|---|
| `doc`, `paragraph`, `heading`, `codeBlock` | nodes | `heading.level` (1–6) → outline |
| `bulletList`, `orderedList`, `listItem`, `blockquote`, `table…` | nodes | – (text extracted from their text blocks) |
| `taskList` / `taskItem` | nodes | `taskItem.checked: bool` → tasks |
| `hardBreak` | inline node | – (a line break in plain text) |
| `pageLink` | inline node **or** mark | `pageId` = target **page doc id**; node also `title` (shown text) → backlinks |
| `link`, `bold`, `italic`, `underline`, `strike`, `code`, `highlight`, `textStyle`, `subscript`, `superscript` | marks | – |
| any node (e.g. `image`, `attachment`) | – | `blob` = SHA-256 of an image/attachment → backup/sync blob list |
| any block | – | `tags: string[]` (tag ids), `checked: bool` for to-do kinds → tag/task index |
| `image`, `attachment`, `table…`, `horizontalRule`, … | nodes | written by the importers (§7.1) |

Plain text = one line per non-empty text block (paragraph/heading/codeBlock or any node with text children),
`hardBreak` → newline, `pageLink` nodes → their `title`. Tasks = every `taskItem` plus every block whose `tags`
contain a to-do-kind tag. Block positions (`block`) are top-level child indices of `doc`.

## 5. Core interfaces (shells)

The core never touches storage. JSON commands go through `dispatch` (`apps/notes/src/generated/Request.ts`;
every request may carry `"now"`: the UI clock in Unix ms, the core has none). Bytes use binary functions:

| Function | In | Out |
|---|---|---|
| `load_doc(notebook, doc, snapshot, log)` | stored doc (log in §2 record framing) | JSON `loaded { warnings }` |
| `dispatch({type:"openNotebook", id})` | after all `load_doc` calls | builds the search/tasks index (each page read once, kept as bytes until opened) |
| `import_updates(doc, bytes)` | Loro updates from the editor mirror or the relay | JSON `imported { result }` (`changed`, `pending`, `version`) |
| `export_updates(doc, vv)` | `VersionVector.encode()` bytes (empty = all) | Loro update bytes |
| `version_vector(doc)` | – | `VersionVector.encode()` |
| `take_persist_effects()` | – | effects (below) |
| `export_backup(notebook, blobs)` / `import_backup(bytes)` | blobs as `{len:u32 LE, bytes}*` | `.rnotes` bytes / JSON `backupImported` |
| `page_genesis()`, `blob_id(bytes)` | – | genesis bytes, SHA-256 hex |
| `import_file(request, bytes)` | an `importOneNote` / `importMarkdown` / `importHtml` / `importDocx` request (JSON) + the file | JSON `fileImported` (§7) |
| `export(request, blobs)` | an `exportPage` / `exportSection` request (JSON) + blobs as `{len:u32 LE, bytes}*` | file bytes (§7) |

**Persist effects** (`encode_effects`): `count: u32` then per effect `kind: u8`, `notebook: u16 len + UTF-8`,
`doc: u16 len + UTF-8`, `bytes: u32 len + bytes` (all little-endian). Kinds: **1** append record to
`docs/<doc>.log`; **2** replace `docs/<doc>.snapshot` and empty the log; **3** delete the doc; **4** store blob
(`doc` = sha256). Effects are queued after every change (local command, mirror import, relay import) as the
updates since the last persisted version; updates waiting for missing dependencies are appended as received.

**Editor mirror rules** (P11-N2): bind the mirror only after seeding it from `export_updates(docId, empty)`; set
its peer id to `OpenedPage.mirrorPeer` (never the core's peer), `setRecordTimestamp(true)` and
`setChangeMergeInterval(OpenedPage.mergeIntervalSecs)` (10 s; Loro's default 1000 s would make history useless);
ship `subscribeLocalUpdates` bytes to `import_updates`, pull remote/core changes with
`export_updates(docId, mirror.oplogVersion().encode())`. The core records `peer → device` in `"peers"` the first
time a peer of this device writes to a notebook.

## 6. History

`History { docId }` lists change groups oldest first: adjacent changes of one peer at most **60 s** apart
(`HISTORY_MERGE_SECS`), with `peer`, `deviceId?`, `start`/`end` (Unix ms), `ops` and `frontiers` – the version
after the group in history order. `CheckoutPreview` renders that version (plain text + PM JSON) from a fork;
`Restore` reverts to it with **new** operations (`revert_to`), so history only grows and peers merge it like any
edit.

## 7. Import and export (P11-N6a)

Crate `crates/notes-convert` (pure functions, wasm-compatible) converts between page content (the ProseMirror JSON
of §4.4) and other formats; `notes-core` applies imports to notebooks (`host/convert.rs`). A separate crate keeps
`model-notes` free of the format dependencies (`fmt-onenote`, `fmt-docx`/`model-text`, `pulldown-cmark`,
`html5ever`), and the converters testable without Loro.

### 7.1 Schema used by the converters (additions are PM-safe: new optional attributes/nodes only)

| Name | Kind | Attributes |
|---|---|---|
| `heading` | node | `level` 1–6 |
| `bulletList`, `orderedList`, `listItem` | nodes | `orderedList.start` (absent = 1) |
| `taskList`, `taskItem` | nodes | `taskItem.checked` |
| `blockquote`, `horizontalRule`, `hardBreak` | nodes | – |
| `codeBlock` | node | `language?` |
| `table`, `tableRow`, `tableCell`, `tableHeader` | nodes (Tiptap table) | cells: `colspan?`, `rowspan?` (> 1) |
| `image` | block node (atom) | `blob`, `alt?`, `width?`/`height?` (points) |
| `attachment` | block node (atom) | `blob`, `name`, `size` (bytes) |
| `pageLink` | inline node / mark | node: `pageId`, `title`; mark: `pageId` |
| `link` | mark | `href` (only `http(s):`, `mailto:`, `tel:`, `#…`; `onenote:` links of an import are page links or text) |
| `textStyle` | mark | **`color`** `#RRGGBB` (new) |
| `highlight` | mark | **`color`** `#RRGGBB` (new; absent = default yellow) |
| `bold`, `italic`, `underline`, `strike`, `code`, `subscript`, `superscript` | marks | – |
| any top-level block | – | **`canvasItem`** (new): on canvas pages, the id of the text item (`"canvas"`) the block belongs to |

Canvas pages (`meta.canvas = true`): a `"canvas"` item of kind `text` shows the top-level blocks whose `canvasItem`
is its id (in document order); `image` items show their blob; ink strokes are in page coordinates (1/10 pt). With
canvas mode off, all blocks flow in document order. The editor (N2/N4) must declare `canvasItem`, `tags` and
`checked` as global block attributes, or the binding drops them.

**Tag markers** (formats without tags – Markdown, HTML, .docx): ` [Label]` after the block's text, one per tag.
Built-in tags use their English catalog label (`To-do`, `Important`, `Question`, `Idea`, `Critical`, `Contact`,
`Address`, `Phone number`, `Remember for later`, `Definition`, `Highlight`), custom tags their label; a ticked to-do
is ` [To-do: done]`. Importers turn trailing markers whose label is in the notebook's tags (case-insensitive) back
into `tags`/`checked`. `[[Title]]` in imported text becomes a `pageLink` when a page of the notebook has that title
(case-insensitive); otherwise it stays text.

### 7.2 Commands

| Request | Path | Result |
|---|---|---|
| `importOneNote { fileName, notebook?, parent?, id? }` | `import_file` | `.onepkg` (CAB, sniffed by bytes) → a **new notebook** (`id` or random): section groups, sections with colours, pages with sub-page levels and created/modified times. `.one` → a **new section** of `notebook` (at the root, or in group `parent`). One undo step for the tree. |
| `importMarkdown { fileName, notebook, parent, text? }` | dispatch (`text`) or `import_file` | a new page under `parent` (section or page) |
| `importHtml { fileName, notebook, parent, html? }` | dispatch (`html`) or `import_file` | a new page (sanitised) |
| `importDocx { fileName, notebook, parent }` | `import_file` | a new page |
| `pasteHtml { notebook, html }` | dispatch | `pasted { content: doc, warnings }` – the editor's paste path; images become blobs of `notebook` |
| `exportPage { docId, format: md\|html\|docx }` | `export` | `.md` (images as `data:` URIs) / standalone `.html` / `.docx` |
| `exportSection { notebook, section, format }` | `export` | `md`: `.zip` of `NN Title.md` + `assets/`; `html`: one file, an `<article>` per page; `docx`: one document, each page a Heading 1 starting on a new page. Sub-pages follow their page. |

`fileImported { notebook, tree, nodes, pages, warnings }`: `nodes` = the top-level nodes created, `pages` = every
page (`{node, docId}`). Page titles: OneNote's; else a leading level-1 heading (removed from the content), else the
HTML `<title>`, else the file name. Images and attachments are queued as blob effects (kind 4). `export` needs the
bytes of the blobs the content uses (`referencedBlobs` lists a notebook's); missing images export as their alt text.

### 7.3 What each format keeps

| Format | Kept | Lost / approximated |
|---|---|---|
| OneNote → Notes | hierarchy, section colours, page levels and times, outlines in reading order (top→bottom, then left→right), headings (`title` → H1), quotes, code, lists (nesting by outline level, start numbers), tables, run marks incl. text colour and highlight, links, built-in and custom tags (to-do state), pictures, attached files, ink | fonts and font sizes, outline indentation of non-list paragraphs, list number formats (roman/letters → decimal), `onenote:` links outside the import (text), what `fmt-onenote` reports (`onenote.*` warnings) |
| Canvas rule | a page with ink, or with ≥ 2 outlines side by side (non-overlapping horizontal ranges; outlines without a stored width count as overlapping) is a canvas page | ink lifted out of text is placed at the page origin (`notes.onenote.inkPosition`) |
| Markdown | CommonMark + GFM tables / task lists / strikethrough, underline/sub/sup/highlight as inline HTML, page links, tag markers, images (`data:` URIs; in a section zip `assets/`) | colours, table cell structure beyond one line (`<br>`), image size, attachments (page export: `📎 name`; zip: a link to `assets/`); import: other raw HTML dropped (`notes.md.html`), remote images stay links (`notes.image.remote`) |
| HTML | everything of §7.1 except canvas data (colours via `style="color/background-color"`, images and attachments as `data:` URIs) | import: scripts/styles/frames/objects/forms and all other attributes (`notes.html.removed`), unsafe links (`notes.link.unsafe`), remote and SVG images (`notes.image.remote`, `notes.image.unsupported`) |
| .docx | headings, paragraphs, lists (Word default numbering, start numbers), task items (`☐`/`☑`), quotes (`Quote` style), code blocks (`SourceCode` style, Courier New), tables (`colspan`), images, links, run marks, colours, highlight (Word's palette), tag markers | code-block language, `rowspan`, attachments (`📎 name`), page links (title text), rules (a bottom border; not re-imported); import: drawings (`docx.drawing`), footnotes (`docx.note`), tables of contents (`docx.toc`), fields → their text (`docx.field`), vertical merges (`docx.table.vmerge`) |

Warning codes of `notes-convert`: `notes.link.unsafe`, `notes.image.remote`, `notes.image.missing`,
`notes.image.unsupported`, `notes.html.removed`, `notes.md.html`, `notes.onenote.link`, `notes.onenote.inkPosition`,
`docx.drawing`, `docx.field`, `docx.note`, `docx.toc`, `docx.table.vmerge`, `docx.image.missing`; plus the readers'
own (`onenote.*`, `docx.*` from `fmt-docx`). Shape: `{ code, params?, text, count }` (`ConvertWarning`).
