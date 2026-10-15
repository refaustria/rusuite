//! `COUNTIFS(criteria_range1, criteria1, ...)`.

use crate::functions::math::criteria::matching_offsets;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Number of cells where all criteria hold; ranges need the same shape.
    CountIfs, "COUNTIFS", Arity::range(2, 254), |args, ctx| {
    let first = ctx.range(&args[0])?;
    let hits = matching_offsets(ctx, &first, args)?;
    Ok(Value::Number(hits.len() as f64))
});
