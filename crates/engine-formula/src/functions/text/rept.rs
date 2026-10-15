//! `REPT(text, number_times)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Repeats text; a negative count or a result above 32767 characters is `#VALUE!`.
    Rept, "REPT", Arity::exact(2), |args, ctx| {
    let s = ctx.text(&args[0])?;
    let n = ctx.number(&args[1])?.trunc();
    if n < 0.0 || n * s.chars().count() as f64 > 32767.0 {
        return Err(ErrorKind::Value);
    }
    Ok(Value::Text(s.repeat(n as usize)))
});
