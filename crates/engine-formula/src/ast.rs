//! Typed abstract syntax tree for Excel (en-US) formulas, plus the canonical
//! printer (`Display`) and A1 reference helpers.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::parser::ParseError;

/// Largest valid 0-based column index (`XFD`).
pub const MAX_COL: u32 = 16_383;
/// Largest valid 0-based row index (row 1048576).
pub const MAX_ROW: u32 = 1_048_575;

/// A parsed formula expression.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    /// Error literal such as `#DIV/0!`.
    Error(ErrorKind),
    Reference(Reference),
    /// A defined name (or an unknown identifier, which evaluates to
    /// `#NAME?`), as written.
    Name(String),
    /// A sheet-qualified name `Sheet1!Tax` (the sheet's own name first,
    /// then the workbook's).
    QualifiedName {
        sheet: String,
        name: String,
    },
    /// A structured reference to an Excel table (`Table1[Sales]`,
    /// `[@Qty]`); see [`crate::structured`].
    Structured(crate::structured::StructRef),
    /// Array constant `{1,2;3,4}`: rows of constants (Number/Text/Bool/Error).
    Array(Vec<Vec<Expr>>),
    /// Function call; `name` is stored uppercase.
    Call {
        name: String,
        args: Vec<Expr>,
    },
    /// Omitted argument, e.g. the second argument of `IF(A1,,"x")`.
    Missing,
    Unary {
        op: UnaryOp,
        expr: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UnaryOp {
    /// Prefix `-`.
    Neg,
    /// Prefix `+`.
    Plus,
    /// Postfix `%`.
    Percent,
    /// Prefix `@`: implicit intersection (forces a range or array to one
    /// value, as legacy Excel did for every formula).
    ImplicitIntersection,
    /// Postfix `#` after a cell reference (`A1#`): the range the formula in
    /// that cell spills into.
    SpillRange,
}

impl UnaryOp {
    /// True for the arithmetic operators (`-`, `+`, `%`), which apply
    /// element-wise to arrays.
    pub fn is_arithmetic(self) -> bool {
        matches!(self, UnaryOp::Neg | UnaryOp::Plus | UnaryOp::Percent)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Concat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    /// Reference operator `:` between operands that are not both plain
    /// references, e.g. `A1:INDEX(B1:B9,3)`.
    Range,
    /// Intersection operator (a space): `A1:B5 B3:C7` is `B3:B5`; an empty
    /// intersection is `#NULL!`.
    Intersect,
    /// Union operator `,` inside parentheses: `(A1:A3,C1)` is a reference
    /// of several areas (accepted by `SUM`, `COUNT`, `AREAS`, ...). Always
    /// printed in parentheses.
    Union,
}

impl BinaryOp {
    /// Excel source text of the operator.
    pub fn symbol(self) -> &'static str {
        match self {
            BinaryOp::Add => "+",
            BinaryOp::Sub => "-",
            BinaryOp::Mul => "*",
            BinaryOp::Div => "/",
            BinaryOp::Pow => "^",
            BinaryOp::Concat => "&",
            BinaryOp::Eq => "=",
            BinaryOp::Ne => "<>",
            BinaryOp::Lt => "<",
            BinaryOp::Le => "<=",
            BinaryOp::Gt => ">",
            BinaryOp::Ge => ">=",
            BinaryOp::Range => ":",
            BinaryOp::Intersect => " ",
            BinaryOp::Union => ",",
        }
    }

    /// True for the reference operators (`:`, space, `,`), which combine
    /// references instead of values.
    pub fn is_reference_op(self) -> bool {
        matches!(
            self,
            BinaryOp::Range | BinaryOp::Intersect | BinaryOp::Union
        )
    }

    /// Printing precedence (higher binds tighter). All binary operators are
    /// left-associative in Excel, including `^`.
    pub(crate) fn precedence(self) -> u8 {
        match self {
            BinaryOp::Eq
            | BinaryOp::Ne
            | BinaryOp::Lt
            | BinaryOp::Le
            | BinaryOp::Gt
            | BinaryOp::Ge => PREC_CMP,
            BinaryOp::Concat => PREC_CONCAT,
            BinaryOp::Add | BinaryOp::Sub => PREC_ADD,
            BinaryOp::Mul | BinaryOp::Div => PREC_MUL,
            BinaryOp::Pow => PREC_POW,
            BinaryOp::Intersect => PREC_ISECT,
            BinaryOp::Range => PREC_RANGE,
            // Printed in its own parentheses.
            BinaryOp::Union => PREC_ATOM,
        }
    }
}

const PREC_CMP: u8 = 1;
const PREC_CONCAT: u8 = 2;
const PREC_ADD: u8 = 3;
const PREC_MUL: u8 = 4;
const PREC_POW: u8 = 5;
const PREC_PREFIX: u8 = 6;
const PREC_PERCENT: u8 = 7;
const PREC_AT: u8 = 8;
const PREC_ISECT: u8 = 9;
const PREC_RANGE: u8 = 10;
const PREC_SPILL: u8 = 11;
const PREC_ATOM: u8 = 12;

/// Excel error values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorKind {
    Null,
    Div0,
    Value,
    Ref,
    Name,
    Num,
    NA,
    /// `#SPILL!`: an array result cannot spill (the target range is not
    /// empty or leaves the sheet).
    Spill,
    /// `#CALC!`: a calculation the engine cannot represent, such as an
    /// empty array (`FILTER` without matches).
    Calc,
}

impl ErrorKind {
    pub const ALL: [ErrorKind; 9] = [
        ErrorKind::Null,
        ErrorKind::Div0,
        ErrorKind::Value,
        ErrorKind::Ref,
        ErrorKind::Name,
        ErrorKind::Num,
        ErrorKind::NA,
        ErrorKind::Spill,
        ErrorKind::Calc,
    ];

    /// Excel text of the error, e.g. `#DIV/0!`.
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorKind::Null => "#NULL!",
            ErrorKind::Div0 => "#DIV/0!",
            ErrorKind::Value => "#VALUE!",
            ErrorKind::Ref => "#REF!",
            ErrorKind::Name => "#NAME?",
            ErrorKind::Num => "#NUM!",
            ErrorKind::NA => "#N/A",
            ErrorKind::Spill => "#SPILL!",
            ErrorKind::Calc => "#CALC!",
        }
    }
}

impl fmt::Display for ErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ErrorKind {
    type Err = ParseError;

    /// Parses the Excel error text (ASCII case-insensitive).
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        ErrorKind::ALL
            .into_iter()
            .find(|k| k.as_str().eq_ignore_ascii_case(s))
            .ok_or_else(|| ParseError::new(0, format!("unknown error literal `{s}`")))
    }
}

/// A single cell reference with 0-based coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellRef {
    pub col: u32,
    pub row: u32,
    pub col_abs: bool,
    pub row_abs: bool,
}

impl CellRef {
    /// Relative reference to `(col, row)` (0-based).
    pub fn new(col: u32, row: u32) -> Self {
        CellRef {
            col,
            row,
            col_abs: false,
            row_abs: false,
        }
    }

    /// Parses an A1 reference such as `B7`, `$A$1`, `a$3` (case-insensitive).
    /// Out-of-range columns/rows are errors.
    pub fn parse(s: &str) -> Result<CellRef, ParseError> {
        let bytes = s.as_bytes();
        let mut i = 0;
        let col_abs = bytes.first() == Some(&b'$');
        if col_abs {
            i += 1;
        }
        let letters_start = i;
        while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
            i += 1;
        }
        let letters = &s[letters_start..i];
        let row_abs = bytes.get(i) == Some(&b'$');
        if row_abs {
            i += 1;
        }
        let digits = &s[i..];
        if letters.is_empty() || digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Err(ParseError::new(0, format!("invalid cell reference `{s}`")));
        }
        let col = letters_to_col(letters)
            .filter(|&c| c <= MAX_COL)
            .ok_or_else(|| ParseError::new(0, format!("column out of range in `{s}`")))?;
        let row = parse_row(digits)
            .ok_or_else(|| ParseError::new(0, format!("row out of range in `{s}`")))?;
        Ok(CellRef {
            col,
            row,
            col_abs,
            row_abs,
        })
    }

    /// A1 text including `$` markers, e.g. `$A$1`.
    pub fn to_a1(&self) -> String {
        format!(
            "{}{}{}{}",
            if self.col_abs { "$" } else { "" },
            col_to_letters(self.col),
            if self.row_abs { "$" } else { "" },
            self.row + 1
        )
    }
}

impl fmt::Display for CellRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_a1())
    }
}

/// Parses a 1-based decimal row number into a 0-based row index.
pub(crate) fn parse_row(digits: &str) -> Option<u32> {
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u64 = digits.parse().ok()?;
    if n == 0 || n > u64::from(MAX_ROW) + 1 {
        return None;
    }
    Some((n - 1) as u32)
}

/// The shape of a reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RangeKind {
    Cell(CellRef),
    /// Rectangular area, normalized to (top-left, bottom-right).
    Area(CellRef, CellRef),
    /// Whole columns `A:C` (0-based, `start <= end`), each end with its
    /// own `$` flag (`$A:C`).
    Cols {
        start: u32,
        end: u32,
        start_abs: bool,
        end_abs: bool,
    },
    /// Whole rows `2:4` (0-based, `start <= end`), each end with its own
    /// `$` flag (`2:$4`).
    Rows {
        start: u32,
        end: u32,
        start_abs: bool,
        end_abs: bool,
    },
}

impl RangeKind {
    /// Whole columns `a:b` (0-based), normalized so that `start <= end`
    /// (each end keeping its own `$` flag).
    pub fn cols(a: u32, a_abs: bool, b: u32, b_abs: bool) -> RangeKind {
        let ((start, start_abs), (end, end_abs)) = if a <= b {
            ((a, a_abs), (b, b_abs))
        } else {
            ((b, b_abs), (a, a_abs))
        };
        RangeKind::Cols {
            start,
            end,
            start_abs,
            end_abs,
        }
    }

    /// Whole rows `a:b` (0-based), normalized like [`RangeKind::cols`].
    pub fn rows(a: u32, a_abs: bool, b: u32, b_abs: bool) -> RangeKind {
        let ((start, start_abs), (end, end_abs)) = if a <= b {
            ((a, a_abs), (b, b_abs))
        } else {
            ((b, b_abs), (a, a_abs))
        };
        RangeKind::Rows {
            start,
            end,
            start_abs,
            end_abs,
        }
    }

    /// Builds a normalized area: the top-left corner takes the smaller
    /// column/row (each keeping its own `$` flag).
    pub fn area(a: CellRef, b: CellRef) -> RangeKind {
        let (c1, c2) = if a.col <= b.col {
            ((a.col, a.col_abs), (b.col, b.col_abs))
        } else {
            ((b.col, b.col_abs), (a.col, a.col_abs))
        };
        let (r1, r2) = if a.row <= b.row {
            ((a.row, a.row_abs), (b.row, b.row_abs))
        } else {
            ((b.row, b.row_abs), (a.row, a.row_abs))
        };
        RangeKind::Area(
            CellRef {
                col: c1.0,
                col_abs: c1.1,
                row: r1.0,
                row_abs: r1.1,
            },
            CellRef {
                col: c2.0,
                col_abs: c2.1,
                row: r2.0,
                row_abs: r2.1,
            },
        )
    }
}

impl fmt::Display for RangeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let d = |abs: bool| if abs { "$" } else { "" };
        match *self {
            RangeKind::Cell(c) => write!(f, "{c}"),
            RangeKind::Area(a, b) => write!(f, "{a}:{b}"),
            RangeKind::Cols {
                start,
                end,
                start_abs,
                end_abs,
            } => write!(
                f,
                "{}{}:{}{}",
                d(start_abs),
                col_to_letters(start),
                d(end_abs),
                col_to_letters(end)
            ),
            RangeKind::Rows {
                start,
                end,
                start_abs,
                end_abs,
            } => {
                write!(f, "{}{}:{}{}", d(start_abs), start + 1, d(end_abs), end + 1)
            }
        }
    }
}

/// A reference with an optional sheet prefix.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Reference {
    /// The sheet prefix (`Sheet2!A1`); the first sheet of a 3-D reference.
    pub sheet: Option<String>,
    /// The last sheet of a 3-D reference `Sheet1:Sheet3!A1` (the sheets
    /// from `sheet` to this one in workbook order); `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_last: Option<String>,
    pub kind: RangeKind,
}

impl Reference {
    /// A reference without a sheet prefix.
    pub fn local(kind: RangeKind) -> Self {
        Reference {
            sheet: None,
            sheet_last: None,
            kind,
        }
    }

    /// A reference to one sheet (`sheet: None` = the formula's own).
    pub fn on(sheet: Option<String>, kind: RangeKind) -> Self {
        Reference {
            sheet,
            sheet_last: None,
            kind,
        }
    }

    /// True for a 3-D reference spanning several sheets.
    pub fn is_3d(&self) -> bool {
        self.sheet_last.is_some()
    }
}

/// Writes `Sheet!` (quoted as `'My Sheet'!` when needed).
fn write_sheet_prefix(f: &mut fmt::Formatter<'_>, sheet: &str) -> fmt::Result {
    if sheet_needs_quotes(sheet) {
        write!(f, "'{}'!", sheet.replace('\'', "''"))
    } else {
        write!(f, "{sheet}!")
    }
}

/// Writes the prefix of a reference: `Sheet!`, `Sheet1:Sheet3!` or
/// `'Sheet 1:Sheet 3'!` for a 3-D reference.
fn write_ref_prefix(f: &mut fmt::Formatter<'_>, r: &Reference) -> fmt::Result {
    match (&r.sheet, &r.sheet_last) {
        (Some(first), Some(last)) => {
            if sheet_needs_quotes(first) || sheet_needs_quotes(last) {
                write!(
                    f,
                    "'{}:{}'!",
                    first.replace('\'', "''"),
                    last.replace('\'', "''")
                )
            } else {
                write!(f, "{first}:{last}!")
            }
        }
        (Some(sheet), None) => write_sheet_prefix(f, sheet),
        _ => Ok(()),
    }
}

impl fmt::Display for Reference {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_ref_prefix(f, self)?;
        write!(f, "{}", self.kind)
    }
}

/// True if a sheet name must be written as `'...'`: it is not of the form
/// `[A-Za-z_][A-Za-z0-9_.]*`, or it would read as a cell reference (A1 or
/// R1C1 style).
pub fn sheet_needs_quotes(name: &str) -> bool {
    let mut chars = name.chars();
    let plain = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    !plain || looks_like_a1(name) || looks_like_r1c1(name)
}

fn looks_like_a1(s: &str) -> bool {
    let letters = s.bytes().take_while(u8::is_ascii_alphabetic).count();
    let rest = &s[letters..];
    (1..=3).contains(&letters) && !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())
}

fn looks_like_r1c1(s: &str) -> bool {
    let u = s.to_ascii_uppercase();
    let Some(rest) = u.strip_prefix('R') else {
        return false;
    };
    let rest = rest.trim_start_matches(|c: char| c.is_ascii_digit());
    match rest.strip_prefix('C') {
        Some(tail) => tail.bytes().all(|b| b.is_ascii_digit()),
        None => rest.is_empty(),
    }
}

/// Whether `s` is a valid defined name (Excel's rules): 1–255
/// characters; starts with a letter, `_` or a backslash; then letters,
/// digits, `_`, `.`, backslashes and `?`; not a cell reference (`A1`, `$B$2`, `XFD1`),
/// not R1C1-style (`R`, `C`, `R1C1`, `RC2`) and not `TRUE`/`FALSE`.
/// Uniqueness is the engine's concern (case-insensitive per scope).
pub fn is_valid_name(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if s.chars().count() > 255 || !(first.is_alphabetic() || first == '_' || first == '\\') {
        return false;
    }
    if !chars.all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '\\' | '?')) {
        return false;
    }
    let upper = s.to_ascii_uppercase();
    if upper == "TRUE" || upper == "FALSE" {
        return false;
    }
    let cell = CellRef::parse(s).is_ok();
    let r1c1 = upper == "C" || upper == "R" || looks_like_r1c1(s) || {
        // `C1`, `C12`: a column in R1C1 style.
        upper
            .strip_prefix('C')
            .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
    };
    !cell && !r1c1
}

/// Converts a 0-based column index to letters: 0 → `A`, 25 → `Z`, 26 → `AA`.
pub fn col_to_letters(col: u32) -> String {
    let mut n = u64::from(col) + 1;
    let mut out = Vec::new();
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        out.push(b'A' + rem);
        n = (n - 1) / 26;
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII letters")
}

/// Converts column letters (case-insensitive) to a 0-based index. Returns
/// `None` for empty input, non-letters, or overflow. Does not apply the
/// `XFD` limit; compare with [`MAX_COL`].
pub fn letters_to_col(s: &str) -> Option<u32> {
    if s.is_empty() {
        return None;
    }
    let mut n: u32 = 0;
    for b in s.bytes() {
        if !b.is_ascii_alphabetic() {
            return None;
        }
        let v = u32::from(b.to_ascii_uppercase() - b'A') + 1;
        n = n.checked_mul(26)?.checked_add(v)?;
    }
    Some(n - 1)
}

impl Expr {
    /// All references in the expression, recursively, in source order.
    pub fn references(&self) -> Vec<&Reference> {
        let mut out = Vec::new();
        self.collect_refs(&mut out);
        out
    }

    fn collect_refs<'a>(&'a self, out: &mut Vec<&'a Reference>) {
        match self {
            Expr::Reference(r) => out.push(r),
            Expr::Call { args, .. } => args.iter().for_each(|a| a.collect_refs(out)),
            Expr::Unary { expr, .. } => expr.collect_refs(out),
            Expr::Binary { lhs, rhs, .. } => {
                lhs.collect_refs(out);
                rhs.collect_refs(out);
            }
            Expr::Array(rows) => rows.iter().flatten().for_each(|e| e.collect_refs(out)),
            Expr::Number(_)
            | Expr::Text(_)
            | Expr::Bool(_)
            | Expr::Error(_)
            | Expr::Name(_)
            | Expr::QualifiedName { .. }
            | Expr::Structured(_)
            | Expr::Missing => {}
        }
    }

    fn precedence(&self) -> u8 {
        match self {
            Expr::Binary { op, .. } => op.precedence(),
            Expr::Unary {
                op: UnaryOp::Percent,
                ..
            } => PREC_PERCENT,
            Expr::Unary {
                op: UnaryOp::ImplicitIntersection,
                ..
            } => PREC_AT,
            Expr::Unary {
                op: UnaryOp::SpillRange,
                ..
            } => PREC_SPILL,
            Expr::Unary { .. } => PREC_PREFIX,
            _ => PREC_ATOM,
        }
    }
}

/// How references are printed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefStyle {
    A1,
    /// R1C1 relative to the formula cell `(row, col)` (0-based).
    R1C1(u32, u32),
}

/// An expression printer (see [`Expr::to_r1c1`]).
struct Printer<'a> {
    expr: &'a Expr,
    style: RefStyle,
}

impl fmt::Display for Printer<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt_expr(f, self.expr, self.style)
    }
}

/// Writes `e`, wrapped in parentheses if `parens`.
fn write_wrapped(
    f: &mut fmt::Formatter<'_>,
    e: &Expr,
    parens: bool,
    style: RefStyle,
) -> fmt::Result {
    if parens {
        f.write_str("(")?;
        fmt_expr(f, e, style)?;
        f.write_str(")")
    } else {
        fmt_expr(f, e, style)
    }
}

/// Canonical number text: shortest round-tripping decimal; exponent form
/// (`1E+20`, `1.5E-7`) for very large or very small magnitudes.
fn write_number(f: &mut fmt::Formatter<'_>, n: f64) -> fmt::Result {
    if !n.is_finite() {
        // Not representable as a literal; evaluates to #NUM! in Excel.
        return f.write_str(ErrorKind::Num.as_str());
    }
    let a = n.abs();
    if a != 0.0 && !(1e-6..1e15).contains(&a) {
        let s = format!("{n:e}");
        let (mantissa, exp) = s.split_once('e').expect("exponent form");
        let exp = if exp.starts_with('-') {
            exp.to_string()
        } else {
            format!("+{exp}")
        };
        write!(f, "{mantissa}E{exp}")
    } else if n == 0.0 {
        f.write_str("0")
    } else {
        write!(f, "{n}")
    }
}

/// One R1C1 coordinate part: `R5` (absolute, 1-based), `R[-2]` (relative
/// offset) or `R` (offset 0).
fn r1c1_part(letter: char, v: u32, abs: bool, here: u32) -> String {
    if abs {
        format!("{letter}{}", v + 1)
    } else {
        let d = i64::from(v) - i64::from(here);
        if d == 0 {
            letter.to_string()
        } else {
            format!("{letter}[{d}]")
        }
    }
}

/// The R1C1 text of a reference's range part as seen from `(row, col)`.
pub fn range_to_r1c1(kind: &RangeKind, row: u32, col: u32) -> String {
    let cell = |c: &CellRef| {
        format!(
            "{}{}",
            r1c1_part('R', c.row, c.row_abs, row),
            r1c1_part('C', c.col, c.col_abs, col)
        )
    };
    match kind {
        RangeKind::Cell(c) => cell(c),
        RangeKind::Area(a, b) => format!("{}:{}", cell(a), cell(b)),
        RangeKind::Rows {
            start,
            end,
            start_abs,
            end_abs,
        } => {
            let a = r1c1_part('R', *start, *start_abs, row);
            let b = r1c1_part('R', *end, *end_abs, row);
            if a == b {
                a
            } else {
                format!("{a}:{b}")
            }
        }
        RangeKind::Cols {
            start,
            end,
            start_abs,
            end_abs,
        } => {
            let a = r1c1_part('C', *start, *start_abs, col);
            let b = r1c1_part('C', *end, *end_abs, col);
            if a == b {
                a
            } else {
                format!("{a}:{b}")
            }
        }
    }
}

impl Expr {
    /// The formula text (without `=`) in R1C1 reference style, as seen
    /// from the formula cell `(row, col)` (0-based): `R1C1` absolute,
    /// `R[-1]C` relative (Excel's File › Options › Formulas › R1C1
    /// reference style). [`crate::r1c1::parse_r1c1`] reads it back.
    pub fn to_r1c1(&self, row: u32, col: u32) -> String {
        Printer {
            expr: self,
            style: RefStyle::R1C1(row, col),
        }
        .to_string()
    }

    /// The operands of a chain of unions `(a,b,c)` (left-nested), in order.
    pub fn union_operands(&self) -> Vec<&Expr> {
        match self {
            Expr::Binary {
                op: BinaryOp::Union,
                lhs,
                rhs,
            } => {
                let mut v = lhs.union_operands();
                v.extend(rhs.union_operands());
                v
            }
            e => vec![e],
        }
    }
}

impl fmt::Display for Expr {
    /// Prints the canonical formula text without the leading `=`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt_expr(f, self, RefStyle::A1)
    }
}

fn fmt_expr(f: &mut fmt::Formatter<'_>, e: &Expr, style: RefStyle) -> fmt::Result {
    match e {
        Expr::Number(n) => write_number(f, *n),
        Expr::Text(s) => write!(f, "\"{}\"", s.replace('"', "\"\"")),
        Expr::Bool(true) => f.write_str("TRUE"),
        Expr::Bool(false) => f.write_str("FALSE"),
        Expr::Error(e) => write!(f, "{e}"),
        Expr::Reference(r) => match style {
            RefStyle::A1 => write!(f, "{r}"),
            RefStyle::R1C1(row, col) => {
                write_ref_prefix(f, r)?;
                f.write_str(&range_to_r1c1(&r.kind, row, col))
            }
        },
        Expr::Name(n) => f.write_str(n),
        Expr::QualifiedName { sheet, name } => {
            write_sheet_prefix(f, sheet)?;
            f.write_str(name)
        }
        Expr::Structured(s) => write!(f, "{s}"),
        Expr::Missing => Ok(()),
        Expr::Array(rows) => {
            f.write_str("{")?;
            for (i, row) in rows.iter().enumerate() {
                if i > 0 {
                    f.write_str(";")?;
                }
                for (j, e) in row.iter().enumerate() {
                    if j > 0 {
                        f.write_str(",")?;
                    }
                    fmt_expr(f, e, style)?;
                }
            }
            f.write_str("}")
        }
        Expr::Call { name, args } => {
            write!(f, "{name}(")?;
            for (i, a) in args.iter().enumerate() {
                if i > 0 {
                    f.write_str(",")?;
                }
                fmt_expr(f, a, style)?;
            }
            f.write_str(")")
        }
        Expr::Unary {
            op: UnaryOp::Percent,
            expr,
        } => {
            write_wrapped(f, expr, expr.precedence() < PREC_PERCENT, style)?;
            f.write_str("%")
        }
        Expr::Unary {
            op: UnaryOp::ImplicitIntersection,
            expr,
        } => {
            f.write_str("@")?;
            write_wrapped(f, expr, expr.precedence() < PREC_AT, style)
        }
        Expr::Unary {
            op: UnaryOp::SpillRange,
            expr,
        } => {
            write_wrapped(f, expr, expr.precedence() < PREC_SPILL, style)?;
            f.write_str("#")
        }
        Expr::Unary { op, expr } => {
            f.write_str(if *op == UnaryOp::Neg { "-" } else { "+" })?;
            write_wrapped(f, expr, expr.precedence() < PREC_PREFIX, style)
        }
        Expr::Binary {
            op: BinaryOp::Union,
            ..
        } => {
            f.write_str("(")?;
            for (i, part) in e.union_operands().into_iter().enumerate() {
                if i > 0 {
                    f.write_str(",")?;
                }
                fmt_expr(f, part, style)?;
            }
            f.write_str(")")
        }
        Expr::Binary { op, lhs, rhs } => {
            let p = op.precedence();
            write_wrapped(f, lhs, lhs.precedence() < p, style)?;
            f.write_str(op.symbol())?;
            // For `:`, a bare reference/number/name on the right would be
            // merged with the left operand into an area/row/column range
            // when re-parsed, so keep it parenthesized.
            // `A1:B1#` likewise reads as `(A1:B1)#`.
            let merge_risk = *op == BinaryOp::Range
                && matches!(
                    **rhs,
                    Expr::Reference(_)
                        | Expr::Number(_)
                        | Expr::Name(_)
                        | Expr::QualifiedName { .. }
                        | Expr::Unary {
                            op: UnaryOp::SpillRange,
                            ..
                        }
                );
            write_wrapped(f, rhs, rhs.precedence() <= p || merge_risk, style)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_letters_roundtrip() {
        for (col, s) in [
            (0, "A"),
            (25, "Z"),
            (26, "AA"),
            (701, "ZZ"),
            (702, "AAA"),
            (16383, "XFD"),
        ] {
            assert_eq!(col_to_letters(col), s);
            assert_eq!(letters_to_col(s), Some(col));
            assert_eq!(letters_to_col(&s.to_lowercase()), Some(col));
        }
        for col in 0..20_000 {
            assert_eq!(letters_to_col(&col_to_letters(col)), Some(col));
        }
        assert_eq!(letters_to_col(""), None);
        assert_eq!(letters_to_col("A1"), None);
        assert_eq!(letters_to_col("ZZZZZZZZZZ"), None);
    }

    #[test]
    fn cellref_parse_and_print() {
        let c = CellRef::parse("$A$1").unwrap();
        assert_eq!(
            c,
            CellRef {
                col: 0,
                row: 0,
                col_abs: true,
                row_abs: true
            }
        );
        assert_eq!(c.to_a1(), "$A$1");
        assert_eq!(CellRef::parse("b$7").unwrap().to_a1(), "B$7");
        assert_eq!(
            CellRef::parse("$XFD1048576").unwrap().to_a1(),
            "$XFD1048576"
        );
        assert!(CellRef::parse("XFE1").is_err());
        assert!(CellRef::parse("A1048577").is_err());
        assert!(CellRef::parse("A0").is_err());
        assert!(CellRef::parse("A").is_err());
        assert!(CellRef::parse("1").is_err());
        assert!(CellRef::parse("A1B").is_err());
    }

    #[test]
    fn error_kind_text() {
        for k in ErrorKind::ALL {
            assert_eq!(k.to_string().parse::<ErrorKind>().unwrap(), k);
        }
        assert_eq!("#n/a".parse::<ErrorKind>().unwrap(), ErrorKind::NA);
        assert!("#FOO!".parse::<ErrorKind>().is_err());
    }

    #[test]
    fn area_is_normalized() {
        let a = CellRef::parse("$B2").unwrap();
        let b = CellRef::parse("A$1").unwrap();
        assert_eq!(RangeKind::area(a, b).to_string(), "A$1:$B2");
    }

    #[test]
    fn sheet_quoting() {
        for (name, quoted) in [
            ("Sheet1", false),
            ("_x.y", false),
            ("My Sheet", true),
            ("2019", true),
            ("A1", true),
            ("xfd10", true),
            ("R1C1", true),
            ("R2", true),
            ("RC", true),
            ("Übersicht", true),
            ("it's", true),
        ] {
            assert_eq!(sheet_needs_quotes(name), quoted, "{name}");
        }
        let r = Reference::on(Some("it's".into()), RangeKind::Cell(CellRef::new(0, 0)));
        assert_eq!(r.to_string(), "'it''s'!A1");
    }

    #[test]
    fn number_printing() {
        let p = |n: f64| Expr::Number(n).to_string();
        assert_eq!(p(1000.0), "1000");
        assert_eq!(p(0.5), "0.5");
        assert_eq!(p(0.0), "0");
        assert_eq!(p(1e20), "1E+20");
        assert_eq!(p(1.5e-7), "1.5E-7");
        assert_eq!(p(-3.0), "-3");
    }
}
