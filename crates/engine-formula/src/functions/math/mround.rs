//! `MROUND(number, multiple)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::{round_15, Value};

function!(
    /// Rounds to the nearest multiple (halves away from zero). Multiple 0
    /// gives 0; differing signs give `#NUM!`.
    Mround, "MROUND", Arity::exact(2), |args, ctx| {
    let x = ctx.number(&args[0])?;
    let m = ctx.number(&args[1])?;
    if m == 0.0 {
        return Ok(Value::Number(0.0));
    }
    if x * m < 0.0 {
        return Err(ErrorKind::Num);
    }
    let q = round_15(x / m);
    let r = q.abs().floor() + if q.abs().fract() >= 0.5 { 1.0 } else { 0.0 };
    Ok(Value::number(round_15(r * q.signum() * m) + 0.0))
});
