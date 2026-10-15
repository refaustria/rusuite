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

## docx (`fmt-docx`)

`fmt_docx::read(&[u8]) -> Document` and `fmt_docx::write(&Document) -> Vec<u8>` (plus
`read_with_warnings`, `read_with_context` / `write_with_context`, and native-only `read_path` /
`write_path`), mapping to `model_text::Document` (ADR 0006). The crate compiles for
`wasm32-unknown-unknown`. Transitional WordprocessingML; parts are found by relationship type
(last path segment, so strict relationship types resolve too). Unsupported content never fails
a read: it is dropped with a warning (repeats are merged into one line with a count).

### Read

| Part / element | Handling |
|---|---|
| `word/document.xml` `w:body` | `w:p` → paragraph, `w:tbl` → table. `w:sdt`/`w:sdtContent`, `w:customXml`, `w:ins`, `w:moveTo`, `mc:AlternateContent` (first `mc:Choice`) are unwrapped. `w:del`/`w:moveFrom` dropped (warning). The result is `normalize()`d (adjacent equal runs merged, every cell and the body end with a paragraph). |
| `w:pPr` | `pStyle`, `keepNext`, `pageBreakBefore`, `numPr` (`ilvl` default 0, `numId`; `numId 0` kept as "no numbering"), `spacing` (`before`/`after` twips, `line` + `lineRule` `auto` → `Multiple(line/240)`, `exact`, `atLeast`), `ind` (`left`/`start`, `right`/`end`, `firstLine`, `hanging`; `hanging` wins), `jc` (`left`/`start`, `center`, `right`/`end`, `both`/`distribute`; kashida/thai → justify, warning), `rPr` (paragraph mark, `None` if empty). `w:bidi="1"`: direction dropped (warning) and left/right alignment **mirrored** (they are logical in RTL paragraphs) so the visual alignment stays. `tabs`, `pBdr`, `shd`, `keepLines`, `framePr`, `contextualSpacing`, a paragraph-level `sectPr` and other properties: warning. Silently ignored: `widowControl`, `suppressAutoHyphens`, `suppressLineNumbers`, `outlineLvl`, `snapToGrid`, `autoSpaceDE/DN`, `adjustRightInd`, `kinsoku`, `wordWrap`, `overflowPunct`, `topLinePunct`, `textAlignment`, `cnfStyle`, `divId`. Universal measures (`2.54cm`, `12pt`) are accepted for lengths. |
| `w:r` / `w:rPr` | `rFonts` (`asciiTheme` → `FontFace::Theme` (`major/minorHAnsi`/`Ascii` → Major/MinorLatin, `…EastAsia`, `…Bidi`), else `ascii`, else `hAnsiTheme`/`hAnsi`), `sz` (half-points), `b`, `i`, `strike`, `dstrike` (→ strike, warning), `color` (`auto` → `Color::Auto`, hex → RGB, `themeColor` + `themeTint`/`themeShade` → `Color::Theme { slot, tint }` with tint = `1 − v/255` / `−(1 − v/255)`, snapped to two decimals when that writes back as the same byte: `themeShade="BF"` → −0.25, `themeTint="99"` → 0.4 = Word's "Lighter 60 %"), `highlight` (16 names → RGB, `none` → `Color::Auto`), `shd w:fill` (LibreOffice's highlight; snapped to the nearest highlight color, warning if not exact; `w:highlight` wins), `u` (`single`/`words`/`thick` → single, `double`, `dotted*`, `dash*`/`dotDash*` → dashed, `wav*` → wavy, `none`), `vertAlign`. Silently ignored: `bCs`, `iCs`, `szCs`, `lang`, `kern`, `noProof`, `webHidden`, `snapToGrid`. `rtl`/`cs` (true), `rStyle`, `caps`, `smallCaps`, `vanish`, `spacing`, `position`, `w`, `effect`, `bdr`, … : warning. |
| run content | `w:t` (text as is), `w:tab`/`w:ptab` → `\t`, `w:br` (`type="page"` → `Break::Page`, `column` → line break with warning, else `Break::Line`), `w:cr` → line break, `w:noBreakHyphen` → U+2011, `w:softHyphen` → U+00AD, `w:sym` → its character (font dropped, warning). Fields: `w:fldSimple` and complex fields keep their current result text (warning). `w:hyperlink` → its runs (target dropped, warning). `w:smartTag`, `w:dir`, `w:bdo` unwrapped. Bookmarks, comments, foot/endnote references, equations, `w:pict`/`w:object` (VML, OLE): dropped with warning. `w:proofErr`, `w:lastRenderedPageBreak`, permissions: ignored. |
| `w:drawing` | `wp:inline` (or `wp:anchor` → inline at that position, warning) with `a:blip r:embed` → `InlineImage` (`wp:extent cx/cy` EMU, `wp:docPr descr` → `alt`, `name` → `name`; empty → `None`). The media part is added to the `MediaStore` in first-reference order (content type from `[Content_Types].xml`, identical parts deduplicated). Linked images and non-picture drawings (shapes, charts, text boxes) dropped with warning. |
| `w:tbl` | `tblPr`: `tblW` (`dxa` → twips, `pct` → fiftieths of a percent, also `"50%"`, `auto`; `nil` → none), `tblBorders`, `tblCellMar` (`dxa` sides, `start`/`end` accepted); `tblStyle`, `tblInd`, `tblLayout`, `jc` (except left), `tblCellSpacing`, floating position: warning. `tblGrid/gridCol` → `col_widths`. `trPr`: `trHeight` (`hRule` `exact`, `atLeast`/missing, `auto` → none), `tblHeader`; others warning. `tcPr`: `tcW`, `shd fill` (auto → none; theme fills supported), `tcBorders`, `vAlign` (`both` → center); `gridSpan > 1`, `vMerge`, `hMerge` → warning "merged cells read as separate cells"; `tcMar`, `noWrap`, `textDirection`: warning. Rows/cells wrapped in `w:sdt`/`w:customXml` are unwrapped. |
| borders | `val`: `single`, `double`, `dashed` (+ `dashSmallGap`, `dotDash`, `dotDotDash`, `dashDotStroked`), `dotted`, `thick`, `nil`/`none` → `BorderStyle::None`; others → single (warning). `sz` eighths of a point → twips (`BorderSide::width_from_eighths`), `color`/`themeColor` → color (missing → auto). |
| `w:sectPr` (body-level, i.e. last section) | `pgSz w h orient` (dimensions as given; `orient="landscape"` → landscape, otherwise portrait), `pgMar top right bottom left header footer` (missing values keep A4/Word defaults). Gutter (non-zero), headers/footers, multiple columns, title page, line numbering, page borders, vertical alignment, foot/endnote properties: warning. Missing `sectPr` → A4 with Word margins. |
| `word/styles.xml` | `docDefaults` (`rPrDefault/rPr`, `pPrDefault/pPr`) → `StyleSheet.defaults`; `w:style` of type paragraph/character/table → `Style` (`styleId`, `name` (missing → id), `basedOn`, `next`, `default="1"`, `pPr`, `rPr`); numbering styles dropped (warning), table-style formatting (`tblPr`/`trPr`/`tcPr`/`tblStylePr`) dropped (warning), duplicate ids dropped. `latentStyles` and UI flags ignored. |
| `word/numbering.xml` | One `NumberingDef` per `w:num` (`numId`), levels from its `abstractNum` (`lvl ilvl` 0–8: `start` (default 0), `numFmt` (`decimal`, `lower/upperLetter`, `lower/upperRoman`, `bullet`; `none` → `Bullet` with the literal text of `lvlText`, usually empty; others → decimal with warning), `lvlText`, `pPr/ind`, `rPr/rFonts`), then `lvlOverride` (`startOverride`, full `lvl`) applied. Bullets of the Symbol and Wingdings fonts are mapped from Word's private-use code points (U+F0xx, also plain 8-bit codes) to readable characters (Symbol B7 → •, Wingdings A7 → ▪, D8 → ➢, FC → ✔, 76 → ❖, …; unknown ones stay as they are). `lvlRestart`, `isLgl`, picture bullets, `pStyle` links, style links: warning. `suff`, `lvlJc`, `tabs` ignored. Which nums shared an `abstractNum` (and which levels had a `startOverride`) is kept in `DocxContext.numbering`. |
| `word/theme/theme1.xml` | Parsed into `DocxContext.theme` (`core_model::Theme`: color scheme, major/minor latin/ea/cs fonts); raw bytes kept in `DocxContext.theme_xml` (unless the theme part has relationships of its own: then the built-in theme is used, warning). |
| `word/settings.xml` | Raw bytes kept in `DocxContext.settings_xml` (unless it has relationships of its own, e.g. an attached template: then default settings, warning). |
| other parts | `word/fontTable.xml`, `webSettings`, `docProps/*` ignored. Everything else (headers, footers, footnotes, comments, glossary, custom XML, …) is dropped with one warning per part. |

### Write

All parts are regenerated (theme and settings come from `DocxContext` when given); output is
byte-for-byte deterministic for the same `Document` and context, and reading it back yields the
same document (the test suite checks read → write → read on all reference files).

| Part | Content |
|---|---|
| `[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels` | Via `fmt_ooxml::Package`. Relationships: styles, settings, theme, numbering (if any), then one per image in first-reference order. |
| `docProps/core.xml`, `docProps/app.xml` | Minimal: empty core properties (no timestamps), `Application` = `Rusuite`. |
| `word/document.xml` | `w:body` with paragraphs and tables, then `w:sectPr` (`pgSz w h` + `orient="landscape"`, `pgMar` all six margins + `gutter="0"`). An empty `w:p` is appended to the body and to every cell whose content does not end with a paragraph. `w:pPr` in Word's order `pStyle, keepNext, pageBreakBefore, numPr, spacing, ind, jc, rPr`; `w:rPr` in order `rFonts, b, bCs, i, iCs, strike, color, sz, szCs, highlight, u, vertAlign` (true toggles as `<w:b/>`, false as `w:val="0"`; fonts as `ascii`+`hAnsi` or `asciiTheme`+`hAnsiTheme`; theme colors as `w:val` (resolved RGB) + `themeColor` + `themeTint`/`themeShade`; sizes as half-points in `sz` and `szCs`). Run text: `\t` → `w:tab`, `\n`/U+000B → `w:br`, U+000C → page break, characters XML cannot carry are dropped; `xml:space="preserve"` when the text has leading/trailing whitespace or double spaces. Breaks are written as their own `<w:r><w:br/></w:r>`. Images as `w:drawing/wp:inline` (`wp:extent`, `wp:effectExtent` 0, `wp:docPr id name descr`, `a:graphicFrameLocks noChangeAspect`, `a:graphic/pic:pic` with `a:blip r:embed`, `a:stretch/a:fillRect`, `a:xfrm`, `prstGeom rect`). Tables: `tblPr` (`tblW`, `tblBorders`, `tblCellMar`), `tblGrid` (the model's column widths; if empty: the first row's fixed cell widths, else the text width split evenly), `trPr` (`trHeight val hRule`, `tblHeader`), `tcPr` (`tcW`, `tcBorders`, `shd val="clear" color="auto" fill`, `vAlign`); borders as `val sz space="0" color` (`BorderStyle::None` → `nil`). Tables without rows and rows without cells are skipped. |
| `word/styles.xml` | `docDefaults` (`rPrDefault`, `pPrDefault`) and every style in order (`type`, `default="1"`, `styleId`, `name`, `basedOn`, `next`, `qFormat` for Normal/Title/Subtitle/Quote/ListParagraph/Heading1–9, `pPr` (not for character styles), `rPr`). |
| `word/numbering.xml` | Written only if there are definitions. Without context: one `abstractNum` per `NumberingDef` (ids from 0) and one `num` each. With the context of a read file, nums that shared an `abstractNum` and still have compatible levels share one again, with `lvlOverride/startOverride` for the levels that had one (keeps Word's "continue/restart numbering" behaviour, e.g. a restarted list). Levels: `start`, `numFmt` (`Bullet` with empty text → `none` + `suff nothing`), `lvlText` (Symbol/Wingdings bullets mapped back to private-use code points), `lvlJc left`, `pPr/ind`, `rPr/rFonts` (+ `hint="default"`). |
| `word/settings.xml` | Context part verbatim, else minimal: `w:compat` with `compatibilityMode` 15. |
| `word/theme/theme1.xml` | Context part verbatim, else a built-in Office theme (`ColorScheme::default()`, Calibri Light / Calibri). |
| `word/media/imageN.ext` | Each referenced media item once, numbered in first-reference order; extension from the content type (`png`, `jpeg`, `gif`, `bmp`, `tiff`, `svg`, `webp`, `emf`, `wmf`, else `bin`). An image whose media is missing from the store fails the write (`Error::InvalidDocument`). |

### Known lossy points

- Highlight colors other than Word's 16 are written as the nearest named color (squared RGB
  distance): `black 000000, blue 0000FF, cyan 00FFFF, green 00FF00, magenta FF00FF, red FF0000,
  yellow FFFF00, white FFFFFF, darkBlue 000080, darkCyan 008080, darkGreen 008000, darkMagenta
  800080, darkRed 800000, darkYellow 808000, darkGray 808080, lightGray C0C0C0`. Run shading
  (`w:shd`) is never written.
- Complex-script twins (`bCs`, `iCs`, `szCs`) are written equal to `b`/`i`/`sz`; east-asian and
  complex-script fonts (`eastAsia`, `cs`) are not kept.
- `firstLine` and `hanging` are mutually exclusive: if both are set, only `hanging` is written.
- Line spacing `Multiple(m)` is stored in 240ths of a line (`round(m × 240)`).
- Run formatting of a break or image is not modelled (written without `w:rPr`).
- Paragraph direction (`w:bidi`, `w:rtl`) is not modelled; RTL paragraphs keep their visual
  alignment but lose their direction.
- Merged cells become separate cells; their grid span is lost.
