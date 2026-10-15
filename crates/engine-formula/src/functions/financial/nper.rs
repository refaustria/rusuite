//! `NPER(rate, pmt, pv, [fv], [type])`.

use crate::ast::ErrorKind;
use crate::functions::financial::typ;
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Number of payment periods; unreachable targets are `#NUM!`.
    NPer, "NPER", Arity::range(3, 5), |args, ctx| {
    let rate = ctx.number(&args[0])?;
    let pmt = ctx.number(&args[1])?;
    let pv = ctx.number(&args[2])?;
    let fv = opt_num(ctx, args, 3, 0.0)?;
    let t = typ(opt_num(ctx, args, 4, 0.0)?);
    if rate == 0.0 {
        if pmt == 0.0 {
            return Err(ErrorKind::Num);
        }
        return Ok(Value::number(-(pv + fv) / pmt));
    }
    let z = pmt * (1.0 + rate * t);
    let ratio = (z - fv * rate) / (z + pv * rate);
    if ratio <= 0.0 || rate <= -1.0 {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number(ratio.ln() / (1.0 + rate).ln()))
});
