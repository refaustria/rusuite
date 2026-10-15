//! `ISREF(value)`.

use crate::eval::Operand;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// TRUE when the argument is a reference (including results of
    /// reference-returning functions such as `INDEX`, `OFFSET`).
    IsRef, "ISREF", Arity::exact(1), |args, ctx| {
    Ok(Value::Bool(matches!(ctx.eval_ref(&args[0]), Operand::Range(_))))
});
