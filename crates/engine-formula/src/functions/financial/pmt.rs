//! `PMT(rate, nper, pv, [fv], [type])`.

use crate::functions::financial::{pmt, typ};
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Constant payment of a loan/annuity; `nper` 0 is `#NUM!`.
    Pmt, "PMT", Arity::range(3, 5), |args, ctx| {
    let rate = ctx.number(&args[0])?;
    let nper = ctx.number(&args[1])?;
    let pv = ctx.number(&args[2])?;
    let fv = opt_num(ctx, args, 3, 0.0)?;
    let t = typ(opt_num(ctx, args, 4, 0.0)?);
    Ok(Value::number(pmt(rate, nper, pv, fv, t)))
});
