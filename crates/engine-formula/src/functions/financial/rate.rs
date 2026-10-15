//! `RATE(nper, pmt, pv, [fv], [type], [guess])`.

use crate::ast::ErrorKind;
use crate::functions::financial::typ;
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Interest rate per period, found iteratively from `guess` (default
    /// 0.1); `#NUM!` if it does not converge or `nper <= 0`.
    Rate, "RATE", Arity::range(3, 6), |args, ctx| {
    let n = ctx.number(&args[0])?;
    let pmt = ctx.number(&args[1])?;
    let pv = ctx.number(&args[2])?;
    let fv = opt_num(ctx, args, 3, 0.0)?;
    let t = typ(opt_num(ctx, args, 4, 0.0)?);
    let guess = opt_num(ctx, args, 5, 0.1)?;
    if n <= 0.0 {
        return Err(ErrorKind::Num);
    }
    let f = |r: f64| {
        if r.abs() < 1e-10 {
            pv + pmt * n + fv
        } else {
            let p = (1.0 + r).powf(n);
            pv * p + pmt * (1.0 + r * t) * (p - 1.0) / r + fv
        }
    };
    let mut r = guess;
    for _ in 0..200 {
        let y = f(r);
        let h = 1e-7_f64.max(r.abs() * 1e-7);
        let d = (f(r + h) - f(r - h)) / (2.0 * h);
        if d == 0.0 || !d.is_finite() || !y.is_finite() {
            return Err(ErrorKind::Num);
        }
        let mut next = r - y / d;
        if next <= -1.0 {
            next = (r - 1.0) / 2.0;
        }
        if (next - r).abs() < 1e-13 {
            return Ok(Value::number(next));
        }
        r = next;
    }
    Err(ErrorKind::Num)
});
