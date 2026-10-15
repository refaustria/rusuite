//! `PPMT(rate, per, nper, pv, [fv], [type])`.

use crate::functions::financial::ipmt::split;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Principal part of the payment of period `per` (1..=nper, else `#NUM!`).
    PPmt, "PPMT", Arity::range(4, 6), |args, ctx| {
    let (interest, payment) = split(args, ctx)?;
    Ok(Value::number(payment - interest))
});
