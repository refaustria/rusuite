//! `VAR`, `VAR.S`, `VAR.P`, `VARP`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::math::numbers;
use crate::functions::statistical::sum_sq_dev;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// Variance of the numbers of `args`; `#DIV/0!` below 2 (sample) or 1
/// (population) values.
pub(crate) fn variance(args: &[Expr], ctx: &CallContext, sample: bool) -> Result<f64, Value> {
    let v = numbers(args, ctx)?;
    let n = v.len();
    if n < if sample { 2 } else { 1 } {
        return Err(Value::Error(ErrorKind::Div0));
    }
    Ok(sum_sq_dev(&v) / if sample { n - 1 } else { n } as f64)
}

function!(
    /// Sample variance.
    Var, "VAR", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, true).map_or_else(|e| e, Value::number))
});
function!(
    /// Sample variance.
    VarS, "VAR.S", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, true).map_or_else(|e| e, Value::number))
});
function!(
    /// Population variance.
    VarP, "VAR.P", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, false).map_or_else(|e| e, Value::number))
});
function!(
    /// Population variance.
    VarPLegacy, "VARP", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, false).map_or_else(|e| e, Value::number))
});
