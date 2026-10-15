//! `VALUE(text)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::{Arity, CallContext, Function};
use crate::value::{parse_number_text, Value};

/// Parses a number from text: everything the `+` operator accepts, plus
/// ISO dates (`yyyy-mm-dd`, optionally followed by a time) and times
/// (`hh:mm[:ss]`). Numbers pass through, `Empty` is 0, booleans and
/// non-numeric text are `#VALUE!`.
pub struct ValueFn;

impl Function for ValueFn {
    fn name(&self) -> &'static str {
        "VALUE"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.scalar(&args[0]) {
            Value::Number(n) => Value::Number(n),
            Value::Empty => Value::Number(0.0),
            Value::Bool(_) => Value::Error(ErrorKind::Value),
            Value::Error(e) => Value::Error(e),
            Value::Text(s) => Value::from_result(parse_value_text(&s).ok_or(ErrorKind::Value)),
            Value::Array(a) => Value::from_result(
                crate::value::to_text(&Value::Array(a))
                    .and_then(|s| parse_value_text(&s).ok_or(ErrorKind::Value)),
            ),
        }
    }
}

fn parse_value_text(s: &str) -> Option<f64> {
    if let Some(n) = parse_number_text(s) {
        return Some(n);
    }
    let s = s.trim_matches(|c: char| c.is_ascii_whitespace());
    // Date, optionally followed by a time.
    if let Some((d, t)) = s.split_once([' ', 'T']) {
        return Some(parse_date(d.trim())? + parse_time(t.trim())?);
    }
    parse_date(s).or_else(|| parse_time(s))
}

fn digits(s: &str, min: usize, max: usize) -> Option<u32> {
    if s.len() < min || s.len() > max || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// `yyyy-mm-dd` to an Excel serial (1900 date system, with the 1900 leap
/// year quirk). Duplicated from the datetime batch on purpose.
fn parse_date(s: &str) -> Option<f64> {
    let mut it = s.split('-');
    let y = digits(it.next()?, 4, 4)?;
    let m = digits(it.next()?, 1, 2)?;
    let d = digits(it.next()?, 1, 2)?;
    if it.next().is_some() || !(1900..=9999).contains(&y) || !(1..=12).contains(&m) || d < 1 {
        return None;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let dim = match m {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    // Excel believes 1900 was a leap year.
    if d > dim && !(y == 1900 && m == 2 && d == 29) {
        return None;
    }
    let days =
        days_from_civil(i64::from(y), i64::from(m), i64::from(d)) - days_from_civil(1899, 12, 30);
    let serial = if days < 61 { days - 1 } else { days };
    Some(serial as f64)
}

/// Days since 1970-01-01 (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// `hh:mm[:ss]` to a fraction of a day.
fn parse_time(s: &str) -> Option<f64> {
    let mut it = s.split(':');
    let h = digits(it.next()?, 1, 2)?;
    let m = digits(it.next()?, 1, 2)?;
    let sec = match it.next() {
        Some(x) => {
            // Optional fractional seconds.
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
    Some((f64::from(h) * 3600.0 + f64::from(m) * 60.0 + sec) / 86400.0)
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn numbers_and_percent() {
        assert_eq!(eval("=VALUE(\"123\")"), Value::Number(123.0));
        assert_eq!(eval("=VALUE(\" 12 \")"), Value::Number(12.0));
        assert_eq!(eval("=VALUE(\"1e3\")"), Value::Number(1000.0));
        assert_eq!(eval("=VALUE(\"50%\")"), Value::Number(0.5));
        assert_eq!(eval("=VALUE(\"1,234.5\")"), Value::Number(1234.5));
        assert_eq!(eval("=VALUE(5)"), Value::Number(5.0));
        assert_eq!(eval("=VALUE(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=VALUE(B2)"), Value::Number(5.0));
    }

    #[test]
    fn dates_and_times() {
        assert_eq!(eval("=VALUE(\"2024-01-15\")"), Value::Number(45306.0));
        assert_eq!(eval("=VALUE(\"1900-01-01\")"), Value::Number(1.0));
        assert_eq!(eval("=VALUE(\"1900-03-01\")"), Value::Number(61.0));
        assert_eq!(eval("=VALUE(\"2024-12-31\")"), Value::Number(45657.0));
        assert_eq!(eval("=VALUE(\"12:00\")"), Value::Number(0.5));
        assert_eq!(eval("=VALUE(\"06:00:00\")"), Value::Number(0.25));
        assert_eq!(
            eval("=VALUE(\"2024-01-15 18:00\")"),
            Value::Number(45306.75)
        );
        assert_eq!(
            eval("=VALUE(\"2023-02-29\")"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(eval("=VALUE(\"24:00\")"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn rejects() {
        assert_eq!(eval("=VALUE(\"abc\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(\"\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(TRUE)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(\"TRUE\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(B1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=VALUE(C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=VALUE(#N/A)"), Value::Error(ErrorKind::NA));
    }
}
