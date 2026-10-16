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

pub use crate::coord::*;

/// Source of cell values for the evaluator.
pub trait CellProvider {
    /// Resolves a sheet name (case-insensitive).
    fn sheet_id(&self, name: &str) -> Option<SheetId>;
    /// Value of a cell: `Empty` for a blank cell, never `Array`.
    fn value(&self, c: CellCoord) -> Value;
    /// `(max_row, max_col)` (0-based, inclusive) of the used area, `None` if
    /// the sheet is empty. Used to clip whole-column/row references.
    fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)>;
    /// Whether row `row` of `sheet` is hidden, and why (read by
    /// `SUBTOTAL`). The default: every row is visible.
    fn row_hidden(&self, sheet: SheetId, row: u32) -> RowHidden {
        let _ = (sheet, row);
        RowHidden::Visible
    }
    /// Whether `c` holds a formula calling a function that reads row
    /// visibility (`SUBTOTAL`): such cells are skipped by `SUBTOTAL` to
    /// avoid double counting. The default: none.
    fn is_subtotal_cell(&self, c: CellCoord) -> bool {
        let _ = c;
        false
    }
    /// `(rows, cols)` of the range `c#` designates: the spill range of the
    /// formula in `c` (`(1, 1)` for a formula with a single value), `None`
    /// when `c` holds no formula or its array is blocked (`#SPILL!`). The
    /// default: no spills.
    fn spill_extent(&self, c: CellCoord) -> Option<(u32, u32)> {
        let _ = c;
        None
    }
    /// The definition of the defined name `name` (case-insensitive) as
    /// seen from `sheet`: the sheet's own name first, then the workbook's.
    /// The default: no names.
    fn defined_name(&self, name: &str, sheet: SheetId) -> Option<&Expr> {
        let _ = (name, sheet);
        None
    }
}

/// Nesting of names being evaluated (names referring to names); a name
/// referring to itself is `#NAME?` once the limit is reached.
const MAX_NAME_DEPTH: u32 = 32;

thread_local! {
    static NAME_DEPTH: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// Whether `e` holds a reference with a relative row or column part.
fn has_relative_refs(e: &Expr) -> bool {
    e.references().iter().any(|r| match r.kind {
        RangeKind::Cell(c) => !c.row_abs || !c.col_abs,
        RangeKind::Area(a, b) => !(a.row_abs && a.col_abs && b.row_abs && b.col_abs),
        RangeKind::Cols { abs, .. } | RangeKind::Rows { abs, .. } => !abs,
    })
}

/// A defined name's definition as used in the cell `at`: its relative
/// references are relative to `A1` (as Excel stores them), so they move
/// by the cell's position, wrapping around the sheet edges.
pub fn name_definition_at(def: &Expr, at: CellCoord) -> std::borrow::Cow<'_, Expr> {
    if (at.row, at.col) != (0, 0) && has_relative_refs(def) {
        std::borrow::Cow::Owned(crate::transform::offset_relative_wrapping(
            def,
            i64::from(at.row),
            i64::from(at.col),
        ))
    } else {
        std::borrow::Cow::Borrowed(def)
    }
}

/// Evaluates a defined name (`sheet`: the qualifying sheet, else the
/// current one) in array mode: a name for a range is that range.
fn name_operand(name: &str, sheet: Option<SheetId>, ctx: &EvalContext) -> Operand {
    let Some(def) = ctx
        .provider
        .defined_name(name, sheet.unwrap_or(ctx.current.sheet))
    else {
        return Operand::Scalar(Value::Error(ErrorKind::Name));
    };
    let depth = NAME_DEPTH.with(std::cell::Cell::get);
    if depth >= MAX_NAME_DEPTH {
        return Operand::Scalar(Value::Error(ErrorKind::Name));
    }
    NAME_DEPTH.with(|d| d.set(depth + 1));
    let def = name_definition_at(def, ctx.current);
    let out = eval_array(&def, ctx);
    NAME_DEPTH.with(|d| d.set(depth));
    out
}

/// The visibility of a row as `SUBTOTAL` sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum RowHidden {
    #[default]
    Visible,
    /// Hidden by the user (ignored by `SUBTOTAL(101..111)` only).
    Manual,
    /// Hidden by an AutoFilter (ignored by every `SUBTOTAL`).
    Filtered,
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
    /// Context with [`default_now`] as the clock.
    pub fn new(
        provider: &'a dyn CellProvider,
        registry: &'a FunctionRegistry,
        current: CellCoord,
    ) -> Self {
        EvalContext {
            provider,
            registry,
            current,
            now: default_now,
        }
    }
}

static DEFAULT_CLOCK: std::sync::LazyLock<std::sync::RwLock<fn() -> f64>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(system_now));

/// Installs the process-wide default clock used by [`default_now`] (and thus
/// by every [`EvalContext::new`] and `Engine::new`). Shells without a usable
/// `std::time` (wasm32) install a host clock once at start-up.
pub fn set_default_clock(f: fn() -> f64) {
    *DEFAULT_CLOCK
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = f;
}

/// The installed default clock's current value, or the [`system_now`]
/// fallback when none was installed.
pub fn default_now() -> f64 {
    let f = *DEFAULT_CLOCK
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    f()
}

/// The system clock (UTC) as an Excel 1900-system serial number.
#[cfg(not(target_arch = "wasm32"))]
pub fn system_now() -> f64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64());
    // 1970-01-01 is serial 25569.
    25569.0 + secs / 86_400.0
}

/// wasm32 fallback: `std::time` traps there, so this is serial 0
/// (1899-12-30) until a shell calls [`set_default_clock`].
#[cfg(target_arch = "wasm32")]
pub fn system_now() -> f64 {
    0.0
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

/// Evaluates a cell formula with dynamic-array semantics (Excel 365): the
/// top level is evaluated in array mode (see [`eval_array`]), so a range or
/// an array result is returned as `Value::Array` for the host to spill.
/// A one-cell result is returned as a scalar; `Empty` (also inside an
/// array) becomes `Number(0)`. Whole-column/row ranges are clipped to the
/// used range.
pub fn evaluate_formula(expr: &Expr, ctx: &EvalContext) -> Value {
    let zero = |v: Value| match v {
        Value::Empty => Value::Number(0.0),
        v => v,
    };
    let v = match eval_array(expr, ctx) {
        Operand::Range(r) => range_value(r, ctx),
        Operand::Scalar(v) => v,
    };
    match v {
        Value::Array(a) if a.rows() * a.cols() == 1 => zero(a.top_left()),
        Value::Array(a) if a.rows() == 0 || a.cols() == 0 => Value::Error(ErrorKind::Calc),
        Value::Array(a) => Value::Array(a.map(zero)),
        v => zero(v),
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
        Expr::Name(n) => name_operand(n, None, ctx),
        Expr::QualifiedName { sheet, name } => match ctx.provider.sheet_id(sheet) {
            Some(id) => name_operand(name, Some(id), ctx),
            None => Operand::Scalar(Value::Error(ErrorKind::Ref)),
        },
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
        Expr::Unary {
            op: UnaryOp::ImplicitIntersection,
            expr,
        } => Operand::Scalar(eval_scalar(expr, ctx)),
        Expr::Unary {
            op: UnaryOp::SpillRange,
            expr,
        } => spill_range(eval_ref(expr, ctx), ctx),
        Expr::Unary { op, expr } => Operand::Scalar(apply_unary(*op, eval_scalar(expr, ctx))),
        Expr::Binary {
            op: BinaryOp::Range,
            lhs,
            rhs,
        } => range_op(eval_ref(lhs, ctx), eval_ref(rhs, ctx)),
        Expr::Binary { op, lhs, rhs } => {
            let l = eval_scalar(lhs, ctx);
            let r = eval_scalar(rhs, ctx);
            Operand::Scalar(apply_binary(*op, l, r))
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

/// Evaluates an expression in *array mode* (used for arguments that expect
/// a range or an array, such as those of `SUMPRODUCT`).
///
/// References stay [`Operand::Range`] and literals, array literals, names
/// and function calls evaluate exactly as in [`eval_operand`] (functions
/// are not lifted over arrays). Unary and binary operators (except the
/// range operator `:`) evaluate their operands in array mode, materialize
/// ranges into arrays of cell values and apply the scalar operator
/// element-wise with broadcasting (see `broadcast`). The result is
/// `Scalar(Array)` when an operand was a range or an array, else a plain
/// scalar.
pub fn eval_array(expr: &Expr, ctx: &EvalContext) -> Operand {
    match expr {
        Expr::Unary { op, expr } if op.is_arithmetic() => {
            let v = materialize(eval_array(expr, ctx), ctx);
            Operand::Scalar(match v {
                Value::Array(a) => Value::Array(a.map(|x| apply_unary(*op, x))),
                v => apply_unary(*op, v),
            })
        }
        Expr::Binary { op, lhs, rhs } if *op != BinaryOp::Range => {
            let l = materialize(eval_array(lhs, ctx), ctx);
            let r = materialize(eval_array(rhs, ctx), ctx);
            Operand::Scalar(match (l, r) {
                (l @ Value::Array(_), r) | (l, r @ Value::Array(_)) => {
                    Value::Array(broadcast(&as_array(l), &as_array(r), |a, b| {
                        apply_binary(*op, a, b)
                    }))
                }
                (l, r) => apply_binary(*op, l, r),
            })
        }
        _ => eval_operand(expr, ctx),
    }
}

/// Turns a range operand into an array of its cell values (`Empty` cells
/// stay `Empty`); scalars are returned unchanged. Whole-column/row ranges
/// are clipped to the used range, keeping at least one row/column.
pub(crate) fn materialize(op: Operand, ctx: &EvalContext) -> Value {
    let r = match op {
        Operand::Scalar(v) => return v,
        Operand::Range(r) => r,
    };
    let (max_row, max_col) = ctx.provider.used_range(r.sheet).unwrap_or((0, 0));
    let r1 = if r.is_whole_columns() {
        r.r1.min(max_row.max(r.r0))
    } else {
        r.r1
    };
    let c1 = if r.is_whole_rows() {
        r.c1.min(max_col.max(r.c0))
    } else {
        r.c1
    };
    let mut data = Vec::with_capacity((r1 - r.r0 + 1) as usize * (c1 - r.c0 + 1) as usize);
    for row in r.r0..=r1 {
        for col in r.c0..=c1 {
            let v = ctx.provider.value(CellCoord {
                sheet: r.sheet,
                row,
                col,
            });
            data.push(v);
        }
    }
    let rows = (r1 - r.r0 + 1) as usize;
    let cols = (c1 - r.c0 + 1) as usize;
    Value::Array(Array::new(rows, cols, data).expect("rows * cols cells"))
}

/// The value of a range as a function result: the cell value for a single
/// cell, otherwise an array of the cell values (see `materialize`).
pub(crate) fn range_value(r: RangeRef, ctx: &EvalContext) -> Value {
    if r.is_single_cell() {
        ctx.provider
            .value(CellCoord {
                sheet: r.sheet,
                row: r.r0,
                col: r.c0,
            })
            .into_scalar()
    } else {
        materialize(Operand::Range(r), ctx)
    }
}

/// A value as an array (a scalar becomes 1x1).
fn as_array(v: Value) -> Array {
    match v {
        Value::Array(a) => a,
        v => Array::new(1, 1, vec![v]).expect("1x1 array"),
    }
}

/// Element-wise combination with Excel broadcasting, per dimension: an
/// extent of 1 repeats along that dimension; otherwise the result extent is
/// the larger one and positions outside an operand's extent are `#N/A`.
fn broadcast(a: &Array, b: &Array, f: impl Fn(Value, Value) -> Value) -> Array {
    let rows = a.rows().max(b.rows());
    let cols = a.cols().max(b.cols());
    let pick = |x: &Array, r: usize, c: usize| {
        let r = if x.rows() == 1 { 0 } else { r };
        let c = if x.cols() == 1 { 0 } else { c };
        x.get(r, c).cloned().unwrap_or(Value::Error(ErrorKind::NA))
    };
    let mut data = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            data.push(f(pick(a, r, c), pick(b, r, c)));
        }
    }
    Array::new(rows, cols, data).expect("rows * cols elements")
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

/// Evaluates an expression in *reference position* (an operand of the
/// range operator `:`, the argument of `ROW`/`COLUMN`): a function call
/// whose [`Function::call_ref`](crate::functions::Function::call_ref)
/// yields a reference (such as `INDEX(A1:A9,3)`) stays a range; anything
/// else evaluates as in [`eval_operand`].
pub fn eval_ref(expr: &Expr, ctx: &EvalContext) -> Operand {
    let Expr::Call { name, args } = expr else {
        return eval_operand(expr, ctx);
    };
    let Some(f) = ctx.registry.get(name) else {
        return Operand::Scalar(Value::Error(ErrorKind::Name));
    };
    if !f.arity().accepts(args.len()) {
        return Operand::Scalar(Value::Error(ErrorKind::Value));
    }
    let mut cc = CallContext::new(ctx);
    match f.call_ref(args, &mut cc) {
        Some(op) => op,
        None => Operand::Scalar(finish(f.call(args, &mut cc))),
    }
}

fn call(name: &str, args: &[Expr], ctx: &EvalContext) -> Value {
    let Some(f) = ctx.registry.get(name) else {
        return Value::Error(ErrorKind::Name);
    };
    if !f.arity().accepts(args.len()) {
        return Value::Error(ErrorKind::Value);
    }
    let mut cc = CallContext::new(ctx);
    finish(f.call(args, &mut cc))
}

/// Normalises a function result (`-0` and non-finite numbers).
fn finish(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::number(n),
        v => v,
    }
}

/// The spilled-range operator: `c#` for a one-cell reference `c` is the
/// range its formula spills into (`#REF!` otherwise).
fn spill_range(op: Operand, ctx: &EvalContext) -> Operand {
    match op {
        Operand::Range(r) if r.is_single_cell() => {
            let anchor = CellCoord {
                sheet: r.sheet,
                row: r.r0,
                col: r.c0,
            };
            match ctx.provider.spill_extent(anchor) {
                Some((rows, cols)) if rows > 0 && cols > 0 => Operand::Range(RangeRef {
                    r1: r.r0.saturating_add(rows - 1).min(MAX_ROW),
                    c1: r.c0.saturating_add(cols - 1).min(MAX_COL),
                    ..r
                }),
                _ => Operand::Scalar(Value::Error(ErrorKind::Ref)),
            }
        }
        Operand::Scalar(Value::Error(e)) => Operand::Scalar(Value::Error(e)),
        _ => Operand::Scalar(Value::Error(ErrorKind::Ref)),
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

/// A unary operator on one scalar value (shared by scalar and array mode).
fn apply_unary(op: UnaryOp, v: Value) -> Value {
    match op {
        UnaryOp::Plus => v,
        UnaryOp::Neg => Value::from_result(to_number(&v).map(|n| -n)),
        UnaryOp::Percent => Value::from_result(to_number(&v).map(|n| n / 100.0)),
        // Not element-wise: handled in `eval_operand`.
        UnaryOp::ImplicitIntersection | UnaryOp::SpillRange => v.into_scalar(),
    }
}

/// A binary operator on two scalar values (shared by scalar and array
/// mode). The left error wins.
fn apply_binary(op: BinaryOp, l: Value, r: Value) -> Value {
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
            if x == 0.0 && y < 0.0 {
                // Excel: 0 raised to a negative power is a division by zero.
                return Err(ErrorKind::Div0);
            }
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
        assert_eq!(ev("=0^-1"), e(ErrorKind::Div0));
        assert_eq!(ev("=0^-0.5"), e(ErrorKind::Div0));
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
    fn range_operator_with_reference_functions() {
        // A1 = 1, A2 = "x": only the number is summed.
        assert_eq!(ev("=SUM(A1:INDEX(A1:A3,2))"), n(1.0));
        assert_eq!(ev("=SUM(INDEX(A1:C3,1,1):A3)"), n(4.0));
        assert_eq!(ev("=SUM(A1:INDEX(C1:C3,2,1))"), e(ErrorKind::NA));
        assert_eq!(ev("=SUM(A1:INDEX(A1:A3,9))"), e(ErrorKind::Ref));
        assert_eq!(ev("=SUM(A1:INDEX({1,2},1))"), e(ErrorKind::Value));
        assert_eq!(ev("=SUM(A1:INDEX(S2!A1:A3,1))"), e(ErrorKind::Value));
        assert_eq!(ev("=SUM(A1:NOSUCHFN(A3))"), e(ErrorKind::Name));
        assert_eq!(ev("=SUM(A1:INDEX(A1:A3))"), e(ErrorKind::Value));
        assert_eq!(
            arr("=A1:INDEX(A1:C3,2,0)"),
            Operand::Range(RangeRef {
                sheet: SheetId(0),
                r0: 0,
                c0: 0,
                r1: 1,
                c1: 2,
            })
        );
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

    /// `eval_array` in S1!J10.
    fn arr(formula: &str) -> Operand {
        let grid = Grid::new();
        let reg = FunctionRegistry::with_builtins();
        let ctx = EvalContext {
            provider: &grid,
            registry: &reg,
            current: CellCoord {
                sheet: SheetId(0),
                row: 9,
                col: 9,
            },
            now: || 45000.5,
        };
        eval_array(&parse(formula).unwrap(), &ctx)
    }

    /// Expected `Scalar(Array)` from rows.
    fn grid_of(rows: Vec<Vec<Value>>) -> Operand {
        Operand::Scalar(Value::Array(Array::from_rows(rows).unwrap()))
    }

    #[test]
    fn array_mode_range_times_scalar() {
        assert_eq!(
            arr("=A1:A3*2"),
            grid_of(vec![vec![n(2.0)], vec![e(ErrorKind::Value)], vec![n(6.0)]])
        );
        // "x" > 2 is TRUE (text ranks above numbers).
        assert_eq!(
            arr("=(A1:A3>2)*1"),
            grid_of(vec![vec![n(0.0)], vec![n(1.0)], vec![n(1.0)]])
        );
        // Scalar mode is unchanged: implicit intersection fails in J10.
        assert_eq!(ev("=A1:A3*2"), e(ErrorKind::Value));
    }

    #[test]
    fn array_mode_column_by_row_broadcast() {
        assert_eq!(
            arr("=A1:A3&{\"a\",\"b\"}"),
            grid_of(vec![
                vec![t("1a"), t("1b")],
                vec![t("xa"), t("xb")],
                vec![t("3a"), t("3b")],
            ])
        );
        assert_eq!(
            arr("={1,2}+{10;20}"),
            grid_of(vec![vec![n(11.0), n(12.0)], vec![n(21.0), n(22.0)]])
        );
        // A column pairs with every column of a 2-D array.
        assert_eq!(
            arr("={1;2}*{1,2;3,4}"),
            grid_of(vec![vec![n(1.0), n(2.0)], vec![n(6.0), n(8.0)]])
        );
    }

    #[test]
    fn array_mode_mismatched_shapes_give_na() {
        let na = e(ErrorKind::NA);
        assert_eq!(
            arr("={1,2,3}+{10,20}"),
            grid_of(vec![vec![n(11.0), n(22.0), na.clone()]])
        );
        assert_eq!(
            arr("={1;2}*{1,2;3,4;5,6}"),
            grid_of(vec![
                vec![n(1.0), n(2.0)],
                vec![n(6.0), n(8.0)],
                vec![na.clone(), na.clone()],
            ])
        );
        assert_eq!(
            arr("={1,2;3,4}-{1,2,3;4,5,6}"),
            grid_of(vec![
                vec![n(0.0), n(0.0), na.clone()],
                vec![n(-1.0), n(-1.0), na],
            ])
        );
    }

    #[test]
    fn array_mode_scalars_stay_scalar() {
        assert_eq!(arr("=1+2"), Operand::Scalar(n(3.0)));
        assert_eq!(arr("=-\"3\"%"), Operand::Scalar(n(-0.03)));
        assert_eq!(arr("=1/0"), Operand::Scalar(e(ErrorKind::Div0)));
        assert_eq!(arr("=foo+1"), Operand::Scalar(e(ErrorKind::Name)));
        assert_eq!(arr("=SUM(A1:A3)*2"), Operand::Scalar(n(8.0)));
        // Plain references and the range operator are left as ranges.
        let a1_a3 = RangeRef {
            sheet: SheetId(0),
            r0: 0,
            c0: 0,
            r1: 2,
            c1: 0,
        };
        assert_eq!(arr("=A1:A3"), Operand::Range(a1_a3));
        assert_eq!(arr("=A1:(A3)"), Operand::Range(a1_a3));
        assert_eq!(arr("={1,2}"), grid_of(vec![vec![n(1.0), n(2.0)]]));
    }

    #[test]
    fn array_mode_call_is_broadcast() {
        assert_eq!(
            arr("=A1:A3+SUM(A1:A3)"),
            grid_of(vec![vec![n(5.0)], vec![e(ErrorKind::Value)], vec![n(7.0)]])
        );
        assert_eq!(
            arr("=LEN({\"ab\",\"c\"})&A1:A2"),
            grid_of(vec![vec![t("21")], vec![t("2x")]])
        );
    }

    #[test]
    fn array_mode_unary_empty_and_errors() {
        assert_eq!(
            arr("=-A1:A3"),
            grid_of(vec![
                vec![n(-1.0)],
                vec![e(ErrorKind::Value)],
                vec![n(-3.0)]
            ])
        );
        // Empty cells stay Empty when materialized.
        assert_eq!(
            arr("=+B1:B2"),
            grid_of(vec![vec![b(true)], vec![Value::Empty]])
        );
        assert_eq!(
            arr("=B1:B2&\"\""),
            grid_of(vec![vec![t("TRUE")], vec![t("")]])
        );
        // Element-wise left-first error propagation.
        assert_eq!(
            arr("=C1:C2+#DIV/0!"),
            grid_of(vec![vec![e(ErrorKind::NA)], vec![e(ErrorKind::Div0)]])
        );
        assert_eq!(arr("=Nope!A1:A2*1"), Operand::Scalar(e(ErrorKind::Ref)));
    }

    #[test]
    fn array_mode_whole_columns_are_clipped() {
        assert_eq!(
            arr("=A:A*1"),
            grid_of(vec![vec![n(1.0)], vec![e(ErrorKind::Value)], vec![n(3.0)]])
        );
        assert_eq!(arr("=Blank!A:A+1"), grid_of(vec![vec![n(1.0)]]));
        assert_eq!(arr("=Blank!1:1+1"), grid_of(vec![vec![n(1.0)]]));
    }

    #[test]
    fn array_mode_sumproduct_style() {
        let Operand::Scalar(Value::Array(a)) = arr("=(A1:A3>1)*(A1:A3<4)") else {
            panic!("expected an array");
        };
        let total: f64 = a.values().iter().map(|v| to_number(v).unwrap()).sum();
        assert_eq!(total, 1.0);
        // Through `CallContext::range` (CONCAT reads its arguments as ranges).
        assert_eq!(ev("=CONCAT(A1:A3&\"-\")"), t("1-x-3-"));
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
