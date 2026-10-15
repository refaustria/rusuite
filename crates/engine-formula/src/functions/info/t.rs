//! `T(value)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Text as is, everything else `""`; errors propagate.
    T, "T", Arity::exact(1), |args, ctx| {
    Ok(match ctx.scalar(&args[0]) {
        Value::Text(s) => Value::Text(s),
        Value::Error(e) => Value::Error(e),
        _ => Value::Text(String::new()),
    })
});
