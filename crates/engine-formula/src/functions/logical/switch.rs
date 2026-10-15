//! `SWITCH(expression, value1, result1, ..., [default])`.

use std::cmp::Ordering;

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::{compare, Value};

function!(
    /// Result for the first value equal to the expression (texts compare
    /// case-insensitively, a number never equals text); otherwise the
    /// trailing default, or `#N/A` without one. Only the selected result
    /// is evaluated.
    Switch, "SWITCH", Arity::range(3, 254), |args, ctx| {
    let subject = ctx.scalar(&args[0]);
    if let Value::Error(e) = subject {
        return Err(e);
    }
    let rest = &args[1..];
    for pair in rest.chunks(2) {
        if pair.len() == 1 {
            return Ok(ctx.scalar(&pair[0]));
        }
        let candidate = ctx.scalar(&pair[0]);
        if compare(&subject, &candidate)? == Ordering::Equal {
            return Ok(ctx.scalar(&pair[1]));
        }
    }
    Err(ErrorKind::NA)
});
