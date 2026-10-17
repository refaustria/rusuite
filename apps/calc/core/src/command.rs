//! [`CalcCommand`]: every edit the UI can send (ADR 0002 §1).
//!
//! Coordinates are 0-based; sheets are identified by their id (see
//! [`SheetInfo`](crate::SheetInfo)); ranges are inclusive
//! (`r0..=r1`, `c0..=c1`, `r0 <= r1`, `c0 <= c1`).

use core_model::chart::{Chart, DataRef, Series};
use core_model::Color;
use model_sheet::{
    AutoFilter, CellStyle, CfRule, ChartAnchor, ChartObject, DataValidation, Filter, SheetFormat,
    SheetView, SortKey, SortState,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::patch::{ColView, RowView};

/// A document edit. JSON: `{"type":"setInput","sheet":0,"row":0,"col":0,"input":"=A2"}`.
///
/// The variants marked *Internal* (from `RestoreFilterState` on) are internal:
/// the document produces them as inverses for undo/redo. They are
/// serializable (the undo stack holds commands) but the UI never needs to
/// send them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CalcCommand {
    /// Sets a cell from user input (`""` clears it, `=` starts a formula,
    /// `'` forces text).
    SetInput {
        sheet: u32,
        row: u32,
        col: u32,
        input: String,
    },
    /// Clears the contents of a range ("Delete" key); styles are kept.
    ClearRange {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Merges `patch` into the effective style of every cell of the range
    /// (only the parts present in `patch` change).
    ApplyStyle {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        #[ts(as = "crate::wire::CellStyle")]
        patch: CellStyle,
    },
    /// Format Cells › Border: edits the edges of the range like Excel
    /// (`top` / `bottom` / `left` / `right` = the outline, `insideHorizontal`
    /// / `insideVertical` = the lines between the range's cells, diagonals
    /// in every cell). Absent edges stay; `{"kind":"none"}` removes a line.
    /// An edited outline edge also clears the facing side of the cells
    /// beside the range (Excel draws one line per edge), in the same undo
    /// step.
    SetBorders {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        edits: BorderEdits,
    },
    /// Column width in character units; `null` = sheet default.
    SetColWidth {
        sheet: u32,
        col: u32,
        width: Option<f64>,
    },
    /// Row height in points; `null` = sheet default.
    SetRowHeight {
        sheet: u32,
        row: u32,
        height: Option<f64>,
    },
    SetColHidden {
        sheet: u32,
        col: u32,
        hidden: bool,
    },
    SetRowHidden {
        sheet: u32,
        row: u32,
        hidden: bool,
    },
    /// Inserts `count` rows before row `at`.
    InsertRows {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Deletes rows `at..at + count`.
    DeleteRows {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Inserts `count` columns before column `at`.
    InsertCols {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Deletes columns `at..at + count`.
    DeleteCols {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Excel's Insert Cells (Home › Insert ▾ › Insert Cells…, Ctrl++):
    /// empty cells take the place of the range; the cells at and right of
    /// it (`right`, same rows) or at and below it (`down`, same columns)
    /// move along, and references follow. A range spanning every row /
    /// column inserts whole columns / rows. Refused (`shift_merged`,
    /// `shift_table`, `pivot_cell`) where Excel refuses. Undo is the
    /// matching [`DeleteCells`](Self::DeleteCells).
    InsertCells {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        shift: InsertShift,
    },
    /// Excel's Delete Cells: removes the range; the cells right of it
    /// (`left`) or below it (`up`) move into its place. References into
    /// it become `#REF!`.
    DeleteCells {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        shift: DeleteShift,
    },
    /// Adds an empty sheet at position `index` of the sheet order (absent:
    /// last). Undo deletes it; redo brings back the same sheet id.
    AddSheet {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        index: Option<u32>,
    },
    RenameSheet {
        sheet: u32,
        name: String,
    },
    /// Deletes a sheet (not the last one): references to it in the other
    /// sheets become `#REF!`. Undo restores the sheet (same id and
    /// position) with its contents, styles, dimensions, format and tab
    /// colour, and the original text of the rewritten formulas.
    DeleteSheet {
        sheet: u32,
    },
    /// Copies a sheet (contents, formulas, styles, dimensions, tab colour)
    /// to a new sheet `name` right after it, or at position `index` of the
    /// sheet order (Move or Copy › Create a copy); the copy's references
    /// to its source sheet point at the copy.
    DuplicateSheet {
        sheet: u32,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        index: Option<u32>,
    },
    /// Moves a sheet to position `index` of the sheet order (0 = first).
    MoveSheet {
        sheet: u32,
        index: u32,
    },
    /// Sets the tab colour; `null` = default.
    SetSheetTabColor {
        sheet: u32,
        #[ts(as = "Option<app_common::wire::Color>")]
        color: Option<Color>,
    },
    /// Freezes rows `0..rows` and columns `0..cols` (`0, 0` unfreezes).
    /// The sheet list in the patch carries the new view.
    SetFreeze {
        sheet: u32,
        rows: u32,
        cols: u32,
    },
    /// Changes the listed view settings (zoom 10..=400).
    SetSheetView {
        sheet: u32,
        patch: SheetViewPatch,
    },
    /// Hides or shows a sheet. Hiding the last visible sheet fails with
    /// `last_visible_sheet`. The patch carries the sheet list and
    /// `activateSheet`. `veryHidden` (with `hidden`) is Excel's
    /// "very hidden" state; the UI never needs to send it.
    SetSheetHidden {
        sheet: u32,
        hidden: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        very_hidden: Option<bool>,
    },
    /// Merges the range (at least two cells): only the top-left cell keeps
    /// its content, the others are cleared (styles stay); merges lying
    /// inside the range are absorbed, one sticking out fails with
    /// `merge_overlap`. Undo restores the cleared contents.
    MergeCells {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Removes every merge that intersects the range.
    UnmergeCells {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Pastes a copied block at `(r0, c0)` of `sheet` as one undo step.
    ///
    /// `src` is the copied range: its size is the block size, its top-left
    /// the origin of the paste offset. `cells` are the block's non-empty
    /// cells (`dr`/`dc` relative to `src`); block positions without a cell
    /// are pasted as blanks. The block is repeated `repeat_rows ×
    /// repeat_cols` times (Excel fills a selection that is a multiple of
    /// the block). Formulas are shifted by the offset of each pasted copy
    /// (relative parts move, `$` parts stay), except for a `cut`, which
    /// moves the cells: formulas keep their text and the source cells not
    /// overwritten are cleared (contents and formats). References to the
    /// moved cells, in the moved formulas and anywhere in the workbook,
    /// follow them (undo restores the original formula texts).
    PasteRange {
        sheet: u32,
        r0: u32,
        c0: u32,
        src: SheetRect,
        cells: Vec<ClipCell>,
        mode: PasteMode,
        cut: bool,
        repeat_rows: u32,
        repeat_cols: u32,
        /// A paste of our own copy (mode `all`): a cut moves the notes,
        /// threads and hyperlinks of `src`, a copy copies its notes and
        /// hyperlinks. Absent = false (text from another program).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        annotations: bool,
        /// Paste Special (absent: `mode` alone decides).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        special: Option<PasteSpecial>,
    },
    /// The fill handle: fills `dst` (adjacent to `src`: below, above, to
    /// the right or to the left, spanning the same columns/rows) from
    /// `src`, line by line, as one undo step. See [`FillMode`].
    FillRange {
        sheet: u32,
        src: Rect,
        dst: Rect,
        mode: FillMode,
    },
    /// Sorts the rows of the range by `keys` (absolute columns inside the
    /// range, most significant first), stably, in Excel's order: numbers
    /// < text < logical < errors, blanks last in both directions; text
    /// case-insensitive unless `caseSensitive` (then lowercase first).
    /// `hasHeader` keeps the first row in place. Contents and cell
    /// formats move with their rows (row heights and hidden rows stay);
    /// moved formulas are adjusted by their row offset like a copy.
    /// Fails with `cannot_sort_merged` when the range intersects merged
    /// cells. The sheet list in the patch carries the new `sortState`.
    SortRange {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        #[ts(as = "Vec<crate::wire::SortKey>")]
        keys: Vec<SortKey>,
        has_header: bool,
        case_sensitive: bool,
    },
    /// "Sort A to Z / Z to A" from a single cell: sorts by column `col`
    /// the AutoFilter range when `(row, col)` lies inside it (header
    /// kept), else the current region around the cell (blank rows and
    /// columns bound it), keeping a first row that looks like a header
    /// (all text, above non-text or differently formatted cells).
    SortSheetByColumn {
        sheet: u32,
        row: u32,
        col: u32,
        ascending: bool,
    },
    /// Turns the AutoFilter on for `range` (a single cell: its current
    /// region) or off (`null`), showing the rows a previous filter hid.
    /// The sheet list in the patch carries `autoFilter`.
    SetAutoFilter {
        sheet: u32,
        range: Option<Rect>,
    },
    /// Sets (or with `null` removes) the filter of AutoFilter column `col`
    /// (absolute index) and applies all filters: failing data rows are
    /// hidden as `filtered`, filtered rows that pass are shown; rows hidden
    /// by hand stay hidden. Fails with `no_auto_filter` without an
    /// AutoFilter and `invalid_range` for a column outside it.
    SetFilterColumn {
        sheet: u32,
        col: u32,
        #[ts(as = "Option<crate::wire::Filter>")]
        filter: Option<Filter>,
    },
    /// Removes every column filter (the dropdowns stay) and shows the
    /// filtered rows.
    ClearFilters {
        sheet: u32,
    },
    /// Applies the filters again to the current data (Excel's "Reapply";
    /// filters are not re-applied on edits).
    ReapplyFilter {
        sheet: u32,
    },
    /// Adds a conditional formatting rule at position `rule.priority` (1 or
    /// 0 = top, as Excel adds new rules); `rule.id` 0 = assign a new id.
    /// Formulas are written for the top-left cell of the ranges' bounding
    /// box. Fails with `invalid_rule` for a malformed rule. The patch lists
    /// the sheet in `cfSheets`.
    AddCfRule {
        sheet: u32,
        #[ts(as = "crate::wire_cf::CfRule")]
        rule: CfRule,
    },
    /// Replaces the rule with `rule.id` (`unknown_rule` if there is none),
    /// moving it to `rule.priority` (0 = keep its position).
    UpdateCfRule {
        sheet: u32,
        #[ts(as = "crate::wire_cf::CfRule")]
        rule: CfRule,
    },
    RemoveCfRule {
        sheet: u32,
        id: u32,
    },
    /// Moves rule `id` to `priority` (1 = top, clamped to the end).
    ReorderCfRule {
        sheet: u32,
        id: u32,
        priority: u32,
    },
    /// Removes the range from every rule of the sheet (rules left without
    /// cells disappear); `null` = all rules of the sheet.
    ClearCf {
        sheet: u32,
        range: Option<Rect>,
    },
    /// Sets a data validation on its ranges, replacing the validation of
    /// those cells (one per cell, as in Excel).
    SetValidation {
        sheet: u32,
        #[ts(as = "crate::wire_cf::DataValidation")]
        validation: DataValidation,
    },
    /// Removes the validation of every cell of the range.
    RemoveValidation {
        sheet: u32,
        range: Rect,
    },
    /// Adds a chart in front of the others on `sheet` (build `chart` with
    /// the `recommendedChart` request for a selection). `id` absent or 0 =
    /// a new id; `name` absent = `"Chart <id>"`. Fails with
    /// `invalid_chart` for a malformed chart or anchor. The patch lists the
    /// sheet in `chartSheets`.
    AddChart {
        sheet: u32,
        #[ts(as = "crate::wire_chart::ChartAnchor")]
        anchor: ChartAnchor,
        #[ts(as = "crate::wire_chart::Chart")]
        chart: Chart,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        id: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
    },
    /// Replaces chart `id` (everything but its anchor and name); fails
    /// with `unknown_chart` / `invalid_chart` (also for unsupported chart
    /// types, which are read-only).
    UpdateChart {
        sheet: u32,
        id: u32,
        #[ts(as = "crate::wire_chart::Chart")]
        chart: Chart,
    },
    /// Moves/resizes chart `id`.
    SetChartAnchor {
        sheet: u32,
        id: u32,
        #[ts(as = "crate::wire_chart::ChartAnchor")]
        anchor: ChartAnchor,
    },
    /// Replaces the data of chart `id`: its series and shared categories
    /// (the "Select Data" dialog).
    SetChartSeries {
        sheet: u32,
        id: u32,
        #[ts(as = "Vec<crate::wire_chart::Series>")]
        series: Vec<Series>,
        #[ts(as = "Option<crate::wire_chart::DataRef>")]
        categories: Option<DataRef>,
    },
    RemoveChart {
        sheet: u32,
        id: u32,
    },
    /// Defines a name (`def.sheet` absent = workbook scope). Fails with
    /// `invalid_name`, `duplicate_name` (any case, same scope) or
    /// `invalid_formula`. Formulas using the name recalculate; the patch
    /// carries `names`.
    DefineName {
        def: crate::names::NameDef,
    },
    /// Replaces the name `name` (scope `sheet`) by `def` – a new spelling,
    /// scope, definition or comment – keeping its place in the list.
    UpdateName {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sheet: Option<u32>,
        def: crate::names::NameDef,
    },
    /// Deletes a name; formulas using it show `#NAME?`.
    DeleteName {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sheet: Option<u32>,
    },
    /// Excel's Create Names from Selection: names from the texts of the
    /// selection's top row / left column / bottom row / right column for
    /// the cells beside them (workbook scope; an existing name of the same
    /// spelling is redefined). Fails with `no_names` when no label gives a
    /// name.
    CreateNamesFromSelection {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        edges: crate::names::NameEdges,
    },
    /// Adds or edits the note of a cell (Shift+F2). `author` and the
    /// absent `visible`/`bounds` keep their old values on an existing
    /// note (new notes: hidden, default box). The patch lists the sheet's
    /// annotations in `annotations` and the cell (its `note` flag).
    SetNote {
        sheet: u32,
        row: u32,
        col: u32,
        #[ts(as = "Vec<crate::wire_annot::NoteRun>")]
        text: Vec<model_sheet::NoteRun>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        author: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        visible: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<crate::wire_annot::NoteBounds>")]
        bounds: Option<model_sheet::NoteBounds>,
    },
    /// Deletes the notes of the range.
    DeleteNote {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Shows (always visible) or hides the note of the cell; `visible`
    /// absent = toggle. Fails with `invalid_annotation` without a note.
    ShowHideNote {
        sheet: u32,
        row: u32,
        col: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        visible: Option<bool>,
    },
    /// Excel's Convert to Comments: every note of the sheet becomes a
    /// thread (the note's author, else `author`; the text without the
    /// leading `Author:` line). Cells that already have a thread keep
    /// their note.
    ConvertNotesToComments {
        sheet: u32,
        #[ts(as = "crate::wire_annot::Person")]
        author: model_sheet::Person,
        date: String,
    },
    /// Starts a thread on the cell (the UI supplies author and date; the
    /// id is generated). Fails with `invalid_annotation` when the cell
    /// already has one (reply instead).
    AddComment {
        sheet: u32,
        row: u32,
        col: u32,
        text: String,
        #[ts(as = "crate::wire_annot::Person")]
        author: model_sheet::Person,
        date: String,
    },
    /// Adds a reply to the cell's thread.
    ReplyComment {
        sheet: u32,
        row: u32,
        col: u32,
        text: String,
        #[ts(as = "crate::wire_annot::Person")]
        author: model_sheet::Person,
        date: String,
    },
    /// Replaces the text of the thread's first comment or of a reply
    /// (`id`).
    EditComment {
        sheet: u32,
        row: u32,
        col: u32,
        id: String,
        text: String,
    },
    /// Deletes one reply of the cell's thread.
    DeleteReply {
        sheet: u32,
        row: u32,
        col: u32,
        id: String,
    },
    /// Deletes the threads of the range (Review › Delete).
    DeleteThread {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Resolves (`true`) or reopens (`false`) the cell's thread.
    ResolveThread {
        sheet: u32,
        row: u32,
        col: u32,
        resolved: bool,
    },
    /// Records the current user as a document person (the UI keeps the
    /// name in local storage, ADR 0009); the patch carries `persons`.
    SetUser {
        name: String,
        initials: String,
    },
    /// Sets a hyperlink on the range (replacing the links it intersects)
    /// and gives its cells the Hyperlink style (theme hyperlink colour,
    /// single underline). `text` (Text to Display) is written into the
    /// top-left cell when present and different from its input.
    SetHyperlink {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        #[ts(as = "crate::wire_annot::LinkTarget")]
        target: model_sheet::LinkTarget,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        tooltip: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        text: Option<String>,
    },
    /// Removes the hyperlinks intersecting the range (Excel's Clear
    /// Hyperlinks: the cell formats stay).
    RemoveHyperlink {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Creates a pivot table (Insert › PivotTable): a cache of `source`
    /// (a single cell: its current region; the first row holds the field
    /// names) and a table at `target` with the initial `fields` (indices
    /// are source columns, 0 = first). A new sheet is inserted before the
    /// source sheet with the table at A3 (the patch's `activateSheet`).
    /// Fails with `invalid_pivot` (empty header cell, bad field) or
    /// `pivot_overlap` (cells with content in the way). The patch lists
    /// the sheet in `pivotSheets`.
    CreatePivot {
        source: crate::pivots::PivotSourceSpec,
        target: crate::pivots::PivotTarget,
        #[ts(as = "crate::wire_pivot::PivotFields")]
        fields: model_sheet::pivot::PivotFields,
    },
    /// Changes the fields, options or layout of pivot table `id` and
    /// rewrites it (from its cache: no refresh). `pivot_overlap` when the
    /// new layout would overwrite cells.
    UpdatePivot {
        id: u32,
        patch: crate::pivots::PivotPatch,
    },
    /// Re-reads the source of pivot table `id` (`null` = every cache) and
    /// rewrites the tables using it (Excel's Refresh / Refresh All).
    RefreshPivot {
        #[serde(default)]
        id: Option<u32>,
    },
    /// Deletes pivot table `id` and clears its cells.
    DeletePivot {
        id: u32,
    },
    /// Moves pivot table `id` (Move PivotTable).
    MovePivot {
        id: u32,
        target: crate::pivots::PivotTarget,
    },
    /// Collapses (`−`) or expands (`+`) an item of row/column field
    /// `field` (a shared item index; `null` = every item of the field).
    ExpandCollapse {
        id: u32,
        field: u32,
        #[serde(default)]
        item: Option<u32>,
        collapsed: bool,
    },
    /// Sets the selection of page (filter) field `field`: shared item
    /// indices, `null` = (All).
    SetPageFilter {
        id: u32,
        field: u32,
        #[serde(default)]
        selected: Option<Vec<u32>>,
    },
    /// Changes the source of pivot table `id` (Change Data Source) and
    /// refreshes it; fields that no longer exist leave the table.
    ChangePivotSource {
        id: u32,
        source: crate::pivots::PivotSourceSpec,
    },
    /// Show Details (double-click on a value): a new sheet before the
    /// pivot table's sheet with the source records behind the value cell
    /// `(row, col)` of pivot table `id` (header row, then the records).
    /// The patch carries `activateSheet`.
    ShowPivotDetails {
        id: u32,
        row: u32,
        col: u32,
    },
    /// Insert › Table (Ctrl+T): a table on the range (a single cell: its
    /// current region). `hasHeaders` false inserts a header row above the
    /// range (`Column1`, `Column2`, …; the data moves down one row). The
    /// header cells become unique texts. Fails with `invalid_table` over
    /// merged cells, another table or a pivot table. Default style
    /// `TableStyleMedium2` (or `style`), banded rows, filter buttons; an
    /// AutoFilter of the sheet on the range is taken over. The sheet list
    /// in the patch carries the tables.
    CreateTable {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        has_headers: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        style: Option<String>,
    },
    /// Renames table `id`; formulas follow (`invalid_table` for an invalid
    /// or taken name).
    RenameTable {
        id: u32,
        name: String,
    },
    /// Table Styles gallery (`style`, `""` = none) and Table Style Options
    /// (`look`); absent fields stay.
    SetTableStyle {
        id: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        style: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<crate::wire_tables::TableLook>")]
        look: Option<model_sheet::TableLook>,
    },
    /// Header Row / Total Row / Filter Button of the Table Design tab.
    /// Turning the totals row on adds a row below the data (shifting the
    /// cells below the table down when they are not empty) with `Total`
    /// in the first column and a `SUBTOTAL` in the last (sum of numbers,
    /// else count), or the totals kept from before; off clears that row.
    /// Turning the header row off clears the header cells (the names
    /// stay); on writes them back (shifting cells above down if needed).
    SetTableOptions {
        id: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        header_row: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        totals_row: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        filter_button: Option<bool>,
    },
    /// The totals row dropdown of column `col` (sheet column): a
    /// function (`=SUBTOTAL(109,[Qty])`), a label, a custom formula or
    /// none (`null`); the totals cell is rewritten.
    SetTotalsFunction {
        id: u32,
        col: u32,
        #[ts(as = "Option<crate::wire_tables::TotalsCell>")]
        totals: Option<model_sheet::TotalsCell>,
    },
    /// Resize Table: the header row must stay in its row and the new
    /// range overlap the old one; new columns get names from their header
    /// cells (or `Column<n>`), new rows the calculated columns' formulas.
    ResizeTable {
        id: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Convert to Range: structured references to the table become A1
    /// references and the table disappears; `formats` (the table style's
    /// look, computed by the UI) are applied to the cells.
    ConvertToRange {
        id: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<RangeFormat>>")]
        formats: Vec<RangeFormat>,
    },
    /// Insert Table Rows Above: `count` rows before sheet row `at` (a
    /// data row, or `r1 + 1` below the data) inside the table's columns;
    /// the cells below in those columns shift down. New rows get the
    /// calculated columns' formulas.
    InsertTableRows {
        id: u32,
        at: u32,
        count: u32,
    },
    /// Delete Table Rows `at..at + count` (data rows); the cells below in
    /// the table's columns shift up.
    DeleteTableRows {
        id: u32,
        at: u32,
        count: u32,
    },
    /// Insert Table Columns to the Left of sheet column `at` (or `c1 + 1`):
    /// the cells right of it in the table's rows shift right.
    InsertTableCols {
        id: u32,
        at: u32,
        count: u32,
    },
    /// Delete Table Columns `at..at + count`; the cells right of them in
    /// the table's rows shift left. Formulas using them show `#REF!`.
    DeleteTableCols {
        id: u32,
        at: u32,
        count: u32,
    },
    /// The filter dropdown of a table header (`null` removes the column's
    /// filter); the table's filters are applied.
    SetTableFilter {
        id: u32,
        col: u32,
        #[ts(as = "Option<crate::wire::Filter>")]
        filter: Option<model_sheet::Filter>,
    },
    /// Insert › Slicer (Insert Slicers dialog): one slicer per source
    /// (table columns, or pivot cache fields connected to the pivot
    /// tables listed in the source), cascading from `anchor` on `sheet`.
    InsertSlicers {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_data::SlicerSource>")]
        sources: Vec<model_sheet::SlicerSource>,
        #[ts(as = "crate::wire_chart::ChartAnchor")]
        anchor: ChartAnchor,
    },
    /// Clicks on a slicer: only the `selected` items (displayed values)
    /// pass the filter; `null` = Clear Filter. Table slicers set the
    /// table's value filter on the column; pivot slicers filter every
    /// connected pivot table.
    SetSlicerSelection {
        cache: String,
        #[serde(default)]
        #[ts(optional)]
        selected: Option<Vec<String>>,
    },
    /// The Slicer tab / Slicer Settings / move and resize of slicer `id`;
    /// absent fields stay (`sort` is the cache's item order).
    UpdateSlicer {
        id: u32,
        patch: SlicerPatch,
    },
    /// Deletes slicer `id`; its cache goes with the last slicer showing
    /// it, and so does its filter.
    DeleteSlicer {
        id: u32,
    },
    /// Report Connections: the pivot tables (of the same cache) the
    /// slicer cache `cache` filters.
    SetSlicerConnections {
        cache: String,
        pivots: Vec<u32>,
    },
    /// Custom table styles (New / Modify / Duplicate / Delete Table
    /// Style, Set As Default): replaces the list and the default style.
    /// `renamed` (old → new name) re-points the tables of a renamed
    /// style; tables using a deleted style get the default style.
    SetTableStyles {
        #[ts(as = "crate::wire_data::TableStyles")]
        styles: model_sheet::TableStyles,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<StyleRename>>")]
        renamed: Vec<StyleRename>,
    },
    /// Data › Remove Duplicates on the range (a single cell: its current
    /// region, or the table it is in): rows whose values in `columns`
    /// (sheet columns) repeat an earlier row are removed (text ignoring
    /// case), the remaining rows move up inside the range. The patch's
    /// `duplicates` carries the counts.
    RemoveDuplicates {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        columns: Vec<u32>,
        has_header: bool,
    },
    /// Data › Text to Columns on cells `r0..=r1` of column `c0`: the texts
    /// are split with `options` and written from `dest` (absent: the
    /// cells themselves) rightwards.
    TextToColumns {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        #[ts(as = "crate::wire_tables::TextImportOptions")]
        options: model_sheet::textio::TextImportOptions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        dest: Option<(u32, u32)>,
    },
    /// Data › Group (`ungroup` false) / Ungroup of rows or columns
    /// `i0..=i1`.
    GroupOutline {
        sheet: u32,
        #[ts(as = "crate::wire_tables::LineAxis")]
        axis: model_sheet::Axis,
        i0: u32,
        i1: u32,
        ungroup: bool,
    },
    /// The `−` / `+` button of the outline bar on summary line `index`.
    SetOutlineCollapsed {
        sheet: u32,
        #[ts(as = "crate::wire_tables::LineAxis")]
        axis: model_sheet::Axis,
        index: u32,
        collapsed: bool,
    },
    /// The level buttons `1..=8` of the outline bar.
    ShowOutlineLevel {
        sheet: u32,
        #[ts(as = "crate::wire_tables::LineAxis")]
        axis: model_sheet::Axis,
        level: u8,
    },
    /// Ungroup › Clear Outline (`axis` absent = both).
    ClearOutline {
        sheet: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<crate::wire_tables::LineAxis>")]
        axis: Option<model_sheet::Axis>,
    },
    /// Outline settings (summary rows below, summary columns right).
    SetOutlineProps {
        sheet: u32,
        #[ts(as = "crate::wire_tables::OutlineProps")]
        props: model_sheet::OutlineProps,
    },
    /// Data › Group › Auto Outline on the range (a single cell: the used
    /// range): rows and columns grouped under the formulas that summarize
    /// them (see `Workbook::auto_outline_plan`); the outline inside the
    /// range is replaced.
    AutoOutline {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Data › Consolidate at `(row, col)` of `sheet`: the `sources`
    /// combined with `function`, by position or by labels in their top
    /// row / left column; `links` writes formulas referring to the
    /// sources. The destination is named `Consolidate_Area`.
    Consolidate {
        sheet: u32,
        row: u32,
        col: u32,
        #[ts(as = "crate::wire_data::ConsolidateFunction")]
        function: model_sheet::ConsolidateFunction,
        sources: Vec<SheetRect>,
        top_row: bool,
        left_col: bool,
        links: bool,
    },
    /// Data › Flash Fill (Ctrl+E): the suggested values of column `col`
    /// (as typed: constants), one undo step.
    FlashFill {
        sheet: u32,
        col: u32,
        cells: Vec<FlashCell>,
    },
    /// Data › Subtotal on the range (header row first): at each change in
    /// sheet column `groupBy`, a row with `SUBTOTAL(function, …)` of the
    /// `columns` and the label `<item> Total`, then a `Grand Total` row;
    /// the rows are grouped (details level 2, subtotals level 1).
    /// `replace` removes earlier subtotals first.
    Subtotal {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        group_by: u32,
        function: SubtotalFunction,
        columns: Vec<u32>,
        replace: bool,
        summary_below: bool,
    },
    /// Subtotal › Remove All: deletes the subtotal rows of the range and
    /// its row outline.
    RemoveSubtotals {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Replaces the manual page breaks of `sheet` on `axis` (Page Layout ›
    /// Breaks, dragging in Page Break Preview).
    SetPageBreaks {
        sheet: u32,
        #[ts(as = "crate::wire_tables::LineAxis")]
        axis: model_sheet::Axis,
        breaks: Vec<u32>,
    },
    /// Insert › Pictures: adds a picture in front (id 0 = new id). The
    /// patch lists the sheet in `pictureSheets`.
    AddPicture {
        sheet: u32,
        #[ts(as = "crate::wire_tables::Picture")]
        picture: model_sheet::Picture,
    },
    /// Moves / resizes picture `id`.
    SetPictureAnchor {
        sheet: u32,
        id: u32,
        #[ts(as = "crate::wire_chart::ChartAnchor")]
        anchor: ChartAnchor,
    },
    RemovePicture {
        sheet: u32,
        id: u32,
    },
    /// Review › Protect Sheet…: protects the sheet with `options` (their
    /// password fields are ignored) and `password` (absent or empty: no
    /// password), hashed as Excel does (SHA-512, 100000 spins) with
    /// `salt` (standard base64 of 16 random bytes from the UI; absent: a
    /// salt derived from the password). Then only unlocked cells can be
    /// changed and only the actions the options allow (they keep the
    /// `.xlsx` meaning: `true` = not allowed); everything else fails with
    /// `sheet_protected`.
    ProtectSheet {
        sheet: u32,
        #[ts(as = "crate::wire::SheetProtection")]
        options: model_sheet::SheetProtection,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        password: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        salt: Option<String>,
    },
    /// Review › Unprotect Sheet: `wrong_password` (Excel's message) when
    /// the sheet has a password and `password` does not match.
    UnprotectSheet {
        sheet: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        password: Option<String>,
    },
    /// Review › Protect Workbook…: locks the structure (sheets cannot be
    /// added, deleted, renamed, moved, copied, hidden, unhidden or
    /// recoloured: `workbook_protected`) and/or the windows. Password and
    /// salt as for [`ProtectSheet`](Self::ProtectSheet).
    ProtectWorkbook {
        structure: bool,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        windows: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        password: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        salt: Option<String>,
    },
    /// Removes the workbook protection (`wrong_password` as for
    /// [`UnprotectSheet`](Self::UnprotectSheet)).
    UnprotectWorkbook {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        password: Option<String>,
    },
    /// *Internal.* Replaces the sheet's protection (hashes as stored).
    RestoreSheetProtection {
        sheet: u32,
        #[ts(as = "Option<crate::wire::SheetProtection>")]
        protection: Option<model_sheet::SheetProtection>,
    },
    /// *Internal.* Replaces the workbook protection.
    RestoreWorkbookProtection {
        #[ts(as = "Option<crate::wire::WorkbookProtection>")]
        protection: Option<model_sheet::WorkbookProtection>,
    },
    /// *Internal.* Replaces the pictures of a sheet.
    RestorePictures {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_tables::Picture>")]
        pictures: Vec<model_sheet::Picture>,
    },
    /// *Internal.* Replaces the tables of a sheet (no cells are written).
    RestoreTables {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_tables::Table>")]
        tables: Vec<model_sheet::Table>,
    },
    /// *Internal.* Renames column `index` of table `id` and rewrites the
    /// structured references to it (the header cell is not written).
    RenameTableColumn {
        id: u32,
        index: u32,
        name: String,
    },
    /// *Internal.* Replaces every slicer cache and slicer (no filters
    /// are applied).
    RestoreSlicers {
        #[ts(as = "Vec<crate::wire_data::SlicerCache>")]
        caches: Vec<model_sheet::SlicerCache>,
        sheets: Vec<crate::slicers::SheetSlicers>,
    },
    /// *Internal.* Replaces every pivot cache and table (no cells are
    /// written).
    RestorePivots {
        #[ts(as = "Vec<crate::wire_pivot::PivotCache>")]
        caches: Vec<model_sheet::pivot::PivotCache>,
        sheets: Vec<crate::pivots::SheetPivots>,
    },
    /// *Internal.* Replaces the notes, threads and hyperlinks of a sheet
    /// (a deleted sheet with empty lists is a no-op).
    RestoreAnnotations {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_annot::Note>")]
        notes: Vec<model_sheet::Note>,
        #[ts(as = "Vec<crate::wire_annot::Thread>")]
        threads: Vec<model_sheet::Thread>,
        #[ts(as = "Vec<crate::wire_annot::Hyperlink>")]
        hyperlinks: Vec<model_sheet::Hyperlink>,
    },
    /// *Internal.* Replaces the document's person list.
    RestorePersons {
        #[ts(as = "Vec<crate::wire_annot::Person>")]
        persons: Vec<model_sheet::Person>,
    },
    /// *Internal.* Replaces every defined name (the undo of the name
    /// commands and of edits that rewrote names).
    RestoreNames {
        names: Vec<crate::names::NameDef>,
    },
    /// *Internal.* Replaces the AutoFilter and the sort state (rows are
    /// restored separately).
    RestoreFilterState {
        sheet: u32,
        #[ts(as = "Option<crate::wire::AutoFilter>")]
        auto_filter: Option<AutoFilter>,
        #[ts(as = "Option<crate::wire::SortState>")]
        sort_state: Option<SortState>,
    },
    /// *Internal.* Sets `(row, col, input, own style id)` per cell.
    RestoreCells {
        sheet: u32,
        cells: Vec<(u32, u32, String, u32)>,
    },
    /// *Internal.* Sets `(row, col, own style id)` per cell.
    RestoreStyles {
        sheet: u32,
        cells: Vec<(u32, u32, u32)>,
    },
    /// *Internal.* Replaces the listed columns' properties.
    RestoreCols {
        sheet: u32,
        cols: Vec<ColView>,
    },
    /// *Internal.* Replaces the listed rows' properties.
    RestoreRows {
        sheet: u32,
        rows: Vec<RowView>,
    },
    /// *Internal.* Brings back a deleted sheet, empty, at position
    /// `index` (the undo of [`DeleteSheet`](Self::DeleteSheet)).
    RestoreSheet {
        sheet: u32,
        name: String,
        index: u32,
        #[ts(as = "Option<app_common::wire::Color>")]
        tab_color: Option<Color>,
        #[ts(as = "crate::wire::SheetFormat")]
        format: SheetFormat,
    },
    /// *Internal.* Replaces all merged ranges of the sheet.
    RestoreMerges {
        sheet: u32,
        merges: Vec<Rect>,
    },
    /// *Internal.* Replaces all conditional formatting rules of the sheet.
    RestoreCfRules {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_cf::CfRule>")]
        rules: Vec<CfRule>,
    },
    /// *Internal.* Replaces all data validations of the sheet.
    RestoreValidations {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_cf::DataValidation>")]
        validations: Vec<DataValidation>,
    },
    /// *Internal.* Replaces all charts of the sheet.
    RestoreCharts {
        sheet: u32,
        #[ts(as = "Vec<crate::wire_chart::ChartObject>")]
        charts: Vec<ChartObject>,
    },
    /// *Internal.* Applies the commands in order as one undo step.
    Compound {
        commands: Vec<CalcCommand>,
    },
}

/// One line of [`BorderEdits`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum EdgeEdit {
    /// No line.
    None,
    /// This line style and colour.
    Line {
        #[ts(as = "crate::wire::BorderSide")]
        side: model_sheet::BorderSide,
    },
}

/// The edges [`CalcCommand::SetBorders`] changes; absent = unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct BorderEdits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub top: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bottom: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub left: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub right: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inside_horizontal: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inside_vertical: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub diagonal_up: Option<EdgeEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub diagonal_down: Option<EdgeEdit>,
}

impl BorderEdits {
    /// The borders of the cell at `(row, col)` of the range `r0..=r1`,
    /// `c0..=c1` after the edits.
    pub fn apply(
        &self,
        b: model_sheet::Borders,
        (row, col): (u32, u32),
        (r0, c0, r1, c1): (u32, u32, u32, u32),
    ) -> model_sheet::Borders {
        let edit = |cur: Option<model_sheet::BorderSide>, e: Option<EdgeEdit>| match e {
            None => cur,
            Some(EdgeEdit::None) => None,
            Some(EdgeEdit::Line { side }) => Some(side),
        };
        let pick =
            |outer: bool, o: Option<EdgeEdit>| if outer { o } else { self.inside_horizontal };
        let pick_v =
            |outer: bool, o: Option<EdgeEdit>| if outer { o } else { self.inside_vertical };
        model_sheet::Borders {
            top: edit(b.top, pick(row == r0, self.top)),
            bottom: edit(b.bottom, pick(row == r1, self.bottom)),
            left: edit(b.left, pick_v(col == c0, self.left)),
            right: edit(b.right, pick_v(col == c1, self.right)),
            diagonal_up: edit(b.diagonal_up, self.diagonal_up),
            diagonal_down: edit(b.diagonal_down, self.diagonal_down),
        }
    }
}

/// Where [`CalcCommand::InsertCells`] moves the existing cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum InsertShift {
    Right,
    Down,
}

/// Where [`CalcCommand::DeleteCells`] takes the replacing cells from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum DeleteShift {
    Left,
    Up,
}

/// The view settings [`CalcCommand::SetSheetView`] changes; absent fields
/// stay as they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetViewPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frozen_rows: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frozen_cols: Option<u32>,
    /// Percent, 10..=400.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub zoom: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_gridlines: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_headings: Option<bool>,
}

impl SheetViewPatch {
    /// A patch that sets every field to `view`'s value.
    pub fn full(view: SheetView) -> Self {
        SheetViewPatch {
            frozen_rows: Some(view.frozen_rows),
            frozen_cols: Some(view.frozen_cols),
            zoom: Some(view.zoom),
            show_gridlines: Some(view.show_gridlines),
            show_headings: Some(view.show_headings),
        }
    }

    /// `view` with the present fields replaced.
    pub fn apply(&self, view: SheetView) -> SheetView {
        SheetView {
            frozen_rows: self.frozen_rows.unwrap_or(view.frozen_rows),
            frozen_cols: self.frozen_cols.unwrap_or(view.frozen_cols),
            zoom: self.zoom.unwrap_or(view.zoom),
            show_gridlines: self.show_gridlines.unwrap_or(view.show_gridlines),
            show_headings: self.show_headings.unwrap_or(view.show_headings),
        }
    }
}

/// The changed properties of a slicer ([`CalcCommand::UpdateSlicer`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SlicerPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_caption: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub columns: Option<u32>,
    /// Button height in EMU.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<f64>")]
    pub row_height: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire_chart::ChartAnchor>")]
    pub anchor: Option<ChartAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire_data::SlicerSort>")]
    pub sort: Option<model_sheet::SlicerSort>,
}

/// One value of [`CalcCommand::FlashFill`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct FlashCell {
    pub row: u32,
    pub input: String,
}

/// A renamed table style (Modify Table Style with a new name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct StyleRename {
    pub from: String,
    pub to: String,
}

/// An inclusive cell range on an implied sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Rect {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

/// An inclusive cell range on `sheet`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetRect {
    pub sheet: u32,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

/// One copied cell of a [`CalcCommand::PasteRange`] block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct ClipCell {
    /// Offset from the block's top-left cell.
    pub dr: u32,
    pub dc: u32,
    /// The cell's input as copied (a formula as written at its source).
    pub input: String,
    /// Style id to paste; absent = keep the destination's style (plain
    /// text from the system clipboard).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub style: Option<u32>,
}

/// A cell format of [`CalcCommand::ConvertToRange`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct RangeFormat {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    #[ts(as = "crate::wire::CellStyle")]
    pub patch: CellStyle,
}

/// The functions of Data › Subtotal (`SUBTOTAL` 1–11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum SubtotalFunction {
    Sum,
    Count,
    Average,
    Max,
    Min,
    Product,
    CountNums,
    StdDev,
    StdDevP,
    Var,
    VarP,
}

impl SubtotalFunction {
    /// The `SUBTOTAL` function number Excel's Subtotal command writes.
    pub fn code(self) -> u32 {
        match self {
            SubtotalFunction::Average => 1,
            SubtotalFunction::CountNums => 2,
            SubtotalFunction::Count => 3,
            SubtotalFunction::Max => 4,
            SubtotalFunction::Min => 5,
            SubtotalFunction::Product => 6,
            SubtotalFunction::StdDev => 7,
            SubtotalFunction::StdDevP => 8,
            SubtotalFunction::Sum => 9,
            SubtotalFunction::Var => 10,
            SubtotalFunction::VarP => 11,
        }
    }
}

/// What Paste Special pastes (Excel's Paste choices).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PasteParts {
    #[default]
    All,
    Formulas,
    Values,
    Formats,
    /// Comments and notes.
    Comments,
    Validation,
    AllExceptBorders,
    ColumnWidths,
    FormulasAndNumberFormats,
    ValuesAndNumberFormats,
    /// All, keeping the source column widths.
    AllAndColumnWidths,
}

/// The arithmetic of Paste Special › Operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PasteOperation {
    #[default]
    None,
    Add,
    Subtract,
    Multiply,
    Divide,
}

/// Paste Special options of [`CalcCommand::PasteRange`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PasteSpecial {
    #[ts(optional, as = "Option<PasteParts>")]
    pub parts: PasteParts,
    #[ts(optional, as = "Option<PasteOperation>")]
    pub operation: PasteOperation,
    /// Blank source cells leave the destination alone.
    #[ts(optional, as = "Option<bool>")]
    pub skip_blanks: bool,
    /// Rows become columns.
    #[ts(optional, as = "Option<bool>")]
    pub transpose: bool,
    /// Paste Link: formulas referencing the source cells.
    #[ts(optional, as = "Option<bool>")]
    pub link: bool,
}

/// What a paste writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PasteMode {
    /// Contents and formats.
    All,
    /// Values only (a formula pastes the current value of its source
    /// cell); destination formats are kept.
    ValuesOnly,
    /// Formats only; destination contents are kept.
    FormatsOnly,
}

/// How [`CalcCommand::FillRange`] extends each line of the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum FillMode {
    /// Excel's plain drag: one number is copied; two or more numbers
    /// continue their linear (best-fit) trend; dates step by a day; text
    /// ending in a number counts up; anything else (formulas with
    /// relative references shifted) repeats.
    Auto,
    /// Ctrl+drag: series and copy swapped relative to `Auto`.
    Alternate,
    /// Always repeat the source.
    Copy,
    /// Always a series where one is possible (a single number steps by 1).
    Series,
}
