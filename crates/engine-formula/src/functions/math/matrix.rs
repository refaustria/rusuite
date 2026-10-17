//! Matrix functions: `MMULT`, `MINVERSE`, `MDETERM`, `MUNIT`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::{cell_count, size_arg, Grid};
use crate::functions::{Arity, CallContext};
use crate::value::Value;

/// A numeric matrix argument: every element must be a number (text,
/// booleans and blank cells are `#VALUE!`; errors propagate).
fn matrix(ctx: &CallContext, e: &Expr) -> Result<(usize, usize, Vec<f64>), ErrorKind> {
    let g = Grid::of(ctx, e)?;
    let mut out = Vec::with_capacity(g.data.len());
    for v in &g.data {
        match v {
            Value::Number(n) => out.push(*n),
            Value::Error(k) => return Err(*k),
            _ => return Err(ErrorKind::Value),
        }
    }
    Ok((g.rows, g.cols, out))
}

fn to_value(rows: usize, cols: usize, data: Vec<f64>) -> Result<Value, ErrorKind> {
    if data.iter().any(|x| !x.is_finite()) {
        return Err(ErrorKind::Num);
    }
    Grid {
        rows,
        cols,
        data: data.into_iter().map(Value::number).collect(),
    }
    .into_value()
}

/// LU decomposition with partial pivoting of the `n × n` matrix `a`
/// (row-major, in place). Returns the permutation and its sign, `None`
/// for a singular matrix.
fn lu(a: &mut [f64], n: usize) -> Option<(Vec<usize>, f64)> {
    let mut perm: Vec<usize> = (0..n).collect();
    let mut sign = 1.0;
    let scale = a.iter().fold(0.0f64, |m, x| m.max(x.abs())).max(1e-300);
    for k in 0..n {
        let p = (k..n).max_by(|&i, &j| a[i * n + k].abs().total_cmp(&a[j * n + k].abs()))?;
        if a[p * n + k].abs() <= scale * 1e-15 {
            return None;
        }
        if p != k {
            for c in 0..n {
                a.swap(p * n + c, k * n + c);
            }
            perm.swap(p, k);
            sign = -sign;
        }
        for i in k + 1..n {
            let f = a[i * n + k] / a[k * n + k];
            a[i * n + k] = f;
            for c in k + 1..n {
                a[i * n + c] -= f * a[k * n + c];
            }
        }
    }
    Some((perm, sign))
}

function!(
    /// The matrix product of two arrays: the columns of the first must
    /// equal the rows of the second (`#VALUE!` otherwise, and for any
    /// non-numeric element).
    MMult, "MMULT", Arity::exact(2), |args, ctx| {
    let (ar, ac, a) = matrix(ctx, &args[0])?;
    let (br, bc, b) = matrix(ctx, &args[1])?;
    if ac != br {
        return Err(ErrorKind::Value);
    }
    cell_count(ar, bc)?;
    let mut out = vec![0.0; ar * bc];
    for i in 0..ar {
        for j in 0..bc {
            out[i * bc + j] = (0..ac).map(|k| a[i * ac + k] * b[k * bc + j]).sum();
        }
    }
    to_value(ar, bc, out)
});

function!(
    /// The inverse of a square matrix; not square or non-numeric
    /// `#VALUE!`, singular `#NUM!`.
    MInverse, "MINVERSE", Arity::exact(1), |args, ctx| {
    let (r, c, mut a) = matrix(ctx, &args[0])?;
    if r != c {
        return Err(ErrorKind::Value);
    }
    let n = r;
    let (perm, _) = lu(&mut a, n).ok_or(ErrorKind::Num)?;
    let mut inv = vec![0.0; n * n];
    for col in 0..n {
        // Solve L U x = P e_col.
        let mut x: Vec<f64> = (0..n).map(|i| if perm[i] == col { 1.0 } else { 0.0 }).collect();
        for i in 0..n {
            for k in 0..i {
                x[i] -= a[i * n + k] * x[k];
            }
        }
        for i in (0..n).rev() {
            for k in i + 1..n {
                x[i] -= a[i * n + k] * x[k];
            }
            x[i] /= a[i * n + i];
        }
        for i in 0..n {
            inv[i * n + col] = x[i];
        }
    }
    to_value(n, n, inv)
});

function!(
    /// The determinant of a square matrix; not square or non-numeric
    /// `#VALUE!`; a singular matrix gives 0.
    MDeterm, "MDETERM", Arity::exact(1), |args, ctx| {
    let (r, c, mut a) = matrix(ctx, &args[0])?;
    if r != c {
        return Err(ErrorKind::Value);
    }
    let Some((_, sign)) = lu(&mut a, r) else {
        return Ok(Value::Number(0.0));
    };
    let det = (0..r).fold(sign, |d, i| d * a[i * r + i]);
    if !det.is_finite() {
        return Err(ErrorKind::Num);
    }
    Ok(Value::number(det))
});

function!(
    /// The `n × n` identity matrix; `n` below 1 `#VALUE!`. Stored as
    /// `_xlfn.MUNIT`.
    MUnit, "MUNIT", Arity::exact(1), |args, ctx| {
    let n = size_arg(ctx.number(&args[0])?).map_err(|_| ErrorKind::Value)?;
    cell_count(n, n)?;
    let data = (0..n * n).map(|i| if i / n == i % n { 1.0 } else { 0.0 }).collect();
    to_value(n, n, data)
});
