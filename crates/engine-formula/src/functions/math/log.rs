//! `LOG(number, [base])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::{round_15, Value};

function!(
    /// Logarithm in `base` (default 10). `number` or `base <= 0` is
    /// `#NUM!`; base 1 is `#DIV/0!`.
    Log, "LOG", Arity::range(1, 2), |args, ctx| {
    let x = ctx.number(&args[0])?;
    let b = opt_num(ctx, args, 1, 10.0)?;
    if x <= 0.0 || b <= 0.0 {
        return Err(ErrorKind::Num);
    }
    if b == 1.0 {
        return Err(ErrorKind::Div0);
    }
    let r = if b == 10.0 { x.log10() } else { x.ln() / b.ln() };
    Ok(Value::number(round_15(r)))
});
