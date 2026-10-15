//! Shared helpers for the lookup functions: table access, the search
//! algorithms, a private wildcard matcher and `INDEX` selection.

use std::cmp::Ordering;

use crate::ast::{ErrorKind, Expr};
use crate::eval::{Operand, RangeRef};
use crate::functions::{CallContext, RangeArg};
use crate::value::{compare, Value};

/// A range/array with the number of rows/columns worth searching (whole
/// column/row references are clipped to the used range).
pub(crate) struct Table<'a> {
    pub arg: RangeArg<'a>,
    pub rows: usize,
    pub cols: usize,
    pub used_rows: usize,
    pub used_cols: usize,
}

impl<'a> Table<'a> {
    pub fn new(arg: RangeArg<'a>) -> Self {
        let (rows, cols) = (arg.rows(), arg.cols());
        let (used_rows, used_cols) = match &arg {
            RangeArg::Range { range, provider } => range
                .clipped(*provider)
                .map_or((0, 0), |c| (c.rows() as usize, c.cols() as usize)),
            RangeArg::Array(_) => (rows, cols),
        };
        Table {
            arg,
            rows,
            cols,
            used_rows,
            used_cols,
        }
    }

    pub fn get(&self, row: usize, col: usize) -> Value {
        self.arg.get(row, col).unwrap_or(Value::Empty)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    /// Exact match, wildcards for text.
    Exact,
    /// Largest value <= lookup in an ascending list.
    Asc,
    /// Smallest value >= lookup in a descending list.
    Desc,
}

fn kind(v: &Value) -> Option<u8> {
    match v {
        Value::Number(_) => Some(0),
        Value::Text(_) => Some(1),
        Value::Bool(_) => Some(2),
        _ => None,
    }
}

/// The lookup value as used for searching (`Empty` is 0).
pub(crate) fn lookup_value(v: Value) -> Value {
    match v.into_scalar() {
        Value::Empty => Value::Number(0.0),
        v => v,
    }
}

/// 0-based position of `lookup` among `n` items. `lookup` must not be an
/// error. Items of another type (and blanks/errors) never match.
pub(crate) fn find(
    lookup: &Value,
    n: usize,
    get: impl Fn(usize) -> Value,
    mode: Mode,
) -> Option<usize> {
    let lk = kind(lookup)?;
    match mode {
        Mode::Exact => {
            let pat = match lookup {
                Value::Text(s) if s.contains(['*', '?', '~']) => Some(Pattern::new(s)),
                _ => None,
            };
            (0..n).find(|&i| {
                let v = get(i);
                if kind(&v) != Some(lk) {
                    return false;
                }
                match (&pat, &v) {
                    (Some(p), Value::Text(t)) => p.is_match(t),
                    _ => compare(&v, lookup) == Ok(Ordering::Equal),
                }
            })
        }
        Mode::Asc | Mode::Desc => {
            let (mut lo, mut hi) = (0, n);
            let mut result = None;
            while lo < hi {
                let mid = lo + (hi - lo) / 2;
                // Nearest comparable item at or after mid.
                let Some((j, v)) = (mid..hi).find_map(|j| {
                    let v = get(j);
                    (kind(&v) == Some(lk)).then_some((j, v))
                }) else {
                    hi = mid;
                    continue;
                };
                let ord = compare(&v, lookup).unwrap_or(Ordering::Equal);
                let ok = if mode == Mode::Asc {
                    ord != Ordering::Greater
                } else {
                    ord != Ordering::Less
                };
                if ok {
                    result = Some(j);
                    lo = j + 1;
                } else {
                    hi = mid;
                }
            }
            result
        }
    }
}

enum Tok {
    Any,
    One,
    Lit(char),
}

/// Excel-style wildcard pattern: `*`, `?`, `~` escape; case-insensitive.
struct Pattern(Vec<Tok>);

impl Pattern {
    fn new(s: &str) -> Self {
        let mut toks = Vec::new();
        let mut it = s.to_uppercase().chars().collect::<Vec<_>>().into_iter();
        while let Some(c) = it.next() {
            toks.push(match c {
                '*' => Tok::Any,
                '?' => Tok::One,
                '~' => Tok::Lit(it.next().unwrap_or('~')),
                c => Tok::Lit(c),
            });
        }
        Pattern(toks)
    }

    fn is_match(&self, text: &str) -> bool {
        let t: Vec<char> = text.to_uppercase().chars().collect();
        let (mut p, mut i) = (0, 0);
        let mut star: Option<(usize, usize)> = None;
        while i < t.len() {
            match self.0.get(p) {
                Some(Tok::Any) => {
                    star = Some((p, i));
                    p += 1;
                    continue;
                }
                Some(Tok::One) => {}
                Some(Tok::Lit(c)) if *c == t[i] => {}
                _ => match star {
                    Some((sp, si)) => {
                        p = sp + 1;
                        i = si + 1;
                        star = Some((sp, si + 1));
                        continue;
                    }
                    None => return false,
                },
            }
            p += 1;
            i += 1;
        }
        self.0[p.min(self.0.len())..]
            .iter()
            .all(|t| matches!(t, Tok::Any))
    }
}

/// Truncated non-negative index argument.
pub(crate) fn index_arg(n: f64) -> Result<usize, ErrorKind> {
    let t = n.trunc();
    if t < 0.0 {
        Err(ErrorKind::Value)
    } else {
        Ok(t as usize)
    }
}

/// A sub-rectangle of a table (0-based).
pub(crate) struct Sel {
    pub r0: usize,
    pub c0: usize,
    pub nr: usize,
    pub nc: usize,
}

/// `INDEX` selection; an index of 0 selects the whole row/column.
pub(crate) fn select(
    rows: usize,
    cols: usize,
    row: usize,
    col: Option<usize>,
) -> Result<Sel, ErrorKind> {
    let (r, c) = match col {
        Some(c) => (row, c),
        None if rows == 1 && cols > 1 => (1, row),
        None if cols == 1 => (row, 1),
        None => (row, 0),
    };
    if r > rows || c > cols {
        return Err(ErrorKind::Ref);
    }
    Ok(Sel {
        r0: r.saturating_sub(1),
        c0: c.saturating_sub(1),
        nr: if r == 0 { rows } else { 1 },
        nc: if c == 0 { cols } else { 1 },
    })
}

/// Parses the `row`/`col` arguments of `INDEX` (`args[1..]`).
pub(crate) fn index_numbers(
    args: &[Expr],
    ctx: &CallContext,
) -> Result<(usize, Option<usize>), ErrorKind> {
    let get = |e: &Expr| -> Result<usize, ErrorKind> {
        if ctx.is_missing(e) {
            Ok(0)
        } else {
            index_arg(ctx.number(e)?)
        }
    };
    let row = args.get(1).map_or(Ok(0), get)?;
    let col = args.get(2).map(get).transpose()?;
    Ok((row, col))
}

/// The reference designated by an argument of `ROW`/`COLUMN` (evaluated
/// in reference position, so `INDEX(range, ...)` counts as a reference).
pub(crate) fn reference_arg(e: &Expr, ctx: &CallContext) -> Result<RangeRef, ErrorKind> {
    match ctx.eval_ref(e) {
        Operand::Range(r) => Ok(r),
        Operand::Scalar(Value::Error(k)) => Err(k),
        Operand::Scalar(_) => Err(ErrorKind::Value),
    }
}
