//! What the document reports to the UI: [`CalcPatch`] after every
//! command, [`RegionSnapshot`] for a viewport, [`WorkbookInfo`] on open.

use app_common::Revision;
use model_sheet::{
    AutoFilter, CellStyle, CfResult, ChartObject, DataValidation, SheetFormat, SheetView, SortState,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::Rect;

/// The value type of a cell, for default alignment (numbers right, text
/// left, booleans and errors centered).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CellKind {
    Empty,
    Number,
    Text,
    Bool,
    Error,
}

/// The indicator of a cell's threaded comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CommentState {
    /// Purple marker.
    Open,
    /// Outlined marker.
    Resolved,
}

/// One cell as the grid renders it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CellView {
    pub row: u32,
    pub col: u32,
    /// The edit text (formula with `=`, or the constant as typed).
    pub input: String,
    /// The formatted value.
    pub display: String,
    pub kind: CellKind,
    /// Effective style id (cell → row → column → default) into the style
    /// table of [`WorkbookInfo::styles`] / [`CalcPatch::styles`].
    pub style: u32,
    /// A cell an array formula spills into: `[row, col]` of the formula
    /// cell (same sheet). Its `input` is empty and it is not edited
    /// directly (typing into it blocks the spill: `#SPILL!`). Absent = not
    /// spilled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub spilled: Option<(u32, u32)>,
    /// A formula cell with an array result: the range it spills into
    /// (formula cell included), or would spill into when its value is
    /// `#SPILL!` (the UI outlines it). Absent = no array result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub spill: Option<Rect>,
    /// The number format's colour (`[Red]`, `[Color 10]`) as `#RRGGBB`;
    /// absent = none (the font colour applies).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    /// `*x` in the number format: `display` is split at this char index
    /// and `fillChar` repeats there to fill the cell. Absent = no fill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fill_at: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fill_char: Option<String>,
    /// A number that does not fit its column (Excel's `####`): estimated
    /// from the column width in character units and the font size (a
    /// General number counts as fitting while fewer decimals or
    /// scientific notation fit). Absent = fits.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub narrow: bool,
    /// The cell has a note (red triangle); absent = none.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub note: bool,
    /// The cell's threaded comment; absent = none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comment: Option<CommentState>,
    /// A hyperlink or `HYPERLINK()` cell (Ctrl+click follows it; the
    /// target comes from `cellAnnotations`); absent = none.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub link: bool,
    /// A cell of a pivot table (read-only for contents): its table and
    /// role; absent = none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pivot: Option<crate::pivots::PivotCellView>,
}

/// A match of the `findCells` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct FoundCell {
    pub sheet: u32,
    pub row: u32,
    pub col: u32,
    /// The cell's input (what Replace edits).
    pub input: String,
    pub display: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetInfo {
    pub id: u32,
    pub name: String,
    /// Tab colour; absent = default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<app_common::wire::Color>")]
    pub tab_color: Option<core_model::Color>,
    /// Hidden sheets get no tab (they stay in the list, in order);
    /// absent = visible.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub hidden: bool,
    /// Excel's "very hidden" (with `hidden`): not offered for unhiding.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub very_hidden: bool,
    /// Frozen panes, zoom, gridlines and headings; absent = defaults
    /// (nothing frozen, 100 %, gridlines and headings shown).
    #[serde(default, skip_serializing_if = "SheetView::is_default")]
    #[ts(optional, as = "Option<crate::wire::SheetView>")]
    pub view: SheetView,
    /// The AutoFilter (dropdowns on the header cells `r0`, `c0..=c1`);
    /// absent = none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire::AutoFilter>")]
    pub auto_filter: Option<AutoFilter>,
    /// The last sort (for sort indicators); absent = none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire::SortState>")]
    pub sort_state: Option<SortState>,
    /// Excel tables of the sheet.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::wire_tables::Table>>")]
    pub tables: Vec<model_sheet::Table>,
    /// Outline settings; absent = summary rows below, columns right.
    #[serde(default, skip_serializing_if = "model_sheet::OutlineProps::is_default")]
    #[ts(optional, as = "Option<crate::wire_tables::OutlineProps>")]
    pub outline: model_sheet::OutlineProps,
    /// Manual page breaks before these rows / columns.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub row_breaks: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub col_breaks: Vec<u32>,
    /// The deepest outline level of the rows and of the columns (the
    /// outline bars show `level + 1` buttons).
    #[serde(default, skip_serializing_if = "no_outline")]
    #[ts(optional, as = "Option<(u8, u8)>")]
    pub max_outline: (u8, u8),
    /// Review › Protect Sheet (in force: `sheet` true); absent =
    /// unprotected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire::SheetProtection>")]
    pub protection: Option<model_sheet::SheetProtection>,
    /// The slicers of the sheet with their buttons; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::slicers::SlicerView>>")]
    pub slicers: Vec<crate::slicers::SlicerView>,
}

fn no_outline(m: &(u8, u8)) -> bool {
    *m == (0, 0)
}

/// The complete list of merged ranges of `sheet`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetMerges {
    pub sheet: u32,
    pub merges: Vec<Rect>,
}

/// Properties of one column; all defaults when not listed.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct ColView {
    pub col: u32,
    /// Character units; `null` = sheet default.
    pub width: Option<f64>,
    pub hidden: bool,
    /// Style of the column's cells without own style; `null` = none.
    pub style: Option<u32>,
    /// Outline level 1–7 (absent = 0).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[ts(optional, as = "Option<u8>")]
    pub outline_level: u8,
    /// The summary column of a collapsed group.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub collapsed: bool,
}

fn is_zero(n: &u8) -> bool {
    *n == 0
}

/// Properties of one row; all defaults when not listed.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct RowView {
    pub row: u32,
    /// Points; `null` = sheet default.
    pub height: Option<f64>,
    pub hidden: bool,
    /// Style of the row's cells without own style (wins over the column
    /// style); `null` = none.
    pub style: Option<u32>,
    /// Hidden by the AutoFilter (with `hidden`), not by hand; absent =
    /// false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub filtered: bool,
    /// Outline level 1–7 (absent = 0).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[ts(optional, as = "Option<u8>")]
    pub outline_level: u8,
    /// The summary row of a collapsed group.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetCells {
    pub sheet: u32,
    pub cells: Vec<CellView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetCols {
    pub sheet: u32,
    pub cols: Vec<ColView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetRows {
    pub sheet: u32,
    pub rows: Vec<RowView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum StructuralKind {
    InsertRows,
    DeleteRows,
    InsertCols,
    DeleteCols,
    /// Insert / Delete Cells with a shift (`at`, `count` on the shift's
    /// axis; only part of the rows / columns moved).
    ShiftCells,
}

/// Rows/columns were inserted or deleted on `sheet`: the UI drops its
/// cached cells, rows and columns of that sheet and requests a fresh
/// [`RegionSnapshot`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct StructuralChange {
    pub sheet: u32,
    pub kind: StructuralKind,
    pub at: u32,
    pub count: u32,
}

/// What a command changed. Empty lists / `null` = nothing of that kind.
///
/// `cells` lists every cell whose input, value or effective style
/// changed, *except* on sheets listed in `structural` (whose cache is
/// dropped anyway).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CalcPatch {
    /// The full sheet list in display order, when it changed (added,
    /// deleted, renamed, moved, recoloured, hidden/shown sheets, or a
    /// changed sheet view).
    pub sheets: Option<Vec<SheetInfo>>,
    pub cells: Vec<SheetCells>,
    pub cols: Vec<SheetCols>,
    pub rows: Vec<SheetRows>,
    /// The full style table, when it grew.
    #[ts(as = "Option<Vec<crate::wire::CellStyle>>")]
    pub styles: Option<Vec<CellStyle>>,
    /// Human-readable description of a circular reference, if the
    /// recalculation found one.
    pub cycle: Option<String>,
    pub structural: Vec<StructuralChange>,
    /// The complete merge list of every sheet whose merges changed;
    /// absent = none changed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<SheetMerges>>")]
    pub merges: Vec<SheetMerges>,
    /// After `setSheetHidden`: the sheet to show – the unhidden sheet, or
    /// after hiding, its nearest visible neighbour (to switch to when the
    /// hidden sheet was the active one).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub activate_sheet: Option<u32>,
    /// Sheets whose conditional formatting results, rules or data
    /// validations may have changed (a rule command, or any cell change on
    /// a workbook with rules): the UI refetches their region snapshot (and
    /// `sheetRules` if a dialog shows them); absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub cf_sheets: Vec<u32>,
    /// Sheets whose charts may have changed: a chart command, a cell
    /// change a chart on that sheet references, or a structural, sheet
    /// list or row/column visibility change on a workbook with charts.
    /// The UI refetches `sheetCharts` (or the region snapshot) and the
    /// `chartData` of the charts it shows; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub chart_sheets: Vec<u32>,
    /// The full list of defined names, when it changed (a name command,
    /// or a structural edit / sheet rename or delete that rewrote a
    /// definition); absent = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub names: Option<Vec<crate::names::NameInfo>>,
    /// The complete notes, threads and hyperlinks of every sheet whose
    /// annotations changed (cells whose `note`/`comment`/`link` flags
    /// changed are also in `cells`); absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::annotations::SheetAnnotations>>")]
    pub annotations: Vec<crate::annotations::SheetAnnotations>,
    /// The document's comment authors, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Vec<crate::wire_annot::Person>>")]
    pub persons: Option<Vec<model_sheet::Person>>,
    /// Sheets whose pivot tables changed (definition, layout or place):
    /// the UI refetches their region snapshot and the `pivotInfo` it
    /// shows; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub pivot_sheets: Vec<u32>,
    /// The pivot tables whose source changed since their last refresh,
    /// when that list changed; absent = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stale_pivots: Option<Vec<u32>>,
    /// Remove Duplicates: what was removed and what remains.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duplicates: Option<crate::datatools::DuplicatesResult>,
    /// Sheets whose pictures changed (the UI fetches `sheetPictures`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub picture_sheets: Vec<u32>,
    /// The workbook protection, when it changed (unprotected: both locks
    /// off); absent = unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire::WorkbookProtection>")]
    pub workbook_protection: Option<Box<model_sheet::WorkbookProtection>>,
    /// The custom table styles and default style, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire_data::TableStyles>")]
    pub table_styles: Option<Box<model_sheet::TableStyles>>,
}

/// Merges `other` into `list`, replacing entries with the same key.
fn merge_keyed<T, K: PartialEq>(list: &mut Vec<T>, other: Vec<T>, key: impl Fn(&T) -> K) {
    for item in other {
        match list.iter_mut().find(|x| key(x) == key(&item)) {
            Some(slot) => *slot = item,
            None => list.push(item),
        }
    }
}

impl app_common::Patch for CalcPatch {
    fn merge(&mut self, other: Self) {
        if other.sheets.is_some() {
            self.sheets = other.sheets;
        }
        if other.styles.is_some() {
            self.styles = other.styles;
        }
        if other.cycle.is_some() {
            self.cycle = other.cycle;
        }
        if other.activate_sheet.is_some() {
            self.activate_sheet = other.activate_sheet;
        }
        if other.names.is_some() {
            self.names = other.names;
        }
        if other.persons.is_some() {
            self.persons = other.persons;
        }
        if other.stale_pivots.is_some() {
            self.stale_pivots = other.stale_pivots;
        }
        if other.duplicates.is_some() {
            self.duplicates = other.duplicates;
        }
        if other.workbook_protection.is_some() {
            self.workbook_protection = other.workbook_protection;
        }
        if other.table_styles.is_some() {
            self.table_styles = other.table_styles;
        }
        for s in other.picture_sheets {
            if !self.picture_sheets.contains(&s) {
                self.picture_sheets.push(s);
            }
        }
        for s in other.pivot_sheets {
            if !self.pivot_sheets.contains(&s) {
                self.pivot_sheets.push(s);
            }
        }
        merge_keyed(&mut self.annotations, other.annotations, |a| a.sheet);
        merge_keyed(&mut self.merges, other.merges, |m| m.sheet);
        for s in other.cf_sheets {
            if !self.cf_sheets.contains(&s) {
                self.cf_sheets.push(s);
            }
        }
        for s in other.chart_sheets {
            if !self.chart_sheets.contains(&s) {
                self.chart_sheets.push(s);
            }
        }
        // A structural change invalidates earlier cell/row/col entries of
        // that sheet: drop them.
        for s in &other.structural {
            self.cells.retain(|c| c.sheet != s.sheet);
            self.cols.retain(|c| c.sheet != s.sheet);
            self.rows.retain(|c| c.sheet != s.sheet);
        }
        self.structural.extend(other.structural);
        for group in other.cells {
            match self.cells.iter_mut().find(|g| g.sheet == group.sheet) {
                Some(g) => merge_keyed(&mut g.cells, group.cells, |c| (c.row, c.col)),
                None => self.cells.push(group),
            }
        }
        for group in other.cols {
            match self.cols.iter_mut().find(|g| g.sheet == group.sheet) {
                Some(g) => merge_keyed(&mut g.cols, group.cols, |c| c.col),
                None => self.cols.push(group),
            }
        }
        for group in other.rows {
            match self.rows.iter_mut().find(|g| g.sheet == group.sheet) {
                Some(g) => merge_keyed(&mut g.rows, group.rows, |r| r.row),
                None => self.rows.push(group),
            }
        }
    }
}

/// A viewport of one sheet: the cells with content or an own style in
/// `r0..=r1 × c0..=c1` (empty cells are omitted; their effective style is
/// the row style, else the column style, else the default), the
/// non-default rows/columns of the region and the sheet defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct RegionSnapshot {
    pub sheet: u32,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    pub cells: Vec<CellView>,
    pub cols: Vec<ColView>,
    pub rows: Vec<RowView>,
    #[ts(as = "crate::wire::SheetFormat")]
    pub format: SheetFormat,
    /// The merged ranges that intersect the region (whole ranges, which
    /// may extend beyond it); absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<Rect>>")]
    pub merges: Vec<Rect>,
    /// The conditional formatting of the region's cells (blank cells
    /// included), row-major; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<CellCf>>")]
    pub cf: Vec<CellCf>,
    /// The data validations intersecting the region (whole ranges; the
    /// UI shows list dropdowns and input messages from them); absent =
    /// none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::wire_cf::DataValidation>>")]
    pub validations: Vec<DataValidation>,
    /// Every chart of the sheet (not only those over the region), back to
    /// front; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::wire_chart::ChartObject>>")]
    pub charts: Vec<ChartObject>,
    /// Every pivot table of the sheet; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::pivots::PivotSummary>>")]
    pub pivots: Vec<crate::pivots::PivotSummary>,
}

/// The conditional formatting of one cell of a [`RegionSnapshot`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CellCf {
    pub row: u32,
    pub col: u32,
    #[ts(as = "crate::wire_cf::CfResult")]
    pub cf: CfResult,
}

/// Workbook metadata sent on open/new.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct WorkbookInfo {
    pub sheets: Vec<SheetInfo>,
    /// The style table, indexed by style id (0 = default).
    #[ts(as = "Vec<crate::wire::CellStyle>")]
    pub styles: Vec<CellStyle>,
    /// The host revision ([`CalcDocument::info`](crate::CalcDocument::info)
    /// alone reports 0; [`dispatch`](crate::dispatch) fills it in).
    pub revision: Revision,
    /// The defined names; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::names::NameInfo>>")]
    pub names: Vec<crate::names::NameInfo>,
    /// The document's comment authors; absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<crate::wire_annot::Person>>")]
    pub persons: Vec<model_sheet::Person>,
    /// Pivot tables whose source changed since their last refresh;
    /// absent = none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<u32>>")]
    pub stale_pivots: Vec<u32>,
    /// Review › Protect Workbook; absent = unprotected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire::WorkbookProtection>")]
    pub workbook_protection: Option<model_sheet::WorkbookProtection>,
    /// The sheet the file opened on (`<workbookView activeTab>`).
    pub active_sheet: u32,
    /// Custom table styles and the default table style; absent = none.
    #[serde(default, skip_serializing_if = "model_sheet::TableStyles::is_default")]
    #[ts(optional, as = "Option<crate::wire_data::TableStyles>")]
    pub table_styles: model_sheet::TableStyles,
}
