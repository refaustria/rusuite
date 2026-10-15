//! `PERCENTILE`, `PERCENTILE.INC`, `PERCENTILE.EXC`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::range_numbers;
use crate::functions::statistical::{interpolate, sorted};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// Inclusive percentile of `v` (`k` in `[0, 1]`).
pub(crate) fn inc(v: &[f64], k: f64) -> Result<f64, ErrorKind> {
    if v.is_empty() || !(0.0..=1.0).contains(&k) {
        return Err(ErrorKind::Num);
    }
    Ok(interpolate(&sorted(v), k * (v.len() - 1) as f64))
}

/// Exclusive percentile of `v` (`k` in `[1/(n+1), n/(n+1)]`).
pub(crate) fn exc(v: &[f64], k: f64) -> Result<f64, ErrorKind> {
    let n = v.len() as f64;
    if v.is_empty() || k < 1.0 / (n + 1.0) || k > n / (n + 1.0) {
        return Err(ErrorKind::Num);
    }
    Ok(interpolate(&sorted(v), k * (n + 1.0) - 1.0))
}

fn run(
    args: &[Expr],
    ctx: &CallContext,
    f: fn(&[f64], f64) -> Result<f64, ErrorKind>,
) -> Result<Value, ErrorKind> {
    let v = range_numbers(ctx, &args[0])?;
    let k = ctx.number(&args[1])?;
    f(&v, k).map(Value::number)
}

function!(
    /// k-th percentile, `k` in `[0, 1]`, linear interpolation.
    Percentile, "PERCENTILE", Arity::exact(2), |args, ctx| { run(args, ctx, inc) });
function!(
    /// Same as `PERCENTILE`.
    PercentileInc, "PERCENTILE.INC", Arity::exact(2), |args, ctx| { run(args, ctx, inc) });
function!(
    /// Exclusive percentile: `k` must lie in `[1/(n+1), n/(n+1)]`.
    PercentileExc, "PERCENTILE.EXC", Arity::exact(2), |args, ctx| { run(args, ctx, exc) });
