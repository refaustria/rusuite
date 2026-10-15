//! Per-sheet column/row dimensions and defaults.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::style::StyleId;

fn is_false(b: &bool) -> bool {
    !*b
}

/// Column properties. `Default` = default width, visible, no column style.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColInfo {
    /// Width in Excel character units; `None` = the sheet default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    /// Style of the cells of this column that have no own style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<StyleId>,
}

impl ColInfo {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// Row properties. `Default` = default height, visible, no row style.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowInfo {
    /// Height in points; `None` = the sheet default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    /// Style of the cells of this row that have no own style (takes
    /// precedence over the column style, as in Excel).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<StyleId>,
}

impl RowInfo {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// Sheet-wide dimension defaults.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetFormat {
    /// Excel character units (Excel's default: 8.43).
    pub default_col_width: f64,
    /// Points (Excel's default: 15.0).
    pub default_row_height: f64,
}

impl Default for SheetFormat {
    fn default() -> Self {
        SheetFormat {
            default_col_width: 8.43,
            default_row_height: 15.0,
        }
    }
}

/// What `model-sheet` stores per sheet beyond the engine's cell contents.
#[derive(Debug, Clone, Default)]
pub(crate) struct SheetData {
    /// Explicit cell styles; default-styled cells are absent.
    pub cell_styles: HashMap<(u32, u32), StyleId>,
    /// Non-default columns only.
    pub cols: BTreeMap<u32, ColInfo>,
    /// Non-default rows only.
    pub rows: BTreeMap<u32, RowInfo>,
    pub format: SheetFormat,
}

impl SheetData {
    pub fn set_col(&mut self, col: u32, info: ColInfo) {
        if info.is_default() {
            self.cols.remove(&col);
        } else {
            self.cols.insert(col, info);
        }
    }

    pub fn set_row(&mut self, row: u32, info: RowInfo) {
        if info.is_default() {
            self.rows.remove(&row);
        } else {
            self.rows.insert(row, info);
        }
    }

    pub fn set_cell_style(&mut self, row: u32, col: u32, id: StyleId) {
        if id.is_default() {
            self.cell_styles.remove(&(row, col));
        } else {
            self.cell_styles.insert((row, col), id);
        }
    }
}
