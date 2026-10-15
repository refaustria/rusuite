//! `IRR(values, [guess])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::{opt_num, range_numbers};
use crate::functions::Arity;
use crate::value::Value;

/// Value and derivative of the NPV polynomial including period 0.
fn f(r: f64, v: &[f64]) -> (f64, f64) {
    let (mut s, mut d) = (0.0, 0.0);
    for (i, x) in v.iter().enumerate() {
        let k = i as f64;
        let p = (1.0 + r).powf(k);
        s += x / p;
        d -= k * x / (p * (1.0 + r));
    }
    (s, d)
}

pub(crate) fn solve(v: &[f64], guess: f64) -> Option<f64> {
    let mut r = guess;
    for _ in 0..100 {
        let (s, d) = f(r, v);
        if d == 0.0 || !s.is_finite() {
            break;
        }
        let next = r - s / d;
        if next <= -1.0 || !next.is_finite() {
            break;
        }
        if (next - r).abs() < 1e-12 {
            return Some(next);
        }
        r = next;
    }
    // Bracket a sign change on a grid, then bisect.
    let grid: Vec<f64> = (0..400)
        .map(|i| -0.99 + f64::from(i) * 0.01)
        .chain((1..200).map(|i| 3.0 + f64::from(i) * 5.0))
        .collect();
    for w in grid.windows(2) {
        let (a, b) = (w[0], w[1]);
        let (fa, fb) = (f(a, v).0, f(b, v).0);
        if fa == 0.0 {
            return Some(a);
        }
        if fa * fb < 0.0 {
            let (mut lo, mut hi, mut flo) = (a, b, fa);
            for _ in 0..200 {
                let mid = (lo + hi) / 2.0;
                let fm = f(mid, v).0;
                if flo * fm <= 0.0 {
                    hi = mid;
                } else {
                    lo = mid;
                    flo = fm;
                }
            }
            return Some((lo + hi) / 2.0);
        }
    }
    None
}

function!(
    /// Internal rate of return of periodic cash flows (numbers of the
    /// range; needs at least one positive and one negative value, else
    /// `#NUM!`; guess defaults to 0.1).
    Irr, "IRR", Arity::range(1, 2), |args, ctx| {
    let v = range_numbers(ctx, &args[0])?;
    let guess = opt_num(ctx, args, 1, 0.1)?;
    if !v.iter().any(|&x| x > 0.0) || !v.iter().any(|&x| x < 0.0) {
        return Err(ErrorKind::Num);
    }
    solve(&v, guess).map(Value::number).ok_or(ErrorKind::Num)
});
