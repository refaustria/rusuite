# Task P1-8 – `engine-formula` façade: `Engine`

Branch `p1/engine`, worktree `/home/bojan/rusuite-wt/p1-engine`. Scope: `crates/engine-formula/src/engine.rs` (new), `src/lib.rs` (module + re-exports), `tests/engine.rs`, and the type unification below. Function batches are running in parallel under `src/functions/**` – do not touch that directory except as stated in "Type unification".

## Goal
One object that `model-sheet`, the REPL and the IPC layer use: holds cell contents per sheet, the dependency graph and the registry, recalculates incrementally, and exposes computed values. Everything else in the crate stays usable standalone.

## Type unification (do first, as its own logical step inside the single commit)
`eval.rs` and `graph.rs` each define `SheetId`, `CellCoord`, `RangeRef`. Move ONE definition of each into a new `src/coord.rs` (serde + Copy/Eq/Hash/Ord/Debug; keep every helper both files currently provide: `CellCoord::new`, `RangeRef::new/contains/clipped/union/at/is_whole_columns/is_whole_rows`), and make `eval` and `graph` `pub use crate::coord::*` so existing paths (`engine_formula::eval::CellCoord`, `engine_formula::graph::CellCoord`) keep compiling. `tests/reference_suite.rs`, `tests/graph.rs` and the functions' tests must compile unchanged (functions use `crate::eval::CellCoord` – keep that path valid).

## API
```rust
pub enum CellContent { Empty, Value(Value) /* constant: Number/Text/Bool/Error */, Formula { text: String, ast: Expr } }
pub struct Engine { .. }
impl Engine {
    pub fn new() -> Self;                                   // registry = FunctionRegistry::with_builtins(), one sheet "Sheet1"
    pub fn with_registry(registry: FunctionRegistry) -> Self;
    pub fn add_sheet(&mut self, name: &str) -> Result<SheetId, EngineError>;   // DuplicateSheet (case-insensitive)
    pub fn rename_sheet(&mut self, id: SheetId, new_name: &str) -> Result<(), EngineError>;  // formulas keep working: graph precedents are by SheetId; re-resolve `Precedent::Unresolved` entries that match the new name; formula TEXT is NOT rewritten (ROADMAP)
    pub fn sheet_id(&self, name: &str) -> Option<SheetId>;
    pub fn sheet_name(&self, id: SheetId) -> Option<&str>;
    pub fn sheets(&self) -> impl Iterator<Item = (SheetId, &str)>;
    /// Parse `input` like a user typed it: leading `=` → formula (ParseError → stores `CellContent::Value(Error(Name))`? NO: return the ParseError and leave the cell unchanged), `TRUE`/`FALSE` (case-insensitive) → Bool, a number literal → Number, an error literal → Error, otherwise Text; a leading apostrophe forces Text (`'0123`). Empty string → Empty.
    pub fn set_input(&mut self, c: CellCoord, input: &str) -> Result<Recalc, EngineError>;
    pub fn set_content(&mut self, c: CellCoord, content: CellContent) -> Result<Recalc, EngineError>;
    pub fn clear(&mut self, c: CellCoord) -> Result<Recalc, EngineError>;
    pub fn content(&self, c: CellCoord) -> &CellContent;
    pub fn value(&self, c: CellCoord) -> Value;             // computed value; constants return themselves; Empty for blank; a formula in a cycle → Error(... see below)
    pub fn formula_text(&self, c: CellCoord) -> Option<&str>;
    pub fn recalc_all(&mut self) -> Recalc;                 // full_order; used after bulk load
    pub fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)>;
    pub fn set_now(&mut self, now: fn() -> f64);            // test hook for TODAY/NOW
}
pub struct Recalc { pub changed: Vec<CellCoord> /* cells whose VALUE changed, sorted */, pub cycle: Option<Cycle> }
pub enum EngineError { Parse(ParseError), DuplicateSheet(String), UnknownSheet(SheetId), InvalidCoord }
```
- Every `set_*` updates storage, updates the graph (`set_formula`/`remove_formula`), computes `recalc_order(&[c])`, evaluates in order via `evaluate` with `EvalContext { provider: self-as-CellProvider, current: cell, now }`, stores computed values in a per-sheet `HashMap<(u32,u32), Value>` cache, and returns the cells whose value actually changed (compare old vs new `Value`; f64 by bit pattern is fine).
- Cycle: cells in the cycle get `Value::Error(ErrorKind::Ref)`? NO – Excel shows 0 and a warning; we store a dedicated marker: add `ErrorKind::Circ` is NOT allowed (AST is frozen). Decision: cells in a cycle get `Value::Error(ErrorKind::Num)` and `Recalc.cycle` carries the cycle so the UI can warn. Document this in the module docs. Cells outside the cycle still recalculate.
- Volatile functions: if a formula's AST calls `NOW` or `TODAY` (case-insensitive name match in `Expr::Call`), the cell is registered in a `volatile` set and is always included in every recalc (append to the changed set before `recalc_order`).
- `CellProvider` impl for the engine's storage: `value()` reads constants and the computed cache; `used_range` tracks max row/col of non-empty content per sheet (recomputed lazily or maintained incrementally – your choice, document it).
- Storage: per sheet `HashMap<(u32, u32), CellContent>`; no dense grids.

## Tests (`tests/engine.rs`)
- Set A1=1, A2=`=A1*2`, A3=`=A2+A1`; `value(A3)`=3; set A1=10 → `changed` == [A2, A3], `value(A3)`=30; set A2 to constant 5 → A3=15 and A1 change no longer touches A2.
- `set_input` typing rules: `"=1+"` → `Err(Parse)` and the cell unchanged; `"TRUE"`, `"true"`, `"  12 "`? (follow Excel: leading/trailing spaces keep it text) `"12"`, `"1e3"`, `"#N/A"`, `"'0123"` → Text "0123", `"abc"`, `""`.
- Cross-sheet: add sheet "Data", `Sheet1!A1 = =Data!A1*2`, set Data!A1; rename "Data" to "Facts" → the value still updates on change; a formula referencing a not-yet-existing sheet evaluates to `#REF!` and starts working once `add_sheet` creates it (via Unresolved re-resolution).
- Cycle: A1=`=B1`, B1=`=A1` → `Recalc.cycle` is Some; both values are `#NUM!`; C1=`=1+1` still computes; breaking the cycle (B1=1) makes A1=1 and `cycle` None.
- Range dependency: B1=`=SUM(A1:A100)`; set A50 → B1 changes; set A101 → `changed` empty.
- Volatile: A1=`=TODAY()` with `set_now(|| 45306.75)` → 45306; after `set_now(|| 45307.5)`, ANY unrelated edit recalculates A1 → 45307.
- `recalc_all` after loading 1 000 formulas via `set_content` without intermediate recalcs is consistent with incremental results.
- Scale: 50 000-cell chain built with `set_input`, then change the head: must finish in < 10 s debug (report the actual time; incremental recalc per `set_input` while building is O(n²) in the worst case – if it is too slow, add `Engine::begin_batch()/end_batch()` that defers recalculation, document it, and use it in the test).

## Report
List any evaluator or graph API you had to add or change, and anything the model-sheet crate (Phase 2) will need from the engine (e.g. row/column insert/delete shifting – NOT in scope now).
