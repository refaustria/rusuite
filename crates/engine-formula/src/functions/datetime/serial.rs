//! Conversion between civil dates and 1900-system serial numbers.
//!
//! Serial 1 = 1900-01-01, serial 60 = the non-existent 1900-02-29,
//! serial 61 = 1900-03-01; from there on the civil date is
//! `1899-12-30 + serial` days. Serial 0 is the fictitious 1900-01-00.

/// Largest valid serial (9999-12-31).
pub const MAX_SERIAL: f64 = 2_958_465.0;

/// Days from 1970-01-01 to the civil date (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil date from days since 1970-01-01.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// Days from 1970-01-01 to 1899-12-30.
fn epoch() -> i64 {
    days_from_civil(1899, 12, 30)
}

/// Serial of `y-m-d`. Month and day roll over in both directions (month 13
/// is January of the next year, day 0 the last day of the previous month);
/// the year is taken literally. `None` if the result is outside
/// `0..=2958465`.
pub fn ymd_to_serial(y: i32, m: i32, d: i32) -> Option<f64> {
    let months = i64::from(y) * 12 + i64::from(m) - 1;
    let (yy, mm) = (months.div_euclid(12), months.rem_euclid(12) + 1);
    let first = days_from_civil(yy, mm, 1) - epoch();
    // Civil days before 1900-03-01 are one lower in the Lotus system.
    let first = if first < 61 { first - 1 } else { first };
    let serial = first + i64::from(d) - 1;
    (0..=2_958_465).contains(&serial).then_some(serial as f64)
}

/// Year, month, day of a serial, truncated toward -infinity to whole days.
/// Serial 0 gives `(1900, 1, 0)` and 60 gives `(1900, 2, 29)`. `None` for
/// negative serials, serials above 2958465 and non-finite input.
pub fn serial_to_ymd(serial: f64) -> Option<(i32, u32, u32)> {
    if !serial.is_finite() {
        return None;
    }
    let s = serial.floor();
    if !(0.0..=MAX_SERIAL).contains(&s) {
        return None;
    }
    let s = s as i64;
    match s {
        0 => Some((1900, 1, 0)),
        60 => Some((1900, 2, 29)),
        _ => {
            let days = epoch() + if s < 60 { s + 1 } else { s };
            let (y, m, d) = civil_from_days(days);
            Some((y as i32, m as u32, d as u32))
        }
    }
}

/// Parses a text date (and optional time) into a serial: `yyyy-mm-dd`,
/// `yyyy/mm/dd` or US `m/d/yyyy`, each optionally followed by a space and
/// `hh:mm[:ss]` (24h). Surrounding whitespace is ignored.
pub fn parse_date_text(s: &str) -> Option<f64> {
    let s = s.trim();
    let (date, time) = match s.split_once(' ') {
        Some((d, t)) => (d, Some(t.trim())),
        None => (s, None),
    };
    let num = |p: &str, max_len: usize| -> Option<i32> {
        if p.is_empty() || p.len() > max_len || !p.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        p.parse().ok()
    };
    let (y, m, d) = if date.contains('-') || date.split('/').next().is_some_and(|p| p.len() == 4) {
        let parts: Vec<&str> = date.split(['-', '/']).collect();
        let [y, m, d] = parts[..] else { return None };
        if y.len() != 4 {
            return None;
        }
        (num(y, 4)?, num(m, 2)?, num(d, 2)?)
    } else {
        let parts: Vec<&str> = date.split('/').collect();
        let [m, d, y] = parts[..] else { return None };
        if y.len() != 4 {
            return None;
        }
        (num(y, 4)?, num(m, 2)?, num(d, 2)?)
    };
    if !(1..=12).contains(&m) || d < 1 || d > days_in_month(y, m) || y < 1900 {
        return None;
    }
    let day = ymd_to_serial(y, m, d)?;
    let frac = match time {
        None => 0.0,
        Some(t) => {
            let parts: Vec<&str> = t.split(':').collect();
            let (h, mi, sec) = match parts[..] {
                [h, mi] => (num(h, 2)?, num(mi, 2)?, 0),
                [h, mi, sec] => (num(h, 2)?, num(mi, 2)?, num(sec, 2)?),
                _ => return None,
            };
            if h > 23 || mi > 59 || sec > 59 {
                return None;
            }
            f64::from(h * 3600 + mi * 60 + sec) / 86_400.0
        }
    };
    Some(day + frac)
}

fn days_in_month(y: i32, m: i32) -> i32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Evaluates a date argument: numbers as is, empty as 0, bools `#VALUE!`,
/// text via `parse_number_text` then [`parse_date_text`], errors propagate.
pub(crate) fn date_arg(
    ctx: &crate::functions::CallContext,
    e: &crate::ast::Expr,
) -> Result<f64, crate::ast::ErrorKind> {
    use crate::ast::ErrorKind;
    use crate::value::{parse_number_text, Value};
    match ctx.scalar(e) {
        Value::Number(n) => Ok(n),
        Value::Empty => Ok(0.0),
        Value::Bool(_) => Err(ErrorKind::Value),
        Value::Error(k) => Err(k),
        Value::Text(t) => parse_number_text(&t)
            .or_else(|| parse_date_text(&t))
            .ok_or(ErrorKind::Value),
        Value::Array(_) => Err(ErrorKind::Value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_serials() {
        assert_eq!(ymd_to_serial(1900, 1, 1), Some(1.0));
        assert_eq!(ymd_to_serial(1900, 2, 28), Some(59.0));
        assert_eq!(ymd_to_serial(1900, 2, 29), Some(60.0));
        assert_eq!(ymd_to_serial(1900, 3, 1), Some(61.0));
        assert_eq!(ymd_to_serial(2024, 1, 15), Some(45306.0));
        assert_eq!(ymd_to_serial(9999, 12, 31), Some(2_958_465.0));
    }

    #[test]
    fn roll_over_and_range() {
        assert_eq!(ymd_to_serial(2024, 13, 1), Some(45658.0));
        assert_eq!(ymd_to_serial(2024, 1, 0), Some(45291.0));
        assert_eq!(ymd_to_serial(2024, 0, 1), Some(45261.0));
        assert_eq!(ymd_to_serial(1900, 1, 60), Some(60.0));
        assert_eq!(ymd_to_serial(1899, 12, 31), Some(0.0));
        assert_eq!(ymd_to_serial(1899, 12, 30), None);
        assert_eq!(ymd_to_serial(10_000, 1, 1), None);
    }

    #[test]
    fn serial_to_date() {
        assert_eq!(serial_to_ymd(0.0), Some((1900, 1, 0)));
        assert_eq!(serial_to_ymd(1.0), Some((1900, 1, 1)));
        assert_eq!(serial_to_ymd(59.0), Some((1900, 2, 28)));
        assert_eq!(serial_to_ymd(60.0), Some((1900, 2, 29)));
        assert_eq!(serial_to_ymd(61.0), Some((1900, 3, 1)));
        assert_eq!(serial_to_ymd(45306.99), Some((2024, 1, 15)));
        assert_eq!(serial_to_ymd(2_958_465.0), Some((9999, 12, 31)));
        assert_eq!(serial_to_ymd(0.5), Some((1900, 1, 0)));
    }

    #[test]
    fn serial_to_date_rejects() {
        assert_eq!(serial_to_ymd(-0.5), None);
        assert_eq!(serial_to_ymd(-1.0), None);
        assert_eq!(serial_to_ymd(2_958_466.0), None);
        assert_eq!(serial_to_ymd(f64::NAN), None);
    }

    #[test]
    fn round_trip() {
        for s in 1..=100_000 {
            if s == 60 {
                continue;
            }
            let (y, m, d) = serial_to_ymd(f64::from(s)).unwrap();
            assert_eq!(ymd_to_serial(y, m as i32, d as i32), Some(f64::from(s)));
        }
    }

    #[test]
    fn parses_text_dates() {
        assert_eq!(parse_date_text("2024-01-15"), Some(45306.0));
        assert_eq!(parse_date_text(" 2024/01/15 "), Some(45306.0));
        assert_eq!(parse_date_text("1/15/2024"), Some(45306.0));
        assert_eq!(parse_date_text("2024-01-15 18:00"), Some(45306.75));
        assert_eq!(parse_date_text("2024-01-15 06:00:00"), Some(45306.25));
        assert_eq!(parse_date_text("1/15/2024 12:00"), Some(45306.5));
        assert_eq!(parse_date_text("2024-12-31"), Some(45657.0));
    }

    #[test]
    fn rejects_bad_text_dates() {
        for s in [
            "",
            "13/45/2024",
            "2024-02-30",
            "2024-01-15 24:00",
            "2024-01-15 1",
            "abc",
            "2024-1-15x",
            "15.1.2024",
            "2024-01",
            "1/15/24",
        ] {
            assert_eq!(parse_date_text(s), None, "{s:?}");
        }
    }
}
