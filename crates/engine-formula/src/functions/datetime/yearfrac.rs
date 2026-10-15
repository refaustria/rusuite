//! `YEARFRAC(start_date, end_date, [basis])`.

use crate::ast::ErrorKind;
use crate::functions::datetime::calendar::{day_serial, is_leap};
use crate::functions::datetime::serial::{days_in_month, serial_to_ymd, ymd_to_serial};
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

/// True when the last day of February falls on `(y, m, d)`.
fn feb_end(y: i32, m: i32, d: i32) -> bool {
    m == 2 && d == days_in_month(y, 2)
}

function!(
    /// Fraction of a year between two dates. Basis 0 (default) US 30/360,
    /// 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360;
    /// other bases are `#NUM!`. The dates are swapped if needed.
    YearFrac, "YEARFRAC", Arity::range(2, 3), |args, ctx| {
    let mut a = day_serial(ctx, &args[0])?;
    let mut b = day_serial(ctx, &args[1])?;
    let basis = opt_num(ctx, args, 2, 0.0)?.trunc();
    if !(0.0..=4.0).contains(&basis) {
        return Err(ErrorKind::Num);
    }
    if a > b {
        std::mem::swap(&mut a, &mut b);
    }
    let days = (b - a) as f64;
    let (y1, m1, d1) = serial_to_ymd(a as f64).ok_or(ErrorKind::Num)?;
    let (y2, m2, d2) = serial_to_ymd(b as f64).ok_or(ErrorKind::Num)?;
    let (m1, d1, m2, d2) = (m1 as i32, d1 as i32, m2 as i32, d2 as i32);
    let r = match basis as i32 {
        0 => {
            let (mut d1, mut d2) = (d1, d2);
            if feb_end(y1, m1, d1) && feb_end(y2, m2, d2) {
                d2 = 30;
            }
            if feb_end(y1, m1, d1) {
                d1 = 30;
            }
            if d2 == 31 && d1 >= 30 {
                d2 = 30;
            }
            if d1 == 31 {
                d1 = 30;
            }
            f64::from(360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1)) / 360.0
        }
        4 => {
            let (d1, d2) = (d1.min(30), d2.min(30));
            f64::from(360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1)) / 360.0
        }
        2 => days / 360.0,
        3 => days / 365.0,
        _ => {
            let within_year =
                y1 == y2 || (y2 == y1 + 1 && (m1 > m2 || (m1 == m2 && d1 >= d2)));
            let denom = if within_year {
                let has_feb29 = (y1..=y2).any(|y| {
                    is_leap(y)
                        && ymd_to_serial(y, 2, 29).is_some_and(|f| (a as f64..=b as f64).contains(&f))
                });
                if has_feb29 { 366.0 } else { 365.0 }
            } else {
                let total: i32 = (y1..=y2).map(|y| if is_leap(y) { 366 } else { 365 }).sum();
                f64::from(total) / f64::from(y2 - y1 + 1)
            };
            days / denom
        }
    };
    Ok(Value::number(r))
});
