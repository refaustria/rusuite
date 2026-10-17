//! Spill guards (P9-C4): operations that rewrite a block of cells – sort,
//! fill, paste, merge – may not cover part of a spill range (Excel's
//! "You can't change part of an array"). Covering a whole spill range,
//! its formula cell included, is fine, as is covering only the formula
//! cell; typing into a spilled cell is too (it blocks the spill:
//! `#SPILL!`).
//!
//! ```
//! use model_sheet::{CellRange, Workbook, Error};
//! use engine_formula::CellCoord;
//!
//! let mut wb = Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! wb.set_input(CellCoord::new(s, 0, 0), "=SEQUENCE(3)").unwrap();
//! assert!(matches!(
//!     wb.check_spill_edit(CellRange::new(s, 1, 0, 2, 0)),
//!     Err(Error::SpillPart)
//! ));
//! assert!(wb.check_spill_edit(CellRange::new(s, 0, 0, 5, 1)).is_ok());
//! ```

use crate::workbook::Workbook;
use crate::{CellRange, Error};

impl Workbook {
    /// `Err(Error::SpillPart)` when `range` covers part of a spill range
    /// (some of its cells, not all of them with the formula cell).
    pub fn check_spill_edit(&self, range: CellRange) -> Result<(), Error> {
        for (anchor, spill) in self.engine().spills(range.sheet) {
            if spill.blocked {
                continue;
            }
            let (r0, c0) = (anchor.row, anchor.col);
            let (r1, c1) = (r0 + spill.rows - 1, c0 + spill.cols - 1);
            let meets = range.r0 <= r1 && r0 <= range.r1 && range.c0 <= c1 && c0 <= range.c1;
            let covers = range.r0 <= r0 && r1 <= range.r1 && range.c0 <= c0 && c1 <= range.c1;
            // The formula cell alone may be replaced.
            let only_anchor = meets
                && range.r0.max(r0) == r0
                && range.r1.min(r1) == r0
                && range.c0.max(c0) == c0
                && range.c1.min(c1) == c0;
            if meets && !covers && !only_anchor {
                return Err(Error::SpillPart);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::CellCoord;

    #[test]
    fn partial_cover_is_refused() {
        let mut wb = Workbook::new();
        let s = wb.sheet_id("Sheet1").unwrap();
        wb.set_input(CellCoord::new(s, 1, 1), "=SEQUENCE(2,2)")
            .unwrap();
        let r = |r0, c0, r1, c1| wb.check_spill_edit(CellRange::new(s, r0, c0, r1, c1));
        assert!(matches!(r(2, 2, 2, 2), Err(Error::SpillPart)));
        assert!(matches!(r(0, 0, 2, 1), Err(Error::SpillPart)));
        assert!(r(0, 0, 9, 9).is_ok());
        assert!(r(1, 1, 2, 2).is_ok());
        assert!(r(5, 5, 6, 6).is_ok());
        // Only the formula cell: it may be replaced.
        assert!(r(0, 0, 1, 1).is_ok());
        assert!(r(1, 1, 1, 1).is_ok());
        assert!(r(1, 0, 1, 1).is_ok());
        // A blocked array spills nothing.
        wb.set_input(CellCoord::new(s, 2, 2), "x").unwrap();
        assert!(wb.check_spill_edit(CellRange::new(s, 2, 1, 2, 1)).is_ok());
    }

    #[test]
    fn merging_over_part_of_a_spill_is_refused() {
        let mut wb = Workbook::new();
        let s = wb.sheet_id("Sheet1").unwrap();
        wb.set_input(CellCoord::new(s, 0, 0), "=SEQUENCE(3)")
            .unwrap();
        assert!(matches!(
            wb.merge_cells(CellRange::new(s, 1, 0, 2, 1)),
            Err(Error::SpillPart)
        ));
        assert!(wb.merge_cells(CellRange::new(s, 5, 0, 6, 1)).is_ok());
    }
}
