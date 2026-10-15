//! `PV(rate, nper, pmt, [fv], [type])`.

use crate::functions::financial::typ;
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Present value of regular payments.
    Pv, "PV", Arity::range(3, 5), |args, ctx| {
    let rate = ctx.number(&args[0])?;
    let nper = ctx.number(&args[1])?;
    let pmt = ctx.number(&args[2])?;
    let fv = opt_num(ctx, args, 3, 0.0)?;
    let t = typ(opt_num(ctx, args, 4, 0.0)?);
    if rate == 0.0 {
        return Ok(Value::number(-(fv + pmt * nper)));
    }
    let p = (1.0 + rate).powf(nper);
    Ok(Value::number(-(fv + pmt * (1.0 + rate * t) * (p - 1.0) / rate) / p))
});
