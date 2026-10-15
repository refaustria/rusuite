//! `LARGE(array, k)` and `SMALL(array, k)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::range_numbers;
use crate::functions::statistical::sorted;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

fn nth(args: &[Expr], ctx: &CallContext, largest: bool) -> Result<Value, ErrorKind> {
    let mut v = sorted(&range_numbers(ctx, &args[0])?);
    let k = ctx.number(&args[1])?.ceil();
    if v.is_empty() || k < 1.0 || k > v.len() as f64 {
        return Err(ErrorKind::Num);
    }
    if largest {
        v.reverse();
    }
    Ok(Value::Number(v[k as usize - 1]))
}

function!(
    /// The k-th largest number (k rounded up); `#NUM!` if k < 1, k > count
    /// or there are no numbers.
    Large, "LARGE", Arity::exact(2), |args, ctx| { nth(args, ctx, true) });
function!(
    /// The k-th smallest number (k rounded up); `#NUM!` if k < 1, k > count
    /// or there are no numbers.
    Small, "SMALL", Arity::exact(2), |args, ctx| { nth(args, ctx, false) });
