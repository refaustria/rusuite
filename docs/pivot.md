# Pivot tables (P8-30)

Backend of Calc's pivot tables: model (`model_sheet::pivot`), layout and computation
(`PivotTable::compute`), `GETPIVOTDATA` (`engine-formula`), xlsx parts (`fmt-xlsx`, see also
[`ooxml-subset.md`](ooxml-subset.md)) and the `calc-core` commands and requests. The UI (field pane,
ribbon, drawing) is P8-31; its contract is at the end. Behaviour follows Excel.

## Model

```
Workbook.pivot_caches: Vec<PivotCache>        Sheet: pivots: Vec<PivotTable>
PivotCache { id, source, fields: Vec<CacheField>, records: Vec<Vec<Item>>, refresh_on_load, stale, raw }
  source: Range { sheet (name), r0, c0, r1, c1 } | Table { name } | Name { name }
  CacheField { name, shared_items: Vec<Item>, kind: Number|Text|Date|Mixed, contains_blank, number_format }
  Item = Blank | Number | Text | Bool | Error(text)        (text compares ignoring case)
PivotTable { id, name, cache_id, location: PivotRect, rows, cols: Vec<AxisField>,
             filters: Vec<PageField>, values: Vec<DataField>, options: PivotOptions, raw }
  AxisField { field, sort: Ascending|Descending|Manual{order}, subtotals: Automatic|None|Custom{functions},
              show_all_items, collapsed_items, hidden_items, layout: Compact|Outline|Tabular }
  PageField { field, selected: All | Items{items} }
  DataField { field, name ("" = "Sum of X"), func, show_as, number_format }
    func: Sum Count(=COUNTA) Average Max Min Product CountNums StdDev StdDevP Var VarP
    show_as: Normal PercentOfTotal PercentOfRow PercentOfColumn PercentOfParent
             DifferenceFrom{base_field, base_item: Item{item}|Previous|Next} RunningTotal{base_field} Rank{base_field}
  PivotOptions { grand_total_rows (Excel rowGrandTotals: the Grand Total column), grand_total_cols
                 (colGrandTotals: the Grand Total row), row_headers_bold, col_headers_bold, banded,
                 style ("PivotStyleLight16"), values_in: Rows|Columns, values_position, empty_as,
                 error_as (None = show errors), repeat_labels, show_field_headers, compact_rows_indent }
```

- **Field and item indices.** Fields are indices into `PivotCache::fields` (= source columns). Items
  are indices into `CacheField::shared_items` (first-seen order). A refresh keeps the items of the
  fields that are still there and appends new ones; items that disappeared stay (Excel's "retain items
  deleted from the data source"), so `collapsed_items`, `hidden_items`, manual orders and page
  selections stay valid. Fields that disappear from the source leave the table.
- **Records** are the source rows at the last refresh; layout changes recompute from them (no refresh).
- **Cells.** The layout is written into the sheet as plain cells (values, number formats and the
  compact indent merged into the cell's own style), so rendering, printing, formulas and saving need
  nothing special. `SheetData.pivot_outputs` keeps the last layout (`PivotOutput`) for the cell roles.
  Cells of a pivot table are read-only for content edits (`Error::PivotCell`, code `pivot_cell`):
  typing, clearing, paste/fill into, cut from, merge, sort; row/column inserts and deletes cutting
  through a table. Formats may change.
- **Stale.** Editing the source does not update the table (as in Excel). `calc-core` marks caches
  whose source contains a changed cell `stale` (`WorkbookInfo.stalePivots`, patch `stalePivots`);
  `RefreshPivot` re-reads the source. Row/column inserts inside a source range grow it (stale);
  inserts above/left move it.
- **Sharing.** `CreatePivot` with the same source as an up-to-date cache shares that cache (Excel
  does); duplicated sheets copy their tables (new ids/names) sharing the caches.
- **Overlap.** Writing a layout refuses to overwrite cells with content or another table's cells
  (`Error::PivotOverlap { r0, c0, r1, c1 }` with the conflicting range, code `pivot_overlap`);
  nothing changes then. A shrinking table clears the cells it no longer covers (content and format).
- **Raw.** Tables/caches from files with features we do not model (calculated fields/items,
  grouped fields, label/value filters, OLAP, non-worksheet sources) keep their XML (`raw`) and their
  stored cells; they are read-only (updates fail with `invalid_pivot`) and written back verbatim.

## Layout rules (`PivotTable::compute`)

The table is anchored at `location`'s top-left cell. Page fields come first (one row each: field name,
then `(All)` / the item / `(Multiple Items)`), then one blank row, then the table.

- **Axes.** Rows and columns list their fields; with two or more data fields a `Σ Values` entry
  joins the axis of `values_in` at `values_position` (default last). Items of a field are those in the
  filtered records (page selections and hidden items of axis fields remove records everywhere) or,
  with `show_all_items`, every non-hidden item; ordered by the field's sort (ascending: numbers, text
  ignoring case, booleans, errors, `(blank)` last; descending keeps `(blank)` last; manual: listed items
  first).
- **Header.** With a real column field: a caption row (the data caption if there is one data field,
  `Column Labels` in compact form or the column field names otherwise), then one row per column
  entry. Without: one header row (the data caption over the data column). The last header row holds
  `Row Labels` (compact) or the row field names (outline/tabular) unless `show_field_headers` is off.
  Two data fields with no column field give a single header row (`Row Labels | Sum of A | Sum of B`).
- **Row labels.** Compact: an inner field shares its parent's column, indented by
  `compact_rows_indent` per level (written as the cell's indent). Outline and tabular: one column per
  field. Layout is per field; the table form for headers is the first row field's.
- **Subtotals.** A field gets subtotals when a further *field* lies inside it. Automatic subtotals sit
  on the item's own row in compact/outline form, in a row below the group in tabular form
  (`East Total`). Custom functions always go below (`East Sum`, `East Count`). With `Σ Values` inside
  the field, the parent row is blank and the subtotals go below per data field
  (`East Sum of Sales`). Column subtotals are columns after the group (`East Total`).
- **Tabular** puts an item on the row of its first inner item; `repeat_labels` repeats outer labels on
  every row (outline/tabular).
- **Collapsed** items show one row (or column) with the subtotal values.
- **Grand totals.** A `Grand Total` row (`grand_total_cols`) when a row field exists, a `Grand Total`
  column (`grand_total_rows`) when a column field exists; with `Σ Values` on that axis one line per
  data field (`Total Sum of Sales`).
- **Values.** Every value (subtotals and grand totals included) is computed from the source records
  of its row × column intersection (an Average subtotal is the average of the records, not of the
  averages). No records with data → empty (`empty_as`). Errors in the source propagate (`error_as`
  replaces them), except for Count/CountNums. Sum/Max/Min/Product of no numbers are 0, Average
  `#DIV/0!`, StdDev/Var need two numbers, StdDevP/VarP one.
- **Show as.** % of total / row total / column total / parent row total (fractions, default format
  `0.00%`); Difference From (cells whose key lacks the base field and the base item itself are blank;
  previous/next in the visible order); Running Total In (blank without the base field); Rank largest
  to smallest among the base field's items with the same other keys (ties share a rank).
- **Dates** are numbers with their field's date format (no automatic grouping); labels keep the
  number with that format.
- **Empty table** (no fields): an 18 × 3 placeholder block (Excel's A3:C20).
- Limit: 2 million cells; the table must fit on the sheet.

## GETPIVOTDATA

`GETPIVOTDATA(data_field, pivot_table, [field, item]...)`: `data_field` is the caption or the source
field name; `pivot_table` any cell of the table; the pairs must name exactly the row/column fields of a
visible value cell, in any order (page fields with one selected item may be named too); items match by
value or label (text ignoring case, numbers also by their text). Not shown (hidden subtotal, grand
total off, filtered item, empty cell) or no table → `#REF!`. The model registers each table's
visible values with the engine (`Engine::set_pivot_data`) whenever it renders; the function is
volatile. Generating `GETPIVOTDATA` formulas when the user points at a pivot cell while editing a
formula (Excel's "Generate GetPivotData") is a UI concern for P8-31: build
`=GETPIVOTDATA("<caption>",$A$3,"<field>","<item>",…)` from `pivotAt` (cell field/item) and `pivotInfo`.

## xlsx

Written: per cache `xl/pivotCache/pivotCacheDefinitionN.xml` (`cacheSource type="worksheet"` with
`worksheetSource ref sheet` or `name`; `cacheFields` with `sharedItems`: items for axis/page fields and
every non-numeric field, else only `containsSemiMixedTypes/containsString/containsNumber/containsInteger/
containsBlank/containsMixedTypes/containsDate/containsNonDate/minValue/maxValue/minDate/maxDate`;
`numFmtId`; `refreshOnLoad`) and `pivotCacheRecordsN.xml` (`<x v>` for itemized fields, else
`<n>/<s>/<b>/<e>/<m>/<d>`), related from the workbook (`<pivotCaches><pivotCache cacheId r:id>` after
`calcPr`); per table `xl/pivotTables/pivotTableN.xml` related from its sheet and to its cache:
`location` (`ref` without page fields, `firstHeaderRow`, `firstDataRow`, `firstDataCol`,
`rowPageCount`, `colPageCount`), `pivotFields` (`axis`, `dataField`, `showAll`, `compact`/`outline` per
layout, `sortType`, `defaultSubtotal`/`sumSubtotal`… , `multipleItemSelectionAllowed`, `items` in display
order with `h` (hidden), `sd="0"` (collapsed) and `t="default"`/function items, `x14:pivotField
fillDownLabels` for repeated labels), `rowFields`/`colFields` (`-2` = `Σ Values`), `rowItems`/`colItems`
(exactly our layout: `t="default"`, function types, `t="grand"`, `r` repeat counts, `i` data index, so
the file opens without a refresh), `pageFields` (`item` for a single selection), `dataFields` (`subtotal`,
`showDataAs`, `baseField`, `baseItem` (`1048828`/`1048829` = previous/next), `numFmtId`; `x14:dataField
pivotShowAs` for `percentOfParentRow` and `rankDescending`), `pivotTableStyleInfo`, table attributes
(`dataOnRows`, `dataPosition`, `rowGrandTotals`, `colGrandTotals`, `missingCaption`,
`showError`/`errorCaption`, `showHeaders`, `indent`, `compact`/`outline`, `updatedVersion="6"`).

Read: the same; the stored cells are kept and the definition attached (our layout supplies the cell
roles); a cache with `refreshOnLoad` is refreshed (cells rewritten). `rowItems`/`colItems` are ignored
(recomputed). Unsupported features (see Raw above) give one warning and keep the XML.

LibreOffice 25.2 opens the written files with the pivot tables recognized (`soffice --headless
--convert-to ods`; `content.xml` has `table:data-pilot-table`, and LibreOffice's recomputed values match
ours); the provisional reference workbooks come from `scripts/testdata-src/xlsx/pivot.py`.

## UI contract (calc-core, for P8-31)

Generated TypeScript in `apps/calc/src/generated/` (`PivotTable`, `PivotCache`, `AxisField`, `DataField`,
`PageField`, `PivotOptions`, `PivotSourceSpec`, `PivotTarget`, `PivotPatch`, `PivotInfo`, `PivotAt`,
`PivotItemInfo`, `PivotCellView`, `PivotSummary`, …). Optional model fields may be omitted.

Commands (`{"type":"apply","command":…}`), each one undo step:

| Command | Fields | Notes |
|---|---|---|
| `createPivot` | `source: {kind:"range",sheet,r0,c0,r1,c1} \| {kind:"name",name}`, `target: {kind:"cell",sheet,row,col} \| {kind:"newSheet"}`, `fields: {rows?, cols?, values?, filters?}` | a single-cell range = its current region; field indices = source columns; new sheet `Sheet<n>` before the source sheet, table at A3, patch `activateSheet` |
| `updatePivot` | `id`, `patch: {name?, rows?, cols?, values?, filters?, options?, layout?}` | lists replace an axis; `layout` = Report Layout for all row fields; recomputed from the cache |
| `refreshPivot` | `id` (`null` = all caches) | |
| `deletePivot` | `id` | clears the cells |
| `movePivot` | `id`, `target` | |
| `expandCollapse` | `id`, `field`, `item` (shared item, `null` = whole field), `collapsed` | |
| `setPageFilter` | `id`, `field`, `selected` (shared items, `null` = All) | the field must be a filter |

Errors: `invalid_pivot`, `unknown_pivot`, `pivot_overlap` (message names the cells), `pivot_cell`
(content edit inside a table).

Requests: `pivotInfo {id}` → `{type:"pivotInfo", info: {sheet, table, source, fields: [{index, name,
kind, items, area?: "rows"|"columns"|"filters", value?}], captions, stale?, readOnly?}}` (the field pane);
`pivotAt {sheet,row,col}` → `{pivot: {id, name, cell?: PivotCellView} | null}`; `pivotItems {id, field}` →
`{items: [{index, label, value, checked, collapsed?, hasData}]}` in display order (filter dropdowns:
`checked` = not hidden on an axis / selected on a page field).

Views: `CellView.pivot?: {id, kind, level, collapsed?, field?, item?}` with `kind` one of `header`,
`rowLabel`, `colLabel`, `value`, `subtotal`, `grandTotal`, `page`, `blank`; region snapshots list the
pivot cells of the region (blank ones too) and `pivots: PivotSummary[]` (`id, name, location, table,
style, banded, rowHeaders, colHeaders, stale?, readOnly?`). Drawing: header/subtotal/grand-total rows
per `PivotStyleLight16` (bold headers and totals, light-blue header band and lines), `−`/`+` buttons on
labels with `collapsed` set, dropdown buttons on `Row Labels`/`Column Labels` headers and `page`
cells. Patches: `pivotSheets` (refetch the region snapshot and an open `pivotInfo`), `stalePivots`
(e.g. a "Refresh" hint); `WorkbookInfo.stalePivots` on open.

## UI (P8-33, `apps/calc/src/pivot`)

- **Insert › Tables › PivotTable** opens Create PivotTable: Table/Range (the current region of the active
  cell, `Sheet1!$A$1:$D$7`, with the range picker that collapses the dialog; a defined name works too) and
  New Worksheet / Existing Worksheet + Location. OK sends `createPivot` with no fields, switches to the
  patch's `activateSheet` (or the target sheet), selects the table's first cell, opens the field pane and
  shows PivotTable Analyze. Recommended PivotTables and the data model are not offered.
- **PivotTable Fields pane** (right of the grid while a cell of a table is selected and Analyze › Field List
  is on): search box, the source fields with checkboxes (ticking: numbers → Values as Sum, everything else
  → Rows; unticking removes the field everywhere), the four areas Filters / Columns / Rows / Values with
  `Σ Values` on the axis of `valuesIn` at `valuesPosition` when two or more data fields exist. Entries are
  32 px rows dragged with pointer events (`elementFromPoint` finds the area, the row midpoints the index;
  a field is on one axis only, a data field dragged to an axis or an axis field dragged to Values moves,
  dropping outside the areas removes the entry). Each entry's ▾ menu: Move Up / Down / to Beginning / to
  End, Move to Report Filter / Row Labels / Column Labels / Values, Remove Field, Field Settings… or Value
  Field Settings…. Every change is one `updatePivot` with the changed lists (`model.ts` `patchOf`; options
  are always sent in full because the core replaces them); Defer Layout Update keeps a draft until Update.
- **Value Field Settings**: custom name (kept only when it differs from the default caption, so changing
  the function renames `Sum of Sales` → `Average of Sales`), Summarize Values By (the 11 functions), Show
  Values As (No Calculation, % of Grand / Column / Row / Parent Row Total, Difference From with base field
  and base item incl. (previous) / (next), Running Total In, Rank Largest to Smallest), Number Format
  (common codes or a custom code). **Field Settings**: subtotals Automatic / None / Custom (functions),
  Compact / Outline / Tabular for the field, Repeat item labels (the table option), Show items with no
  data (`showAllItems`). Insert blank line is not offered (no model support).
- **Grid**: the core writes plain cells; the grid draws the table style from `CellView.pivot` and the
  snapshot's `PivotSummary` (`styles.ts`): the header rows (above the first row label / value) get the
  style's header fill and bold text with a line under them, subtotal lines (subtotal values) are bold, a
  grand total line is bold with a line over it, the last row has a line under it, Banded Rows alternate
  the band fill, Row Headers make items with inner items bold. All 84 built-in styles (Light / Medium /
  Dark 1–28) are derived from the Office theme accents; unknown ids draw as Light16. The cell's own fill
  and font colour win. Compact indents (`alignment.indent`, 9 px per level, now drawn for every cell) and
  the −/+ buttons (items with `collapsed`; press → `expandCollapse`, double-click on the label toggles)
  shift the label; dropdown buttons sit on `Row Labels` / `Column Labels`, on field headers inside the
  table and on page cells (a funnel when filtered). An empty table shows Excel's placeholder box with
  the table's name and "To build a report, choose fields from the PivotTable Field List". Blank pivot
  cells stay in the view cache (they carry the look). `window.__calcPivotButtons` lists the last frame's
  buttons for the e2e tests.
- **Filter dropdown**: Select field (compact headers with several fields), Sort A to Z / Z to A (the
  field's `sort`), Clear Filter From, search, (Select All) and the items from `pivotItems` (items without
  data greyed) → `updatePivot` `hiddenItems` (while searching only the ticked results stay, as in
  Excel); page fields: (All) or one item, or Select Multiple Items → `setPageFilter`.
- **Read-only cells**: typing, F2, double-click and the formula bar refuse with "We can't change this part
  of a PivotTable." (the editor stays closed; the core's `pivot_cell` error shows the same text); Delete on
  a selection covering whole tables asks and sends `deletePivot` (plus a `clearRange` of the rest), on part
  of a table it is refused. Ctrl+A / Ctrl+Shift+* inside a table selects the table; Alt+↓ opens a header's
  dropdown.
- **PivotTable Analyze**: PivotTable Name, Options ▾ (PivotTable Options…: name, for error values / empty
  cells show, grand totals for rows / columns, repeat item labels, field headers; Generate GetPivotData,
  on by default), Active Field (the active cell's field or data caption, Field Settings… / Value Field
  Settings…, Expand / Collapse Field = `expandCollapse` with `item: null`), Refresh ▾ (Refresh, Refresh
  All = `refreshPivot` `null`), Change Data Source… (the core has no command: the table is recreated at its
  place with the same fields – `deletePivot` + `createPivot` in one compound – and its name and options
  are restored with a second `updatePivot`), Clear ▾ (Clear All, Clear Filters), Select ▾ (Labels, Values,
  Entire PivotTable), Move PivotTable…, Field List, +/- Buttons (a view setting), Field Headers. Group,
  Insert Slicer / Timeline, Fields, Items & Sets, OLAP tools, Relationships and PivotChart are not offered.
  **Design**: Subtotals ▾ (Do Not Show; Show at Top = automatic; Show at Bottom is disabled – the model has
  no position option), Grand Totals ▾ (the four choices), Report Layout ▾ (Compact / Outline / Tabular =
  `layout`, Repeat / Do Not Repeat All Item Labels), PivotTable Style Options (Row Headers, Column Headers,
  Banded Rows; Banded Columns disabled – no model option), PivotTable Styles gallery (84 previews, the id is
  stored in `options.style`). Blank Rows is not offered. The tabs come under "PivotTable Tools" and follow
  the active cell.
- **Autofit on update** (Excel's default): after a pivot command the columns of the written pivot cells
  widen to fit (bold text, indent, −/+ button and dropdown room; never narrower) – a second undo step.
- **Stale**: `WorkbookInfo.stalePivots` / patch `stalePivots` feed a status-bar hint ("1 PivotTable needs a
  refresh") and, on a sheet with a stale table, the yellow bar "Data changed – Refresh" whose button
  refreshes that sheet's stale tables.
- **GETPIVOTDATA**: while a formula is edited in point mode, a click on a value / subtotal / grand total cell
  inserts `GETPIVOTDATA("<caption>",$A$3,"<field>",<item>,…)` instead of the address (`model.ts`
  `pivotDataKey`: the labels of the cell's row in the label columns and of its column in the header rows; an
  outer item missing on the line comes from the nearest line before it with a label at that depth; a
  grand total line contributes nothing; a data caption on an axis names the data field; numeric items are
  written as numbers; another sheet's table gets the sheet prefix). Analyze › Options ▾ › Generate
  GetPivotData turns it off.
- The core does not send the grown style table with pivot patches (new number formats / indents): the store
  fetches `info` again when a patch or snapshot names an unknown style id.
- The fake backend (`dev/fakePivot.ts`) has a toy compact-form pivot (first column field only) for the unit
  tests and `?fake=1`.

Not yet (ideas): grouping dates/numbers, calculated fields, value/label filters, sort by value,
slicers, pivot charts, "Show Report Filter Pages", distinct count.

## Follow-ups (P8-35)

- **Subtotals at the bottom**: `AxisField::subtotal_bottom` puts an outer field's subtotal row below its
  group (tabular/outline layouts; `pivotField subtotalTop="0"`); PivotTable Design › Subtotals ›
  Show all Subtotals at Bottom / at Top of Group.
- **Banded columns**: `PivotOptions::banded_cols` (`pivotTableStyleInfo showColStripes`), Design ›
  Banded Columns.
- **Change Data Source**: `ChangePivotSource { id, source }` keeps the fields whose names still exist
  (the cache is rebuilt; missing fields are dropped from the areas), undoable.
- **Table sources**: a pivot source may be a table name (`Table1`): it follows the table's size
  (`worksheetSource name="Table1"`); Table Design › Summarize with PivotTable starts from it.
- **Show Details**: double-clicking a value cell (or `ShowPivotDetails`) adds a sheet with the source
  records behind it (header row + matching rows, as a table), like Excel's drill-down.
