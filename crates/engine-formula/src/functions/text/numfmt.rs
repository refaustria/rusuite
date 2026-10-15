//! A small subset of Excel number formats for `TEXT`.
//!
//! Supported: sections (`pos;neg;zero;text`), digit placeholders `0` `#`,
//! thousands grouping `,` between placeholders, trailing `,` scaling by
//! 1000, decimal point, `%`, quoted and backslash-escaped literals, `@`,
//! `General`, and the date/time tokens `yyyy yy m mm mmm mmmm d dd ddd
//! dddd h hh s ss` (`m` is a minute directly after `h` or before `s`),
//! the 12-hour markers `AM/PM` `am/pm` `A/P` `a/p` (printed in the case
//! written) and elapsed time `[h]` `[hh]` `[m]` `[mm]` `[s]` `[ss]` (the
//! total hours/minutes/seconds; the smaller units after it are within it).
//!
//! Not supported (passed through as literal characters or ignored):
//! `?` placeholders, exponent formats (`E+`), fractions (`# ?/?`),
//! conditions (`[>100]`), colours and locale tags in brackets (dropped),
//! literals between digit placeholders (moved behind the number),
//! fractional seconds.

use crate::ast::ErrorKind;
use crate::functions::datetime::serial::{serial_day_hms, serial_to_ymd_hms};
use crate::value::format_general;

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Lit(String),
    /// `0` or `#`.
    Ph(char),
    Comma,
    Point,
    Pct,
    At,
    /// Lower-case date letter and run length.
    Date(char, usize),
    /// Elapsed time `[h]`, `[mm]`, …: lower-case unit and run length.
    Elapsed(char, usize),
    /// `AM/PM` / `A/P` marker as written (its case is kept).
    AmPm(String),
}

/// Splits a format on `;` outside quotes and escapes.
fn split_sections(fmt: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut quoted = false;
    let mut esc = false;
    for c in fmt.chars() {
        let cur = out.last_mut().expect("non-empty");
        if esc {
            esc = false;
        } else if quoted {
            quoted = c != '"';
        } else if c == '\\' {
            esc = true;
        } else if c == '"' {
            quoted = true;
        } else if c == ';' {
            out.push(String::new());
            continue;
        }
        cur.push(c);
    }
    out
}

fn tokenize(sec: &str) -> Vec<Tok> {
    let chars: Vec<char> = sec.chars().collect();
    let mut toks: Vec<Tok> = Vec::new();
    let push_lit = |toks: &mut Vec<Tok>, s: &str| match toks.last_mut() {
        Some(Tok::Lit(l)) => l.push_str(s),
        _ => toks.push(Tok::Lit(s.to_string())),
    };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        i += 1;
        match c {
            '"' => {
                let mut s = String::new();
                while i < chars.len() && chars[i] != '"' {
                    s.push(chars[i]);
                    i += 1;
                }
                i += 1;
                push_lit(&mut toks, &s);
            }
            '\\' => {
                if let Some(&n) = chars.get(i) {
                    push_lit(&mut toks, &n.to_string());
                    i += 1;
                }
            }
            '[' => {
                let start = i;
                while i < chars.len() && chars[i] != ']' {
                    i += 1;
                }
                let inner: String = chars[start..i.min(chars.len())].iter().collect();
                i += 1;
                let unit = inner.chars().next().map(|c| c.to_ascii_lowercase());
                if let Some(u @ ('h' | 'm' | 's')) = unit {
                    if inner.chars().all(|c| c.to_ascii_lowercase() == u) {
                        toks.push(Tok::Elapsed(u, inner.len()));
                    }
                }
            }
            'a' | 'A' => {
                let rest: String = chars[i - 1..].iter().take(5).collect();
                let marker = if rest.len() >= 5 && rest.eq_ignore_ascii_case("am/pm") {
                    Some(rest)
                } else {
                    let short: String = rest.chars().take(3).collect();
                    short.eq_ignore_ascii_case("a/p").then_some(short)
                };
                match marker {
                    Some(m) => {
                        i += m.chars().count() - 1;
                        toks.push(Tok::AmPm(m));
                    }
                    None => push_lit(&mut toks, &c.to_string()),
                }
            }
            '_' => {
                i += 1;
                push_lit(&mut toks, " ");
            }
            '*' => i += 1,
            '0' | '#' => toks.push(Tok::Ph(c)),
            ',' => toks.push(Tok::Comma),
            '.' => toks.push(Tok::Point),
            '%' => toks.push(Tok::Pct),
            '@' => toks.push(Tok::At),
            'y' | 'Y' | 'm' | 'M' | 'd' | 'D' | 'h' | 'H' | 's' | 'S' => {
                let l = c.to_ascii_lowercase();
                let mut n = 1;
                while chars.get(i).map(|x| x.to_ascii_lowercase()) == Some(l) {
                    n += 1;
                    i += 1;
                }
                toks.push(Tok::Date(l, n));
            }
            _ => push_lit(&mut toks, &c.to_string()),
        }
    }
    toks
}

/// The text of a token when it is not interpreted.
fn raw(t: &Tok) -> String {
    match t {
        Tok::Lit(s) => s.clone(),
        Tok::Ph(c) => c.to_string(),
        Tok::Comma => ",".into(),
        Tok::Point => ".".into(),
        Tok::Pct => "%".into(),
        Tok::At => "@".into(),
        Tok::Date(c, n) => c.to_string().repeat(*n),
        Tok::Elapsed(c, n) => format!("[{}]", c.to_string().repeat(*n)),
        Tok::AmPm(m) => m.clone(),
    }
}

/// True when some section contains `@`.
pub(crate) fn has_text_section(fmt: &str) -> bool {
    split_sections(fmt)
        .iter()
        .any(|s| tokenize(s).contains(&Tok::At))
}

/// Applies the text section of the format to `s`.
pub(crate) fn format_text(s: &str, fmt: &str) -> String {
    let sections = split_sections(fmt);
    let pick = if sections.len() >= 4 {
        &sections[3]
    } else {
        sections
            .iter()
            .find(|x| tokenize(x).contains(&Tok::At))
            .unwrap_or(&sections[0])
    };
    tokenize(pick)
        .iter()
        .map(|t| match t {
            Tok::At => s.to_string(),
            t => raw(t),
        })
        .collect()
}

/// Formats a number; `#VALUE!` for dates outside the supported range.
pub(crate) fn format_number(n: f64, fmt: &str) -> Result<String, ErrorKind> {
    if fmt.trim().eq_ignore_ascii_case("general") {
        return Ok(format_general(n));
    }
    let sections = split_sections(fmt);
    let (sec, sign) = if n < 0.0 {
        if sections.len() >= 2 {
            (&sections[1], "")
        } else {
            (&sections[0], "-")
        }
    } else if n == 0.0 && sections.len() >= 3 {
        (&sections[2], "")
    } else {
        (&sections[0], "")
    };
    let toks = tokenize(sec);
    let a = n.abs();
    let body = if toks
        .iter()
        .any(|t| matches!(t, Tok::Date(..) | Tok::Elapsed(..) | Tok::AmPm(_)))
    {
        if n < 0.0 {
            return Err(ErrorKind::Value);
        }
        format_date(a, &toks)?
    } else {
        format_numeric(a, &toks)
    };
    Ok(format!("{sign}{body}"))
}

/// Digits of `x >= 0` rounded half away from zero (on the 15-digit
/// decimal representation) to `nf` decimals: `(integer digits without
/// leading zeros, exactly nf fraction digits)`.
fn decimal_digits(x: f64, nf: usize) -> (String, String) {
    if x == 0.0 || !x.is_finite() {
        return (String::new(), "0".repeat(nf));
    }
    let s = format!("{x:.14e}");
    let (mant, exp) = s.split_once('e').expect("exponent form");
    let exp: i64 = exp.parse().unwrap_or(0);
    let mut digits: Vec<u8> = mant
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|b| b - b'0')
        .collect();
    // Number of digits before the decimal point.
    let mut p = exp + 1;
    if p < 0 {
        let mut z = vec![0u8; (-p) as usize];
        z.extend(digits);
        digits = z;
        p = 0;
    }
    let p = p as usize;
    if digits.len() < p + nf + 1 {
        digits.resize(p + nf + 1, 0);
    }
    let round_up = digits[p + nf] >= 5;
    digits.truncate(p + nf);
    if round_up {
        let mut i = digits.len();
        loop {
            if i == 0 {
                digits.insert(0, 1);
                break;
            }
            i -= 1;
            if digits[i] == 9 {
                digits[i] = 0;
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    let int_len = digits.len() - nf;
    let to_s = |d: &[u8]| d.iter().map(|d| char::from(b'0' + d)).collect::<String>();
    let int = to_s(&digits[..int_len]);
    (
        int.trim_start_matches('0').to_string(),
        to_s(&digits[int_len..]),
    )
}

fn format_numeric(mut v: f64, toks: &[Tok]) -> String {
    let first = toks.iter().position(|t| matches!(t, Tok::Ph(_)));
    let last = toks.iter().rposition(|t| matches!(t, Tok::Ph(_)));
    for t in toks {
        if *t == Tok::Pct {
            v *= 100.0;
        }
    }
    let (Some(a), Some(z)) = (first, last) else {
        return toks
            .iter()
            .map(|t| match t {
                Tok::At => format_general(v),
                t => raw(t),
            })
            .collect();
    };
    let prefix: String = toks[..a].iter().map(raw).collect();
    let mut suffix_toks = &toks[z + 1..];
    let mut scale = 0;
    while let Some((Tok::Comma, rest)) = suffix_toks.split_first() {
        scale += 1;
        suffix_toks = rest;
    }
    v /= 1000f64.powi(scale);
    let suffix: String = suffix_toks.iter().map(raw).collect();

    let mut iph: Vec<char> = Vec::new();
    let mut fph: Vec<char> = Vec::new();
    let mut point = false;
    let mut group = false;
    let mut mid = String::new();
    for t in &toks[a..=z] {
        match t {
            Tok::Ph(c) if point => fph.push(*c),
            Tok::Ph(c) => iph.push(*c),
            Tok::Point if !point => point = true,
            Tok::Comma if !point => group = true,
            Tok::Comma => {}
            t => mid.push_str(&raw(t)),
        }
    }
    let (int_s, mut frac) = decimal_digits(v, fph.len());
    while frac.ends_with('0') && fph.get(frac.len().wrapping_sub(1)) == Some(&'#') {
        frac.pop();
    }
    let mut int = String::new();
    if int_s.len() < iph.len() {
        for c in &iph[..iph.len() - int_s.len()] {
            if *c == '0' {
                int.push('0');
            }
        }
    }
    int.push_str(&int_s);
    if group {
        let n = int.len();
        let mut g = String::with_capacity(n + n / 3);
        for (i, c) in int.chars().enumerate() {
            if i > 0 && (n - i) % 3 == 0 {
                g.push(',');
            }
            g.push(c);
        }
        int = g;
    }
    let mut out = prefix;
    out.push_str(&int);
    if point {
        out.push('.');
        out.push_str(&frac);
    }
    out.push_str(&mid);
    out.push_str(&suffix);
    out
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

fn format_date(serial: f64, toks: &[Tok]) -> Result<String, ErrorKind> {
    let (day, _, _, _) = serial_day_hms(serial).ok_or(ErrorKind::Value)?;
    let (y, m, d, hh, mi, ss) = serial_to_ymd_hms(serial).ok_or(ErrorKind::Value)?;
    let weekday = ((day + 6) % 7) as usize;
    let total_secs = day * 86_400 + i64::from(hh) * 3600 + i64::from(mi) * 60 + i64::from(ss);
    let twelve = toks.iter().any(|t| matches!(t, Tok::AmPm(_)));
    let pad = |v: i64, n: usize| format!("{v:0n$}");

    let is_time = |t: &Tok| matches!(t, Tok::Date(..) | Tok::Elapsed(..));
    let unit = |t: &Tok| match t {
        Tok::Date(c, _) | Tok::Elapsed(c, _) => Some(*c),
        _ => None,
    };
    let date_toks: Vec<usize> = (0..toks.len()).filter(|&i| is_time(&toks[i])).collect();
    let mut out = String::new();
    for (i, t) in toks.iter().enumerate() {
        match t {
            Tok::AmPm(marker) => {
                let pm = hh >= 12;
                let upper = marker.starts_with('A');
                let text = match (marker.len() > 3, pm) {
                    (true, false) => "AM",
                    (true, true) => "PM",
                    (false, false) => "A",
                    (false, true) => "P",
                };
                out.push_str(&if upper {
                    text.to_string()
                } else {
                    text.to_ascii_lowercase()
                });
                continue;
            }
            Tok::Elapsed(c, n) => {
                let v = match c {
                    'h' => total_secs / 3600,
                    'm' => total_secs / 60,
                    _ => total_secs,
                };
                out.push_str(&pad(v, (*n).min(2)));
                continue;
            }
            Tok::Date(..) => {}
            t => {
                out.push_str(&raw(t));
                continue;
            }
        }
        let Tok::Date(c, n) = t else { continue };
        let n = *n;
        match c {
            'y' => {
                if n <= 2 {
                    out.push_str(&format!("{:02}", y % 100));
                } else {
                    out.push_str(&format!("{y:04}"));
                }
            }
            'm' => {
                let pos = date_toks.iter().position(|&k| k == i).expect("date token");
                let prev_h = pos > 0 && unit(&toks[date_toks[pos - 1]]) == Some('h');
                let next_s = date_toks
                    .get(pos + 1)
                    .is_some_and(|&k| unit(&toks[k]) == Some('s'));
                if n <= 2 && (prev_h || next_s) {
                    out.push_str(&pad(i64::from(mi), n));
                } else {
                    let name = MONTHS[(m - 1) as usize];
                    match n {
                        1 => out.push_str(&m.to_string()),
                        2 => out.push_str(&format!("{m:02}")),
                        3 => out.push_str(&name[..3]),
                        4 => out.push_str(name),
                        _ => out.push_str(&name[..1]),
                    }
                }
            }
            'd' => match n {
                1 => out.push_str(&d.to_string()),
                2 => out.push_str(&format!("{d:02}")),
                3 => out.push_str(&DAYS[weekday][..3]),
                _ => out.push_str(DAYS[weekday]),
            },
            'h' => {
                let h = if twelve {
                    match hh % 12 {
                        0 => 12,
                        h => h,
                    }
                } else {
                    hh
                };
                out.push_str(&pad(i64::from(h), n.min(2)));
            }
            _ => out.push_str(&pad(i64::from(ss), n.min(2))),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::format_number;

    fn f(n: f64, code: &str) -> String {
        format_number(n, code).unwrap()
    }

    /// 2024-01-15 (serial 45306) plus a time of day.
    fn at(h: u32, m: u32, s: u32) -> f64 {
        45306.0 + f64::from(h * 3600 + m * 60 + s) / 86_400.0
    }

    #[test]
    fn twelve_hour_clock() {
        assert_eq!(f(at(0, 5, 0), "h:mm AM/PM"), "12:05 AM");
        assert_eq!(f(at(9, 5, 0), "h:mm AM/PM"), "9:05 AM");
        assert_eq!(f(at(12, 0, 0), "h:mm AM/PM"), "12:00 PM");
        assert_eq!(f(at(15, 7, 9), "hh:mm:ss am/pm"), "03:07:09 pm");
        assert_eq!(f(at(23, 59, 59), "h:mm A/P"), "11:59 P");
        assert_eq!(f(at(1, 0, 0), "h a/p"), "1 a");
        assert_eq!(f(at(15, 0, 0), "yyyy-mm-dd h AM/PM"), "2024-01-15 3 PM");
        // Without a marker the clock stays 24-hour; a lone "a" is a literal.
        assert_eq!(f(at(15, 7, 0), "h:mm"), "15:07");
        assert_eq!(f(at(15, 7, 0), "h \\a mm"), "15 a 07");
    }

    #[test]
    fn elapsed_time() {
        // 1 day 2:03:04 = 26 hours.
        let v = 1.0 + f64::from(2 * 3600 + 3 * 60 + 4) / 86_400.0;
        assert_eq!(f(v, "[h]:mm:ss"), "26:03:04");
        assert_eq!(f(v, "[hh]:mm"), "26:03");
        assert_eq!(f(v, "[mm]:ss"), "1563:04");
        assert_eq!(f(v, "[ss]"), "93784");
        assert_eq!(f(0.5 / 24.0, "[h]:mm:ss"), "0:30:00");
        assert_eq!(f(0.5 / 24.0, "[mm]:ss"), "30:00");
        assert_eq!(f(100.0, "[h]"), "2400");
        // Brackets that are not elapsed units are still dropped.
        assert_eq!(f(1.5, "[Red]0.0"), "1.5");
        assert!(format_number(-1.0, "[h]:mm").is_err());
    }
}
