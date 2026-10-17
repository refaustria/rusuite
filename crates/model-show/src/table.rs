//! Tables in slides (`p:graphicFrame/a:graphic/a:tbl`): a grid of rows and
//! columns, cells with DrawingML text, optional fills and borders, merged
//! cells, and a PowerPoint table style.

use core_model::units::Emu;
use core_model::Color;
use serde::{Deserialize, Serialize};

use crate::shape::{Fill, Line};
use crate::tablestyle::{builtin_table_style, TableStyleDef};
use crate::text::{TextBody, TextParagraph};

/// PowerPoint's default table style, "Medium Style 2 – Accent 1".
pub const MEDIUM_STYLE_2_ACCENT_1: &str = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
/// PowerPoint's "No Style, No Grid" (written for tables without a style).
pub const NO_STYLE_NO_GRID: &str = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}";

/// A row of the grid (`a:tr/@h`: the minimum height; text may make the
/// row taller when rendered).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct RowSpec {
    /// Height.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub height: Emu,
}

/// A column of the grid (`a:gridCol/@w`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ColSpec {
    /// Width.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
}

/// The borders of a cell (`a:lnL`, `a:lnR`, `a:lnT`, `a:lnB` and the
/// diagonals `a:lnTlToBr`, `a:lnBlToTr`); `None` = as the table style
/// draws it (the styles draw no diagonals).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct CellBorders {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub left: Option<Line>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub right: Option<Line>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub top: Option<Line>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bottom: Option<Line>,
    /// Diagonal from the top-left to the bottom-right corner.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub diag_down: Option<Line>,
    /// Diagonal from the bottom-left to the top-right corner.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub diag_up: Option<Line>,
}

impl CellBorders {
    /// Whether every border comes from the style.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

fn one() -> u32 {
    1
}

fn is_one(v: &u32) -> bool {
    *v == 1
}

fn is_false(v: &bool) -> bool {
    !*v
}

/// A cell (`a:tc`). A merged region is stored in its top-left cell (the
/// anchor: `row_span` × `col_span`); the other cells of the region are
/// `covered` (`hMerge`/`vMerge`), keep spans 1 and are not drawn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TableCell {
    /// Text; `props.insets` and `props.anchor` are the cell margins and
    /// vertical alignment (`a:tcPr marL … anchor`).
    pub text: TextBody,
    /// Fill; `None` = from the table style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub fill: Option<Fill>,
    /// Borders.
    #[serde(default, skip_serializing_if = "CellBorders::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<CellBorders>"))]
    pub borders: CellBorders,
    /// Rows spanned by a merge anchor (`rowSpan`).
    #[serde(default = "one", skip_serializing_if = "is_one")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub row_span: u32,
    /// Columns spanned by a merge anchor (`gridSpan`).
    #[serde(default = "one", skip_serializing_if = "is_one")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub col_span: u32,
    /// Part of another cell's merged region.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub covered: bool,
}

impl Default for TableCell {
    fn default() -> Self {
        Self::new()
    }
}

impl TableCell {
    /// An empty cell: one empty paragraph, default margins, style fill and
    /// borders.
    pub fn new() -> Self {
        TableCell {
            text: empty_body(),
            fill: None,
            borders: CellBorders::default(),
            row_span: 1,
            col_span: 1,
            covered: false,
        }
    }

    /// An empty cell with this cell's fill, borders and text body
    /// properties (for inserted rows/columns).
    fn blank_like(&self) -> Self {
        let mut c = TableCell::new();
        c.fill = self.fill;
        c.borders = self.borders;
        c.text.props = self.text.props;
        c
    }

    /// Whether the cell's text is empty.
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
}

fn empty_body() -> TextBody {
    TextBody {
        props: Default::default(),
        paragraphs: vec![TextParagraph::new()],
    }
}

/// Which parts of the table get the style's special formatting
/// (`a:tblPr firstRow firstCol lastRow lastCol bandRow bandCol`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TableLook {
    /// Header row.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub first_row: bool,
    /// First column.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub first_col: bool,
    /// Total row.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub last_row: bool,
    /// Last column.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub last_col: bool,
    /// Banded rows.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub band_rows: bool,
    /// Banded columns.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub band_cols: bool,
}

/// What the table style gives a cell (see [`Table::style_cell`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StyleCell {
    /// Fill.
    pub fill: Fill,
    /// Borders.
    pub borders: CellBorders,
    /// Bold text.
    pub bold: bool,
    /// Text color.
    pub text_color: Option<Color>,
}

/// A table: grid, cells (`cells[row][col]`, always `rows` × `cols`), the
/// PowerPoint table style (`a:tableStyleId` GUID; `None` = no style) and
/// its look flags.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Table {
    /// Rows, top to bottom.
    pub rows: Vec<RowSpec>,
    /// Columns, left to right.
    pub cols: Vec<ColSpec>,
    /// Cells, row by row.
    pub cells: Vec<Vec<TableCell>>,
    /// Table style GUID (e.g. [`MEDIUM_STYLE_2_ACCENT_1`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub style_id: Option<String>,
    /// Style options.
    #[serde(default)]
    pub look: TableLook,
}

/// Splits `total` into `n` parts differing by at most 1 (the first ones
/// larger).
fn split_evenly(total: i64, n: usize) -> Vec<Emu> {
    let n64 = n.max(1) as i64;
    let (q, r) = (total.div_euclid(n64), total.rem_euclid(n64));
    (0..n64).map(|i| Emu(q + i64::from(i < r))).collect()
}

/// Scales `sizes` so that they add up to `total` (rounded, the last one
/// takes the remainder; equal shares if they add up to 0).
fn scale_sizes(sizes: &mut [Emu], total: Emu) {
    let sum: i64 = sizes.iter().map(|s| s.0).sum();
    if sizes.is_empty() {
        return;
    }
    if sum <= 0 {
        let even = split_evenly(total.0, sizes.len());
        sizes.copy_from_slice(&even);
        return;
    }
    let k = total.0 as f64 / sum as f64;
    let mut used = 0;
    let last = sizes.len() - 1;
    for (i, s) in sizes.iter_mut().enumerate() {
        if i == last {
            *s = Emu((total.0 - used).max(0));
        } else {
            *s = Emu((s.0 as f64 * k).round() as i64);
            used += s.0;
        }
    }
}

impl Table {
    /// A `rows` × `cols` table filling `width` × `height` (equal column
    /// widths and row heights), PowerPoint's default style (Medium Style 2
    /// – Accent 1) with header row and banded rows. Zero counts become 1.
    pub fn new(rows: usize, cols: usize, width: Emu, height: Emu) -> Self {
        let (rows, cols) = (rows.max(1), cols.max(1));
        Table {
            rows: split_evenly(height.0, rows)
                .into_iter()
                .map(|height| RowSpec { height })
                .collect(),
            cols: split_evenly(width.0, cols)
                .into_iter()
                .map(|width| ColSpec { width })
                .collect(),
            cells: vec![vec![TableCell::new(); cols]; rows],
            style_id: Some(MEDIUM_STYLE_2_ACCENT_1.to_owned()),
            look: TableLook {
                first_row: true,
                band_rows: true,
                ..TableLook::default()
            },
        }
    }

    /// Number of rows.
    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    /// Number of columns.
    pub fn col_count(&self) -> usize {
        self.cols.len()
    }

    /// Sum of the column widths.
    pub fn width(&self) -> Emu {
        Emu(self.cols.iter().map(|c| c.width.0).sum())
    }

    /// Sum of the row heights.
    pub fn height(&self) -> Emu {
        Emu(self.rows.iter().map(|r| r.height.0).sum())
    }

    /// The cell at `row`, `col`.
    pub fn cell(&self, row: usize, col: usize) -> Option<&TableCell> {
        self.cells.get(row)?.get(col)
    }

    /// Mutable access to the cell at `row`, `col`.
    pub fn cell_mut(&mut self, row: usize, col: usize) -> Option<&mut TableCell> {
        self.cells.get_mut(row)?.get_mut(col)
    }

    /// Scales the column widths and row heights to `width` × `height`
    /// (after the table's box was resized).
    pub fn scale_to(&mut self, width: Emu, height: Emu) {
        let mut w: Vec<Emu> = self.cols.iter().map(|c| c.width).collect();
        let mut h: Vec<Emu> = self.rows.iter().map(|r| r.height).collect();
        scale_sizes(&mut w, width);
        scale_sizes(&mut h, height);
        for (c, w) in self.cols.iter_mut().zip(w) {
            c.width = w;
        }
        for (r, h) in self.rows.iter_mut().zip(h) {
            r.height = h;
        }
    }

    /// The merge anchor whose region covers `row`, `col` (the cell itself
    /// when it is not covered).
    pub fn anchor_of(&self, row: usize, col: usize) -> (usize, usize) {
        for r in (0..=row).rev() {
            for c in (0..=col).rev() {
                let Some(cell) = self.cell(r, c) else {
                    continue;
                };
                if !cell.covered
                    && r + cell.row_span as usize > row
                    && c + cell.col_span as usize > col
                {
                    return (r, c);
                }
            }
        }
        (row, col)
    }

    /// Checks the invariants: at least one row and column, `cells` is
    /// `rows` × `cols`, every merged region lies inside the grid, its
    /// other cells are covered, and every covered cell belongs to exactly
    /// one region.
    pub fn validate(&self) -> Result<(), String> {
        let (nr, nc) = (self.rows.len(), self.cols.len());
        if nr == 0 || nc == 0 {
            return Err("a table needs at least one row and one column".into());
        }
        if self.cells.len() != nr || self.cells.iter().any(|r| r.len() != nc) {
            return Err(format!("table cells must be {nr} × {nc}"));
        }
        if self.rows.iter().any(|r| r.height.0 < 0) || self.cols.iter().any(|c| c.width.0 < 0) {
            return Err("table sizes must not be negative".into());
        }
        let mut owner = vec![vec![false; nc]; nr];
        for (r, row) in self.cells.iter().enumerate() {
            for (c, cell) in row.iter().enumerate() {
                if cell.row_span == 0 || cell.col_span == 0 {
                    return Err(format!("cell {r},{c}: spans must be at least 1"));
                }
                if cell.covered {
                    if cell.row_span != 1 || cell.col_span != 1 {
                        return Err(format!("covered cell {r},{c} must not span"));
                    }
                    continue;
                }
                let (re, ce) = (r + cell.row_span as usize, c + cell.col_span as usize);
                if re > nr || ce > nc {
                    return Err(format!("cell {r},{c}: merged region leaves the table"));
                }
                for (rr, own) in owner.iter_mut().enumerate().take(re).skip(r) {
                    for (cc, o) in own.iter_mut().enumerate().take(ce).skip(c) {
                        if *o {
                            return Err(format!("cell {rr},{cc} is in two merged regions"));
                        }
                        *o = true;
                        let inner = &self.cells[rr][cc];
                        if (rr, cc) != (r, c) && !inner.covered {
                            return Err(format!("cell {rr},{cc} must be covered"));
                        }
                    }
                }
            }
        }
        if let Some((r, row)) = owner.iter().enumerate().find(|(_, o)| o.contains(&false)) {
            let c = row.iter().position(|o| !o).unwrap_or(0);
            return Err(format!("covered cell {r},{c} belongs to no merged region"));
        }
        Ok(())
    }

    /// Inserts an empty row at `index` (`0..=rows`), with the height,
    /// fills, borders and margins of the row above (of the first row when
    /// inserting at the top). Merged regions that span the insertion point
    /// grow by one row.
    pub fn insert_row(&mut self, index: usize) -> Result<(), String> {
        let nr = self.rows.len();
        if index > nr {
            return Err(format!("row index {index} out of range 0..={nr}"));
        }
        let tpl = index.saturating_sub(1).min(nr - 1);
        let mut row: Vec<TableCell> = self.cells[tpl].iter().map(TableCell::blank_like).collect();
        if index > 0 && index < nr {
            for (c, cell) in row.iter_mut().enumerate() {
                let (ar, ac) = self.anchor_of(index, c);
                if ar < index {
                    // a region crossing the insertion point grows
                    cell.covered = true;
                    if ac == c {
                        self.cells[ar][ac].row_span += 1;
                    }
                }
            }
        }
        self.rows.insert(index, self.rows[tpl]);
        self.cells.insert(index, row);
        Ok(())
    }

    /// Inserts an empty column at `index` (`0..=cols`), as wide as the
    /// column left of it (the first column when inserting at the left),
    /// with its fills, borders and margins. Merged regions spanning the
    /// insertion point grow by one column.
    pub fn insert_col(&mut self, index: usize) -> Result<(), String> {
        let nc = self.cols.len();
        if index > nc {
            return Err(format!("column index {index} out of range 0..={nc}"));
        }
        let tpl = index.saturating_sub(1).min(nc - 1);
        let mut grow = Vec::new();
        let mut covered = vec![false; self.rows.len()];
        if index > 0 && index < nc {
            for (r, cov) in covered.iter_mut().enumerate() {
                let (ar, ac) = self.anchor_of(r, index);
                if ac < index {
                    *cov = true;
                    if ar == r {
                        grow.push((ar, ac));
                    }
                }
            }
        }
        for (ar, ac) in grow {
            self.cells[ar][ac].col_span += 1;
        }
        for (r, row) in self.cells.iter_mut().enumerate() {
            let mut cell = row[tpl].blank_like();
            cell.covered = covered[r];
            row.insert(index, cell);
        }
        self.cols.insert(index, self.cols[tpl]);
        Ok(())
    }

    /// Deletes row `index`; merged regions crossing it shrink (a region
    /// whose anchor is in the row moves its anchor, with the text, one row
    /// down). The last row cannot be deleted.
    pub fn delete_row(&mut self, index: usize) -> Result<(), String> {
        let nr = self.rows.len();
        if index >= nr {
            return Err(format!("row index {index} out of range 0..{nr}"));
        }
        if nr == 1 {
            return Err("cannot delete the only row".into());
        }
        for c in 0..self.cols.len() {
            let (ar, ac) = self.anchor_of(index, c);
            if ac != c {
                continue;
            }
            let span = self.cells[ar][ac].row_span;
            if span <= 1 {
                continue;
            }
            if ar < index {
                self.cells[ar][ac].row_span -= 1;
            } else {
                // anchor in the deleted row: the cell below takes over
                let mut anchor = self.cells[ar][ac].clone();
                anchor.row_span -= 1;
                self.cells[ar + 1][ac] = anchor;
            }
        }
        self.rows.remove(index);
        self.cells.remove(index);
        Ok(())
    }

    /// Deletes column `index` (see [`delete_row`](Self::delete_row)).
    pub fn delete_col(&mut self, index: usize) -> Result<(), String> {
        let nc = self.cols.len();
        if index >= nc {
            return Err(format!("column index {index} out of range 0..{nc}"));
        }
        if nc == 1 {
            return Err("cannot delete the only column".into());
        }
        for r in 0..self.rows.len() {
            let (ar, ac) = self.anchor_of(r, index);
            if ar != r {
                continue;
            }
            let span = self.cells[ar][ac].col_span;
            if span <= 1 {
                continue;
            }
            if ac < index {
                self.cells[ar][ac].col_span -= 1;
            } else {
                let mut anchor = self.cells[ar][ac].clone();
                anchor.col_span -= 1;
                self.cells[ar][ac + 1] = anchor;
            }
        }
        self.cols.remove(index);
        for row in &mut self.cells {
            row.remove(index);
        }
        Ok(())
    }

    /// Merges the `row_span` × `col_span` cells at `row`, `col` into one
    /// (PowerPoint's Merge Cells): the paragraphs of the non-empty cells
    /// are joined into the top-left cell in reading order. The range must
    /// contain every merged region it touches, and hold at least two cells.
    pub fn merge(
        &mut self,
        row: usize,
        col: usize,
        row_span: usize,
        col_span: usize,
    ) -> Result<(), String> {
        let (re, ce) = (row + row_span, col + col_span);
        if row_span == 0 || col_span == 0 || re > self.rows.len() || ce > self.cols.len() {
            return Err(format!(
                "cell range {row},{col} {row_span}×{col_span} out of the table"
            ));
        }
        if row_span * col_span < 2 {
            return Err("merging needs at least two cells".into());
        }
        for r in row..re {
            for c in col..ce {
                let (ar, ac) = self.anchor_of(r, c);
                let a = &self.cells[ar][ac];
                if ar < row
                    || ac < col
                    || ar + a.row_span as usize > re
                    || ac + a.col_span as usize > ce
                {
                    return Err(format!("cell {r},{c} is part of a larger merged region"));
                }
            }
        }
        let mut paragraphs = Vec::new();
        for r in row..re {
            for c in col..ce {
                let cell = &mut self.cells[r][c];
                if !cell.covered && !cell.is_empty() {
                    paragraphs.append(&mut cell.text.paragraphs);
                }
                if (r, c) != (row, col) {
                    *cell = TableCell {
                        covered: true,
                        ..cell.blank_like()
                    };
                }
            }
        }
        let anchor = &mut self.cells[row][col];
        if paragraphs.is_empty() {
            paragraphs.push(TextParagraph::new());
        }
        anchor.text.paragraphs = paragraphs;
        anchor.row_span = row_span as u32;
        anchor.col_span = col_span as u32;
        anchor.covered = false;
        Ok(())
    }

    /// Splits the merged cell anchored at `row`, `col` back into single
    /// cells (the text stays in the top-left one).
    pub fn split(&mut self, row: usize, col: usize) -> Result<(), String> {
        let cell = self
            .cell(row, col)
            .ok_or_else(|| format!("cell {row},{col} out of the table"))?;
        if cell.covered || (cell.row_span == 1 && cell.col_span == 1) {
            return Err(format!("cell {row},{col} is not a merged cell"));
        }
        let (rs, cs) = (cell.row_span as usize, cell.col_span as usize);
        for r in row..row + rs {
            for c in col..col + cs {
                let cell = &mut self.cells[r][c];
                cell.covered = false;
                cell.row_span = 1;
                cell.col_span = 1;
            }
        }
        Ok(())
    }

    /// PowerPoint's Split Cells: cell `row`, `col` becomes `rows` × `cols`
    /// cells. A merged cell whose spans are multiples of the counts is
    /// split into equal merged blocks; a single cell splits its column(s)
    /// and row(s) into equal parts, and the other cells of those columns
    /// and rows are merged across the new grid lines so that they stay
    /// whole. The text stays in the top-left part.
    pub fn split_grid(
        &mut self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
    ) -> Result<(), String> {
        let cell = self
            .cell(row, col)
            .ok_or_else(|| format!("cell {row},{col} out of the table"))?;
        if cell.covered {
            return Err(format!("cell {row},{col} is covered by a merged cell"));
        }
        if rows == 0 || cols == 0 || rows > 50 || cols > 50 {
            return Err("split into 1–50 rows and columns".into());
        }
        let (rs, cs) = (cell.row_span as usize, cell.col_span as usize);
        if rs > 1 || cs > 1 {
            if rs % rows != 0 || cs % cols != 0 {
                return Err(format!(
                    "a merged cell of {rs} × {cs} cannot be split into {rows} × {cols}"
                ));
            }
            self.split(row, col)?;
            let (br, bc) = (rs / rows, cs / cols);
            for i in 0..rows {
                for j in 0..cols {
                    if br > 1 || bc > 1 {
                        self.merge(row + i * br, col + j * bc, br, bc)?;
                    }
                }
            }
            return Ok(());
        }
        // columns: `cols − 1` new grid columns right of `col`
        if cols > 1 {
            let parts = split_evenly(self.cols[col].width.0, cols);
            self.cols[col].width = parts[0];
            for (k, w) in parts.iter().enumerate().skip(1) {
                self.cols.insert(col + k, ColSpec { width: *w });
            }
            let mut grow = Vec::new();
            for r in 0..self.rows.len() {
                let (ar, ac) = self.anchor_of(r, col);
                let tpl = self.cells[r][col].blank_like();
                for k in 1..cols {
                    let mut c = tpl.clone();
                    c.covered = r != row;
                    self.cells[r].insert(col + k, c);
                }
                if r != row && !grow.contains(&(ar, ac)) {
                    grow.push((ar, ac));
                }
            }
            for (ar, ac) in grow {
                self.cells[ar][ac].col_span += (cols - 1) as u32;
            }
        }
        // rows: `rows − 1` new grid rows below `row`
        if rows > 1 {
            let parts = split_evenly(self.rows[row].height.0, rows);
            self.rows[row].height = parts[0];
            for (k, h) in parts.iter().enumerate().skip(1) {
                self.rows.insert(row + k, RowSpec { height: *h });
            }
            let nc = self.cols.len();
            let mut grow = Vec::new();
            let mut new_rows: Vec<Vec<TableCell>> = Vec::new();
            for _ in 1..rows {
                let mut cells = Vec::with_capacity(nc);
                for c in 0..nc {
                    let mut cell = self.cells[row][c].blank_like();
                    let inside = c >= col && c < col + cols;
                    cell.covered = !inside;
                    if !inside {
                        let a = self.anchor_of(row, c);
                        if !grow.contains(&a) {
                            grow.push(a);
                        }
                    }
                    cells.push(cell);
                }
                new_rows.push(cells);
            }
            for (k, cells) in new_rows.into_iter().enumerate() {
                self.cells.insert(row + 1 + k, cells);
            }
            for (ar, ac) in grow {
                self.cells[ar][ac].row_span += (rows - 1) as u32;
            }
        }
        self.validate()
    }

    /// The formatting the table style gives cell `row`, `col`, for
    /// PowerPoint's built-in styles ([`crate::tablestyle`]); unknown style
    /// ids (and no style) give no fill, no borders and plain text. See
    /// [`style_cell_with`](Self::style_cell_with) for a presentation's own
    /// styles.
    pub fn style_cell(&self, row: usize, col: usize) -> StyleCell {
        self.style_cell_with(&[], row, col)
    }

    /// The style's formatting of cell `row`, `col`, looking the style up in
    /// `custom` (the presentation's imported styles) and then among the
    /// built-ins.
    pub fn style_cell_with(&self, custom: &[TableStyleDef], row: usize, col: usize) -> StyleCell {
        let plain = StyleCell {
            fill: Fill::None,
            borders: CellBorders::default(),
            bold: false,
            text_color: None,
        };
        let Some(id) = self.style_id.as_deref() else {
            return plain;
        };
        let def = custom
            .iter()
            .find(|s| s.id.eq_ignore_ascii_case(id))
            .or_else(|| builtin_table_style(id));
        match def {
            Some(d) => d.cell(self.look, self.rows.len(), self.cols.len(), row, col),
            None => plain,
        }
    }

    /// The fill cell `row`, `col` is drawn with (its own, else the
    /// style's).
    pub fn effective_fill(&self, row: usize, col: usize) -> Fill {
        self.cell(row, col)
            .and_then(|c| c.fill)
            .unwrap_or_else(|| self.style_cell(row, col).fill)
    }

    /// The borders cell `row`, `col` is drawn with (its own where set,
    /// else the style's).
    pub fn effective_borders(&self, row: usize, col: usize) -> CellBorders {
        let style = self.style_cell(row, col).borders;
        let own = self.cell(row, col).map(|c| c.borders).unwrap_or_default();
        CellBorders {
            left: own.left.or(style.left),
            right: own.right.or(style.right),
            top: own.top.or(style.top),
            bottom: own.bottom.or(style.bottom),
            diag_down: own.diag_down,
            diag_up: own.diag_up,
        }
    }

    /// Normalizes every cell's text (at least one paragraph).
    pub fn normalize(&mut self) {
        for cell in self.cells.iter_mut().flatten() {
            cell.text.normalize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(t: &Table) -> Vec<Vec<String>> {
        t.cells
            .iter()
            .map(|r| {
                r.iter()
                    .map(|c| {
                        if c.covered {
                            "-".into()
                        } else {
                            c.text.plain_text()
                        }
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn split_grid_single_and_merged() {
        let mut t = filled(3, 3);
        // the middle cell into 2 × 3: its column becomes three, its row two
        t.split_grid(1, 1, 2, 3).unwrap();
        assert_eq!((t.rows.len(), t.cols.len()), (4, 5));
        assert_eq!(
            text(&t),
            [
                ["00", "01", "-", "-", "02"],
                ["10", "11", "", "", "12"],
                ["-", "", "", "", "-"],
                ["20", "21", "-", "-", "22"],
            ]
        );
        assert_eq!(t.cells[0][1].col_span, 3);
        assert_eq!(t.cells[1][0].row_span, 2);
        // widths and heights are shared, the totals stay
        assert_eq!(t.width(), Emu(3_000));
        assert_eq!(t.height(), Emu(1_000));
        // a merged 2 × 2 block into 2 × 1: two cells merged across
        let mut m = filled(2, 2);
        m.merge(0, 0, 2, 2).unwrap();
        m.split_grid(0, 0, 2, 1).unwrap();
        assert_eq!((m.cells[0][0].col_span, m.cells[1][0].col_span), (2, 2));
        assert!(m.split_grid(0, 0, 3, 1).is_err());
        assert!(m.split_grid(0, 1, 1, 1).is_err(), "covered");
    }

    #[test]
    fn split_merged_cells_like_powerpoint() {
        // a 2 × 2 merged cell split 2 × 2: four single cells, the text in
        // the top-left one, the grid unchanged
        let mut t = filled(3, 3);
        t.merge(0, 0, 2, 2).unwrap();
        t.split_grid(0, 0, 2, 2).unwrap();
        assert_eq!((t.rows.len(), t.cols.len()), (3, 3));
        assert!(t.cells[..2].iter().all(|r| r[..2]
            .iter()
            .all(|c| !c.covered && c.row_span == 1 && c.col_span == 1)));
        assert_eq!(t.cells[0][0].text.plain_text(), "00\n01\n10\n11");
        assert!(t.cells[1][1].is_empty());
        // a 2 × 4 region split 1 × 2: two 2 × 2 blocks
        let mut w = filled(2, 4);
        w.merge(0, 0, 2, 4).unwrap();
        w.split_grid(0, 0, 1, 2).unwrap();
        assert_eq!((w.cells[0][0].row_span, w.cells[0][0].col_span), (2, 2));
        assert_eq!((w.cells[0][2].row_span, w.cells[0][2].col_span), (2, 2));
        assert!(w.cells[1][3].covered);
        w.validate().unwrap();
        // the new cells take the split cell's borders (diagonals too)
        let mut d = filled(1, 1);
        d.cells[0][0].borders.diag_down = Some(Line::solid(
            Color::theme(core_model::ThemeColorSlot::Dark1),
            Emu(12_700),
        ));
        d.split_grid(0, 0, 1, 2).unwrap();
        assert!(d.cells[0][1].borders.diag_down.is_some());
    }

    fn filled(rows: usize, cols: usize) -> Table {
        let mut t = Table::new(rows, cols, Emu(3_000), Emu(1_000));
        for r in 0..rows {
            for c in 0..cols {
                t.cells[r][c].text = TextBody::plain(&format!("{r}{c}"));
            }
        }
        t
    }

    #[test]
    fn new_table_and_scaling() {
        let t = Table::new(2, 3, Emu(1_000), Emu(301));
        assert_eq!(t.width(), Emu(1_000));
        assert_eq!(t.height(), Emu(301));
        assert_eq!(t.cols[0].width, Emu(334));
        assert_eq!(t.rows[0].height, Emu(151));
        t.validate().unwrap();
        let mut t = t;
        t.scale_to(Emu(2_000), Emu(602));
        assert_eq!(t.width(), Emu(2_000));
        assert_eq!(t.height(), Emu(602));
        assert_eq!(t.cols[1].width, Emu(666));
        let json = serde_json::to_string(&t.cells[0][0]).unwrap();
        assert_eq!(
            json,
            r#"{"text":{"props":{"anchor":"top","wrap":true,"insets":{"left":91440,"top":45720,"right":91440,"bottom":45720},"autofit":"none"},"paragraphs":[{"runs":[]}]}}"#
        );
        assert_eq!(
            serde_json::from_str::<TableCell>(&json).unwrap(),
            t.cells[0][0]
        );
    }

    #[test]
    fn merge_split_and_validate() {
        let mut t = filled(3, 3);
        t.merge(0, 0, 2, 2).unwrap();
        t.validate().unwrap();
        assert_eq!(
            text(&t),
            [
                ["00\n01\n10\n11", "-", "02"],
                ["-", "-", "12"],
                ["20", "21", "22"]
            ]
        );
        assert_eq!(t.anchor_of(1, 1), (0, 0));
        assert_eq!(t.anchor_of(1, 2), (1, 2));
        // overlapping a merged region partially is refused
        assert!(t.merge(1, 1, 2, 2).is_err());
        assert!(t.merge(0, 0, 1, 1).is_err());
        // a range containing the region is fine
        t.merge(0, 0, 3, 2).unwrap();
        t.validate().unwrap();
        assert_eq!(t.cells[0][0].row_span, 3);
        t.split(0, 0).unwrap();
        t.validate().unwrap();
        assert_eq!(
            text(&t),
            [
                ["00\n01\n10\n11\n20\n21", "", "02"],
                ["", "", "12"],
                ["", "", "22"]
            ]
        );
        assert!(t.split(0, 0).is_err());
        // broken tables are reported
        let mut bad = filled(2, 2);
        bad.cells[0][1].covered = true;
        assert!(bad.validate().unwrap_err().contains("no merged region"));
        let mut bad = filled(2, 2);
        bad.cells[1][1].col_span = 2;
        assert!(bad.validate().unwrap_err().contains("leaves the table"));
        let mut bad = filled(2, 2);
        bad.cells.pop();
        assert!(bad.validate().is_err());
    }

    #[test]
    fn insert_and_delete_with_merges() {
        let mut t = filled(3, 3);
        t.merge(0, 1, 2, 2).unwrap();
        // inserting inside the region grows it
        t.insert_row(1).unwrap();
        t.validate().unwrap();
        assert_eq!(t.cells[0][1].row_span, 3);
        assert_eq!(text(&t)[1], ["", "-", "-"]);
        // at the edges it does not
        t.insert_row(0).unwrap();
        t.insert_row(5).unwrap();
        t.validate().unwrap();
        assert_eq!(t.row_count(), 6);
        assert_eq!(t.cells[1][1].row_span, 3);
        t.insert_col(2).unwrap();
        t.validate().unwrap();
        assert_eq!(t.cells[1][1].col_span, 3);
        assert_eq!(t.cols[2].width, t.cols[1].width);
        // deleting the anchor's row moves the anchor down
        t.delete_row(1).unwrap();
        t.validate().unwrap();
        assert_eq!(t.cells[1][1].row_span, 2);
        assert!(t.cells[1][1].text.plain_text().starts_with("01"));
        t.delete_col(1).unwrap();
        t.validate().unwrap();
        assert_eq!(t.cells[1][1].col_span, 2);
        t.delete_col(1).unwrap();
        t.delete_col(1).unwrap();
        t.validate().unwrap();
        assert_eq!(t.col_count(), 1);
        assert!(t.delete_col(0).is_err());
        assert!(t.insert_row(99).is_err());
    }

    #[test]
    fn default_style_appearance() {
        let mut t = Table::new(4, 2, Emu(100), Emu(100));
        let fill = |t: &Table, r| match t.effective_fill(r, 0) {
            Fill::Solid(Color::Theme { tint, .. }) => tint,
            f => panic!("{f:?}"),
        };
        // header, then band1 (40 %), band2 (20 %), band1
        assert_eq!([0, 1, 2, 3].map(|r| fill(&t, r)), [0.0, 0.6, 0.8, 0.6]);
        assert!(t.style_cell(0, 0).bold);
        assert_eq!(
            t.style_cell(0, 0).borders.bottom.unwrap().width,
            Emu(38_100)
        );
        t.look.first_row = false;
        assert_eq!([0, 1, 2, 3].map(|r| fill(&t, r)), [0.6, 0.8, 0.6, 0.8]);
        t.cells[1][0].fill = Some(Fill::None);
        assert_eq!(t.effective_fill(1, 0), Fill::None);
        t.style_id = None;
        assert_eq!(t.effective_fill(2, 0), Fill::None);
        assert!(t.effective_borders(2, 0).is_empty());
    }
}
