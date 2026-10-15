//! `SYD(cost, salvage, life, per)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Sum-of-years'-digits depreciation of period `per`; `life <= 0`,
    /// `per <= 0` or `per > life` is `#NUM!`.
    Syd, "SYD", Arity::exact(4), |args, ctx| {
    let cost = ctx.number(&args[0])?;
    let salvage = ctx.number(&args[1])?;
    let life = ctx.number(&args[2])?;
    let per = ctx.number(&args[3])?;
    if life <= 0.0 || per <= 0.0 || per > life {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number((cost - salvage) * (life - per + 1.0) * 2.0 / (life * (life + 1.0))))
});
