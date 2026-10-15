# Task P1-9 – `engine-formula`: array-mode evaluation for range arguments

Branch `p1/array-eval`, worktree `/home/bojan/rusuite-wt/p1-array-eval`. Scope: `crates/engine-formula/src/eval.rs` (operator evaluation + a new `eval_array` entry point), `src/functions/mod.rs` (`CallContext::range` only), `src/value.rs` (Array helpers if needed), unit tests. Do NOT touch `functions/<family>/**`, `graph.rs`, or the coordinate type definitions at the top of `eval.rs` (another agent is moving `SheetId/CellCoord/RangeRef` into `coord.rs` in parallel – keep your edits inside the operator/evaluation functions so the merge is clean).

## Problem
`ctx.range(expr)` currently evaluates `expr` with scalar semantics: a range inside an operator expression is implicitly intersected with the current cell, so `SUMPRODUCT((A1:A6>2)*(A1:A6<5))` yields `#VALUE!`. Excel evaluates arguments that expect arrays in *array mode*: references become arrays and operators apply element-wise with broadcasting.

## Specification (normative)
Add `pub fn eval_array(expr: &Expr, ctx: &EvalContext) -> Operand` (and use it in `CallContext::range`; `CallContext::eval/scalar/number/text/bool` and `evaluate` keep scalar semantics – do not change them).
In array mode:
- `Reference` → `Operand::Range` as today (whole-column/row clipped to `used_range`); `Array` literal → `Operand::Scalar(Value::Array)`; literals → scalars; `Name` → `#NAME?`; `Call` → evaluated normally via the registry (functions are NOT lifted over arrays in MVP – ROADMAP) and the returned `Value` (which may be an `Array`) is used as-is.
- `Unary`/`Binary` ops: evaluate operands in array mode, then materialize any `Range` into an `Array` of cell values (Empty cells stay `Empty`), then apply the scalar operator element-wise with **broadcasting**: a 1×1 operand pairs with every element; an N×1 column pairs with each column of an N×M operand; a 1×M row pairs with each row of an N×M operand; otherwise the result has shape (max rows, max cols) and positions outside an operand's extent are `#N/A` (Excel behaviour). The element operation is exactly the existing scalar operator code (same coercions, same error results), so factor the current scalar binary/unary operator functions into `fn apply_binary(op, Value, Value) -> Value` / `fn apply_unary(op, Value) -> Value` if they are not already, and reuse them in both modes.
- `BinaryOp::Range` (`A1:INDEX(...)`) behaves as in scalar mode.
- Result: `Operand::Scalar(Value::Array)` (or a scalar if no operand was array-shaped).
- Also fix (both modes): `x ^ y` with `x == 0` and `y < 0` → `#DIV/0!` (Excel), not `#NUM!`. Update the existing unit test accordingly and check `testdata/formulas/operators.tsv` and `math.tsv` for `0^-1` / `POWER(0,-1)` rows: do NOT edit TSVs; report whether they pass (another agent is adding the `[excel=#DIV/0!]` note).

## Tests
- Unit tests in `eval.rs`: `eval_array` of `A1:A3*2` (A1:A3 = 1,"x",3 in the test fixture → `{2,#VALUE!,6}`), `(A1:A3>2)*1`, column × row broadcasting producing an N×M array, mismatched shapes → `#N/A` in the overflow cells, scalar-only expression stays scalar, a `Call` inside an array expression returns its (scalar) value broadcast, nested arrays `{1,2}+{10;20}` → 2×2.
- `cargo test -q -p engine-formula --test reference_suite -- --nocapture` must show `failed=0` for all rows exercisable on your branch (math functions are on a separate unmerged branch; the PM will verify SUMPRODUCT after merging). Verify by hand with a unit test that `SUMPRODUCT`-style evaluation works: write the test against `eval_array` directly, e.g. summing the elements of `eval_array("(A1:A3>1)*(A1:A3<4)")` gives 1 (only 3 passes… careful: A2 is text "x": `"x">1` is TRUE (text ranks above numbers) and `"x"<4` is FALSE → product 0; A1=1: FALSE*… = 0; A3=3: TRUE*TRUE = 1 → total 1).
- All existing tests keep passing unchanged except the `0^-1` expectation.
