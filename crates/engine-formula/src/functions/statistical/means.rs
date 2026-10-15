//! `GEOMEAN`, `HARMEAN`, `DEVSQ`, `AVEDEV`.

use crate::ast::ErrorKind;
use crate::functions::math::numbers;
use crate::functions::statistical::{mean, sum_sq_dev};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Geometric mean; any value <= 0 or no values is `#NUM!`.
    GeoMean, "GEOMEAN", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) { Ok(v) => v, Err(e) => return Ok(e) };
    if v.is_empty() || v.iter().any(|&x| x <= 0.0) {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number((v.iter().map(|x| x.ln()).sum::<f64>() / v.len() as f64).exp()))
});
function!(
    /// Harmonic mean; any value <= 0 or no values is `#NUM!`.
    HarMean, "HARMEAN", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) { Ok(v) => v, Err(e) => return Ok(e) };
    if v.is_empty() || v.iter().any(|&x| x <= 0.0) {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number(v.len() as f64 / v.iter().map(|x| 1.0 / x).sum::<f64>()))
});
function!(
    /// Sum of squared deviations from the mean; no values is `#NUM!`.
    DevSq, "DEVSQ", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) { Ok(v) => v, Err(e) => return Ok(e) };
    if v.is_empty() {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number(sum_sq_dev(&v)))
});
function!(
    /// Mean absolute deviation from the mean; no values is `#NUM!`.
    AveDev, "AVEDEV", Arity::range(1, 255), |args, ctx| {
    let v = match numbers(args, ctx) { Ok(v) => v, Err(e) => return Ok(e) };
    if v.is_empty() {
        return Err(ErrorKind::Num);
    }
    let m = mean(&v);
    Ok(Value::number(v.iter().map(|x| (x - m).abs()).sum::<f64>() / v.len() as f64))
});
