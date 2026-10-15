//! `MAXIFS` and `MINIFS`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::math::criteria::{at, matching_offsets};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// Shared driver: the extreme numeric cell among the matches, 0 if none.
pub(crate) fn extreme(
    args: &[Expr],
    ctx: &CallContext,
    pick: impl Fn(f64, f64) -> f64,
) -> Result<Value, ErrorKind> {
    let vals = ctx.range(&args[0])?;
    let hits = matching_offsets(ctx, &vals, &args[1..])?;
    let mut best: Option<f64> = None;
    for (r, c) in hits {
        match at(&vals, r, c) {
            Some(Value::Number(x)) => best = Some(best.map_or(x, |b| pick(b, x))),
            Some(Value::Error(e)) => return Err(e),
            _ => {}
        }
    }
    Ok(Value::Number(best.unwrap_or(0.0)))
}

function!(
    /// Largest numeric cell of the first range where all criteria hold;
    /// no match gives 0.
    MaxIfs, "MAXIFS", Arity::range(3, 255), |args, ctx| {
    extreme(args, ctx, f64::max)
});
function!(
    /// Smallest numeric cell of the first range where all criteria hold;
    /// no match gives 0.
    MinIfs, "MINIFS", Arity::range(3, 255), |args, ctx| {
    extreme(args, ctx, f64::min)
});
