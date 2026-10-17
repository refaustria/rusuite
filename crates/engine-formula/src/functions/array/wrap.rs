//! `WRAPROWS(vector, wrap_count, [pad_with])` and
//! `WRAPCOLS(vector, wrap_count, [pad_with])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::Grid;
use crate::functions::helpers::present;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn wrap(args: &[Expr], ctx: &CallContext, rows: bool) -> Result<Value, ErrorKind> {
    let g = Grid::of(ctx, &args[0])?;
    if g.rows > 1 && g.cols > 1 {
        return Err(ErrorKind::Value);
    }
    let count = ctx.number(&args[1])?.trunc();
    if count < 1.0 {
        return Err(ErrorKind::Num);
    }
    let pad = if present(ctx, args, 2) {
        ctx.scalar(&args[2])
    } else {
        Value::Error(ErrorKind::NA)
    };
    let n = g.data.len();
    let width = (count as usize).min(n.max(1));
    let lines = n.div_ceil(width);
    let mut data: Vec<Value> = g.data;
    data.resize(lines * width, pad);
    let out = Grid {
        rows: lines,
        cols: width,
        data,
    };
    if rows {
        out.into_value()
    } else {
        out.transpose().into_value()
    }
}

function!(
    /// A row or column of values wrapped into rows of `wrap_count` values;
    /// the last row is padded with `pad_with` (default `#N/A`). A 2-D array
    /// is `#VALUE!`, a count below 1 `#NUM!`. Stored as `_xlfn.WRAPROWS`.
    WrapRows, "WRAPROWS", Arity::range(2, 3), |args, ctx| {
    wrap(args, ctx, true)
});

function!(
    /// A row or column of values wrapped into columns of `wrap_count`
    /// values (as `WRAPROWS`). Stored as `_xlfn.WRAPCOLS`.
    WrapCols, "WRAPCOLS", Arity::range(2, 3), |args, ctx| {
    wrap(args, ctx, false)
});
