//! `TIME(hour, minute, second)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Fraction of a day for the time; arguments are truncated, a negative
    /// one or an hour above 32767 is `#NUM!`; the result wraps at 24 hours.
    Time, "TIME", Arity::exact(3), |args, ctx| {
    let h = ctx.number(&args[0])?.trunc();
    let m = ctx.number(&args[1])?.trunc();
    let s = ctx.number(&args[2])?.trunc();
    if h < 0.0 || m < 0.0 || s < 0.0 || h > 32767.0 || m > 32767.0 * 60.0 || s > 32767.0 * 3600.0 {
        return Err(ErrorKind::Num);
    }
    let total = (h * 3600.0 + m * 60.0 + s) % 86_400.0;
    Ok(Value::Number(total / 86_400.0))
});
