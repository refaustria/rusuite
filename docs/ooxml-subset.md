# OOXML Subset

To be filled in Phase 1. See the project README.md for the overall scope and plan.

## xlsx (`fmt-xlsx`)

`fmt_xlsx::read(&[u8]) -> Workbook` and `fmt_xlsx::write(&Workbook) -> Vec<u8>` (plus
`read_with_warnings`, `read_with_context` / `write_with_context`, and native-only `read_path` /
`write_path`). The crate compiles for `wasm32-unknown-unknown`. Transitional SpreadsheetML only.

### Read

| Part / element | Handling |
|---|---|
| `xl/workbook.xml` `<sheets>` | Order, names, `r:id` → worksheet part via relationships. A `<sheet>` that targets a chartsheet/dialog sheet is dropped (warning). `state="hidden"` → warning, the sheet is loaded as visible. |
| `workbookPr date1904="1"` | `Error::Unsupported("date1904")`. |
| `<definedNames>` | Dropped (warning). |
| `xl/sharedStrings.xml` | `<si><t>` and rich text `<si><r><t>` (runs concatenated, run formatting dropped, phonetic `<rPh>` skipped). `_xHHHH_` escapes decoded. |
| `xl/styles.xml` `<numFmts>` | id → code. Built-in ids map through `model_sheet::numfmt::builtin_code`; locale-dependent built-ins (5–8, 23–36, 41–44) without a `<numFmt>` read as General (warning). Any code equal to `General` (case-insensitive) → `None`. |
| `<fonts>` | `name`, `sz`, `b`, `i`, `u` (`single`/`double`, accounting variants mapped), `strike`, `vertAlign`, `color`. Font 0 is the workbook default font (kept in `XlsxContext.default_font`); every cell font is stored as the **difference** from font 0 (a bold Arial-10 font in an Arial-10 workbook reads as `bold: Some(true)`). `family`, `scheme`, `charset`, `outline`, `shadow`, `condense`, `extend` dropped. |
| `<fills>` | `patternFill solid` → `Fill::Solid(fgColor)`; `none`/`gray125`/missing → `None`; other patterns → solid with the foreground color, gradients → `None` (one warning). |
| `<borders>` | `left`/`right`/`top`/`bottom` (also `start`/`end`) style + color (missing color → `Color::Auto`). `thin medium thick dashed dotted double hair` map 1:1; `mediumDashed`, `dashDot`, `mediumDashDot`, `dashDotDot`, `mediumDashDotDot`, `slantDashDot` → `Dashed`. Diagonals dropped. |
| colors | `rgb` → `Color::Rgb` (alpha ignored); `theme="N" tint` → `Color::Theme { slot, tint }` (index order `lt1 dk1 lt2 dk2 accent1..6 hlink folHlink`; never resolved to RGB); `indexed` → legacy 64-color palette (or the file's `<indexedColors>`), 64/65 → `Auto`; `auto="1"` → `Auto`. |
| `<cellXfs>` | `numFmtId`/`fontId`/`fillId`/`borderId` taken as given (`applyX` flags ignored, as Excel does); `<alignment horizontal vertical wrapText indent>` (`centerContinuous` → center, `distributed` → justify; vertical `justify`/`distributed` → center). Default values (`general`, `bottom`, `wrapText="0"`, `indent="0"`) read as `None`. `textRotation`, `shrinkToFit`, `<protection>` dropped. Each xf is interned into the `StyleTable`. |
| `<cellStyleXfs>`, `<cellStyles>`, `<dxfs>`, `<tableStyles>` | Ignored (named styles are not modelled). |
| `xl/theme/theme1.xml` | `<a:clrScheme>` parsed into `XlsxContext.color_scheme`; the raw part is kept in `XlsxContext.theme_xml` and written back verbatim by `write_with_context`. |
| `<sheetFormatPr>` | `defaultColWidth`, `defaultRowHeight` → `SheetFormat` (absent `defaultColWidth` → 8.43). |
| `<cols><col>` | `min..max` expanded per column: `width` (if `customWidth="1"`, or if `customWidth` is absent and the width differs from the sheet default), `hidden`, `style`. |
| `<row>` | `ht` only with `customHeight="1"` (otherwise it is a cached auto height), `hidden`, `s` only with `customFormat="1"`. Missing `r` = previous row + 1. |
| `<c>` | `t="s"` shared string, `t="str"`/`t="inlineStr"` text, `t="b"`, `t="e"` (unknown error codes such as `#SPILL!` → text, warning), `t="n"`/absent → number, `t="d"` → text (warning). Missing `r` = next column. Text constants are stored as `Value::Text` (never re-parsed: `"0123"` stays text). A cell with only `s` is a style-only cell. |
| `<f>` | Input = `"=" + text` with `_xlfn.`/`_xlws.` prefixes stripped; the engine recomputes, the cached `<v>` is ignored. Shared formulas: the master (`t="shared" ref si` with text) is parsed, dependents (`si` only) get `offset_relative(master, Δrow, Δcol)` (canonical text). `t="array"` → plain formula of the top-left cell (warning). `t="dataTable"` and formulas the engine cannot parse → the cached value is kept as a constant (warning). |
| Worksheet extras | Merged cells (refs listed in the warning), conditional formatting, data validation, hyperlinks, drawings/charts, comments/legacy drawings, tables, auto filter, sheet protection, background pictures, OLE objects, form controls and frozen panes are dropped with one warning per kind and sheet. Sheet views, selection, page setup/margins, print options and header/footer are dropped silently. |
| Other parts | Every part not listed above (charts, drawings, pivot tables, comments, calc chain, custom XML, VBA, …) is dropped (one warning per part). `docProps/core.xml` and `docProps/app.xml` are ignored. |

### Write

All parts are regenerated (only the theme comes from `XlsxContext` when given); output is
byte-for-byte deterministic for the same `Workbook` and context.

| Part | Content |
|---|---|
| `[Content_Types].xml`, `_rels/.rels`, `xl/_rels/workbook.xml.rels` | Via `fmt_ooxml::Package`; sheets `rId1..n`, then styles, theme, sharedStrings. |
| `docProps/core.xml`, `docProps/app.xml` | Minimal: empty core properties (no timestamps: core crates have no clock, and fixed fake dates would be misleading), `Application` = `Rusuite`. |
| `xl/workbook.xml` | `<sheets>` (sheetId = position), `<calcPr fullCalcOnLoad="1"/>`. |
| `xl/styles.xml` | Default font (context font or Calibri 11 / theme text color) as font 0, `none` + `gray125` fills, empty border, one `cellStyleXf`, `Normal` cell style. One `<xf>` per `StyleTable` entry in id order (xf index = `StyleId`); fonts (default font overlaid with the style's font), fills, borders deduplicated; built-in number formats by id, custom codes from id 164; `applyX="1"` set for every non-default component. |
| `xl/sharedStrings.xml` | All text constants in first-use order, `count`/`uniqueCount`, `xml:space="preserve"` when needed, control characters as `_xHHHH_`. Omitted when there is no text. |
| `xl/theme/theme1.xml` | Context theme verbatim, otherwise a built-in Office theme generated from `ColorScheme::default()`. |
| `xl/worksheets/sheetN.xml` | `<dimension>` (used range), `<sheetViews>` (first sheet selected), `<sheetFormatPr defaultColWidth defaultRowHeight>` (+ `customHeight="1"` if the height is not 15), `<cols>` (runs of identical consecutive columns; `customWidth="1"` only for explicit widths), `<sheetData>` (rows ascending; `ht customHeight`, `hidden`, `s customFormat`), `<pageMargins>` (Excel defaults). Cells: numbers (shortest round-trip text, exponent form outside 1e-5..1e15), `t="s"`, `t="b"`, `t="e"`; formulas as `<f>` without `=` (with `_xlfn.` re-added for `CONCAT`, `DAYS`, `IFNA`, `IFS`, `MAXIFS`, `MINIFS`, `SWITCH`, `TEXTJOIN`, `XLOOKUP`, `XMATCH`) plus the engine's current value with the matching `t` (`str`, `b`, `e`); style-only cells as `<c r s/>`. A written cell carries its *effective* style (cell → row → column), because Excel applies row/column styles only to cells absent from `<sheetData>`. |

### Known lossy points

- Properties equal to the workbook default font, `Fill::None`, `HAlign::General`,
  `VAlign::Bottom`, `wrap_text: Some(false)`, `indent: Some(0)`, `Underline::None` and
  `bold/italic/strike: Some(false)` are written but read back as `None` (inherit).
- `FontFace::Theme` is written as the named font (`Calibri Light` / `Calibri`) and reads back as
  `FontFace::Named`. `RunProperties::highlight` and dotted/dashed/wavy underlines have no
  SpreadsheetML equivalent (underline written as single).
- A content cell without an own style inside a styled row/column is written with the row/column
  style and reads back with that style as its own style.
- Formula text of shared-formula dependents is the engine's canonical form.
