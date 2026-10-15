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

/// Splits a serial into whole days and seconds within the day, rounding to
/// the nearest second and carrying into the day (as Excel's display does).
/// `None` for negative, non-finite or out-of-range input.
fn split_serial(serial: f64) -> Option<(i64, u32)> {
    if !serial.is_finite() || serial < 0.0 {
        return None;
    }
    let mut day = serial.floor() as i64;
    let mut secs = ((serial - serial.floor()) * 86_400.0).round() as i64;
    if secs >= 86_400 {
        day += 1;
        secs -= 86_400;
    }
    (day <= 2_958_465).then_some((day, secs as u32))
}

/// Whole day number and time of day of a serial after rounding to the
/// nearest second: `(day, h, m, s)`. `None` as for [`serial_to_ymd_hms`].
pub(crate) fn serial_day_hms(serial: f64) -> Option<(i64, u32, u32, u32)> {
    let (day, secs) = split_serial(serial)?;
    Some((day, secs / 3600, secs / 60 % 60, secs % 60))
}

/// Year, month, day, hour, minute, second of a serial, rounded to the
/// nearest second (a carry may advance the date). Same day conventions as
/// [`serial_to_ymd`]. `None` for negative, non-finite or out-of-range input.
pub fn serial_to_ymd_hms(serial: f64) -> Option<(i32, u32, u32, u32, u32, u32)> {
    let (day, h, m, s) = serial_day_hms(serial)?;
    let (y, mo, d) = serial_to_ymd(day as f64)?;
    Some((y, mo, d, h, m, s))
}

fn digits(s: &str, min: usize, max: usize) -> Option<u32> {
    if s.len() < min || s.len() > max || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Parses a text time `hh:mm[:ss[.fff]]` (24h, 1-2 digit fields) into a
/// fraction of a day.
pub fn parse_time_text(s: &str) -> Option<f64> {
    let mut it = s.trim_matches(|c: char| c.is_ascii_whitespace()).split(':');
    let h = digits(it.next()?, 1, 2)?;
    let m = digits(it.next()?, 1, 2)?;
    let sec = match it.next() {
        Some(x) => {
            let (whole, frac) = x.split_once('.').unwrap_or((x, ""));
            let w = digits(whole, 1, 2)?;
            let f = if frac.is_empty() {
                0.0
            } else {
                format!("0.{frac}")
                    .parse::<f64>()
                    .ok()
                    .filter(|_| frac.bytes().all(|b| b.is_ascii_digit()))?
            };
            f64::from(w) + f
        }
        None => 0.0,
    };
    if it.next().is_some() || h > 23 || m > 59 || sec >= 60.0 {
        return None;
    }
    Some((f64::from(h) * 3600.0 + f64::from(m) * 60.0 + sec) / 86_400.0)
}

/// Parses a text date, date-time or time into a serial. Accepted grammar
/// (surrounding ASCII whitespace ignored):
///
/// ```text
/// text     = date [ (" " | "T") time ] | time
/// date     = yyyy "-" m[m] "-" d[d]      (ISO)
///          | yyyy "/" m[m] "/" d[d]
///          | m[m] "/" d[d] "/" yyyy      (US)
/// time     = h[h] ":" m[m] [ ":" s[s] [ "." digits ] ]   (24h)
/// ```
///
/// The year has exactly four digits and lies in 1900..=9999; a date must
/// exist, except that 1900-02-29 is accepted (serial 60). A time alone
/// yields a fraction of a day; `24:00` and minutes/seconds of 60 or more
/// are rejected. Two-digit years and mixed separators are rejected.
pub fn parse_date_text(s: &str) -> Option<f64> {
    let s = s.trim_matches(|c: char| c.is_ascii_whitespace());
    if let Some((d, t)) = s.split_once([' ', 'T']) {
        return Some(parse_date_part(d.trim())? + parse_time_text(t)?);
    }
    parse_date_part(s).or_else(|| parse_time_text(s))
}

fn parse_date_part(date: &str) -> Option<f64> {
    let sep = if date.contains('-') { '-' } else { '/' };
    let parts: Vec<&str> = date.split(sep).collect();
    let [a, b, c] = parts[..] else { return None };
    let (y, m, d) = if sep == '-' || a.len() == 4 {
        (a, b, c)
    } else {
        (c, a, b)
    };
    let (y, m, d) = (digits(y, 4, 4)?, digits(m, 1, 2)?, digits(d, 1, 2)?);
    if !(1900..=9999).contains(&y) || !(1..=12).contains(&m) || d < 1 {
        return None;
    }
    // Excel believes 1900 was a leap year.
    if d > days_in_month(y as i32, m as i32) as u32 && !(y == 1900 && m == 2 && d == 29) {
        return None;
    }
    ymd_to_serial(y as i32, m as i32, d as i32)
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

    #[test]
    fn parses_value_forms() {
        assert_eq!(parse_date_text("1900-02-29"), Some(60.0));
        assert_eq!(parse_date_text("2023-02-29"), None);
        assert_eq!(parse_date_text("1900-01-01"), Some(1.0));
        assert_eq!(parse_date_text("1899-12-31"), None);
        assert_eq!(parse_date_text("2024-01-15T18:00"), Some(45306.75));
        assert_eq!(parse_date_text("12:00"), Some(0.5));
        assert_eq!(parse_date_text("06:00:00"), Some(0.25));
        assert_eq!(parse_date_text("24:00"), None);
        assert_eq!(parse_date_text("12:00:30.5"), Some(43_230.5 / 86_400.0));
        assert_eq!(parse_time_text("1:5"), Some(3900.0 / 86_400.0));
        assert_eq!(parse_time_text("12:60"), None);
        assert_eq!(parse_date_text("2024-01/15"), None);
    }

    #[test]
    fn serial_to_hms() {
        assert_eq!(serial_to_ymd_hms(45306.75), Some((2024, 1, 15, 18, 0, 0)));
        // Rounds to the nearest second and carries into the next day.
        assert_eq!(
            serial_to_ymd_hms(45306.0 + 86_399.6 / 86_400.0),
            Some((2024, 1, 16, 0, 0, 0))
        );
        assert_eq!(serial_to_ymd_hms(60.5), Some((1900, 2, 29, 12, 0, 0)));
        assert_eq!(serial_to_ymd_hms(-1.0), None);
        assert_eq!(serial_to_ymd_hms(2_958_466.0), None);
        assert_eq!(serial_day_hms(45306.25), Some((45306, 6, 0, 0)));
    }
}
