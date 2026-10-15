//! `ISLOGICAL(value)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// TRUE for TRUE/FALSE values; text `"TRUE"` is not logical.
    IsLogical, "ISLOGICAL", Arity::exact(1), |args, ctx| {
    Ok(Value::Bool(matches!(ctx.scalar(&args[0]), Value::Bool(_))))
});
