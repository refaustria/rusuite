# ADR 0007 – Tiptap ↔ Rust synchronisation protocol for Write

- Status: accepted
- Date: 2026-10-15

## Context
Write's text layout and editing happen in Tiptap/ProseMirror (README: "the browser does the text layout"); the document of record lives in Rust (`model-text`, ADR 0001/0006). ProseMirror transactions are position-based and immediate; Rust commands must be validated and may run over Tauri IPC (milliseconds) or wasm (microseconds). The protocol must keep typing latency invisible, keep both sides convergent, and make undo/redo, find/replace and docx I/O Rust-only.

## Decision
1. **Optimistic local edit, authoritative confirmation.** ProseMirror applies the user's transaction immediately. The frontend translates every transaction into one `WriteCommand` (or a `Compound`), sends it through `dispatch` with the current `revision`, and receives a `WritePatch` listing the authoritative state of every block Rust changed. The frontend reconciles: for each patched block it compares Rust's block with its local node (structural equality after mapping); only on mismatch does it replace the node (mapping the selection through). Out-of-order replies (older revision) are discarded; on any `err` reply the frontend reloads the affected blocks from Rust.
2. **Block identity.** Every block-level node in the ProseMirror schema (paragraph, heading, table, tableRow, tableCell) carries an `id` attribute = `NodeId`. Nodes created locally (Enter, paste, list toggles) get a temporary negative id; the confirming patch carries `idMap: [[temp, real]]` and the frontend rewrites attributes.
3. **Command vocabulary: fine-grained for the common path, coarse for the rest.** Typing, deletion, mark changes, paragraph split/join, paragraph properties, list toggles, style application, image insertion and table structure edits have dedicated commands addressed by `(NodeId, char offset)`. Any transaction the mapper cannot express exactly is sent as `ReplaceBlocks { ids, blocks }` carrying the full affected top-level blocks (converted from ProseMirror to `model-text` JSON). This fallback is always correct, so the mapper can start small and grow.
4. **Lists.** `model-text` keeps docx semantics (numbering reference per paragraph, ADR 0006); the ProseMirror schema uses nested `bulletList/orderedList/listItem`. The TS mapping layer converts in both directions: consecutive paragraphs with the same `numId` become one list, levels become nesting; list commands (`ApplyList`, `IndentList`) are expressed on paragraphs. Rust owns numbering definitions (`NumberingDef` allocation).
5. **Undo/redo, find/replace, styles** are Rust commands (`app_common::Host`); ProseMirror's history plugin is disabled. Undo patches are ordinary `WritePatch`es.
6. **Snapshots.** Loading a document sends the full `Document` JSON (ADR 0006) once; the frontend builds the ProseMirror document from it. There are no region snapshots in Write (a 200-page document is a few MB of JSON; acceptable for MVP, revisit in Phase 5). Images are referenced by `MediaId` and fetched through `GetMedia { id }` → base64 (cached in the frontend, blob URLs).
7. **Wire format** as in ADR 0002/0005: JSON `Request`/`Response` through the same `dispatch` function in both shells; TypeScript types generated with ts-rs.

## Consequences
- The mapper (`apps/write/src/sync/`) is the one place that knows both schemas; it must be covered by property-style tests: `toPM(fromPM(doc)) == doc` for model documents and command translation tests per transaction type.
- Rust validates everything (offsets in char units, ids exist); invalid commands return `err` and trigger a block reload rather than corrupting the model.
- Collaboration/CRDTs remain out of scope (README non-goal); the protocol is single-writer.

## Alternatives rejected
- Sending ProseMirror `Step` JSON to Rust: ties the core to ProseMirror's position model and schema.
- Rust-first rendering (no optimistic apply): typing latency over Tauri IPC and IME composition breakage.
- Keeping ProseMirror history: two undo stacks that diverge after any Rust-side command.
