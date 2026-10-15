//! `LCM(number1, ...)`.

use crate::ast::ErrorKind;
use crate::functions::math::gcd::gcd;
use crate::functions::math::numbers;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Least common multiple of the truncated arguments; any zero gives 0;
    /// negative or overflowing values are `#NUM!`.
    Lcm, "LCM", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) {
        Ok(v) => v,
        Err(e) => return Ok(e),
    };
    let mut l = 1u64;
    for x in v {
        let t = x.trunc();
        if !(0.0..9.007_199_254_740_992e15).contains(&t) {
            return Err(ErrorKind::Num);
        }
        let t = t as u64;
        if t == 0 {
            l = 0;
            continue;
        }
        if l != 0 {
            l = (l / gcd(l, t)).checked_mul(t).ok_or(ErrorKind::Num)?;
            if l as f64 >= 9.007_199_254_740_992e15 {
                return Err(ErrorKind::Num);
            }
        }
    }
    Ok(Value::Number(l as f64))
});
