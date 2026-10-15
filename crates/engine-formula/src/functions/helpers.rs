//! Argument helpers shared by the function families.

use crate::ast::{ErrorKind, Expr};
use crate::functions::CallContext;
use crate::value::Value;

/// Optional numeric argument `i`: absent or omitted (`f(a,,b)`) gives
/// `default`.
pub(crate) fn opt_num(
    ctx: &CallContext,
    args: &[Expr],
    i: usize,
    default: f64,
) -> Result<f64, ErrorKind> {
    match args.get(i) {
        Some(e) if !ctx.is_missing(e) => ctx.number(e),
        _ => Ok(default),
    }
}

/// True when argument `i` is present and not omitted.
pub(crate) fn present(ctx: &CallContext, args: &[Expr], i: usize) -> bool {
    args.get(i).is_some_and(|e| !ctx.is_missing(e))
}

/// All values of a range/array argument, row-major (whole-column ranges
/// clipped to the used range); an error value argument is `Err`.
pub(crate) fn flat_values(ctx: &CallContext, e: &Expr) -> Result<Vec<Value>, ErrorKind> {
    Ok(ctx.range(e)?.values().collect())
}

/// The numbers of a range/array argument: text, booleans and empty cells
/// are ignored, an error value is the result (first one wins).
pub(crate) fn range_numbers(ctx: &CallContext, e: &Expr) -> Result<Vec<f64>, ErrorKind> {
    let mut out = Vec::new();
    for v in ctx.range(e)?.values() {
        match v {
            Value::Number(n) => out.push(n),
            Value::Error(k) => return Err(k),
            _ => {}
        }
    }
    Ok(out)
}

/// Pairs of numbers of two equally sized ranges/arrays (`#N/A` if the
/// element counts differ). A pair is kept only when both elements are
/// numbers; errors propagate.
pub(crate) fn range_pairs(
    ctx: &CallContext,
    a: &Expr,
    b: &Expr,
) -> Result<Vec<(f64, f64)>, ErrorKind> {
    let x = flat_values(ctx, a)?;
    let y = flat_values(ctx, b)?;
    if x.len() != y.len() {
        return Err(ErrorKind::NA);
    }
    let mut out = Vec::new();
    for (p, q) in x.iter().zip(&y) {
        if let Value::Error(k) = p {
            return Err(*k);
        }
        if let Value::Error(k) = q {
            return Err(*k);
        }
        if let (Value::Number(p), Value::Number(q)) = (p, q) {
            out.push((*p, *q));
        }
    }
    Ok(out)
}
