//! `UNIQUE(array, [by_col], [exactly_once])`.

use crate::functions::array::{same, Grid};
use crate::functions::helpers::present;
use crate::functions::Arity;

function!(
    /// The distinct rows of `array` (with `by_col` its distinct columns)
    /// in order of first occurrence; with `exactly_once` only the rows
    /// that occur once. Text compares case-insensitively. An empty result
    /// `#CALC!`.
    Unique, "UNIQUE", Arity::range(1, 3), |args, ctx| {
    let grid = Grid::of(ctx, &args[0])?;
    let by_col = present(ctx, args, 1) && ctx.bool(&args[1])?;
    let once = present(ctx, args, 2) && ctx.bool(&args[2])?;
    let grid = if by_col { grid.transpose() } else { grid };
    let equal = |a: usize, b: usize| {
        grid.row(a)
            .iter()
            .zip(grid.row(b))
            .all(|(x, y)| same(x, y))
    };
    // First occurrence of each row and how often it occurs.
    let mut firsts: Vec<(usize, usize)> = Vec::new();
    for r in 0..grid.rows {
        match firsts.iter_mut().find(|(f, _)| equal(*f, r)) {
            Some((_, n)) => *n += 1,
            None => firsts.push((r, 1)),
        }
    }
    let rows: Vec<usize> = firsts
        .into_iter()
        .filter(|&(_, n)| !once || n == 1)
        .map(|(r, _)| r)
        .collect();
    let out = grid.pick_rows(&rows);
    let out = if by_col { out.transpose() } else { out };
    out.into_value()
});
