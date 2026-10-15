//! Function registry and the calling convention for built-in functions.
//!
//! One function = one file under `functions/<family>/<name>.rs`, each a
//! unit struct implementing [`Function`] and registered in
//! [`FunctionRegistry::with_builtins`].

use std::collections::HashMap;

use crate::ast::{ErrorKind, Expr};
use crate::eval::{eval_operand, scalar, CellCoord, CellProvider, EvalContext, Operand, RangeRef};
use crate::value::{to_bool, to_number, to_text, Array, Value};

pub mod datetime;
pub mod info;
pub mod logical;
pub mod math;
pub mod text;

/// Accepted argument count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Arity {
    pub min: usize,
    /// `None` = unbounded.
    pub max: Option<usize>,
}

impl Arity {
    /// Exactly `n` arguments.
    pub const fn exact(n: usize) -> Arity {
        Arity {
            min: n,
            max: Some(n),
        }
    }

    /// Between `min` and `max` arguments (inclusive).
    pub const fn range(min: usize, max: usize) -> Arity {
        Arity {
            min,
            max: Some(max),
        }
    }

    /// At least `min` arguments.
    pub const fn at_least(min: usize) -> Arity {
        Arity { min, max: None }
    }

    pub fn accepts(&self, n: usize) -> bool {
        n >= self.min && self.max.map_or(true, |m| n <= m)
    }
}

/// A spreadsheet function.
pub trait Function: Send + Sync {
    /// Uppercase name, e.g. `SUM`.
    fn name(&self) -> &'static str;
    /// Accepted argument count; checked by the evaluator before `call`
    /// (a wrong count gives `#VALUE!`).
    fn arity(&self) -> Arity;
    /// Computes the result. Arguments are unevaluated so that functions
    /// such as `IF` can short-circuit; use the [`CallContext`] helpers to
    /// evaluate them.
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value;
}

/// Case-insensitive map from function name to implementation.
#[derive(Default)]
pub struct FunctionRegistry {
    functions: HashMap<String, Box<dyn Function>>,
}

impl FunctionRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// A registry with every built-in function.
    pub fn with_builtins() -> Self {
        let mut r = Self::new();
        math::register(&mut r);
        logical::register(&mut r);
        text::register(&mut r);
        info::register(&mut r);
        datetime::register(&mut r);
        r
    }

    /// Adds a function, replacing one with the same name.
    pub fn register(&mut self, f: Box<dyn Function>) {
        self.functions.insert(f.name().to_ascii_uppercase(), f);
    }

    /// Looks a function up by name (case-insensitive).
    pub fn get(&self, name: &str) -> Option<&dyn Function> {
        self.functions
            .get(&name.to_ascii_uppercase())
            .map(Box::as_ref)
    }

    /// Registered names, uppercase and sorted.
    pub fn names(&self) -> Vec<&str> {
        let mut v: Vec<&str> = self.functions.keys().map(String::as_str).collect();
        v.sort_unstable();
        v
    }
}

/// How [`CallContext::aggregate`] treats argument values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Aggregate {
    /// The SUM rule: a direct scalar argument keeps Numbers, turns Bools
    /// into 1/0, converts Text with `to_number` (or yields `#VALUE!`) and
    /// skips Empty; from ranges and arrays only Numbers are kept. Errors
    /// are always yielded.
    Numbers,
}

/// Evaluation helpers handed to [`Function::call`].
pub struct CallContext<'c, 'a> {
    ctx: &'c EvalContext<'a>,
}

impl<'c, 'a> CallContext<'c, 'a> {
    pub fn new(ctx: &'c EvalContext<'a>) -> Self {
        CallContext { ctx }
    }

    /// The underlying evaluation context.
    pub fn eval_context(&self) -> &EvalContext<'a> {
        self.ctx
    }

    /// The cell the formula is evaluated for.
    pub fn current(&self) -> CellCoord {
        self.ctx.current
    }

    /// Current date-time serial (from the injectable clock).
    pub fn now(&self) -> f64 {
        (self.ctx.now)()
    }

    /// Evaluates an argument without dereferencing references.
    pub fn eval(&self, e: &Expr) -> Operand {
        eval_operand(e, self.ctx)
    }

    /// Evaluates an argument to a scalar (dereferenced, implicitly
    /// intersected, arrays reduced to their top-left element). A missing
    /// argument is `Empty`.
    pub fn scalar(&self, e: &Expr) -> Value {
        scalar(self.eval(e), self.ctx)
    }

    pub fn number(&self, e: &Expr) -> Result<f64, ErrorKind> {
        to_number(&self.scalar(e))
    }

    pub fn text(&self, e: &Expr) -> Result<String, ErrorKind> {
        to_text(&self.scalar(e))
    }

    pub fn bool(&self, e: &Expr) -> Result<bool, ErrorKind> {
        to_bool(&self.scalar(e))
    }

    /// Evaluates an argument that should be a range or array. A scalar is
    /// treated as a 1x1 array; an error value is returned as `Err`.
    pub fn range(&self, e: &Expr) -> Result<RangeArg<'a>, ErrorKind> {
        match self.eval(e) {
            Operand::Range(r) => Ok(RangeArg::Range {
                range: r,
                provider: self.ctx.provider,
            }),
            Operand::Scalar(Value::Error(k)) => Err(k),
            Operand::Scalar(Value::Array(a)) => Ok(RangeArg::Array(a)),
            Operand::Scalar(v) => Ok(RangeArg::Array(
                Array::new(1, 1, vec![v]).expect("1x1 array"),
            )),
        }
    }

    /// True for an omitted argument (`IF(A1,,1)`).
    pub fn is_missing(&self, e: &Expr) -> bool {
        matches!(e, Expr::Missing)
    }

    /// Iterates the values of `args` under the given [`Aggregate`] rule,
    /// evaluating lazily. Kept values are yielded as `Number`, errors as
    /// `Error`; the caller decides whether an error stops the computation.
    pub fn aggregate<'s>(&'s self, args: &'s [Expr], mode: Aggregate) -> Aggregator<'s, 'c, 'a> {
        Aggregator {
            ctx: self,
            args: args.iter(),
            current: None,
            mode,
        }
    }
}

/// A range or array argument (see [`CallContext::range`]).
#[derive(Clone)]
pub enum RangeArg<'a> {
    Range {
        range: RangeRef,
        provider: &'a dyn CellProvider,
    },
    Array(Array),
}

impl<'a> RangeArg<'a> {
    pub fn rows(&self) -> usize {
        match self {
            RangeArg::Range { range, .. } => range.rows() as usize,
            RangeArg::Array(a) => a.rows(),
        }
    }

    pub fn cols(&self) -> usize {
        match self {
            RangeArg::Range { range, .. } => range.cols() as usize,
            RangeArg::Array(a) => a.cols(),
        }
    }

    /// Element at 0-based `(row, col)`; `None` if outside.
    pub fn get(&self, row: usize, col: usize) -> Option<Value> {
        match self {
            RangeArg::Range { range, provider } => {
                let c = range.at(u32::try_from(row).ok()?, u32::try_from(col).ok()?)?;
                Some(provider.value(c))
            }
            RangeArg::Array(a) => a.get(row, col).cloned(),
        }
    }

    /// Row-major values; whole-column/row ranges are clipped to the used
    /// range (the cells left out are all `Empty`).
    pub fn values(&self) -> RangeValues<'a> {
        match self {
            RangeArg::Range { range, provider } => RangeValues::range(*range, *provider),
            RangeArg::Array(a) => RangeValues::array(a.clone()),
        }
    }
}

/// Iterator over the values of a range or array.
pub struct RangeValues<'a> {
    inner: ValuesInner<'a>,
}

enum ValuesInner<'a> {
    Cells {
        provider: &'a dyn CellProvider,
        range: Option<RangeRef>,
        row: u32,
        col: u32,
    },
    Array(std::vec::IntoIter<Value>),
}

impl<'a> RangeValues<'a> {
    fn range(r: RangeRef, provider: &'a dyn CellProvider) -> Self {
        let range = r.clipped(provider);
        RangeValues {
            inner: ValuesInner::Cells {
                provider,
                row: range.map_or(0, |r| r.r0),
                col: range.map_or(0, |r| r.c0),
                range,
            },
        }
    }

    fn array(a: Array) -> Self {
        RangeValues {
            inner: ValuesInner::Array(a.values().to_vec().into_iter()),
        }
    }
}

impl Iterator for RangeValues<'_> {
    type Item = Value;

    fn next(&mut self) -> Option<Value> {
        match &mut self.inner {
            ValuesInner::Array(it) => it.next(),
            ValuesInner::Cells {
                provider,
                range,
                row,
                col,
            } => {
                let r = (*range)?;
                if *row > r.r1 {
                    return None;
                }
                let v = provider.value(CellCoord {
                    sheet: r.sheet,
                    row: *row,
                    col: *col,
                });
                if *col == r.c1 {
                    *col = r.c0;
                    *row += 1;
                } else {
                    *col += 1;
                }
                Some(v)
            }
        }
    }
}

/// Lazy iterator returned by [`CallContext::aggregate`].
pub struct Aggregator<'s, 'c, 'a> {
    ctx: &'s CallContext<'c, 'a>,
    args: std::slice::Iter<'s, Expr>,
    current: Option<RangeValues<'a>>,
    mode: Aggregate,
}

impl Iterator for Aggregator<'_, '_, '_> {
    type Item = Value;

    fn next(&mut self) -> Option<Value> {
        let Aggregate::Numbers = self.mode;
        loop {
            if let Some(values) = &mut self.current {
                for v in values.by_ref() {
                    if matches!(v, Value::Number(_) | Value::Error(_)) {
                        return Some(v);
                    }
                }
                self.current = None;
            }
            let arg = self.args.next()?;
            match self.ctx.eval(arg) {
                Operand::Range(r) => {
                    self.current = Some(RangeValues::range(r, self.ctx.ctx.provider));
                }
                Operand::Scalar(Value::Array(a)) => self.current = Some(RangeValues::array(a)),
                Operand::Scalar(Value::Empty) => {}
                Operand::Scalar(v) => {
                    return Some(Value::from_result(to_number(&v)));
                }
            }
        }
    }
}

/// Shared fixture for the function unit tests.
#[cfg(test)]
pub(crate) mod test_support {
    use std::collections::HashMap;

    use crate::ast::ErrorKind;
    use crate::eval::{evaluate, CellCoord, CellProvider, EvalContext, SheetId};
    use crate::value::Value;

    use super::FunctionRegistry;

    /// One sheet `S1`: A1..A3 = 1, "x", 3; B1 = TRUE; B2 = "5";
    /// C1 = #DIV/0!; C2 = #N/A.
    struct Grid(HashMap<(u32, u32), Value>);

    impl CellProvider for Grid {
        fn sheet_id(&self, name: &str) -> Option<SheetId> {
            name.eq_ignore_ascii_case("S1").then_some(SheetId(0))
        }
        fn value(&self, c: CellCoord) -> Value {
            self.0.get(&(c.row, c.col)).cloned().unwrap_or(Value::Empty)
        }
        fn used_range(&self, _sheet: SheetId) -> Option<(u32, u32)> {
            Some((2, 2))
        }
    }

    /// Evaluates `formula` in S1!J10 with the built-in registry.
    pub(crate) fn eval(formula: &str) -> Value {
        let grid = Grid(HashMap::from([
            ((0, 0), Value::Number(1.0)),
            ((1, 0), Value::Text("x".into())),
            ((2, 0), Value::Number(3.0)),
            ((0, 1), Value::Bool(true)),
            ((1, 1), Value::Text("5".into())),
            ((0, 2), Value::Error(ErrorKind::Div0)),
            ((1, 2), Value::Error(ErrorKind::NA)),
        ]));
        let registry = FunctionRegistry::with_builtins();
        let ctx = EvalContext {
            provider: &grid,
            registry: &registry,
            current: CellCoord {
                sheet: SheetId(0),
                row: 9,
                col: 9,
            },
            now: || 45000.5,
        };
        evaluate(&crate::parse(formula).expect("formula parses"), &ctx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_lookup() {
        let r = FunctionRegistry::with_builtins();
        let names = r.names();
        for n in ["FALSE", "IF", "ISERROR", "LEN", "NA", "SUM", "TRUE"] {
            assert!(names.contains(&n), "{n}");
        }
        assert!(names.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(r.get("sum").map(|f| f.name()), Some("SUM"));
        assert_eq!(r.get("Iserror").map(|f| f.name()), Some("ISERROR"));
        assert!(r.get("VLOOKUP").is_none());
        assert!(FunctionRegistry::new().names().is_empty());
    }

    #[test]
    fn arity() {
        assert!(Arity::exact(1).accepts(1));
        assert!(!Arity::exact(1).accepts(0));
        assert!(!Arity::exact(1).accepts(2));
        assert!(Arity::range(2, 3).accepts(3));
        assert!(!Arity::range(2, 3).accepts(4));
        assert!(Arity::at_least(1).accepts(255));
        assert!(!Arity::at_least(1).accepts(0));
    }
}
