//! `TIMEVALUE(time_text)`.

use crate::ast::ErrorKind;
use crate::functions::datetime::serial::parse_date_text;
use crate::functions::Arity;
use crate::value::Value;

/// `h[:m[:s]] AM|PM` as a fraction of a day.
fn parse_12h(s: &str) -> Option<f64> {
    let t = s.trim();
    let upper = t.to_ascii_uppercase();
    let (body, pm) = if let Some(b) = upper.strip_suffix("PM") {
        (b, true)
    } else {
        (upper.strip_suffix("AM")?, false)
    };
    let mut it = body.trim().split(':');
    let num = |x: Option<&str>| -> Option<f64> {
        match x {
            None => Some(0.0),
            Some(x) if !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()) => x.parse().ok(),
            _ => None,
        }
    };
    let h = num(it.next())?;
    let m = num(it.next())?;
    let sec = num(it.next())?;
    if it.next().is_some() || !(1.0..=12.0).contains(&h) || m > 59.0 || sec > 59.0 {
        return None;
    }
    let h24 = (h % 12.0) + if pm { 12.0 } else { 0.0 };
    Some((h24 * 3600.0 + m * 60.0 + sec) / 86_400.0)
}

function!(
    /// Fraction of a day of time text (`hh:mm[:ss]`, optional `AM`/`PM`,
    /// or a date-time text whose date part is dropped); unparsable text is `#VALUE!`.
    TimeValue, "TIMEVALUE", Arity::exact(1), |args, ctx| {
    match ctx.scalar(&args[0]) {
        Value::Text(t) => {
            let v = parse_12h(&t).or_else(|| parse_date_text(&t).map(|n| n - n.floor()));
            v.map(Value::Number).ok_or(ErrorKind::Value)
        }
        Value::Error(e) => Err(e),
        _ => Err(ErrorKind::Value),
    }
});
