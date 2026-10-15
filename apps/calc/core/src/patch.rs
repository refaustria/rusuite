//! What the document reports to the UI: [`CalcPatch`] after every
//! command, [`RegionSnapshot`] for a viewport, [`WorkbookInfo`] on open.

use app_common::Revision;
use model_sheet::{CellStyle, SheetFormat};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetInfo {
    pub id: u32,
    pub name: String,
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
    /// The full sheet list, when it changed.
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
}
