//! `DATEDIF(start_date, end_date, unit)`.

use crate::ast::ErrorKind;
use crate::functions::datetime::calendar::day_serial;
use crate::functions::datetime::serial::{days_in_month, serial_to_ymd, ymd_to_serial};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Difference between two dates in whole `Y`ears, `M`onths or `D`ays,
    /// or `MD` (days ignoring months and years), `YM` (months ignoring
    /// years), `YD` (days ignoring years). `start > end` and unknown units
    /// are `#NUM!`.
    DateDif, "DATEDIF", Arity::exact(3), |args, ctx| {
    let a = day_serial(ctx, &args[0])?;
    let b = day_serial(ctx, &args[1])?;
    let unit = ctx.text(&args[2])?.to_ascii_uppercase();
    if a > b {
        return Err(ErrorKind::Num);
    }
    let (y1, m1, d1) = serial_to_ymd(a as f64).ok_or(ErrorKind::Num)?;
    let (y2, m2, d2) = serial_to_ymd(b as f64).ok_or(ErrorKind::Num)?;
    let (y1, m1, d1, y2, m2, d2) = (y1, m1 as i32, d1 as i32, y2, m2 as i32, d2 as i32);
    let months = (y2 - y1) * 12 + (m2 - m1) - i32::from(d2 < d1);
    let n = match unit.as_str() {
        "Y" => months.div_euclid(12),
        "M" => months,
        "D" => (b - a) as i32,
        "YM" => months.rem_euclid(12),
        "MD" => {
            if d2 >= d1 {
                d2 - d1
            } else {
                let (py, pm) = if m2 == 1 { (y2 - 1, 12) } else { (y2, m2 - 1) };
                days_in_month(py, pm) - d1 + d2
            }
        }
        "YD" => {
            let year = if (m2, d2) >= (m1, d1) { y2 } else { y2 - 1 };
            let anniv = ymd_to_serial(year, m1, d1).ok_or(ErrorKind::Num)?;
            (b as f64 - anniv) as i32
        }
        _ => return Err(ErrorKind::Num),
    };
    Ok(Value::Number(f64::from(n)))
});
