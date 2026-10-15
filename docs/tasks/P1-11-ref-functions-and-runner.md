# Task P1-11 – reference-returning functions + runner "known function" rule

Branch `p1/ref-fns`, worktree `/home/bojan/rusuite-wt/p1-ref-fns`. Scope: `crates/engine-formula/src/functions/mod.rs` (trait + CallContext), `src/eval.rs` (the `BinaryOp::Range` arm and a new `eval_ref` helper), `src/functions/lookup/{index.rs,row.rs,column.rs,util.rs}`, `tests/reference_suite.rs`. Do not touch other function families, `coord.rs`, `engine.rs`, `graph.rs`.

## Part A – functions that return references (replaces the ROW/COLUMN special-case)
Today `functions/lookup/util.rs::reference_arg` recognises a literal `INDEX(range, ...)` call so that `ROW(INDEX(A1:A6,3))` works. Replace that with a general mechanism:
- Add to the `Function` trait: `fn call_ref(&self, args: &[Expr], ctx: &mut CallContext) -> Option<Operand> { None }` (default). A function that can yield a reference overrides it and returns `Some(Operand::Range(..))` when the result is a reference (or `Some(Operand::Scalar(err))` for an error) and `None` to fall back to `call`.
- Add `CallContext::eval_ref(&self, e: &Expr) -> Operand`: for `Expr::Reference` → the range; for `Expr::Call` → look up the function and use `call_ref` if it returns `Some`, otherwise evaluate normally (scalar); for parenthesised/other expressions → `self.eval(e)`.
- `INDEX` implements `call_ref` (row/col 0 → the whole row/column area; out of bounds → `#REF!`; array-literal input → `None`, i.e. falls back to the value path).
- `ROW`/`COLUMN` use `ctx.eval_ref` and drop the INDEX pattern-match; `reference_arg` is removed or reduced accordingly.
- `eval.rs` `BinaryOp::Range` (`A1:INDEX(B1:B9,3)`): evaluate both sides through the same reference path (add a small `eval_ref` in eval.rs that the CallContext one delegates to) so `A1:INDEX(...)` now works and produces the bounding area (same sheet required, else `#VALUE!`). Add unit tests: `=SUM(A1:INDEX(A1:A3,2))` = 1+"x"→ sum of numbers in A1:A2 with the test fixture (A1=1, A2="x") = 1; `=ROW(INDEX(A1:A6,3))` = 3; `=COLUMN(INDEX(A1:H6,1,5))` = 5; `=ROW(INDEX({1,2},1))` → `#VALUE!` (array, not a reference).

## Part B – runner: only skip functions that are PLANNED but unimplemented
`tests/reference_suite.rs` currently skips any row whose formula calls an unregistered function. Change it to: read the function names from `docs/functions.md` (every `| NAME |`-style first cell in the family tables whose status column is `planned` or `implemented`; ignore the Deferred section), and skip a row only when it calls a name that is in that list and NOT registered. A name in neither (e.g. `UNKNOWNFN`) is evaluated normally and must yield `#NAME?` as the row expects. Print the count under `skipped_unimplemented` as before. Expected after this change: `skipped_unimplemented=0`, `failed=0`.

## Acceptance
`cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`; `cargo test -q -p engine-formula --test reference_suite -- --nocapture | grep reference_suite:` shows `passed=862 failed=0 skipped_unimplemented=0`. Report any suite row that fails after Part A and why.
