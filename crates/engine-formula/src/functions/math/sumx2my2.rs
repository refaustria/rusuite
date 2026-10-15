//! `SUMX2MY2`, `SUMX2PY2`, `SUMXMY2`.

use crate::functions::helpers::range_pairs;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Sum of `x^2 - y^2` over numeric pairs; size mismatch is `#N/A`.
    SumX2My2, "SUMX2MY2", Arity::exact(2), |args, ctx| {
    let p = range_pairs(ctx, &args[0], &args[1])?;
    Ok(Value::number(p.iter().map(|(x, y)| x * x - y * y).sum()))
});
function!(
    /// Sum of `x^2 + y^2` over numeric pairs; size mismatch is `#N/A`.
    SumX2Py2, "SUMX2PY2", Arity::exact(2), |args, ctx| {
    let p = range_pairs(ctx, &args[0], &args[1])?;
    Ok(Value::number(p.iter().map(|(x, y)| x * x + y * y).sum()))
});
function!(
    /// Sum of `(x - y)^2` over numeric pairs; size mismatch is `#N/A`.
    SumXMy2, "SUMXMY2", Arity::exact(2), |args, ctx| {
    let p = range_pairs(ctx, &args[0], &args[1])?;
    Ok(Value::number(p.iter().map(|(x, y)| (x - y) * (x - y)).sum()))
});
