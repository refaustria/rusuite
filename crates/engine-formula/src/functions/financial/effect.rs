//! `EFFECT(nominal_rate, npery)` and `NOMINAL(effect_rate, npery)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Effective annual rate for `npery` compounding periods per year.
    Effect, "EFFECT", Arity::exact(2), |args, ctx| {
    let nominal = ctx.number(&args[0])?;
    let k = ctx.number(&args[1])?.trunc();
    if nominal <= 0.0 || k < 1.0 {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number((1.0 + nominal / k).powf(k) - 1.0))
});
function!(
    /// Nominal annual rate for an effective rate and `npery` periods per year.
    Nominal, "NOMINAL", Arity::exact(2), |args, ctx| {
    let effect = ctx.number(&args[0])?;
    let k = ctx.number(&args[1])?.trunc();
    if effect <= 0.0 || k < 1.0 {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number(k * ((1.0 + effect).powf(1.0 / k) - 1.0)))
});
