//! `MEDIAN(number1, ...)`.

use crate::ast::ErrorKind;
use crate::functions::math::numbers;
use crate::functions::statistical::sorted;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Middle value (mean of the two middle values for an even count)
    /// under the SUM argument rules; no numbers is `#NUM!`.
    Median, "MEDIAN", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) {
        Ok(v) => v,
        Err(e) => return Ok(e),
    };
    if v.is_empty() {
        return Err(ErrorKind::Num);
    }
    let s = sorted(&v);
    let n = s.len();
    Ok(Value::number(if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 }))
});
