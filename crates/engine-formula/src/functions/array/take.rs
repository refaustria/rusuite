//! `TAKE(array, rows, [columns])` and `DROP(array, rows, [columns])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::Grid;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// A count argument (truncated); omitted = `None`.
fn count(ctx: &CallContext, args: &[Expr], i: usize) -> Result<Option<i64>, ErrorKind> {
    match args.get(i) {
        Some(e) if !ctx.is_missing(e) => {
            let n = ctx.number(e)?.trunc();
            if n.abs() > 1e9 {
                return Ok(Some(if n < 0.0 {
                    -1_000_000_000
                } else {
                    1_000_000_000
                }));
            }
            Ok(Some(n as i64))
        }
        _ => Ok(None),
    }
}

/// The kept index range of `len` items for TAKE (`n` from the start, `-n`
/// from the end) or DROP (the rest).
fn keep(len: usize, n: Option<i64>, take: bool) -> std::ops::Range<usize> {
    let Some(n) = n else {
        return 0..len;
    };
    let k = (n.unsigned_abs() as usize).min(len);
    match (take, n >= 0) {
        (true, true) => 0..k,
        (true, false) => len - k..len,
        (false, true) => k..len,
        (false, false) => 0..len - k,
    }
}

fn take_drop(args: &[Expr], ctx: &CallContext, take: bool) -> Result<Value, ErrorKind> {
    let g = Grid::of(ctx, &args[0])?;
    let rows = count(ctx, args, 1)?;
    let cols = count(ctx, args, 2)?;
    if take && (rows == Some(0) || cols == Some(0)) {
        return Err(ErrorKind::Calc);
    }
    let (rr, cr) = (keep(g.rows, rows, take), keep(g.cols, cols, take));
    let mut data = Vec::with_capacity(rr.len() * cr.len());
    for r in rr.clone() {
        for c in cr.clone() {
            data.push(g.get(r, c).clone());
        }
    }
    Grid {
        rows: rr.len(),
        cols: cr.len(),
        data,
    }
    .into_value()
}

function!(
    /// The first `rows` rows (negative: the last) and `columns` columns of
    /// an array; an omitted count keeps all, a count beyond the size keeps
    /// all, 0 is `#CALC!`. Stored as `_xlfn.TAKE`.
    Take, "TAKE", Arity::range(2, 3), |args, ctx| {
    take_drop(args, ctx, true)
});

function!(
    /// An array without its first `rows` rows (negative: the last) and
    /// `columns` columns; dropping everything is `#CALC!`. Stored as
    /// `_xlfn.DROP`.
    Drop, "DROP", Arity::range(2, 3), |args, ctx| {
    take_drop(args, ctx, false)
});
