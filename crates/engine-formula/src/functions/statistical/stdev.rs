//! `STDEV`, `STDEV.S`, `STDEV.P`, `STDEVP`.

use crate::functions::statistical::var::variance;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Sample standard deviation.
    Stdev, "STDEV", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, true).map_or_else(|e| e, |v| Value::number(v.sqrt())))
});
function!(
    /// Sample standard deviation.
    StdevS, "STDEV.S", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, true).map_or_else(|e| e, |v| Value::number(v.sqrt())))
});
function!(
    /// Population standard deviation.
    StdevP, "STDEV.P", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, false).map_or_else(|e| e, |v| Value::number(v.sqrt())))
});
function!(
    /// Population standard deviation.
    StdevPLegacy, "STDEVP", Arity::range(1, 255), |args, ctx| {
    Ok(variance(args, ctx, false).map_or_else(|e| e, |v| Value::number(v.sqrt())))
});
