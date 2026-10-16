# Charts

The chart model shared by Calc and Show, how Calc stores and resolves charts, and the rendering
rules a chart renderer must follow so that Calc and Show draw the same chart the same way (and as
close to Excel/PowerPoint as we can get without their layout engine). Backend: P8-18; renderer and
Calc UI: P8-20 (see "Renderer" and "Calc UI" below); Show charts: P8-24 ("Show" below).

| Layer | Where | What |
|---|---|---|
| Model | `core_model::chart` | `Chart` (kind, series, categories, axes, legend, labels, style), `ResolvedChart`, palette, `Chart::from_range` |
| File format | `fmt_ooxml::chart` | `c:chartSpace` ↔ `Chart` (read, write with caches); shared by xlsx/pptx/docx |
| Calc document | `model_sheet::chart` | `ChartObject { id, name, anchor, chart }` per sheet, reference adjustment, `Workbook::chart_data` |
| xlsx | `fmt-xlsx` (`drawing.rs`) | `xl/drawings/drawingN.xml` anchors + `xl/charts/chartN.xml` |
| Calc wire | `calc-core` (`charts.rs`, `wire_chart.rs`) | commands, requests, patch `chartSheets`, TS types in `apps/calc/src/generated/` |
| Renderer | `@rusuite/ui-shared` `chart/` | `layoutChart` → `ChartScene`, canvas/SVG painters, hit-testing (app-independent) |
| Calc UI | `apps/calc/src/charts/` | charts on the grid, Insert › Charts, Chart Design / Format tabs, dialogs, Format pane, printing |
| Show document | `model_show::chart` | `ChartShape { chart, data: ChartData, workbook }`: the chart plus its embedded data table |
| pptx | `fmt-pptx` (`chart.rs`) | `p:graphicFrame` → `ppt/charts/chartN.xml` + `ppt/embeddings/*.xlsx` |
| Show UI | `apps/show/src/charts/` | charts on the slide, Insert › Chart, Chart Design / Format tabs, Edit Data, Format pane |

File-format details and losses: [ooxml-subset.md](ooxml-subset.md) (xlsx, "Charts").

## Model

A `Chart` (JSON camelCase; absent optional fields take the defaults in brackets):

- `kind`: `{type:"bar", direction:"column"|"bar", grouping:"clustered"|"stacked"|"percentStacked"}`,
  `{type:"line", grouping:"standard"|"stacked"|"percentStacked", markers}`, `{type:"area", grouping}`,
  `{type:"pie"}`, `{type:"doughnut"}`, `{type:"scatter", style:"marker"|"lineMarker"|"line"|"smoothMarker"|"smooth"}`,
  `{type:"combo"}` (every series has its own `kind`), `{type:"unsupported", kind, xml}` (read-only:
  radar, stock, bubble, surface, 3-D and of-pie charts from files, kept verbatim).
- `series[]`: `name?` (`TextSource`), `values` (`DataRef`), `categories?` (own categories; scatter:
  X values), `kind?` (combo only), `axis?` (`"secondary"`; [primary]), `fill?`, `line?`, `marker?`,
  `dataPoints?[]` (per-point `fill`/`line`/`marker` by `idx`), `dataLabels?`, `trendline?`, `smooth?`.
- `categories?`: categories of the series without own ones (none: `1, 2, 3, …`).
- `title?`: `{text?, overlay?}`; no `title` = no title; `text` absent = automatic (the only series'
  name; nothing when there are several series).
- `axes`: `{cat, val, secondVal?}`. Each `Axis`: `title?`, `min?`, `max?`, `majorUnit?`, `minorUnit?`
  [automatic], `numberFormat?` [linked to the source cells], `logBase?`, `reverse?`, `crosses?`
  ([`autoZero`] | `min` | `max` | `{type:"at", value}`), `majorGridlines?`, `minorGridlines?`,
  `tickLabels?` ([`nextTo`] | `high` | `low` | `none`), `delete?` (hidden). New charts: value axis with
  major gridlines, category axis without.
- `legend?`: `{position: "top"|"bottom"|"left"|"right"|"topRight", overlay?}`; none = no legend.
- `style?` [2]: Office chart style 1–48, only its colour rule is used (palette below).
- `varyColors?` [false]: one colour per point (single-series pie/doughnut).
- `plotVisibleOnly?` [true]: data in hidden rows/columns is left out.
- `displayBlanksAs?` [`gap`] | `zero` | `span` (connect over blanks; lines/scatter).
- `dataLabels?`: `{showValue?, showPercent?, showCategory?, showSeries?, showLegendKey?, position?, numberFormat?}`.
- `gapWidth?` [150] and `overlap?` [0; stacked bars 100] (bars, percent of a bar width),
  `holeSize?` [50] (doughnut, percent of the diameter), `firstSliceAngle?` [0] (degrees clockwise from
  12 o'clock).

`DataRef` is `{type:"ref", formula, cache?}` (formula without `=`, e.g. `Sheet1!$B$2:$B$7`; `cache` =
values from the file, only kept when Calc cannot resolve the reference) or `{type:"literal", values}`.
`TextSource` is `{type:"literal", text}` or `{type:"ref", formula, cache?}`. `ChartValue` is
`number | string | null`.

Formatting overrides: `ChartFill` = `{type:"none"}` | `{type:"solid", color}` (`Color` as for cells:
`{kind:"rgb", value:"FF0000"}`, `{kind:"theme", value:{slot, tint}}`); `LineFormat` =
`{none?, color?, width? (EMU, 12 700 per pt), dash?}` with DrawingML dash names (`solid`, `dot`,
`dash`, `lgDash`, `dashDot`, `lgDashDot`, `lgDashDotDot`, `sysDash`, `sysDot`, `sysDashDot`,
`sysDashDotDot`); `Marker` = `{symbol, size? (pt), fill?, line?}` with symbols `none`, `auto`,
`circle`, `dash`, `diamond`, `dot`, `plus`, `square`, `star`, `triangle`, `x`. `Trendline` =
`{kind: linear | exponential | logarithmic | power | {type:"polynomial", order} | {type:"movingAverage", period}, name?, displayEquation?, displayRSquared?, line?}`.

### Charts on a Calc sheet

`ChartObject { id, name?, anchor, chart }`, back to front (later = on top). `id` is unique per
sheet. `anchor`:

- `{type:"twoCell", from, to}`: corners as `CellOffset {col, row, colOffset, rowOffset}` (0-based
  cell, offset in EMU from the cell's left/top edge). Excel's default; moves and resizes with the
  cells.
- `{type:"oneCell", from, width, height}`: top-left corner in cells, size in EMU.
- `{type:"absolute", x, y, width, height}`: EMU from the sheet's top-left corner.

EMU → CSS px: `px = emu / 9525`. A corner's pixel position is the left/top of its cell in the grid
geometry (`colGeometry`/`rowGeometry`, hidden columns/rows have zero size) plus the offset.

References follow the workbook like formulas: row/column inserts and deletes on the referenced sheet
(a fully deleted reference becomes `#REF!`, i.e. an empty series), sheet renames, and a duplicated
sheet's charts point at the copy. Anchors on the edited sheet move with their rows/columns; a
corner in a deleted span moves to the start of the span (offset 0). A reference to a deleted sheet
keeps its text and shows nothing (or its cache).

### Excel's recommended chart (`Chart::from_range`, request `recommendedChart`)

For a selection (a single cell stands for its current region; the range is clipped to the used
area):

1. The first row holds the series names when the top-left cell is empty, or when the first row has
   no numbers outside the first column and some text.
2. The first column holds the categories when the top-left cell is empty and the first row is a
   header, or when it has no numbers below the header row and some text.
3. Series run down the columns when there are at least as many data rows as data columns, else
   along the rows.
4. The chart is a clustered column chart with gap width 219 % and overlap −27 % (Office 2013+).
   One series: automatic title (its name), no legend. Several series: title "Chart Title", legend
   at the bottom.
5. No numeric data cell: no chart (`null`).

## Data resolution (`chartData`, `previewChartData`)

`ResolvedChart { series[], title? }` with one `ResolvedSeries` per `chart.series`:

- `name`: the referenced cells' displayed texts joined with spaces, the literal, or `Series<n>`
  (1-based).
- `values[]`: per cell of the reference, row-major; numbers as is, text as `0` (Excel plots text
  as zero), empty cells and errors as `null`. With `plotVisibleOnly`, cells in hidden rows/columns
  are left out.
- `categories[]`: the category cells' displayed texts (number formats applied), padded/cut to
  `values.length`; without categories `"1"`, `"2"`, ….
- `xValues?`: numeric categories when every non-blank category cell is a number (scatter X values,
  date axes); for a scatter series without categories `1, 2, 3, …`.
- `formatCode?` / `categoryFormatCode?`: number format of the first value / category cell
  ("linked to source" axes and labels; absent = General).
- `title?`: the resolved chart title (literal, referenced cell, or the automatic title).

Unresolvable references (external workbooks, deleted sheets) use the file's cache when there is one.
Unsupported charts resolve to no series.

## Rendering rules

All sizes below are at 100 % zoom in CSS px (1 pt = 4/3 px). Fonts: the workbook's body font
(Calibri, fallback Carlito/Liberation Sans).

### Frame

Chart area: white fill, 0.75 pt border `#D9D9D9` (tx1 tinted +0.85), no rounded corners. Inner
padding 8 px. Layout top to bottom: title, plot area with axes, legend (or legend at the side per
`position`; `overlay` = drawn over the plot area without taking space). Unsupported charts: the frame
with the centred text "This chart type (`<kind>`) cannot be displayed" and no data.

Text colours: titles and labels `#595959` (tx1 tinted +0.35). Sizes: chart title 14 pt (regular,
Office 2013+), axis titles 10 pt bold, tick labels, legend and data labels 9 pt.

### Colours (palette)

The automatic colour of series `i` of `n` (or, with `varyColors`, of point `i` of `n`) comes from
`core_model::chart::palette_color(style, i, n)`, a theme colour resolved with the workbook theme
(Calc: the default Office theme, like cell colours). With `k = (style − 1) mod 8` (styles outside
1..48 count as 2):

- `k = 1` (styles 2, 10, 18, 26, 34, 42; colourful): accent `1 + (i mod 6)` with the tint
  `[0, −0.4, +0.2, −0.2, +0.4, −0.5, +0.3, −0.3, +0.5][(i div 6) mod 9]` (Office 2013's
  `colors1.xml` variations `lumMod`/`lumOff`).
- `k = 0` (styles 1, 9, …; grayscale): `tx1` tinted from +0.15 (first) to +0.85 (last), linearly;
  one series: +0.5.
- `k = 2..7` (monochrome accent `k − 1`): that accent tinted from −0.5 (first) to +0.4 (last),
  linearly; one series: the accent itself.

Tints follow `core_model::apply_tint` (HLS lightness, as for cell colours). Series and point
overrides (`fill`, `line.color`, `marker.fill`) win over the palette. Bars, areas and slices are
filled with the colour and have no outline (pie/doughnut slices: 0.75 pt white outline); lines use it
as stroke; markers are filled with it.

Office 2013 defaults: gridlines 0.75 pt `#D9D9D9`; axis lines 0.75 pt `#BFBFBF` (the value axis
line is not drawn when there are gridlines); tick marks outside, 4 px, on the category axis only.

### Axes and scaling

Column/line/area charts: categories along the bottom, values on the left (secondary values on
the right). Bar charts: categories on the left from bottom to top (first category at the bottom, as
Excel), values along the bottom (secondary at the top). Scatter: X along the bottom, Y on the left.
`reverse` flips an axis; `crosses` moves where the other axis crosses (`max` = the opposite side);
`delete` hides the axis but keeps its scale; `tickLabels: "none"` hides only the labels,
`"low"`/`"high"` put them at the low/high end of the crossing axis.

Automatic value scale (Rusuite's approximation of Excel; `min`/`max`/`majorUnit` override each part):

1. Data range: the minimum and maximum of the plotted values (stacked: of the per-category sums of
   positive and of negative values; percent stacked: the axis is 0..1, format `0%`).
2. Minimum: 0 when all values are ≥ 0 and the minimum is less than 5/6 of the maximum (Excel's
   rule); maximum likewise 0 when all values are ≤ 0. Otherwise the data extreme.
3. Major unit: the smallest of 1, 2, 5 × 10ⁿ such that the range splits into at most
   `max(2, floor(plotHeightPx / 40))` intervals (vertical axes; horizontal axes use
   `plotWidthPx / 70`).
4. Bounds: the minimum rounded down and the maximum rounded up to the major unit; when the data
   maximum lies exactly on the rounded maximum (and is not 0), one more major unit is added (bar,
   column, line and area charts).
5. `logBase`: bounds are powers of the base around the data; major unit = one power.
6. Tick labels use `numberFormat`, else the first value cell's format (`formatCode`), else
   General. Minor gridlines/ticks every `minorUnit` [major / 5].

Category axes: `n` equal bands. Bar/column and line charts plot at the band centres; area charts
plot on the band edges (`crossBetween midCat`). Category labels are horizontal and are thinned
(every k-th label) when they would overlap; numeric/date categories use `categoryFormatCode`.

### Chart types

- **Clustered bars**: per band with `s` series (on one axis group), bar width
  `w = band / (s − (s − 1)·overlap/100 + gapWidth/100)`; series i's bar starts at
  `bandStart + gap/2·w + i·w·(1 − overlap/100)`. Negative values grow from the crossing value
  downward.
- **Stacked / percent stacked bars**: one bar per band (`w = band / (1 + gapWidth/100)`); positive
  values stack upward from 0 and negative values downward, in series order; percent stacked divides
  each value by the sum of the absolute values of its category.
- **Lines**: 2.25 pt stroke, round joins. `markers`: every series gets markers (`auto` symbol =
  circle, size 5 pt, filled with the series colour, 0.75 pt outline in the same colour) unless the
  series' `marker.symbol` is `none`; without `markers` only series with an explicit marker show
  one. `smooth`: a Catmull–Rom spline through the points (tension 0.5) drawn as cubic Béziers.
  Stacked lines add up like stacked bars.
- **Areas**: filled polygons from the baseline (stacked: from the previous series' top), series
  drawn back to front so the first series is in front for standard areas.
- **Pie**: one series (the first). Slices clockwise from `firstSliceAngle` (12 o'clock = 0°) in
  data order; values ≤ 0 or blank are left out; the pie is a circle of 75 % of the plot area's
  smaller side. `varyColors` (default for pies from Excel) colours by point, else every slice has
  the series colour.
- **Doughnut**: like a pie with a hole of `holeSize` % of the diameter; several series are
  concentric rings, the first series innermost.
- **Scatter**: points at (`xValues[i]`, `values[i]`); `marker`/`lineMarker`/`line`/`smoothMarker`/`smooth`
  decide lines and markers per the kind (series overrides win); points with a `null` X or Y are left
  out.
- **Combo**: each series is drawn with its own kind in the shared plot area; bar series first, then
  areas, then lines and scatter on top; bars of a combo cluster only with bars of the same axis
  group.
- **Secondary axis**: series with `axis: "secondary"` use `axes.secondVal` (automatic scale of their
  own values), drawn on the opposite side; the category axis is shared.
- **Blanks**: `gap` leaves a gap in lines and no bar/point; `zero` plots 0; `span` connects the
  neighbouring points of lines and scatter (bars: gap).
- **Trendlines**: least squares on (x, y) with x = 1..n for category charts and `xValues` for
  scatter; exponential/power fit `ln y` (positive values only), logarithmic `ln x`; polynomial of
  `order`; moving average over `period` points starting at point `period`. 1.5 pt dashed (`sysDot`)
  in the series colour; equation/R² as a 9 pt label near the line end. Legend text: `name` or
  "Linear (<series>)" etc.

### Titles, legend, data labels

- **Chart title**: `title.text` resolved (`ResolvedChart.title`), centred at the top.
- **Axis titles**: the text, or "Axis Title" when automatic; vertical axes' titles rotated −90°.
- **Legend**: one entry per series in series order (vary-coloured pies/doughnuts: one entry per
  category); key = a 7 px square in the fill colour (lines: a short line with the marker). Bar charts
  list the series in reverse order when the legend is on the right (Excel). `position` places it;
  `topRight` sits in the top-right corner.
- **Data labels**: per point, the shown parts in the order series name, category, value, percentage,
  separated by `", "`; value formatted with `numberFormat`, else the series' `formatCode`, else
  General; percentage with `0%`. Positions [default]: bars `outsideEnd` [`outsideEnd`; stacked:
  `center`], lines/scatter `right` [`right`], areas `center`, pies `bestFit` [`bestFit` = inside
  when the label fits in the slice, else outside], also `insideEnd`, `insideBase`, `center`, `top`,
  `bottom`, `left`.

## Calc commands, requests and patches

Commands (`apply`, all undoable; the patch lists the sheet in `chartSheets`):

| Command | Effect | Errors |
|---|---|---|
| `addChart {sheet, anchor, chart, id?, name?}` | Adds the chart on top; `id` absent = next free id; name `Chart <id>` | `invalid_chart` (style outside 1..48, an unparsable reference, > 255 series, bad anchor, an `unsupported` kind) |
| `updateChart {sheet, id, chart}` | Replaces the chart (anchor and name stay) | `unknown_chart`, `invalid_chart` (also when either chart is `unsupported`: read-only) |
| `setChartAnchor {sheet, id, anchor}` | Moves/resizes | `unknown_chart`, `invalid_chart` |
| `setChartSeries {sheet, id, series, categories}` | Replaces the data ("Select Data") | `unknown_chart`, `invalid_chart` (not for `unsupported` charts) |
| `removeChart {sheet, id}` | Deletes the chart | `unknown_chart` |
| `restoreCharts {sheet, charts}` | *Internal* (undo) | |

Requests: `sheetCharts {sheet}` → `charts {charts}`; `chartData {sheet, id}` and
`previewChartData {sheet, chart}` → `chartData {data}`; `recommendedChart {sheet, r0, c0, r1, c1}` →
`recommendedChart {chart | null}` (`range_too_large` above 65 536 cells). `snapshot` replies carry
every chart of the sheet in `snapshot.charts`.

`CalcPatch.chartSheets` lists the sheets whose charts may look different: a chart command; a cell
change inside a range a chart on that sheet references (any sheet); and, when the workbook has
charts, every sheet with charts after a structural edit, a change of the sheet list (add, delete,
rename, move, hide) or of row/column properties (hidden rows change `plotVisibleOnly` data). The UI
refetches `sheetCharts` for those sheets and `chartData` for the charts it shows.

Saving to xlsx writes the charts with fresh caches; reading drops the caches of references that
resolve (Calc recomputes) and keeps unsupported chart types verbatim.

## Renderer (`packages/ui-shared/src/chart`, P8-20)

- `layoutChart(chart, data, width, height, options) → ChartScene`: pure; the scene is a flat list of
  primitives (`rect`, `path` with SVG path data, `text` with alignment/rotation, optional clip box)
  in px of the chart box, back to front, each tagged with its `ChartElement` (chart area, plot area,
  title, legend, axis, axis title, gridlines, series/point, data labels, trendline), plus hit regions
  (`rect`, `polyline` with width, `polygon`, `sector`, `circle`) and the drawn value-axis scales.
  `options`: `theme` (slot → RRGGBB; default Office), `format(value, code)` (Calc passes the core's
  number formats, cached), `measure(text, px, bold)` (Calc: the grid's canvas measure), translated
  `labels` ("Chart Title", "Axis Title", trendline names, the unsupported placeholder), `thumbnail`
  (gallery icons: no text, thin padding).
- `drawChartScene(ctx, scene)` (canvas, `Path2D`), `drawChartSelection(ctx, scene, el)` (Excel's
  frame/handles of a selected element), `sceneToSvg(scene)` (print, PDF, previews; unique clip ids),
  `hitTestChart(scene, x, y)` (topmost element), `ChartPreview` (React, inline SVG).
- Everything in "Rendering rules" above is implemented; approximations: text widths are measured
  by the host (default: an average Calibri advance), category labels are thinned, never rotated or
  wrapped; minor gridlines are drawn in `#F2F2F2`; area charts with bars use band centres.
- `crosses` follows OOXML: an axis' `crosses` says where *it* sits on the other axis (`val.crosses:
  max` puts the value axis on the right; `cat.crosses: {at: 5}` draws the category axis at value 5);
  a secondary value axis sits on the opposite side unless its `crosses` is `min`.

## Calc UI (`apps/calc/src/charts`, P8-20)

- State (`store.charts`, `ChartController`): chart lists per sheet (from `snapshot.charts` and
  `sheetCharts`), resolved data per chart (`chartData`, refetched when `chartSheets` names the sheet,
  debounced 40 ms like CF; the old data stays until the new arrives), scenes memoized per chart /
  data / size, the selection (`{sheet, id, element}`), the drag preview, the chart clipboard and every
  chart command. `window.__calcCharts` holds the last frame's charts (sheet px rectangle and scene) for
  the end-to-end tests.
- Grid: charts are painted over the cells per frozen-pane quadrant (scroll/zoom aware); the selected
  chart gets a frame with 8 round handles and Excel's coloured outlines of its source ranges (names
  red, categories purple, values blue). Pointer events: a click selects the chart and the element
  under the pointer (a series first, a second click its point; a click on the selected title/axis
  title edits it inline), a drag moves it, a handle resizes it (min 24 px), Alt snaps to cell edges;
  the anchor kind is kept (`setChartAnchor`). Double-click opens the Format pane on the element.
  Keys: Esc goes element → chart → cells, Delete/Backspace removes, Ctrl+C/X/V copy, cut and paste a
  duplicate at the active cell (within the workbook), typing does nothing. Right-click: Cut, Copy,
  Paste, Select Data…, Change Chart Type…, Move Chart…, Format Chart Area…, Delete.
- Insert › Charts: Recommended Charts (dialog with 3–5 live previews built from `recommendedChart`
  and `previewChartData`), Column or Bar ▾, Line or Area ▾, Pie or Doughnut ▾, Scatter ▾, Combo ▾
  (Excel's 2-D sub-types; icons are drawn by the renderer on sample data). A new chart is
  `recommendedChart` of the selection (an empty clustered column chart without numbers) converted to
  the sub-type (`applyPreset`: Office 2013+ gap/overlap, vary-coloured pies, 75 % doughnut hole,
  scatter X values from the first column when there are no category labels), placed one column right
  of the selection at the top row, 480 × 288 px, selected, and Chart Design is shown.
- Chart Design (contextual): Add Chart Element ▾ (flyouts: Axes, Axis Titles, Chart Title, Data
  Labels per kind, Gridlines, Legend, Trendline – on the selected series, else the first), Quick
  Layout ▾ (8 layouts, live previews), Change Colors ▾ (Colorful 1 = style rule 2; Colorful 2–4 =
  explicit accent fills per series, per point for vary-coloured pies; Monochromatic 1–6 = styles
  3–8; gray = style 1), Chart Styles ▾ (8 styles as live previews: gridlines, labels, bar widths,
  markers, legend place – the model has no chart-area fills or effects), Switch Row/Column (series
  that are adjacent single columns/rows of one block; names ↔ categories), Select Data…, Change Chart
  Type… (type list, sub-type icons, live preview; Combo: kind and secondary axis per series), Move
  Chart… (another sheet, or a new sheet inserted before the current one; one compound).
- Format (contextual): Current Selection (element list, Format Selection, Reset to Match Style),
  Shape Fill / Shape Outline of the selected series or point, Size (cm). The Format pane (right of the
  grid): series fill/line/border/width/dash, markers, smooth, secondary axis, gap width, overlap,
  hole size, first slice angle, vary colours; axis bounds/units (blank = automatic), log scale and
  base, reverse, where the other axis crosses, tick label position, number format, hide; data label
  parts/position/format; legend position/overlay; title text/overlay; trendline type, order, period,
  name, equation, R²; chart area: style number, empty cells, hidden data. Each change is one command.
- Select Data…: chart data range (re-derived with `recommendedChart`), Switch Row/Column, series list
  (Add / Edit / Remove / ▲▼, names from `previewChartData`), category labels, Hidden and Empty Cells.
  Range fields have a collapse button: the dialog shrinks to a bar and the grid selection fills the
  field (`=Sheet1!$C$2:$C$5`); OK sends `setChartSeries` (or `updateChart` when the hidden/empty
  options changed).
- Printing: the print area grows to the charts' bottom-right cells; each page carries the charts that
  intersect it as SVG at their place, cut at the page; the selection scope prints the charts that
  intersect the selection.
- Unsupported charts are drawn as the placeholder and are read-only (dialogs and pane disabled).

## Show (P8-24)

A chart on a slide is `ShapeKind::Chart(ChartShape)`:

- `chart`: the same `Chart` as Calc's. Its references point into the embedded sheet `Sheet1` the
  way PowerPoint lays it out: series names in row 1 from column B (`Sheet1!$B$1`), categories in
  column A from row 2 (`Sheet1!$A$2:$A$5`), the values of series *i* below its name
  (`Sheet1!$B$2:$B$5`). `ChartShape::canonicalize` rewrites them (and drops reference caches)
  whenever the data changes; references of charts read from files are kept as they are.
- `data: ChartData { categories: [text], series: [{name, values: [number | null], formatCode?}] }`:
  the literal table (there is no sheet). Series *i* of the chart shows table series *i* (by
  position). Resolution (`ChartData::resolve`, ported to `apps/show/src/charts/data.ts` so the
  editor, thumbnails, presenter, audience window and print draw synchronously): names from the
  table (a literal series name wins, empty → `Series<n>`), categories as typed, numeric categories
  become X values (scatter without them: 1, 2, …), the automatic title is the only series' name.
- `workbook`: the file's embedded `.xlsx` (raw bytes in the media store), written back verbatim
  while the data is unchanged; `None` → a workbook is generated with `fmt-xlsx` from the table on
  save (so PowerPoint's Edit Data works). A file workbook identical to the generated one is not
  kept. Editing the data drops it.

Commands: `insertChart {slide, kind, transform?, newId}` (PowerPoint's sample: three series ×
four categories "Category 1…4" / "Series 1…3" with 4.3/2.5/3.5/4.5, 2.4/4.4/1.8/2.8, 2/2/3/5;
scatter: one series "Y-Values" at X 0.7/1.8/2.6; pie/doughnut: the first series, vary-coloured;
title "Chart Title" for several series, legend at the bottom; combo is refused – the UI inserts a
column chart and changes its type), `setChartData {shape, data}` (Edit Data, Switch Row/Column =
the table transposed), `updateChart {shape, chart}` (every Chart Design / Format edit; the
references are canonicalized again). Unsupported charts are read-only.

Rendering on a slide: `layoutChart` with the presentation's theme colours, a transparent chart area
(`area: {fill: null, border: null}`, written as `c:spPr` with `a:noFill`) and text in the theme's
`tx1` tinted +0.35 (`textColor`), PowerPoint's look; painted with `drawChartScene` in a Konva
`Shape` (editor, thumbnails, presenter, audience window; print snapshots the stage).

Show UI (`apps/show/src/charts/`): Insert › Chart (type list, sub-type icons from the renderer, a
live preview on the sample data); while one chart is selected Chart Design (Add Chart Element ▾ as
one sectioned menu, Quick Layout ▾, Change Colors ▾, Chart Styles ▾, Switch Row/Column, Edit Data,
Change Chart Type) and Format (series picker, Format pane, Reset to Match Style, Shape Fill / Shape
Outline of that series). Edit Data is an in-app grid (row 1 series names, column A categories,
values elsewhere; Add Series / Add Category, × removes a column or row, Switch Row/Column; empty
rows/columns are dropped, text in value cells counts as blank). The Format pane offers Calc's
options grouped by section (chart: title, legend, style, empty cells; the picked series: fill,
line colour/width/dash, markers, smooth, secondary axis (combo), gap width/overlap, first slice
angle, hole size, vary colours, linear trendline; value and category axes: bounds, units, number
format, log scale, reverse, gridlines, hide; data labels: parts and position). `presets.ts` and
`format.ts` are copies of Calc's pure modules on the shared model (Calc's own files are untouched;
they can be switched to the shared copy later); the Calc pane itself is bound to Calc's store and
element selection, so Show has its own smaller pane.
