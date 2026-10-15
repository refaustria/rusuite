//! `ISEVEN(number)` and `ISODD(number)`.

use crate::ast::ErrorKind;
use crate::ast::Expr;
use crate::functions::{Arity, CallContext};
use crate::value::{to_number, Value};

fn parity(args: &[Expr], ctx: &CallContext) -> Result<bool, ErrorKind> {
    let v = ctx.scalar(&args[0]);
    if matches!(v, Value::Bool(_)) {
        return Err(ErrorKind::Value);
    }
    let n = to_number(&v)?.trunc();
    Ok(n % 2.0 == 0.0)
}

function!(
    /// TRUE for an even integer part; booleans and non-numeric text are `#VALUE!`.
    IsEven, "ISEVEN", Arity::exact(1), |args, ctx| { Ok(Value::Bool(parity(args, ctx)?)) });
function!(
    /// TRUE for an odd integer part; booleans and non-numeric text are `#VALUE!`.
    IsOdd, "ISODD", Arity::exact(1), |args, ctx| { Ok(Value::Bool(!parity(args, ctx)?)) });
