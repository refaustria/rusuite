//! `SLOPE`, `INTERCEPT`, `RSQ`, `FORECAST`, `FORECAST.LINEAR`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::range_pairs;
use crate::functions::statistical::correl::moments;
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// `(slope, intercept, r_squared)` of `known_y` (`args[0]`) on `known_x`
/// (`args[1]`); `#DIV/0!` without variance in x.
fn fit(args: &[Expr], ctx: &CallContext) -> Result<(f64, f64, f64), ErrorKind> {
    let p = range_pairs(ctx, &args[0], &args[1])?;
    if p.len() < 2 {
        return Err(ErrorKind::Div0);
    }
    let q: Vec<(f64, f64)> = p.iter().map(|&(y, x)| (x, y)).collect();
    let (_, mx, my, sxx, syy, sxy) = moments(&q);
    if sxx == 0.0 {
        return Err(ErrorKind::Div0);
    }
    let slope = sxy / sxx;
    let r2 = if syy == 0.0 {
        return Err(ErrorKind::Div0);
    } else {
        sxy * sxy / (sxx * syy)
    };
    Ok((slope, my - slope * mx, r2))
}

fn forecast(args: &[Expr], ctx: &CallContext) -> Result<Value, ErrorKind> {
    let x = ctx.number(&args[0])?;
    let (b, a, _) = fit(&args[1..], ctx)?;
    Ok(Value::number(a + b * x))
}

function!(
    /// Slope of the least-squares line through `known_y's`, `known_x's`.
    Slope, "SLOPE", Arity::exact(2), |args, ctx| { fit(args, ctx).map(|f| Value::number(f.0)) });
function!(
    /// Intercept of the least-squares line.
    Intercept, "INTERCEPT", Arity::exact(2), |args, ctx| { fit(args, ctx).map(|f| Value::number(f.1)) });
function!(
    /// Squared Pearson correlation.
    Rsq, "RSQ", Arity::exact(2), |args, ctx| { fit(args, ctx).map(|f| Value::number(f.2)) });
function!(
    /// Predicted y for `x` on the least-squares line: `FORECAST(x, known_y's, known_x's)`.
    Forecast, "FORECAST", Arity::exact(3), |args, ctx| { forecast(args, ctx) });
function!(
    /// Same as `FORECAST`.
    ForecastLinear, "FORECAST.LINEAR", Arity::exact(3), |args, ctx| { forecast(args, ctx) });
