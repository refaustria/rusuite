# MVP function list

The 62 functions the first formula evaluator must implement. Behaviour is Microsoft Excel's; the
reference cases live in `testdata/formulas/*.tsv` (see [formula-suite.md](formula-suite.md)).
Status `planned` means no implementation exists yet.

General rules that apply to every function below:

- An error value in a scalar argument is the result (leftmost error wins); `IF`, `CHOOSE`, `IFERROR` only evaluate the branch they select.
- Text that looks like a number is coerced in scalar arguments (`"3"` -> 3) but ignored inside references for aggregating functions (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `PRODUCT`).
- Booleans and text inside a reference are ignored by the aggregating functions; booleans written as literal arguments count as 1/0.
- An empty cell is 0 in arithmetic, `""` in text contexts, and is skipped by aggregating functions.
- Dates are serial numbers (1900 system, serial 1 = 1900-01-01, the non-existent 1900-02-29 is serial 60).

## Math / statistics (20)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `SUM` | `SUM(number1, [number2], ...)` | Sum of numbers | Text/bools in references ignored; `SUM("3",4)` = 7; no numbers = 0 | implemented |
| `AVERAGE` | `AVERAGE(number1, ...)` | Arithmetic mean | `#DIV/0!` if no numeric values; empty cells not counted | implemented |
| `MIN` | `MIN(number1, ...)` | Smallest number | No numbers = 0; text literal that is not numeric = `#VALUE!` | implemented |
| `MAX` | `MAX(number1, ...)` | Largest number | No numbers = 0; text literal that is not numeric = `#VALUE!` | implemented |
| `COUNT` | `COUNT(value1, ...)` | Count of numeric values | Errors in references not counted and not propagated; `COUNT(TRUE)` literal = 1; numeric text literal counts | implemented |
| `COUNTA` | `COUNTA(value1, ...)` | Count of non-empty values | Counts `""` constants, errors and bools; empty cells not counted | implemented |
| `ROUND` | `ROUND(number, digits)` | Round half away from zero | Negative digits round left of the decimal point; text number coerced | implemented |
| `ROUNDUP` | `ROUNDUP(number, digits)` | Round away from zero | Negative numbers go more negative | implemented |
| `ROUNDDOWN` | `ROUNDDOWN(number, digits)` | Round towards zero | Negative numbers go towards zero | implemented |
| `INT` | `INT(number)` | Floor to integer | `INT(-2.1)` = -3 | implemented |
| `MOD` | `MOD(number, divisor)` | Remainder, sign of divisor | Divisor 0 = `#DIV/0!`; `MOD(-10,3)` = 2 | implemented |
| `ABS` | `ABS(number)` | Absolute value | Numeric text coerced; non-numeric text `#VALUE!` | implemented |
| `SQRT` | `SQRT(number)` | Square root | Negative = `#NUM!` | implemented |
| `POWER` | `POWER(number, power)` | `number^power` | `POWER(0,0)` = `#NUM!`; `POWER(0,-1)` = `#DIV/0!`; negative base with fractional exponent = `#NUM!` | implemented |
| `PI` | `PI()` | 3.14159265358979 | Takes no arguments | implemented |
| `PRODUCT` | `PRODUCT(number1, ...)` | Product of numbers | No numbers = 0; bools in references ignored | implemented |
| `SUMIF` | `SUMIF(range, criteria, [sum_range])` | Sum of cells matching criteria | Criteria like `">3"`, `"<>x"`, wildcards `*` `?`; case-insensitive; error in criteria expression propagates | implemented |
| `COUNTIF` | `COUNTIF(range, criteria)` | Count of cells matching criteria | `""` criterion counts empty and empty-string cells; numeric criterion also matches numeric text | implemented |
| `SUMPRODUCT` | `SUMPRODUCT(array1, [array2], ...)` | Sum of element-wise products | Non-numeric entries count as 0; size mismatch `#VALUE!`; accepts array expressions | implemented |
| `CEILING` | `CEILING(number, significance)` | Round up to a multiple | Significance 0 = 0; positive number with negative significance = `#NUM!`; negative number rounds towards zero when significance is positive | implemented |

## Logical (7)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `IF` | `IF(condition, then, [else])` | Conditional | Missing else = `FALSE`; numbers are truthy when non-zero; text `"TRUE"` accepted, other text `#VALUE!`; lazy | planned |
| `AND` | `AND(logical1, ...)` | All true | References with only text/empty = `#VALUE!`; not short-circuiting for errors | planned |
| `OR` | `OR(logical1, ...)` | Any true | Same coercion rules as `AND` | planned |
| `NOT` | `NOT(logical)` | Negation | Non-numeric text `#VALUE!` | planned |
| `IFERROR` | `IFERROR(value, value_if_error)` | Fallback on any error | Catches all seven error kinds; empty cell result is 0 | planned |
| `TRUE` | `TRUE()` | Boolean true | Also valid as the literal `TRUE`; `TRUE()+1` = 2 | planned |
| `FALSE` | `FALSE()` | Boolean false | Also valid as the literal `FALSE` | planned |

## Information (6)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `ISBLANK` | `ISBLANK(value)` | Cell is truly empty | `""` constant is not blank; error cell is not blank | planned |
| `ISNUMBER` | `ISNUMBER(value)` | Value is a number | Dates are numbers; numeric text and bools are not | planned |
| `ISTEXT` | `ISTEXT(value)` | Value is text | `""` is text; empty cell is not | planned |
| `ISERROR` | `ISERROR(value)` | Value is any error | Does not propagate the error | planned |
| `ISNA` | `ISNA(value)` | Value is `#N/A` | Other errors give `FALSE` | planned |
| `NA` | `NA()` | Returns `#N/A` | Takes no arguments | planned |

## Text (14)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `CONCAT` | `CONCAT(text1, ...)` | Join, ranges flattened | Stored as `_xlfn.CONCAT` in files; bools become `TRUE`/`FALSE` | planned |
| `CONCATENATE` | `CONCATENATE(text1, ...)` | Join scalar arguments | Legacy; numbers use general format | planned |
| `LEFT` | `LEFT(text, [count])` | Leading characters | Default 1; negative count `#VALUE!`; numbers converted to text first | planned |
| `RIGHT` | `RIGHT(text, [count])` | Trailing characters | Default 1; negative count `#VALUE!` | planned |
| `MID` | `MID(text, start, count)` | Substring | Start < 1 or count < 0 `#VALUE!`; start beyond end = `""` | planned |
| `LEN` | `LEN(text)` | Character count | Numbers measured on their text form; `LEN(TRUE)` = 4 | planned |
| `UPPER` | `UPPER(text)` | Upper case | Unicode aware | planned |
| `LOWER` | `LOWER(text)` | Lower case | Unicode aware | planned |
| `TRIM` | `TRIM(text)` | Strip leading/trailing spaces, collapse inner runs | Only the ASCII space | planned |
| `FIND` | `FIND(find, within, [start])` | 1-based position, case-sensitive | No wildcards; empty needle returns start; not found `#VALUE!`; start < 1 `#VALUE!` | planned |
| `SUBSTITUTE` | `SUBSTITUTE(text, old, new, [instance])` | Replace occurrences | Case-sensitive; empty `old` leaves text unchanged; instance 0 `#VALUE!` | planned |
| `TEXT` | `TEXT(value, format)` | Format a value as text | MVP codes only: `0` `0.00` `#,##0` `#,##0.00` `0%` `0.0%` `yyyy-mm-dd` `dd.mm.yyyy` `mm/dd/yyyy` `@`; text input returned unchanged; numeric text converted first | planned |
| `VALUE` | `VALUE(text)` | Parse number from text | Accepts spaces, `%`, exponent, dates (locale); `""` and bools `#VALUE!` | planned |
| `EXACT` | `EXACT(text1, text2)` | Case-sensitive equality | Numbers compared as text | planned |

## Lookup / reference (7)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `VLOOKUP` | `VLOOKUP(value, table, col, [approx=TRUE])` | Search first column | Default approximate (sorted) match; exact match supports wildcards and is case-insensitive; col < 1 `#VALUE!`; col > width `#REF!`; no match `#N/A` | planned |
| `HLOOKUP` | `HLOOKUP(value, table, row, [approx=TRUE])` | Search first row | Mirror of `VLOOKUP` | planned |
| `INDEX` | `INDEX(range, row, [col])` | Element of a range | Out of range `#REF!`; negative `#VALUE!`; one-dimensional ranges accept a single index; empty cell yields 0 | planned |
| `MATCH` | `MATCH(value, range, [type=1])` | Position in a range | Type 0 exact (wildcards), 1 largest <=, -1 smallest >=; no match `#N/A` | planned |
| `CHOOSE` | `CHOOSE(index, value1, ...)` | Pick by index | Index truncated; out of range `#VALUE!`; lazy | planned |
| `ROW` | `ROW([reference])` | Row number of a reference | Errors in the referenced cell are not propagated; no-argument form is the host cell | planned |
| `COLUMN` | `COLUMN([reference])` | Column number of a reference | `COLUMN(XFD1)` = 16384 | planned |

## Date / time (8)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `TODAY` | `TODAY()` | Current date serial | Volatile | planned |
| `NOW` | `NOW()` | Current date-time serial | Volatile | planned |
| `DATE` | `DATE(year, month, day)` | Build a date serial | Months/days overflow and underflow roll over; years 0-1899 get 1900 added; year >= 10000 `#NUM!`; arguments truncated | planned |
| `YEAR` | `YEAR(serial)` | Year of a date | Negative serial `#NUM!`; serial 0 = 1900 | planned |
| `MONTH` | `MONTH(serial)` | Month of a date | Serial 60 = February (1900-02-29 quirk) | planned |
| `DAY` | `DAY(serial)` | Day of month | Serial 0 = day 0; serial 60 = day 29 | planned |
| `WEEKDAY` | `WEEKDAY(serial, [type=1])` | Day of week | Types 1, 2, 3, 11-17; other types `#NUM!`; serial 1 is treated as a Sunday | planned |
| `DAYS` | `DAYS(end, start)` | `end - start` in days | Stored as `_xlfn.DAYS`; time part ignored; text dates parsed | planned |

## Deferred

Considered but not part of the MVP: TRUNC, EXP, LN, LOG, SIGN, FLOOR, AVERAGEIF, IFNA, IFS, XOR,
ISLOGICAL, SEARCH, REPLACE, REPT, PROPER, CHAR, CODE, ROWS, COLUMNS, HOUR, MINUTE, SECOND, TIME,
EOMONTH, EDATE, RAND, RANDBETWEEN.

Also deferred: implicit intersection of a range in scalar context and dynamic-array spilling
(`=ROW(B2:B4)` spills in Excel 365), array constants, and the no-argument forms of `ROW`/`COLUMN`.
