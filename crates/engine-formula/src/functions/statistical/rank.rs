//! `RANK`, `RANK.EQ`, `RANK.AVG`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::{opt_num, range_numbers};
use crate::functions::{Arity, CallContext};
use crate::value::{round_15, Value};

fn rank(args: &[Expr], ctx: &CallContext, average: bool) -> Result<Value, ErrorKind> {
    let x = ctx.number(&args[0])?;
    let v = range_numbers(ctx, &args[1])?;
    let ascending = opt_num(ctx, args, 2, 0.0)? != 0.0;
    let x = round_15(x);
    let eq = v.iter().filter(|&&y| round_15(y) == x).count();
    if eq == 0 {
        return Err(ErrorKind::NA);
    }
    let before = v
        .iter()
        .filter(|&&y| {
            if ascending {
                round_15(y) < x
            } else {
                round_15(y) > x
            }
        })
        .count();
    let r = before as f64 + 1.0;
    Ok(Value::Number(if average {
        r + (eq as f64 - 1.0) / 2.0
    } else {
        r
    }))
}

function!(
    /// Rank of a number in a list (descending unless `order` is non-zero);
    /// ties share the best rank; a missing number is `#N/A`.
    Rank, "RANK", Arity::range(2, 3), |args, ctx| { rank(args, ctx, false) });
function!(
    /// Same as `RANK`.
    RankEq, "RANK.EQ", Arity::range(2, 3), |args, ctx| { rank(args, ctx, false) });
function!(
    /// Like `RANK.EQ`, but ties get the average of their ranks.
    RankAvg, "RANK.AVG", Arity::range(2, 3), |args, ctx| { rank(args, ctx, true) });
