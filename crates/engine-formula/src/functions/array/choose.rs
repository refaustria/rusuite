//! `CHOOSECOLS(array, col_num1, ...)` and `CHOOSEROWS(array, row_num1, ...)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::{numbers, Grid};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn choose(args: &[Expr], ctx: &CallContext, rows: bool) -> Result<Value, ErrorKind> {
    let g = Grid::of(ctx, &args[0])?;
    let g = if rows { g } else { g.transpose() };
    let mut picked = Vec::new();
    for a in &args[1..] {
        for n in numbers(ctx, a)? {
            let n = n.trunc();
            let len = g.rows as f64;
            let i = if n >= 1.0 && n <= len {
                n as usize - 1
            } else if n <= -1.0 && -n <= len {
                g.rows - (-n) as usize
            } else {
                return Err(ErrorKind::Value);
            };
            picked.push(i);
        }
    }
    let out = g.pick_rows(&picked);
    if rows {
        out.into_value()
    } else {
        out.transpose().into_value()
    }
}

function!(
    /// The columns of an array with the given numbers (negative: from the
    /// end; arrays of numbers allowed); 0 or beyond the width `#VALUE!`.
    /// Stored as `_xlfn.CHOOSECOLS`.
    ChooseCols, "CHOOSECOLS", Arity::range(2, 254), |args, ctx| {
    choose(args, ctx, false)
});

function!(
    /// The rows of an array with the given numbers (as `CHOOSECOLS`).
    /// Stored as `_xlfn.CHOOSEROWS`.
    ChooseRows, "CHOOSEROWS", Arity::range(2, 254), |args, ctx| {
    choose(args, ctx, true)
});
