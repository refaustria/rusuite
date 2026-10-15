//! `PERCENTRANK`, `PERCENTRANK.INC`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::{opt_num, range_numbers};
use crate::functions::statistical::sorted;
use crate::functions::{Arity, CallContext};
use crate::value::{round_15, Value};

fn run(args: &[Expr], ctx: &CallContext) -> Result<Value, ErrorKind> {
    let v = sorted(&range_numbers(ctx, &args[0])?);
    let x = ctx.number(&args[1])?;
    let sig = opt_num(ctx, args, 2, 3.0)?.trunc();
    if sig < 1.0 {
        return Err(ErrorKind::Num);
    }
    let n = v.len();
    if n == 0 {
        return Err(ErrorKind::Num);
    }
    if x < v[0] || x > v[n - 1] {
        return Err(ErrorKind::NA);
    }
    let r = if n == 1 {
        1.0
    } else if let Some(i) = v.iter().position(|&y| y == x) {
        i as f64 / (n - 1) as f64
    } else {
        let i = v.iter().rposition(|&y| y < x).unwrap_or(0);
        (i as f64 + (x - v[i]) / (v[i + 1] - v[i])) / (n - 1) as f64
    };
    let p = 10f64.powi(sig.min(15.0) as i32);
    Ok(Value::number(round_15((round_15(r * p)).floor() / p)))
}

function!(
    /// Relative rank of `x` in an array as a fraction in `[0, 1]`
    /// (truncated to `significance` digits, default 3); outside the data
    /// range is `#N/A`.
    PercentRank, "PERCENTRANK", Arity::range(2, 3), |args, ctx| { run(args, ctx) });
function!(
    /// Same as `PERCENTRANK`.
    PercentRankInc, "PERCENTRANK.INC", Arity::range(2, 3), |args, ctx| { run(args, ctx) });
