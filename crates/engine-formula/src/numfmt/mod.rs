//! Excel number format codes: one formatter for cell display and `TEXT`.
//!
//! The grammar (see `docs/number-formats.md`):
//!
//! * up to four sections `positive;negative;zero;text`; a last section
//!   holding `@` is the text section even when there are fewer than four;
//! * per section: a condition `[>=100]` (`< <= > >= = <>`), a colour
//!   `[Red]` / `[Color 10]` (the 56-colour palette), a locale or currency
//!   tag `[$€-407]` (the symbol is printed; the locale changes month and
//!   day names only; `[$-F800]` / `[$-F400]`, the system long date / time,
//!   are followed by the code they stand for and ignored);
//! * numbers: digit placeholders `0` `#` `?`, the decimal point, `,` as
//!   thousands separator (between placeholders) or as scaling by 1000
//!   (after the last placeholder), `%`, scientific `E+00` / `E-00`
//!   (engineering when the mantissa has several `#`), fractions
//!   (`# ?/?`, `?/8`, `# ??/100`), literals between placeholders
//!   (`000-00-0000`), `General` inside a section;
//! * dates and times: `y yy yyyy`, `m mm mmm mmmm mmmmm` (minutes after
//!   an hour or before seconds), `d dd ddd dddd`, `h hh`, `s ss`, `.0`
//!   `.00` `.000` after seconds, `AM/PM` `A/P`, elapsed `[h]` `[mm]`
//!   `[ss]`;
//! * text: `@`;
//! * everywhere: `"literal"`, `\x`, `_x` (a space as wide as `x`), `*x`
//!   (repeat `x` to fill the cell), and the characters Excel shows
//!   without quotes (`$ - + / ( ) : ! ^ & ' ~ { } < > =` and space).
//!
//! [`format_cell`] returns the display text plus the section colour and
//! the fill position for the grid; [`format_number`] / [`format_text`]
//! are `TEXT`'s view (no colour, the fill character dropped).
//! [`general`] is the General format of a cell (11 characters).

use crate::ast::ErrorKind;
use crate::functions::datetime::serial::serial_to_ymd;

#[cfg(test)]
mod tests;

/// The result of formatting a value for a cell.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Formatted {
    /// The text without the fill character.
    pub text: String,
    /// The section colour (`[Red]`, `[Color 10]`) as `0xRRGGBB`.
    pub color: Option<u32>,
    /// `*x`: the fill character and the char index in `text` where it is
    /// repeated to fill the cell width.
    pub fill: Option<(usize, char)>,
    /// The number was formatted with General: the grid may show fewer
    /// decimals (or scientific notation) when the cell is too narrow,
    /// instead of `####`.
    pub general: bool,
}

/// The fill marker inside formatted text (replaced by [`Formatted::fill`]).
const FILL_MARK: char = '\u{E000}';

/// Excel's 56-colour palette (`[Color n]`, 1-based).
const PALETTE: [u32; 56] = [
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, 0x800000,
    0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080, 0x9999FF, 0x993366,
    0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF, 0x000080, 0xFF00FF, 0xFFFF00,
    0x00FFFF, 0x800080, 0x800000, 0x008080, 0x0000FF, 0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99,
    0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99, 0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00, 0xFF9900,
    0xFF6600, 0x666699, 0x969696, 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366,
    0x333399, 0x333333,
];

/// The named colours (palette entries 1–8).
const NAMED_COLORS: [(&str, u32); 8] = [
    ("black", 0x000000),
    ("white", 0xFFFFFF),
    ("red", 0xFF0000),
    ("green", 0x00FF00),
    ("blue", 0x0000FF),
    ("yellow", 0xFFFF00),
    ("magenta", 0xFF00FF),
    ("cyan", 0x00FFFF),
];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Cmp {
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
}

impl Cmp {
    fn test(self, a: f64, b: f64) -> bool {
        match self {
            Cmp::Lt => a < b,
            Cmp::Le => a <= b,
            Cmp::Gt => a > b,
            Cmp::Ge => a >= b,
            Cmp::Eq => a == b,
            Cmp::Ne => a != b,
        }
    }

    /// Whether every value the condition admits is negative (the section
    /// then shows the number without its minus sign, like the implicit
    /// negative section).
    fn only_negative(self, b: f64) -> bool {
        match self {
            Cmp::Lt => b <= 0.0,
            Cmp::Le | Cmp::Eq => b < 0.0,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Lit(String),
    /// `0`, `#` or `?`.
    Digit(char),
    Point,
    Comma,
    Percent,
    /// `E+` (`plus`) or `E-`.
    Exp(bool),
    Slash,
    At,
    General,
    /// Lower-case date letter and run length.
    Date(char, usize),
    /// Elapsed time `[h]`, `[mm]`, …: lower-case unit and run length.
    Elapsed(char, usize),
    /// `AM/PM` / `A/P` marker as written (its case is kept).
    AmPm(String),
    /// `*x`.
    Fill(char),
}

/// Month and day names of a locale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum Names {
    #[default]
    English,
    German,
    /// de-AT: "Jänner".
    Austrian,
}

#[derive(Debug, Clone, PartialEq, Default)]
struct Section {
    toks: Vec<Tok>,
    cond: Option<(Cmp, f64)>,
    color: Option<u32>,
    names: Names,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Number,
    Date,
    Text,
}

impl Section {
    fn kind(&self) -> Kind {
        if self
            .toks
            .iter()
            .any(|t| matches!(t, Tok::Date(..) | Tok::Elapsed(..) | Tok::AmPm(_)))
        {
            Kind::Date
        } else if self.toks.contains(&Tok::At) {
            Kind::Text
        } else {
            Kind::Number
        }
    }
}

/// Splits a format on `;` outside quotes, escapes and brackets.
fn split_sections(fmt: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let (mut quoted, mut esc, mut bracket) = (false, false, false);
    for (i, c) in fmt.char_indices() {
        if esc {
            esc = false;
        } else if quoted {
            quoted = c != '"';
        } else if bracket {
            bracket = c != ']';
        } else {
            match c {
                '\\' => esc = true,
                '"' => quoted = true,
                '[' => bracket = true,
                ';' => {
                    out.push(&fmt[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
    }
    out.push(&fmt[start..]);
    out
}

/// Interprets the inside of `[...]` (not elapsed time).
fn bracket(inner: &str, sec: &mut Section, toks: &mut Vec<Tok>) {
    let lower = inner.trim().to_ascii_lowercase();
    if let Some(&(_, rgb)) = NAMED_COLORS.iter().find(|(n, _)| *n == lower) {
        sec.color = Some(rgb);
        return;
    }
    if let Some(n) = lower.strip_prefix("color") {
        if let Ok(i) = n.trim().parse::<usize>() {
            if (1..=56).contains(&i) {
                sec.color = Some(PALETTE[i - 1]);
            }
        }
        return;
    }
    let first = inner.chars().next();
    if matches!(first, Some('<' | '>' | '=')) {
        let (op, rest) = if let Some(r) = inner.strip_prefix("<=") {
            (Cmp::Le, r)
        } else if let Some(r) = inner.strip_prefix(">=") {
            (Cmp::Ge, r)
        } else if let Some(r) = inner.strip_prefix("<>") {
            (Cmp::Ne, r)
        } else if let Some(r) = inner.strip_prefix('<') {
            (Cmp::Lt, r)
        } else if let Some(r) = inner.strip_prefix('>') {
            (Cmp::Gt, r)
        } else {
            (Cmp::Eq, &inner[1..])
        };
        if let Ok(v) = rest.trim().parse::<f64>() {
            sec.cond = Some((op, v));
        }
        return;
    }
    if let Some(tag) = inner.strip_prefix('$') {
        let (symbol, locale) = tag.split_once('-').unwrap_or((tag, ""));
        if !symbol.is_empty() {
            toks.push(Tok::Lit(symbol.to_string()));
        }
        let loc = locale.to_ascii_lowercase();
        let lcid = u32::from_str_radix(&loc, 16).ok().map(|l| l & 0xFFFF);
        match lcid {
            // The system long date / time: the code that follows spells
            // it out.
            Some(0xF800 | 0xF400) => {}
            Some(0x0C07) => sec.names = Names::Austrian,
            Some(l) if l & 0x3FF == 0x07 => sec.names = Names::German,
            _ if loc.starts_with("de-at") => sec.names = Names::Austrian,
            _ if loc.starts_with("de") => sec.names = Names::German,
            _ => {}
        }
    }
}

/// Tokenizes one section body; brackets set `sec`'s condition, colour and
/// locale.
fn tokenize_body(src: &str, sec: &mut Section) -> Vec<Tok> {
    let chars: Vec<char> = src.chars().collect();
    let mut toks: Vec<Tok> = Vec::new();
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
                toks.push(Tok::Lit(s));
            }
            '\\' => {
                if let Some(&n) = chars.get(i) {
                    toks.push(Tok::Lit(n.to_string()));
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
                match unit {
                    Some(u @ ('h' | 'm' | 's'))
                        if inner.chars().all(|c| c.to_ascii_lowercase() == u) =>
                    {
                        toks.push(Tok::Elapsed(u, inner.chars().count()));
                    }
                    _ => bracket(&inner, sec, &mut toks),
                }
            }
            'a' | 'A' => {
                let rest: String = chars[i - 1..].iter().take(5).collect();
                let marker = if rest.chars().count() == 5 && rest.eq_ignore_ascii_case("am/pm") {
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
                    None => toks.push(Tok::Lit(c.to_string())),
                }
            }
            'g' | 'G'
                if chars.len() >= i + 6
                    && chars[i - 1..i + 6]
                        .iter()
                        .collect::<String>()
                        .eq_ignore_ascii_case("general") =>
            {
                i += 6;
                toks.push(Tok::General);
            }
            '_' => {
                if i < chars.len() {
                    i += 1;
                }
                toks.push(Tok::Lit(" ".into()));
            }
            '*' => {
                if let Some(&f) = chars.get(i) {
                    toks.push(Tok::Fill(f));
                    i += 1;
                }
            }
            '0' | '#' | '?' => toks.push(Tok::Digit(c)),
            ',' => toks.push(Tok::Comma),
            '.' => toks.push(Tok::Point),
            '%' => toks.push(Tok::Percent),
            '@' => toks.push(Tok::At),
            '/' => toks.push(Tok::Slash),
            'e' | 'E' if matches!(chars.get(i), Some('+' | '-')) => {
                toks.push(Tok::Exp(chars[i] == '+'));
                i += 1;
            }
            'y' | 'Y' | 'm' | 'M' | 'd' | 'D' | 'h' | 'H' | 's' | 'S' => {
                let l = c.to_ascii_lowercase();
                let mut n = 1;
                while chars.get(i).map(|x| x.to_ascii_lowercase()) == Some(l) {
                    n += 1;
                    i += 1;
                }
                toks.push(Tok::Date(l, n));
            }
            _ => toks.push(Tok::Lit(c.to_string())),
        }
    }
    toks
}

fn parse_section(src: &str) -> Section {
    let mut sec = Section::default();
    sec.toks = tokenize_body(src, &mut sec);
    sec
}

/// A parsed format code.
#[derive(Debug, Clone, PartialEq)]
struct Format {
    /// The number sections (1–3, or more for malformed input).
    numbers: Vec<Section>,
    text: Option<Section>,
}

fn parse(code: &str) -> Format {
    let mut sections: Vec<Section> = split_sections(code)
        .into_iter()
        .map(parse_section)
        .collect();
    let text = if sections.len() >= 4 {
        Some(sections.remove(3))
    } else if sections.len() > 1 && sections.last().is_some_and(|s| s.kind() == Kind::Text) {
        sections.pop()
    } else {
        None
    };
    sections.truncate(3);
    Format {
        numbers: sections,
        text,
    }
}

/// Whether `code` is the General format.
fn is_general(code: &str) -> bool {
    code.trim().eq_ignore_ascii_case("general")
}

impl Format {
    /// The section for `n` and whether the minus sign is dropped (the
    /// value is shown as its absolute value).
    fn choose(&self, n: f64) -> (&Section, bool) {
        let s = &self.numbers;
        let conditional = s.iter().take(2).any(|x| x.cond.is_some());
        if conditional {
            for sec in s.iter().take(2) {
                if let Some((op, b)) = sec.cond {
                    if op.test(n, b) {
                        return (sec, op.only_negative(b));
                    }
                }
            }
            let both = s.len() >= 2 && s[0].cond.is_some() && s[1].cond.is_some();
            let fallback = if both { 2 } else { 1 };
            return match s.get(fallback).or_else(|| s.get(1)) {
                Some(sec) if sec.cond.is_none() => (sec, false),
                _ => (&s[0], false),
            };
        }
        match s.len() {
            1 => (&s[0], false),
            2 if n < 0.0 => (&s[1], true),
            2 => (&s[0], false),
            _ if n > 0.0 => (&s[0], false),
            _ if n < 0.0 => (&s[1], true),
            _ => (&s[2], false),
        }
    }
}

// --- public API ---------------------------------------------------------------

/// Formats a number for a cell. `Err(#VALUE!)` when the format cannot show
/// it (a negative or too large date); the grid shows `#####` then.
pub fn format_cell(n: f64, code: &str) -> Result<Formatted, ErrorKind> {
    if code.trim().is_empty() || is_general(code) {
        return Ok(Formatted {
            text: general(n),
            general: true,
            ..Formatted::default()
        });
    }
    let fmt = parse(code);
    let (sec, abs) = fmt.choose(n);
    let general = sec.toks.contains(&Tok::General) && !sec.toks.contains(&Tok::Point);
    let raw = format_section(n, sec, abs)?;
    Ok(finish(raw, sec.color, general))
}

/// Formats text for a cell: the text section (`@` = the text) when the
/// format has one, else the text unchanged.
pub fn format_cell_text(s: &str, code: &str) -> Formatted {
    let fmt = parse(code);
    match fmt
        .text
        .as_ref()
        .or_else(|| fmt.numbers.iter().find(|x| x.kind() == Kind::Text))
    {
        Some(sec) => finish(text_section(s, sec), sec.color, false),
        None => Formatted {
            text: s.to_string(),
            ..Formatted::default()
        },
    }
}

/// `TEXT(n, code)`: the cell text without colour and fill.
pub fn format_number(n: f64, code: &str) -> Result<String, ErrorKind> {
    Ok(format_cell(n, code)?.text)
}

/// Whether some section contains `@` (`TEXT` applies it to text).
pub fn has_text_section(code: &str) -> bool {
    let fmt = parse(code);
    fmt.text.is_some() || fmt.numbers.iter().any(|s| s.kind() == Kind::Text)
}

/// `TEXT(s, code)` for a text `s` and a format with a text section.
pub fn format_text(s: &str, code: &str) -> String {
    format_cell_text(s, code).text
}

/// The colour a number gets from `code` (`[Red]` …) as `0xRRGGBB`.
pub fn color_for(n: f64, code: &str) -> Option<u32> {
    if is_general(code) {
        return None;
    }
    parse(code).choose(n).0.color
}

fn finish(raw: String, color: Option<u32>, general: bool) -> Formatted {
    let mut fill = None;
    let mut text = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    let mut count = 0;
    while let Some(c) = chars.next() {
        if c == FILL_MARK {
            let f = chars.next().unwrap_or(' ');
            if fill.is_none() {
                fill = Some((count, f));
            }
            continue;
        }
        text.push(c);
        count += 1;
    }
    Formatted {
        text,
        color,
        fill,
        general,
    }
}

/// The literal text of a token outside its normal role.
fn raw(t: &Tok) -> String {
    match t {
        Tok::Lit(s) => s.clone(),
        Tok::Digit(c) => c.to_string(),
        Tok::Point => ".".into(),
        Tok::Comma => ",".into(),
        Tok::Percent => "%".into(),
        Tok::Exp(p) => if *p { "E+" } else { "E-" }.into(),
        Tok::Slash => "/".into(),
        Tok::At => "@".into(),
        Tok::General => "General".into(),
        Tok::Date(c, n) => c.to_string().repeat(*n),
        Tok::Elapsed(c, n) => format!("[{}]", c.to_string().repeat(*n)),
        Tok::AmPm(m) => m.clone(),
        Tok::Fill(c) => format!("{FILL_MARK}{c}"),
    }
}

fn text_section(s: &str, sec: &Section) -> String {
    sec.toks
        .iter()
        .map(|t| match t {
            Tok::At => s.to_string(),
            t => raw(t),
        })
        .collect()
}

fn format_section(n: f64, sec: &Section, abs: bool) -> Result<String, ErrorKind> {
    match sec.kind() {
        Kind::Date => {
            if n < 0.0 {
                return Err(ErrorKind::Value);
            }
            format_date(n, sec)
        }
        Kind::Text => Ok(text_section(&general(n), sec)),
        Kind::Number => {
            let v = if abs { n.abs() } else { n };
            Ok(format_numeric(v, &sec.toks))
        }
    }
}

// --- General --------------------------------------------------------------------

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

/// `x` in scientific notation with `nf` mantissa decimals (trailing zeros
/// removed when `trim`) and at least `exp_digits` exponent digits.
fn scientific(x: f64, nf: usize, trim: bool, exp_digits: usize) -> String {
    let a = x.abs();
    let mut e = if a == 0.0 {
        0
    } else {
        a.log10().floor() as i32
    };
    let mut m = if a == 0.0 { 0.0 } else { a / 10f64.powi(e) };
    // Guard against log10 rounding (`1000` → `9.999E+2`).
    if m >= 10.0 {
        m /= 10.0;
        e += 1;
    } else if m != 0.0 && m < 1.0 {
        m *= 10.0;
        e -= 1;
    }
    let (mut int, mut frac) = decimal_digits(m, nf);
    if int.len() > 1 {
        // Rounded up to 10.
        e += 1;
        (int, frac) = decimal_digits(m / 10.0, nf);
    }
    if int.is_empty() {
        int.push('0');
    }
    if trim {
        while frac.ends_with('0') {
            frac.pop();
        }
    }
    let sign = if x < 0.0 { "-" } else { "" };
    let point = if frac.is_empty() { "" } else { "." };
    let es = if e < 0 { '-' } else { '+' };
    format!(
        "{sign}{int}{point}{frac}E{es}{:0w$}",
        e.unsigned_abs(),
        w = exp_digits
    )
}

/// Excel's General format of a cell: at most 11 characters; scientific
/// notation for numbers whose integer part does not fit and for
/// magnitudes below `1E-4`… (`0.0001` stays decimal).
pub fn general(x: f64) -> String {
    let x = crate::value::round_15(x);
    if x == 0.0 || !x.is_finite() {
        return "0".into();
    }
    const WIDTH: usize = 11;
    let neg = usize::from(x < 0.0);
    let a = x.abs();
    if a >= 1e-4 {
        let (int, _) = decimal_digits(a, 0);
        let int_len = int.len().max(1);
        if int_len + neg <= WIDTH {
            let room = WIDTH - neg - int_len;
            let nf = room.saturating_sub(1);
            let (mut i, mut f) = decimal_digits(a, nf);
            if i.len().max(1) + neg <= WIDTH {
                while f.ends_with('0') {
                    f.pop();
                }
                if i.is_empty() {
                    i.push('0');
                }
                if !(i == "0" && f.is_empty()) {
                    let sign = if neg == 1 { "-" } else { "" };
                    return if f.is_empty() {
                        format!("{sign}{i}")
                    } else {
                        format!("{sign}{i}.{f}")
                    };
                }
            }
        }
    }
    for nf in (0..=9).rev() {
        let s = scientific(x, nf, true, 2);
        if s.chars().count() <= WIDTH {
            return s;
        }
    }
    scientific(x, 0, true, 2)
}

/// The shortest General text of `x` that fits `width` characters
/// (fewer decimals, then scientific notation), or `None`.
pub fn general_fit(x: f64, width: usize) -> Option<String> {
    let full = general(x);
    if full.chars().count() <= width {
        return Some(full);
    }
    let x = crate::value::round_15(x);
    let a = x.abs();
    let neg = usize::from(x < 0.0);
    if a >= 1e-4 {
        let (int, _) = decimal_digits(a, 0);
        let int_len = int.len().max(1);
        if int_len + neg <= width {
            let nf = (width - neg - int_len).saturating_sub(1);
            let (mut i, mut f) = decimal_digits(a, nf);
            while f.ends_with('0') {
                f.pop();
            }
            if i.is_empty() {
                i.push('0');
            }
            if !(i == "0" && f.is_empty()) && i.len() + neg <= width {
                let sign = if neg == 1 { "-" } else { "" };
                return Some(if f.is_empty() {
                    format!("{sign}{i}")
                } else {
                    format!("{sign}{i}.{f}")
                });
            }
        }
    }
    (0..=9)
        .rev()
        .map(|nf| scientific(x, nf, true, 2))
        .find(|s| s.chars().count() <= width)
}

// --- numbers --------------------------------------------------------------------

/// Fills integer placeholders (and the literals between them) with the
/// digits of the integer part, right to left; extra digits go to the
/// leftmost placeholder. `group` inserts thousands separators.
fn fill_int(toks: &[Tok], digits: &str, group: bool) -> String {
    let ph: Vec<usize> = (0..toks.len())
        .filter(|&i| matches!(toks[i], Tok::Digit(_)))
        .collect();
    let mut parts: Vec<String> = toks.iter().map(raw).collect();
    let mut ds: Vec<char> = digits.chars().collect();
    let mut count = 0usize;
    let emit = |out: &mut String, c: char, count: &mut usize| {
        if group && *count > 0 && *count % 3 == 0 {
            out.insert(0, ',');
        }
        out.insert(0, c);
        *count += 1;
    };
    for (k, &ti) in ph.iter().enumerate().rev() {
        let Tok::Digit(kind) = toks[ti] else {
            continue;
        };
        let mut out = String::new();
        if k == 0 {
            if ds.is_empty() {
                match kind {
                    '0' => emit(&mut out, '0', &mut count),
                    '?' => out.insert(0, ' '),
                    _ => {}
                }
            }
            while let Some(d) = ds.pop() {
                emit(&mut out, d, &mut count);
            }
        } else {
            match ds.pop() {
                Some(d) => emit(&mut out, d, &mut count),
                None => match kind {
                    '0' => emit(&mut out, '0', &mut count),
                    '?' => out.insert(0, ' '),
                    _ => {}
                },
            }
        }
        parts[ti] = out;
    }
    parts.concat()
}

/// Fills fraction placeholders with `frac` (exactly one digit per
/// placeholder), dropping (`#`) or blanking (`?`) insignificant trailing
/// zeros.
fn fill_frac(toks: &[Tok], frac: &str) -> String {
    let ph: Vec<usize> = (0..toks.len())
        .filter(|&i| matches!(toks[i], Tok::Digit(_)))
        .collect();
    let mut ds: Vec<char> = frac.chars().collect();
    ds.resize(ph.len(), '0');
    let mut shown: Vec<Option<char>> = ds.iter().map(|&d| Some(d)).collect();
    for (k, &ti) in ph.iter().enumerate().rev() {
        let Tok::Digit(kind) = toks[ti] else { continue };
        if ds[k] != '0' || kind == '0' {
            break;
        }
        shown[k] = if kind == '?' { Some(' ') } else { None };
    }
    let mut out = String::new();
    let mut k = 0;
    for t in toks {
        match t {
            Tok::Digit(_) => {
                if let Some(c) = shown[k] {
                    out.push(c);
                }
                k += 1;
            }
            t => out.push_str(&raw(t)),
        }
    }
    out
}

/// Removes the scaling commas (a comma not followed by a digit
/// placeholder, after the first one) and reports grouping (a comma
/// between integer placeholders) and the scale exponent.
fn strip_commas(toks: &[Tok]) -> (Vec<Tok>, bool, i32) {
    let first = toks.iter().position(|t| matches!(t, Tok::Digit(_)));
    let point = toks.iter().position(|t| *t == Tok::Point);
    let mut out = Vec::with_capacity(toks.len());
    let (mut group, mut scale) = (false, 0);
    for (i, t) in toks.iter().enumerate() {
        if *t != Tok::Comma {
            out.push(t.clone());
            continue;
        }
        let after_first = first.is_some_and(|f| i > f);
        let next_digit = toks[i + 1..]
            .iter()
            .find(|t| **t != Tok::Comma)
            .is_some_and(|t| matches!(t, Tok::Digit(_)));
        let in_int = point.map_or(true, |p| i < p);
        if after_first && next_digit && in_int {
            group = true;
        } else if after_first && !next_digit {
            scale += 1;
        } else if !after_first {
            out.push(Tok::Lit(",".into()));
        }
    }
    (out, group, scale)
}

fn format_numeric(v: f64, toks: &[Tok]) -> String {
    let neg = v < 0.0;
    let mut a = v.abs();
    for t in toks {
        if *t == Tok::Percent {
            a *= 100.0;
        }
    }
    let (toks, group, scale) = strip_commas(toks);
    a /= 1000f64.powi(scale);
    let body = if toks.iter().any(|t| matches!(t, Tok::Exp(_))) {
        format_scientific(a, &toks)
    } else if let Some(s) = fraction_slash(&toks) {
        match format_fraction(a, &toks, s) {
            Some(text) => text,
            None => format_decimal(a, &toks, group),
        }
    } else if toks.contains(&Tok::General) {
        toks.iter()
            .map(|t| match t {
                Tok::General => general(a),
                t => raw(t),
            })
            .collect()
    } else if !toks.iter().any(|t| matches!(t, Tok::Digit(_))) {
        // Literals only (`"zero"`, `;;;`): the number is not shown.
        return toks.iter().map(raw).collect();
    } else {
        format_decimal(a, &toks, group)
    };
    let shows_digits = body.chars().any(|c| c.is_ascii_digit() && c != '0');
    if neg && (shows_digits || body.contains('0')) {
        format!("-{body}")
    } else {
        body
    }
}

fn format_decimal(a: f64, toks: &[Tok], group: bool) -> String {
    let point = toks.iter().position(|t| *t == Tok::Point);
    let (int_toks, frac_toks) = match point {
        Some(p) => (&toks[..p], &toks[p + 1..]),
        None => (toks, &toks[toks.len()..]),
    };
    let nf = frac_toks
        .iter()
        .filter(|t| matches!(t, Tok::Digit(_)))
        .count();
    let (int, frac) = decimal_digits(a, nf);
    let mut out = fill_int(int_toks, &int, group);
    if point.is_some() {
        out.push('.');
        out.push_str(&fill_frac(frac_toks, &frac));
    }
    out
}

fn format_scientific(a: f64, toks: &[Tok]) -> String {
    let e_at = toks
        .iter()
        .position(|t| matches!(t, Tok::Exp(_)))
        .expect("exponent token");
    let Tok::Exp(plus) = toks[e_at] else {
        unreachable!()
    };
    let mant = &toks[..e_at];
    let exp_toks = &toks[e_at + 1..];
    let point = mant.iter().position(|t| *t == Tok::Point);
    let (int_toks, frac_toks) = match point {
        Some(p) => (&mant[..p], &mant[p + 1..]),
        None => (mant, &mant[mant.len()..]),
    };
    let ni = int_toks
        .iter()
        .filter(|t| matches!(t, Tok::Digit(_)))
        .count()
        .max(1);
    let nf = frac_toks
        .iter()
        .filter(|t| matches!(t, Tok::Digit(_)))
        .count();
    let engineering = ni > 1 && int_toks.contains(&Tok::Digit('#'));
    let mut e: i32 = if a == 0.0 {
        0
    } else {
        a.log10().floor() as i32
    };
    if a != 0.0 && a / 10f64.powi(e) >= 10.0 {
        e += 1;
    }
    let shift = |e: i32| {
        if engineering {
            e.div_euclid(ni as i32) * ni as i32
        } else {
            e - (ni as i32 - 1)
        }
    };
    let mut ex = shift(e);
    let (mut int, mut frac) = decimal_digits(a / 10f64.powi(ex), nf);
    if int.len() > ni && a != 0.0 {
        e += 1;
        ex = shift(e);
        (int, frac) = decimal_digits(a / 10f64.powi(ex), nf);
    }
    let mut out = fill_int(int_toks, &int, false);
    if point.is_some() {
        out.push('.');
        out.push_str(&fill_frac(frac_toks, &frac));
    }
    out.push('E');
    if ex < 0 {
        out.push('-');
    } else if plus {
        out.push('+');
    }
    let digits = ex.unsigned_abs().to_string();
    out.push_str(&fill_int(exp_toks, &digits, false));
    out
}

/// The index of a fraction's `/` (placeholders on both sides).
fn fraction_slash(toks: &[Tok]) -> Option<usize> {
    let s = toks.iter().position(|t| *t == Tok::Slash)?;
    let before = toks[..s].iter().any(|t| matches!(t, Tok::Digit(_)));
    let after = toks[s + 1..].iter().any(|t| {
        matches!(t, Tok::Digit(_))
            || matches!(t, Tok::Lit(l) if l.chars().all(|c| c.is_ascii_digit()))
    });
    (before && after).then_some(s)
}

/// The best approximation `p/q` of `x` (0 ≤ x) with `q <= max_den`.
fn best_fraction(x: f64, max_den: u64) -> (u64, u64) {
    let (mut p0, mut q0, mut p1, mut q1) = (0u64, 1u64, 1u64, 0u64);
    let mut v = x;
    for _ in 0..64 {
        let a = v.floor();
        if a > 1e15 {
            break;
        }
        let a = a as u64;
        let q2 = a.saturating_mul(q1).saturating_add(q0);
        if q2 > max_den {
            // Semiconvergent.
            let k = (max_den - q0) / q1.max(1);
            let (ps, qs) = (p0 + k * p1, q0 + k * q1);
            let err = |p: u64, q: u64| (x - p as f64 / q as f64).abs();
            if q1 == 0 || (qs > 0 && err(ps, qs) < err(p1, q1)) {
                return (ps, qs.max(1));
            }
            return (p1, q1);
        }
        let p2 = a * p1 + p0;
        (p0, q0, p1, q1) = (p1, q1, p2, q2);
        let r = v - a as f64;
        if r.abs() < 1e-12 || (x - p1 as f64 / q1 as f64).abs() < 1e-15 {
            break;
        }
        v = 1.0 / r;
    }
    (p1, q1.max(1))
}

fn format_fraction(a: f64, toks: &[Tok], slash: usize) -> Option<String> {
    // Numerator: the digit run directly before `/` (a space allowed).
    let mut j = slash;
    while j > 0 && toks[j - 1] == Tok::Lit(" ".into()) {
        j -= 1;
    }
    let num_end = j;
    while j > 0 && matches!(toks[j - 1], Tok::Digit(_)) {
        j -= 1;
    }
    let num_start = j;
    let num_toks: Vec<Tok> = toks[num_start..num_end].to_vec();
    if num_toks.is_empty() {
        return None;
    }
    // Denominator: placeholders or a fixed number.
    let mut den_end = slash + 1;
    while toks.get(den_end) == Some(&Tok::Lit(" ".into())) {
        den_end += 1;
    }
    let mut den_text = String::new();
    let mut den_ph = 0usize;
    while den_end < toks.len() {
        match &toks[den_end] {
            Tok::Digit(c) => {
                den_text.push(*c);
                den_ph += 1;
            }
            Tok::Lit(l) if !l.is_empty() && l.chars().all(|c| c.is_ascii_digit()) => {
                den_text.push_str(l)
            }
            _ => break,
        }
        den_end += 1;
    }
    let fixed: Option<u64> = den_text
        .chars()
        .next()
        .filter(|c| c.is_ascii_digit() && *c != '0')
        .and_then(|_| den_text.parse().ok());
    let int_toks = &toks[..num_start];
    let has_int = int_toks.iter().any(|t| matches!(t, Tok::Digit(_)));
    let (whole, part) = if has_int {
        (a.floor(), a - a.floor())
    } else {
        (0.0, a)
    };
    let (mut num, den) = match fixed {
        Some(d) => ((part * d as f64).round() as u64, d),
        None => {
            let digits = den_ph.clamp(1, 7) as u32;
            best_fraction(part, 10u64.pow(digits) - 1)
        }
    };
    let mut whole = whole;
    if has_int && num == den && num > 0 {
        whole += 1.0;
        num = 0;
    }
    let den_width = if fixed.is_some() {
        den_text.len()
    } else {
        den_ph
    };
    let num_width = num_toks.len();
    let mut out = String::new();
    if has_int {
        let w = if whole == 0.0 {
            String::new()
        } else {
            decimal_digits(whole, 0).0
        };
        let int_part = fill_int(int_toks, &w, false);
        out.push_str(&int_part);
        if num == 0 {
            // A whole number: the fraction is blank (zero shows `0`).
            if whole == 0.0 && !int_part.chars().any(|c| c.is_ascii_digit()) {
                out = fill_int(int_toks, "0", false);
                if !out.contains('0') {
                    out.push('0');
                }
            }
            out.push_str(&" ".repeat(num_width + 1 + den_width));
            out.push_str(&toks[den_end..].iter().map(raw).collect::<String>());
            return Some(out);
        }
    }
    let n = num.to_string();
    let pad = num_width.saturating_sub(n.len());
    let num_pad: String = num_toks[..pad.min(num_toks.len())]
        .iter()
        .map(|t| match t {
            Tok::Digit('0') => '0',
            Tok::Digit('?') => ' ',
            _ => '\0',
        })
        .filter(|c| *c != '\0')
        .collect();
    out.push_str(&num_pad);
    out.push_str(&n);
    out.push('/');
    let d = den.to_string();
    out.push_str(&d);
    if fixed.is_none() {
        let extra = den_width.saturating_sub(d.len());
        out.push_str(&" ".repeat(extra));
    }
    out.push_str(&toks[den_end..].iter().map(raw).collect::<String>());
    Some(out)
}

// --- dates ----------------------------------------------------------------------

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
const MONTHS_DE: [&str; 12] = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];
const DAYS_DE: [&str; 7] = [
    "Sonntag",
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
];

fn month_name(names: Names, m: u32, len: usize) -> String {
    let i = (m - 1) as usize;
    let full = match (names, i) {
        (Names::English, _) => MONTHS[i],
        (Names::Austrian, 0) => "Jänner",
        _ => MONTHS_DE[i],
    };
    match len {
        3 => full.chars().take(3).collect(),
        4 => full.to_string(),
        _ => full.chars().take(1).collect(),
    }
}

fn day_name(names: Names, wd: usize, len: usize) -> String {
    match (names, len) {
        (Names::English, 3) => DAYS[wd][..3].to_string(),
        (Names::English, _) => DAYS[wd].to_string(),
        (_, 3) => DAYS_DE[wd].chars().take(2).collect(),
        _ => DAYS_DE[wd].to_string(),
    }
}

fn format_date(serial: f64, sec: &Section) -> Result<String, ErrorKind> {
    let toks = &sec.toks;
    // Fractional seconds shown (`ss.000`): `.` + `0`s right after seconds.
    let mut sub: Vec<Option<usize>> = vec![None; toks.len()];
    let mut skip = vec![false; toks.len()];
    let mut precision = 0usize;
    for i in 0..toks.len() {
        let after_s = i > 0 && matches!(toks[i - 1], Tok::Date('s', _) | Tok::Elapsed('s', _));
        if after_s && toks[i] == Tok::Point {
            let n = toks[i + 1..]
                .iter()
                .take_while(|t| **t == Tok::Digit('0'))
                .count();
            if n > 0 {
                let n = n.min(3);
                sub[i] = Some(n);
                for s in skip.iter_mut().skip(i + 1).take(n) {
                    *s = true;
                }
                precision = precision.max(n);
            }
        }
    }
    let scale = 86_400.0 * 10f64.powi(precision as i32);
    if !serial.is_finite() || serial > 2_958_465.999_999 {
        return Err(ErrorKind::Value);
    }
    let units = (serial * scale).round();
    let per_sec = 10f64.powi(precision as i32) as i64;
    let total = units as i64;
    let total_secs = total.div_euclid(per_sec);
    let fraction = total.rem_euclid(per_sec);
    let day = total_secs.div_euclid(86_400);
    let secs = total_secs.rem_euclid(86_400);
    let (y, m, d) = serial_to_ymd(day as f64).ok_or(ErrorKind::Value)?;
    let (hh, mi, ss) = (secs / 3600, secs / 60 % 60, secs % 60);
    let weekday = ((day + 6) % 7) as usize;
    let twelve = toks.iter().any(|t| matches!(t, Tok::AmPm(_)));
    let pad = |v: i64, n: usize| format!("{v:0n$}");
    let is_time = |t: &Tok| matches!(t, Tok::Date(..) | Tok::Elapsed(..));
    let unit = |t: &Tok| match t {
        Tok::Date(c, _) | Tok::Elapsed(c, _) => Some(*c),
        _ => None,
    };
    let date_toks: Vec<usize> = (0..toks.len()).filter(|&i| is_time(&toks[i])).collect();
    // The smallest elapsed unit: smaller units after it are within it.
    let mut out = String::new();
    for (i, t) in toks.iter().enumerate() {
        if skip[i] {
            continue;
        }
        if let Some(n) = sub[i] {
            let digits = format!("{:0w$}", fraction, w = precision);
            out.push('.');
            out.push_str(&digits[..n]);
            continue;
        }
        match t {
            Tok::AmPm(marker) => {
                let pm = hh >= 12;
                let upper = marker.starts_with(['A', 'P']);
                let text = match (marker.chars().count() > 3, pm) {
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
            }
            Tok::Elapsed(c, n) => {
                let v = match c {
                    'h' => total_secs / 3600,
                    'm' => total_secs / 60,
                    _ => total_secs,
                };
                out.push_str(&pad(v, (*n).min(2)));
            }
            Tok::Date(c, n) => {
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
                        let prev_h =
                            pos > 0 && matches!(unit(&toks[date_toks[pos - 1]]), Some('h'));
                        let next_s = date_toks
                            .get(pos + 1)
                            .is_some_and(|&k| unit(&toks[k]) == Some('s'));
                        if n <= 2 && (prev_h || next_s) {
                            out.push_str(&pad(mi, n));
                        } else {
                            match n {
                                1 => out.push_str(&m.to_string()),
                                2 => out.push_str(&format!("{m:02}")),
                                3 | 4 => out.push_str(&month_name(sec.names, m, n)),
                                _ => out.push_str(&month_name(sec.names, m, 5)),
                            }
                        }
                    }
                    'd' => match n {
                        1 => out.push_str(&d.to_string()),
                        2 => out.push_str(&format!("{d:02}")),
                        3 => out.push_str(&day_name(sec.names, weekday, 3)),
                        _ => out.push_str(&day_name(sec.names, weekday, 4)),
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
                        out.push_str(&pad(h, n.min(2)));
                    }
                    _ => out.push_str(&pad(ss, n.min(2))),
                }
            }
            Tok::General => out.push_str(&general(serial)),
            t => out.push_str(&raw(t)),
        }
    }
    Ok(out)
}

/// Whether `code` formats numbers as a date or time (some section holds
/// date/time tokens outside literals and brackets other than elapsed
/// time).
pub fn is_date_code(code: &str) -> bool {
    !is_general(code) && parse(code).numbers.iter().any(|s| s.kind() == Kind::Date)
}
