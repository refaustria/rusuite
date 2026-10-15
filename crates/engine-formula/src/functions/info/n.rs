//! `N(value)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Numbers as is, TRUE/FALSE as 1/0, text as 0, errors propagate.
    N, "N", Arity::exact(1), |args, ctx| {
    Ok(match ctx.scalar(&args[0]) {
        Value::Number(n) => Value::Number(n),
        Value::Bool(b) => Value::Number(f64::from(u8::from(b))),
        Value::Error(e) => Value::Error(e),
        _ => Value::Number(0.0),
    })
});
