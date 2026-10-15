//! `CORREL`, `COVAR`, `COVARIANCE.P`, `COVARIANCE.S`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::range_pairs;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// Sums of a numeric pair list: `(n, mean_x, mean_y, sxx, syy, sxy)`.
pub(crate) fn moments(p: &[(f64, f64)]) -> (usize, f64, f64, f64, f64, f64) {
    let n = p.len();
    let mx = p.iter().map(|q| q.0).sum::<f64>() / n as f64;
    let my = p.iter().map(|q| q.1).sum::<f64>() / n as f64;
    let sxx = p.iter().map(|q| (q.0 - mx) * (q.0 - mx)).sum();
    let syy = p.iter().map(|q| (q.1 - my) * (q.1 - my)).sum();
    let sxy = p.iter().map(|q| (q.0 - mx) * (q.1 - my)).sum();
    (n, mx, my, sxx, syy, sxy)
}

fn correl(args: &[Expr], ctx: &CallContext) -> Result<Value, ErrorKind> {
    let p = range_pairs(ctx, &args[0], &args[1])?;
    if p.len() < 2 {
        return Err(ErrorKind::Div0);
    }
    let (_, _, _, sxx, syy, sxy) = moments(&p);
    if sxx == 0.0 || syy == 0.0 {
        return Err(ErrorKind::Div0);
    }
    Ok(Value::number(sxy / (sxx * syy).sqrt()))
}

fn covar(args: &[Expr], ctx: &CallContext, sample: bool) -> Result<Value, ErrorKind> {
    let p = range_pairs(ctx, &args[0], &args[1])?;
    let n = p.len();
    if n < if sample { 2 } else { 1 } {
        return Err(ErrorKind::Div0);
    }
    let (_, _, _, _, _, sxy) = moments(&p);
    Ok(Value::number(sxy / if sample { n - 1 } else { n } as f64))
}

function!(
    /// Pearson correlation of two equally sized arrays.
    Correl, "CORREL", Arity::exact(2), |args, ctx| { correl(args, ctx) });
function!(
    /// Population covariance.
    Covar, "COVAR", Arity::exact(2), |args, ctx| { covar(args, ctx, false) });
function!(
    /// Population covariance.
    CovarianceP, "COVARIANCE.P", Arity::exact(2), |args, ctx| { covar(args, ctx, false) });
function!(
    /// Sample covariance.
    CovarianceS, "COVARIANCE.S", Arity::exact(2), |args, ctx| { covar(args, ctx, true) });
