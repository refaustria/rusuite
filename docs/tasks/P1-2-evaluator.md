# Task P1-2 – `engine-formula`: value system, evaluator, function registry, reference-suite runner

Branch: `p1/eval` (worktree `/home/bojan/rusuite-wt/p1-eval`). In scope: `crates/engine-formula/**` EXCEPT `src/ast.rs`, `src/lexer.rs`, `src/parser.rs` (read-only; if you believe the AST needs a change, stop and say so in the report instead of changing it). Another agent is adding `src/graph.rs` (dependency graph) in parallel – do not create that file and do not implement recalculation ordering.

## Goal
Given an `Expr` (from `parse`) and a `CellProvider` supplying cell values, `evaluate` returns a `Value` with Excel-compatible semantics. Functions are pluggable through a registry (one function = one file). A test runner evaluates every case in `testdata/formulas/*.tsv` (task P1-6, landing in parallel – see "Runner") and reports pass / fail / skipped-unimplemented.

## Semantics specification (normative – implement exactly this; where Excel and this spec disagree, this spec wins for now and you note it in the report)

### Values (`src/value.rs`)
```rust
pub enum Value { Empty, Number(f64), Text(String), Bool(bool), Error(ErrorKind), Array(Array) }
pub struct Array { rows: usize, cols: usize, data: Vec<Value> }   // row-major, scalars only (no nested arrays)
```
- `Number` is always finite. Any operation producing NaN/±inf yields `Error(Num)`.
- `Empty` = blank cell or omitted argument. A formula whose final result is `Empty` is converted to `Number(0.0)` by `evaluate` (Excel shows 0 for `=D4` on a blank D4), but `Empty` must flow unchanged *inside* the evaluation (so `=D4&"x"` → `"x"`).
- A final `Array` result is reduced to its top-left element (no dynamic-array spilling in MVP). Zero-size array → `Error(Value)`.

### Coercions (free functions in `value.rs`; each returns `Result<T, ErrorKind>`; an `Error` input always propagates)
- `to_number`: Number→itself · Bool→1/0 · Empty→0 · Text→trim ASCII whitespace; accept `[+-]?digits[.digits][e[+-]digits]`, `.5`, `5.`, a trailing `%` (divide by 100), thousands separators `1,000` (commas between digit groups), leading `$`; also the texts `TRUE`/`FALSE` are NOT numbers → `Error(Value)`; empty text → `Error(Value)`.
- `to_text`: Text→itself · Bool→`TRUE`/`FALSE` · Empty→`""` · Number→`format_general(f64)` (below).
- `to_bool`: Bool→itself · Number→`!= 0` · Empty→false · Text→case-insensitive `TRUE`/`FALSE`, else `Error(Value)`.
- `format_general(f64) -> String` (Excel "General" as used by `&` and `TEXT(x,"@")`): round to 15 significant digits first. Then: integer-valued and `|x| < 1e15` → plain integer digits (no `.0`); `|x| >= 1e15` or (`x != 0` and `|x| < 1e-9`) → scientific `d.ddddE+XX` / `E-XX` with trailing zeros trimmed, exponent at least two digits (`1E+20`, `1.5E-10`); otherwise plain decimal with trailing zeros trimmed, no leading `+`, `-0` prints `0`. Reference: `0.1+0.2`→`0.3`, `1/3`→`0.333333333333333`, `1e15`→`1E+15`, `123456789012345`→`123456789012345`, `1234567890123456`→`1.23456789012346E+15`, `0.000001`→`0.000001`, `1e-10`→`1E-10`, `-2.5`→`-2.5`, `100`→`100`, `2.50`→`2.5`.

### Operators (`src/eval.rs`)
Operand evaluation order: left then right; the first `Error` encountered is the result.
- `+ - * /`: both `to_number`. `/` by zero → `Error(Div0)`. `^`: `to_number` both; `0^0` → `Error(Num)`; negative base with non-integer exponent → `Error(Num)`; non-finite → `Num`.
- Unary `-`: `to_number` then negate (`-Empty` → 0; `-"3"` → -3; `-"a"` → `#VALUE!`). Unary `+`: returns the operand unchanged after dereferencing (so `=+"a"` → `"a"`). `%`: `to_number` / 100.
- `&`: both `to_text`.
- Comparisons `= <> < <= > >=`: after dereferencing, type ranking Number < Text < Bool; different ranks compare by rank (so `1<"a"` is TRUE, `"a"<TRUE` is TRUE, `1="1"` is FALSE). Same rank: numbers numerically; texts case-insensitively by Unicode scalar value after `to_uppercase()` on both (document: Excel uses locale collation, we don't); bools FALSE<TRUE. `Empty` adopts the other side's rank: vs Number → 0, vs Text → `""`, vs Bool → FALSE; `Empty = Empty` is TRUE. `Error` on either side propagates (left first).
- `BinaryOp::Range` (`A1:INDEX(...)`): both sides must dereference to references on the same sheet → the bounding area; else `Error(Value)`.

### References and context
```rust
pub struct SheetId(pub u32);
pub struct CellCoord { pub sheet: SheetId, pub row: u32, pub col: u32 }
pub trait CellProvider {
    fn sheet_id(&self, name: &str) -> Option<SheetId>;      // case-insensitive
    fn value(&self, c: CellCoord) -> Value;                 // Empty for blank; never Array
    fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)>; // (max_row, max_col) inclusive, None if sheet empty – used to clip A:A / 1:1
}
pub struct EvalContext<'a> { pub provider: &'a dyn CellProvider, pub registry: &'a FunctionRegistry, pub current: CellCoord, pub now: fn() -> f64 /* serial date-time for NOW/TODAY, injectable in tests */ }
pub fn evaluate(expr: &Expr, ctx: &EvalContext) -> Value;
```
- A `Reference` with an unknown sheet → `Error(Ref)`. A `Name` → `Error(Name)` (named ranges deferred).
- Internally use a `Operand` enum `{ Scalar(Value), Range(RangeRef) }` where `RangeRef { sheet, r0, c0, r1, c1 }`; a single-cell reference in scalar position dereferences to the cell value; a multi-cell range in scalar position performs **implicit intersection** with `ctx.current`: if the range is a single column, take the cell in the current row (if within the range), if a single row, the cell in the current column; otherwise or if out of range → `Error(Value)`. An `Array` in scalar position → its top-left element.
- Whole-column/row ranges are clipped to `used_range` before iteration (an empty sheet → zero cells).

### Functions (`src/functions/mod.rs`, `src/functions/<family>/<name>.rs`)
```rust
pub trait Function: Send + Sync {
    fn name(&self) -> &'static str;
    fn arity(&self) -> Arity;                      // { min: usize, max: Option<usize> }; wrong count → Error(Value) BEFORE evaluating args (Excel refuses at parse time; we use #VALUE!)
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value;   // args are LAZY (unevaluated Expr) so IF/IFERROR can short-circuit
}
```
`CallContext` wraps `EvalContext` and offers: `eval(&Expr) -> Operand`, `scalar(&Expr) -> Value` (deref/intersect), `number/text/bool(&Expr) -> Result<_, ErrorKind>`, `range(&Expr) -> Result<RangeRef-or-Array iterator, ErrorKind>`, `is_missing(&Expr)`, and `aggregate(&[Expr], Aggregate) -> impl Iterator<Item = Value>` implementing the shared Excel rule for SUM-like functions: for a **direct scalar argument** Number→kept, Bool→1/0, Text→`to_number` or `Error(Value)`, Empty→skipped, Error→propagated; for **range/array arguments** only Numbers are kept (text, bools, empties ignored; Errors propagate). `FunctionRegistry { register(Box<dyn Function>), get(&str) (case-insensitive), names() -> Vec<&str>, with_builtins() }`. An unregistered function name → `Error(Name)`.
Implement exactly these builtins in this task to prove the pattern (one file each): `SUM`, `IF` (lazy: `IF(cond, [a], [b])`; missing `a`/`b` → `Empty`→ shows as 0 / FALSE: Excel returns 0 for a missing value_if_true and FALSE for a missing value_if_false), `LEN`, `NA`, `ISERROR`, `TRUE`, `FALSE`. All other functions are separate tasks – leave `docs/functions.md` alone.

## Runner (`tests/reference_suite.rs`)
Format is defined in `docs/tasks/P1-6-reference-suite.md` (fixture: `sheet	cell	type	value`; cases: `formula	type	expected	note`, `#` comments, `type ∈ number|text|bool|error|number?`). BEFORE writing the runner run `git -C /home/bojan/rusuite log --oneline -1 -- testdata/formulas` – if P1-6 has merged to main, `git merge main` into your branch and run against the real files; otherwise build the runner against the documented format with a small inline fixture and it must still pass with 0 files (print the counts).
- Build an in-memory `CellProvider` from the fixture (sheets `Data`, `Other`); formula cells in the fixture (`H1 =1/0`, `H2 =NA()`) are stored as their error values. `ctx.current` = sheet `Suite` row *i* col 1.
- For every case: parse → evaluate → compare (number: `|a-b| <= 1e-9 * max(1,|b|)`; text exact; bool; error kind; `number?` → type only). A case whose formula calls any function not in `registry.names()` is **skipped-unimplemented** and counted; the runner prints `reference_suite: passed=N failed=N skipped_unimplemented=N` and fails if `failed > 0`. Print every failing case (formula, expected, got). Do NOT edit TSV files to make cases pass; if you believe an expected value is wrong (LibreOffice ≠ Excel), list it in your report.

## Unit tests (required, in addition to the runner)
Every rule in "Coercions", every bullet in "Operators" (including the mixed-type comparison matrix: at least 12 pairs), implicit intersection (column range in same row / other row / 2-D range), `format_general` reference list above, `Empty` final-result→0, Array→top-left, unknown sheet → `#REF!`, unknown function → `#NAME?`, wrong arity → `#VALUE!`, IF laziness (the untaken branch may contain `1/0` without affecting the result), `aggregate` semantics with `SUM`: `SUM(1,"2",TRUE)`=4, `SUM(A1:A3)` with a text cell ignored, `SUM("a")`=#VALUE!, `SUM(range-with-error)`=that error.

## Dependencies
No new crates. `thiserror` is already in the crate.
