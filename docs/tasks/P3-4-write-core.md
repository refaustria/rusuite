# Task P3-4 – `write-core`: commands, patches, sync protocol implementation (ADR 0007)

Branch `p3/write-core`, worktree `/home/bojan/rusuite-wt/p3-write-core`. Scope: `apps/write/core/**` (replace the placeholder crate from P3-3), generated TS in `apps/write/src/generated/`, `crates/model-text/src/**` ONLY for small additive helpers you need (say which), `crates/app-common` only if a generic gap appears (say which). Not: shells, `apps/write/src/**` (except `generated/`), fmt-docx (parallel task).

Read first: ADR 0001, 0002 (+amendment), 0005, 0006, **0007** (normative); `crates/model-text/src/*.rs`; `crates/app-common/src/*.rs`; `apps/calc/core/src/*.rs` (mirror its structure: `doc.rs`, `dispatch.rs`, `wire.rs`, ts-rs export via `cargo test`, `.cargo/config.toml` TS_RS_EXPORT_DIR); `apps/write/core/**` as scaffolded.

## `WriteDocument` (implements `app_common::Document`)
```rust
pub struct WriteDocument { doc: model_text::Document, source_name: Option<String> }
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WriteCommand {
    InsertText { block: NodeId, offset: u32, text: String, props: Option<RunProperties> },   // offset in chars (Unicode scalar values) over the paragraph's inline text where Image/Break count as 1; props None = inherit from the run containing offset-1 (or the first run)
    DeleteText { block: NodeId, from: u32, to: u32 },
    ReplaceText { block: NodeId, from: u32, to: u32, text: String },
    SetRunProps { block: NodeId, from: u32, to: u32, patch: RunProperties },               // merge over existing runs, splitting runs at from/to; `Some(false)` clears a toggle
    SplitParagraph { block: NodeId, offset: u32, new_id: i64 /* temp (negative) */ },      // second half becomes a new paragraph after `block` with same props (numbering kept; heading style → Normal for the new one, like Word)
    JoinWithPrevious { block: NodeId },                                                    // previous paragraph absorbs inlines
    SetParagraphProps { blocks: Vec<NodeId>, patch: ParagraphProperties },
    SetStyle { blocks: Vec<NodeId>, style: String },                                       // must exist in the stylesheet
    ApplyList { blocks: Vec<NodeId>, kind: ListKind /* Bullet | Decimal | None */ },        // Rust finds/creates a NumberingDef (reuse the def of an adjacent paragraph with the same kind, else allocate); None removes numbering
    IndentList { blocks: Vec<NodeId>, delta: i8 },                                         // level ± within 0..=8
    InsertBlocks { after: Option<NodeId> /* None = at start of body or of `parent` */, parent: Option<NodeId> /* table cell */, blocks: Vec<Block> /* temp ids */ },
    DeleteBlocks { ids: Vec<NodeId> },
    ReplaceBlocks { ids: Vec<NodeId>, blocks: Vec<Block> },                               // ADR 0007 §3 fallback; ids must be siblings in order; new blocks may carry temp ids or reuse the old ids
    InsertImage { block: NodeId, offset: u32, content_type: String, bytes_base64: String, width: Emu, height: Emu, alt: Option<String> },
    InsertTable { after: Option<NodeId>, parent: Option<NodeId>, rows: u32, cols: u32, new_ids: Vec<i64> /* table, rows, cells in order */ },
    InsertTableRow { table: NodeId, at: u32, new_ids: Vec<i64> }, DeleteTableRow { table: NodeId, at: u32 },
    InsertTableCol { table: NodeId, at: u32, new_ids: Vec<i64> }, DeleteTableCol { table: NodeId, at: u32 },
    SetCellProps { cells: Vec<NodeId>, patch: CellProperties }, SetTableProps { table: NodeId, patch: TableProperties },
    SetPage { patch: PageSetupPatch },
    FindReplace { find: String, replace: String, match_case: bool, whole_word: bool, all: bool },   // all=false replaces the first match after the document start; returns count in the patch's `info`
    Compound { commands: Vec<WriteCommand> },
}
pub struct WritePatch { pub replaced: Vec<Block> /* full authoritative blocks (top-level or cell-level; a changed cell ⇒ the whole table is sent) */, pub inserted: Vec<InsertedBlock { after: Option<NodeId>, parent: Option<NodeId>, block: Block }>, pub deleted: Vec<NodeId>, pub id_map: Vec<(i64, NodeId)>, pub styles: Option<StyleSheet>, pub numbering: Option<Numbering>, pub page: Option<PageSetup>, pub info: Option<String> /* e.g. "3 replacements" */ }
```
- Every command returns an inverse (undo via `app_common::Host`): text commands invert to text commands with the removed text/props captured; structural ones to `ReplaceBlocks`/`InsertBlocks`/`DeleteBlocks` with captured blocks. Temp ids resolve to real ids in the inverse.
- Validation: unknown ids, offsets beyond the paragraph length, split at 0 or at end allowed (creates an empty paragraph), deleting the last block of a cell/body keeps one empty paragraph. Errors → `DispatchError { code: "invalid_command" | "unknown_block" | "bad_offset" … }`.
- `FindReplace` works on paragraph text across runs (a match may span runs; props of the first matched char are kept).
- After every command: `doc.normalize()` on touched paragraphs only (merge equal adjacent runs).

## Dispatch (`apps/write/core/src/dispatch.rs`)
`Request = Apply{command} | Undo | Redo | Load /* full Document JSON */ | GetDocument | NewDocument | GetMedia{id} | DocumentState | MarkSaved{name?}` (open/save docx come with P3-7); `ResponseBody = Patch{envelope: Envelope<WritePatch>} | Document{doc: model_text::Document} | Media{content_type, bytes_base64} | DocumentState{…}`. ts-rs exports to `apps/write/src/generated/` (TS mirrors of model-text types the same way calc-core mirrors model-sheet's, unless you add ts-rs derives behind a feature to model-text – allowed and preferred if it keeps the wasm build clean; document the choice).

## Tests
- Per command: apply → expected document (insta JSON snapshots for structural ones) → undo restores an identical document (property loop over a scripted sequence, like calc-core).
- Offsets with multi-byte chars (`é`, emoji) and inline images; `SetRunProps` splitting runs; `ApplyList` reusing an adjacent list's numId; `IndentList` bounds; `SplitParagraph` on a heading → new paragraph is Normal; `JoinWithPrevious` on the first block → error; `ReplaceBlocks` with temp ids → `id_map`; `FindReplace` across runs, whole-word, case; table row/col ops keep rectangular shape; dispatch JSON roundtrip incl. an error.
- `cargo check --target wasm32-unknown-unknown -p write-core`; rustdoc clean; generated TS committed and stable.
