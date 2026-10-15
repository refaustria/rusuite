//! Expression evaluator: references, operators and function dispatch.
//!
//! [`evaluate`] computes the value of a parsed [`Expr`] in the context of a
//! cell ([`EvalContext::current`]), reading other cells through a
//! [`CellProvider`]. Recalculation ordering is not handled here.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use crate::ast::{BinaryOp, ErrorKind, Expr, RangeKind, Reference, UnaryOp, MAX_COL, MAX_ROW};
use crate::functions::{CallContext, FunctionRegistry};
use crate::value::{compare, to_number, to_text, Array, Value};

/// Identifies a sheet within a workbook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SheetId(pub u32);

/// Absolute cell position (0-based row and column).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellCoord {
    pub sheet: SheetId,
    pub row: u32,
    pub col: u32,
}

/// Source of cell values for the evaluator.
pub trait CellProvider {
    /// Resolves a sheet name (case-insensitive).
    fn sheet_id(&self, name: &str) -> Option<SheetId>;
    /// Value of a cell: `Empty` for a blank cell, never `Array`.
    fn value(&self, c: CellCoord) -> Value;
    /// `(max_row, max_col)` (0-based, inclusive) of the used area, `None` if
    /// the sheet is empty. Used to clip whole-column/row references.
    fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)>;
}

/// Everything an evaluation needs.
#[derive(Clone, Copy)]
pub struct EvalContext<'a> {
    pub provider: &'a dyn CellProvider,
    pub registry: &'a FunctionRegistry,
    /// The cell holding the formula (used for implicit intersection and
    /// sheet-less references).
    pub current: CellCoord,
    /// Current date-time as an Excel serial number (for `NOW`/`TODAY`);
    /// injectable for tests.
    pub now: fn() -> f64,
}

impl<'a> EvalContext<'a> {
    /// Context with [`system_now`] as the clock.
    pub fn new(
        provider: &'a dyn CellProvider,
        registry: &'a FunctionRegistry,
        current: CellCoord,
    ) -> Self {
        EvalContext {
            provider,
            registry,
            current,
            now: system_now,
        }
    }
}

/// The system clock (UTC) as an Excel 1900-system serial number.
pub fn system_now() -> f64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64());
    // 1970-01-01 is serial 25569.
    25569.0 + secs / 86_400.0
}

/// A resolved rectangular reference (0-based, inclusive bounds,
/// `r0 <= r1`, `c0 <= c1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RangeRef {
    pub sheet: SheetId,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl RangeRef {
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

/// Result of evaluating a sub-expression before it is forced to a scalar.
#[derive(Debug, Clone, PartialEq)]
pub enum Operand {
    Scalar(Value),
    Range(RangeRef),
}

/// Evaluates a formula and returns its cell value: `Empty` becomes
/// `Number(0)`, an array is reduced to its top-left element, a range to its
/// implicit intersection with `ctx.current`.
pub fn evaluate(expr: &Expr, ctx: &EvalContext) -> Value {
    match scalar(eval_operand(expr, ctx), ctx) {
        Value::Empty => Value::Number(0.0),
        v => v,
    }
}

/// Evaluates an expression without dereferencing references.
pub fn eval_operand(expr: &Expr, ctx: &EvalContext) -> Operand {
    match expr {
        Expr::Number(n) => Operand::Scalar(Value::number(*n)),
        Expr::Text(s) => Operand::Scalar(Value::Text(s.clone())),
        Expr::Bool(b) => Operand::Scalar(Value::Bool(*b)),
        Expr::Error(e) => Operand::Scalar(Value::Error(*e)),
        Expr::Missing => Operand::Scalar(Value::Empty),
        // Named ranges are not supported yet.
        Expr::Name(_) => Operand::Scalar(Value::Error(ErrorKind::Name)),
        Expr::Reference(r) => match resolve(r, ctx) {
            Ok(range) => Operand::Range(range),
            Err(e) => Operand::Scalar(Value::Error(e)),
        },
        Expr::Array(rows) => {
            let rows = rows
                .iter()
                .map(|row| row.iter().map(|e| eval_scalar(e, ctx)).collect())
                .collect();
            Operand::Scalar(match Array::from_rows(rows) {
                Some(a) => Value::Array(a),
                None => Value::Error(ErrorKind::Value),
            })
        }
        Expr::Call { name, args } => Operand::Scalar(call(name, args, ctx)),
        Expr::Unary { op, expr } => Operand::Scalar(unary(*op, eval_scalar(expr, ctx))),
        Expr::Binary {
            op: BinaryOp::Range,
            lhs,
            rhs,
        } => range_op(eval_operand(lhs, ctx), eval_operand(rhs, ctx)),
        Expr::Binary { op, lhs, rhs } => {
            let l = eval_scalar(lhs, ctx);
            let r = eval_scalar(rhs, ctx);
            Operand::Scalar(binary(*op, l, r))
        }
    }
}

/// Evaluates an expression in scalar position (dereferenced, implicitly
/// intersected, arrays reduced to their top-left element). `Empty` is kept.
pub fn eval_scalar(expr: &Expr, ctx: &EvalContext) -> Value {
    scalar(eval_operand(expr, ctx), ctx)
}

/// Forces an operand to a scalar value (see [`eval_scalar`]).
pub fn scalar(op: Operand, ctx: &EvalContext) -> Value {
    match op {
        Operand::Scalar(v) => v.into_scalar(),
        Operand::Range(r) => intersect(&r, ctx),
    }
}

/// Implicit intersection of a range with the formula cell.
fn intersect(r: &RangeRef, ctx: &EvalContext) -> Value {
    let cell = if r.is_single_cell() {
        Some((r.r0, r.c0))
    } else if r.c0 == r.c1 {
        let row = ctx.current.row;
        (r.r0..=r.r1).contains(&row).then_some((row, r.c0))
    } else if r.r0 == r.r1 {
        let col = ctx.current.col;
        (r.c0..=r.c1).contains(&col).then_some((r.r0, col))
    } else {
        None
    };
    match cell {
        Some((row, col)) => ctx
            .provider
            .value(CellCoord {
                sheet: r.sheet,
                row,
                col,
            })
            .into_scalar(),
        None => Value::Error(ErrorKind::Value),
    }
}

/// Resolves an AST reference against the context (unknown sheet → `#REF!`).
pub fn resolve(r: &Reference, ctx: &EvalContext) -> Result<RangeRef, ErrorKind> {
    let sheet = match &r.sheet {
        None => ctx.current.sheet,
        Some(name) => ctx.provider.sheet_id(name).ok_or(ErrorKind::Ref)?,
    };
    let (r0, c0, r1, c1) = match r.kind {
        RangeKind::Cell(c) => (c.row, c.col, c.row, c.col),
        RangeKind::Area(a, b) => (
            a.row.min(b.row),
            a.col.min(b.col),
            a.row.max(b.row),
            a.col.max(b.col),
        ),
        RangeKind::Cols { start, end, .. } => (0, start.min(end), MAX_ROW, start.max(end)),
        RangeKind::Rows { start, end, .. } => (start.min(end), 0, start.max(end), MAX_COL),
    };
    Ok(RangeRef {
        sheet,
        r0,
        c0,
        r1,
        c1,
    })
}

fn call(name: &str, args: &[Expr], ctx: &EvalContext) -> Value {
    let Some(f) = ctx.registry.get(name) else {
        return Value::Error(ErrorKind::Name);
    };
    if !f.arity().accepts(args.len()) {
        return Value::Error(ErrorKind::Value);
    }
    let mut cc = CallContext::new(ctx);
    match f.call(args, &mut cc) {
        Value::Number(n) => Value::number(n),
        v => v,
    }
}

fn range_op(l: Operand, r: Operand) -> Operand {
    match (l, r) {
        (Operand::Range(a), Operand::Range(b)) if a.sheet == b.sheet => Operand::Range(a.union(&b)),
        (Operand::Scalar(Value::Error(e)), _) | (_, Operand::Scalar(Value::Error(e))) => {
            Operand::Scalar(Value::Error(e))
        }
        _ => Operand::Scalar(Value::Error(ErrorKind::Value)),
    }
}

fn unary(op: UnaryOp, v: Value) -> Value {
    match op {
        UnaryOp::Plus => v,
        UnaryOp::Neg => Value::from_result(to_number(&v).map(|n| -n)),
        UnaryOp::Percent => Value::from_result(to_number(&v).map(|n| n / 100.0)),
    }
}

fn binary(op: BinaryOp, l: Value, r: Value) -> Value {
    if let Value::Error(e) = l {
        return Value::Error(e);
    }
    if let Value::Error(e) = r {
        return Value::Error(e);
    }
    match op {
        BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div | BinaryOp::Pow => {
            Value::from_result(arith(op, &l, &r))
        }
        BinaryOp::Concat => Value::from_result(to_text(&l).and_then(|a| Ok(a + &to_text(&r)?))),
        BinaryOp::Eq | BinaryOp::Ne | BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge => {
            Value::from_result(compare(&l, &r).map(|o| match op {
                BinaryOp::Eq => o == Ordering::Equal,
                BinaryOp::Ne => o != Ordering::Equal,
                BinaryOp::Lt => o == Ordering::Less,
                BinaryOp::Le => o != Ordering::Greater,
                BinaryOp::Gt => o == Ordering::Greater,
                _ => o != Ordering::Less,
            }))
        }
        // Handled in `eval_operand`; only reachable with scalar operands.
        BinaryOp::Range => Value::Error(ErrorKind::Value),
    }
}

fn arith(op: BinaryOp, l: &Value, r: &Value) -> Result<f64, ErrorKind> {
    let x = to_number(l)?;
    let y = to_number(r)?;
    let n = match op {
        BinaryOp::Add => x + y,
        BinaryOp::Sub => x - y,
        BinaryOp::Mul => x * y,
        BinaryOp::Div => {
            if y == 0.0 {
                return Err(ErrorKind::Div0);
            }
            x / y
        }
        _ => {
            if (x == 0.0 && y == 0.0) || (x < 0.0 && y.fract() != 0.0) {
                return Err(ErrorKind::Num);
            }
            x.powf(y)
        }
    };
    if n.is_finite() {
        Ok(n)
    } else {
        Err(ErrorKind::Num)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;
    use std::collections::HashMap;

    /// Sheet 0 "S1": A1..A3 = 1, "x", 3; B1 = TRUE; C1 = #N/A; C2 = 5.
    /// Sheet 1 "S2": A1 = 7.
    struct Grid(HashMap<(u32, u32, u32), Value>);

    impl Grid {
        fn new() -> Self {
            let mut m = HashMap::new();
            m.insert((0, 0, 0), Value::Number(1.0));
            m.insert((0, 1, 0), Value::Text("x".into()));
            m.insert((0, 2, 0), Value::Number(3.0));
            m.insert((0, 0, 1), Value::Bool(true));
            m.insert((0, 0, 2), Value::Error(ErrorKind::NA));
            m.insert((0, 1, 2), Value::Number(5.0));
            m.insert((1, 0, 0), Value::Number(7.0));
            Grid(m)
        }
    }

    impl CellProvider for Grid {
        fn sheet_id(&self, name: &str) -> Option<SheetId> {
            ["S1", "S2", "Blank"]
                .iter()
                .position(|s| s.eq_ignore_ascii_case(name))
                .map(|i| SheetId(i as u32))
        }
        fn value(&self, c: CellCoord) -> Value {
            self.0
                .get(&(c.sheet.0, c.row, c.col))
                .cloned()
                .unwrap_or(Value::Empty)
        }
        fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
            let cells = self.0.keys().filter(|k| k.0 == sheet.0);
            let mut out = None;
            for &(_, r, c) in cells {
                let (mr, mc) = out.unwrap_or((0, 0));
                out = Some((r.max(mr), c.max(mc)));
            }
            out
        }
    }

    fn eval_at(formula: &str, row: u32, col: u32) -> Value {
        let grid = Grid::new();
        let reg = FunctionRegistry::with_builtins();
        let ctx = EvalContext {
            provider: &grid,
            registry: &reg,
            current: CellCoord {
                sheet: SheetId(0),
                row,
                col,
            },
            now: || 45000.5,
        };
        evaluate(&parse(formula).unwrap(), &ctx)
    }

    /// Evaluates in S1!J10 (row 9, col 9).
    fn ev(formula: &str) -> Value {
        eval_at(formula, 9, 9)
    }

    fn n(x: f64) -> Value {
        Value::Number(x)
    }
    fn t(s: &str) -> Value {
        Value::Text(s.into())
    }
    fn b(x: bool) -> Value {
        Value::Bool(x)
    }
    fn e(k: ErrorKind) -> Value {
        Value::Error(k)
    }

    #[test]
    fn arithmetic() {
        assert_eq!(ev("=1+2*3"), n(7.0));
        assert_eq!(ev("=\"3\"+1"), n(4.0));
        assert_eq!(ev("=TRUE+TRUE"), n(2.0));
        assert_eq!(ev("=Z9+1"), n(1.0));
        assert_eq!(ev("=\"a\"+1"), e(ErrorKind::Value));
        assert_eq!(ev("=10-4"), n(6.0));
        assert_eq!(ev("=\"5\"*\"2\""), n(10.0));
        assert_eq!(ev("=1/4"), n(0.25));
        assert_eq!(ev("=1/0"), e(ErrorKind::Div0));
        assert_eq!(ev("=1/Z9"), e(ErrorKind::Div0));
        assert_eq!(ev("=1E308*10"), e(ErrorKind::Num));
    }

    #[test]
    fn power() {
        assert_eq!(ev("=2^3"), n(8.0));
        assert_eq!(ev("=2^\"3\""), n(8.0));
        assert_eq!(ev("=4^0.5"), n(2.0));
        assert_eq!(ev("=0^0"), e(ErrorKind::Num));
        assert_eq!(ev("=(-8)^(1/3)"), e(ErrorKind::Num));
        assert_eq!(ev("=(-2)^3"), n(-8.0));
        assert_eq!(ev("=10^400"), e(ErrorKind::Num));
        assert_eq!(ev("=0^-1"), e(ErrorKind::Num));
    }

    #[test]
    fn unary_operators() {
        assert_eq!(ev("=-Z9"), n(0.0));
        assert_eq!(ev("=-\"3\""), n(-3.0));
        assert_eq!(ev("=-\"a\""), e(ErrorKind::Value));
        assert_eq!(ev("=-TRUE"), n(-1.0));
        assert_eq!(ev("=+\"a\""), t("a"));
        assert_eq!(ev("=+A2"), t("x"));
        assert_eq!(ev("=+Z9"), n(0.0));
        assert_eq!(ev("=5%"), n(0.05));
        assert_eq!(ev("=\"50\"%"), n(0.5));
        assert_eq!(ev("=\"a\"%"), e(ErrorKind::Value));
        assert_eq!(ev("=-#NUM!"), e(ErrorKind::Num));
    }

    #[test]
    fn concat() {
        assert_eq!(ev("=Z9&\"x\""), t("x"));
        assert_eq!(ev("=1&TRUE"), t("1TRUE"));
        assert_eq!(ev("=\"a\"&1.5"), t("a1.5"));
        assert_eq!(ev("=1/3&\"\""), t("0.333333333333333"));
        assert_eq!(ev("=A1&A2"), t("1x"));
        assert_eq!(ev("=#N/A&\"x\""), e(ErrorKind::NA));
        assert_eq!(ev("=Z9&Z9"), t(""));
    }

    #[test]
    fn comparison_matrix() {
        for (f, want) in [
            ("=1<\"a\"", true),
            ("=\"a\"<TRUE", true),
            ("=1=\"1\"", false),
            ("=1<TRUE", true),
            ("=FALSE>\"zzz\"", true),
            ("=TRUE=1", false),
            ("=FALSE=0", false),
            ("=\"a\"=\"A\"", true),
            ("=\"B\"<\"a\"", false),
            ("=\"apple\"<\"banana\"", true),
            ("=FALSE<TRUE", true),
            ("=2>=2", true),
            ("=1<>1", false),
            ("=2<=1", false),
            ("=Z9=0", true),
            ("=Z9=\"\"", true),
            ("=Z9=FALSE", true),
            ("=Z9=Z8", true),
            ("=Z9<1", true),
            ("=Z9<\"a\"", true),
            ("=Z9<TRUE", true),
            ("=\"\"=0", false),
            ("=0.1+0.2=0.3", true),
            ("=\"ä\"=\"Ä\"", true),
        ] {
            assert_eq!(ev(f), b(want), "{f}");
        }
        assert_eq!(ev("=#N/A=#DIV/0!"), e(ErrorKind::NA));
        assert_eq!(ev("=1=#DIV/0!"), e(ErrorKind::Div0));
    }

    #[test]
    fn errors_propagate_left_first() {
        assert_eq!(ev("=#N/A+#DIV/0!"), e(ErrorKind::NA));
        assert_eq!(ev("=#DIV/0!+#N/A"), e(ErrorKind::Div0));
        assert_eq!(ev("=C1+1"), e(ErrorKind::NA));
        assert_eq!(ev("=#REF!&#N/A"), e(ErrorKind::Ref));
    }

    #[test]
    fn references() {
        assert_eq!(ev("=A1"), n(1.0));
        assert_eq!(ev("=S2!A1*2"), n(14.0));
        assert_eq!(ev("='s2'!A1"), n(7.0));
        assert_eq!(ev("=Nope!A1"), e(ErrorKind::Ref));
        assert_eq!(ev("=SUM(Nope!A1:A3)"), e(ErrorKind::Ref));
        assert_eq!(ev("=Z99"), n(0.0));
        assert_eq!(ev("=foo"), e(ErrorKind::Name));
    }

    #[test]
    fn empty_result_is_zero_but_flows_inside() {
        assert_eq!(ev("=Z9"), n(0.0));
        assert_eq!(ev("=Z9&\"\""), t(""));
        assert_eq!(ev("=IF(TRUE,Z9)"), n(0.0));
    }

    #[test]
    fn array_results() {
        assert_eq!(ev("={1,2;3,4}"), n(1.0));
        assert_eq!(ev("={\"a\",2}&\"b\""), t("ab"));
        assert_eq!(ev("=SUM({1,2;3,4})"), n(10.0));
        assert_eq!(ev("={-1,2}"), n(-1.0));
    }

    #[test]
    fn implicit_intersection() {
        // Column range, formula in the same row.
        assert_eq!(eval_at("=A1:A3", 1, 5), t("x"));
        assert_eq!(eval_at("=A1:A3+1", 2, 5), n(4.0));
        assert_eq!(eval_at("=A:A", 0, 5), n(1.0));
        // Column range, formula in another row.
        assert_eq!(eval_at("=A1:A3", 5, 5), e(ErrorKind::Value));
        // Row range uses the current column.
        assert_eq!(eval_at("=A1:C1", 7, 1), b(true));
        assert_eq!(eval_at("=A1:C1", 7, 4), e(ErrorKind::Value));
        // 2-D range never intersects.
        assert_eq!(eval_at("=A1:C3", 1, 1), e(ErrorKind::Value));
        // Single cell range.
        assert_eq!(eval_at("=C2:C2", 7, 7), n(5.0));
    }

    #[test]
    fn range_operator() {
        assert_eq!(ev("=SUM(A1:(A3))"), n(4.0));
        assert_eq!(ev("=SUM(A1:IF(TRUE,A3))"), e(ErrorKind::Value));
        assert_eq!(ev("=SUM(#N/A:A1)"), e(ErrorKind::NA));
    }

    #[test]
    fn functions_dispatch() {
        assert_eq!(ev("=UNKNOWNFN(1)"), e(ErrorKind::Name));
        assert_eq!(ev("=UNKNOWNFN(C1)"), e(ErrorKind::Name));
        assert_eq!(ev("=LEN()"), e(ErrorKind::Value));
        assert_eq!(ev("=LEN(1,2)"), e(ErrorKind::Value));
        assert_eq!(ev("=NA(1)"), e(ErrorKind::Value));
        assert_eq!(ev("=IF()"), e(ErrorKind::Value));
        assert_eq!(ev("=IF(1,2,3,4)"), e(ErrorKind::Value));
        assert_eq!(ev("=sum(1,2)"), n(3.0));
    }

    #[test]
    fn whole_column_on_empty_sheet() {
        assert_eq!(ev("=SUM(Blank!A:A)"), n(0.0));
        assert_eq!(ev("=SUM(Blank!1:3)"), n(0.0));
        assert_eq!(ev("=SUM(S1!2:2)"), n(5.0));
        assert_eq!(ev("=SUM(C:C)"), e(ErrorKind::NA));
    }

    #[test]
    fn range_ref_helpers() {
        let grid = Grid::new();
        let r = RangeRef {
            sheet: SheetId(0),
            r0: 0,
            c0: 0,
            r1: MAX_ROW,
            c1: 1,
        };
        assert!(r.is_whole_columns() && !r.is_whole_rows());
        let c = r.clipped(&grid).unwrap();
        assert_eq!((c.r1, c.c1), (2, 1));
        assert_eq!(r.at(0, 2), None);
        assert_eq!(
            r.at(1, 1),
            Some(CellCoord {
                sheet: SheetId(0),
                row: 1,
                col: 1
            })
        );
        let blank = RangeRef {
            sheet: SheetId(2),
            ..r
        };
        assert_eq!(blank.clipped(&grid), None);
    }
}
