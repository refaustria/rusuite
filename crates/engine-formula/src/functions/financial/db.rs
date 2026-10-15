//! `DB(cost, salvage, life, period, [month])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Fixed-declining-balance depreciation: the rate is
    /// `1 - (salvage/cost)^(1/life)` rounded to 3 decimals; the first
    /// period is prorated by `month` (default 12) and, when `month < 12`,
    /// a final partial period `life + 1` exists. Invalid inputs are `#NUM!`.
    Db, "DB", Arity::range(4, 5), |args, ctx| {
    let cost = ctx.number(&args[0])?;
    let salvage = ctx.number(&args[1])?;
    let life = ctx.number(&args[2])?;
    let period = ctx.number(&args[3])?.trunc();
    let month = opt_num(ctx, args, 4, 12.0)?.trunc();
    if cost < 0.0 || salvage < 0.0 || life <= 0.0 || period < 1.0 || !(1.0..=12.0).contains(&month) {
        return Err(ErrorKind::Num);
    }
    let last = life.trunc() + if month < 12.0 { 1.0 } else { 0.0 };
    if period > last || cost == 0.0 {
        return Err(ErrorKind::Num);
    }
    let rate = ((1.0 - (salvage / cost).powf(1.0 / life)) * 1000.0 + 0.5).floor() / 1000.0;
    let mut total = 0.0;
    let mut dep = cost * rate * month / 12.0;
    let mut p = 1.0;
    while p < period {
        total += dep;
        p += 1.0;
        dep = if p > life { (cost - total) * rate * (12.0 - month) / 12.0 } else { (cost - total) * rate };
    }
    Ok(Value::number(dep))
});
