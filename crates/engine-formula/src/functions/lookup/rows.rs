//! `ROWS(array)` and `COLUMNS(array)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Number of rows of a reference or array (whole-column references
    /// count all 1048576 rows).
    Rows, "ROWS", Arity::exact(1), |args, ctx| {
    Ok(Value::Number(ctx.range(&args[0])?.rows() as f64))
});
function!(
    /// Number of columns of a reference or array.
    Columns, "COLUMNS", Arity::exact(1), |args, ctx| {
    Ok(Value::Number(ctx.range(&args[0])?.cols() as f64))
});
