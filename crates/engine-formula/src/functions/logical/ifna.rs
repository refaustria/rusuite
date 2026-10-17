//! `IFNA(value, value_if_na)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// The fallback only for `#N/A`; other errors pass through. The
    /// fallback is evaluated lazily.
    IfNa, "IFNA", Arity::exact(2), |args, ctx| {
    match ctx.result_value(&args[0]) {
        Value::Error(ErrorKind::NA) => Ok(ctx.result_value(&args[1])),
        v => Ok(v),
    }
});
