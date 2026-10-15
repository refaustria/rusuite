//! `SUMIFS(sum_range, criteria_range1, criteria1, ...)`.

use crate::functions::math::criteria::{at, matching_offsets};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Sum of the numeric cells of `sum_range` where all criteria hold.
    /// All ranges need the same shape (`#VALUE!`). Errors in matching sum
    /// cells propagate.
    SumIfs, "SUMIFS", Arity::range(3, 255), |args, ctx| {
    let sum = ctx.range(&args[0])?;
    let hits = matching_offsets(ctx, &sum, &args[1..])?;
    let mut total = 0.0;
    for (r, c) in hits {
        match at(&sum, r, c) {
            Some(Value::Number(n)) => total += n,
            Some(Value::Error(e)) => return Err(e),
            _ => {}
        }
    }
    Ok(Value::number(total))
});
