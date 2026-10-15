//! `WEEKNUM(serial_number, [return_type])` and `ISOWEEKNUM(date)`.

use crate::ast::ErrorKind;
use crate::functions::datetime::calendar::{day_serial, weekday0};
use crate::functions::datetime::serial::{serial_to_ymd, ymd_to_serial};
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

/// ISO 8601 week number of a serial.
fn iso_week(s: i64) -> Result<i64, ErrorKind> {
    // Monday = 1 .. Sunday = 7.
    let wd = (weekday0(s) as i64 + 6) % 7 + 1;
    let thursday = s + 4 - wd;
    let (y, _, _) = serial_to_ymd(thursday as f64).ok_or(ErrorKind::Num)?;
    let jan1 = ymd_to_serial(y, 1, 1).ok_or(ErrorKind::Num)? as i64;
    Ok((thursday - jan1).div_euclid(7) + 1)
}

function!(
    /// Week of the year; week 1 contains January 1 (system 1) and weeks
    /// start on Sunday (types 1, 17), Monday (2, 11), Tuesday (12) ...
    /// Saturday (16); type 21 is the ISO week. Other types are `#NUM!`.
    WeekNum, "WEEKNUM", Arity::range(1, 2), |args, ctx| {
    let s = day_serial(ctx, &args[0])?;
    let kind = opt_num(ctx, args, 1, 1.0)?.trunc() as i64;
    let start = match kind {
        1 | 17 => 0,
        2 => 1,
        11..=16 => (kind - 10) as usize % 7,
        21 => return Ok(Value::Number(iso_week(s)? as f64)),
        _ => return Err(ErrorKind::Num),
    };
    let (y, _, _) = serial_to_ymd(s as f64).ok_or(ErrorKind::Num)?;
    let jan1 = ymd_to_serial(y, 1, 1).ok_or(ErrorKind::Num)? as i64;
    let offset = (weekday0(jan1) as i64 - start as i64).rem_euclid(7);
    Ok(Value::Number(((s - jan1 + offset).div_euclid(7) + 1) as f64))
});

function!(
    /// ISO 8601 week number (weeks start on Monday, week 1 has the first Thursday).
    IsoWeekNum, "ISOWEEKNUM", Arity::exact(1), |args, ctx| {
    Ok(Value::Number(iso_week(day_serial(ctx, &args[0])?)? as f64))
});
