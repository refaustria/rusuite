//! `FV(rate, nper, pmt, [pv], [type])`.

use crate::functions::financial::{fv, typ};
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Future value of regular payments.
    Fv, "FV", Arity::range(3, 5), |args, ctx| {
    let rate = ctx.number(&args[0])?;
    let nper = ctx.number(&args[1])?;
    let pmt = ctx.number(&args[2])?;
    let pv = opt_num(ctx, args, 3, 0.0)?;
    let t = typ(opt_num(ctx, args, 4, 0.0)?);
    Ok(Value::number(fv(rate, nper, pmt, pv, t)))
});
