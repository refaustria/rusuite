//! `RANDBETWEEN(bottom, top)`.

use crate::ast::ErrorKind;
use crate::functions::math::rand::random01;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// A random integer between `ceil(bottom)` and `floor(top)` inclusive;
    /// `#NUM!` if the range is empty; volatile.
    RandBetween, "RANDBETWEEN", Arity::exact(2), volatile, |args, ctx| {
    let lo = ctx.number(&args[0])?.ceil();
    let hi = ctx.number(&args[1])?.floor();
    if lo > hi {
        return Err(ErrorKind::Num);
    }
    let r = random01(ctx);
    Ok(Value::number((lo + (r * (hi - lo + 1.0)).floor()).min(hi)))
});
