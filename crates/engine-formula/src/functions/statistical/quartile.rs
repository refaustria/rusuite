//! `QUARTILE`, `QUARTILE.INC`, `QUARTILE.EXC`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::range_numbers;
use crate::functions::statistical::percentile::{exc, inc};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn run(args: &[Expr], ctx: &CallContext, exclusive: bool) -> Result<Value, ErrorKind> {
    let v = range_numbers(ctx, &args[0])?;
    let q = ctx.number(&args[1])?.trunc();
    let ok = if exclusive {
        (1.0..=3.0).contains(&q)
    } else {
        (0.0..=4.0).contains(&q)
    };
    if !ok {
        return Err(ErrorKind::Num);
    }
    let r = if exclusive {
        exc(&v, q / 4.0)
    } else {
        inc(&v, q / 4.0)
    };
    r.map(Value::number)
}

function!(
    /// Quartile 0..4 (0 = minimum, 4 = maximum), inclusive method.
    Quartile, "QUARTILE", Arity::exact(2), |args, ctx| { run(args, ctx, false) });
function!(
    /// Same as `QUARTILE`.
    QuartileInc, "QUARTILE.INC", Arity::exact(2), |args, ctx| { run(args, ctx, false) });
function!(
    /// Quartile 1..3, exclusive method.
    QuartileExc, "QUARTILE.EXC", Arity::exact(2), |args, ctx| { run(args, ctx, true) });
