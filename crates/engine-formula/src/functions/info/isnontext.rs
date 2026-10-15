//! `ISNONTEXT(value)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// TRUE for everything except text (blank cells and errors included).
    IsNonText, "ISNONTEXT", Arity::exact(1), |args, ctx| {
    Ok(Value::Bool(!matches!(ctx.scalar(&args[0]), Value::Text(_))))
});
