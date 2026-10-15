# Task P2-4 – `app-common` document host + `calc-core` commands/patches (+ P2-1c model-sheet structural ops)

Branch `p2/app-common`, worktree `/home/bojan/rusuite-wt/p2-app-common`. Scope: `crates/app-common/**`, new crate `apps/calc/core` (package `calc-core`, add to workspace members), `crates/model-sheet/src/workbook.rs` (ONLY the structural methods of P2-1c below), `apps/calc/src/generated/` and `packages/ui-shared/src/generated/` (ts-rs output), `docs/adr/0002-ipc-strategy.md` (append an "Amendment 2026-10-15" section describing the final shapes). Not in scope: Tauri/wasm shells, UI, fmt-xlsx (parallel tasks).

Read first: ADR 0001, 0002, 0004, 0005; `crates/model-sheet/src/*.rs`; `crates/engine-formula/src/{engine.rs,transform.rs,coord.rs}`; `apps/calc/src-tauri/src/lib.rs` (current `ping` shell, to understand what the shells will wrap – do not edit it).

## P2-1c (do first, own commit "P2-1c: model-sheet insert/delete rows/cols")
`Workbook::insert_rows/delete_rows/insert_cols/delete_cols(sheet, at, count) -> Result<Recalc, Error>`: call the engine's method, then move `cell_styles` keys with `engine_formula::transform::StructuralOp::map_cell` (drop the deleted), shift `cols`/`rows` dimension maps (insert: entries at ≥ at move by count, new indices get no entry; delete: remove the span, shift the rest). Tests: styles and widths follow the move; deleted cells' styles vanish; formulas (via engine) still correct.

## app-common (crate)
Transport-agnostic document hosting shared by all three apps:
```rust
pub struct Revision(pub u64);
pub trait Document: Sized {
    type Command: Serialize + DeserializeOwned + Clone;
    type Patch: Serialize + Default;                 // mergeable: fn merge(&mut self, other: Self)
    type Error: std::error::Error;
    fn apply(&mut self, cmd: &Self::Command) -> Result<Applied<Self::Command, Self::Patch>, Self::Error>;
}
pub struct Applied<C, P> { pub patch: P, pub inverse: Option<C> }   // None = not undoable (e.g. view-only commands)
pub struct Host<D: Document> { .. }   // doc, undo: Vec<C>, redo: Vec<C>, revision, dirty, undo_limit (default 200)
impl<D: Document> Host<D> {
    pub fn new(doc: D) -> Self; pub fn doc(&self) -> &D; pub fn doc_mut(&mut self) -> &mut D /* bypasses undo – for loading */;
    pub fn apply(&mut self, cmd: D::Command) -> Result<Envelope<D::Patch>, D::Error>;   // pushes inverse, clears redo, bumps revision, sets dirty
    pub fn undo(&mut self) -> Result<Option<Envelope<D::Patch>>, D::Error>; pub fn redo(..);
    pub fn can_undo/can_redo; pub fn revision; pub fn is_dirty; pub fn mark_saved;
}
pub struct Envelope<P> { pub revision: Revision, pub patch: P, pub can_undo: bool, pub can_redo: bool, pub dirty: bool }
pub struct DispatchError { pub code: &'static str, pub message: String }   // the one error shape that crosses the wire
```
- `Serialize/Deserialize` + `#[derive(ts_rs::TS)] #[ts(export, export_to = "../../packages/ui-shared/src/generated/")]` on the wire types (`Revision`, `Envelope<P>` generic → export the concrete Calc instantiation from calc-core instead; export `DispatchError` and `Revision` from app-common). Add `ts-rs` (features `serde-compat`) as a dependency; exports happen when running `cargo test -p app-common -p calc-core` (ts-rs convention); commit the generated `.ts` files and add a CI step that runs the tests and fails on `git diff --exit-code` of the generated dirs (append to `.github/workflows/ci.yml` rust job).
- Unit tests: apply/undo/redo ordering, redo cleared by a new command, undo limit, non-undoable command does not touch stacks, revision monotonic, dirty/mark_saved.

## calc-core (`apps/calc/core`, package `calc-core`, lib; deps: app-common, model-sheet, engine-formula, core-model, serde, serde_json, ts-rs, thiserror)
```rust
pub struct CalcDocument { workbook: Workbook }   // implements app_common::Document
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CalcCommand {
    SetInput { sheet: u32, row: u32, col: u32, input: String },
    ClearRange { sheet, r0, c0, r1, c1 },
    ApplyStyle { sheet, r0, c0, r1, c1, patch: CellStyle },           // merge semantics of model-sheet
    SetColWidth { sheet, col, width: Option<f64> }, SetRowHeight { sheet, row, height: Option<f64> },
    SetColHidden { .. }, SetRowHidden { .. },
    InsertRows { sheet, at, count }, DeleteRows { .. }, InsertCols { .. }, DeleteCols { .. },
    AddSheet { name: String }, RenameSheet { sheet, name: String },
}
pub struct CellView { pub row: u32, pub col: u32, pub input: String, pub display: String, pub kind: CellKind /* Empty|Number|Text|Bool|Error – for default alignment */, pub style: u32 }
#[derive(Default)] pub struct CalcPatch { pub sheets: Option<Vec<SheetInfo>>, pub cells: Vec<SheetCells { sheet, cells: Vec<CellView> }>, pub cols: Vec<..>, pub rows: Vec<..>, pub styles: Option<Vec<CellStyle>> /* full table when it changed */, pub cycle: Option<String> /* human-readable cycle description */, pub structural: Option<StructuralChange { sheet, op }> /* tells the UI to drop its cache for that sheet */ }
pub struct RegionSnapshot { pub sheet: u32, pub r0, c0, r1, c1, pub cells: Vec<CellView>, pub cols: Vec<ColView>, pub rows: Vec<RowView>, pub format: SheetFormat }
pub struct WorkbookInfo { pub sheets: Vec<SheetInfo { id: u32, name: String }>, pub styles: Vec<CellStyle>, pub revision: Revision }
impl CalcDocument { pub fn new() -> Self; pub fn info(&self) -> WorkbookInfo; pub fn snapshot(&self, sheet, r0, c0, r1, c1) -> Result<RegionSnapshot, CalcError>; pub fn workbook(&self) -> &Workbook; pub fn workbook_mut(&mut self) -> &mut Workbook; pub fn from_workbook(Workbook) -> Self; }
```
- `display`: number → formatted with the cell's number format when it is not `General` (implement `display_value(&Value, number_format: Option<&str>) -> String` in calc-core: `General` → `engine_formula::value::format_general`; date formats → serial to date text using `engine_formula`'s TEXT machinery if it is reachable; if `functions::text::numfmt` is private, expose it as `pub fn engine_formula::format_number(f64, code) -> Option<String>` – that one-line `pub` re-export in `crates/engine-formula/src/lib.rs` is allowed in this task); booleans `TRUE/FALSE`; errors as `#…`; text as is.
- Inverses: `SetInput` → `SetInput` with the previous input (or ClearRange for an empty cell); `ClearRange` → a `RestoreCells { cells: Vec<(row,col,input,style)> }` internal command (add it to the enum as `#[serde(skip)]`-free variant – it must be serializable; mark it in docs as internal); `ApplyStyle` → `RestoreStyles { cells: Vec<(row,col,style_id)> }`; dimension setters → the previous value; `InsertRows` → `DeleteRows` and vice-versa (DeleteRows' inverse = `InsertRows` + `RestoreCells` of the deleted contents/styles + restore of row infos → model it as a `Compound(Vec<CalcCommand>)` variant applied in order); `AddSheet` → not undoable for MVP (`inverse: None`), `RenameSheet` → `RenameSheet`.
- Patch content after each command: the cells whose value/input/style changed (from `Recalc.changed` ∪ edited cells, as `CellView`s), dimension changes, `styles` when the table grew, `structural` for insert/delete.
- Implement `app_common::Document` for `CalcDocument`; a `pub type CalcHost = app_common::Host<CalcDocument>`; a top-level `pub fn dispatch(host: &mut CalcHost, request_json: &str) -> String` that decodes `Request { Apply(CalcCommand) | Undo | Redo | Snapshot{..} | Info | NewDocument | LoadSnapshotJson(String) | SaveSnapshotJson }` and returns `Response { Ok(ResponseBody) | Err(DispatchError) }` as JSON – this is the exact function both shells will call (ADR 0005 §3). Export TS types with ts-rs into `apps/calc/src/generated/` (`export_to = "../src/generated/"` relative to the crate).
- Tests: every command applies and undoes to an identical snapshot (property-style loop over a scripted sequence: apply all, undo all → equals initial `to_snapshot()`; redo all → equals final); patches contain exactly the changed cells for a dependent-formula case; `dispatch` JSON roundtrip for each request kind incl. an error case (invalid JSON → `DispatchError { code: "bad_request" }`); region snapshot of a sparse sheet; display formatting of `0.00`, `#,##0`, `yyyy-mm-dd` (45306 → `2024-01-15`), General.
- `cargo check -p calc-core -p app-common --target wasm32-unknown-unknown` passes (install target with rustup; ts-rs must be an optional dependency behind a `ts` feature if it does not build for wasm – check).

## Report
The final wire shapes (paste the generated `.ts` for `CalcCommand` and `CalcPatch`), anything you changed outside the listed scope, and what the shells (next task) need.
