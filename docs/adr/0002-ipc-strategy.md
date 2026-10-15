# ADR 0002 – IPC strategy between webview and Rust

- Status: accepted
- Date: 2026-10-15

## Context
Tauri 2 offers `invoke` commands (request/response) and events (backend → frontend push). We need a predictable way for the UI to send edits and receive model changes (ADR 0001).

## Decision
1. **Commands in, patches out.** The frontend calls a single generic `apply(doc_id, Command)` Tauri command plus a handful of query commands (`open`, `save`, `snapshot(region)`, `undo`, `redo`). `Command` is a serde-tagged enum defined per app in Rust (`app-common` holds the shared envelope and document-id types). Rust replies synchronously with a `Patch` describing what changed (list of changed cells / paragraphs / shapes, plus new undo/redo availability).
2. **Region snapshots, not whole documents.** `snapshot` returns only the requested region (sheet viewport, paragraph range, slide). Opening a document returns metadata and a first region.
3. **Events only for unsolicited changes.** Tauri events are used for things the UI did not ask for: recalculation finished asynchronously, file changed on disk, autosave status. Everything triggered by the UI comes back as the `invoke` reply.
4. **Wire format** is `serde_json` via Tauri's default serializer. All IPC types live in Rust and TS types are generated from them (tool chosen in Phase 2; candidates `ts-rs`, `specta`). No hand-maintained duplicate type definitions.
5. **Versioning.** Every `Patch` carries a monotonically increasing `revision`; the frontend discards out-of-order replies.

## Consequences
- The frontend never computes document state itself; it renders patches.
- IPC types are a public, tested surface of the Rust crates (`app-common`).
- Binary payloads (images) are not sent through JSON; they are served to the webview via a Tauri asset protocol handler (decided in Phase 3 when images arrive).

## Alternatives rejected
- One Tauri command per operation: large surface, hard to version, unfriendly to undo/redo.
- Streaming full document JSON after every edit: simple but fails the 100k-cell / 200-page targets.

## Amendment 2026-10-15 – final shapes (P2-4)
Together with ADR 0005 the IPC surface is now one function per app core, identical for the Tauri and the wasm shell: `calc_core::dispatch(&mut CalcHost, request_json: &str) -> String`.

- **Tooling.** TS types are generated with `ts-rs` 12 (`serde-compat`). `.cargo/config.toml` sets `TS_RS_EXPORT_DIR` to the repository root, so `export_to` paths are repo-relative: shared types (`app-common`) go to `packages/ui-shared/src/generated/`, Calc types (`calc-core`) to `apps/calc/src/generated/`. `cargo test -p app-common -p calc-core` regenerates them; CI fails when the committed files differ. `core-model`/`model-sheet` stay free of `ts-rs`: TS-only mirror types (`app_common::wire`, `calc_core::wire`) copy their serde shape and are attached with `#[ts(as = ..)]`; tests round-trip fully populated values through real and mirror types to catch drift.
- **Request** (`{"type": ...}`): `apply {command}`, `undo`, `redo`, `snapshot {sheet,r0,c0,r1,c1}`, `info`, `newDocument`, `loadSnapshotJson {json}`, `saveSnapshotJson`. One host per open document in the shell; the `doc_id` of the original decision is deferred until a shell hosts several documents.
- **Response**: `{"ok": ResponseBody}` or `{"err": DispatchError}`. `ResponseBody` (`{"type": ...}`): `patch {envelope}`, `snapshot {snapshot}`, `info {info}`, `snapshotJson {json}`. `DispatchError {code, message}` is the only error shape on the wire; codes: `bad_request` (undecodable request), `unknown_sheet`, `invalid_range`, `range_too_large`, `invalid_formula`, `duplicate_sheet`, `invalid_coord`, `unknown_style`, `invalid_dimension`, `invalid_snapshot`, `internal`.
- **Envelope<P>** (generic, shared): `{revision, patch, canUndo, canRedo, dirty}`. `revision` is a JSON number, bumped by every apply/undo/redo/new/load (never reset); an undo/redo with an empty stack returns an empty patch with the unchanged revision.
- **CalcCommand** (`{"type": ...}`, camelCase): `setInput`, `clearRange`, `applyStyle {patch: CellStyle}` (merge), `setColWidth`/`setRowHeight` (`null` = default), `setColHidden`/`setRowHidden`, `insertRows`/`deleteRows`/`insertCols`/`deleteCols {at,count}`, `addSheet` (not undoable yet), `renameSheet`; internal inverse-only variants `restoreCells`, `restoreStyles`, `restoreCols`, `restoreRows`, `compound`.
- **CalcPatch**: `sheets` (full list or `null`), `cells` (`[{sheet, cells: CellView[]}]`: every cell whose input, value or effective style changed), `cols`/`rows` (`[{sheet, cols|rows}]`), `styles` (full table or `null` when it did not grow), `cycle` (text or `null`), `structural` (`[{sheet, kind, at, count}]`: the UI drops its cache for that sheet and re-requests a snapshot; `cells` omits that sheet). `CellView = {row, col, input, display, kind: empty|number|text|bool|error, style}` with the *effective* style id and the value formatted with its number format.
- **RegionSnapshot** `{sheet, r0, c0, r1, c1, cells, cols, rows, format}`: cells with content or an own style, non-default rows/columns of the region; empty cells take the row, else column, else default style. **WorkbookInfo** `{sheets, styles, revision}`.
- **Undo** lives in `app_common::Host`: every command returns its inverse command; structural inverses also restore the original text of every formula the operation rewrote (reference adjustment is not reversible in general). The style table is append-only and is not shrunk by undo.

## Amendment 2026-10-15 – file IO (P2-7)
- **Open/save go through `dispatch`** so both shells share them: `openXlsx {bytesBase64, name}` → `opened {info, warnings, envelope}` (replaces the document like `newDocument`: undo cleared, clean, revision bumped; `warnings` lists content the reader dropped or approximated; `envelope` carries an empty patch and the new host state); `saveXlsx` → `saved {bytesBase64, suggestedName}` and marks the document saved; `markSaved` and `documentState` → `documentState {dirty, revision, name}` (`name` = the opened file name, `null` for a new document). New error code `invalid_file` (bytes are not a readable `.xlsx`); undecodable base64 is `bad_request`, a failed write `internal`.
- **Bytes cross the wire as standard base64 strings** inside the JSON, identical for Tauri and wasm. This is binary-safe and keeps one transport; the ~33 % size overhead is acceptable for workbooks (images remain under the asset-protocol plan above). `calc_core::CalcDocument` keeps the file's `XlsxContext` (theme, default font) and the source name for the next save.
- **The core never touches the file system** (ADR 0005). Picking and writing files is shell-specific and lives on the frontend `Backend` next to `dispatch`: `openFile() → {name, bytesBase64} | null`, `saveFile(suggestedName, bytesBase64) → boolean`, `setTitle(title)`. Tauri implements them with the commands `open_file_dialog` / `save_file_dialog` (native dialogs from `tauri-plugin-dialog`, run off the main thread; Rust reads/writes the file with `std::fs`, so no fs plugin permissions are exposed to the webview) and `Window::setTitle`; the web build uses a hidden `<input type=file>` + `FileReader`, a `Blob` download via `<a download>`, and `document.title`. A save is therefore `dispatch(saveXlsx)` followed by `saveFile`. Because `saveXlsx` marks the document saved before the user picked a location, a cancelled `saveFile` leaves it reported clean although nothing was written (known gap; the fix is a non-marking export followed by `markSaved` after a successful `saveFile`, which `markSaved` already allows).
- **Shell state.** Tauri keeps one `Mutex<CalcHost>` as managed state; the wasm shell keeps a `thread_local` `RefCell<CalcHost>` and installs a `js_sys::Date` clock (local time as an Excel serial) before every request, since replacing the document replaces the engine.
