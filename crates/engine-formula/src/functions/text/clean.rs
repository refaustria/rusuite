//! `CLEAN(text)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Removes the control characters 0..=31.
    Clean, "CLEAN", Arity::exact(1), |args, ctx| {
    Ok(Value::Text(ctx.text(&args[0])?.chars().filter(|c| (*c as u32) >= 32).collect()))
});
