//! Criteria matching shared by `SUMIF` and `COUNTIF`.

use std::cmp::Ordering;

use crate::ast::{ErrorKind, Expr};
use crate::eval::CellCoord;
use crate::functions::{CallContext, RangeArg};
use crate::value::{parse_number_text, round_15, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, PartialEq)]
enum Target {
    Num(f64),
    Text(String),
    Bool(bool),
    Err(ErrorKind),
    /// Empty cells and empty strings (`""`, `"<>"`).
    Blank,
    /// Truly empty cells only (`"="`).
    EmptyOnly,
}

/// A parsed `SUMIF`/`COUNTIF` criterion.
#[derive(Debug, Clone, PartialEq)]
pub struct Criteria {
    op: Op,
    target: Target,
}

impl Criteria {
    /// Parses the criterion value. An error value is returned as `Err`.
    pub fn parse(v: &Value) -> Result<Criteria, ErrorKind> {
        let eq = |target| Criteria { op: Op::Eq, target };
        match v {
            Value::Error(e) => Err(*e),
            Value::Number(n) => Ok(eq(Target::Num(*n))),
            Value::Bool(b) => Ok(eq(Target::Bool(*b))),
            Value::Empty => Ok(eq(Target::Num(0.0))),
            Value::Array(a) => Criteria::parse(&a.clone().top_left()),
            Value::Text(s) => {
                let (op, rest) = split_operator(s);
                let target = if rest.is_empty() {
                    if s.is_empty() {
                        Target::Blank
                    } else if op == Op::Eq {
                        Target::EmptyOnly
                    } else {
                        Target::Blank
                    }
                } else if let Some(n) = parse_number_text(rest) {
                    Target::Num(n)
                } else if rest.eq_ignore_ascii_case("TRUE") {
                    Target::Bool(true)
                } else if rest.eq_ignore_ascii_case("FALSE") {
                    Target::Bool(false)
                } else if let Some(k) = rest
                    .starts_with('#')
                    .then(|| rest.parse::<ErrorKind>().ok())
                    .flatten()
                {
                    Target::Err(k)
                } else {
                    Target::Text(rest.to_string())
                };
                Ok(Criteria { op, target })
            }
        }
    }

    /// Whether the cell value satisfies the criterion.
    pub fn matches(&self, cell: &Value) -> bool {
        let m = self.matches_positive(cell);
        match self.op {
            Op::Ne => !m,
            _ => m,
        }
    }

    fn matches_positive(&self, cell: &Value) -> bool {
        use Op::*;
        let ord = |o: Ordering| match self.op {
            Eq | Ne => o == Ordering::Equal,
            Lt => o == Ordering::Less,
            Le => o != Ordering::Greater,
            Gt => o == Ordering::Greater,
            Ge => o != Ordering::Less,
        };
        match (&self.target, cell) {
            (Target::Blank, Value::Empty) => true,
            (Target::Blank, Value::Text(s)) => s.is_empty(),
            (Target::EmptyOnly, Value::Empty) => true,
            (Target::Num(n), Value::Number(x)) => ord(cmp_num(*x, *n)),
            (Target::Num(n), Value::Text(s)) if matches!(self.op, Eq | Ne) => {
                parse_number_text(s).is_some_and(|x| cmp_num(x, *n) == Ordering::Equal)
            }
            (Target::Text(p), Value::Text(s)) => match self.op {
                Eq | Ne => wildcard_match(p, s),
                _ => ord(s.to_uppercase().cmp(&p.to_uppercase())),
            },
            (Target::Bool(b), Value::Bool(x)) => ord(x.cmp(b)),
            (Target::Err(k), Value::Error(x)) => k == x && matches!(self.op, Eq | Ne),
            _ => false,
        }
    }
}

fn cmp_num(x: f64, y: f64) -> Ordering {
    round_15(x)
        .partial_cmp(&round_15(y))
        .unwrap_or(Ordering::Equal)
}

fn split_operator(s: &str) -> (Op, &str) {
    for (p, op) in [
        ("<>", Op::Ne),
        (">=", Op::Ge),
        ("<=", Op::Le),
        (">", Op::Gt),
        ("<", Op::Lt),
        ("=", Op::Eq),
    ] {
        if let Some(rest) = s.strip_prefix(p) {
            return (op, rest);
        }
    }
    (Op::Eq, s)
}

/// Case-insensitive whole-string match with `*`, `?` and `~` escapes
/// (also used by the AutoFilter of `model-sheet`).
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    #[derive(Clone, Copy)]
    enum P {
        Star,
        Any,
        Lit(char),
    }
    let fold = |c: char| c.to_uppercase().next().unwrap_or(c);
    let mut pat = Vec::new();
    let mut it = pattern.chars();
    while let Some(c) = it.next() {
        pat.push(match c {
            '*' => P::Star,
            '?' => P::Any,
            '~' => match it.next() {
                Some(n) => P::Lit(fold(n)),
                None => P::Lit('~'),
            },
            c => P::Lit(fold(c)),
        });
    }
    let txt: Vec<char> = text.chars().map(fold).collect();
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < txt.len() {
        match pat.get(p) {
            Some(P::Star) => {
                star = Some((p, t));
                p += 1;
            }
            Some(P::Any) => {
                p += 1;
                t += 1;
            }
            Some(P::Lit(c)) if *c == txt[t] => {
                p += 1;
                t += 1;
            }
            _ => match star {
                Some((sp, st)) => {
                    p = sp + 1;
                    t = st + 1;
                    star = Some((sp, st + 1));
                }
                None => return false,
            },
        }
    }
    pat[p..].iter().all(|x| matches!(x, P::Star))
}

/// Value at offset `(r, c)` of `arg`; a `Range` is extended past its own
/// bounds, an array yields `None` outside.
pub(crate) fn at(arg: &RangeArg, r: usize, c: usize) -> Option<Value> {
    match arg {
        RangeArg::Range { range, provider } => {
            let row = range.r0.checked_add(u32::try_from(r).ok()?)?;
            let col = range.c0.checked_add(u32::try_from(c).ok()?)?;
            (row <= crate::ast::MAX_ROW && col <= crate::ast::MAX_COL).then(|| {
                provider.value(CellCoord {
                    sheet: range.sheet,
                    row,
                    col,
                })
            })
        }
        RangeArg::Array(_) => arg.get(r, c),
    }
}

/// Every cell of the argument as `(row, col, value)` with 0-based offsets
/// from its top-left corner; whole-column/row ranges are clipped to the
/// used range.
pub fn cells(arg: &RangeArg) -> Vec<(usize, usize, Value)> {
    let mut out = Vec::new();
    match arg {
        RangeArg::Range { range, provider } => {
            if let Some(c) = range.clipped(*provider) {
                for r in c.r0..=c.r1 {
                    for col in c.c0..=c.c1 {
                        let v = provider.value(crate::eval::CellCoord {
                            sheet: c.sheet,
                            row: r,
                            col,
                        });
                        out.push(((r - range.r0) as usize, (col - range.c0) as usize, v));
                    }
                }
            }
        }
        RangeArg::Array(a) => {
            for r in 0..a.rows() {
                for c in 0..a.cols() {
                    if let Some(v) = a.get(r, c) {
                        out.push((r, c, v.clone()));
                    }
                }
            }
        }
    }
    out
}

/// Offsets `(row, col)` of the cells that satisfy every `(range, criteria)`
/// pair of `pairs` (the argument list of `SUMIFS`/`COUNTIFS` and friends
/// after the optional value range). All ranges must have the shape of
/// `shape` (`#VALUE!` otherwise); the pair count must be even and non-zero.
pub(crate) fn matching_offsets(
    ctx: &CallContext,
    shape: &RangeArg,
    pairs: &[Expr],
) -> Result<Vec<(usize, usize)>, ErrorKind> {
    if pairs.is_empty() || pairs.len() % 2 != 0 {
        return Err(ErrorKind::Value);
    }
    let mut ranges = Vec::new();
    for p in pairs.chunks(2) {
        let r = ctx.range(&p[0])?;
        if r.rows() != shape.rows() || r.cols() != shape.cols() {
            return Err(ErrorKind::Value);
        }
        let crit = Criteria::parse(&ctx.scalar(&p[1]))?;
        ranges.push((r, crit));
    }
    let mut out = Vec::new();
    for (r, c, v) in cells(&ranges[0].0) {
        if !ranges[0].1.matches(&v) {
            continue;
        }
        if ranges[1..]
            .iter()
            .all(|(rg, cr)| cr.matches(&at(rg, r, c).unwrap_or(Value::Empty)))
        {
            out.push((r, c));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> Value {
        Value::Text(s.into())
    }

    fn m(crit: Value, cell: Value) -> bool {
        Criteria::parse(&crit).unwrap().matches(&cell)
    }

    #[test]
    fn operators() {
        assert!(m(t(">3"), Value::Number(4.0)));
        assert!(!m(t(">3"), Value::Number(3.0)));
        assert!(m(t(">=3"), Value::Number(3.0)));
        assert!(!m(t(">3"), t("5")));
        assert!(m(t("<>3"), Value::Number(4.0)));
        assert!(m(t("<>3"), Value::Empty));
        assert!(m(t("=3"), Value::Number(3.0)));
        assert!(m(t(">b"), t("C")));
    }

    #[test]
    fn equality_kinds() {
        assert!(m(Value::Number(3.0), Value::Number(3.0)));
        assert!(m(Value::Number(42.0), t("42")));
        assert!(!m(Value::Number(3.0), Value::Bool(true)));
        assert!(m(Value::Bool(true), Value::Bool(true)));
        assert!(m(t("#N/A"), Value::Error(ErrorKind::NA)));
        assert!(m(t(""), Value::Empty));
        assert!(m(t(""), t("")));
        assert!(!m(t("="), t("")));
        assert!(m(t("="), Value::Empty));
        assert!(m(t("<>"), t("a")));
        assert!(!m(t("<>"), Value::Empty));
        assert!(Criteria::parse(&Value::Error(ErrorKind::NA)).is_err());
    }

    #[test]
    fn wildcards() {
        assert!(m(t("a*"), t("Apple")));
        assert!(m(t("?????"), t("apple")));
        assert!(!m(t("????"), t("apple")));
        assert!(m(t("*p*e"), t("apple")));
        assert!(m(t("a~*"), t("A*")));
        assert!(!m(t("a~*"), t("ab")));
        assert!(m(t("*"), t("")));
        assert!(!m(t("*"), Value::Empty));
        assert!(m(t("<>a*"), t("banana")));
    }
}
