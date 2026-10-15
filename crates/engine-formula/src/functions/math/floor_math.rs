//! `FLOOR.MATH(number, [significance], [mode])`.

use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::{round_15, Value};

function!(
    /// Rounds down (toward -infinity) to a multiple of `|significance|`
    /// (default 1). For negative numbers a non-zero `mode` rounds toward
    /// zero instead. Significance 0 gives 0.
    FloorMath, "FLOOR.MATH", Arity::range(1, 3), |args, ctx| {
    let x = ctx.number(&args[0])?;
    let sig = opt_num(ctx, args, 1, 1.0)?.abs();
    let mode = opt_num(ctx, args, 2, 0.0)?;
    if sig == 0.0 {
        return Ok(Value::Number(0.0));
    }
    let q = round_15(x / sig);
    let q = if x < 0.0 && mode != 0.0 { q.ceil() } else { q.floor() };
    Ok(Value::number(round_15(q * sig) + 0.0))
});
