//! `NETWORKDAYS`, `NETWORKDAYS.INTL`, `WORKDAY`, `WORKDAY.INTL`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::calendar::{
    count_workdays, day_serial, holidays_arg, weekday0, weekend_arg, Weekend, SAT_SUN,
};
use crate::functions::datetime::serial::MAX_SERIAL;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn networkdays(
    args: &[Expr],
    ctx: &CallContext,
    weekend: Weekend,
    hol_idx: usize,
) -> Result<Value, ErrorKind> {
    let a = day_serial(ctx, &args[0])?;
    let b = day_serial(ctx, &args[1])?;
    let hol = holidays_arg(ctx, args, hol_idx)?;
    let (lo, hi, sign) = if a <= b { (a, b, 1) } else { (b, a, -1) };
    Ok(Value::Number(
        (sign * count_workdays(lo, hi, &weekend, &hol)) as f64,
    ))
}

fn workday(
    args: &[Expr],
    ctx: &CallContext,
    weekend: Weekend,
    hol_idx: usize,
) -> Result<Value, ErrorKind> {
    let start = day_serial(ctx, &args[0])?;
    let days = ctx.number(&args[1])?.trunc();
    let hol = holidays_arg(ctx, args, hol_idx)?;
    if days.abs() > 3.0e6 {
        return Err(ErrorKind::Num);
    }
    let step = if days < 0.0 { -1 } else { 1 };
    let mut left = days.abs() as i64;
    let mut d = start;
    while left > 0 {
        d += step;
        if !(0..=MAX_SERIAL as i64).contains(&d) {
            return Err(ErrorKind::Num);
        }
        if !weekend[weekday0(d)] && !hol.contains(&d) {
            left -= 1;
        }
    }
    Ok(Value::Number(d as f64))
}

function!(
    /// Working days (Monday to Friday, minus holidays) between two dates,
    /// both included; negative when `end < start`.
    NetworkDays, "NETWORKDAYS", Arity::range(2, 3), |args, ctx| {
    networkdays(args, ctx, SAT_SUN, 2)
});
function!(
    /// `NETWORKDAYS` with a `weekend` code or 7-character mask.
    NetworkDaysIntl, "NETWORKDAYS.INTL", Arity::range(2, 4), |args, ctx| {
    let w = if args.len() > 2 && !ctx.is_missing(&args[2]) { weekend_arg(ctx, &args[2])? } else { SAT_SUN };
    networkdays(args, ctx, w, 3)
});
function!(
    /// The date `days` working days after (or before) `start_date`.
    WorkDay, "WORKDAY", Arity::range(2, 3), |args, ctx| {
    workday(args, ctx, SAT_SUN, 2)
});
function!(
    /// `WORKDAY` with a `weekend` code or 7-character mask.
    WorkDayIntl, "WORKDAY.INTL", Arity::range(2, 4), |args, ctx| {
    let w = if args.len() > 2 && !ctx.is_missing(&args[2]) { weekend_arg(ctx, &args[2])? } else { SAT_SUN };
    workday(args, ctx, w, 3)
});
