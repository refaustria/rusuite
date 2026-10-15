//! `DDB(cost, salvage, life, period, [factor])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Declining-balance depreciation (factor default 2) that never takes
    /// the book value below `salvage`. Invalid inputs are `#NUM!`.
    Ddb, "DDB", Arity::range(4, 5), |args, ctx| {
    let cost = ctx.number(&args[0])?;
    let salvage = ctx.number(&args[1])?;
    let life = ctx.number(&args[2])?;
    let period = ctx.number(&args[3])?;
    let factor = opt_num(ctx, args, 4, 2.0)?;
    if cost < 0.0 || salvage < 0.0 || life <= 0.0 || period <= 0.0 || factor <= 0.0 || period > life {
        return Err(ErrorKind::Num);
    }
    let mut rate = factor / life;
    let old = if rate >= 1.0 {
        rate = 1.0;
        if period <= 1.0 { cost } else { 0.0 }
    } else {
        cost * (1.0 - rate).powf(period - 1.0)
    };
    let new = old * (1.0 - rate);
    let dep = if new < salvage { old - salvage } else { old - new };
    Ok(Value::number(dep.max(0.0)))
});
