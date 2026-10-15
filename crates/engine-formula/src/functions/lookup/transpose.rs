//! `TRANSPOSE(array)`.

use crate::ast::ErrorKind;
use crate::functions::lookup::util::Table;
use crate::functions::Arity;
use crate::value::{Array, Value};

function!(
    /// The array with rows and columns swapped (whole-column/row
    /// references are limited to the used range). Without spilling, a cell
    /// shows the top-left element.
    Transpose, "TRANSPOSE", Arity::exact(1), |args, ctx| {
    let t = Table::new(ctx.range(&args[0])?);
    let nr = t.used_rows.clamp(1, t.rows);
    let nc = t.used_cols.clamp(1, t.cols);
    let mut data = Vec::with_capacity(nr * nc);
    for c in 0..nc {
        for r in 0..nr {
            data.push(t.get(r, c));
        }
    }
    Array::new(nc, nr, data).map(Value::Array).ok_or(ErrorKind::Value)
});
