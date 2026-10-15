//! `GCD(number1, ...)`.

use crate::ast::ErrorKind;
use crate::functions::math::numbers;
use crate::functions::Arity;
use crate::value::Value;

pub(crate) fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

function!(
    /// Greatest common divisor of the truncated arguments; negative or
    /// 2^53 and larger values are `#NUM!`.
    Gcd, "GCD", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) {
        Ok(v) => v,
        Err(e) => return Ok(e),
    };
    let mut g = 0u64;
    for x in v {
        let t = x.trunc();
        if !(0.0..9.007_199_254_740_992e15).contains(&t) {
            return Err(ErrorKind::Num);
        }
        g = gcd(g, t as u64);
    }
    Ok(Value::Number(g as f64))
});
