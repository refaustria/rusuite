//! `EXPAND(array, rows, [columns], [pad_with])`.

use crate::ast::ErrorKind;
use crate::functions::array::{cell_count, Grid};
use crate::functions::helpers::present;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// An array enlarged to `rows × columns` (omitted: its own size), the
    /// new cells filled with `pad_with` (default `#N/A`). A size smaller
    /// than the array is `#VALUE!`. Stored as `_xlfn.EXPAND`.
    Expand, "EXPAND", Arity::range(2, 4), |args, ctx| {
    let g = Grid::of(ctx, &args[0])?;
    let size = |i: usize, own: usize| -> Result<usize, ErrorKind> {
        if !present(ctx, args, i) {
            return Ok(own);
        }
        let n = ctx.number(&args[i])?.trunc();
        if n < own as f64 || n > 1_048_576.0 {
            return Err(ErrorKind::Value);
        }
        Ok(n as usize)
    };
    let rows = size(1, g.rows)?;
    let cols = size(2, g.cols)?;
    cell_count(rows, cols)?;
    let pad = if present(ctx, args, 3) {
        ctx.scalar(&args[3])
    } else {
        Value::Error(ErrorKind::NA)
    };
    let mut data = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            data.push(if r < g.rows && c < g.cols {
                g.get(r, c).clone()
            } else {
                pad.clone()
            });
        }
    }
    Grid { rows, cols, data }.into_value()
});
