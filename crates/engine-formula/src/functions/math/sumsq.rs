//! `SUMSQ(number1, ...)`.

use crate::functions::math::numbers;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Sum of squares under the SUM argument rules.
    SumSq, "SUMSQ", Arity::range(1, 255), |args, ctx| {
    match numbers(args, ctx) {
        Ok(v) => Ok(Value::number(v.iter().map(|x| x * x).sum())),
        Err(e) => Ok(e),
    }
});
