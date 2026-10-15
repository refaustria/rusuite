# Formula reference suite

Data-driven reference cases for the formula evaluator (function list: [functions.md](functions.md)).
**All expected values are PROVISIONAL**: they were computed by headless LibreOffice Calc and must be
replaced by values computed by Microsoft Excel (see "Replacing the values with Excel results").

## Files

| Path | Purpose |
|------|---------|
| `scripts/testdata-src/formulas.tsv` | Source of truth: `family`, `formula`, `note`. Hand-edit this, never the generated TSVs |
| `scripts/testdata-src/formulas.fixture.tsv` | Source of the fixture grid |
| `scripts/testdata-src/formulas.py` | Builder / extractor / verifier (Python 3 stdlib, run with `python3 -I`) |
| `scripts/gen-formula-suite.sh` | Driver (`soffice` + the Python helper) |
| `testdata/formulas/fixture.tsv` | Fixture grid: `sheet`, `cell`, `type`, `value` |
| `testdata/formulas/<family>.tsv` | Cases for `math logical info text lookup datetime operators references errors` |
| `testdata/formulas/formula-suite.xlsx` | The workbook LibreOffice recalculated; open it in Excel to recompute |

## Fixture

Sheet `Data`: A1:A6 = 1..6, B1:B6 = apple..fig, C1:C6 = 10.5, -2, 0, 100, 3.25, 1e6,
D1:D6 = TRUE, FALSE, `""`, (empty), `"42"` (text), `"  padded  "`, E1 = 2024-01-15 (45306), E2 = 2024-12-31 (45657),
E3 = 45306.75, E4 = 0.5, F1:F4 = 100..400, G1:G4 = "one hundred".."four hundred", H1 = `=1/0`, H2 = `=NA()`.
Sheet `Other`: A1 = 7, B1 = "remote". Types in `fixture.tsv`: `number text bool empty date formula`
(`date` = number cell with a `yyyy-mm-dd` format, value is the serial).

## Case files

Tab-separated, `#` comment lines, header `formula	type	expected	note`.

- Every formula is evaluated **in the context of sheet `Data`**: unqualified references such as `A1` mean `Data!A1`. In the generated workbook the formula sits in `Data!L<n>` (its text in `Data!K<n>`), so `A1` resolves naturally. Cases never depend on the host cell (no argument-less `ROW()`/`COLUMN()`), and no case references columns K or L.
- `type`: `number | text | bool | error | number?`. `number?` (only `=TODAY()` and `=NOW()`) is non-deterministic: check the result type only, `expected` is empty.
- `expected`: numbers as the shortest decimal that roundtrips, at most 15 significant digits; text verbatim with `\\`, `\t`, `\n`, `\r` escaped; bools `TRUE`/`FALSE`; errors as `#DIV/0!` etc.
- Rows whose LibreOffice result is known to differ from Excel carry `DIFF: <reason> [excel=<value>]` in the note column and an extra `# NOTE:` line above the row. `<value>` is the Excel result as the author knows it (not machine-verified until an Excel run replaces the file); an evaluator test runner should prefer it over `expected` while the file is PROVISIONAL.

## Workflow

```
bash scripts/gen-formula-suite.sh            # regenerate TSVs + xlsx (needs soffice); idempotent for the TSVs
bash scripts/gen-formula-suite.sh --verify   # checks, no soffice needed
```

How generation works: the helper writes `Data` (fixture + suite) and `Other` as a minimal xlsx with
formulas and no cached values, LibreOffice converts it (`--convert-to xlsx`), which recalculates every
cell, and the helper reads the cached `<v>` of each result from the converted file. Functions that
Excel stores with a prefix (`CONCAT`, `DAYS`, `IFS`, `XLOOKUP`, `STDEV.S`, ... -> `_xlfn.`, see `FUTURE_NAMES` in `formulas.py`) are written that way. The xlsx is rewritten
on every run (it embeds timestamps and the volatile `TODAY`/`NOW` values); only the TSVs are byte-stable.
`verify` checks: every function of `functions.md` appears in at least 4 cases, every TSV row has 4
columns and a valid type/value, formulas in the TSVs are byte-identical to `formulas.tsv`,
`fixture.tsv` equals its source, and prints the case count per family (>= 350 required). Statistical and financial functions have no family of their own: their cases live in `math.tsv`.

Deviation from the original brief: the workbook is generated as xlsx directly instead of flat ODS.
Writing formulas in Excel syntax into the xlsx keeps the suite text exactly as Excel will see it and
avoids translating to OpenFormula (`;` separators, `[.A1]` references). LibreOffice still recalculates it.
Fixture cell `D3` (empty-string constant) is written as the formula `=""` because LibreOffice drops
empty-string constants on import; for Excel the result is identical.

## Replacing the values with Excel results

1. Open `testdata/formulas/formula-suite.xlsx` in Excel. Force a full recalculation (Ctrl+Alt+Shift+F9) and save as `.xlsx` (any file name). Do not edit cells; columns K (formula text) and L (result) of sheet `Data` are read.
2. Run `bash scripts/gen-formula-suite.sh --from-xlsx <saved file>`. It checks that column K still equals the source formulas, rewrites all TSVs (header comment names the application recorded in `docProps/app.xml` and no longer says PROVISIONAL) and copies the file to `testdata/formulas/formula-suite.xlsx`.
3. After that, plain `gen-formula-suite.sh` refuses to overwrite the Excel values (use `--force` to regenerate provisional ones). Review the diff of the TSVs: every changed row is a place where LibreOffice and Excel disagree; add or fix the `DIFF:` notes in `formulas.tsv` accordingly. `TODAY`/`NOW` rows stay `number?`.
4. `fixture.tsv` and the source TSVs are not touched by Excel; the stored `DIFF:` notes should be deleted from `formulas.tsv` once the Excel value is authoritative.

Locale: Excel must run with an en-US style locale (`.` decimal point, `,` thousands separator, `m/d/yyyy` parsing of date text), as `VALUE("2024-01-15")`, `TEXT` and `1,000` depend on it.

## Known provisional differences

LibreOffice 25.2 differs from Excel on the rows below (the `excel=` value is what Excel is expected to return).
The recurring causes are: LibreOffice stores booleans as numbers with a boolean format (so they count
in aggregates, compare as numbers, and concatenate as `1`/`0`), its date serials before 1900-03-01 are
shifted by one day and negative serials are valid, it maps some error kinds differently on xlsx export
(`SQRT(-1)` becomes `#VALUE!`), and it rejects numeric text literals in some aggregates.
Not asserted either way (the LibreOffice value is kept as is): `TEXT` locale-dependent codes and date-text parsing in `VALUE`.

| Family | Formula | Reason | Expected in Excel |
|--------|---------|--------|-------------------|
| math | `=SUM(D1:D6)` | LibreOffice treats boolean cells as numbers in references | `0` |
| math | `=SUM("3",4)` | LibreOffice rejects numeric text literals in SUM | `7` |
| math | `=AVERAGE(D1:D6)` | LibreOffice treats boolean cells as numbers in references | `#DIV/0!` |
| math | `=AVERAGE(1,"3")` | LibreOffice rejects numeric text literals in AVERAGE | `2` |
| math | `=MIN(D1:D2)` | LibreOffice treats boolean cells as numbers in references | `0` |
| math | `=COUNT(A1:D6)` | LibreOffice treats boolean cells as numbers in references | `12` |
| math | `=COUNT(D1:D6)` | LibreOffice treats boolean cells as numbers in references | `0` |
| math | `=SQRT(-1)` | LibreOffice reports #VALUE! on xlsx export | `#NUM!` |
| math | `=POWER(0,0)` | Excel rejects 0^0 | `#NUM!` |
| math | `=POWER(-8,1/3)` | LibreOffice computes the real cube root | `#NUM!` |
| math | `=PRODUCT("2",3)` | LibreOffice rejects numeric text literals in PRODUCT | `6` |
| math | `=PRODUCT(A1:A2,D1:D2)` | LibreOffice treats boolean cells as numbers in references | `2` |
| math | `=COUNTIF(D1:D6,42)` | Excel lets a numeric criterion match the text "42" | `1` |
| math | `=SUMPRODUCT(A1:A2,D1:D2)` | LibreOffice treats boolean cells as numbers in references | `0` |
| math | `=CEILING(2.5,-1)` | Excel rejects positive number with negative significance; LibreOffice gives #VALUE! | `#NUM!` |
| logical | `=TRUE()&""` | LibreOffice converts booleans to 1/0 when concatenating | `TRUE` |
| logical | `=FALSE()&""` | LibreOffice converts booleans to 1/0 when concatenating | `FALSE` |
| info | `=ISNUMBER(D1)` | LibreOffice treats boolean cells as numbers | `FALSE` |
| text | `=CONCAT(1,TRUE)` | LibreOffice converts booleans to 1/0 when concatenating | `1TRUE` |
| text | `=CONCAT(D1:D3)` | LibreOffice treats boolean cells as numbers | `TRUEFALSE` |
| text | `=CONCATENATE(D1,D2)` | LibreOffice treats boolean cells as numbers | `TRUEFALSE` |
| text | `=LEFT(D1,2)` | LibreOffice treats boolean cells as numbers | `TR` |
| text | `=LEN(TRUE)` | LibreOffice converts booleans to numbers | `4` |
| text | `=UPPER(TRUE)` | LibreOffice converts booleans to numbers | `TRUE` |
| text | `=LOWER(TRUE)` | LibreOffice converts booleans to numbers | `true` |
| text | `=FIND("","abc")` | Excel returns the start position for an empty search text | `1` |
| text | `=VALUE(TRUE)` | Excel rejects booleans | `#VALUE!` |
| lookup | `=VLOOKUP(100,F1:G4,3,FALSE)` | LibreOffice gives #VALUE! for a column index beyond the table | `#REF!` |
| lookup | `=VLOOKUP("3",A1:A6,1,FALSE)` | LibreOffice matches numeric text against numbers | `#N/A` |
| lookup | `=HLOOKUP(TRUE,A1:F6,2,FALSE)` | LibreOffice matches TRUE against the number 1 | `FALSE` |
| lookup | `=HLOOKUP(1,A1:F6,7,FALSE)` | LibreOffice gives #VALUE! for a row index beyond the table | `#REF!` |
| datetime | `=DATE(1900,1,1)` | LibreOffice serials before 1900-03-01 are off by one | `1` |
| datetime | `=DATE(1,1,1)` | Excel adds 1900 to years 0..1899; LibreOffice reads year 1 as 2001 | `367` |
| datetime | `=DATE(10000,1,1)` | Excel limits years to 9999 | `#NUM!` |
| datetime | `=YEAR(0)` | Excel serial 0 is the fictitious 1900-01-00 | `1900` |
| datetime | `=YEAR(-1)` | Excel rejects negative serials | `#NUM!` |
| datetime | `=YEAR(D4)` | Excel serial 0 is the fictitious 1900-01-00 | `1900` |
| datetime | `=YEAR(E4)` | Excel serial 0.5 is in the fictitious 1900-01-00 | `1900` |
| datetime | `=MONTH(0)` | Excel serial 0 is the fictitious 1900-01-00 | `1` |
| datetime | `=MONTH(-1)` | Excel rejects negative serials | `#NUM!` |
| datetime | `=MONTH(D4)` | Excel serial 0 is the fictitious 1900-01-00 | `1` |
| datetime | `=DAY(0)` | Excel serial 0 is the fictitious 1900-01-00 | `0` |
| datetime | `=DAY(1)` | LibreOffice serials before 1900-03-01 are off by one | `1` |
| datetime | `=DAY(D4)` | Excel serial 0 is the fictitious 1900-01-00 | `0` |
| datetime | `=DAY(-1)` | Excel rejects negative serials | `#NUM!` |
| datetime | `=DAY(60)` | Excel serial 60 is the non-existent 1900-02-29 | `29` |
| datetime | `=WEEKDAY(E1,4)` | LibreOffice gives #VALUE! for an invalid return type | `#NUM!` |
| datetime | `=WEEKDAY(-1)` | Excel rejects negative serials | `#NUM!` |
| datetime | `=DAYS(E3,E1)` | LibreOffice keeps the fractional day; Excel is believed to truncate both dates | `0` |
| operators | `=1&TRUE` | LibreOffice converts booleans to 1/0 when concatenating | `1TRUE` |
| operators | `=TRUE&FALSE` | LibreOffice converts booleans to 1/0 when concatenating | `TRUEFALSE` |
| operators | `=TRUE>1` | LibreOffice treats booleans as numbers in comparisons | `TRUE` |
| operators | `=TRUE>"a"` | LibreOffice treats booleans as numbers in comparisons | `TRUE` |
| operators | `=FALSE>"zzz"` | LibreOffice treats booleans as numbers in comparisons | `TRUE` |
| operators | `=TRUE=1` | LibreOffice treats booleans as numbers in comparisons | `FALSE` |
| operators | `=FALSE=0` | LibreOffice treats booleans as numbers in comparisons | `FALSE` |
| operators | `=H1+H2` | LibreOffice returns the right-hand error for cell references; Excel is believed to return the left-hand one | `#DIV/0!` |
| operators | `=H2+H1` | LibreOffice returns the right-hand error for cell references; Excel is believed to return the left-hand one | `#N/A` |
| operators | `=0^0` | Excel rejects 0^0 | `#NUM!` |
| operators | `=(-8)^(1/3)` | LibreOffice computes the real cube root | `#NUM!` |
| references | `=COUNT(A1:D6)` | LibreOffice treats boolean cells as numbers in references | `12` |
| references | `=COUNT(Data!A1:H6)` | LibreOffice treats boolean cells as numbers in references | `20` |
| errors | `=SQRT(-1)` | LibreOffice reports #VALUE! on xlsx export | `#NUM!` |
| errors | `=H1+H2` | LibreOffice returns the right-hand error for cell references; Excel is believed to return the left-hand one | `#DIV/0!` |
| errors | `=SQRT(-1)+1` | LibreOffice reports #VALUE! on xlsx export | `#NUM!` |
| errors | `=Nope!A1` | LibreOffice reports #NAME? for an unknown sheet | `#REF!` |
| lookup | `=SEQUENCE(0)` | LibreOffice has no #CALC! error for an empty array | `#CALC!` |
| lookup | `=FILTER(A1:A6,A1:A6>10)` | LibreOffice has no #CALC! error for an empty array | `#CALC!` |
| lookup | `=UNIQUE({1;1},FALSE,TRUE)` | LibreOffice has no #CALC! error for an empty array | `#CALC!` |

Task P8-6 added 44 `lookup` cases for the dynamic array functions (`SORT`, `SORTBY`, `FILTER`, `UNIQUE`, `SEQUENCE`,
`RANDARRAY`, written with `_xlfn.` / `_xlfn._xlws.` prefixes); they wrap the arrays in `INDEX`, `SUM`, `ROWS`,
`TEXTJOIN` so the result cell holds one value. Phase 8 (task P8-1) added the cases for the second function wave (about 700 rows, mostly in `math` and `lookup`). Besides the
rows of the table above, many carry `DIFF:` notes with an `[excel=...]` value; the common reasons are that LibreOffice
exports `#NUM!`, `#DIV/0!` or `#REF!` results of these functions as `#VALUE!`, that it accepts arguments Excel rejects
(`SYD` with `per` beyond the life, `EFFECT` with a zero rate, negative serials in `HOUR`) and that `CHAR`/`CODE` depend on
the system code page. Read the `# NOTE:` lines in `testdata/formulas/*.tsv` for the full list.
