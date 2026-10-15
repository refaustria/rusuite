//! `MIRR(values, finance_rate, reinvest_rate)`.

use crate::ast::ErrorKind;
use crate::functions::financial::npv;
use crate::functions::helpers::range_numbers;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Modified internal rate of return; needs a positive and a negative
    /// value (else `#DIV/0!`).
    Mirr, "MIRR", Arity::exact(3), |args, ctx| {
    let v = range_numbers(ctx, &args[0])?;
    let finance = ctx.number(&args[1])?;
    let reinvest = ctx.number(&args[2])?;
    let n = v.len() as f64;
    if !v.iter().any(|&x| x > 0.0) || !v.iter().any(|&x| x < 0.0) {
        return Err(ErrorKind::Div0);
    }
    let pos: Vec<f64> = v.iter().map(|&x| x.max(0.0)).collect();
    let neg: Vec<f64> = v.iter().map(|&x| x.min(0.0)).collect();
    let num = -npv(reinvest, &pos) * (1.0 + reinvest).powf(n);
    let den = npv(finance, &neg) * (1.0 + finance);
    Ok(Value::number((num / den).powf(1.0 / (n - 1.0)) - 1.0))
});
