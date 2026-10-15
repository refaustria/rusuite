# Task P1-3 – `engine-formula`: dependency graph with incremental recalculation order and cycle detection

Branch: `p1/depgraph` (worktree `/home/bojan/rusuite-wt/p1-depgraph`). In scope: `crates/engine-formula/src/graph.rs` (new), one `pub mod graph;` line in `src/lib.rs`, `crates/engine-formula/tests/graph.rs`, `crates/engine-formula/benches/` NOT allowed. Nothing else: another agent is writing the evaluator (`value.rs`, `eval.rs`, `functions/`) in parallel on the same crate – you must not create or touch those files, and your module must depend only on `crate::ast` (`Expr`, `Reference`, `RangeKind`, `CellRef`).

## Goal
A pure data structure that knows, for every formula cell, which cells/ranges it reads, and can answer: "cell X changed – which formula cells must be recalculated, in what order, and is there a cycle?". It holds no values and does no evaluation; the engine façade (a later task) will drive it.

## API (`graph.rs`)
```rust
pub struct SheetId(pub u32);                       // keep identical to the evaluator's definition: `pub struct SheetId(pub u32)` with Copy, Eq, Hash, Ord, Debug; the façade task will unify the two into one shared type – put yours in graph.rs for now.
pub struct CellCoord { pub sheet: SheetId, pub row: u32, pub col: u32 }
pub struct RangeRef { pub sheet: SheetId, pub r0: u32, pub c0: u32, pub r1: u32, pub c1: u32 }   // inclusive, normalized
pub trait SheetResolver { fn sheet_id(&self, name: &str) -> Option<SheetId>; }

pub struct DependencyGraph { .. }
impl DependencyGraph {
    pub fn new() -> Self;
    /// Register/replace the formula of `cell`. Extracts its precedents via `Expr::references()`.
    /// Unresolvable sheet names are recorded as `Precedent::Unresolved(name)` (so a later sheet rename can fix them) and ignored for ordering.
    /// Whole-column/row references (`A:A`, `1:1`) become ranges clipped to `MAX_ROW`/`MAX_COL` – treat them like any other range.
    pub fn set_formula(&mut self, cell: CellCoord, expr: &Expr, resolver: &dyn SheetResolver, current_sheet: SheetId);
    /// Remove a formula (cell became a constant or was cleared).
    pub fn remove_formula(&mut self, cell: CellCoord);
    pub fn has_formula(&self, cell: CellCoord) -> bool;
    pub fn precedents(&self, cell: CellCoord) -> impl Iterator<Item = &Precedent>;
    /// Direct dependents: formula cells that reference `cell` directly or through a range containing it.
    pub fn direct_dependents(&self, cell: CellCoord) -> Vec<CellCoord>;   // sorted, deduplicated
    /// Everything that must be recalculated when the given cells change (transitively), in a valid evaluation order
    /// (precedents before dependents). The changed cells themselves are included only if they hold formulas.
    pub fn recalc_order(&self, changed: &[CellCoord]) -> Result<Vec<CellCoord>, Cycle>;
    /// Order for recalculating ALL formulas (file open).
    pub fn full_order(&self) -> Result<Vec<CellCoord>, Cycle>;
    pub fn formula_count(&self) -> usize;
}
pub enum Precedent { Cell(CellCoord), Range(RangeRef), Unresolved(String) }
pub struct Cycle { pub cells: Vec<CellCoord> }   // the cells forming (at least) one cycle, in cycle order, starting from the smallest coord
```
- Cycle detection must find self-reference (`A1: =A1`), 2-cycles, and cycles through ranges (`A1: =SUM(A1:A3)`). `recalc_order` on a changed set that does not touch a cycle must succeed even if an unrelated cycle exists elsewhere (Excel still recalculates the rest). `full_order` returns the cycle if any.
- Ordering must be deterministic (ties broken by `CellCoord` ordering) so tests and the REPL are reproducible.

## Data structure requirements
- Range dependencies must not be expanded cell-by-cell (`=SUM(A:A)` must not allocate a million entries). Per sheet keep (a) a `HashMap<CellCoord, Vec<CellCoord>>` for direct cell precedents→dependents and (b) a list/bucketed index of range precedents (`Vec<(RangeRef, CellCoord)>` bucketed by column is sufficient for MVP; note the complexity in a doc comment). Lookup of dependents of a cell = exact-match cells ∪ ranges containing it.
- `set_formula` must cleanly remove the old precedents of the cell first (replacing a formula must not leave stale edges – test it).
- No `unsafe`, no new dependencies.

## Tests (`tests/graph.rs` + unit tests)
- Chain `A1→A2→A3` (A3 =A2, A2 =A1): changing A1 yields `[A2, A3]`; changing A3 (a formula) yields `[A3]`; changing B1 yields `[]`.
- Diamond: D1 =B1+C1, B1 =A1, C1 =A1: order has B1 and C1 before D1, exactly 3 cells, deterministic across 10 runs.
- Range: B1 =SUM(A1:A100); changing A50 → `[B1]`; changing A101 → `[]`. Whole column: B2 =SUM(A:A); changing A1048575 → `[B2]`.
- Cross-sheet via resolver: `Sheet2!A1` dependents; unresolved sheet recorded as `Unresolved` and `recalc_order` ignores it.
- Replace formula: A1 =B1 then A1 =C1: changing B1 → `[]`, changing C1 → `[A1]`.
- Cycles: self, 2-cycle, through range; `recalc_order` for an unrelated change still works; `Cycle.cells` content is checked.
- Scale: 100 000 formula cells each referencing the previous one; `recalc_order(&[first])` returns 100 000 cells in order and the whole test runs in well under 2 seconds in debug mode (use `std::time::Instant` and assert < 10 s so CI never flakes; report the actual number).
- `remove_formula` then change: no dependents.

## Report
State the complexity of `direct_dependents` for range precedents and any API you believe the façade task will need that is missing.
