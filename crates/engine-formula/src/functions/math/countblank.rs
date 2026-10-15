//! `COUNTBLANK(range)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Number of empty cells and cells holding `""` in a range.
    CountBlank, "COUNTBLANK", Arity::exact(1), |args, ctx| {
    let r = ctx.range(&args[0])?;
    let non_blank = r
        .values()
        .filter(|v| !matches!(v, Value::Empty) && !matches!(v, Value::Text(s) if s.is_empty()))
        .count();
    let total = r.rows() * r.cols();
    Ok(Value::Number(total.saturating_sub(non_blank) as f64))
});
