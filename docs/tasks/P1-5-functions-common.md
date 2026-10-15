# P1-5 function batches – common rules

Read first: `docs/tasks/COMMON.md`, `docs/functions.md` (the normative semantics per function, incl. "Excel edge cases"), `docs/formula-suite.md`, `crates/engine-formula/src/functions/mod.rs` (the `Function` trait, `CallContext`, `Aggregate`, `RangeArg`), and the two existing examples `functions/math/sum.rs` and `functions/logical/if_.rs` – copy their structure exactly (one file per function, struct + `impl Function`, unit tests via `crate::functions::test_support::eval` which has fixture A1:A3 = 1,"x",3; B1=TRUE; B2="5"; C1=#DIV/0!; C2=#N/A).

## Registration without merge conflicts
Three batches run in parallel and all touch `functions/mod.rs::with_builtins`. To keep the overlap to one line each:
1. In YOUR family module(s) `functions/<family>/mod.rs` add `pub fn register(r: &mut FunctionRegistry)` that registers every function of that family (including the pre-existing ones, e.g. `Sum` for math, `If/True/False` for logical, `Len` for text, `Na/IsError` for info).
2. In `with_builtins` replace the existing `r.register(Box::new(<family>::...))` lines OF YOUR FAMILIES ONLY with one `<family>::register(&mut r);` line. Do not reorder or touch other families' lines. Do not edit anything else in `functions/mod.rs` unless the brief says so.

## Semantics
`docs/functions.md` is the spec; where it is silent, follow Excel. Arguments: use `ctx.number/text/bool` for scalar args (these apply the Excel coercions), `ctx.range` for range/array args, `ctx.aggregate(.., Aggregate::Numbers)` for SUM-like argument lists, `ctx.is_missing` for optional args. Errors in arguments propagate (left to right) unless the function is defined to swallow them (IFERROR, ISERROR, ISNA, ISBLANK, COUNT/COUNTA over ranges). Never panic on any input; never return a non-finite number (`Value::number(f64)` already maps non-finite to `#NUM!` – use it).

## Acceptance (worktree root)
```
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cargo test -q -p engine-formula --test reference_suite -- --nocapture 2>&1 | grep -E "reference_suite:|passed="
```
- `failed=0` overall. For your families' files, `skipped_unimplemented` may only contain cases that call functions from OTHER batches (list them in the report with the function names) – zero cases skipped because of your functions.
- Every function has ≥ 3 unit tests in its file (normal, edge, error propagation).
- Update the `status` column in `docs/functions.md` from `planned` to `implemented` for your functions only.
- If a suite row's expected value contradicts Excel (not just LibreOffice), do NOT edit the TSV; implement Excel behaviour, let the row fail, and list it in the report with your reasoning – the PM decides.
