//! Recognition of typed cell entries (Excel's "number recognition", en-US):
//! what a constant typed into a cell means and which number format Excel
//! gives a General cell for it.
//!
//! | Typed | Value | Format for a General cell |
//! |---|---|---|
//! | `42`, `-3.5`, `.5`, `12.` | the number | none |
//! | `1,234` / `1,234.5` | 1234 / 1234.5 | `#,##0` / `#,##0.00` |
//! | `12%` / `12.5%` | 0.12 / 0.125 | `0%` / `0.00%` |
//! | `$1,234.50`, `-$5`, `$-5`, `($5)` | the amount | `"$"#,##0.00_);\("$"#,##0.00\)` (no decimals: `"$"#,##0_);\("$"#,##0\)`) |
//! | `€12`, `12 €`, `£3`, `¥100` | the amount | `#,##0 "€"`, `"£"#,##0`, … (`.00` with decimals) |
//! | `(5)` | −5 | none |
//! | `1e3` | 1000 | `0.00E+00` |
//! | `1 1/2`, `0 3/4`, `-2 1/16` | 1.5, 0.75, −2.0625 | `# ?/?` (`# ??/??` for 2-digit denominators) |
//! | `3/4/2024`, `3-4-24`, `2024-03-04`, `2024/3/4` | the date | `m/d/yyyy` |
//! | `4.3.2024`, `04.03.24` | the date (German order) | `dd.mm.yyyy` |
//! | `3/4`, `4-Mar`, `4 March`, `Mar 4` | that day of the current year | `d-mmm` |
//! | `4-Mar-2024`, `4 Mar 24`, `March 4, 2024` | the date | `d-mmm-yy` |
//! | `Mar 2024`, `Mar-24`, `3/2024` | the 1st of the month | `mmm-yy` |
//! | `13:45` / `13:45:30` | the time | `h:mm` / `h:mm:ss` |
//! | `1:30 PM` / `1:30:15 pm` / `1 PM` | the time | `h:mm AM/PM` / `h:mm:ss AM/PM` |
//! | `25:30` | 1.0625 | `[h]:mm:ss` |
//! | date + space + time | both | `m/d/yyyy h:mm` |
//!
//! Two-digit years below 30 are 20xx, others 19xx; dates must exist
//! (1900-02-29 included, Excel's leap-year bug). Surrounding whitespace is
//! not trimmed: the caller keeps such input as text.

use crate::functions::datetime::serial::{days_in_month, serial_to_ymd, ymd_to_serial};
use crate::value::parse_number_text;

/// A recognised entry: its value and the number format Excel applies to a
/// General cell (`None`: stays General).
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub value: f64,
    pub format: Option<&'static str>,
}

const PERCENT: &str = "0%";
const PERCENT_2: &str = "0.00%";
const THOUSANDS: &str = "#,##0";
const THOUSANDS_2: &str = "#,##0.00";
const SCIENTIFIC: &str = "0.00E+00";
const DOLLAR: &str = "\"$\"#,##0_);\\(\"$\"#,##0\\)";
const DOLLAR_2: &str = "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)";
const EURO: &str = "#,##0 \"€\"";
const EURO_2: &str = "#,##0.00 \"€\"";
const POUND: &str = "\"£\"#,##0";
const POUND_2: &str = "\"£\"#,##0.00";
const YEN: &str = "\"¥\"#,##0";
const YEN_2: &str = "\"¥\"#,##0.00";
const FRACTION: &str = "# ?/?";
const FRACTION_2: &str = "# ??/??";
const FRACTION_3: &str = "# ???/???";
/// Short date (Excel en-US's built-in 14 as displayed).
pub const SHORT_DATE: &str = "m/d/yyyy";
const DOTTED_DATE: &str = "dd.mm.yyyy";
const DAY_MONTH: &str = "d-mmm";
const DAY_MONTH_YEAR: &str = "d-mmm-yy";
const MONTH_YEAR: &str = "mmm-yy";
const TIME_HM: &str = "h:mm";
const TIME_HMS: &str = "h:mm:ss";
const TIME_HM_AMPM: &str = "h:mm AM/PM";
const TIME_HMS_AMPM: &str = "h:mm:ss AM/PM";
const TIME_ELAPSED: &str = "[h]:mm:ss";
const DATE_TIME: &str = "m/d/yyyy h:mm";

/// [`recognize_in_year`] with the current year of the default clock.
pub fn recognize(input: &str) -> Option<Entry> {
    let year = serial_to_ymd(crate::eval::default_now()).map_or(1900, |(y, _, _)| y);
    recognize_in_year(input, year.max(1900))
}

/// What `input` means as a typed constant (see the module docs); `None`
/// for text. `year` completes dates typed without one.
pub fn recognize_in_year(input: &str, year: i32) -> Option<Entry> {
    if input.is_empty() || input.trim() != input {
        return None;
    }
    number(input)
        .or_else(|| fraction(input))
        .or_else(|| date_time(input, year))
}

// --- numbers --------------------------------------------------------------

fn entry(value: f64, format: Option<&'static str>) -> Option<Entry> {
    value.is_finite().then_some(Entry { value, format })
}

/// Plain numbers, thousands separators, percentages, currencies and
/// parenthesised negatives.
fn number(s: &str) -> Option<Entry> {
    // Parentheses: a negative amount (Excel's accounting style).
    if let Some(inner) = s.strip_prefix('(').and_then(|r| r.strip_suffix(')')) {
        if inner.starts_with(['-', '+']) {
            return None;
        }
        let e = number(inner)?;
        return entry(-e.value, e.format);
    }
    let (neg, s) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let (percent, s) = match s.strip_suffix('%') {
        Some(r) => (true, r.strip_suffix(' ').unwrap_or(r)),
        None => (false, s),
    };
    let mut currency = None;
    let mut body = s;
    for sym in ['$', '€', '£', '¥'] {
        if let Some(r) = body.strip_prefix(sym) {
            currency = Some(sym);
            body = r;
            break;
        }
        if sym == '€' {
            if let Some(r) = body.strip_suffix(sym) {
                currency = Some(sym);
                body = r.strip_suffix(' ').unwrap_or(r);
                break;
            }
        }
    }
    // `$-5`: the sign after the currency symbol.
    let (neg, body) = match (currency, body.strip_prefix('-')) {
        (Some(_), Some(r)) if !neg => (true, r),
        _ => (neg, body),
    };
    if body.is_empty() || !body.as_bytes()[0].is_ascii_digit() && body.as_bytes()[0] != b'.' {
        return None;
    }
    if percent && currency.is_some() {
        return None;
    }
    let n = parse_number_text(body)?;
    let decimals = body.contains('.');
    let exponent = body.contains(['e', 'E']);
    let thousands = body.contains(',');
    let value = if neg { -n } else { n };
    let format = if percent {
        Some(if decimals { PERCENT_2 } else { PERCENT })
    } else if let Some(sym) = currency {
        Some(match (sym, decimals) {
            ('$', false) => DOLLAR,
            ('$', true) => DOLLAR_2,
            ('€', false) => EURO,
            ('€', true) => EURO_2,
            ('£', false) => POUND,
            ('£', true) => POUND_2,
            (_, false) => YEN,
            (_, true) => YEN_2,
        })
    } else if exponent {
        Some(SCIENTIFIC)
    } else if thousands {
        Some(if decimals { THOUSANDS_2 } else { THOUSANDS })
    } else {
        None
    };
    entry(if percent { value / 100.0 } else { value }, format)
}

fn digits(s: &str, min: usize, max: usize) -> Option<u32> {
    (s.len() >= min && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())
        .flatten()
}

/// `w n/d` with a whole part (a bare `n/d` is a date in Excel).
fn fraction(s: &str) -> Option<Entry> {
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s),
    };
    let (whole, frac) = s.split_once(' ')?;
    let (n, d) = frac.split_once('/')?;
    let (whole, n, d) = (digits(whole, 1, 15)?, digits(n, 1, 5)?, digits(d, 1, 5)?);
    if d == 0 {
        return None;
    }
    let v = f64::from(whole) + f64::from(n) / f64::from(d);
    let format = match d {
        0..=9 => FRACTION,
        10..=99 => FRACTION_2,
        _ => FRACTION_3,
    };
    entry(if neg { -v } else { v }, Some(format))
}

// --- dates and times ------------------------------------------------------

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// `Mar`, `march`, `Sept` → 1..=12.
fn month_name(s: &str) -> Option<u32> {
    if s.len() < 3 || !s.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let l = s.to_ascii_lowercase();
    if l == "sept" {
        return Some(9);
    }
    MONTHS
        .iter()
        .position(|m| *m == l || (l.len() == 3 && m.starts_with(&l)))
        .map(|i| i as u32 + 1)
}

/// A typed year: 4 digits (1900..=9999) or 2 digits (<30 → 20xx).
fn year_of(s: &str) -> Option<i32> {
    match s.len() {
        2 => {
            let y = digits(s, 2, 2)? as i32;
            Some(if y < 30 { 2000 + y } else { 1900 + y })
        }
        4 => Some(digits(s, 4, 4)? as i32).filter(|y| (1900..=9999).contains(y)),
        _ => None,
    }
}

/// The serial of an existing date.
fn serial(y: i32, m: u32, d: u32) -> Option<f64> {
    if !(1..=12).contains(&m) || d < 1 {
        return None;
    }
    if d > days_in_month(y, m as i32) as u32 && !(y == 1900 && m == 2 && d == 29) {
        return None;
    }
    ymd_to_serial(y, m as i32, d as i32)
}

/// A date alone: its serial and format.
fn date(s: &str, year: i32) -> Option<(f64, &'static str)> {
    // Numeric dates: m/d/y, m-d-y, yyyy-m-d, d.m.y, m/d, m/yyyy.
    for sep in ['/', '-', '.'] {
        let parts: Vec<&str> = s.split(sep).collect();
        if parts.len() < 2
            || !parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        {
            continue;
        }
        return match (sep, &parts[..]) {
            ('.', &[d, m, y]) => Some((
                serial(year_of(y)?, digits(m, 1, 2)?, digits(d, 1, 2)?)?,
                DOTTED_DATE,
            )),
            ('.', _) => None,
            (_, &[a, b, c]) if a.len() == 4 => Some((
                serial(year_of(a)?, digits(b, 1, 2)?, digits(c, 1, 2)?)?,
                SHORT_DATE,
            )),
            (_, &[m, d, y]) => Some((
                serial(year_of(y)?, digits(m, 1, 2)?, digits(d, 1, 2)?)?,
                SHORT_DATE,
            )),
            (_, &[m, y]) if y.len() == 4 => {
                Some((serial(year_of(y)?, digits(m, 1, 2)?, 1)?, MONTH_YEAR))
            }
            (_, &[m, d]) => Some((serial(year, digits(m, 1, 2)?, digits(d, 1, 2)?)?, DAY_MONTH)),
            _ => None,
        };
    }
    // Month names: d-mon[-y], d mon [y], mon d[, y], mon[-]y.
    let t = s.replace(", ", " ").replace(',', " ");
    let parts: Vec<&str> = t.split([' ', '-']).filter(|p| !p.is_empty()).collect();
    match parts[..] {
        [a, b] => {
            if let (Some(d), Some(m)) = (digits(a, 1, 2), month_name(b)) {
                return Some((serial(year, m, d)?, DAY_MONTH));
            }
            let m = month_name(a)?;
            match (digits(b, 1, 2), b.len()) {
                (Some(d), _) if d >= 1 && d <= days_in_month(year, m as i32) as u32 => {
                    Some((serial(year, m, d)?, DAY_MONTH))
                }
                (_, 2 | 4) => Some((serial(year_of(b)?, m, 1)?, MONTH_YEAR)),
                _ => None,
            }
        }
        [a, b, c] => {
            let (d, m) = match (digits(a, 1, 2), month_name(b)) {
                (Some(d), Some(m)) => (d, m),
                _ => (digits(b, 1, 2)?, month_name(a)?),
            };
            Some((serial(year_of(c)?, m, d)?, DAY_MONTH_YEAR))
        }
        _ => None,
    }
}

/// A time alone: its day fraction (≥ 1 for elapsed hours) and format.
fn time(s: &str) -> Option<(f64, &'static str)> {
    let lower = s.to_ascii_lowercase();
    let (clock, pm) = if let Some(r) = lower.strip_suffix("am").or_else(|| lower.strip_suffix('a'))
    {
        (r.trim_end(), Some(false))
    } else if let Some(r) = lower.strip_suffix("pm").or_else(|| lower.strip_suffix('p')) {
        (r.trim_end(), Some(true))
    } else {
        (lower.as_str(), None)
    };
    let mut it = clock.split(':');
    let h = digits(it.next()?, 1, if pm.is_some() { 2 } else { 4 })?;
    let m = match it.next() {
        Some(m) => Some(digits(m, 1, 2)?),
        // `1 PM`: an hour alone needs AM/PM.
        None if pm.is_some() && clock.len() < s.len() => None,
        None => return None,
    };
    let sec = match it.next() {
        Some(x) => {
            let (whole, frac) = x.split_once('.').unwrap_or((x, ""));
            let w = digits(whole, 1, 2)?;
            if !frac.is_empty() && !frac.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let f: f64 = if frac.is_empty() {
                0.0
            } else {
                format!("0.{frac}").parse().ok()?
            };
            Some(f64::from(w) + f)
        }
        None => None,
    };
    if it.next().is_some() || m.is_some_and(|m| m > 59) || sec.is_some_and(|s| s >= 60.0) {
        return None;
    }
    let h = match pm {
        Some(pm) => {
            if !(1..=12).contains(&h) {
                return None;
            }
            h % 12 + if pm { 12 } else { 0 }
        }
        None => h,
    };
    let value =
        (f64::from(h) * 3600.0 + f64::from(m.unwrap_or(0)) * 60.0 + sec.unwrap_or(0.0)) / 86_400.0;
    let format = match (pm.is_some(), sec.is_some()) {
        _ if h >= 24 => TIME_ELAPSED,
        (true, true) => TIME_HMS_AMPM,
        (true, false) => TIME_HM_AMPM,
        (false, true) => TIME_HMS,
        (false, false) => TIME_HM,
    };
    Some((value, format))
}

fn date_time(s: &str, year: i32) -> Option<Entry> {
    if let Some((v, f)) = date(s, year) {
        return entry(v, Some(f));
    }
    if let Some((v, f)) = time(s) {
        return entry(v, Some(f));
    }
    // Date and time: the time is the part after the last space that
    // contains a `:` (`3/4/2024 1:30 PM`, `March 4, 2024 13:45`).
    let colon = s.find(':')?;
    let split = s[..colon].rfind(' ')?;
    let (d, t) = (&s[..split], &s[split + 1..]);
    let (day, _) = date(d.trim_end(), year)?;
    let (frac, _) = time(t).filter(|(v, _)| *v < 1.0)?;
    entry(day + frac, Some(DATE_TIME))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(s: &str) -> Option<(f64, Option<&'static str>)> {
        recognize_in_year(s, 2026).map(|e| (e.value, e.format))
    }

    #[test]
    fn numbers() {
        assert_eq!(rec("42"), Some((42.0, None)));
        assert_eq!(rec("-3.5"), Some((-3.5, None)));
        assert_eq!(rec(".5"), Some((0.5, None)));
        assert_eq!(rec("12."), Some((12.0, None)));
        assert_eq!(rec("1,234"), Some((1234.0, Some(THOUSANDS))));
        assert_eq!(rec("1,234.5"), Some((1234.5, Some(THOUSANDS_2))));
        assert_eq!(rec("12%"), Some((0.12, Some(PERCENT))));
        assert_eq!(rec("12.5%"), Some((0.125, Some(PERCENT_2))));
        assert_eq!(rec("50 %"), Some((0.5, Some(PERCENT))));
        assert_eq!(rec("$1,234.50"), Some((1234.5, Some(DOLLAR_2))));
        assert_eq!(rec("$5"), Some((5.0, Some(DOLLAR))));
        assert_eq!(rec("-$5"), Some((-5.0, Some(DOLLAR))));
        assert_eq!(rec("$-5"), Some((-5.0, Some(DOLLAR))));
        assert_eq!(rec("($5.25)"), Some((-5.25, Some(DOLLAR_2))));
        assert_eq!(rec("(5)"), Some((-5.0, None)));
        assert_eq!(rec("€12"), Some((12.0, Some(EURO))));
        assert_eq!(rec("12,50 €"), None);
        assert_eq!(rec("12.50 €"), Some((12.5, Some(EURO_2))));
        assert_eq!(rec("12€"), Some((12.0, Some(EURO))));
        assert_eq!(rec("£3"), Some((3.0, Some(POUND))));
        assert_eq!(rec("1e3"), Some((1000.0, Some(SCIENTIFIC))));
        assert_eq!(rec("1.5E-3"), Some((0.0015, Some(SCIENTIFIC))));
        for text in [
            "abc", "1,23", "$", "%", "--5", "(-5)", "$5%", " 7", "7 ", "1.2.3", "12 34",
        ] {
            assert_eq!(rec(text), None, "{text}");
        }
    }

    #[test]
    fn fractions() {
        assert_eq!(rec("1 1/2"), Some((1.5, Some(FRACTION))));
        assert_eq!(rec("0 3/4"), Some((0.75, Some(FRACTION))));
        assert_eq!(rec("-2 1/16"), Some((-2.0625, Some(FRACTION_2))));
        assert_eq!(rec("1 1/0"), None);
    }

    #[test]
    fn dates() {
        let d = |y, m, dd| ymd_to_serial(y, m, dd).unwrap();
        assert_eq!(rec("3/4/2024"), Some((d(2024, 3, 4), Some(SHORT_DATE))));
        assert_eq!(rec("3/4/24"), Some((d(2024, 3, 4), Some(SHORT_DATE))));
        assert_eq!(rec("3-4-1995"), Some((d(1995, 3, 4), Some(SHORT_DATE))));
        assert_eq!(rec("12/31/99"), Some((d(1999, 12, 31), Some(SHORT_DATE))));
        assert_eq!(rec("2024-03-04"), Some((d(2024, 3, 4), Some(SHORT_DATE))));
        assert_eq!(rec("2024/3/4"), Some((d(2024, 3, 4), Some(SHORT_DATE))));
        assert_eq!(rec("4.3.2024"), Some((d(2024, 3, 4), Some(DOTTED_DATE))));
        assert_eq!(rec("04.03.24"), Some((d(2024, 3, 4), Some(DOTTED_DATE))));
        assert_eq!(rec("1/2"), Some((d(2026, 1, 2), Some(DAY_MONTH))));
        assert_eq!(rec("4-Mar"), Some((d(2026, 3, 4), Some(DAY_MONTH))));
        assert_eq!(rec("4 March"), Some((d(2026, 3, 4), Some(DAY_MONTH))));
        assert_eq!(rec("Mar 4"), Some((d(2026, 3, 4), Some(DAY_MONTH))));
        assert_eq!(
            rec("4-Mar-2024"),
            Some((d(2024, 3, 4), Some(DAY_MONTH_YEAR)))
        );
        assert_eq!(
            rec("March 4, 2024"),
            Some((d(2024, 3, 4), Some(DAY_MONTH_YEAR)))
        );
        assert_eq!(rec("Mar 2024"), Some((d(2024, 3, 1), Some(MONTH_YEAR))));
        assert_eq!(rec("Mar-95"), Some((d(1995, 3, 1), Some(MONTH_YEAR))));
        assert_eq!(rec("3/2024"), Some((d(2024, 3, 1), Some(MONTH_YEAR))));
        assert_eq!(rec("2/29/1900"), Some((60.0, Some(SHORT_DATE))));
        for text in [
            "2/30/2024",
            "13/1/2024",
            "1/2/3",
            "1.2.3",
            "Marc 4",
            "May",
            "4-Foo",
            "0/1",
            "1/2/3/4",
        ] {
            assert_eq!(rec(text), None, "{text}");
        }
    }

    #[test]
    fn times() {
        let t = |h: f64, m: f64, s: f64| (h * 3600.0 + m * 60.0 + s) / 86_400.0;
        assert_eq!(rec("13:45"), Some((t(13.0, 45.0, 0.0), Some(TIME_HM))));
        assert_eq!(rec("13:45:30"), Some((t(13.0, 45.0, 30.0), Some(TIME_HMS))));
        assert_eq!(
            rec("1:30 PM"),
            Some((t(13.0, 30.0, 0.0), Some(TIME_HM_AMPM)))
        );
        assert_eq!(
            rec("12:15 am"),
            Some((t(0.0, 15.0, 0.0), Some(TIME_HM_AMPM)))
        );
        assert_eq!(
            rec("1:30:15 pm"),
            Some((t(13.0, 30.0, 15.0), Some(TIME_HMS_AMPM)))
        );
        assert_eq!(rec("1 PM"), Some((t(13.0, 0.0, 0.0), Some(TIME_HM_AMPM))));
        assert_eq!(rec("25:30"), Some((t(25.0, 30.0, 0.0), Some(TIME_ELAPSED))));
        for text in ["13:60", "1:2:3:4", "13 PM", "1:30 XM", "PM", "1:30:60"] {
            assert_eq!(rec(text), None, "{text}");
        }
    }

    #[test]
    fn date_and_time() {
        let day = ymd_to_serial(2024, 3, 4).unwrap();
        let t = (13.0 * 3600.0 + 45.0 * 60.0) / 86_400.0;
        assert_eq!(rec("3/4/2024 13:45"), Some((day + t, Some(DATE_TIME))));
        assert_eq!(rec("3/4/2024 1:45 PM"), Some((day + t, Some(DATE_TIME))));
        assert_eq!(rec("March 4, 2024 13:45"), Some((day + t, Some(DATE_TIME))));
        assert_eq!(rec("3/4/2024 25:00"), None);
    }
}
