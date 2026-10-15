//! `AVERAGEIFS(average_range, criteria_range1, criteria1, ...)`.

use crate::ast::ErrorKind;
use crate::functions::math::criteria::{at, matching_offsets};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Mean of the numeric cells of `average_range` where all criteria
    /// hold; no numeric match is `#DIV/0!`.
    AverageIfs, "AVERAGEIFS", Arity::range(3, 255), |args, ctx| {
    let avg = ctx.range(&args[0])?;
    let hits = matching_offsets(ctx, &avg, &args[1..])?;
    let (mut total, mut n) = (0.0, 0usize);
    for (r, c) in hits {
        match at(&avg, r, c) {
            Some(Value::Number(x)) => {
                total += x;
                n += 1;
            }
            Some(Value::Error(e)) => return Err(e),
            _ => {}
        }
    }
    if n == 0 {
        return Err(ErrorKind::Div0);
    }
    Ok(Value::number(total / n as f64))
});
