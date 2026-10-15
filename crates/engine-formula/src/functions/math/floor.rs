//! `FLOOR(number, significance)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::{round_15, Value};

function!(
    /// Rounds down to a multiple of `significance`. Significance 0 gives
    /// `#DIV/0!`; a positive number with negative significance `#NUM!`;
    /// a negative number rounds away from zero for positive significance.
    Floor, "FLOOR", Arity::exact(2), |args, ctx| {
    let x = ctx.number(&args[0])?;
    let sig = ctx.number(&args[1])?;
    if x == 0.0 {
        return Ok(Value::Number(0.0));
    }
    if sig == 0.0 {
        return Err(ErrorKind::Div0);
    }
    if x > 0.0 && sig < 0.0 {
        return Err(ErrorKind::Num);
    }
    let q = round_15(x / sig).floor();
    Ok(Value::number(round_15(q * sig) + 0.0))
});
