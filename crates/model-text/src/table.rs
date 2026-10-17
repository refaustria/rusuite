//! Table grid helpers: merged cells ([`Table::merge_cells`],
//! [`Table::split_cell`]), grid geometry and the effective formatting of
//! a cell under its table style ([`Document::resolve_cell_props`]).
//!
//! Coordinates: rows are indices into [`Table::rows`]; *grid columns*
//! count the columns of the table grid (a cell with `grid_span = 2`
//! covers two of them); *cell indices* are indices into
//! [`TableRow::cells`](crate::TableRow::cells).

use core_model::units::Twips;
use core_model::RunProperties;

use crate::block::{Block, NodeId, Paragraph, Table, TableCell, TableRow};
use crate::document::Document;
use crate::props::{
    BorderSide, CellProperties, ParagraphProperties, TableBorders, TableLook, TableWidth, VMerge,
};
use crate::style::{merge_cell_props, ConditionalKind, StyleKind, TableStyle};
use crate::Error;

fn err(msg: impl Into<String>) -> Error {
    Error::Table(msg.into())
}

/// Whether `blocks` is just one empty paragraph (an "empty" cell).
fn is_empty_content(blocks: &[Block]) -> bool {
    match blocks {
        [] => true,
        [Block::Paragraph(p)] => p.inlines.is_empty(),
        _ => false,
    }
}

impl Table {
    /// Number of grid columns: the widest row (sum of spans).
    pub fn grid_cols(&self) -> usize {
        self.rows
            .iter()
            .map(|r| r.cells.iter().map(TableCell::span).sum::<usize>())
            .max()
            .unwrap_or(0)
    }

    /// The grid column where cell `cell` of row `row` starts.
    pub fn grid_start(&self, row: usize, cell: usize) -> Option<usize> {
        let r = self.rows.get(row)?;
        (cell < r.cells.len()).then(|| r.cells[..cell].iter().map(TableCell::span).sum())
    }

    /// The index of the cell of row `row` covering grid column `col`.
    pub fn cell_at(&self, row: usize, col: usize) -> Option<usize> {
        let mut start = 0;
        for (i, c) in self.rows.get(row)?.cells.iter().enumerate() {
            if col < start + c.span() {
                return Some(i);
            }
            start += c.span();
        }
        None
    }

    /// The cell of row `row` starting exactly at grid column `col` with
    /// span `span`.
    fn cell_exactly(&self, row: usize, col: usize, span: usize) -> Option<usize> {
        let i = self.cell_at(row, col)?;
        (self.grid_start(row, i) == Some(col) && self.rows[row].cells[i].span() == span)
            .then_some(i)
    }

    /// The top-left cell `(row, cell)` of the merged region holding cell
    /// `cell` of row `row` (itself unless it is a `Continue` cell).
    pub fn merge_origin(&self, row: usize, cell: usize) -> (usize, usize) {
        let (mut r, mut c) = (row, cell);
        while r > 0 && self.rows[r].cells.get(c).and_then(|x| x.v_merge) == Some(VMerge::Continue) {
            let (Some(col), span) = (self.grid_start(r, c), self.rows[r].cells[c].span()) else {
                break;
            };
            match self.cell_exactly(r - 1, col, span) {
                Some(above) => {
                    r -= 1;
                    c = above;
                }
                None => break,
            }
        }
        (r, c)
    }

    /// Number of rows the cell `(row, cell)` covers: 1, or for a
    /// `Restart` cell 1 + the `Continue` cells below it.
    pub fn row_span(&self, row: usize, cell: usize) -> usize {
        let Some(c) = self.rows.get(row).and_then(|r| r.cells.get(cell)) else {
            return 0;
        };
        if c.v_merge != Some(VMerge::Restart) {
            return 1;
        }
        let (Some(col), span) = (self.grid_start(row, cell), c.span()) else {
            return 1;
        };
        let mut n = 1;
        while let Some(i) = self.cell_exactly(row + n, col, span) {
            if self.rows[row + n].cells[i].v_merge != Some(VMerge::Continue) {
                break;
            }
            n += 1;
        }
        n
    }

    /// Checks the grid invariants: every row covers the same number of
    /// grid columns, spans are ≥ 1, every `Continue` cell continues a
    /// cell with the same grid column and span in the row above.
    pub fn check_grid(&self) -> Result<(), Error> {
        let cols = self.grid_cols();
        for (r, row) in self.rows.iter().enumerate() {
            if row.cells.iter().any(|c| c.grid_span == 0) {
                return Err(err(format!("row {r}: grid span 0")));
            }
            let n: usize = row.cells.iter().map(TableCell::span).sum();
            if n != cols {
                return Err(err(format!("row {r} covers {n} of {cols} grid columns")));
            }
            for (i, c) in row.cells.iter().enumerate() {
                if c.v_merge != Some(VMerge::Continue) {
                    continue;
                }
                let col = self.grid_start(r, i).unwrap_or(0);
                let above = r
                    .checked_sub(1)
                    .and_then(|a| self.cell_exactly(a, col, c.span()).map(|k| (a, k)));
                match above {
                    Some((a, k)) if self.rows[a].cells[k].v_merge.is_some() => {}
                    _ => return Err(err(format!("row {r}, cell {i}: dangling vertical merge"))),
                }
            }
        }
        Ok(())
    }

    /// Repairs vertical merges after rows changed: a `Continue` cell
    /// without a merged cell of the same grid column and span above it
    /// starts the region instead; a `Restart` cell without a `Continue`
    /// below becomes a plain cell.
    pub fn normalize_merges(&mut self) {
        for r in 0..self.rows.len() {
            for i in 0..self.rows[r].cells.len() {
                let c = &self.rows[r].cells[i];
                if c.v_merge != Some(VMerge::Continue) {
                    continue;
                }
                let (col, span) = (self.grid_start(r, i).unwrap_or(0), c.span());
                let ok = r > 0
                    && self
                        .cell_exactly(r - 1, col, span)
                        .is_some_and(|k| self.rows[r - 1].cells[k].v_merge.is_some());
                if !ok {
                    // Starts what is left of the region (cleared below
                    // if nothing continues it).
                    self.rows[r].cells[i].v_merge = Some(VMerge::Restart);
                }
            }
        }
        for r in 0..self.rows.len() {
            for i in 0..self.rows[r].cells.len() {
                let c = &self.rows[r].cells[i];
                if c.v_merge != Some(VMerge::Restart) {
                    continue;
                }
                let (col, span) = (self.grid_start(r, i).unwrap_or(0), c.span());
                let ok = self
                    .cell_exactly(r + 1, col, span)
                    .is_some_and(|k| self.rows[r + 1].cells[k].v_merge == Some(VMerge::Continue));
                if !ok {
                    self.rows[r].cells[i].v_merge = None;
                }
            }
        }
    }

    /// Pads rows that cover fewer grid columns than the widest row with
    /// empty cells at their end (Word fills a ragged row when columns are
    /// inserted or tables are joined); ids from `alloc` (a cell id and a
    /// paragraph id per new cell). Returns the number of cells added.
    pub fn pad_rows(&mut self, mut alloc: impl FnMut() -> NodeId) -> usize {
        let cols = self.grid_cols();
        let mut added = 0;
        for row in &mut self.rows {
            let have: usize = row.cells.iter().map(TableCell::span).sum();
            if have >= cols {
                continue;
            }
            let model = row.cells.last().map(|c| CellProperties {
                width: None,
                ..c.props
            });
            for _ in have..cols {
                let id = alloc();
                let pid = alloc();
                row.cells.push(TableCell::new(
                    id,
                    model.unwrap_or_default(),
                    vec![Block::Paragraph(Paragraph::new(pid))],
                ));
                added += 1;
            }
        }
        added
    }

    /// Splits the table before row `at` (Word's Split Table): the rows
    /// from `at` on move into a new table with id `id` and the same table
    /// properties; vertical merges crossing the cut start again in the new
    /// table. Errors unless `0 < at < rows`.
    pub fn split_off_rows(&mut self, at: usize, id: NodeId) -> Result<Table, Error> {
        if at == 0 || at >= self.rows.len() {
            return Err(err("split the table between two of its rows"));
        }
        let rows = self.rows.split_off(at);
        let mut second = Table {
            id,
            props: self.props.clone(),
            rows,
        };
        self.normalize_merges();
        second.normalize_merges();
        Ok(second)
    }

    /// Appends the rows of `other` (Word joins two tables when the
    /// paragraph between them is deleted). The grid of the table with
    /// more columns wins; rows of the other one are padded
    /// ([`pad_rows`](Self::pad_rows)). Header rows of `other` stop being
    /// header rows (they are not at the top any more).
    pub fn append_rows(&mut self, other: Table, alloc: impl FnMut() -> NodeId) {
        let (mine, theirs) = (self.grid_cols(), other.grid_cols());
        if theirs > mine && !other.props.col_widths.is_empty() {
            self.props.col_widths = other.props.col_widths.clone();
        }
        let first = self.rows.len();
        self.rows.extend(other.rows);
        for row in &mut self.rows[first..] {
            row.props.header = false;
        }
        self.pad_rows(alloc);
        self.normalize_merges();
    }

    /// The cells of row `row` inside grid columns `c0..=c1` as an index
    /// range; errors when a cell sticks out or the row does not cover
    /// the columns.
    fn cells_in(&self, row: usize, c0: usize, c1: usize) -> Result<(usize, usize), Error> {
        let (mut first, mut last) = (None, None);
        let mut start = 0;
        for (i, c) in self.rows[row].cells.iter().enumerate() {
            let end = start + c.span();
            if end > c0 && start <= c1 {
                if start < c0 || end > c1 + 1 {
                    return Err(err("the cells to merge do not form a rectangle"));
                }
                first.get_or_insert(i);
                last = Some(i);
            }
            start = end;
        }
        match (first, last) {
            (Some(f), Some(l)) if start > c1 => Ok((f, l)),
            _ => Err(err(format!("row {row} does not cover the columns"))),
        }
    }

    /// Merges the rectangle of rows `r0..=r1` and grid columns `c0..=c1`
    /// into one cell, as Word does: the top-left cell keeps its id and
    /// properties and receives the content of all non-empty cells in
    /// reading order; it spans the columns (`grid_span`) and, over
    /// several rows, starts a vertical merge whose `Continue` cells (one
    /// per further row, holding an empty paragraph with an id from
    /// `alloc`) keep the id of their row's first merged cell. The other
    /// cells disappear. Errors when the rectangle cuts a cell or a merged
    /// region.
    pub fn merge_cells(
        &mut self,
        r0: usize,
        c0: usize,
        r1: usize,
        c1: usize,
        mut alloc: impl FnMut() -> NodeId,
    ) -> Result<(), Error> {
        if r0 > r1 || c0 > c1 || r1 >= self.rows.len() || c1 >= self.grid_cols() {
            return Err(err("merge range out of the table"));
        }
        let mut ranges = Vec::with_capacity(r1 - r0 + 1);
        for r in r0..=r1 {
            ranges.push(self.cells_in(r, c0, c1)?);
        }
        let (f0, l0) = ranges[0];
        if self.rows[r0].cells[f0..=l0]
            .iter()
            .any(|c| c.v_merge == Some(VMerge::Continue))
        {
            return Err(err("the range cuts a vertically merged cell"));
        }
        if r1 + 1 < self.rows.len() {
            if let Ok((f, l)) = self.cells_in(r1 + 1, c0, c1) {
                if self.rows[r1 + 1].cells[f..=l]
                    .iter()
                    .any(|c| c.v_merge == Some(VMerge::Continue))
                {
                    return Err(err("the range cuts a vertically merged cell"));
                }
            } else if (c0..=c1).any(|col| {
                self.cell_at(r1 + 1, col)
                    .is_some_and(|i| self.rows[r1 + 1].cells[i].v_merge == Some(VMerge::Continue))
            }) {
                return Err(err("the range cuts a vertically merged cell"));
            }
        }
        if r0 == r1 && f0 == l0 {
            return Ok(()); // one cell: nothing to merge
        }
        let span = u16::try_from(c1 - c0 + 1).map_err(|_| err("span too large"))?;
        // Content in reading order; empty cells and covered cells add nothing.
        let mut content: Vec<Block> = Vec::new();
        for (k, &(f, l)) in ranges.iter().enumerate() {
            for c in &mut self.rows[r0 + k].cells[f..=l] {
                if c.v_merge == Some(VMerge::Continue) || is_empty_content(&c.blocks) {
                    continue;
                }
                content.append(&mut c.blocks);
            }
        }
        let width = {
            let cells = &self.rows[r0].cells[f0..=l0];
            let sum: Option<i32> = cells
                .iter()
                .map(|c| match c.props.width {
                    Some(TableWidth::Twips(t)) => Some(t.0),
                    _ => None,
                })
                .sum();
            sum.map(|w| TableWidth::Twips(Twips(w)))
                .or(cells[0].props.width)
        };
        for (k, &(f, l)) in ranges.iter().enumerate().rev() {
            let row = &mut self.rows[r0 + k];
            let mut removed: Vec<TableCell> = row.cells.drain(f..=l).collect();
            let mut cell = removed.swap_remove(0);
            cell.grid_span = span;
            cell.props.width = width;
            if k == 0 {
                cell.v_merge = (r1 > r0).then_some(VMerge::Restart);
                if !content.is_empty() {
                    cell.blocks = std::mem::take(&mut content);
                } else if cell.blocks.is_empty() {
                    cell.blocks = vec![Block::Paragraph(Paragraph::new(alloc()))];
                }
            } else {
                cell.v_merge = Some(VMerge::Continue);
                cell.blocks = vec![Block::Paragraph(Paragraph::new(alloc()))];
            }
            row.cells.insert(f, cell);
        }
        Ok(())
    }

    /// Splits the cell covering grid column `col` of row `row` (or the
    /// merged region it belongs to) into `rows × cols` cells, as Word
    /// does: the first new cell keeps the id, properties and content;
    /// the others are empty (ids from `alloc`). A merged region is first
    /// divided along its grid columns and rows where they fit; new grid
    /// columns are added when `cols` does not divide its span (the
    /// column widths are split evenly and cells of other rows widen
    /// their span), new rows are added when the cell covers one row.
    /// `rows` must divide a merged region's row count.
    pub fn split_cell(
        &mut self,
        row: usize,
        col: usize,
        rows: usize,
        cols: usize,
        mut alloc: impl FnMut() -> NodeId,
    ) -> Result<(), Error> {
        if rows == 0 || cols == 0 || rows > 64 || cols > 63 {
            return Err(err("split into 1..=64 rows and 1..=63 columns"));
        }
        let ci = self
            .cell_at(row, col)
            .ok_or_else(|| err("no cell at that position"))?;
        let (r, ci) = self.merge_origin(row, ci);
        let s0 = self.grid_start(r, ci).unwrap_or(0);
        let span = self.rows[r].cells[ci].span();
        let h = self.row_span(r, ci);
        if h > 1 && h % rows != 0 {
            return Err(err(format!(
                "a cell merged over {h} rows cannot be split into {rows} rows"
            )));
        }
        if rows == 1 && cols == 1 {
            return Ok(());
        }
        let ncols = self.grid_cols();

        // --- columns: new grid boundaries ------------------------------
        let real = self.props.col_widths.len() == ncols && ncols > 0;
        let widths: Vec<i64> = if real {
            self.props
                .col_widths
                .iter()
                .map(|w| i64::from(w.0.max(0)))
                .collect()
        } else {
            vec![cols as i64; ncols]
        };
        let mut bounds = vec![0i64];
        for w in &widths {
            bounds.push(bounds.last().copied().unwrap_or(0) + w);
        }
        let (x0, x1) = (bounds[s0], bounds[s0 + span]);
        let inner: Vec<i64> = (0..=cols as i64)
            .map(|k| x0 + (x1 - x0) * k / cols as i64)
            .collect();
        let mut new_bounds = bounds.clone();
        new_bounds.extend(inner.iter().copied());
        new_bounds.sort_unstable();
        new_bounds.dedup();
        if inner.windows(2).any(|w| w[0] == w[1]) {
            return Err(err("the cell is too narrow to split"));
        }
        let idx = |x: i64| new_bounds.binary_search(&x).unwrap_or(0);
        let to_span = |n: usize| u16::try_from(n.max(1)).unwrap_or(u16::MAX);

        // Re-span every cell to the refined grid.
        for row_cells in self.rows.iter_mut().map(|r| &mut r.cells) {
            let mut start = 0;
            for c in row_cells.iter_mut() {
                let end = start + c.span();
                if end < bounds.len() {
                    c.grid_span = to_span(idx(bounds[end]) - idx(bounds[start]));
                }
                start = end;
            }
        }
        if real {
            self.props.col_widths = new_bounds
                .windows(2)
                .map(|w| Twips(i32::try_from(w[1] - w[0]).unwrap_or(i32::MAX)))
                .collect();
        }
        let piece_spans: Vec<u16> = inner
            .windows(2)
            .map(|w| to_span(idx(w[1]) - idx(w[0])))
            .collect();
        let piece_width = |c: &TableCell, k: usize| match c.props.width {
            Some(TableWidth::Twips(t)) if real => Some(TableWidth::Twips(Twips(
                i32::try_from(inner[k + 1] - inner[k]).unwrap_or(t.0),
            ))),
            Some(TableWidth::Twips(t)) => Some(TableWidth::Twips(Twips(t.0 / cols as i32))),
            w => w,
        };

        // --- rows: group heights ----------------------------------------
        let group = if h > 1 { h / rows } else { 1 };
        // Rows to insert after `r` when a single-row cell is split.
        let insert = if h == 1 { rows - 1 } else { 0 };

        // Split the region's cells in its existing rows.
        let new_s0 = idx(x0);
        for k in 0..h {
            let rr = r + k;
            let i = self
                .cell_at(rr, new_s0)
                .ok_or_else(|| err("inconsistent merged region"))?;
            let old = self.rows[rr].cells.remove(i);
            let starts_group = k % group == 0;
            let v = if h == 1 {
                None
            } else if !starts_group {
                Some(VMerge::Continue)
            } else if group > 1 {
                Some(VMerge::Restart)
            } else {
                None
            };
            let mut pieces = Vec::with_capacity(cols);
            for (p, &sp) in piece_spans.iter().enumerate() {
                let keep = p == 0 && (k == 0 || !starts_group);
                let mut cell = TableCell {
                    id: if p == 0 { old.id } else { alloc() },
                    props: CellProperties {
                        width: piece_width(&old, p),
                        ..old.props
                    },
                    grid_span: sp,
                    v_merge: v,
                    blocks: Vec::new(),
                };
                cell.blocks = if keep && k == 0 {
                    old.blocks.clone()
                } else {
                    vec![Block::Paragraph(Paragraph::new(alloc()))]
                };
                pieces.push(cell);
            }
            for (p, cell) in pieces.into_iter().enumerate() {
                self.rows[rr].cells.insert(i + p, cell);
            }
        }

        // New rows for a single-row cell.
        for n in 0..insert {
            let model = self.rows[r].clone();
            let mut cells = Vec::with_capacity(model.cells.len());
            let mut start = 0;
            for c in &model.cells {
                let end = start + c.span();
                let in_region = start >= new_s0 && end <= idx(x1);
                cells.push(TableCell {
                    id: alloc(),
                    props: c.props,
                    grid_span: c.grid_span,
                    v_merge: if in_region {
                        None
                    } else {
                        Some(VMerge::Continue)
                    },
                    blocks: vec![Block::Paragraph(Paragraph::new(alloc()))],
                });
                start = end;
            }
            let new_row = TableRow {
                id: alloc(),
                props: crate::props::RowProperties {
                    header: false,
                    ..model.props
                },
                cells,
            };
            self.rows.insert(r + 1 + n, new_row);
        }
        if insert > 0 {
            // Cells beside the split cell now continue over the new rows.
            let mut start = 0;
            for c in self.rows[r].cells.iter_mut() {
                let end = start + c.span();
                let in_region = start >= new_s0 && end <= idx(x1);
                if !in_region && c.v_merge.is_none() {
                    c.v_merge = Some(VMerge::Restart);
                }
                start = end;
            }
        }
        Ok(())
    }
}

/// The geometry of one cell for formatting purposes.
struct CellRect {
    row0: usize,
    row1: usize,
    col0: usize,
    col1: usize,
}

/// A part of the table a conditional format applies to.
struct Region {
    kind: ConditionalKind,
    row0: usize,
    row1: usize,
    col0: usize,
    col1: usize,
}

impl Document {
    /// The table style in effect for `table`: its own (if it exists and
    /// is a table style), else the default table style; resolved along
    /// `based_on`.
    pub fn table_style_of(&self, table: &Table) -> Option<TableStyle> {
        let id = table
            .props
            .style
            .as_deref()
            .filter(|id| {
                self.styles
                    .get(id)
                    .is_some_and(|s| s.kind == StyleKind::Table)
            })
            .or_else(|| {
                self.styles
                    .default_style(StyleKind::Table)
                    .map(|s| s.id.as_str())
            })?;
        self.styles.resolve_table_style(id)
    }

    /// The conditional regions of `table` (under `look`) holding `rect`,
    /// in increasing priority.
    fn regions(table: &Table, style: &TableStyle, look: TableLook, rect: &CellRect) -> Vec<Region> {
        use ConditionalKind::*;
        let nrows = table.rows.len();
        let ncols = table.grid_cols();
        let (last_r, last_c) = (nrows.saturating_sub(1), ncols.saturating_sub(1));
        let mut out = vec![Region {
            kind: WholeTable,
            row0: 0,
            row1: last_r,
            col0: 0,
            col1: last_c,
        }];
        let first_row = look.first_row && nrows > 0;
        let last_row = look.last_row && nrows > 1;
        let first_col = look.first_col && ncols > 0;
        let last_col = look.last_col && ncols > 1;
        if look.banded_cols {
            let lo = usize::from(first_col);
            let hi = if last_col { last_c } else { ncols };
            let size = usize::from(style.col_band_size.unwrap_or(1).max(1));
            if rect.col0 >= lo && rect.col0 < hi {
                let band = (rect.col0 - lo) / size;
                let col0 = lo + band * size;
                out.push(Region {
                    kind: if band % 2 == 0 { Band1Vert } else { Band2Vert },
                    row0: 0,
                    row1: last_r,
                    col0,
                    col1: (col0 + size - 1).min(hi.saturating_sub(1)),
                });
            }
        }
        if look.banded_rows {
            let lo = usize::from(first_row);
            let hi = if last_row { last_r } else { nrows };
            let size = usize::from(style.row_band_size.unwrap_or(1).max(1));
            if rect.row0 >= lo && rect.row0 < hi {
                let band = (rect.row0 - lo) / size;
                let row0 = lo + band * size;
                out.push(Region {
                    kind: if band % 2 == 0 { Band1Horz } else { Band2Horz },
                    row0,
                    row1: (row0 + size - 1).min(hi.saturating_sub(1)),
                    col0: 0,
                    col1: last_c,
                });
            }
        }
        let row = |kind, r| Region {
            kind,
            row0: r,
            row1: r,
            col0: 0,
            col1: last_c,
        };
        let col = |kind, c| Region {
            kind,
            row0: 0,
            row1: last_r,
            col0: c,
            col1: c,
        };
        let corner = |kind, r, c| Region {
            kind,
            row0: r,
            row1: r,
            col0: c,
            col1: c,
        };
        if first_row && rect.row0 == 0 {
            out.push(row(FirstRow, 0));
        }
        if last_row && rect.row1 == last_r {
            out.push(row(LastRow, last_r));
        }
        if first_col && rect.col0 == 0 {
            out.push(col(FirstCol, 0));
        }
        if last_col && rect.col1 == last_c {
            out.push(col(LastCol, last_c));
        }
        let top = first_row && rect.row0 == 0;
        let bottom = last_row && rect.row1 == last_r;
        let left = first_col && rect.col0 == 0;
        let right = last_col && rect.col1 == last_c;
        if top && right {
            out.push(corner(NeCell, 0, last_c));
        }
        if top && left {
            out.push(corner(NwCell, 0, 0));
        }
        if bottom && right {
            out.push(corner(SeCell, last_r, last_c));
        }
        if bottom && left {
            out.push(corner(SwCell, last_r, 0));
        }
        out
    }

    /// Effective formatting of cell `cell` of row `row` of `table`, as
    /// Word computes it: the table style's cell properties, its
    /// conditional formats that apply under the table's
    /// [`TableLook`] (whole table, column bands, row bands, first/last
    /// row, first/last column, corner cells, in that priority), then the
    /// cell's direct properties. The returned `borders` are the four
    /// edges of this cell (`insideH`/`insideV` are `None`): table borders
    /// (style, then direct) on the table's outer edges and its inside
    /// lines between cells, overridden by the conditional formats (whose
    /// borders describe their region as a whole) and the cell's own
    /// borders. `margins` include the table's default cell margins.
    /// `None` for a cell that does not exist.
    pub fn resolve_cell_props(
        &self,
        table: &Table,
        row: usize,
        cell: usize,
    ) -> Option<CellProperties> {
        Some(self.resolve_cell_format(table, row, cell)?.0)
    }

    /// The paragraph and character formatting the table style gives the
    /// text of cell `cell` of row `row` (its `pPr`/`rPr` and those of the
    /// conditional formats that apply), to be layered below the
    /// paragraph's own style.
    pub fn table_text_props(
        &self,
        table: &Table,
        row: usize,
        cell: usize,
    ) -> Option<(ParagraphProperties, RunProperties)> {
        let (_, p, r) = self.resolve_cell_format(table, row, cell)?;
        Some((p, r))
    }

    fn resolve_cell_format(
        &self,
        table: &Table,
        row: usize,
        cell: usize,
    ) -> Option<(CellProperties, ParagraphProperties, RunProperties)> {
        let c = table.rows.get(row)?.cells.get(cell)?;
        let style = self.table_style_of(table).unwrap_or_default();
        let (orow, ocell) = table.merge_origin(row, cell);
        let col0 = table.grid_start(row, cell)?;
        let rect = CellRect {
            row0: orow,
            row1: orow + table.row_span(orow, ocell).max(1) - 1,
            col0,
            col1: col0 + c.span() - 1,
        };
        let nrows = table.rows.len();
        let ncols = table.grid_cols();

        // Table borders: style, then direct.
        let tb = match (style.table.borders, table.props.borders) {
            (Some(a), Some(b)) => a.merged_with(&b),
            (a, b) => b.or(a).unwrap_or_default(),
        };
        let mut edges = [
            if rect.row0 == 0 { tb.top } else { tb.inside_h },
            if rect.col0 == 0 { tb.left } else { tb.inside_v },
            if rect.row1 + 1 >= nrows {
                tb.bottom
            } else {
                tb.inside_h
            },
            if rect.col1 + 1 >= ncols {
                tb.right
            } else {
                tb.inside_v
            },
        ];
        let mut props = CellProperties {
            borders: None,
            ..style.cell
        };
        if let Some(b) = style.cell.borders {
            overlay_edges(&mut edges, &b, true, true, true, true);
        }
        let margins = match (style.table.cell_margins, table.props.cell_margins) {
            (Some(a), Some(b)) => Some(a.merged_with(&b)),
            (a, b) => b.or(a),
        };
        props.margins = match (margins, props.margins) {
            (Some(a), Some(b)) => Some(a.merged_with(&b)),
            (a, b) => b.or(a),
        };
        let mut para = ParagraphProperties::default();
        let mut run = RunProperties::default();
        let look = table.props.look.unwrap_or_default();
        for region in Self::regions(table, &style, look, &rect) {
            let Some(f) = style.conditional(region.kind) else {
                continue;
            };
            para.apply(&f.paragraph);
            run.apply(&f.run);
            let mut fc = f.cell;
            if let Some(b) = fc.borders.take() {
                overlay_edges(
                    &mut edges,
                    &b,
                    rect.row0 == region.row0,
                    rect.col0 == region.col0,
                    rect.row1 == region.row1,
                    rect.col1 == region.col1,
                );
            }
            props = merge_cell_props(&props, &fc);
        }
        let mut direct = c.props;
        if let Some(b) = direct.borders.take() {
            overlay_edges(&mut edges, &b, true, true, true, true);
        }
        props = merge_cell_props(&props, &direct);
        let [top, left, bottom, right] = edges;
        let borders = TableBorders {
            top,
            left,
            bottom,
            right,
            inside_h: None,
            inside_v: None,
        };
        props.borders = (borders != TableBorders::default()).then_some(borders);
        Some((props, para, run))
    }
}

/// Overlays region borders `b` onto the cell edges `[top, left, bottom,
/// right]`: an edge on the region's boundary takes the outer side, an
/// inner edge the inside line.
fn overlay_edges(
    edges: &mut [Option<BorderSide>; 4],
    b: &TableBorders,
    at_top: bool,
    at_left: bool,
    at_bottom: bool,
    at_right: bool,
) {
    let pick = |outer: Option<BorderSide>, inner: Option<BorderSide>, on: bool| {
        if on {
            outer
        } else {
            inner
        }
    };
    let sides = [
        pick(b.top, b.inside_h, at_top),
        pick(b.left, b.inside_v, at_left),
        pick(b.bottom, b.inside_h, at_bottom),
        pick(b.right, b.inside_v, at_right),
    ];
    for (e, s) in edges.iter_mut().zip(sides) {
        if s.is_some() {
            *e = s;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::props::{BorderStyle, TableProperties};
    use core_model::{Color, ThemeColorSlot};

    fn text_cell(id: &mut u64, text: &str) -> TableCell {
        *id += 2;
        TableCell::new(
            NodeId(*id - 1),
            CellProperties::default(),
            vec![Block::Paragraph(Paragraph::with_text(NodeId(*id), text))],
        )
    }

    /// A `rows × cols` table with cell texts `"r,c"`, ids from 1000.
    fn grid(rows: usize, cols: usize) -> Table {
        let mut id = 1000;
        let rows = (0..rows)
            .map(|r| {
                id += 1;
                let row_id = NodeId(id);
                TableRow {
                    id: row_id,
                    props: Default::default(),
                    cells: (0..cols)
                        .map(|c| text_cell(&mut id, &format!("{r},{c}")))
                        .collect(),
                }
            })
            .collect();
        Table {
            id: NodeId(1),
            props: TableProperties {
                col_widths: vec![Twips(1200); cols],
                ..Default::default()
            },
            rows,
        }
    }

    fn texts(t: &Table) -> Vec<Vec<String>> {
        t.rows
            .iter()
            .map(|r| {
                r.cells
                    .iter()
                    .map(|c| {
                        let p: Vec<String> = crate::document::paragraphs_in(&c.blocks)
                            .map(Paragraph::text)
                            .collect();
                        let tag = match c.v_merge {
                            Some(VMerge::Restart) => "^",
                            Some(VMerge::Continue) => "|",
                            None => "",
                        };
                        format!("{tag}{}x{}", p.join("/"), c.grid_span)
                    })
                    .collect()
            })
            .collect()
    }

    fn ids(t: &Table) -> Vec<NodeId> {
        fn walk(blocks: &[Block], v: &mut Vec<NodeId>) {
            for b in blocks {
                v.push(b.id());
                if let Block::Table(t) = b {
                    for r in &t.rows {
                        v.push(r.id);
                        for c in &r.cells {
                            v.push(c.id);
                            walk(&c.blocks, v);
                        }
                    }
                }
            }
        }
        let mut v = Vec::new();
        walk(&[Block::Table(t.clone())], &mut v);
        v
    }

    fn unique(t: &Table) -> bool {
        let v = ids(t);
        let set: std::collections::HashSet<_> = v.iter().collect();
        set.len() == v.len()
    }

    fn counter() -> impl FnMut() -> NodeId {
        let mut n = 5000;
        move || {
            n += 1;
            NodeId(n)
        }
    }

    #[test]
    fn merge_horizontal_vertical_and_block() {
        let mut t = grid(3, 3);
        let mut alloc = counter();
        t.merge_cells(0, 0, 0, 1, &mut alloc).unwrap();
        assert_eq!(texts(&t)[0], ["0,0/0,1x2", "0,2x1"]);
        t.check_grid().unwrap();
        // vertical merge of column 2, rows 0..=2
        t.merge_cells(0, 2, 2, 2, &mut alloc).unwrap();
        assert_eq!(
            texts(&t),
            [
                vec!["0,0/0,1x2", "^0,2/1,2/2,2x1"],
                vec!["1,0x1", "1,1x1", "|x1"],
                vec!["2,0x1", "2,1x1", "|x1"],
            ]
        );
        t.check_grid().unwrap();
        assert_eq!(t.row_span(0, 1), 3);
        assert_eq!(t.merge_origin(2, 2), (0, 1));
        // cutting the vertical region is rejected
        assert!(t.merge_cells(1, 1, 1, 2, &mut alloc).is_err());
        assert!(t.merge_cells(0, 0, 1, 0, &mut alloc).is_err()); // cuts the 2-span cell
                                                                 // a 2×2 block
        t.merge_cells(1, 0, 2, 1, &mut alloc).unwrap();
        assert_eq!(
            texts(&t),
            [
                vec!["0,0/0,1x2", "^0,2/1,2/2,2x1"],
                vec!["^1,0/1,1/2,0/2,1x2", "|x1"],
                vec!["|x2", "|x1"],
            ]
        );
        t.check_grid().unwrap();
        assert!(unique(&t));
        // everything
        t.merge_cells(0, 0, 2, 2, &mut alloc).unwrap();
        t.check_grid().unwrap();
        assert_eq!(t.rows[0].cells.len(), 1);
        assert_eq!(t.row_span(0, 0), 3);
        assert!(unique(&t));
    }

    #[test]
    fn merge_skips_empty_cells_and_sums_widths() {
        let mut t = grid(1, 3);
        for c in &mut t.rows[0].cells {
            c.props.width = Some(TableWidth::Twips(Twips(1200)));
        }
        if let Block::Paragraph(p) = &mut t.rows[0].cells[1].blocks[0] {
            p.inlines.clear();
        }
        let id0 = t.rows[0].cells[0].id;
        t.merge_cells(0, 0, 0, 2, counter()).unwrap();
        let c = &t.rows[0].cells[0];
        assert_eq!(c.id, id0);
        assert_eq!(c.grid_span, 3);
        assert_eq!(c.props.width, Some(TableWidth::Twips(Twips(3600))));
        assert_eq!(texts(&t)[0], ["0,0/0,2x3"]);
    }

    #[test]
    fn split_undoes_merge_and_refines_grid() {
        let mut t = grid(2, 2);
        let mut alloc = counter();
        t.merge_cells(0, 0, 1, 1, &mut alloc).unwrap();
        t.split_cell(1, 1, 2, 2, &mut alloc).unwrap();
        t.check_grid().unwrap();
        assert_eq!(
            texts(&t),
            [vec!["0,0/0,1/1,0/1,1x1", "x1"], vec!["x1", "x1"]]
        );
        assert_eq!(t.props.col_widths, vec![Twips(1200), Twips(1200)]);
        assert!(unique(&t));

        // splitting a plain cell into 3 columns adds grid columns
        let mut t = grid(2, 2);
        t.split_cell(0, 1, 1, 3, &mut alloc).unwrap();
        t.check_grid().unwrap();
        assert_eq!(t.grid_cols(), 4);
        assert_eq!(texts(&t)[0], ["0,0x1", "0,1x1", "x1", "x1"]);
        assert_eq!(texts(&t)[1], ["1,0x1", "1,1x3"]);
        assert_eq!(
            t.props.col_widths,
            vec![Twips(1200), Twips(400), Twips(400), Twips(400)]
        );
        // split a plain cell into 2 rows: new row, neighbours merge down
        t.split_cell(1, 0, 2, 1, &mut alloc).unwrap();
        t.check_grid().unwrap();
        assert_eq!(t.rows.len(), 3);
        assert_eq!(texts(&t)[1], ["1,0x1", "^1,1x3"]);
        assert_eq!(texts(&t)[2], ["x1", "|x3"]);
        assert!(unique(&t));
        // rows that do not divide a region are rejected
        let mut t = grid(3, 1);
        t.merge_cells(0, 0, 2, 0, &mut alloc).unwrap();
        assert!(t.split_cell(0, 0, 2, 1, &mut alloc).is_err());
        t.split_cell(0, 0, 3, 1, &mut alloc).unwrap();
        t.check_grid().unwrap();
        assert_eq!(texts(&t), [["0,0/1,0/2,0x1"], ["x1"], ["x1"]]);
    }

    #[test]
    fn pad_split_and_append() {
        let mut t = grid(3, 3);
        t.rows[1].cells.pop();
        assert!(t.check_grid().is_err());
        let mut alloc = counter();
        assert_eq!(t.pad_rows(&mut alloc), 1);
        t.check_grid().unwrap();
        assert_eq!(texts(&t)[1], ["1,0x1", "1,1x1", "x1"]);
        // a vertical merge across the cut starts again below it
        t.merge_cells(0, 2, 2, 2, &mut alloc).unwrap();
        let second = t.split_off_rows(1, NodeId(77)).unwrap();
        t.check_grid().unwrap();
        second.check_grid().unwrap();
        assert_eq!(texts(&t), [["0,0x1", "0,1x1", "0,2/2,2x1"]]);
        assert_eq!(texts(&second)[0], ["1,0x1", "1,1x1", "^x1"]);
        assert_eq!(second.id, NodeId(77));
        assert_eq!(second.props.col_widths, t.props.col_widths);
        assert!(t.split_off_rows(0, NodeId(78)).is_err());
        assert!(t.split_off_rows(1, NodeId(78)).is_err());
        // joining again; a narrower table is padded, a header row is not one any more
        let mut narrow = grid(1, 2);
        narrow.rows[0].props.header = true;
        t.append_rows(second, &mut alloc);
        assert!(unique(&t));
        t.append_rows(narrow, &mut alloc);
        t.check_grid().unwrap();
        assert_eq!(t.rows.len(), 4);
        assert!(!t.rows[3].props.header);
        assert_eq!(texts(&t)[3], ["0,0x1", "0,1x1", "x1"]);
    }

    #[test]
    fn normalize_merges_repairs() {
        let mut t = grid(3, 1);
        t.merge_cells(0, 0, 2, 0, counter()).unwrap();
        t.rows.remove(0);
        assert!(t.check_grid().is_err());
        t.normalize_merges();
        t.check_grid().unwrap();
        assert_eq!(texts(&t), [["^x1"], ["|x1"]]);
        t.rows.remove(1);
        t.normalize_merges();
        assert_eq!(texts(&t), [["x1"]]);
    }

    #[test]
    fn resolve_banded_grid_table() {
        let mut doc = Document::new();
        let mut t = grid(4, 3);
        t.props.style = Some("GridTable4-Accent1".into());
        t.props.look = Some(TableLook::word_default());
        let accent = Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: 0.0,
        };
        let band = Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: 0.8,
        };
        let light = Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: 0.4,
        };
        // header row: accent fill, accent outer borders, no inside lines
        let h = doc.resolve_cell_props(&t, 0, 1).unwrap();
        assert_eq!(h.shading, Some(accent));
        let b = h.borders.unwrap();
        assert_eq!(b.top.unwrap().color, accent);
        assert_eq!(b.left.unwrap().style, BorderStyle::None);
        assert_eq!(b.right.unwrap().style, BorderStyle::None);
        assert_eq!(b.bottom.unwrap().color, accent);
        let (_, run) = doc.table_text_props(&t, 0, 1).unwrap();
        assert_eq!(run.bold, Some(true));
        // first data row = band 1 (shaded), second = band 2 (not)
        assert_eq!(
            doc.resolve_cell_props(&t, 1, 1).unwrap().shading,
            Some(band)
        );
        assert_eq!(doc.resolve_cell_props(&t, 2, 1).unwrap().shading, None);
        assert_eq!(
            doc.resolve_cell_props(&t, 3, 1).unwrap().shading,
            Some(band)
        );
        let inner = doc.resolve_cell_props(&t, 2, 1).unwrap().borders.unwrap();
        assert_eq!(inner.top.unwrap().color, light);
        assert_eq!(inner.left.unwrap().color, light);
        // first column is bold
        assert_eq!(doc.table_text_props(&t, 2, 0).unwrap().1.bold, Some(true));
        assert_eq!(doc.table_text_props(&t, 2, 1).unwrap().1.bold, None);
        // banding off: no fill
        t.props.look = Some(TableLook {
            banded_rows: false,
            ..TableLook::word_default()
        });
        assert_eq!(doc.resolve_cell_props(&t, 1, 1).unwrap().shading, None);
        // direct cell shading wins
        t.rows[1].cells[1].props.shading = Some(Color::Auto);
        assert_eq!(
            doc.resolve_cell_props(&t, 1, 1).unwrap().shading,
            Some(Color::Auto)
        );
        // last row (total row) gets a double top border
        t.props.look = Some(TableLook {
            last_row: true,
            ..TableLook::word_default()
        });
        let total = doc.resolve_cell_props(&t, 3, 0).unwrap().borders.unwrap();
        assert_eq!(total.top.unwrap().style, BorderStyle::Double);
        // a table without style: Normal Table margins, no borders
        let plain = grid(1, 1);
        let p = doc.resolve_cell_props(&plain, 0, 0).unwrap();
        assert_eq!(p.borders, None);
        assert_eq!(p.margins.unwrap().left, Some(Twips(108)));
        // Table Grid: all edges single
        let mut g = grid(2, 2);
        g.props.style = Some("TableGrid".into());
        let e = doc.resolve_cell_props(&g, 1, 1).unwrap().borders.unwrap();
        assert!([e.top, e.left, e.bottom, e.right]
            .iter()
            .all(|s| s.unwrap().style == BorderStyle::Single));
        assert!(doc.resolve_cell_props(&g, 2, 0).is_none());
        doc.styles.styles.clear();
        assert_eq!(doc.resolve_cell_props(&g, 0, 0).unwrap().borders, None);
    }

    #[test]
    fn table_style_text_layers_into_run_resolution() {
        let doc = Document::new();
        let mut t = grid(3, 2);
        t.props.style = Some("GridTable4-Accent1".into());
        t.props.look = Some(TableLook::word_default());
        let para = |t: &Table, r: usize, c: usize| match &t.rows[r].cells[c].blocks[0] {
            Block::Paragraph(p) => p.clone(),
            _ => unreachable!(),
        };
        let p = para(&t, 0, 1);
        let run = p.inlines[0].as_run().unwrap().clone();
        // header row bold (and white text) from tblStylePr firstRow
        let r = doc.resolve_run_props_in_cell(&t, 0, 1, &p, &run);
        assert_eq!(r.bold, Some(true));
        assert!(r.color.is_some());
        // a body cell outside the first column is not bold
        let p2 = para(&t, 1, 1);
        let r2 = doc.resolve_run_props_in_cell(&t, 1, 1, &p2, p2.inlines[0].as_run().unwrap());
        assert_ne!(r2.bold, Some(true));
        // direct formatting wins
        let mut plain = run.clone();
        plain.props.bold = Some(false);
        assert_eq!(
            doc.resolve_run_props_in_cell(&t, 0, 1, &p, &plain).bold,
            Some(false)
        );
        // outside a table nothing changes
        assert_eq!(doc.resolve_run_props(&p, &run).bold, None);
        // paragraph formatting: the default style does not override the table style
        let pp = doc.resolve_paragraph_props_in_cell(&t, 0, 1, &p);
        assert_eq!(pp.style.as_deref(), Some("Normal"));
    }

    #[test]
    fn resolve_banded_columns_list_table() {
        let doc = Document::new();
        let mut t = grid(3, 4);
        t.props.style = Some("ListTable3".into());
        t.props.look = Some(TableLook {
            banded_cols: true,
            ..Default::default()
        });
        // band1Vert: left/right borders on columns 0 and 2
        let c0 = doc.resolve_cell_props(&t, 1, 0).unwrap().borders.unwrap();
        assert!(c0.left.is_some() && c0.right.is_some());
        let c1 = doc.resolve_cell_props(&t, 1, 1).unwrap().borders;
        assert_eq!(c1, None);
        let c2 = doc.resolve_cell_props(&t, 1, 2).unwrap().borders.unwrap();
        assert!(c2.left.is_some() && c2.right.is_some());
    }
}
