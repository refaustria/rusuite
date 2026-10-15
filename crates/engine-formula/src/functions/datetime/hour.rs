//! `HOUR`, `MINUTE`, `SECOND`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::{date_arg, serial_day_hms};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn hms(args: &[Expr], ctx: &CallContext) -> Result<(u32, u32, u32), ErrorKind> {
    let s = date_arg(ctx, &args[0])?;
    let (_, h, m, sec) = serial_day_hms(s).ok_or(ErrorKind::Num)?;
    Ok((h, m, sec))
}

function!(
    /// Hour 0..=23 of a serial or time text (time rounded to the second);
    /// negative serials are `#NUM!`.
    Hour, "HOUR", Arity::exact(1), |args, ctx| { Ok(Value::Number(f64::from(hms(args, ctx)?.0))) });
function!(
    /// Minute 0..=59 of a serial or time text.
    Minute, "MINUTE", Arity::exact(1), |args, ctx| { Ok(Value::Number(f64::from(hms(args, ctx)?.1))) });
function!(
    /// Second 0..=59 of a serial or time text.
    Second, "SECOND", Arity::exact(1), |args, ctx| { Ok(Value::Number(f64::from(hms(args, ctx)?.2))) });
