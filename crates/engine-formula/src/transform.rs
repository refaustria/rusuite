//! Pure AST rewriting for structural edits and copy/paste.
//!
//! * [`adjust_references`] applies Excel's rules for inserting/deleting
//!   rows or columns to every reference of a formula.
//! * [`offset_relative`] moves the relative parts of every reference, as
//!   when a formula is copied to another cell.
//! * [`adjust_references_for_move`] makes references to cut-and-pasted
//!   (moved) cells follow them.
//!
//! All three functions return a new [`Expr`]; a reference that cannot survive
//! the edit becomes `Expr::Error(ErrorKind::Ref)` (printed `#REF!`).
//!
//! ```
//! use engine_formula::{adjust_references, parse, AdjustContext, StructuralOp};
//!
//! let f = parse("=SUM(A2:A5)+B9").unwrap();
//! let ctx = AdjustContext {
//!     host_sheet: "Sheet1",
//!     target_sheet: "Sheet1",
//!     op: StructuralOp::InsertRows { at: 3, count: 2 },
//! };
//! assert_eq!(adjust_references(&f, &ctx).to_string(), "SUM(A2:A7)+B11");
//! ```

use serde::{Deserialize, Serialize};

use crate::ast::{CellRef, ErrorKind, Expr, RangeKind, Reference, MAX_COL, MAX_ROW};

/// Inserting or deleting whole rows/columns of one sheet. `at` is 0-based;
/// an insert puts `count` new rows/columns *before* row/column `at`, a
/// delete removes `at..at + count`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StructuralOp {
    InsertRows { at: u32, count: u32 },
    DeleteRows { at: u32, count: u32 },
    InsertCols { at: u32, count: u32 },
    DeleteCols { at: u32, count: u32 },
}

impl StructuralOp {
    /// True for row operations, false for column operations.
    pub fn is_rows(self) -> bool {
        matches!(
            self,
            StructuralOp::InsertRows { .. } | StructuralOp::DeleteRows { .. }
        )
    }

    /// True for inserts, false for deletes.
    pub fn is_insert(self) -> bool {
        matches!(
            self,
            StructuralOp::InsertRows { .. } | StructuralOp::InsertCols { .. }
        )
    }

    /// `(at, count)` of the operation.
    pub fn span(self) -> (u32, u32) {
        match self {
            StructuralOp::InsertRows { at, count }
            | StructuralOp::DeleteRows { at, count }
            | StructuralOp::InsertCols { at, count }
            | StructuralOp::DeleteCols { at, count } => (at, count),
        }
    }

    /// Largest valid index on the operation's axis.
    pub fn max_index(self) -> u32 {
        if self.is_rows() {
            MAX_ROW
        } else {
            MAX_COL
        }
    }

    /// New position of index `p` on the operation's axis: `None` if it is
    /// deleted or pushed past the end of the sheet.
    pub fn map_index(self, p: u32) -> Option<u32> {
        let (at, count) = self.span();
        if self.is_insert() {
            if p < at {
                return Some(p);
            }
            let q = u64::from(p) + u64::from(count);
            (q <= u64::from(self.max_index())).then_some(q as u32)
        } else if p < at {
            Some(p)
        } else if u64::from(p) < u64::from(at) + u64::from(count) {
            None
        } else {
            Some(p - count)
        }
    }

    /// New bounds of the inclusive interval `lo..=hi` (`lo <= hi`) on the
    /// operation's axis, following Excel: an insert strictly inside the
    /// interval (or before its last element) grows it; a delete clips the
    /// deleted part out. `None` when nothing is left (the delete covers
    /// the whole interval, or an insert pushes it past the sheet end). An
    /// end pushed past the sheet end is clamped to the last index.
    pub fn map_interval(self, lo: u32, hi: u32) -> Option<(u32, u32)> {
        let (at, count) = self.span();
        let max = u64::from(self.max_index());
        if self.is_insert() {
            let grow = |v: u32| (u64::from(v) + u64::from(count)).min(max) as u32;
            if at <= lo {
                let start = u64::from(lo) + u64::from(count);
                (start <= max).then(|| (start as u32, grow(hi)))
            } else if at <= hi {
                Some((lo, grow(hi)))
            } else {
                Some((lo, hi))
            }
        } else {
            let end = u64::from(at) + u64::from(count); // exclusive
            if lo >= at && u64::from(hi) < end {
                return None;
            }
            let new_lo = if lo < at {
                lo
            } else if u64::from(lo) >= end {
                lo - count
            } else {
                at
            };
            let new_hi = if hi < at {
                hi
            } else if u64::from(hi) >= end {
                hi - count
            } else {
                at - 1
            };
            Some((new_lo, new_hi))
        }
    }

    /// New `(row, col)` of a cell: `None` if it is deleted or pushed past
    /// the end of the sheet.
    pub fn map_cell(self, row: u32, col: u32) -> Option<(u32, u32)> {
        if self.is_rows() {
            Some((self.map_index(row)?, col))
        } else {
            Some((row, self.map_index(col)?))
        }
    }
}

/// Where a structural edit happens, as seen from one formula.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdjustContext<'a> {
    /// Sheet the formula lives on (resolves references without a prefix).
    pub host_sheet: &'a str,
    /// Sheet whose rows/columns are inserted or deleted.
    pub target_sheet: &'a str,
    pub op: StructuralOp,
}

/// Case-insensitive (Unicode lowercase) sheet name comparison, as used by
/// the engine.
fn same_sheet(a: &str, b: &str) -> bool {
    a.chars()
        .flat_map(char::to_lowercase)
        .eq(b.chars().flat_map(char::to_lowercase))
}

/// Rebuilds `expr` with every reference passed through `f`; `None`
/// replaces the reference by `#REF!`.
fn map_refs(expr: &Expr, f: &dyn Fn(&Reference) -> Option<RangeKind>) -> Expr {
    map_references(expr, &|r: &Reference| {
        Some(Reference {
            sheet: r.sheet.clone(),
            kind: f(r)?,
        })
    })
}

/// Like [`map_refs`], but `f` may also change the sheet prefix.
fn map_references(expr: &Expr, f: &dyn Fn(&Reference) -> Option<Reference>) -> Expr {
    match expr {
        Expr::Reference(r) => match f(r) {
            Some(r) => Expr::Reference(r),
            None => Expr::Error(ErrorKind::Ref),
        },
        Expr::Call { name, args } => Expr::Call {
            name: name.clone(),
            args: args.iter().map(|a| map_references(a, f)).collect(),
        },
        Expr::Unary { op, expr } => Expr::Unary {
            op: *op,
            expr: Box::new(map_references(expr, f)),
        },
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(map_references(lhs, f)),
            rhs: Box::new(map_references(rhs, f)),
        },
        Expr::Array(rows) => Expr::Array(
            rows.iter()
                .map(|row| row.iter().map(|e| map_references(e, f)).collect())
                .collect(),
        ),
        Expr::Number(_)
        | Expr::Text(_)
        | Expr::Bool(_)
        | Expr::Error(_)
        | Expr::Name(_)
        | Expr::QualifiedName { .. }
        | Expr::Missing => expr.clone(),
    }
}

/// Rewrites the references of a formula living on `ctx.host_sheet` for a
/// row/column insert or delete on `ctx.target_sheet` (Excel rules).
///
/// A reference is affected only if it points at the target sheet (explicit
/// prefix equal case-insensitively, or no prefix and host == target).
/// Absolute (`$`) flags do not matter and are kept.
///
/// * Insert: indices `>= at` move by `count`; an area/whole-row/whole-column
///   range grows when the insert lands after its first and at or before
///   its last index. Single cells pushed past the sheet end become
///   `#REF!`; range ends are clamped to the last row/column.
/// * Delete: cells inside the deleted span become `#REF!`, later ones move
///   back; ranges shrink by the deleted part and become `#REF!` only when
///   fully covered.
/// * Row operations leave whole-column references (`A:A`) unchanged and
///   column operations leave whole-row references (`1:1`) unchanged.
pub fn adjust_references(expr: &Expr, ctx: &AdjustContext) -> Expr {
    let op = ctx.op;
    let rows = op.is_rows();
    map_refs(expr, &|r: &Reference| {
        let affected = match &r.sheet {
            Some(name) => same_sheet(name, ctx.target_sheet),
            None => same_sheet(ctx.host_sheet, ctx.target_sheet),
        };
        if !affected {
            return Some(r.kind);
        }
        match r.kind {
            RangeKind::Cell(mut c) => {
                if rows {
                    c.row = op.map_index(c.row)?;
                } else {
                    c.col = op.map_index(c.col)?;
                }
                Some(RangeKind::Cell(c))
            }
            RangeKind::Area(a, b) => {
                let RangeKind::Area(mut a, mut b) = RangeKind::area(a, b) else {
                    unreachable!("RangeKind::area builds an area")
                };
                if rows {
                    (a.row, b.row) = op.map_interval(a.row, b.row)?;
                } else {
                    (a.col, b.col) = op.map_interval(a.col, b.col)?;
                }
                Some(RangeKind::area(a, b))
            }
            RangeKind::Rows { start, end, abs } if rows => {
                let (start, end) = op.map_interval(start.min(end), start.max(end))?;
                Some(RangeKind::Rows { start, end, abs })
            }
            RangeKind::Cols { start, end, abs } if !rows => {
                let (start, end) = op.map_interval(start.min(end), start.max(end))?;
                Some(RangeKind::Cols { start, end, abs })
            }
            kind @ (RangeKind::Rows { .. } | RangeKind::Cols { .. }) => Some(kind),
        }
    })
}

/// Moves `v` by `d` unless anchored; `None` outside `0..=max`.
fn shift(v: u32, d: i64, abs: bool, max: u32) -> Option<u32> {
    if abs {
        return Some(v);
    }
    let n = i64::from(v) + d;
    (0..=i64::from(max)).contains(&n).then_some(n as u32)
}

fn shift_cell(c: CellRef, d_row: i64, d_col: i64) -> Option<CellRef> {
    Some(CellRef {
        row: shift(c.row, d_row, c.row_abs, MAX_ROW)?,
        col: shift(c.col, d_col, c.col_abs, MAX_COL)?,
        ..c
    })
}

/// Rewrites a formula for copy/paste by `(d_row, d_col)`: relative row and
/// column parts move by the delta, `$`-anchored parts stay. Whole-column
/// references move only horizontally, whole-row references only
/// vertically. A reference leaving the sheet becomes `#REF!`. Sheet
/// prefixes are untouched.
pub fn offset_relative(expr: &Expr, d_row: i64, d_col: i64) -> Expr {
    map_refs(expr, &|r: &Reference| match r.kind {
        RangeKind::Cell(c) => Some(RangeKind::Cell(shift_cell(c, d_row, d_col)?)),
        RangeKind::Area(a, b) => Some(RangeKind::area(
            shift_cell(a, d_row, d_col)?,
            shift_cell(b, d_row, d_col)?,
        )),
        RangeKind::Cols { start, end, abs } => {
            let (s, e) = (
                shift(start, d_col, abs, MAX_COL)?,
                shift(end, d_col, abs, MAX_COL)?,
            );
            Some(RangeKind::Cols {
                start: s.min(e),
                end: s.max(e),
                abs,
            })
        }
        RangeKind::Rows { start, end, abs } => {
            let (s, e) = (
                shift(start, d_row, abs, MAX_ROW)?,
                shift(end, d_row, abs, MAX_ROW)?,
            );
            Some(RangeKind::Rows {
                start: s.min(e),
                end: s.max(e),
                abs,
            })
        }
    })
}

/// Like [`offset_relative`], but relative parts wrap around the sheet
/// edges instead of becoming `#REF!` (how Excel applies a defined name's
/// relative references, stored relative to `A1`, in another cell:
/// `Sheet1!XFD1` used in `B3` is `A3`).
pub fn offset_relative_wrapping(expr: &Expr, d_row: i64, d_col: i64) -> Expr {
    let wrap = |v: u32, d: i64, abs: bool, max: u32| -> u32 {
        if abs {
            v
        } else {
            (i64::from(v) + d).rem_euclid(i64::from(max) + 1) as u32
        }
    };
    let cell = |c: CellRef| CellRef {
        row: wrap(c.row, d_row, c.row_abs, MAX_ROW),
        col: wrap(c.col, d_col, c.col_abs, MAX_COL),
        ..c
    };
    map_refs(expr, &|r: &Reference| match r.kind {
        RangeKind::Cell(c) => Some(RangeKind::Cell(cell(c))),
        RangeKind::Area(a, b) => Some(RangeKind::area(cell(a), cell(b))),
        RangeKind::Cols { start, end, abs } => {
            let (s, e) = (
                wrap(start, d_col, abs, MAX_COL),
                wrap(end, d_col, abs, MAX_COL),
            );
            Some(RangeKind::Cols {
                start: s.min(e),
                end: s.max(e),
                abs,
            })
        }
        RangeKind::Rows { start, end, abs } => {
            let (s, e) = (
                wrap(start, d_row, abs, MAX_ROW),
                wrap(end, d_row, abs, MAX_ROW),
            );
            Some(RangeKind::Rows {
                start: s.min(e),
                end: s.max(e),
                abs,
            })
        }
    })
}

/// An inclusive, 0-based cell rectangle (`r0 <= r1`, `c0 <= c1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellRect {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl CellRect {
    fn contains(&self, row: u32, col: u32) -> bool {
        (self.r0..=self.r1).contains(&row) && (self.c0..=self.c1).contains(&col)
    }
}

/// A cut-and-paste move, as seen from one formula: the cells of `src` on
/// `src_sheet` move by `(d_row, d_col)` to `dst_sheet`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoveContext<'a> {
    /// Sheet the formula lives on before the move (resolves references
    /// without a prefix).
    pub host_sheet: &'a str,
    pub src_sheet: &'a str,
    pub dst_sheet: &'a str,
    pub src: CellRect,
    pub d_row: i64,
    pub d_col: i64,
    /// The formula is itself one of the moved cells, so it ends up on
    /// `dst_sheet`; references that stay get a prefix where needed to keep
    /// pointing at their old sheet.
    pub formula_moves: bool,
}

/// Rewrites a formula for a cut-and-paste move (Excel rules): a cell
/// reference inside the moved rectangle, and an area reference lying
/// entirely inside it, follow the cells (`$` flags are kept and do not
/// matter); everything else, including partially covered areas and
/// whole-row/column references, is unchanged. When the cells move to
/// another sheet, followed references get the destination sheet's prefix
/// (none when the formula lives there). A reference pushed off the sheet
/// becomes `#REF!`.
///
/// ```
/// use engine_formula::{adjust_references_for_move, parse, CellRect, MoveContext};
///
/// let f = parse("=SUM(A1:A2)+A3+B1").unwrap();
/// let ctx = MoveContext {
///     host_sheet: "Sheet1",
///     src_sheet: "Sheet1",
///     dst_sheet: "Sheet1",
///     src: CellRect { r0: 0, c0: 0, r1: 1, c1: 0 },
///     d_row: 0,
///     d_col: 2,
///     formula_moves: false,
/// };
/// assert_eq!(adjust_references_for_move(&f, &ctx).to_string(), "SUM(C1:C2)+A3+B1");
/// ```
pub fn adjust_references_for_move(expr: &Expr, ctx: &MoveContext) -> Expr {
    let new_host = if ctx.formula_moves {
        ctx.dst_sheet
    } else {
        ctx.host_sheet
    };
    let cross = !same_sheet(ctx.src_sheet, ctx.dst_sheet);
    let moved = |c: CellRef| {
        Some(CellRef {
            row: shift(c.row, ctx.d_row, false, MAX_ROW)?,
            col: shift(c.col, ctx.d_col, false, MAX_COL)?,
            ..c
        })
    };
    map_references(expr, &|r: &Reference| {
        let target = r.sheet.as_deref().unwrap_or(ctx.host_sheet);
        let inside = same_sheet(target, ctx.src_sheet)
            && match r.kind {
                RangeKind::Cell(c) => ctx.src.contains(c.row, c.col),
                RangeKind::Area(a, b) => {
                    ctx.src.contains(a.row, a.col) && ctx.src.contains(b.row, b.col)
                }
                RangeKind::Rows { .. } | RangeKind::Cols { .. } => false,
            };
        let kind = if inside {
            match r.kind {
                RangeKind::Cell(c) => RangeKind::Cell(moved(c)?),
                RangeKind::Area(a, b) => RangeKind::area(moved(a)?, moved(b)?),
                kind => kind,
            }
        } else {
            r.kind
        };
        let (new_target, retargeted) = if inside && cross {
            (ctx.dst_sheet, true)
        } else {
            (target, false)
        };
        let sheet = match &r.sheet {
            Some(p) if !retargeted => Some(p.clone()),
            _ if same_sheet(new_target, new_host) => None,
            _ => Some(new_target.to_owned()),
        };
        Some(Reference { sheet, kind })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const INS: StructuralOp = StructuralOp::InsertRows { at: 3, count: 2 };
    const DEL: StructuralOp = StructuralOp::DeleteRows { at: 3, count: 2 };

    #[test]
    fn index_mapping() {
        assert_eq!(INS.map_index(2), Some(2));
        assert_eq!(INS.map_index(3), Some(5));
        assert_eq!(INS.map_index(MAX_ROW - 1), None);
        assert_eq!(DEL.map_index(2), Some(2));
        assert_eq!(DEL.map_index(3), None);
        assert_eq!(DEL.map_index(4), None);
        assert_eq!(DEL.map_index(5), Some(3));
        let cols = StructuralOp::InsertCols { at: 0, count: 1 };
        assert_eq!(cols.map_cell(7, 2), Some((7, 3)));
        assert_eq!(cols.map_cell(0, MAX_COL), None);
    }

    #[test]
    fn interval_mapping() {
        assert_eq!(INS.map_interval(0, 2), Some((0, 2)));
        assert_eq!(INS.map_interval(0, 3), Some((0, 5)));
        assert_eq!(INS.map_interval(3, 4), Some((5, 6)));
        assert_eq!(INS.map_interval(0, MAX_ROW), Some((0, MAX_ROW)));
        assert_eq!(INS.map_interval(MAX_ROW, MAX_ROW), None);
        assert_eq!(DEL.map_interval(0, 2), Some((0, 2)));
        assert_eq!(DEL.map_interval(0, 3), Some((0, 2)));
        assert_eq!(DEL.map_interval(4, 9), Some((3, 7)));
        assert_eq!(DEL.map_interval(1, 9), Some((1, 7)));
        assert_eq!(DEL.map_interval(3, 4), None);
        assert_eq!(DEL.map_interval(5, 6), Some((3, 4)));
    }

    fn mv(host: &str, formula: &str, ctx: MoveContext) -> String {
        let f = crate::parse(formula).unwrap();
        adjust_references_for_move(
            &f,
            &MoveContext {
                host_sheet: host,
                ..ctx
            },
        )
        .to_string()
    }

    /// B2:C3 on Sheet1 moves 3 rows down and 1 column right (to C5:D6).
    const MOVE: MoveContext = MoveContext {
        host_sheet: "Sheet1",
        src_sheet: "Sheet1",
        dst_sheet: "Sheet1",
        src: CellRect {
            r0: 1,
            c0: 1,
            r1: 2,
            c1: 2,
        },
        d_row: 3,
        d_col: 1,
        formula_moves: false,
    };

    #[test]
    fn move_follows_cells_inside() {
        assert_eq!(mv("Sheet1", "=B2+C3*2", MOVE), "C5+D6*2");
        assert_eq!(mv("Sheet1", "=$B$2+B$3", MOVE), "$C$5+C$6");
        assert_eq!(
            mv("Sheet1", "=SUM(B2:C3)+SUM(B2:B3)", MOVE),
            "SUM(C5:D6)+SUM(C5:C6)"
        );
        // Outside, partially covered or whole rows/columns: unchanged.
        assert_eq!(
            mv("Sheet1", "=A1+D2+SUM(A1:B2)+SUM(B:B)+SUM(2:2)", MOVE),
            "A1+D2+SUM(A1:B2)+SUM(B:B)+SUM(2:2)"
        );
    }

    #[test]
    fn move_respects_sheets() {
        // From another sheet: only references prefixed with the source sheet follow.
        assert_eq!(
            mv("Other", "=B2+Sheet1!B2+sheet1!C3:C3", MOVE),
            "B2+Sheet1!C5+sheet1!D6:D6"
        );
        assert_eq!(mv("Other", "=Sheet1!A1:B2", MOVE), "Sheet1!A1:B2");
        // Moved to another sheet: followed references get its prefix.
        let to_s2 = MoveContext {
            dst_sheet: "Sheet 2",
            ..MOVE
        };
        assert_eq!(mv("Sheet1", "=B2+A1", to_s2), "'Sheet 2'!C5+A1");
        assert_eq!(mv("Sheet 2", "=Sheet1!B2+B2", to_s2), "C5+B2");
        assert_eq!(mv("Other", "=Sheet1!B2:C2", to_s2), "'Sheet 2'!C5:D5");
    }

    #[test]
    fn moved_formula_keeps_pointing_at_its_old_sheet() {
        let to_s2 = MoveContext {
            dst_sheet: "Sheet2",
            formula_moves: true,
            ..MOVE
        };
        // A formula inside the block: block references follow, the rest keep their sheet.
        assert_eq!(
            mv("Sheet1", "=B3+A1+Other!A1", to_s2),
            "C6+Sheet1!A1+Other!A1"
        );
        let same = MoveContext {
            formula_moves: true,
            ..MOVE
        };
        assert_eq!(mv("Sheet1", "=B3+A1", same), "C6+A1");
    }

    #[test]
    fn move_off_the_sheet_is_ref_error() {
        let up = MoveContext { d_row: -2, ..MOVE };
        assert_eq!(mv("Sheet1", "=B2+B3", up), "#REF!+C1");
    }
}
