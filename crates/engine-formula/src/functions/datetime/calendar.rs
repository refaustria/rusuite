//! Calendar helpers shared by the date functions.

use std::collections::HashSet;

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::{parse_date_text, MAX_SERIAL};
use crate::functions::helpers::present;
use crate::functions::CallContext;
use crate::value::{parse_number_text, Value};

/// Day of week of a serial, 0 = Sunday .. 6 = Saturday (serial 1 is a
/// Sunday, as in Excel).
pub(crate) fn weekday0(serial: i64) -> usize {
    (serial - 1).rem_euclid(7) as usize
}

pub(crate) fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// The whole-day serial of a date argument, `#NUM!` outside `0..=MAX_SERIAL`.
pub(crate) fn day_serial(ctx: &CallContext, e: &Expr) -> Result<i64, ErrorKind> {
    let s = super::serial::date_arg(ctx, e)?.floor();
    if (0.0..=MAX_SERIAL).contains(&s) {
        Ok(s as i64)
    } else {
        Err(ErrorKind::Num)
    }
}

/// Weekend days as a mask indexed by [`weekday0`].
pub(crate) type Weekend = [bool; 7];

/// Saturday and Sunday.
pub(crate) const SAT_SUN: Weekend = [true, false, false, false, false, false, true];

/// Parses the `weekend` argument of the `.INTL` functions: a code
/// (1..=7, 11..=17; `#NUM!` otherwise) or a 7-character 0/1 string
/// starting on Monday (`#VALUE!` if malformed or all days are weekend).
pub(crate) fn weekend_arg(ctx: &CallContext, e: &Expr) -> Result<Weekend, ErrorKind> {
    let mut w = [false; 7];
    match ctx.scalar(e) {
        Value::Text(s) if s.len() == 7 && s.bytes().all(|c| matches!(c, b'0' | b'1')) => {
            for (i, c) in s.bytes().enumerate() {
                w[(i + 1) % 7] = c == b'1';
            }
            if w.iter().all(|&x| x) {
                return Err(ErrorKind::Value);
            }
        }
        Value::Text(s) if parse_number_text(&s).is_none() => {
            let b = s.as_bytes();
            if b.len() != 7 || !b.iter().all(|c| matches!(c, b'0' | b'1')) {
                return Err(ErrorKind::Value);
            }
            for (i, c) in b.iter().enumerate() {
                w[(i + 1) % 7] = *c == b'1';
            }
            if w.iter().all(|&x| x) {
                return Err(ErrorKind::Value);
            }
        }
        v => {
            let code = crate::value::to_number(&v)?.trunc();
            match code as i64 {
                1..=7 => {
                    // 1 = Sat+Sun, 2 = Sun+Mon, ... 7 = Fri+Sat.
                    let first = (code as usize + 5) % 7;
                    w[first] = true;
                    w[(first + 1) % 7] = true;
                }
                11..=17 => w[code as usize - 11] = true,
                _ => return Err(ErrorKind::Num),
            }
        }
    }
    Ok(w)
}

/// The optional holidays argument at `args[i]`: the whole-day serials of
/// its numbers (numeric dates and date text); errors propagate.
pub(crate) fn holidays_arg(
    ctx: &CallContext,
    args: &[Expr],
    i: usize,
) -> Result<HashSet<i64>, ErrorKind> {
    let mut out = HashSet::new();
    if !present(ctx, args, i) {
        return Ok(out);
    }
    for v in ctx.range(&args[i])?.values() {
        match v {
            Value::Number(n) => {
                out.insert(n.floor() as i64);
            }
            Value::Text(t) => {
                if let Some(n) = parse_number_text(&t).or_else(|| parse_date_text(&t)) {
                    out.insert(n.floor() as i64);
                }
            }
            Value::Error(k) => return Err(k),
            _ => {}
        }
    }
    Ok(out)
}

/// Number of working days in `a..=b` (`a <= b`).
pub(crate) fn count_workdays(a: i64, b: i64, weekend: &Weekend, hol: &HashSet<i64>) -> i64 {
    (a..=b)
        .filter(|&d| !weekend[weekday0(d)] && !hol.contains(&d))
        .count() as i64
}
