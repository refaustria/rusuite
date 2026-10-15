//! `SEQUENCE(rows, [columns], [start], [step])`.

use crate::functions::array::{cell_count, size_arg, Grid};
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// A `rows × columns` array (default 1 column) of numbers counting
    /// from `start` (default 1) by `step` (default 1), row by row. Sizes
    /// are truncated; negative `#VALUE!`, zero `#CALC!`; more than
    /// 16777216 cells `#NUM!`.
    Sequence, "SEQUENCE", Arity::range(1, 4), |args, ctx| {
    let rows = size_arg(ctx.number(&args[0])?)?;
    let cols = size_arg(opt_num(ctx, args, 1, 1.0)?)?;
    let start = opt_num(ctx, args, 2, 1.0)?;
    let step = opt_num(ctx, args, 3, 1.0)?;
    let n = cell_count(rows, cols)?;
    let data = (0..n).map(|i| Value::number(start + step * i as f64)).collect();
    Grid { rows, cols, data }.into_value()
});
