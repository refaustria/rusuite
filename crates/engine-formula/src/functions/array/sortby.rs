//! `SORTBY(array, by_array1, [sort_order1], [by_array2, [sort_order2]], ...)`.

use crate::ast::ErrorKind;
use crate::functions::array::{descending, sort_cmp, Grid};
use crate::functions::helpers::present;
use crate::functions::Arity;

function!(
    /// The rows of `array` sorted by the values of one-column `by_array`s
    /// of the same height (or its columns, by one-row `by_array`s of the
    /// same width), each ascending (1, default) or descending (-1).
    /// Stable. A `by_array` of another shape, mixed orientations or an
    /// order other than ±1 `#VALUE!`.
    SortBy, "SORTBY", Arity::at_least(2), |args, ctx| {
    let grid = Grid::of(ctx, &args[0])?;
    let mut keys: Vec<(Vec<crate::value::Value>, bool)> = Vec::new();
    let mut by_col: Option<bool> = None;
    for (i, pair) in args[1..].chunks(2).enumerate() {
        let by = Grid::of(ctx, &pair[0])?;
        let cols_sort = if by.cols == 1 && by.rows == grid.rows {
            false
        } else if by.rows == 1 && by.cols == grid.cols {
            true
        } else {
            return Err(ErrorKind::Value);
        };
        if *by_col.get_or_insert(cols_sort) != cols_sort {
            return Err(ErrorKind::Value);
        }
        let desc = if present(ctx, args, 2 + 2 * i) {
            descending(ctx.number(&pair[1])?)?
        } else {
            false
        };
        keys.push((by.data, desc));
    }
    let by_col = by_col.unwrap_or(false);
    let grid = if by_col { grid.transpose() } else { grid };
    let mut order: Vec<usize> = (0..grid.rows).collect();
    order.sort_by(|&a, &b| {
        keys.iter()
            .map(|(k, desc)| sort_cmp(&k[a], &k[b], *desc))
            .find(|o| o.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let sorted = grid.pick_rows(&order);
    let sorted = if by_col { sorted.transpose() } else { sorted };
    sorted.into_value()
});
