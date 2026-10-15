//! `SORT(array, [sort_index], [sort_order], [by_col])`.

use crate::ast::ErrorKind;
use crate::functions::array::{descending, numbers, sort_cmp, Grid};
use crate::functions::helpers::present;
use crate::functions::Arity;

function!(
    /// The rows (or with `by_col` the columns) of `array` sorted by the
    /// column (row) `sort_index` (default 1), ascending (`sort_order` 1,
    /// default) or descending (-1). `sort_index` and `sort_order` may be
    /// arrays for several keys. Stable; index out of range or an order
    /// other than ±1 `#VALUE!`.
    Sort, "SORT", Arity::range(1, 4), |args, ctx| {
    let grid = Grid::of(ctx, &args[0])?;
    let by_col = present(ctx, args, 3) && ctx.bool(&args[3])?;
    let grid = if by_col { grid.transpose() } else { grid };
    let indices = if present(ctx, args, 1) {
        numbers(ctx, &args[1])?
    } else {
        vec![1.0]
    };
    let orders = if present(ctx, args, 2) {
        numbers(ctx, &args[2])?
    } else {
        vec![1.0]
    };
    let mut keys = Vec::with_capacity(indices.len());
    for (i, idx) in indices.iter().enumerate() {
        let k = idx.trunc();
        if k < 1.0 || k > grid.cols as f64 {
            return Err(ErrorKind::Value);
        }
        let order = orders.get(i).or(orders.last()).copied().unwrap_or(1.0);
        keys.push((k as usize - 1, descending(order)?));
    }
    let mut order: Vec<usize> = (0..grid.rows).collect();
    order.sort_by(|&a, &b| {
        keys.iter()
            .map(|&(k, desc)| sort_cmp(grid.get(a, k), grid.get(b, k), desc))
            .find(|o| o.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let sorted = grid.pick_rows(&order);
    let sorted = if by_col { sorted.transpose() } else { sorted };
    sorted.into_value()
});
