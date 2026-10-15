//! Cell and range coordinates shared by the evaluator, the dependency graph
//! and the [`Engine`](crate::engine::Engine).
//!
//! [`eval`](crate::eval) and [`graph`](crate::graph) re-export everything
//! here, so `engine_formula::eval::CellCoord` and
//! `engine_formula::graph::CellCoord` name the same type.

use serde::{Deserialize, Serialize};

use crate::ast::{MAX_COL, MAX_ROW};
use crate::eval::CellProvider;

/// Identifies a sheet within a workbook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SheetId(pub u32);

/// Absolute cell position (0-based row and column). Ordering is by sheet,
/// then row, then column; it is used to break ties deterministically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CellCoord {
    pub sheet: SheetId,
    pub row: u32,
    pub col: u32,
}

impl CellCoord {
    pub fn new(sheet: SheetId, row: u32, col: u32) -> Self {
        CellCoord { sheet, row, col }
    }
}

/// A rectangular range on one sheet (0-based, inclusive bounds,
/// normalized: `r0 <= r1`, `c0 <= c1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RangeRef {
    pub sheet: SheetId,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl RangeRef {
    /// Builds a normalized range from two corners in any order.
    pub fn new(sheet: SheetId, r0: u32, c0: u32, r1: u32, c1: u32) -> Self {
        RangeRef {
            sheet,
            r0: r0.min(r1),
            c0: c0.min(c1),
            r1: r0.max(r1),
            c1: c0.max(c1),
        }
    }

    /// The one-cell range at `c`.
    pub fn cell(c: CellCoord) -> Self {
        RangeRef {
            sheet: c.sheet,
            r0: c.row,
            c0: c.col,
            r1: c.row,
            c1: c.col,
        }
    }

    pub fn rows(&self) -> u32 {
        self.r1 - self.r0 + 1
    }

    pub fn cols(&self) -> u32 {
        self.c1 - self.c0 + 1
    }

    pub fn is_single_cell(&self) -> bool {
        self.r0 == self.r1 && self.c0 == self.c1
    }

    /// True if `cell` lies inside the range.
    pub fn contains(&self, cell: CellCoord) -> bool {
        cell.sheet == self.sheet
            && (self.r0..=self.r1).contains(&cell.row)
            && (self.c0..=self.c1).contains(&cell.col)
    }

    /// Spans every row (a whole-column reference such as `A:A`).
    pub fn is_whole_columns(&self) -> bool {
        self.r0 == 0 && self.r1 == MAX_ROW
    }

    /// Spans every column (a whole-row reference such as `1:1`).
    pub fn is_whole_rows(&self) -> bool {
        self.c0 == 0 && self.c1 == MAX_COL
    }

    /// Coordinate of the cell at 0-based offset `(row, col)` within the range.
    pub fn at(&self, row: u32, col: u32) -> Option<CellCoord> {
        (row < self.rows() && col < self.cols()).then(|| CellCoord {
            sheet: self.sheet,
            row: self.r0 + row,
            col: self.c0 + col,
        })
    }

    /// The part of the range that is worth iterating: whole-column/row
    /// ranges are clipped to the sheet's used range (`None` when nothing is
    /// left); other ranges are returned unchanged.
    pub fn clipped(&self, provider: &dyn CellProvider) -> Option<RangeRef> {
        if !self.is_whole_columns() && !self.is_whole_rows() {
            return Some(*self);
        }
        let (max_row, max_col) = provider.used_range(self.sheet)?;
        let mut r = *self;
        if self.is_whole_columns() {
            r.r1 = r.r1.min(max_row);
        }
        if self.is_whole_rows() {
            r.c1 = r.c1.min(max_col);
        }
        (r.r0 <= r.r1 && r.c0 <= r.c1).then_some(r)
    }

    /// Smallest range containing both (same sheet as `self`).
    pub fn union(&self, other: &RangeRef) -> RangeRef {
        RangeRef {
            sheet: self.sheet,
            r0: self.r0.min(other.r0),
            c0: self.c0.min(other.c0),
            r1: self.r1.max(other.r1),
            c1: self.c1.max(other.c1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_cell_range() {
        let c = CellCoord::new(SheetId(1), 4, 2);
        let r = RangeRef::cell(c);
        assert!(r.is_single_cell() && r.contains(c));
        assert_eq!((r.rows(), r.cols()), (1, 1));
        assert_eq!(r.at(0, 0), Some(c));
        assert_eq!(r.union(&RangeRef::new(SheetId(1), 0, 0, 1, 1)).rows(), 5);
    }

    #[test]
    fn coordinates_order_by_sheet_row_col() {
        let a = CellCoord::new(SheetId(0), 5, 0);
        let b = CellCoord::new(SheetId(0), 0, 9);
        let c = CellCoord::new(SheetId(1), 0, 0);
        assert!(b < a && a < c);
    }
}
