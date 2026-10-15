//! `SLN(cost, salvage, life)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Straight-line depreciation per period; life 0 is `#DIV/0!`.
    Sln, "SLN", Arity::exact(3), |args, ctx| {
    let cost = ctx.number(&args[0])?;
    let salvage = ctx.number(&args[1])?;
    let life = ctx.number(&args[2])?;
    if life == 0.0 {
        return Err(ErrorKind::Div0);
    }
    Ok(Value::number((cost - salvage) / life))
});
