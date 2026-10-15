//! `NPV(rate, value1, ...)`.

use crate::ast::ErrorKind;
use crate::functions::financial::npv;
use crate::functions::math::numbers;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Net present value of end-of-period cash flows (numbers of the value
    /// arguments, SUM rules); rate -1 is `#DIV/0!`.
    Npv, "NPV", Arity::range(2, 255), |args, ctx| {
    let rate = ctx.number(&args[0])?;
    if rate == -1.0 {
        return Err(ErrorKind::Div0);
    }
    match numbers(&args[1..], ctx) {
        Ok(v) => Ok(Value::number(npv(rate, &v))),
        Err(e) => Ok(e),
    }
});
