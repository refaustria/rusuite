//! Logical functions.

pub mod and;
pub mod false_;
pub mod if_;
pub mod iferror;
pub mod not;
pub mod or;
pub mod true_;

use super::FunctionRegistry;
use crate::ast::{ErrorKind, Expr};
use crate::eval::Operand;
use crate::functions::{CallContext, RangeArg};
use crate::value::{to_bool, Value};

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(if_::If));
    r.register(Box::new(true_::True));
    r.register(Box::new(false_::False));
    r.register(Box::new(and::And));
    r.register(Box::new(or::Or));
    r.register(Box::new(not::Not));
    r.register(Box::new(iferror::IfError));
}

/// Shared AND/OR driver: folds all logical values of `args`. Direct scalar
/// arguments use `to_bool`; in references and arrays only Numbers and
/// Bools count. Never short-circuits; the first error (left to right)
/// wins; no logical value at all gives `#VALUE!`.
pub(crate) fn fold(
    args: &[Expr],
    ctx: &CallContext,
    init: bool,
    op: impl Fn(bool, bool) -> bool,
) -> Value {
    let mut acc = init;
    let mut seen = false;
    let mut first_err: Option<ErrorKind> = None;
    let mut take = |v: Result<Option<bool>, ErrorKind>| match v {
        Ok(Some(b)) => {
            acc = op(acc, b);
            seen = true;
        }
        Ok(None) => {}
        Err(e) => {
            first_err.get_or_insert(e);
        }
    };
    let item = |v: &Value| match v {
        Value::Number(n) => Ok(Some(*n != 0.0)),
        Value::Bool(b) => Ok(Some(*b)),
        Value::Error(e) => Err(*e),
        _ => Ok(None),
    };
    for a in args {
        match ctx.eval(a) {
            Operand::Range(range) => {
                let provider = ctx.eval_context().provider;
                let r = RangeArg::Range { range, provider };
                r.values().for_each(|v| take(item(&v)));
            }
            Operand::Scalar(Value::Array(arr)) => {
                arr.values().iter().for_each(|v| take(item(v)));
            }
            Operand::Scalar(v) => take(to_bool(&v).map(Some)),
        }
    }
    match (first_err, seen) {
        (Some(e), _) => Value::Error(e),
        (None, true) => Value::Bool(acc),
        (None, false) => Value::Error(ErrorKind::Value),
    }
}
