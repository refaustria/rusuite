//! `IPMT(rate, per, nper, pv, [fv], [type])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::financial::{fv, pmt, typ};
use crate::functions::helpers::opt_num;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// `(interest, payment)` of period `per`.
pub(crate) fn split(args: &[Expr], ctx: &CallContext) -> Result<(f64, f64), ErrorKind> {
    let rate = ctx.number(&args[0])?;
    let per = ctx.number(&args[1])?;
    let nper = ctx.number(&args[2])?;
    let pv = ctx.number(&args[3])?;
    let fvv = opt_num(ctx, args, 4, 0.0)?;
    let t = typ(opt_num(ctx, args, 5, 0.0)?);
    if per < 1.0 || per > nper {
        return Err(ErrorKind::Num);
    }
    let p = pmt(rate, nper, pv, fvv, t);
    let interest = if per == 1.0 {
        if t > 0.0 {
            0.0
        } else {
            -pv * rate
        }
    } else if t > 0.0 {
        (fv(rate, per - 2.0, p, pv, 1.0) - p) * rate
    } else {
        fv(rate, per - 1.0, p, pv, 0.0) * rate
    };
    Ok((interest, p))
}

function!(
    /// Interest part of the payment of period `per` (1..=nper, else `#NUM!`).
    IPmt, "IPMT", Arity::range(4, 6), |args, ctx| {
    let (interest, _) = split(args, ctx)?;
    Ok(Value::number(interest))
});
