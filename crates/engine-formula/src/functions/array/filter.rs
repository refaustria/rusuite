//! `FILTER(array, include, [if_empty])`.

use crate::ast::ErrorKind;
use crate::functions::array::Grid;
use crate::functions::helpers::present;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// The rows of `array` whose entry in the one-column `include` (of the
    /// same height) is true, or its columns by a one-row `include` of the
    /// same width. Numbers count as true when non-zero, blanks as false;
    /// text `#VALUE!`; errors propagate. No match gives `if_empty` or
    /// `#CALC!`; an `include` of another shape `#VALUE!`.
    Filter, "FILTER", Arity::range(2, 3), |args, ctx| {
    let grid = Grid::of(ctx, &args[0])?;
    let include = Grid::of(ctx, &args[1])?;
    let by_col = if include.cols == 1 && include.rows == grid.rows {
        false
    } else if include.rows == 1 && include.cols == grid.cols {
        true
    } else {
        return Err(ErrorKind::Value);
    };
    let mut keep = Vec::new();
    for (i, v) in include.data.iter().enumerate() {
        let yes = match v {
            Value::Error(e) => return Err(*e),
            Value::Number(n) => *n != 0.0,
            Value::Bool(b) => *b,
            Value::Empty => false,
            _ => return Err(ErrorKind::Value),
        };
        if yes {
            keep.push(i);
        }
    }
    if keep.is_empty() {
        return if present(ctx, args, 2) {
            Grid::of(ctx, &args[2])?.into_value()
        } else {
            Err(ErrorKind::Calc)
        };
    }
    if by_col {
        grid.transpose().pick_rows(&keep).transpose().into_value()
    } else {
        grid.pick_rows(&keep).into_value()
    }
});
