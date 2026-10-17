//! `TOCOL(array, [ignore], [scan_by_column])` and
//! `TOROW(array, [ignore], [scan_by_column])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::Grid;
use crate::functions::helpers::{opt_num, present};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn flatten(args: &[Expr], ctx: &CallContext, column: bool) -> Result<Value, ErrorKind> {
    let g = Grid::of(ctx, &args[0])?;
    let ignore = opt_num(ctx, args, 1, 0.0)?.trunc();
    if !(0.0..=3.0).contains(&ignore) {
        return Err(ErrorKind::Value);
    }
    let by_col = present(ctx, args, 2) && ctx.bool(&args[2])?;
    let (skip_blank, skip_err) = (ignore == 1.0 || ignore == 3.0, ignore >= 2.0);
    let order: Vec<&Value> = if by_col {
        (0..g.cols)
            .flat_map(|c| (0..g.rows).map(move |r| (r, c)))
            .map(|(r, c)| g.get(r, c))
            .collect()
    } else {
        g.data.iter().collect()
    };
    let data: Vec<Value> = order
        .into_iter()
        .filter(|v| !(skip_blank && matches!(v, Value::Empty)))
        .filter(|v| !(skip_err && matches!(v, Value::Error(_))))
        .cloned()
        .collect();
    let n = data.len();
    let (rows, cols) = if column { (n, 1) } else { (1, n) };
    Grid { rows, cols, data }.into_value()
}

function!(
    /// The values of an array in one column, row by row (or column by
    /// column with `scan_by_column`); `ignore` 1 skips blanks, 2 errors, 3
    /// both. Nothing left `#CALC!`. Stored as `_xlfn.TOCOL`.
    ToCol, "TOCOL", Arity::range(1, 3), |args, ctx| {
    flatten(args, ctx, true)
});

function!(
    /// The values of an array in one row (as `TOCOL`). Stored as
    /// `_xlfn.TOROW`.
    ToRow, "TOROW", Arity::range(1, 3), |args, ctx| {
    flatten(args, ctx, false)
});
