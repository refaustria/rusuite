# Number formats

One formatter shows numbers everywhere: the grid, `TEXT()`, filter lists, chart labels, the Format
Cells sample and the print view. It lives in Rust (`engine_formula::numfmt`, P8-23);
`model_sheet::numfmt::format_cell` wraps it for cell values (text, booleans, errors, the
colour and fill of the format, the "too narrow" rule) and the core sends the result in every
`CellView` (`display`, `color`, `fillAt` / `fillChar`, `narrow`). The UI's `numberFormat.ts` only
builds and parses the codes of the Format Cells dialog and the ribbon. Behaviour is Microsoft
Excel's (en-US); reference cases: `crates/engine-formula/src/numfmt/tests.rs` (189 `(value, code) →
text` cases, plus colour, fill, text-section and narrow-cell tests) and the `TEXT` rows of the formula suite.

## Sections

A code has up to four sections separated by `;` (outside quotes, brackets and escapes):
`positive;negative;zero;text`. A last section holding `@` is the text section even when there are
fewer than four (`0.00;@`).

| Sections | Numbers |
|---|---|
| 1 | every number; negatives get a `-` |
| 2 | first: positive and zero; second: negative, **without** its `-` (write it as a literal) |
| 3 | positive; negative (without `-`); zero |

Conditions replace the sign rule: `[>=100]"big";"small"`, `[=1]"one";[=2]"two";"many"`. The first
two sections may carry a condition (`<`, `<=`, `>`, `>=`, `=`, `<>` and a number); a number takes
the first section whose condition holds; otherwise the next section without a condition (the third
when both have one). A section whose condition only admits negative numbers (`[<0]`, `[<=-1]`)
shows the absolute value, so `[Red][<0]-0.0;0.0` shows −5 as a red `-5.0`; other conditional
sections keep the sign.

An empty section shows nothing (`0;-0;;@` hides zeros, `;;;` hides everything). A section with
only literals shows them instead of the number.

## Section contents

| Element | Meaning |
|---|---|
| `0` `#` `?` | Digit placeholders: `0` shows insignificant zeros, `#` drops them, `?` shows a space (decimal alignment). Extra integer digits go to the leftmost placeholder; literals between placeholders stay in place (`000-00-0000` → `123-45-6789`, `(###) ###-####`). |
| `.` | Decimal point; rounding is half away from zero on the 15-digit decimal value (`1.005` → `1.01`). |
| `,` | Between integer placeholders: thousands separator. After the last placeholder (or before `.`): divides by 1000 each (`#,` → thousands, `0.0,,"M"` → millions). |
| `%` | Multiplies by 100 (per `%`). |
| `E+00` `E-00` `e+` | Scientific: `E+` always shows the exponent sign, `E-` only for negative exponents; the exponent has at least as many digits as placeholders. A mantissa with several integer placeholders and a `#` is engineering notation (`##0.0E+0` → exponents in multiples of 3). |
| `?/?` `# ??/??` `# ?/8` `# ??/100` | Fractions: a placeholder before the numerator's group is the whole part (mixed fraction), otherwise improper. The denominator is the best approximation with as many digits as placeholders (`3.14159` with `# ??/??` → `3 14/99`), or fixed (`?/8`). A whole number shows blanks for the fraction (`5    `). `?` pads with spaces. |
| `General` | The General format inside a section (`General" units"`, `General;-General`). |
| `@` | The text (text section). |
| `"…"` `\x` | Literal text. Without quotes Excel also shows `$ - + / ( ) : ! ^ & ' ~ { } < > =`, digits 1–9 and space. |
| `_x` | A space as wide as `x` (written as one space; `_)` aligns positives with parenthesised negatives). |
| `*x` | Repeat `x` to fill the cell: the grid repeats it at that position (`fillAt`); `TEXT` drops it. Accounting formats use `* ` to push the currency symbol to the left edge. |
| `[Red]` … `[Color 10]` | Colour of the section: `Black White Red Green Blue Yellow Magenta Cyan` (palette entries 1–8) or `Color1`–`Color56` of Excel's palette. It wins over the font colour; a conditional format's font colour wins over it. |
| `[$€-407]` `[$USD]` | Currency symbol (printed) and locale. The locale only changes month and day names (`[$-407]`, `[$-de-DE]`: German; `[$-C07]`: Austrian, `Jänner`); German decimal and thousands separators are not applied (pending the owner's decision on locale-aware display). `[$-F800]` / `[$-F400]` (system long date / time) are followed by the code they stand for and ignored. |
| `[DBNum1]` etc. | Ignored. |

### Dates and times

A section with a date or time token formats the number as an Excel serial (1900 system, serial 60 is
the non-existent 1900-02-29, serial 0 is 1900-01-00). Negative numbers and serials after
9999-12-31 cannot be shown: the grid fills the cell with `#`, `TEXT` returns `#VALUE!`.

| Token | Shows |
|---|---|
| `yy` / `yyyy` (`y`, `yyy`) | 24 / 2024 |
| `m` `mm` `mmm` `mmmm` `mmmmm` | 1, 01, Jan, January, J; `m`/`mm` after an hour or before seconds are minutes |
| `d` `dd` `ddd` `dddd` | 5, 05, Mon, Monday |
| `h` `hh`, `s` `ss` | hours (12-hour with `AM/PM`, `am/pm`, `A/P`, `a/p`, printed in the case written) and seconds |
| `.0` `.00` `.000` after seconds | fractions of a second (`mm:ss.0`) |
| `[h]` `[mm]` `[ss]` | elapsed time: total hours/minutes/seconds; smaller units after it are within it (`[h]:mm:ss` → `26:03:04`) |

The time is rounded to the shown precision of seconds before it is split (59.96 s with `ss.0` →
`00.0` of the next minute); without seconds it is rounded to the second and then truncated
(Excel's behaviour).

## General

The cell's General format shows at most **11 characters**:

- numbers whose integer part fits are shown with as many decimals as fit, trailing zeros removed
  (`1/3` → `0.333333333`, `-1/3` → `-0.33333333`, `123456.7891234` → `123456.7891`);
- magnitudes below `0.0001` and integers of 12 or more characters switch to scientific notation
  with as many mantissa digits as fit (`123456789012` → `1.23457E+11`, `0.00001` → `1E-05`);
- the value is first rounded to 15 significant digits (`0.1+0.2` → `0.3`).

`TEXT(x, "General")` uses the same rules. Concatenation (`=1/3&""`) and `TEXT(x, "@")` keep the
15-digit form (`engine_formula::value::format_general`), as Excel does.

## Too narrow

A number that does not fit its column shows `#` across the cell (Excel's `####`). A General number
first loses decimals and then switches to scientific notation (`general_fit`). The core estimates
the width (`model_sheet::numfmt::fit_number`: the column width in character units, the font size,
digits one unit wide) and sets `CellView.narrow`; changing a column width re-sends that column's
numbers. The grid also measures the text with the canvas and applies the same rule, so a bigger or
bolder font is covered too. Text, booleans and errors overflow into empty neighbours instead.

## Built-in format ids

`fmt-xlsx` maps the ids of `numFmtId` both ways for 0–49 (`model_sheet::numfmt::builtin_code` /
`builtin_id`): the ECMA-376 list plus Excel's en-US codes for the locale-dependent currency (5–8,
`"$"#,##0.00_);\("$"#,##0.00\)`) and accounting (41–44) formats; those are written with a
`<numFmt>` carrying the code so that another locale's Excel keeps the `$`. The East-Asian ids
23–36 and 50–58 read as aliases (`General`, `m/d/yyyy`, `h:mm:ss`) and are never written.
Custom codes get ids from 164.

## UI

- Format Cells › Number (Ctrl+1): General, Number (decimals, thousands separator, four negative
  styles shown like Excel), Currency (symbol € $ £ ¥ or none, negative styles), Accounting,
  Date, Time, Percentage, Fraction (nine types), Scientific, Text, Custom (code field and the list
  of Excel's built-in codes plus the workbook's own); Special is not offered. The sample is
  formatted by the core and shown in the format's colour.
- Home › Number: the Number Format box with Excel's eleven entries (General, Number, Currency,
  Accounting, Short Date, Long Date, Time, Percentage, Fraction, Scientific, Text – German UI:
  `€`, `dd.mm.yyyy`, `[$-407]dddd, d. mmmm yyyy`, `hh:mm:ss`) each with the active cell's value
  as a preview, More Number Formats…; Accounting ▾ (€ $ £ ¥, More…); Percent Style; Comma Style
  (Excel's accounting format without symbol); Increase / Decrease Decimal on every family with
  digits (the mantissa of scientific codes, percentages, currency and accounting codes including
  their zero section); dates, times, fractions and text are left alone.

## Not supported

Locale-aware decimal/thousands separators and month names outside German, the Buddhist (`b`)
and era (`g`, `e`) year tokens, `[DBNum]` number systems, fill characters in `TEXT`,
character-exact `_x` widths (a space is used).
