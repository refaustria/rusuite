# Function list

The 221 functions the formula evaluator implements (the 62 MVP functions of Phase 1 plus the Phase 8
library growth, tasks P8-1, P8-4 and the dynamic array functions of P8-6, `GETPIVOTDATA` of P8-30). Behaviour is Microsoft Excel's; the reference cases live in
`testdata/formulas/*.tsv` (see [formula-suite.md](formula-suite.md)).
Status `planned` means no implementation exists yet.

General rules that apply to every function below:

- An error value in a scalar argument is the result (leftmost error wins); `IF`, `CHOOSE`, `IFERROR` only evaluate the branch they select.
- Text that looks like a number is coerced in scalar arguments (`"3"` -> 3) but ignored inside references for aggregating functions (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `PRODUCT`).
- Booleans and text inside a reference are ignored by the aggregating functions; booleans written as literal arguments count as 1/0.
- An empty cell is 0 in arithmetic, `""` in text contexts, and is skipped by aggregating functions.
- Dates are serial numbers (1900 system, serial 1 = 1900-01-01, the non-existent 1900-02-29 is serial 60).
- Defined names (P8-23): an identifier that is not a function call, a reference or `TRUE`/`FALSE` is a defined name – the formula's sheet's own name first, then the workbook's; `Sheet1!Name` reaches a sheet's name (or, without one, the workbook's). A name refers to a range (usable wherever a range is: `SUM(Sales)`, `INDEX(Sales,2)`, `=Sales` spills), a constant (`0.19`) or a formula (`OFFSET(...)`), evaluated where it is used; relative references in a definition are relative to `A1` (as Excel stores them) and wrap around the sheet edges. Formulas recalculate when a cell the name reads changes (the dependency graph sees the expanded definition), and when the name is defined, edited or deleted. An unknown name is `#NAME?`; a name referring to itself is `#NAME?` after 32 levels. Names follow row/column inserts and deletes and sheet renames; deleting a sheet deletes its own names and turns references to it into `#REF!`. `TEXT` uses the full number format grammar of [number-formats.md](number-formats.md).
- Structured references (P8-35): `Table1[Qty]` is the data of a table column, `Table1[[Qty]:[Price]]` a range of columns, `Table1` or `Table1[]` the data, `Table1[#All]`, `[#Headers]`, `[#Data]`, `[#Totals]` and combinations (`Table1[[#Headers],[#Data],[Qty]]`) the parts, `[@Qty]` / `Table1[@Qty]` / `[@[Unit Price]]` the cell of the formula's row (`#VALUE!` outside the data rows). Inside a table the table name may be left out (`=[@Qty]*[@Price]`). Table names come before defined names and are case-insensitive. `'` escapes `[`, `]`, `#` and `'` in column names. A missing part (`[#Totals]` without a totals row) or an unknown column is `#REF!`; an unknown table is `#NAME?`. References follow the table when it grows (typing below/right of it, Resize Table), when it or its columns are renamed (header edits) and when rows/columns are inserted; Convert to Range turns them into A1 references. A deleted column leaves the text unchanged and the reference evaluates to `#REF!`.
- Dynamic arrays (Excel 365): a cell formula whose result is an array (a function such as `SORT`, a range `=A1:A3`, an operator over ranges `=A1:A3*2`) *spills* into the cells below and to the right; blank elements show 0. A non-empty target cell (or the sheet edge) gives `#SPILL!` in the formula cell until it is cleared. `A1#` is the range the formula in A1 spills into (`#REF!` when A1 holds no formula or is `#SPILL!`); `@` forces one value (implicit intersection of a range with the formula's row/column, the top-left element of an array). Functions are not lifted over arrays in scalar arguments (`=LEN(A1:A3)` uses implicit intersection), and whole-column/row ranges are clipped to the used range.

## Math (66)

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
| `TRUNC` | `TRUNC(number, [digits])` | Truncate toward zero | Default 0 digits; negative digits truncate left of the decimal point; `TRUNC(-8.9)` = -8 | implemented |
| `CEILING.MATH` | `CEILING.MATH(number, [significance], [mode])` | Round up to a multiple of the absolute significance | Stored as `_xlfn.CEILING.MATH`; default significance 1; significance 0 = 0; negative numbers round toward +infinity, a non-zero mode rounds them away from zero | implemented |
| `FLOOR.MATH` | `FLOOR.MATH(number, [significance], [mode])` | Round down to a multiple of the absolute significance | Stored as `_xlfn.FLOOR.MATH`; significance 0 = 0; negative numbers round away from zero, a non-zero mode rounds them toward zero | implemented |
| `FLOOR` | `FLOOR(number, significance)` | Round down to a multiple | Significance 0 `#DIV/0!` (0 for number 0); positive number with negative significance `#NUM!`; `FLOOR(-2.5,2)` = -4, `FLOOR(-2.5,-2)` = -2 | implemented |
| `MROUND` | `MROUND(number, multiple)` | Round to the nearest multiple | Halves away from zero; multiple 0 = 0; differing signs `#NUM!` | implemented |
| `EXP` | `EXP(number)` | e raised to a power | Overflow `#NUM!` | implemented |
| `LN` | `LN(number)` | Natural logarithm | Number <= 0 `#NUM!` | implemented |
| `LOG` | `LOG(number, [base=10])` | Logarithm in a base | Number or base <= 0 `#NUM!`; base 1 `#DIV/0!` | implemented |
| `LOG10` | `LOG10(number)` | Base-10 logarithm | Number <= 0 `#NUM!` | implemented |
| `SIGN` | `SIGN(number)` | 1, 0 or -1 | Text `#VALUE!` | implemented |
| `RAND` | `RAND()` | Random number in [0, 1) | Volatile: recalculated on every recalculation; no seed control | implemented |
| `RANDBETWEEN` | `RANDBETWEEN(bottom, top)` | Random integer in [bottom, top] | Volatile; bounds rounded inward (`ceil(bottom)`, `floor(top)`); empty range `#NUM!` | implemented |
| `SUMSQ` | `SUMSQ(number1, ...)` | Sum of squares | Same argument rules as `SUM` (text and bools in references ignored) | implemented |
| `SQRTPI` | `SQRTPI(number)` | Square root of number times pi | Negative `#NUM!` | implemented |
| `FACT` | `FACT(number)` | Factorial | Argument truncated; negative or above 170 `#NUM!` | implemented |
| `FACTDOUBLE` | `FACTDOUBLE(number)` | Double factorial `n!!` | Argument truncated; `-1` and `0` give 1; below -1 `#NUM!` | implemented |
| `COMBIN` | `COMBIN(n, k)` | Number of combinations | Arguments truncated; negative or `k > n` `#NUM!` | implemented |
| `PERMUT` | `PERMUT(n, k)` | Number of permutations | Arguments truncated; negative or `k > n` `#NUM!` | implemented |
| `GCD` | `GCD(number1, ...)` | Greatest common divisor | Arguments truncated; negative `#NUM!`; all zero = 0; ranges accepted | implemented |
| `LCM` | `LCM(number1, ...)` | Least common multiple | Arguments truncated; negative `#NUM!`; any zero = 0; overflow `#NUM!` | implemented |
| `QUOTIENT` | `QUOTIENT(numerator, denominator)` | Integer part of a division | Truncates toward zero; denominator 0 `#DIV/0!` | implemented |
| `EVEN` | `EVEN(number)` | Round away from zero to the next even integer | `EVEN(0)` = 0; `EVEN(-1)` = -2 | implemented |
| `ODD` | `ODD(number)` | Round away from zero to the next odd integer | `ODD(0)` = 1; `ODD(-2)` = -3 | implemented |
| `SIN` | `SIN(number)` | Sine of an angle in radians | Text `#VALUE!` | implemented |
| `COS` | `COS(number)` | Cosine of an angle in radians | Text `#VALUE!` | implemented |
| `TAN` | `TAN(number)` | Tangent of an angle in radians | Text `#VALUE!` | implemented |
| `ASIN` | `ASIN(number)` | Arcsine in radians | Number outside [-1, 1] `#NUM!` | implemented |
| `ACOS` | `ACOS(number)` | Arccosine in radians | Number outside [-1, 1] `#NUM!` | implemented |
| `ATAN` | `ATAN(number)` | Arctangent in radians | Result in (-pi/2, pi/2) | implemented |
| `ATAN2` | `ATAN2(x_num, y_num)` | Angle of the point (x, y) | Argument order is x then y; both 0 `#DIV/0!` | implemented |
| `SINH` | `SINH(number)` | Hyperbolic sine | Overflow `#NUM!` | implemented |
| `COSH` | `COSH(number)` | Hyperbolic cosine | Overflow `#NUM!` | implemented |
| `TANH` | `TANH(number)` | Hyperbolic tangent | Result in (-1, 1) | implemented |
| `DEGREES` | `DEGREES(angle)` | Radians to degrees | `DEGREES(PI())` = 180 | implemented |
| `RADIANS` | `RADIANS(angle)` | Degrees to radians | `RADIANS(180)` = pi | implemented |
| `SUMX2MY2` | `SUMX2MY2(array_x, array_y)` | Sum of `x^2 - y^2` | Pairs where both entries are numbers; different sizes `#N/A` | implemented |
| `SUMX2PY2` | `SUMX2PY2(array_x, array_y)` | Sum of `x^2 + y^2` | Pairs where both entries are numbers; different sizes `#N/A` | implemented |
| `SUMXMY2` | `SUMXMY2(array_x, array_y)` | Sum of `(x - y)^2` | Pairs where both entries are numbers; different sizes `#N/A` | implemented |
| `COUNTBLANK` | `COUNTBLANK(range)` | Count of empty cells | Counts empty cells and cells holding `""`; whole-column references count all rows | implemented |
| `SUMIFS` | `SUMIFS(sum_range, criteria_range1, criteria1, ...)` | Sum where all criteria hold | ranges must have the same shape (`#VALUE!`); criteria syntax as `SUMIF`; errors in matching sum cells propagate | implemented |
| `COUNTIFS` | `COUNTIFS(criteria_range1, criteria1, ...)` | Count where all criteria hold | Ranges must have the same shape (`#VALUE!`); criteria syntax as `COUNTIF` | implemented |
| `AVERAGEIF` | `AVERAGEIF(range, criteria, [average_range])` | Mean of matching cells | Only numeric matching cells count; none `#DIV/0!`; `average_range` aligned by its top-left cell | implemented |
| `AVERAGEIFS` | `AVERAGEIFS(average_range, criteria_range1, criteria1, ...)` | Mean where all criteria hold | Ranges must have the same shape (`#VALUE!`); no numeric match `#DIV/0!` | implemented |
| `MAXIFS` | `MAXIFS(max_range, criteria_range1, criteria1, ...)` | Largest matching number | Stored as `_xlfn.MAXIFS`; no match = 0; ranges must have the same shape (`#VALUE!`) | implemented |
| `MINIFS` | `MINIFS(min_range, criteria_range1, criteria1, ...)` | Smallest matching number | Stored as `_xlfn.MINIFS`; no match = 0; ranges must have the same shape (`#VALUE!`) | implemented |
| `SUBTOTAL` | `SUBTOTAL(function_num, ref1, [ref2], ...)` | AVERAGE/COUNT/COUNTA/MAX/MIN/PRODUCT/STDEV/STDEVP/SUM/VAR/VARP (1-11) of the references | Rows hidden by an AutoFilter are always skipped, 101-111 also skip rows hidden by hand; hidden columns count; cells holding a `SUBTOTAL` are skipped; arguments must be references (`#VALUE!`); function number outside 1-11/101-111 `#VALUE!` | implemented |

## Logical (11)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `IF` | `IF(condition, then, [else])` | Conditional | Missing else = `FALSE`; numbers are truthy when non-zero; text `"TRUE"` accepted, other text `#VALUE!`; lazy | implemented |
| `AND` | `AND(logical1, ...)` | All true | References with only text/empty = `#VALUE!`; not short-circuiting for errors | implemented |
| `OR` | `OR(logical1, ...)` | Any true | Same coercion rules as `AND` | implemented |
| `NOT` | `NOT(logical)` | Negation | Non-numeric text `#VALUE!` | implemented |
| `IFERROR` | `IFERROR(value, value_if_error)` | Fallback on any error | Catches all seven error kinds; empty cell result is 0 | implemented |
| `TRUE` | `TRUE()` | Boolean true | Also valid as the literal `TRUE`; `TRUE()+1` = 2 | implemented |
| `FALSE` | `FALSE()` | Boolean false | Also valid as the literal `FALSE` | implemented |
| `IFS` | `IFS(test1, value1, [test2, value2], ...)` | Value of the first true test | Stored as `_xlfn.IFS`; lazy; no true test or an odd argument count `#N/A` | implemented |
| `SWITCH` | `SWITCH(expression, value1, result1, ..., [default])` | Result of the first equal value | Stored as `_xlfn.SWITCH`; text compares case-insensitively and never equals a number; no match without default `#N/A`; lazy | implemented |
| `IFNA` | `IFNA(value, value_if_na)` | Fallback for `#N/A` only | Stored as `_xlfn.IFNA`; other errors pass through | implemented |
| `XOR` | `XOR(logical1, ...)` | True for an odd number of true values | Stored as `_xlfn.XOR`; coercion as `AND`/`OR` | implemented |

## Information (16)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `ISBLANK` | `ISBLANK(value)` | Cell is truly empty | `""` constant is not blank; error cell is not blank | implemented |
| `ISNUMBER` | `ISNUMBER(value)` | Value is a number | Dates are numbers; numeric text and bools are not | implemented |
| `ISTEXT` | `ISTEXT(value)` | Value is text | `""` is text; empty cell is not | implemented |
| `ISERROR` | `ISERROR(value)` | Value is any error | Does not propagate the error | implemented |
| `ISNA` | `ISNA(value)` | Value is `#N/A` | Other errors give `FALSE` | implemented |
| `NA` | `NA()` | Returns `#N/A` | Takes no arguments | implemented |
| `ISLOGICAL` | `ISLOGICAL(value)` | Value is TRUE/FALSE | Text `"TRUE"` is not logical | implemented |
| `ISEVEN` | `ISEVEN(number)` | Integer part is even | Truncates; bools and non-numeric text `#VALUE!` | implemented |
| `ISODD` | `ISODD(number)` | Integer part is odd | Truncates; bools and non-numeric text `#VALUE!` | implemented |
| `ISERR` | `ISERR(value)` | Any error except `#N/A` | Does not propagate the error | implemented |
| `ISNONTEXT` | `ISNONTEXT(value)` | Value is not text | Blank cells and errors are non-text | implemented |
| `ISREF` | `ISREF(value)` | Argument is a reference | `INDEX`, `OFFSET`, `INDIRECT` results count | implemented |
| `N` | `N(value)` | Value as a number | Numbers as is, TRUE = 1, text = 0, errors propagate | implemented |
| `T` | `T(value)` | Value as text | Text as is, everything else `""`, errors propagate | implemented |
| `TYPE` | `TYPE(value)` | Type code | 1 number or blank, 2 text, 4 logical, 16 error, 64 array or multi-cell range | implemented |
| `CELL` | `CELL(info_type, [reference])` | Information about a cell | Subset: `address` (`$A$1`, no sheet name), `row`, `col`, `contents`, `type` (`b`, `l`, `v`); other types `#VALUE!`; default reference is the formula cell | implemented |

## Text (26)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `CONCAT` | `CONCAT(text1, ...)` | Join, ranges flattened | Stored as `_xlfn.CONCAT` in files; bools become `TRUE`/`FALSE` | implemented |
| `CONCATENATE` | `CONCATENATE(text1, ...)` | Join scalar arguments | Legacy; numbers use general format | implemented |
| `LEFT` | `LEFT(text, [count])` | Leading characters | Default 1; negative count `#VALUE!`; numbers converted to text first | implemented |
| `RIGHT` | `RIGHT(text, [count])` | Trailing characters | Default 1; negative count `#VALUE!` | implemented |
| `MID` | `MID(text, start, count)` | Substring | Start < 1 or count < 0 `#VALUE!`; start beyond end = `""` | implemented |
| `LEN` | `LEN(text)` | Character count | Numbers measured on their text form; `LEN(TRUE)` = 4 | implemented |
| `UPPER` | `UPPER(text)` | Upper case | Unicode aware | implemented |
| `LOWER` | `LOWER(text)` | Lower case | Unicode aware | implemented |
| `TRIM` | `TRIM(text)` | Strip leading/trailing spaces, collapse inner runs | Only the ASCII space | implemented |
| `FIND` | `FIND(find, within, [start])` | 1-based position, case-sensitive | No wildcards; empty needle returns start; not found `#VALUE!`; start < 1 `#VALUE!` | implemented |
| `SUBSTITUTE` | `SUBSTITUTE(text, old, new, [instance])` | Replace occurrences | Case-sensitive; empty `old` leaves text unchanged; instance 0 `#VALUE!` | implemented |
| `TEXT` | `TEXT(value, format)` | Format a value as text | MVP codes only: `0` `0.00` `#,##0` `#,##0.00` `0%` `0.0%` `yyyy-mm-dd` `dd.mm.yyyy` `mm/dd/yyyy` `@`; text input returned unchanged; numeric text converted first | implemented |
| `VALUE` | `VALUE(text)` | Parse number from text | Accepts spaces, `%`, exponent, dates (locale); `""` and bools `#VALUE!` | implemented |
| `EXACT` | `EXACT(text1, text2)` | Case-sensitive equality | Numbers compared as text | implemented |
| `SEARCH` | `SEARCH(find, within, [start])` | 1-based position, case-insensitive | Wildcards `?` `*` (escape with `~`); not found or start out of range `#VALUE!`; empty needle returns start | implemented |
| `REPLACE` | `REPLACE(old_text, start, count, new_text)` | Replace characters by position | Start < 1 or count < 0 `#VALUE!`; start beyond the end appends | implemented |
| `REPT` | `REPT(text, count)` | Repeat text | Count truncated; negative or result above 32767 characters `#VALUE!` | implemented |
| `PROPER` | `PROPER(text)` | Capitalize each word | Letter after any non-letter is upper-cased, the rest lower-cased (`2nd` becomes `2Nd`) | implemented |
| `CHAR` | `CHAR(number)` | Character of a code | Windows-1252 codes 1..255 (Excel for Windows); others `#VALUE!` | implemented |
| `CODE` | `CODE(text)` | Code of the first character | Windows-1252; characters outside it give 63; empty text `#VALUE!` | implemented |
| `UNICODE` | `UNICODE(text)` | Code point of the first character | Stored as `_xlfn.UNICODE`; empty text `#VALUE!` | implemented |
| `UNICHAR` | `UNICHAR(number)` | Character of a code point | Stored as `_xlfn.UNICHAR`; 0, surrogates and values above 1114111 `#VALUE!` | implemented |
| `CLEAN` | `CLEAN(text)` | Remove control characters | Removes characters 0..31 | implemented |
| `NUMBERVALUE` | `NUMBERVALUE(text, [decimal_sep], [group_sep])` | Locale-independent text to number | Stored as `_xlfn.NUMBERVALUE`; defaults `.` and `,`; whitespace ignored; trailing `%` divides by 100 each; empty text = 0; equal separators `#VALUE!` | implemented |
| `FIXED` | `FIXED(number, [decimals=2], [no_commas=FALSE])` | Format a number as text | Rounds half away from zero; negative decimals round left of the point; thousands separators unless `no_commas` | implemented |
| `TEXTJOIN` | `TEXTJOIN(delimiter, ignore_empty, text1, ...)` | Join with a delimiter | Stored as `_xlfn.TEXTJOIN`; ranges flattened row-major; a delimiter range is cycled; errors propagate; result above 32767 characters `#VALUE!` | implemented |

## Lookup / reference (19)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `VLOOKUP` | `VLOOKUP(value, table, col, [approx=TRUE])` | Search first column | Default approximate (sorted) match; exact match supports wildcards and is case-insensitive; col < 1 `#VALUE!`; col > width `#REF!`; no match `#N/A` | implemented |
| `HLOOKUP` | `HLOOKUP(value, table, row, [approx=TRUE])` | Search first row | Mirror of `VLOOKUP` | implemented |
| `INDEX` | `INDEX(range, row, [col])` | Element of a range | Out of range `#REF!`; negative `#VALUE!`; one-dimensional ranges accept a single index; empty cell yields 0 | implemented |
| `MATCH` | `MATCH(value, range, [type=1])` | Position in a range | Type 0 exact (wildcards), 1 largest <=, -1 smallest >=; no match `#N/A` | implemented |
| `CHOOSE` | `CHOOSE(index, value1, ...)` | Pick by index | Index truncated; out of range `#VALUE!`; lazy | implemented |
| `ROW` | `ROW([reference])` | Row number of a reference | Errors in the referenced cell are not propagated; no-argument form is the host cell | implemented |
| `COLUMN` | `COLUMN([reference])` | Column number of a reference | `COLUMN(XFD1)` = 16384 | implemented |
| `AREAS` | `AREAS(reference)` | Number of areas of a reference | A union `(A1:B2,D4)` counts its operands, a 3-D reference `Sheet1:Sheet3!A1` its sheets, an intersection one; not a reference `#VALUE!` | implemented |
| `ROWS` | `ROWS(array)` | Number of rows | Whole-column references count 1048576 rows | implemented |
| `COLUMNS` | `COLUMNS(array)` | Number of columns | Whole-row references count 16384 columns | implemented |
| `LOOKUP` | `LOOKUP(value, lookup_vector, [result_vector])` | Approximate match in a sorted vector | Vector form needs ascending data; array form searches the first row (wide) or column (tall) and returns the last; smaller than the first item `#N/A` | implemented |
| `XMATCH` | `XMATCH(value, lookup_array, [match_mode=0], [search_mode=1])` | Position of a value | Stored as `_xlfn.XMATCH`; match mode 0 exact (no wildcards), -1 or next smaller, 1 or next larger, 2 wildcards; search mode 1 or -1 scan direction, 2 or -2 binary search (evaluated as a scan); 2-D array `#VALUE!`; not found `#N/A` | implemented |
| `XLOOKUP` | `XLOOKUP(value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])` | Value at a found position | Stored as `_xlfn.XLOOKUP`; modes as `XMATCH`; returns the matching row or column of `return_array` (an array that spills when it has several cells); returns a reference (`A1:XLOOKUP(..)` works); size mismatch `#VALUE!`; not found gives `if_not_found` (lazy) or `#N/A` | implemented |
| `INDIRECT` | `INDIRECT(ref_text, [a1=TRUE])` | Reference from text | Volatile; A1 or R1C1 (`a1` FALSE) text, optionally sheet-qualified; not a reference `#REF!`; usable as a reference (`SUM(INDIRECT("A1:A3"))`) | implemented |
| `OFFSET` | `OFFSET(reference, rows, cols, [height], [width])` | Displaced reference | Volatile; result outside the sheet or non-positive size `#REF!`; non-reference first argument `#VALUE!`; usable as a reference | implemented |
| `ADDRESS` | `ADDRESS(row, col, [abs=1], [a1=TRUE], [sheet])` | Cell address as text | `abs` 1 `$A$1`, 2 `A$1`, 3 `$A1`, 4 `A1`; R1C1 style when `a1` is FALSE; sheet names are quoted when needed; invalid row, column or `abs` `#VALUE!` | implemented |
| `TRANSPOSE` | `TRANSPOSE(array)` | Swap rows and columns | Whole-column or row references are limited to the used range; spills | implemented |
| `HYPERLINK` | `HYPERLINK(link_location, [friendly_name])` | Cell showing a link | Returns `friendly_name` if given, else the location; the link itself is a UI feature | implemented |
| `GETPIVOTDATA` | `GETPIVOTDATA(data_field, pivot_table, [field1, item1], ...)` | Value shown by a pivot table | Volatile; `data_field` is the caption (`"Sum of Sales"`) or the source field; `pivot_table` any cell of the pivot table; the pairs must name exactly the row/column fields of a visible cell (page fields with one selected item may be named too); items by value or label, text ignoring case; no pairs = grand total; not shown (hidden subtotal, grand total off, filtered item, empty cell) or no pivot table `#REF!` (see `docs/pivot.md`) | implemented |

## Dynamic arrays (6)

Results spill (see the general rules above). Inside other functions they work as arrays: `SUM(SEQUENCE(4))`, `INDEX(SORT(A1:A9),1)`.

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `SORT` | `SORT(array, [sort_index=1], [sort_order=1], [by_col=FALSE])` | Sorted rows (or columns) | Stored as `_xlfn._xlws.SORT`; `sort_index`/`sort_order` may be arrays (several keys); order 1 ascending, -1 descending, else `#VALUE!`; index out of range `#VALUE!`; numbers < text (case-insensitive) < booleans < errors, blank cells last; stable | implemented |
| `SORTBY` | `SORTBY(array, by_array1, [sort_order1], ...)` | Sort by other arrays | Stored as `_xlfn.SORTBY`; each `by_array` is one column as tall as `array` (or one row as wide, sorting columns); other shapes or mixed orientations `#VALUE!`; orders as `SORT` | implemented |
| `FILTER` | `FILTER(array, include, [if_empty])` | Rows (or columns) where `include` is true | Stored as `_xlfn._xlws.FILTER`; `include` one column as tall as `array` or one row as wide; numbers non-zero are true, blanks false, text `#VALUE!`, errors propagate; no match `if_empty` or `#CALC!` | implemented |
| `UNIQUE` | `UNIQUE(array, [by_col=FALSE], [exactly_once=FALSE])` | Distinct rows (or columns) | Stored as `_xlfn.UNIQUE`; first-occurrence order; text compares case-insensitively; `1` and `"1"` differ; empty result `#CALC!` | implemented |
| `SEQUENCE` | `SEQUENCE(rows, [columns=1], [start=1], [step=1])` | Array of counting numbers | Stored as `_xlfn.SEQUENCE`; row by row; sizes truncated, negative `#VALUE!`, zero `#CALC!`; more than 16777216 cells `#NUM!` (engine limit) | implemented |
| `RANDARRAY` | `RANDARRAY([rows=1], [columns=1], [min=0], [max=1], [integer=FALSE])` | Array of random numbers | Stored as `_xlfn.RANDARRAY`; volatile; `[min, max)`, or whole numbers in `[min, max]` with `integer`; `min > max` or fractional bounds with `integer` `#VALUE!`; sizes as `SEQUENCE` | implemented |

## Date / time (24)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `TODAY` | `TODAY()` | Current date serial | Volatile | implemented |
| `NOW` | `NOW()` | Current date-time serial | Volatile | implemented |
| `DATE` | `DATE(year, month, day)` | Build a date serial | Months/days overflow and underflow roll over; years 0-1899 get 1900 added; year >= 10000 `#NUM!`; arguments truncated | implemented |
| `YEAR` | `YEAR(serial)` | Year of a date | Negative serial `#NUM!`; serial 0 = 1900 | implemented |
| `MONTH` | `MONTH(serial)` | Month of a date | Serial 60 = February (1900-02-29 quirk) | implemented |
| `DAY` | `DAY(serial)` | Day of month | Serial 0 = day 0; serial 60 = day 29 | implemented |
| `WEEKDAY` | `WEEKDAY(serial, [type=1])` | Day of week | Types 1, 2, 3, 11-17; other types `#NUM!`; serial 1 is treated as a Sunday | implemented |
| `DAYS` | `DAYS(end, start)` | `end - start` in days | Stored as `_xlfn.DAYS`; time part ignored; text dates parsed | implemented |
| `DATEVALUE` | `DATEVALUE(date_text)` | Date text to serial | Accepts ISO `yyyy-mm-dd`, `yyyy/mm/dd` and US `m/d/yyyy`, optionally with a time (dropped); non-text and unparsable text `#VALUE!` | implemented |
| `TIMEVALUE` | `TIMEVALUE(time_text)` | Time text to fraction of a day | `hh:mm[:ss]`, optional `AM`/`PM`; the date part of a date-time text is dropped; unparsable `#VALUE!` | implemented |
| `TIME` | `TIME(hour, minute, second)` | Time as a fraction of a day | Arguments truncated; negative `#NUM!`; wraps at 24 hours | implemented |
| `HOUR` | `HOUR(serial)` | Hour 0..23 | Time rounded to the second; negative serial `#NUM!`; time text accepted | implemented |
| `MINUTE` | `MINUTE(serial)` | Minute 0..59 | Negative serial `#NUM!`; time text accepted | implemented |
| `SECOND` | `SECOND(serial)` | Second 0..59 | Negative serial `#NUM!`; time text accepted | implemented |
| `EDATE` | `EDATE(start_date, months)` | Date months before or after | Day clamped to the target month's length; months truncated; out of range `#NUM!` | implemented |
| `EOMONTH` | `EOMONTH(start_date, months)` | Last day of a month months away | Months truncated; out of range `#NUM!` | implemented |
| `NETWORKDAYS` | `NETWORKDAYS(start, end, [holidays])` | Working days between two dates | Monday to Friday; both ends included; negative when end < start | implemented |
| `NETWORKDAYS.INTL` | `NETWORKDAYS.INTL(start, end, [weekend=1], [holidays])` | Working days with custom weekend | `weekend` code 1..7 or 11..17, or a 7-character 0/1 string starting on Monday; invalid code `#NUM!`; invalid string or all-weekend `#VALUE!` | implemented |
| `WORKDAY` | `WORKDAY(start, days, [holidays])` | Date after n working days | Monday to Friday; negative days go back; days 0 returns the start date; out of range `#NUM!` | implemented |
| `WORKDAY.INTL` | `WORKDAY.INTL(start, days, [weekend=1], [holidays])` | Date after n working days, custom weekend | `weekend` as `NETWORKDAYS.INTL` | implemented |
| `DATEDIF` | `DATEDIF(start, end, unit)` | Difference in Y, M, D, MD, YM or YD | Start after end `#NUM!`; unknown unit `#NUM!`; `MD` uses the length of the month before the end date | implemented |
| `YEARFRAC` | `YEARFRAC(start, end, [basis=0])` | Fraction of a year between two dates | Basis 0 US 30/360, 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360; other bases `#NUM!`; dates swapped when start > end | implemented |
| `WEEKNUM` | `WEEKNUM(serial, [type=1])` | Week of the year | Week 1 contains January 1; types 1 and 17 (Sunday), 2 and 11 (Monday), 12 to 16 (Tuesday to Saturday), 21 (ISO); other types `#NUM!`; the last days of December stay in week 52 or 53 | implemented |
| `ISOWEEKNUM` | `ISOWEEKNUM(date)` | ISO 8601 week number | Stored as `_xlfn.ISOWEEKNUM`; weeks start on Monday, week 1 contains the first Thursday | implemented |

## Statistical (38)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `MEDIAN` | `MEDIAN(number1, ...)` | Middle value | `SUM` argument rules; even count averages the two middle values; no numbers `#NUM!` | implemented |
| `MODE` | `MODE(number1, ...)` | Most frequent value | First value in order of appearance among ties; no repeated value `#N/A` | implemented |
| `MODE.SNGL` | `MODE.SNGL(number1, ...)` | Most frequent value | Stored as `_xlfn.MODE.SNGL`; same as `MODE` | implemented |
| `VAR` | `VAR(number1, ...)` | Sample variance | Fewer than 2 numbers `#DIV/0!`; text in references ignored | implemented |
| `VAR.S` | `VAR.S(number1, ...)` | Sample variance | Stored as `_xlfn.VAR.S`; fewer than 2 numbers `#DIV/0!` | implemented |
| `VAR.P` | `VAR.P(number1, ...)` | Population variance | Stored as `_xlfn.VAR.P`; no numbers `#DIV/0!` | implemented |
| `VARP` | `VARP(number1, ...)` | Population variance | No numbers `#DIV/0!` | implemented |
| `STDEV` | `STDEV(number1, ...)` | Sample standard deviation | Fewer than 2 numbers `#DIV/0!` | implemented |
| `STDEV.S` | `STDEV.S(number1, ...)` | Sample standard deviation | Stored as `_xlfn.STDEV.S`; fewer than 2 numbers `#DIV/0!` | implemented |
| `STDEV.P` | `STDEV.P(number1, ...)` | Population standard deviation | Stored as `_xlfn.STDEV.P`; no numbers `#DIV/0!` | implemented |
| `STDEVP` | `STDEVP(number1, ...)` | Population standard deviation | No numbers `#DIV/0!` | implemented |
| `LARGE` | `LARGE(array, k)` | K-th largest number | `k` rounded up; `k < 1`, `k` > count or no numbers `#NUM!`; text ignored | implemented |
| `SMALL` | `SMALL(array, k)` | K-th smallest number | `k` rounded up; `k < 1`, `k` > count or no numbers `#NUM!` | implemented |
| `RANK` | `RANK(number, ref, [order])` | Rank in a list | Descending unless `order` is non-zero; ties share the best rank; number not in the list `#N/A` | implemented |
| `RANK.EQ` | `RANK.EQ(number, ref, [order])` | Rank in a list | Stored as `_xlfn.RANK.EQ`; same as `RANK` | implemented |
| `RANK.AVG` | `RANK.AVG(number, ref, [order])` | Rank, ties averaged | Stored as `_xlfn.RANK.AVG`; tied values get the mean of their ranks | implemented |
| `PERCENTILE` | `PERCENTILE(array, k)` | K-th percentile | `k` in [0, 1] else `#NUM!`; linear interpolation; no numbers `#NUM!` | implemented |
| `PERCENTILE.INC` | `PERCENTILE.INC(array, k)` | K-th percentile (inclusive) | Stored as `_xlfn.PERCENTILE.INC`; same as `PERCENTILE` | implemented |
| `PERCENTILE.EXC` | `PERCENTILE.EXC(array, k)` | K-th percentile (exclusive) | Stored as `_xlfn.PERCENTILE.EXC`; `k` must lie in [1/(n+1), n/(n+1)] else `#NUM!` | implemented |
| `QUARTILE` | `QUARTILE(array, quart)` | Quartile 0 to 4 | `quart` truncated; outside 0..4 `#NUM!`; 0 = minimum, 4 = maximum | implemented |
| `QUARTILE.INC` | `QUARTILE.INC(array, quart)` | Quartile 0 to 4 (inclusive) | Stored as `_xlfn.QUARTILE.INC`; same as `QUARTILE` | implemented |
| `QUARTILE.EXC` | `QUARTILE.EXC(array, quart)` | Quartile 1 to 3 (exclusive) | Stored as `_xlfn.QUARTILE.EXC`; `quart` outside 1..3 `#NUM!` | implemented |
| `PERCENTRANK` | `PERCENTRANK(array, x, [significance=3])` | Relative rank of x | Result truncated (not rounded) to `significance` digits; x outside the data `#N/A`; interpolates between data points | implemented |
| `PERCENTRANK.INC` | `PERCENTRANK.INC(array, x, [significance=3])` | Relative rank of x | Stored as `_xlfn.PERCENTRANK.INC`; same as `PERCENTRANK` | implemented |
| `CORREL` | `CORREL(array1, array2)` | Pearson correlation | Different sizes `#N/A`; pairs with a non-number are skipped; fewer than 2 pairs or zero variance `#DIV/0!` | implemented |
| `COVAR` | `COVAR(array1, array2)` | Population covariance | Different sizes `#N/A`; no pairs `#DIV/0!` | implemented |
| `COVARIANCE.P` | `COVARIANCE.P(array1, array2)` | Population covariance | Stored as `_xlfn.COVARIANCE.P`; same as `COVAR` | implemented |
| `COVARIANCE.S` | `COVARIANCE.S(array1, array2)` | Sample covariance | Stored as `_xlfn.COVARIANCE.S`; fewer than 2 pairs `#DIV/0!` | implemented |
| `SLOPE` | `SLOPE(known_ys, known_xs)` | Slope of the least-squares line | Different sizes `#N/A`; zero variance in x `#DIV/0!` | implemented |
| `INTERCEPT` | `INTERCEPT(known_ys, known_xs)` | Intercept of the least-squares line | Different sizes `#N/A`; zero variance in x `#DIV/0!` | implemented |
| `RSQ` | `RSQ(known_ys, known_xs)` | Squared correlation coefficient | Different sizes `#N/A`; zero variance `#DIV/0!` | implemented |
| `FORECAST` | `FORECAST(x, known_ys, known_xs)` | Predicted y on the regression line | Different sizes `#N/A`; zero variance in x `#DIV/0!` | implemented |
| `FORECAST.LINEAR` | `FORECAST.LINEAR(x, known_ys, known_xs)` | Predicted y on the regression line | Stored as `_xlfn.FORECAST.LINEAR`; same as `FORECAST` | implemented |
| `TREND` | `TREND(known_ys, [known_xs], [new_xs], [const=TRUE])` | Values on the regression line | One independent variable only (several variables `#REF!`); default `known_xs` 1..n; result has the shape of `new_xs`; `const` FALSE forces the line through the origin; non-numeric data `#VALUE!` | implemented |
| `GEOMEAN` | `GEOMEAN(number1, ...)` | Geometric mean | Any value <= 0 or no values `#NUM!` | implemented |
| `HARMEAN` | `HARMEAN(number1, ...)` | Harmonic mean | Any value <= 0 or no values `#NUM!` | implemented |
| `DEVSQ` | `DEVSQ(number1, ...)` | Sum of squared deviations | No numbers `#NUM!` | implemented |
| `AVEDEV` | `AVEDEV(number1, ...)` | Mean absolute deviation | No numbers `#NUM!` | implemented |

## Financial (16)

| Name | Signature | Semantics | Excel edge cases | Status |
|------|-----------|-----------|------------------|--------|
| `PMT` | `PMT(rate, nper, pv, [fv=0], [type=0])` | Constant payment of an annuity | Rate 0 = `-(pv+fv)/nper`; `nper` 0 `#NUM!`; type non-zero = payments at period start; payments are negative for a positive `pv` | implemented |
| `FV` | `FV(rate, nper, pmt, [pv=0], [type=0])` | Future value | Rate 0 = `-(pv + pmt*nper)` | implemented |
| `PV` | `PV(rate, nper, pmt, [fv=0], [type=0])` | Present value | Rate 0 = `-(fv + pmt*nper)` | implemented |
| `NPER` | `NPER(rate, pmt, pv, [fv=0], [type=0])` | Number of periods | Unreachable target `#NUM!`; rate 0 with `pmt` 0 `#NUM!` | implemented |
| `IPMT` | `IPMT(rate, per, nper, pv, [fv=0], [type=0])` | Interest part of a payment | `per` outside 1..nper `#NUM!`; type 1 gives 0 for period 1 | implemented |
| `PPMT` | `PPMT(rate, per, nper, pv, [fv=0], [type=0])` | Principal part of a payment | `PMT - IPMT`; `per` outside 1..nper `#NUM!` | implemented |
| `NPV` | `NPV(rate, value1, ...)` | Net present value | First value is discounted one period; `SUM` argument rules; rate -1 `#DIV/0!` | implemented |
| `IRR` | `IRR(values, [guess=0.1])` | Internal rate of return | Needs a positive and a negative value else `#NUM!`; iterative (Newton with bracketing fallback), no convergence `#NUM!` | implemented |
| `RATE` | `RATE(nper, pmt, pv, [fv=0], [type=0], [guess=0.1])` | Interest rate per period | Iterative; no convergence or `nper <= 0` `#NUM!` | implemented |
| `SLN` | `SLN(cost, salvage, life)` | Straight-line depreciation | Life 0 `#DIV/0!` | implemented |
| `SYD` | `SYD(cost, salvage, life, per)` | Sum-of-years'-digits depreciation | `life <= 0`, `per <= 0` or `per > life` `#NUM!` | implemented |
| `DB` | `DB(cost, salvage, life, period, [month=12])` | Fixed-declining-balance depreciation | Rate rounded to 3 decimals; first period prorated by `month`; with `month < 12` a final period `life + 1` exists; invalid inputs `#NUM!` | implemented |
| `DDB` | `DDB(cost, salvage, life, period, [factor=2])` | Double-declining-balance depreciation | Never goes below salvage; `period > life` or non-positive inputs `#NUM!` | implemented |
| `EFFECT` | `EFFECT(nominal_rate, npery)` | Effective annual rate | `npery` truncated; rate <= 0 or `npery < 1` `#NUM!` | implemented |
| `NOMINAL` | `NOMINAL(effect_rate, npery)` | Nominal annual rate | `npery` truncated; rate <= 0 or `npery < 1` `#NUM!` | implemented |
| `MIRR` | `MIRR(values, finance_rate, reinvest_rate)` | Modified internal rate of return | Needs a positive and a negative value else `#DIV/0!` | implemented |

## Deferred

Not implemented yet:

- Lifting scalar functions over arrays (`=LEN(A1:A3)` spilling three lengths), and the other Excel 365 array functions (`TAKE`, `DROP`, `CHOOSECOLS`, `VSTACK`, `TOCOL`, `MMULT`, ...).
- Further families from the Excel catalogue: other financial functions (XNPV, XIRR, CUMIPMT, CUMPRINC, PRICE, YIELD, ...), the database functions (DSUM, ...), engineering and base conversion (DEC2BIN, ...), information functions (INFO, SHEET), AGGREGATE, statistical distributions, regression with several variables (LINEST, multi-variable TREND), text functions TEXTBEFORE/TEXTAFTER/TEXTSPLIT, LET/LAMBDA, DAYS360, and the legacy double-byte text functions.

Divergences from Excel that are decided (and tested with `[excel=...]` notes in the suite where LibreOffice differs):

- `CHAR`/`CODE` use Windows-1252 (Excel for Windows), not the Mac Roman table.
- `XMATCH`/`XLOOKUP` binary search modes (2, -2) are evaluated as a scan, which gives the same result on correctly sorted data.
- `CELL("address")` omits the sheet name.
- `YEARFRAC` basis 1 uses the average-year denominator for spans longer than one year and 366 for shorter spans that contain February 29.
- `DATEDIF("MD")` uses the length of the month before the end date (Excel has known inconsistencies for end days earlier than the start day).
