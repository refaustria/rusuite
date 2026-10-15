//! `TREND(known_y's, [known_x's], [new_x's], [const])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::{flat_values, opt_num, present};
use crate::functions::Arity;
use crate::value::{Array, Value};

fn numbers_of(vals: Vec<Value>) -> Result<Vec<f64>, ErrorKind> {
    vals.into_iter()
        .map(|v| match v {
            Value::Number(n) => Ok(n),
            Value::Error(e) => Err(e),
            _ => Err(ErrorKind::Value),
        })
        .collect()
}

function!(
    /// Least-squares line predictions for one independent variable. Without
    /// `known_x's` the x values are 1..n; without `new_x's` the known x
    /// values are used; the result has the shape of `new_x's`. A fourth
    /// argument of FALSE forces the line through the origin. Several
    /// independent variables are not supported (`#REF!`).
    Trend, "TREND", Arity::range(1, 4), |args, ctx| {
    let y = numbers_of(flat_values(ctx, &args[0])?)?;
    let n = y.len();
    if n == 0 {
        return Err(ErrorKind::Value);
    }
    let x: Vec<f64> = if present(ctx, args, 1) {
        let x = numbers_of(flat_values(ctx, &args[1])?)?;
        if x.len() != n {
            return Err(ErrorKind::Ref);
        }
        x
    } else {
        (1..=n).map(|i| i as f64).collect()
    };
    let (new_x, rows, cols) = if present(ctx, args, 2) {
        let r = ctx.range(&args[2])?;
        let (rows, cols) = (r.rows(), r.cols());
        (numbers_of(r.values().collect())?, rows, cols)
    } else if present(ctx, args, 1) {
        let r = ctx.range(&args[1])?;
        (x.clone(), r.rows(), r.cols())
    } else {
        (x.clone(), n, 1)
    };
    let with_const = opt_num(ctx, args, 3, 1.0)? != 0.0;
    let (a, b) = if with_const {
        let mx = x.iter().sum::<f64>() / n as f64;
        let my = y.iter().sum::<f64>() / n as f64;
        let sxx: f64 = x.iter().map(|v| (v - mx) * (v - mx)).sum();
        if sxx == 0.0 {
            return Err(ErrorKind::Num);
        }
        let sxy: f64 = x.iter().zip(&y).map(|(p, q)| (p - mx) * (q - my)).sum();
        (my - sxy / sxx * mx, sxy / sxx)
    } else {
        let sxx: f64 = x.iter().map(|v| v * v).sum();
        if sxx == 0.0 {
            return Err(ErrorKind::Num);
        }
        (0.0, x.iter().zip(&y).map(|(p, q)| p * q).sum::<f64>() / sxx)
    };
    let data = new_x.iter().map(|&v| Value::number(a + b * v)).collect();
    Array::new(rows, cols, data).map(Value::Array).ok_or(ErrorKind::Value)
});
