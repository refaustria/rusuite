//! `MODE(number1, ...)` and `MODE.SNGL`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::math::numbers;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn mode(args: &[Expr], ctx: &CallContext) -> Result<Value, ErrorKind> {
    let v = match numbers(args, ctx) {
        Ok(v) => v,
        Err(e) => return Ok(e),
    };
    let mut best: Option<(f64, usize)> = None;
    for &x in &v {
        let count = v.iter().filter(|&&y| y == x).count();
        if count > best.map_or(1, |b| b.1) {
            best = Some((x, count));
        }
    }
    best.map(|b| Value::Number(b.0)).ok_or(ErrorKind::NA)
}

function!(
    /// Most frequent value (the first one in order of appearance among
    /// ties); no repeated value is `#N/A`.
    Mode, "MODE", Arity::range(1, 255), |args, ctx| { mode(args, ctx) });
function!(
    /// Same as `MODE`.
    ModeSngl, "MODE.SNGL", Arity::range(1, 255), |args, ctx| { mode(args, ctx) });
