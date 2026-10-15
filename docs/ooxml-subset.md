# OOXML Subset

Which parts and elements of Office Open XML (ECMA-376, transitional) Rusuite reads and writes, per
format, and where it is knowingly lossy. Scope rules are in the README; the crate layout is in
[architecture.md](architecture.md).

Common to all three formats (`fmt-ooxml`):

- **Package.** ZIP container, `[Content_Types].xml` (Default + Override), package and part relationships,
  OPC part-name rules. The main part is found through the `officeDocument` relationship (transitional or
  Strict URI).
- **Reading** is tolerant: elements and attributes are matched by local name (any namespace prefix);
  content outside the subset is dropped with a warning in `ReadOutput.warnings`, never silently.
- **Writing** regenerates every part from the model with the standard declaration
  (`standalone="yes"`) and deterministic output; characters XML 1.0 cannot carry are dropped (SpreadsheetML
  text keeps them as `_xHHHH_`). Relationship and content types come from `fmt_ooxml::{rel, ct}`.
- **Theme** (`*/theme/theme1.xml`, `fmt_ooxml::theme`): color scheme (`a:srgbClr`, `a:sysClr/@lastClr`)
  and major/minor fonts are read into `core_model::Theme`; format/effect styles are not modelled. Each
  writer can put the imported theme part back verbatim (conditions per format below); otherwise it emits a
  minimal Office-like theme (Word: `dk1`/`lt1` as `a:sysClr`; Show: generated from the model's theme).
- **docProps** (`core.xml`, `app.xml`) are ignored on read and written minimal.

## xlsx (`fmt-xlsx`)

`fmt_xlsx::read(&[u8]) -> Workbook` and `fmt_xlsx::write(&Workbook) -> Vec<u8>` (plus
`read_with_warnings`, `read_with_context` / `write_with_context`, and native-only `read_path` /
`write_path`). The crate compiles for `wasm32-unknown-unknown`. Transitional SpreadsheetML only.

### Read

| Part / element | Handling |
|---|---|
| `xl/workbook.xml` `<sheets>` | Order, names, `r:id` → worksheet part via relationships. A `<sheet>` that targets a chartsheet/dialog sheet is dropped (warning). `state="hidden"` / `"veryHidden"` → `hidden` / `very_hidden` sheet flags (applied after loading; if every sheet is hidden, the last one is shown, warning). |
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
| `<sheetViews>` | First `<sheetView>` only: `showGridLines`, `showRowColHeaders`, `zoomScale` (clamped to 10..=400; absent/0 → 100) → `SheetView`. `<pane state="frozen">` / `"frozenSplit"` → `frozen_rows = ySplit`, `frozen_cols = xSplit` (`topLeftCell`, `activePane` ignored); a split pane (no/other `state`) is dropped (warning "split panes dropped"). `tabSelected`, `<selection>`, further views ignored. |
| `<mergeCells><mergeCell ref>` | → `Workbook::add_merge` (contents of the covered cells are kept as in the file). Single cells, malformed refs and ranges overlapping an earlier merge are dropped (one warning listing them). |
| Worksheet extras | Conditional formatting, data validation, hyperlinks, drawings/charts, comments/legacy drawings, tables, auto filter, sheet protection, background pictures, OLE objects and form controls are dropped with one warning per kind and sheet. Selection, page setup/margins, print options and header/footer are dropped silently. |
| Other parts | Every part not listed above (charts, drawings, pivot tables, comments, calc chain, custom XML, VBA, …) is dropped (one warning per part). `docProps/core.xml` and `docProps/app.xml` are ignored. |

### Write

All parts are regenerated (only the theme comes from `XlsxContext` when given); output is
byte-for-byte deterministic for the same `Workbook` and context.

| Part | Content |
|---|---|
| `[Content_Types].xml`, `_rels/.rels`, `xl/_rels/workbook.xml.rels` | Via `fmt_ooxml::Package`; sheets `rId1..n`, then styles, theme, sharedStrings. |
| `docProps/core.xml`, `docProps/app.xml` | Minimal: empty core properties (no timestamps: core crates have no clock, and fixed fake dates would be misleading), `Application` = `Rusuite`. |
| `xl/workbook.xml` | `<workbookView activeTab>` = first visible sheet, `<sheets>` (sheetId = position; `state="hidden"` / `"veryHidden"` for hidden sheets), `<calcPr fullCalcOnLoad="1"/>`. |
| `xl/styles.xml` | Default font (context font or Calibri 11 / theme text color) as font 0, `none` + `gray125` fills, empty border, one `cellStyleXf`, `Normal` cell style. One `<xf>` per `StyleTable` entry in id order (xf index = `StyleId`); fonts (default font overlaid with the style's font), fills, borders deduplicated; built-in number formats by id, custom codes from id 164; `applyX="1"` set for every non-default component. |
| `xl/sharedStrings.xml` | All text constants in first-use order, `count`/`uniqueCount`, `xml:space="preserve"` when needed, control characters as `_xHHHH_`. Omitted when there is no text. |
| `xl/theme/theme1.xml` | Context theme verbatim, otherwise a built-in Office theme generated from `ColorScheme::default()`. |
| `xl/worksheets/sheetN.xml` | `<dimension>` (used range), `<sheetViews>` (one `<sheetView>`: `tabSelected="1"` on the first visible sheet, `showGridLines="0"` / `showRowColHeaders="0"` / `zoomScale` only when not default; frozen panes as `<pane xSplit ySplit topLeftCell activePane state="frozen"/>` plus `<selection pane>`), `<sheetFormatPr defaultColWidth defaultRowHeight>` (+ `customHeight="1"` if the height is not 15), `<cols>` (runs of identical consecutive columns; `customWidth="1"` only for explicit widths), `<sheetData>` (rows ascending; `ht customHeight`, `hidden`, `s customFormat`), `<mergeCells count>` (one `<mergeCell ref>` per merge, sorted by top-left cell), `<pageMargins>` (Excel defaults). Cells: numbers (shortest round-trip text, exponent form outside 1e-5..1e15), `t="s"`, `t="b"`, `t="e"`; formulas as `<f>` without `=` (with `_xlfn.` re-added for `CONCAT`, `DAYS`, `IFNA`, `IFS`, `MAXIFS`, `MINIFS`, `SWITCH`, `TEXTJOIN`, `XLOOKUP`, `XMATCH`) plus the engine's current value with the matching `t` (`str`, `b`, `e`); style-only cells as `<c r s/>`. A written cell carries its *effective* style (cell → row → column), because Excel applies row/column styles only to cells absent from `<sheetData>`. |

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
| `w:sectPr` (body-level, i.e. last section) | `pgSz w h orient` (dimensions as given; `orient="landscape"` → landscape, otherwise portrait), `pgMar top right bottom left header footer` (missing values keep A4/Word defaults). `headerReference`/`footerReference` of type `default` → `PageSetup.header_text`/`footer_text` as plain text (paragraphs joined by `\n`, tabs kept, `PAGE` fields — `fldSimple` or `fldChar`/`instrText` — as `{PAGE}`, other fields as their result; drawings, tables and the header part's own relationships: warning); first-page/even-page headers and footers: warning. Gutter (non-zero), multiple columns, title page, line numbering, page borders, vertical alignment, foot/endnote properties: warning. Missing `sectPr` → A4 with Word margins. |
| `word/styles.xml` | `docDefaults` (`rPrDefault/rPr`, `pPrDefault/pPr`) → `StyleSheet.defaults`; `w:style` of type paragraph/character/table → `Style` (`styleId`, `name` (missing → id), `basedOn`, `next`, `default="1"`, `pPr`, `rPr`); numbering styles dropped (warning), table-style formatting (`tblPr`/`trPr`/`tcPr`/`tblStylePr`) dropped (warning), duplicate ids dropped. `latentStyles` and UI flags ignored. |
| `word/numbering.xml` | One `NumberingDef` per `w:num` (`numId`), levels from its `abstractNum` (`lvl ilvl` 0–8: `start` (default 0), `numFmt` (`decimal`, `lower/upperLetter`, `lower/upperRoman`, `bullet`; `none` → `Bullet` with the literal text of `lvlText`, usually empty; others → decimal with warning), `lvlText`, `pPr/ind`, `rPr/rFonts`), then `lvlOverride` (`startOverride`, full `lvl`) applied. Bullets of the Symbol and Wingdings fonts are mapped from Word's private-use code points (U+F0xx, also plain 8-bit codes) to readable characters (Symbol B7 → •, Wingdings A7 → ▪, D8 → ➢, FC → ✔, 76 → ❖, …; unknown ones stay as they are). `lvlRestart`, `isLgl`, picture bullets, `pStyle` links, style links: warning. `suff`, `lvlJc`, `tabs` ignored. Which nums shared an `abstractNum` (and which levels had a `startOverride`) is kept in `DocxContext.numbering`. |
| `word/theme/theme1.xml` | Parsed into `DocxContext.theme` (`core_model::Theme`: color scheme, major/minor latin/ea/cs fonts); raw bytes kept in `DocxContext.theme_xml` (unless the theme part has relationships of its own: then the built-in theme is used, warning). |
| `word/settings.xml` | Raw bytes kept in `DocxContext.settings_xml` (unless it has relationships of its own, e.g. an attached template: then default settings, warning). |
| other parts | `word/fontTable.xml`, `webSettings`, `docProps/*` ignored. Everything else (first-page/even-page headers and footers, footnotes, comments, glossary, custom XML, …) is dropped with one warning per part. |

### Write

All parts are regenerated (theme and settings come from `DocxContext` when given); output is
byte-for-byte deterministic for the same `Document` and context, and reading it back yields the
same document (the test suite checks read → write → read on all reference files).

| Part | Content |
|---|---|
| `[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels` | Via `fmt_ooxml::Package`. Relationships: styles, settings, theme, numbering (if any), then one per image in first-reference order. |
| `docProps/core.xml`, `docProps/app.xml` | Minimal: empty core properties (no timestamps), `Application` = `Rusuite`. |
| `word/document.xml` | `w:body` with paragraphs and tables, then `w:sectPr` (`pgSz w h` + `orient="landscape"`, `pgMar` all six margins + `gutter="0"`; a non-empty `header_text`/`footer_text` becomes `word/header1.xml`/`footer1.xml` referenced as the `default` header/footer, one paragraph per line (style `Header`/`Footer` when the style sheet has it), `{PAGE}` as a `PAGE` complex field). An empty `w:p` is appended to the body and to every cell whose content does not end with a paragraph. `w:pPr` in Word's order `pStyle, keepNext, pageBreakBefore, numPr, spacing, ind, jc, rPr`; `w:rPr` in order `rFonts, b, bCs, i, iCs, strike, color, sz, szCs, highlight, u, vertAlign` (true toggles as `<w:b/>`, false as `w:val="0"`; fonts as `ascii`+`hAnsi` or `asciiTheme`+`hAnsiTheme`; theme colors as `w:val` (resolved RGB) + `themeColor` + `themeTint`/`themeShade`; sizes as half-points in `sz` and `szCs`). Run text: `\t` → `w:tab`, `\n`/U+000B → `w:br`, U+000C → page break, characters XML cannot carry are dropped; `xml:space="preserve"` when the text has leading/trailing whitespace or double spaces. Breaks are written as their own `<w:r><w:br/></w:r>`. Images as `w:drawing/wp:inline` (`wp:extent`, `wp:effectExtent` 0, `wp:docPr id name descr`, `a:graphicFrameLocks noChangeAspect`, `a:graphic/pic:pic` with `a:blip r:embed`, `a:stretch/a:fillRect`, `a:xfrm`, `prstGeom rect`). Tables: `tblPr` (`tblW`, `tblBorders`, `tblCellMar`), `tblGrid` (the model's column widths; if empty: the first row's fixed cell widths, else the text width split evenly), `trPr` (`trHeight val hRule`, `tblHeader`), `tcPr` (`tcW`, `tcBorders`, `shd val="clear" color="auto" fill`, `vAlign`); borders as `val sz space="0" color` (`BorderStyle::None` → `nil`). Tables without rows and rows without cells are skipped. |
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

## pptx (`fmt-pptx`)

`fmt_pptx::read(&[u8]) -> Presentation` and `fmt_pptx::write(&Presentation) -> Vec<u8>` (plus
`read_with_warnings`, `read_with_context` / `write_with_context` with `PptxContext`, and
native-only `read_path` / `write_path`), mapping to `model_show::Presentation` (ADR 0008). The
crate compiles for `wasm32-unknown-unknown`. Transitional PresentationML + DrawingML; parts are
found by relationship type (last path segment). Unsupported content never fails a read: it is
dropped with a warning (repeats merged into one line with a count). The XML DOM/writer and the
theme parser are copies of `fmt-docx`'s (format crates do not depend on each other).

### Read

| Part / element | Handling |
|---|---|
| `ppt/presentation.xml` | `p:sldSz cx cy` → `SlideSize` (missing → 16:9); `p:sldIdLst` order → slides (each `sldId` resolved via its `r:id`; dangling ids dropped with warning). Built-in layouts are created for the slide size (`Presentation::empty`). |
| `ppt/theme/theme1.xml` | → `Presentation.theme` (color scheme, major/minor latin/ea/cs fonts); raw bytes kept in `PptxContext.theme_xml` (not if the theme part has relationships: warning). |
| slide layout | Layouts and masters are **not imported**. Each slide is mapped to a built-in `LayoutKind` from its placeholders, the layout part's `type` only breaking ties: a `ctrTitle` or `subTitle` placeholder → Title; a body-like placeholder (`body`, `obj`/no type, `pic`, `chart`, `tbl`, `dgm`, `media`, `clipArt`) → Title and Content; only a `title` → Title if the layout part is `type="title"`, else Title and Content (types other than `title`/`obj`/`tx`/`blank`: warning); no placeholders → Blank. (LibreOffice references a `title` or `blank` layout from almost every slide, so the layout part alone is unreliable.) |
| placeholders (`p:nvPr/p:ph`) | `title`/`ctrTitle` → `Title` (on Title slides `CenteredTitle`), `subTitle` → `Subtitle`, body-like → `Body`. Other types (`dt`, `ftr`, `sldNum`, `hdr`, …) → plain text boxes (warning). A placeholder without `a:xfrm` takes its position from the file's layout part (same `idx`, else same type, else same class: title/ctrTitle, body/obj/subTitle), then from its master, then from our built-in layout; with none → dropped (warning). Body properties of placeholders start from the built-in layout's defaults (e.g. title anchored middle, shrink on overflow) and are overridden by what the slide's `a:bodyPr` sets. |
| `p:cSld/p:spTree` | Children in order (= z-order): `p:sp`, `p:cxnSp`, `p:pic`, `p:grpSp`; `mc:AlternateContent` → its `mc:Fallback` (else first `mc:Choice`). `p:graphicFrame` → dropped with warning ("tables dropped", "charts dropped", "graphic frames … dropped"); `p:contentPart` (ink) dropped with warning. |
| `p:sp` | `p:cNvPr name` (empty names get the model's defaults, e.g. `Rectangle 7`); `p:spPr/a:xfrm` (`off`, `ext`, `rot` 60000ths of a degree clockwise → degrees `0..360`, `flipH`, `flipV`); `a:prstGeom prst`: `rect`, `roundRect` (adjust values dropped, warning), `ellipse`, `line`/`straightConnector1` → `Line`; other presets and `a:custGeom` → `Rect` (warning). Fill: `a:noFill`, `a:solidFill`; `a:gradFill` → first stop color, `a:pattFill` → foreground color, `a:blipFill`/`a:grpFill` → none (all with warning); no fill element → `p:style/a:fillRef` color (idx ≥ 1), else none. `a:ln`: `w`, fill as above (none given → `a:lnRef` color, else none), `a:prstDash` (`solid`; `dash`/`sysDash`/`lgDash` → dash; `dot`/`sysDot` → dot; others and `a:custDash` → dash with warning); arrowheads and compound lines: warning. No `a:ln` → `p:style/a:lnRef` (idx ≥ 1: its color, width 0.5/1/1.5 pt by idx), else no outline. `p:style/a:fontRef` color → color of runs that set none. `p:txBody` → `TextBody` (below). A `Line` with an empty text body (LibreOffice) gets no text body. |
| `p:cxnSp` | → `Auto { geometry: Line, text: None }` with xfrm, fill and outline as for `p:sp`; bent/curved connectors read as straight lines (warning). |
| `p:pic` | `p:blipFill/a:blip r:embed` → the image part into the `MediaStore` (first-reference order, content type from `[Content_Types].xml`, identical images deduplicated) → `Picture { media }`; `a:xfrm`, outline (`a:ln`). Linked images, missing parts and dangling relationships: picture dropped (warning). `a:srcRect` cropping: warning. |
| `p:grpSp` | `p:grpSpPr/a:xfrm` (`off`/`ext` → the group's transform; `rot`, flips) and `chOff`/`chExt`: children are renormalized to the model's convention (relative to the group's top-left at scale 1): `x' = (x − chOff.x) · ext.cx / chExt.cx` (same for y, w, h; zero `chExt` → scale 1). Recursive for nested groups. |
| `a:bodyPr` | `wrap` (`none` → false), `lIns`/`tIns`/`rIns`/`bIns`, `anchor` (`t`/`ctr`/`b`; `just`/`dist` → top, warning), `a:noAutofit`/`a:normAutofit` (font scale ignored)/`a:spAutoFit`. Absent attributes keep the base (defaults, or the placeholder's layout defaults). Vertical text, text columns, `rot`, WordArt warp, 3-D: warning. Non-empty `a:lstStyle`: warning. |
| `a:p` / `a:pPr` | `algn` (`l`, `ctr`, `r`, `just`; `dist`/`justLow`/`thaiDist` → justify, warning), `lvl` (0–8), `a:lnSpc`/`a:spcBef`/`a:spcAft` (`a:spcPct val` thousandths of a percent, also `"90%"`; `a:spcPts val` hundredths of a point), bullets `a:buNone` → `Bullet::None`, `a:buChar char` → `Bullet::Char`, `a:buAutoNum type` (`arabicPeriod`, `arabicParenR`, `alphaLc/UcPeriod`, `romanLc/UcPeriod`; others → `arabicPeriod`, `startAt ≠ 1` dropped, warnings), `a:buBlip` → `•` (warning). Ignored: `marL`, `indent`, `marR`, `buFont`, `buClr`, `buSz*`, `defRPr`. `rtl="1"`, non-empty `a:tabLst`: warning. `a:endParaRPr` ignored. |
| runs | `a:r` → `TextRun` (`a:t` text as is); **`a:br` → a run with text `"\n"`** (the line break's own `a:rPr`); `a:fld` → its current text (warning). Adjacent runs with equal formatting are merged, empty runs dropped. |
| `a:rPr` | `sz` (hundredths of a point) → `FontSize`, `b`, `i`, `u` (`sng`/`heavy`/`words`… → single, `dbl`, `dotted*`, `dash*`/`dotDash*` → dashed, `wavy*`, `none`), `strike` (`noStrike` → false, else true), `baseline` (> 0 superscript, < 0 subscript, 0 baseline), `a:solidFill` → color (`a:gradFill` → first stop, warning), `a:highlight` → highlight color, `a:latin typeface` → font (`+mj-lt`/`+mn-lt` → theme major/minor latin, `+mj-ea` … → the other theme slots, empty → none). `cap`, `spc`, `a:ln`, non-empty effects, hyperlinks (text kept), `a:noFill`: warning. Ignored: `lang`, `altLang`, `dirty`, `err`, `kern`, `noProof`, `a:ea`, `a:cs`, `a:sym`, underline line/fill. |
| colors | `a:srgbClr`, `a:schemeClr` (`tx1`/`bg1`/`tx2`/`bg2` and scheme names; `phClr` → none), `a:sysClr lastClr`, `a:prstClr` (common names; unknown → black, warning), `a:scrgbClr` (sRGB-encoded). Modifiers: `lumMod`/`lumOff` → `Color::Theme { tint }` exactly (`lumOff > 0`: tint = lumOff; else tint = lumMod − 1); `a:shade`/`a:tint` approximated as tints without warning; on RGB colors the tint is applied to the RGB value. `a:alpha` and other modifiers: dropped (warning). `a:hslClr`: dropped (warning). |
| `p:bg` | `p:bgPr` fill (as above) → `Slide.background`; `p:bgRef` → its color as solid fill. |
| `p:cNvPr descr` | Any shape → `Shape.alt` (empty → `None`). |
| notes | The slide's `notesSlide` relationship → `Slide.notes`: the plain text of the notes page's `body` placeholder (paragraphs joined by `\n`, trailing empty ones dropped; empty → `None`). Formatting of notes is not kept. |
| other | `p:sld show="0"` → `Slide.hidden`. `p:transition` (also inside `mc:AlternateContent`) and `p:timing`: warning. Masters, layouts, `presProps`, `viewProps`, `tableStyles`, notes/handout masters and `docProps` are ignored; notes slides no slide links to → "speaker notes dropped", comments → "comments dropped", any other part → "part … dropped". |

### Write

All parts are regenerated (only the theme may come verbatim from `PptxContext`); output is
byte-for-byte deterministic, and read → write → read gives the same presentation (ids aside) for
every reference file and for the built deck (`examples/build_deck.rs`, also `tests/built.rs`).

| Part | Content |
|---|---|
| `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml` (empty, no timestamps), `docProps/app.xml` (`Application` Rusuite, `Slides`) | Via `fmt_ooxml::Package`. |
| `ppt/presentation.xml` (+ rels) | `p:sldMasterIdLst` (2147483648 → `rId1`), `p:sldIdLst` (ids 256…, `rId2`…; omitted without slides), `p:sldSz` (clamped to 1"–56"), `p:notesSz` 7.5"×10", `p:defaultTextStyle` (18 pt minor font). Rels: master, slides, `presProps`, `viewProps`, theme, `tableStyles` (and the notes master, listed in `p:notesMasterIdLst`, when a slide has notes). |
| notes (only when a slide has notes) | `ppt/notesMasters/notesMaster1.xml` (slide image and `body idx=1` placeholders on the portrait notes page, standard `p:clrMap`; rel to `ppt/theme/theme2.xml`, a generated copy of the theme); `ppt/notesSlides/notesSlideN.xml` (N = slide number; rels: notes master, slide) with the notes text as one `a:p` per line. Hidden slides: `p:sld show="0"`. Alt text: `p:cNvPr descr`. |
| `ppt/slideMasters/slideMaster1.xml` | Background `p:bgRef idx=1001 bg1`; title (`type="title"`) and body (`type="body" idx="1"`) placeholders at the Title and Content positions; standard `p:clrMap`; `p:sldLayoutIdLst` (2147483649–51); `p:txStyles`: title 44 pt major font, 90 % line spacing; body levels 1–9 with `•` bullets (Arial), `marL` 0.25" + 0.5" per level, hanging 0.25", 28/24/20/18 pt minor font; other text 18 pt. |
| `ppt/slideLayouts/slideLayout{1,2,3}.xml` | Title Slide (`type="title"`: `ctrTitle`, `subTitle idx=1`), Title and Content (`type="obj"`: `title`, body `idx=1`), Blank (`type="blank"`). Placeholders at the positions of `Presentation.layouts`, each with `a:bodyPr` from the placeholder's body defaults and an `a:lstStyle/a:lvl1pPr` with its paragraph defaults (alignment, bullet) and run defaults (size, theme font) as `a:defRPr`. |
| `ppt/slides/slideN.xml` (+ rels: layout, then one image rel per media item) | `p:bg/p:bgPr` (fill + `a:effectLst`) if the slide has a background; shapes in z-order with `p:cNvPr id` 2, 3, … per slide (empty names → `<default name> <id − 1>`). `p:sp`: `p:cNvSpPr` (`a:spLocks noGrp` for placeholders, `txBox="1"` for text boxes), `p:nvPr/p:ph` (`ctrTitle`; `title`; `subTitle` / body with `idx` 1, 2, … unique per slide), `p:spPr` (`a:xfrm` always, also for placeholders: `rot` only if ≠ 0, `flipH`/`flipV` only if set; `a:prstGeom` `rect`/`roundRect`/`ellipse`/`line` with empty `a:avLst`; `a:noFill`/`a:solidFill`; `a:ln w` + fill + `a:prstDash`), `p:txBody` (`a:bodyPr wrap lIns tIns rIns bIns rtlCol anchor` + autofit element, empty `a:lstStyle`, paragraphs). A `Line` without text (and not a placeholder) is written as `p:cxnSp` with `prst="line"`. Pictures: `p:pic` (`a:picLocks noChangeAspect`, `a:blip r:embed`, `a:stretch/a:fillRect`, xfrm, `rect`, `a:ln`). Groups: `p:grpSp` with `a:xfrm` + `a:chOff 0 0` + `a:chExt` = the group's size, then the children. No `p:style` is written. |
| text | `a:pPr` attributes `marL lvl indent algn` (`marL`/`indent` only for bulleted paragraphs: 0.25" hanging + 0.5" per level for `buChar`, 0.375" for `buAutoNum`), children `a:lnSpc`, `a:spcBef`, `a:spcAft`, `a:buFont` (Arial for characters, `+mj-lt` for numbering) + `a:buChar`/`a:buAutoNum`, or `a:buNone`. `a:rPr` attributes `sz b i u strike baseline` (superscript 30 %, subscript −25 %), children `a:solidFill`, `a:highlight`, `a:latin`. Run text: `\n` and U+000B → `a:br` (with the run's `a:rPr`), `\r` dropped, characters XML cannot carry dropped. Empty paragraphs → `<a:p/>`; a body without paragraphs gets one. |
| colors | RGB → `a:srgbClr`; theme → `a:schemeClr` (`tx1`/`bg1`/`tx2`/`bg2` for dark/light 1/2) with `a:lumMod` (darker: 1 + tint) or `a:lumMod` + `a:lumOff` (lighter: 1 − tint, tint); `Color::Auto` → `tx1` in fills, omitted for text. |
| `ppt/theme/theme1.xml` | `PptxContext.theme_xml` verbatim if it still parses to `Presentation.theme`, else generated from the model (all 12 colors as `a:srgbClr`, major/minor latin/ea/cs fonts, Office-like format scheme: three solid `phClr` fills, 0.5/1/1.5 pt lines, no effects). |
| `ppt/presProps.xml`, `ppt/viewProps.xml`, `ppt/tableStyles.xml` | Empty presentation properties; normal view at 100 %; no table styles (PowerPoint's default style id). |
| `ppt/media/imageN.ext` | Each referenced media item once, numbered in first-reference order across slides; extension from the content type (`png`, `jpeg`, `gif`, `bmp`, `tiff`, `svg`, `webp`, `emf`, `wmf`, else `bin`). A picture whose media is missing fails the write (`Error::InvalidPresentation`). |

### Known lossy points

- Masters and layouts of the file are replaced by the built-ins: master graphics, layout-specific
  text styles, footers/date/slide-number placeholders and non-standard layouts are lost; slides are
  mapped to Title / Title and Content / Blank. Placeholder text that relied on the file's master
  styles (size, color, font) is shown with ours (title 44 pt, body 28 pt…) unless the runs set
  them explicitly (LibreOffice always does).
- Shapes that took their look from `p:style` get it resolved into explicit fill/outline/run color;
  effects (shadows, glow) are lost. We never write `p:style`, so text in auto shapes uses the
  master's text color (dark) unless runs set a color – PowerPoint's default white-on-accent comes
  back only when the file stated it.
- Bullet font, color and size (`buFont`, `buClr`, `buSzPct`) and paragraph indents (`marL`,
  `indent`) are not modelled; bulleted paragraphs are written with fixed indents.
- `a:br` is modelled as `"\n"` inside a run (no separate break inline); a vertical tab (U+000B) is
  written as `a:br` and reads back as `"\n"`.
- Rounded-rectangle corner radius, arrowheads, compound lines, cropping, transparency,
  gradients/patterns (first color kept) and preset geometries other than rect, roundRect, ellipse
  and line (read as rectangles) are lost.
- Font faces map to `a:latin` only; theme east-asian/complex-script slots are written as
  `+mj-lt`/`+mn-lt`.
- Rotations are stored in 1/60000°; a model angle with more precision is rounded on write.
- Group children with non-uniform child scaling (`chExt` aspect ≠ `ext` aspect) are scaled
  per axis; rotated children of such groups are approximated.
