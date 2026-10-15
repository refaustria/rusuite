# Task P1-6 – Formula reference test suite data + `docs/functions.md`

Branch: `p1/testsuite` (worktree `/home/bojan/rusuite-wt/p1-testsuite`). In scope: `testdata/formulas/**`, `scripts/gen-formula-suite.sh`, `scripts/testdata-src/formulas.*` (your source), `docs/functions.md`, `docs/formula-suite.md`. NO Rust code (the runner comes with the evaluator task).

## Goal
A data-driven reference suite that the evaluator will be tested against: a fixed fixture grid plus one TSV per function family listing formulas and the expected result. Expected values are computed by LibreOffice Calc headless now (PROVISIONAL) and will be replaced by Excel-computed values later, so the generation must be reproducible and must also emit an `.xlsx` the owner can open in Excel to recompute.

## Function list – this IS the MVP list; write it into `docs/functions.md` (table: name, signature, short semantics, notes on Excel edge cases, status column "planned")
- Math/stat (20): SUM AVERAGE MIN MAX COUNT COUNTA ROUND ROUNDUP ROUNDDOWN INT MOD ABS SQRT POWER PI PRODUCT SUMIF COUNTIF SUMPRODUCT CEILING
- Logical (7): IF AND OR NOT IFERROR TRUE FALSE
- Info (6): ISBLANK ISNUMBER ISTEXT ISERROR ISNA NA
- Text (14): CONCAT CONCATENATE LEFT RIGHT MID LEN UPPER LOWER TRIM FIND SUBSTITUTE TEXT VALUE EXACT
- Lookup (6): VLOOKUP HLOOKUP INDEX MATCH CHOOSE ROW  COLUMN  (7 with COLUMN)
- Date/time (8): TODAY NOW DATE YEAR MONTH DAY WEEKDAY DAYS
Total 62. `TEXT` supports only these format codes in MVP: `0`, `0.00`, `#,##0`, `#,##0.00`, `0%`, `0.0%`, `yyyy-mm-dd`, `dd.mm.yyyy`, `mm/dd/yyyy`, `@`. Put the "considered but deferred" functions (TRUNC EXP LN LOG SIGN FLOOR AVERAGEIF IFNA IFS XOR ISLOGICAL SEARCH REPLACE REPT PROPER CHAR CODE ROWS COLUMNS HOUR MINUTE SECOND TIME EOMONTH EDATE RAND RANDBETWEEN) in a "Deferred" section.

## Fixture grid (`testdata/formulas/fixture.tsv`, columns: sheet, cell, type, value) – exactly this, on sheet `Data`:
A1:A6 = 1, 2, 3, 4, 5, 6 · B1:B6 = apple, banana, cherry, date, elderberry, fig · C1:C6 = 10.5, -2, 0, 100, 3.25, 1e6 · D1 = TRUE, D2 = FALSE, D3 = "" (empty string constant), D4 = (empty), D5 = "42" (text), D6 = "  padded  " · E1 = 2024-01-15 (date serial 45306), E2 = 2024-12-31, E3 = 45306.75 (number, date+time), E4 = 0.5 · F1:F4 = lookup table keys 100, 200, 300, 400 with G1:G4 = "one hundred", "two hundred", "three hundred", "four hundred" · H1 = #DIV/0! (formula `=1/0`), H2 = #N/A (formula `=NA()`).
Second sheet `Other`: A1 = 7, B1 = "remote".

## Suite files `testdata/formulas/<family>.tsv` (math, logical, info, text, lookup, datetime, operators, references, errors)
Tab-separated, `#` comment lines allowed, header row: `formula	type	expected	note`.
- `type` ∈ `number | text | bool | error | number?` (`number?` = non-deterministic, check type only – TODAY/NOW).
- `expected`: number as shortest decimal that roundtrips (max 15 significant digits), text verbatim (tabs/newlines escaped `\t` `\n`), bool `TRUE`/`FALSE`, error as `#DIV/0!` etc.
- Every function above gets ≥ 4 cases: a normal case, an edge case (empty cell, text-as-number, negative/zero), an error-propagation case (`H1` as argument), a case using references/ranges from the fixture. `operators.tsv`: precedence, `%`, `&` with numbers/bools (`=1&TRUE` → `1TRUE`), comparisons of text vs number (text > number in Excel), `=` on strings is case-insensitive, `--1`, `-2^2`, `2^3^2`, division by zero, text arithmetic (`="3"+1` → 4, `="a"+1` → #VALUE!), bool arithmetic (`=TRUE+1` → 2), empty cell in arithmetic (`=D4+1` → 1) and concatenation (`=D4&"x"` → `x`). `references.tsv`: cross-sheet `=Other!A1*2`, range in scalar context where Excel does implicit intersection is NOT tested (deferred); `=SUM(Data!A1:A6)`, `=COUNT(A1:D6)`, `=COUNTA(A1:D6)`. `errors.tsv`: each error literal through IFERROR/ISERROR/ISNA, `=1/0`, `=SQRT(-1)` (#NUM!), `=VLOOKUP(999,F1:G4,2,FALSE)` (#N/A), `=UNKNOWNFN(1)` (#NAME?), `=INDEX(A1:A6,10)` (#REF!), `=VALUE("abc")` (#VALUE!).
- Target ≥ 350 cases total.

## Generation (`scripts/gen-formula-suite.sh`, idempotent, `--verify` mode)
1. You author the formulas ONCE in a source file (`scripts/testdata-src/formulas.tsv`: family, formula, note). The script builds a flat ODS (`.fods`) with the fixture sheets plus a `Suite` sheet (one formula per row in column B, the formula text in column A as a string), converts it to `.xlsx` with `soffice --headless --convert-to xlsx` (LibreOffice recalculates on export), then extracts each result from the xlsx XML (`<c ... t="str|b|e|n">` + `<v>` and shared strings) with a Python 3 script (stdlib only, run with `python3 -I`) and writes the per-family TSVs with a header comment `# PROVISIONAL – expected values computed by LibreOffice <version>; replace with Excel values`.
2. Also copies the generated workbook to `testdata/formulas/formula-suite.xlsx` (for the owner to open in Excel, recalc, and send back) and documents in `docs/formula-suite.md` how a returned Excel file is converted into the TSVs (`--from-xlsx <file>` mode of the same script).
3. `--verify`: every function in the list has ≥ 4 cases; every TSV parses (4 columns); counts per family printed; the formulas in the TSV are byte-identical to the source file (so hand edits are impossible to lose).
4. Known LibreOffice≠Excel divergences you notice (e.g. TEXT formats, WEEKDAY types, string comparison) go into a `# NOTE:` comment on that row AND into `docs/formula-suite.md` "Known provisional differences".

## Acceptance
```
bash scripts/gen-formula-suite.sh && bash scripts/gen-formula-suite.sh --verify
shellcheck scripts/gen-formula-suite.sh
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace   # unchanged
```
Commit generated TSVs, the xlsx, the source file, the script, the two docs. Also update `testdata/README.md` with the new files (mark PROVISIONAL).
