# Task P2-1b – `engine-formula`: reference adjustment + insert/delete rows/columns

Branch `p2/engine-structural`, worktree `/home/bojan/rusuite-wt/p2-engine-structural`. Scope: `crates/engine-formula/src/transform.rs` (new), `src/engine.rs` (new methods only), `src/graph.rs` (only if a removal/rebuild helper is missing), `src/lib.rs` (module + re-exports), `tests/transform.rs`, `tests/engine.rs` (append). Do not touch `ast.rs`, `eval.rs`, `functions/**`, the TSVs.

## Part A – `transform.rs`: pure AST rewriting (Excel rules)
```rust
pub enum StructuralOp { InsertRows { at: u32, count: u32 }, DeleteRows { at: u32, count: u32 }, InsertCols { at: u32, count: u32 }, DeleteCols { at: u32, count: u32 } }  // 0-based `at`; insert happens BEFORE row/col `at`
pub struct AdjustContext<'a> { pub host_sheet: &'a str /* sheet the formula lives on */, pub target_sheet: &'a str /* sheet being modified */, pub op: StructuralOp }
pub fn adjust_references(expr: &Expr, ctx: &AdjustContext) -> Expr;
pub fn offset_relative(expr: &Expr, d_row: i64, d_col: i64) -> Expr;      // copy/paste: relative parts move, absolute parts stay; out of bounds → Error(Ref)
```
Rules for `adjust_references` (a reference is affected only if it points at `target_sheet`: explicit sheet name equal case-insensitively, or no sheet name and `host_sheet == target_sheet`):
- Insert rows at `at`, count `n`: a cell with row ≥ at → row + n. Area `r0..=r1`: if `at <= r0` → both shift; if `r0 < at <= r1` → r1 += n (range grows); if `at > r1` → unchanged. Whole-column refs unchanged; whole-row refs behave like cells on their rows.
- Delete rows `at..at+n`: a cell inside the span → `Expr::Error(ErrorKind::Ref)`; a cell after → row − n. Area: if the span covers the whole area → `#REF!`; otherwise clip the deleted part out and shift the remainder (Excel shrinks). Whole-row refs likewise.
- Columns: symmetric. Absolute flags do not affect structural adjustment. Both corners of an area are re-normalized after adjustment.
- Rows/cols operations never change references on other sheets.
- `offset_relative`: `$`-anchored parts stay; relative row/col move by the delta; a result < 0 or > MAX → `Error(Ref)`; whole-column refs move only in the column dimension (and vice versa); sheet names untouched.

## Part B – `Engine` structural methods
```rust
pub fn insert_rows(&mut self, sheet: SheetId, at: u32, count: u32) -> Result<Recalc, EngineError>;
pub fn delete_rows(&mut self, sheet: SheetId, at: u32, count: u32) -> Result<Recalc, EngineError>;
pub fn insert_cols(..); pub fn delete_cols(..);
pub fn cells(&self, sheet: SheetId) -> impl Iterator<Item = (CellCoord, &CellContent)>;   // all non-empty contents (the REPL and model-sheet need it)
```
Behaviour: move the contents and computed values of the affected cells (deleting discards the deleted cells); rewrite every formula in the workbook through `adjust_references` (host sheet = the formula's sheet), storing the new AST and regenerating `text` as `"=" + ast.to_string()`; rebuild graph edges for every formula whose AST changed or whose cell moved (rebuilding the whole graph is acceptable if simpler – say so); recompute `used_range`; then recalc everything affected (a full `recalc_all` is acceptable for MVP – document the cost) and return a `Recalc` whose `changed` lists every cell whose value or position changed (moved cells count as changed at their new coordinate; the UI will redraw the region anyway). Out-of-range (`at > MAX_ROW`, overflow past the sheet end) → `EngineError::InvalidCoord`.

## Tests
- `tests/transform.rs`: table-driven over formulas × ops with expected printed results, at least: `=A5` insert 2 rows at 1 → `=A7`; at 10 → `=A5`; `=SUM(A2:A5)` insert at 3 → `=SUM(A2:A7)`; insert at 1 → `=SUM(A4:A7)`; insert at 5 (0-based row 5 = row "6") → unchanged; delete rows 1..3 with `=A3` → `#REF!`; `=A10` → `=A7`; `=SUM(A2:A10)` delete 3..5 → `=SUM(A2:A7)`; delete 1..10 covering → `=SUM(#REF!)`; `=Sheet2!A5` with target Sheet1 → unchanged; host Sheet2 with `=A5` and target Sheet2 → shifted; `=A:A` row insert → unchanged; `=1:1` insert at 0 → `=2:2`; column cases mirrored (`=C1` insert cols at 1 → `=D1`, `=$C$1` → `=$D$1`); `offset_relative("=A1+$B$2+C$3+$D4", 2, 1)` → `=B3+$B$2+D$3+$D6`; offset out of range → `#REF!`.
- `tests/engine.rs` additions: set A1=1, A2=`=A1*2`, A3=`=SUM(A1:A2)`; `insert_rows(sheet, 1, 1)` → A1=1, A2 empty, A3=`=A1*2`→2, A4=`=SUM(A1:A3)`→3, formula texts updated; `delete_rows(sheet, 0, 1)` afterwards → the former A3 becomes A2 with `#REF!*2`; cross-sheet formula on Sheet2 referencing Sheet1!A3 follows the move; `cells()` yields the moved contents; graph consistency: after the move, changing A1 recalculates the moved formulas.
```
