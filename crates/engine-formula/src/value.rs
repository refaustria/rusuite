//! Runtime values of the formula evaluator and the Excel coercion rules.

use std::cmp::Ordering;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::ast::ErrorKind;

/// A formula value.
///
/// `Number` is always finite: operations that would produce NaN or an
/// infinity yield `Error(ErrorKind::Num)` instead (see [`Value::number`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Value {
    /// Blank cell or omitted argument.
    Empty,
    Number(f64),
    Text(String),
    Bool(bool),
    Error(ErrorKind),
    Array(Array),
}

impl Value {
    /// `Number(n)` if `n` is finite, else `Error(Num)`.
    pub fn number(n: f64) -> Value {
        if n.is_finite() {
            Value::Number(n)
        } else {
            Value::Error(ErrorKind::Num)
        }
    }

    /// Converts a coercion result into a value (`Err(e)` → `Error(e)`).
    pub fn from_result<T: Into<Value>>(r: Result<T, ErrorKind>) -> Value {
        match r {
            Ok(v) => v.into(),
            Err(e) => Value::Error(e),
        }
    }

    /// The error kind if this is an error value.
    pub fn as_error(&self) -> Option<ErrorKind> {
        match self {
            Value::Error(e) => Some(*e),
            _ => None,
        }
    }

    pub fn is_error(&self) -> bool {
        matches!(self, Value::Error(_))
    }

    /// Reduces an array to its top-left element (zero-size → `#VALUE!`);
    /// every other value is returned unchanged.
    pub fn into_scalar(self) -> Value {
        match self {
            Value::Array(a) => a.top_left(),
            v => v,
        }
    }
}

impl From<f64> for Value {
    fn from(n: f64) -> Self {
        Value::number(n)
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}

impl From<String> for Value {
    fn from(s: String) -> Self {
        Value::Text(s)
    }
}

impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::Text(s.to_string())
    }
}

impl From<ErrorKind> for Value {
    fn from(e: ErrorKind) -> Self {
        Value::Error(e)
    }
}

impl fmt::Display for Value {
    /// Display text as Excel would show it in a General-formatted cell
    /// (arrays show their top-left element).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Empty => Ok(()),
            Value::Number(n) => f.write_str(&format_general(*n)),
            Value::Text(s) => f.write_str(s),
            Value::Bool(true) => f.write_str("TRUE"),
            Value::Bool(false) => f.write_str("FALSE"),
            Value::Error(e) => write!(f, "{e}"),
            Value::Array(a) => write!(f, "{}", a.clone().top_left()),
        }
    }
}

/// A rectangular array of scalar values (row-major, never nested).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Array {
    rows: usize,
    cols: usize,
    data: Vec<Value>,
}

impl Array {
    /// Builds an array from row-major data. Returns `None` if
    /// `data.len() != rows * cols`. Nested arrays are flattened to their
    /// top-left element.
    pub fn new(rows: usize, cols: usize, data: Vec<Value>) -> Option<Array> {
        if rows.checked_mul(cols)? != data.len() {
            return None;
        }
        let data = data.into_iter().map(Value::into_scalar).collect();
        Some(Array { rows, cols, data })
    }

    /// Builds an array from rows; `None` if the rows have different lengths.
    pub fn from_rows(rows: Vec<Vec<Value>>) -> Option<Array> {
        let r = rows.len();
        let c = rows.first().map_or(0, Vec::len);
        if rows.iter().any(|row| row.len() != c) {
            return None;
        }
        Array::new(r, c, rows.into_iter().flatten().collect())
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    pub fn cols(&self) -> usize {
        self.cols
    }

    /// Element at 0-based `(row, col)`.
    pub fn get(&self, row: usize, col: usize) -> Option<&Value> {
        if row < self.rows && col < self.cols {
            self.data.get(row * self.cols + col)
        } else {
            None
        }
    }

    /// Row-major elements.
    pub fn values(&self) -> &[Value] {
        &self.data
    }

    /// Applies `f` to every element, keeping the shape (results are
    /// flattened to scalars like in [`Array::new`]).
    pub fn map(self, f: impl FnMut(Value) -> Value) -> Array {
        Array {
            rows: self.rows,
            cols: self.cols,
            data: self
                .data
                .into_iter()
                .map(f)
                .map(Value::into_scalar)
                .collect(),
        }
    }

    /// The top-left element, or `#VALUE!` for a zero-size array.
    pub fn top_left(self) -> Value {
        self.data
            .into_iter()
            .next()
            .unwrap_or(Value::Error(ErrorKind::Value))
    }
}

/// Number coercion: Number → itself, Bool → 1/0, Empty → 0, Text → parsed
/// numeric text (see [`parse_number_text`]) or `#VALUE!`. Arrays use their
/// top-left element.
pub fn to_number(v: &Value) -> Result<f64, ErrorKind> {
    match v {
        Value::Number(n) => Ok(*n),
        Value::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        Value::Empty => Ok(0.0),
        Value::Text(s) => parse_number_text(s).ok_or(ErrorKind::Value),
        Value::Error(e) => Err(*e),
        Value::Array(a) => to_number(&a.clone().top_left()),
    }
}

/// Text coercion: Text → itself, Bool → `TRUE`/`FALSE`, Empty → `""`,
/// Number → [`format_general`].
pub fn to_text(v: &Value) -> Result<String, ErrorKind> {
    match v {
        Value::Text(s) => Ok(s.clone()),
        Value::Bool(true) => Ok("TRUE".to_string()),
        Value::Bool(false) => Ok("FALSE".to_string()),
        Value::Empty => Ok(String::new()),
        Value::Number(n) => Ok(format_general(*n)),
        Value::Error(e) => Err(*e),
        Value::Array(a) => to_text(&a.clone().top_left()),
    }
}

/// Boolean coercion: Bool → itself, Number → `!= 0`, Empty → false,
/// Text → case-insensitive `TRUE`/`FALSE`, else `#VALUE!`.
pub fn to_bool(v: &Value) -> Result<bool, ErrorKind> {
    match v {
        Value::Bool(b) => Ok(*b),
        Value::Number(n) => Ok(*n != 0.0),
        Value::Empty => Ok(false),
        Value::Text(s) => {
            if s.eq_ignore_ascii_case("TRUE") {
                Ok(true)
            } else if s.eq_ignore_ascii_case("FALSE") {
                Ok(false)
            } else {
                Err(ErrorKind::Value)
            }
        }
        Value::Error(e) => Err(*e),
        Value::Array(a) => to_bool(&a.clone().top_left()),
    }
}

/// Parses numeric text the way Excel's implicit conversion does (en-US):
/// surrounding ASCII whitespace is ignored; accepted is an optional sign,
/// an optional `$`, digits with optional `,` thousands separators (groups
/// of exactly three digits), an optional fraction (`.5` and `5.` are
/// valid), an optional exponent `e[+-]digits` and an optional trailing `%`.
/// Returns `None` for anything else, including empty text and non-finite
/// results.
pub fn parse_number_text(s: &str) -> Option<f64> {
    let s = s.trim_matches(|c: char| c.is_ascii_whitespace());
    let (s, percent) = match s.strip_suffix('%') {
        Some(rest) => (rest, true),
        None => (s, false),
    };
    let b = s.as_bytes();
    let mut i = 0;
    let mut out = String::with_capacity(s.len());
    if let Some(&c @ (b'+' | b'-')) = b.first() {
        if c == b'-' {
            out.push('-');
        }
        i += 1;
    }
    if b.get(i) == Some(&b'$') {
        i += 1;
    }
    // Integer part with optional thousands separators.
    let mut group = 0usize;
    let mut saw_comma = false;
    while i < b.len() {
        match b[i] {
            d @ b'0'..=b'9' => {
                out.push(char::from(d));
                group += 1;
            }
            b',' => {
                if group == 0 || (saw_comma && group != 3) {
                    return None;
                }
                saw_comma = true;
                group = 0;
            }
            _ => break,
        }
        i += 1;
    }
    if saw_comma && group != 3 {
        return None;
    }
    let int_digits = out.bytes().filter(u8::is_ascii_digit).count();
    let mut frac_digits = 0;
    if b.get(i) == Some(&b'.') {
        out.push('.');
        i += 1;
        while let Some(&d @ b'0'..=b'9') = b.get(i) {
            out.push(char::from(d));
            frac_digits += 1;
            i += 1;
        }
    }
    if int_digits + frac_digits == 0 {
        return None;
    }
    if let Some(b'e' | b'E') = b.get(i) {
        out.push('e');
        i += 1;
        if let Some(&c @ (b'+' | b'-')) = b.get(i) {
            out.push(char::from(c));
            i += 1;
        }
        let exp_start = i;
        while let Some(&d @ b'0'..=b'9') = b.get(i) {
            out.push(char::from(d));
            i += 1;
        }
        if i == exp_start {
            return None;
        }
    }
    if i != b.len() {
        return None;
    }
    if out.ends_with('.') {
        out.push('0');
    }
    let mut n: f64 = out.parse().ok()?;
    if percent {
        n /= 100.0;
    }
    n.is_finite().then_some(n)
}

/// Rounds `x` to 15 significant decimal digits (Excel's display precision).
pub fn round_15(x: f64) -> f64 {
    if x == 0.0 || !x.is_finite() {
        return x;
    }
    format!("{x:.14e}").parse().unwrap_or(x)
}

/// Formats a number like Excel's "General" format does for `&` and
/// `TEXT(x,"@")`: rounded to 15 significant digits; integers below 1e15
/// as plain digits; magnitudes `>= 1e15` or `< 1e-9` (non-zero) in
/// scientific form `d.dddE+XX`; otherwise plain decimal without trailing
/// zeros.
pub fn format_general(x: f64) -> String {
    let x = round_15(x);
    if x == 0.0 {
        return "0".to_string();
    }
    let a = x.abs();
    if a >= 1e15 || a < 1e-9 {
        // `{:e}` gives the shortest round-tripping mantissa, which has at
        // most 15 digits after rounding and no trailing zeros.
        let s = format!("{x:e}");
        let (mantissa, exp) = s.split_once('e').expect("exponent form");
        let (sign, digits) = match exp.strip_prefix('-') {
            Some(d) => ('-', d),
            None => ('+', exp),
        };
        format!("{mantissa}E{sign}{digits:0>2}")
    } else {
        // Display of f64 never uses exponent notation and prints integers
        // without a fractional part.
        format!("{x}")
    }
}

/// Excel comparison of two dereferenced scalar values (arrays use their
/// top-left element). Type ranking Number < Text < Bool; `Empty` adopts
/// the other side's type; texts compare case-insensitively (Unicode
/// uppercase, by scalar value – Excel uses locale collation); numbers are
/// compared after rounding to 15 significant digits. Errors propagate,
/// left first.
pub fn compare(a: &Value, b: &Value) -> Result<Ordering, ErrorKind> {
    let a = a.clone().into_scalar();
    let b = b.clone().into_scalar();
    if let Value::Error(e) = a {
        return Err(e);
    }
    if let Value::Error(e) = b {
        return Err(e);
    }
    let (a, b) = match (a, b) {
        (Value::Empty, Value::Empty) => return Ok(Ordering::Equal),
        (Value::Empty, other) => (empty_like(&other), other),
        (other, Value::Empty) => {
            let e = empty_like(&other);
            (other, e)
        }
        pair => pair,
    };
    Ok(match (&a, &b) {
        (Value::Number(x), Value::Number(y)) => compare_numbers(*x, *y),
        (Value::Text(x), Value::Text(y)) => x.to_uppercase().cmp(&y.to_uppercase()),
        (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
        _ => rank(&a).cmp(&rank(&b)),
    })
}

fn compare_numbers(x: f64, y: f64) -> Ordering {
    if x == y {
        return Ordering::Equal;
    }
    round_15(x)
        .partial_cmp(&round_15(y))
        .unwrap_or(Ordering::Equal)
}

fn empty_like(v: &Value) -> Value {
    match v {
        Value::Text(_) => Value::Text(String::new()),
        Value::Bool(_) => Value::Bool(false),
        _ => Value::Number(0.0),
    }
}

fn rank(v: &Value) -> u8 {
    match v {
        Value::Text(_) => 1,
        Value::Bool(_) => 2,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> Value {
        Value::Text(s.to_string())
    }

    #[test]
    fn to_number_rules() {
        assert_eq!(to_number(&Value::Number(2.5)), Ok(2.5));
        assert_eq!(to_number(&Value::Bool(true)), Ok(1.0));
        assert_eq!(to_number(&Value::Bool(false)), Ok(0.0));
        assert_eq!(to_number(&Value::Empty), Ok(0.0));
        assert_eq!(to_number(&Value::Error(ErrorKind::NA)), Err(ErrorKind::NA));
        for (s, n) in [
            ("3", 3.0),
            (" 3 ", 3.0),
            ("\t-3.5\n", -3.5),
            ("+4", 4.0),
            ("1e2", 100.0),
            ("1E+2", 100.0),
            ("2.5e-1", 0.25),
            (".5", 0.5),
            ("5.", 5.0),
            ("50%", 0.5),
            ("1,000", 1000.0),
            ("1,234,567.5", 1_234_567.5),
            ("$5", 5.0),
            ("-$1,000", -1000.0),
            ("0", 0.0),
        ] {
            assert_eq!(to_number(&t(s)), Ok(n), "{s:?}");
        }
        for s in [
            "", "   ", "TRUE", "FALSE", "abc", "0x10", "1,00", ",100", "1,0000", ".", "1e", "e5",
            "1.2.3", "--1", "1e999", "%", "$", "1 000",
        ] {
            assert_eq!(to_number(&t(s)), Err(ErrorKind::Value), "{s:?}");
        }
    }

    #[test]
    fn to_text_rules() {
        assert_eq!(to_text(&t("x")), Ok("x".into()));
        assert_eq!(to_text(&Value::Bool(true)), Ok("TRUE".into()));
        assert_eq!(to_text(&Value::Bool(false)), Ok("FALSE".into()));
        assert_eq!(to_text(&Value::Empty), Ok(String::new()));
        assert_eq!(to_text(&Value::Number(2.5)), Ok("2.5".into()));
        assert_eq!(to_text(&Value::Error(ErrorKind::Ref)), Err(ErrorKind::Ref));
    }

    #[test]
    fn to_bool_rules() {
        assert_eq!(to_bool(&Value::Bool(true)), Ok(true));
        assert_eq!(to_bool(&Value::Number(0.0)), Ok(false));
        assert_eq!(to_bool(&Value::Number(-0.1)), Ok(true));
        assert_eq!(to_bool(&Value::Empty), Ok(false));
        assert_eq!(to_bool(&t("true")), Ok(true));
        assert_eq!(to_bool(&t("FaLsE")), Ok(false));
        assert_eq!(to_bool(&t("yes")), Err(ErrorKind::Value));
        assert_eq!(to_bool(&t("1")), Err(ErrorKind::Value));
        assert_eq!(
            to_bool(&Value::Error(ErrorKind::Div0)),
            Err(ErrorKind::Div0)
        );
    }

    #[test]
    fn format_general_reference() {
        for (x, s) in [
            (0.1 + 0.2, "0.3"),
            (1.0 / 3.0, "0.333333333333333"),
            (1e15, "1E+15"),
            (123_456_789_012_345.0, "123456789012345"),
            (1_234_567_890_123_456.0, "1.23456789012346E+15"),
            (0.000001, "0.000001"),
            (1e-10, "1E-10"),
            (-2.5, "-2.5"),
            (100.0, "100"),
            (2.50, "2.5"),
            (1e20, "1E+20"),
            (1.5e-10, "1.5E-10"),
            (-0.0, "0"),
            (0.0, "0"),
            (-1e100, "-1E+100"),
            (10.5, "10.5"),
            (45306.0, "45306"),
        ] {
            assert_eq!(format_general(x), s, "{x:e}");
        }
    }

    #[test]
    fn array_shape() {
        assert!(Array::new(2, 2, vec![Value::Empty; 3]).is_none());
        let a = Array::from_rows(vec![
            vec![1.0.into(), 2.0.into()],
            vec![3.0.into(), 4.0.into()],
        ])
        .unwrap();
        assert_eq!((a.rows(), a.cols()), (2, 2));
        assert_eq!(a.get(1, 0), Some(&Value::Number(3.0)));
        assert_eq!(a.get(2, 0), None);
        assert_eq!(a.top_left(), Value::Number(1.0));
        assert_eq!(
            Array::new(0, 0, vec![]).unwrap().top_left(),
            Value::Error(ErrorKind::Value)
        );
        assert!(Array::from_rows(vec![vec![Value::Empty], vec![]]).is_none());
    }

    #[test]
    fn number_constructor_rejects_non_finite() {
        assert_eq!(Value::number(f64::NAN), Value::Error(ErrorKind::Num));
        assert_eq!(Value::number(f64::INFINITY), Value::Error(ErrorKind::Num));
        assert_eq!(Value::number(1.0), Value::Number(1.0));
    }
}
