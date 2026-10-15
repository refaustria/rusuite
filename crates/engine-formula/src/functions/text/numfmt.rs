//! A small subset of Excel number formats for `TEXT`.
//!
//! Supported: sections (`pos;neg;zero;text`), digit placeholders `0` `#`,
//! thousands grouping `,` between placeholders, trailing `,` scaling by
//! 1000, decimal point, `%`, quoted and backslash-escaped literals, `@`,
//! `General`, and the date/time tokens `yyyy yy m mm mmm mmmm d dd ddd
//! dddd h hh s ss` (`m` is a minute directly after `h` or before `s`).
//!
//! Not supported (passed through as literal characters or ignored):
//! `?` placeholders, exponent formats (`E+`), fractions (`# ?/?`), AM/PM,
//! elapsed time (`[h]`), conditions (`[>100]`), colours and locale tags
//! in brackets (dropped), literals between digit placeholders (moved
//! behind the number), fractional seconds.

use crate::ast::ErrorKind;
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
                while i < chars.len() && chars[i] != ']' {
                    i += 1;
                }
                i += 1;
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
    let body = if toks.iter().any(|t| matches!(t, Tok::Date(..))) {
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

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
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
    if serial >= 2958466.0 {
        return Err(ErrorKind::Value);
    }
    let mut day = serial.floor() as i64;
    let mut secs = ((serial - serial.floor()) * 86400.0).round() as i64;
    if secs >= 86400 {
        day += 1;
        secs -= 86400;
    }
    // Excel's 1900 calendar: serial 60 is the non-existent 1900-02-29.
    let (y, m, d) = match day {
        0 => (1900, 1, 0),
        1..=59 => civil_from_days(day + days_from_civil(1899, 12, 31)),
        60 => (1900, 2, 29),
        _ => civil_from_days(day + days_from_civil(1899, 12, 30)),
    };
    let weekday = ((day + 6) % 7) as usize;
    let (hh, mi, ss) = (secs / 3600, secs / 60 % 60, secs % 60);

    let date_toks: Vec<usize> = (0..toks.len())
        .filter(|&i| matches!(toks[i], Tok::Date(..)))
        .collect();
    let mut out = String::new();
    for (i, t) in toks.iter().enumerate() {
        let Tok::Date(c, n) = t else {
            out.push_str(&raw(t));
            continue;
        };
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
                let prev_h = pos > 0 && matches!(toks[date_toks[pos - 1]], Tok::Date('h', _));
                let next_s = date_toks
                    .get(pos + 1)
                    .is_some_and(|&k| matches!(toks[k], Tok::Date('s', _)));
                if n <= 2 && (prev_h || next_s) {
                    out.push_str(&if n == 1 {
                        mi.to_string()
                    } else {
                        format!("{mi:02}")
                    });
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
            'h' => out.push_str(&if n == 1 {
                hh.to_string()
            } else {
                format!("{hh:02}")
            }),
            _ => out.push_str(&if n == 1 {
                ss.to_string()
            } else {
                format!("{ss:02}")
            }),
        }
    }
    Ok(out)
}
