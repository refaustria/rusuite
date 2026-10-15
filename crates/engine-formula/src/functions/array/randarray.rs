//! `RANDARRAY([rows], [columns], [min], [max], [integer])`.

use crate::ast::ErrorKind;
use crate::functions::array::{cell_count, size_arg, Grid};
use crate::functions::helpers::{opt_num, present};
use crate::functions::math::rand::random01;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// A `rows × columns` array (default 1 × 1) of random numbers in
    /// `[min, max)` (default 0 and 1), or whole numbers in `[min, max]`
    /// with `integer`. Volatile. `min > max` `#VALUE!`; with `integer`,
    /// fractional bounds `#VALUE!`; sizes as in `SEQUENCE`.
    RandArray, "RANDARRAY", Arity::range(0, 5), volatile, |args, ctx| {
    let rows = size_arg(opt_num(ctx, args, 0, 1.0)?)?;
    let cols = size_arg(opt_num(ctx, args, 1, 1.0)?)?;
    let min = opt_num(ctx, args, 2, 0.0)?;
    let max = opt_num(ctx, args, 3, 1.0)?;
    let integer = present(ctx, args, 4) && ctx.bool(&args[4])?;
    if min > max || (integer && (min.fract() != 0.0 || max.fract() != 0.0)) {
        return Err(ErrorKind::Value);
    }
    let n = cell_count(rows, cols)?;
    let data = (0..n)
        .map(|_| {
            let r = random01(ctx);
            Value::number(if integer {
                (min + (r * (max - min + 1.0)).floor()).min(max)
            } else {
                min + r * (max - min)
            })
        })
        .collect();
    Grid { rows, cols, data }.into_value()
});
