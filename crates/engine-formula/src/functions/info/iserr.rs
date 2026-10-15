//! `ISERR(value)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// TRUE for any error except `#N/A`.
    IsErr, "ISERR", Arity::exact(1), |args, ctx| {
    Ok(Value::Bool(matches!(ctx.scalar(&args[0]), Value::Error(e) if e != ErrorKind::NA)))
});
