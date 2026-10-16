//! Per-sheet column/row dimensions, defaults, view settings and merged
//! cell ranges.

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
    /// Outline (Group) level, 0–7.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub outline_level: u8,
    /// The summary column of a collapsed group.
    #[serde(default, skip_serializing_if = "is_false")]
    pub collapsed: bool,
}

fn is_zero(n: &u8) -> bool {
    *n == 0
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
    /// Hidden by an AutoFilter (with `hidden`), not by hand: clearing the
    /// filter shows it again, `SUBTOTAL(1..11)` skips it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub filtered: bool,
    /// Outline (Group) level, 0–7.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub outline_level: u8,
    /// The summary row of a collapsed group.
    #[serde(default, skip_serializing_if = "is_false")]
    pub collapsed: bool,
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

/// Smallest and largest [`SheetView::zoom`] (Excel's limits).
pub const MIN_ZOOM: u16 = 10;
pub const MAX_ZOOM: u16 = 400;

/// How a sheet is shown. `Default` = nothing frozen, 100 %, gridlines and
/// row/column headings on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetView {
    /// Rows `0..frozen_rows` stay visible when scrolling (0 = none).
    pub frozen_rows: u32,
    /// Columns `0..frozen_cols` stay visible when scrolling (0 = none).
    pub frozen_cols: u32,
    /// Percent, [`MIN_ZOOM`]..=[`MAX_ZOOM`].
    pub zoom: u16,
    pub show_gridlines: bool,
    /// Row numbers and column letters.
    pub show_headings: bool,
}

impl Default for SheetView {
    fn default() -> Self {
        SheetView {
            frozen_rows: 0,
            frozen_cols: 0,
            zoom: 100,
            show_gridlines: true,
            show_headings: true,
        }
    }
}

impl SheetView {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// A merged cell range (0-based, inclusive bounds) of at least two cells.
/// Only the top-left cell `(r0, c0)` shows content; it spans the range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct MergeRect {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl MergeRect {
    pub fn new(r0: u32, c0: u32, r1: u32, c1: u32) -> Self {
        MergeRect { r0, c0, r1, c1 }
    }

    pub fn contains(&self, row: u32, col: u32) -> bool {
        (self.r0..=self.r1).contains(&row) && (self.c0..=self.c1).contains(&col)
    }

    pub fn intersects(&self, other: &MergeRect) -> bool {
        self.r0 <= other.r1 && other.r0 <= self.r1 && self.c0 <= other.c1 && other.c0 <= self.c1
    }

    /// Whether `other` lies completely inside `self`.
    pub fn covers(&self, other: &MergeRect) -> bool {
        self.r0 <= other.r0 && other.r1 <= self.r1 && self.c0 <= other.c0 && other.c1 <= self.c1
    }

    /// Number of cells.
    pub fn cells(&self) -> u64 {
        (u64::from(self.r1) - u64::from(self.r0) + 1)
            * (u64::from(self.c1) - u64::from(self.c0) + 1)
    }
}

/// What `model-sheet` stores per sheet beyond the engine's cell contents.
#[derive(Debug, Clone, Default)]
pub(crate) struct SheetData {
    /// Explicit cell styles; default-styled cells are absent. Change it
    /// only through [`set_cell_style`](Self::set_cell_style) /
    /// [`replace_cell_styles`](Self::replace_cell_styles), which keep the
    /// per-row/column counts below in sync.
    pub cell_styles: HashMap<(u32, u32), StyleId>,
    /// Number of styled cells per row / per column (no zero entries): the
    /// largest keys give the styled bound in O(log n) instead of a scan.
    style_rows: BTreeMap<u32, u32>,
    style_cols: BTreeMap<u32, u32>,
    /// Non-default columns only.
    pub cols: BTreeMap<u32, ColInfo>,
    /// Non-default rows only.
    pub rows: BTreeMap<u32, RowInfo>,
    pub format: SheetFormat,
    /// Colour of the sheet tab; `None` = default.
    pub tab_color: Option<core_model::Color>,
    pub view: SheetView,
    /// Hidden sheet (not shown as a tab; can be unhidden).
    pub hidden: bool,
    /// Excel's `veryHidden` (implies `hidden`; only unhidden by code).
    pub very_hidden: bool,
    /// Merged ranges, pairwise disjoint, sorted by `(r0, c0)`.
    pub merges: Vec<MergeRect>,
    pub auto_filter: Option<crate::sortfilter::AutoFilter>,
    /// The last sort.
    pub sort_state: Option<crate::sortfilter::SortState>,
    /// Conditional formatting rules in priority order.
    pub conditional_formats: Vec<crate::condfmt::CfRule>,
    /// Data validations with pairwise disjoint ranges.
    pub validations: Vec<crate::validation::DataValidation>,
    /// Charts, back to front.
    pub charts: Vec<crate::chart::ChartObject>,
    /// Notes, sorted by cell.
    pub notes: Vec<crate::annotations::Note>,
    /// Threaded comments, sorted by cell.
    pub threads: Vec<crate::annotations::Thread>,
    /// Hyperlinks in file order.
    pub hyperlinks: Vec<crate::annotations::Hyperlink>,
    /// Pivot tables.
    pub pivots: Vec<crate::pivot::PivotTable>,
    /// The layout of each pivot table as last rendered, by id.
    pub pivot_outputs: HashMap<u32, crate::pivot::PivotOutput>,
    /// Excel tables, pairwise disjoint.
    pub tables: Vec<crate::tables::Table>,
    /// Where outline summary rows/columns sit.
    pub outline: crate::outline::OutlineProps,
    /// Manual page breaks: a new page starts before these rows / columns
    /// (ascending, > 0).
    pub row_breaks: Vec<u32>,
    pub col_breaks: Vec<u32>,
    /// Pictures, back to front.
    pub pictures: Vec<crate::picture::Picture>,
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
            if self.cell_styles.remove(&(row, col)).is_some() {
                uncount(&mut self.style_rows, row);
                uncount(&mut self.style_cols, col);
            }
        } else if self.cell_styles.insert((row, col), id).is_none() {
            *self.style_rows.entry(row).or_default() += 1;
            *self.style_cols.entry(col).or_default() += 1;
        }
    }

    /// Replaces all cell styles (structural edits) and recounts.
    pub fn replace_cell_styles(&mut self, styles: HashMap<(u32, u32), StyleId>) {
        self.cell_styles = styles;
        self.style_rows.clear();
        self.style_cols.clear();
        for &(row, col) in self.cell_styles.keys() {
            *self.style_rows.entry(row).or_default() += 1;
            *self.style_cols.entry(col).or_default() += 1;
        }
    }

    /// `(max_row, max_col)` over the styled cells, `None` without any.
    pub fn styled_bound(&self) -> Option<(u32, u32)> {
        let row = self.style_rows.last_key_value()?.0;
        let col = self.style_cols.last_key_value()?.0;
        Some((*row, *col))
    }
}

fn uncount(counts: &mut BTreeMap<u32, u32>, key: u32) {
    if let Some(n) = counts.get_mut(&key) {
        *n -= 1;
        if *n == 0 {
            counts.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(d: &SheetData) -> Option<(u32, u32)> {
        d.cell_styles
            .keys()
            .copied()
            .reduce(|(r, c), (r2, c2)| (r.max(r2), c.max(c2)))
    }

    #[test]
    fn styled_bound_follows_edits() {
        let mut d = SheetData::default();
        let (a, b) = (StyleId(1), StyleId(2));
        assert_eq!(d.styled_bound(), None);
        d.set_cell_style(4, 1, a);
        d.set_cell_style(2, 7, a);
        d.set_cell_style(2, 7, b); // overwrite: counted once
        assert_eq!(d.styled_bound(), Some((4, 7)));
        d.set_cell_style(2, 7, StyleId::DEFAULT);
        assert_eq!(d.styled_bound(), Some((4, 1)));
        d.set_cell_style(9, 9, StyleId::DEFAULT); // absent: no-op
        assert_eq!(d.styled_bound(), scan(&d));
        d.replace_cell_styles(HashMap::from([((1, 3), a), ((6, 0), b)]));
        assert_eq!(d.styled_bound(), Some((6, 3)));
        d.set_cell_style(6, 0, StyleId::DEFAULT);
        d.set_cell_style(1, 3, StyleId::DEFAULT);
        assert_eq!(d.styled_bound(), None);
    }
}
