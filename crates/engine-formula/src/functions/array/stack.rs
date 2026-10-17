//! `VSTACK(array1, [array2], ...)` and `HSTACK(array1, [array2], ...)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::{cell_count, Grid};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn stack(args: &[Expr], ctx: &CallContext, vertical: bool) -> Result<Value, ErrorKind> {
    let grids = args
        .iter()
        .map(|a| Grid::of(ctx, a))
        .collect::<Result<Vec<_>, _>>()?;
    let grids: Vec<Grid> = if vertical {
        grids
    } else {
        grids.iter().map(Grid::transpose).collect()
    };
    let width = grids.iter().map(|g| g.cols).max().unwrap_or(0);
    let height: usize = grids.iter().map(|g| g.rows).sum();
    cell_count(height, width)?;
    let mut data = Vec::with_capacity(height * width);
    for g in &grids {
        for r in 0..g.rows {
            for c in 0..width {
                data.push(if c < g.cols {
                    g.get(r, c).clone()
                } else {
                    Value::Error(ErrorKind::NA)
                });
            }
        }
    }
    let out = Grid {
        rows: height,
        cols: width,
        data,
    };
    if vertical {
        out.into_value()
    } else {
        out.transpose().into_value()
    }
}

function!(
    /// The arrays one below the other; narrower ones are padded with
    /// `#N/A`. Stored as `_xlfn.VSTACK`.
    VStack, "VSTACK", Arity::range(1, 254), |args, ctx| {
    stack(args, ctx, true)
});

function!(
    /// The arrays side by side; shorter ones are padded with `#N/A`.
    /// Stored as `_xlfn.HSTACK`.
    HStack, "HSTACK", Arity::range(1, 254), |args, ctx| {
    stack(args, ctx, false)
});
