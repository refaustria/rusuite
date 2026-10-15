//! `EDATE(start_date, months)` and `EOMONTH(start_date, months)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::calendar::day_serial;
use crate::functions::datetime::serial::{days_in_month, serial_to_ymd, ymd_to_serial};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// `(year, month)` of `start` shifted by `months`, plus the start day.
fn shifted(args: &[Expr], ctx: &CallContext) -> Result<(i32, i32, i32), ErrorKind> {
    let start = day_serial(ctx, &args[0])?;
    let months = ctx.number(&args[1])?.trunc();
    if months.abs() > 1.0e6 {
        return Err(ErrorKind::Num);
    }
    let (y, m, d) = serial_to_ymd(start as f64).ok_or(ErrorKind::Num)?;
    let total = i64::from(y) * 12 + i64::from(m) - 1 + months as i64;
    Ok((
        total.div_euclid(12) as i32,
        total.rem_euclid(12) as i32 + 1,
        d as i32,
    ))
}

function!(
    /// The date `months` before/after `start_date`, the day clamped to the
    /// target month's length; out of range is `#NUM!`.
    EDate, "EDATE", Arity::exact(2), |args, ctx| {
    let (y, m, d) = shifted(args, ctx)?;
    let d = d.min(days_in_month(y, m));
    ymd_to_serial(y, m, d).map(Value::Number).ok_or(ErrorKind::Num)
});

function!(
    /// Last day of the month `months` before/after `start_date`.
    EoMonth, "EOMONTH", Arity::exact(2), |args, ctx| {
    let (y, m, _) = shifted(args, ctx)?;
    ymd_to_serial(y, m + 1, 0).map(Value::Number).ok_or(ErrorKind::Num)
});
