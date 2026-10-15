//! `TRUNC(number, [digits])`.

use crate::functions::helpers::opt_num;
use crate::functions::math::{round_digits, Rounding};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Truncates toward zero at `digits` decimals (default 0; negative
    /// digits truncate left of the decimal point).
    Trunc, "TRUNC", Arity::range(1, 2), |args, ctx| {
    let x = ctx.number(&args[0])?;
    let d = opt_num(ctx, args, 1, 0.0)?;
    Ok(Value::number(round_digits(x, d, Rounding::Down)))
});
