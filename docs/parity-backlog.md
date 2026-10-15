# Office parity backlog (Phase 8) – owner direction 2026-10-15

"Continue improving the apps until we are very close to what an office suite offers, without overblowing, ensuring functionalities are implemented. No Power Query (yet), no VBA; JSON maybe later." Priority = how often ordinary users hit the feature. Tiers are worked top to bottom; each line becomes one task (P8-…). Non-goals stay: macros/VBA, Power Query, track changes, comments/co-authoring (ask before touching), pixel-exact layout.

## Calc
**Tier 1**
1. Function library to ~200 functions: SUMIFS/COUNTIFS/AVERAGEIFS/MAXIFS/MINIFS, IFS, SWITCH, XLOOKUP/XMATCH, TEXTJOIN, SEARCH/REPLACE/REPT/PROPER/CHAR/CODE/UNICODE/CLEAN/EXACT/NUMBERVALUE/FIXED, DATEVALUE/TIMEVALUE/EDATE/EOMONTH/NETWORKDAYS/WORKDAY/DATEDIF/YEARFRAC/WEEKNUM/ISOWEEKNUM, financial PMT/IPMT/PPMT/FV/PV/NPV/IRR/RATE/NPER/SLN/DB, statistics MEDIAN/MODE/STDEV.S/STDEV.P/VAR.S/VAR.P/LARGE/SMALL/RANK.EQ/PERCENTILE.INC/QUARTILE.INC/CORREL/FORECAST.LINEAR/TREND, math TRUNC/CEILING.MATH/FLOOR.MATH/MROUND/EXP/LN/LOG/LOG10/SIGN/RAND/RANDBETWEEN/SUMSQ/SQRTPI/FACT/COMBIN/GCD/LCM/QUOTIENT, logical/info XOR/IFNA/ISLOGICAL/ISEVEN/ISODD/N/T/TYPE/CELL(basic)/INFO(no), lookup ROWS/COLUMNS/CHOOSE(exists)/LOOKUP/INDIRECT/OFFSET/ADDRESS/TRANSPOSE/HYPERLINK, arrays SORT/FILTER/UNIQUE/SEQUENCE (dynamic arrays need spilling – see 6). Reference values via the LibreOffice suite + Excel overrides.
2. Freeze panes / split, hidden rows/cols UI parity, hidden sheets (reader keeps state).
3. Merge cells (model, xlsx `mergeCells`, rendering, editing rules).
4. Sort & AutoFilter (sort by column asc/desc/custom, multi-key; filter dropdowns by values/text/number conditions; xlsx `autoFilter` + `sortState`).
5. Conditional formatting (cell value rules, text contains, top/bottom, data bars/color scales basic; xlsx `conditionalFormatting`).
6. Dynamic arrays and spilling (`SORT/FILTER/UNIQUE/SEQUENCE`, `#SPILL!`), implicit-intersection operator `@`.
7. Data validation (list, whole number/decimal/date ranges, custom formula; dropdown in-cell; xlsx `dataValidations`).
8. Charts (bar/column/line/pie/scatter/area, basic styling, chart sheet objects; xlsx `drawing` + `chart` parts; rendered with the Show drawing stack) – shared with Show.
9. Named ranges (define/manage, Name Box, formulas use them; xlsx `definedNames`).
10. Number formats: full custom format grammar (conditions, colours, fractions, scientific, `?`), locale-aware display/input (German decimal/`;` – pending owner decision).
**Tier 2**: tables (structured references, banded rows), comments/notes (owner decision – non-goal today), cell protection/sheet protection (no password strength promises), goal seek, text-to-columns, remove duplicates, sparklines, hyperlinks in cells, pictures in sheets, page break preview, print titles/areas saved to file, CSV import/export with options, paste special (transpose, operations), grouping/outline.
**Later/no**: pivot tables (ask), Power Query, VBA, external links.

## Write
**Tier 1**
1. Multilevel lists and numbering formats (numbering.xml fidelity: restart, continue, custom formats, list styles), list indent via ruler.
2. Styles management: modify/create styles, update style from selection, style inspector; character styles; "Normal" defaults.
3. Page numbers as fields, sections (next page/continuous), different first page / odd-even headers, per-section page setup, columns (2/3).
4. Table of contents (from headings, updateable), captions, footnotes/endnotes, bookmarks + hyperlinks (internal/external), cross-references (basic).
5. Floating images with text wrapping (square/tight/top-bottom), image borders, crop; shapes/text boxes in documents (reuse the Show drawing model).
6. Paragraph borders/shading, tab stops (ruler), hanging indents via ruler, keep-with-next/widow control UI, hyphenation (browser), drop cap (no).
7. Find/replace with formatting and wildcards; go to page; navigation pane (headings outline).
8. Tables: split/merge cells (model + docx `gridSpan`/`vMerge`), table styles presets, repeat header rows across pages, autofit, alignment within page, cell margins.
9. Document properties, templates (.dotx read), symbols dialog, date/time fields, equations (later).
**Tier 2**: comments (owner decision), track changes (non-goal), mail merge (no), citations (later), compare documents (later), master documents (no).

## Show
**Tier 1**
1. Shape library: arrows, callouts, stars, flowchart basics, connectors with arrowheads and elbow routing; shape text wrap/autofit modes; line endings.
2. Tables in slides (model + pptx `graphicFrame`), charts (shared engine with Calc).
3. Themes and templates: colour/font schemes switching, slide master editing (basic: background, title/body fonts, placeholder positions), layouts beyond the three built-ins (Two Content, Comparison, Title Only, Section Header, Picture with Caption).
4. Transitions (fade/push/wipe – README said "not for now"; owner now wants parity: implement simple ones + pptx `transition` read/write) and basic entrance/exit animations (appear/fade/fly-in, order pane) – ask before the animation pane.
5. Images: crop, brightness/contrast (CSS filters), transparency, replace, compress on save (optional); gradients and shadows on shapes.
6. Slide numbers/date/footer placeholders, sections, slide sorter view, reuse slides from another file, hyperlinks and action buttons.
7. Media: video/audio embedding (pptx `media` + HTML5 playback) – tier 2 if size matters.
**Tier 2**: SmartArt (no), export video (no), rehearse timings, custom shows, ink.

## Cross-cutting
- Charts engine (Calc + Show + Write): model-chart crate, DrawingML chart parts, canvas/SVG renderer. Large; after Calc tier-1 items 1–5.
- Hyperlinks everywhere; document properties; templates; locale-aware numbers/dates (pending decision); accessibility (ARIA on the grid, screen-reader text); AI assistant (docs/ai-plan.md).
