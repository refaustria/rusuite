# Roadmap – ideas beyond the README scope

Captured here, **not implemented** unless essential to the current phase. README is the authority on scope.

## Tooling / DX
- `cargo xtask` crate for dev commands (roundtrip, testdata generation) instead of shell scripts – shell is fine for Phase 0.
- Pre-commit hook running `cargo fmt --check` and `clippy`.
- Nightly CI job running the roundtrip harness against LibreOffice (slow; keep out of PR CI).

## Roundtrip harness
- Deterministic `gen-testdata.sh` (normalize zip mtimes) so regenerated provisional files are stable in git.
- PDF page-count / text comparison original vs rewritten as a visual-regression proxy.
- `--json` output for CI; clearer error when the rewriter example is missing.
- Manual validation checklist for real Office on Windows/macOS.

## core-model
- Validating deserializer for `Color::Theme.tint` (reject outside ±1 instead of clamping on resolve).
- proptest: Rgb → hex → Rgb roundtrip.
- TS type generation (ts-rs vs specta, ADR 0002) must handle the `kind`/`value` enum shape.

## fmt-ooxml
- Lenient open mode (fallback content type `application/octet-stream`, keep unparseable `.rels` raw) for real-world files.
- Preserve each part's original compression method; percent-decode relationship targets.
- Part index (HashMap) if packages with thousands of parts become slow.
- `PartName` helper to allocate the next free `/word/media/imageN.png`-style name.

## engine-formula (parser)
- Intersection (space) operator, union operator.
- Sheet-scoped names (`Sheet1!Name`), 3-D refs (`Sheet1:Sheet3!A1`), external workbook refs (`[1]Sheet1!A1`), structured table refs.
- R1C1 notation; `#SPILL!`/`#CALC!` literals and the spilled-range operator `A1#`.
- Per-end `$` flags on whole-column/row ranges (`$A:C` currently loses the `$`).
- Source spans on AST nodes for editor diagnostics.

## engine-formula (dependency graph)
- 2-D interval index (R-tree) for heavy range use; incremental topological order instead of re-sorting per edit.
- `HashSet` for reverse edges if bulk removal of formulas pointing at one hot cell gets quadratic.
- Façade needs: volatile cells (NOW/RAND) always recalculated, re-resolving `Precedent::Unresolved` on sheet add/rename, coordinate shifting on row/col insert/delete, partial order alongside a reported cycle.
- Dynamic references (`A1:INDEX(...)`, INDIRECT/OFFSET) are not tracked by the graph – treat as volatile when they arrive.

## engine-formula (evaluator / functions)
- Lift functions over arrays in array mode (`LEN(A1:A3)` → array); size cap or lazy materialization for whole-column operands in array mode (currently materialized in full, clipped to used range, min 1×1).
- `COUNT(1,)`: Excel counts the omitted argument (returns 2); we return 1 – decide when Calc UI arrives.
- TEXT number formats not yet supported: `?` placeholders, `E+` exponent, fractions, AM/PM, elapsed `[h]`, conditions/colours/locale tags, fractional seconds.
- Deferred date functions reuse `datetime/serial.rs`: EDATE, EOMONTH, NETWORKDAYS, DATEDIF, DATEVALUE/TIMEVALUE.
- Named ranges (`Expr::Name`) and functions returning references (`A1:INDEX(...)`, OFFSET) need an `Operand`-returning function entry point.
- Re-export `eval_array` from lib.rs if the façade or Calc needs it.

## engine-formula (Engine façade → Phase 2 needs)
- Reference shifting on row/column insert/delete; copy/paste reference adjustment; sheet delete; formula-text rewrite on sheet rename (AST already updated – print it back).
- `Recalc`-returning variants of `add_sheet`/`rename_sheet` for the IPC diff; undo-friendly batch commands.
- Sheet-name validation (empty, 31 chars, forbidden characters) – needs a new `EngineError` variant.
- Input parsing for dates/times (`1/2/2026`, `12:30`) and formulas starting with `+`/`-`.
- Functions declare volatility themselves (RAND, OFFSET, INDIRECT later) instead of the engine's NOW/TODAY name list; optional iterative-calculation mode for cycles.
- `parse_date_text`: two-digit years, month names (`15-Jan-2024`); suite cases for `1900-02-29` and time-only VALUE.
- `Engine::cells()` iterator and `Engine::eval_formula(text, sheet)` (no scratch cell) – wanted by the REPL and later by the UI formula bar.
- `CHOOSE`/`IF` as reference-returning (`call_ref`) like Excel; OFFSET/INDIRECT plug into `call_ref`; runner warning for registered functions missing from docs/functions.md.
- Share one wildcard matcher between `math/criteria.rs` and `lookup/util.rs`.

## engine-formula (reference suite)
- Host-cell cases (`ROW()`, `COLUMN()` without args), implicit-intersection and spill cases once the evaluator exists.
- Second locale pass for `TEXT`/`VALUE`; cases for SUMIFS/COUNTIFS/XLOOKUP if they ever enter scope.
- Deferred functions list lives in `docs/functions.md`.

## Formats
- Compare rewritten files against Open XML SDK validator (Windows/.NET) in addition to LibreOffice – gives real "would Office repair this" signal.

## Later phases (noted while planning Phase 0)
- (none yet)
