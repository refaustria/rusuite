//! `LOOKUP(lookup_value, lookup_vector, [result_vector])`.

use crate::ast::ErrorKind;
use crate::functions::lookup::util::{find, lookup_value, Mode, Table};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Approximate (ascending) search in a vector, returning the value at
    /// the same position of `result_vector`. Without a result vector the
    /// array form is used: the first row (or column, for tall arrays) is
    /// searched and the last row (column) returned. Not found is `#N/A`.
    Lookup, "LOOKUP", Arity::range(2, 3), |args, ctx| {
    let needle = ctx.scalar(&args[0]);
    if let Value::Error(e) = needle {
        return Err(e);
    }
    let needle = lookup_value(needle);
    let table = Table::new(ctx.range(&args[1])?);
    let pos = if args.len() == 3 {
        if table.rows > 1 && table.cols > 1 {
            return Err(ErrorKind::NA);
        }
        let result = Table::new(ctx.range(&args[2])?);
        let vertical = table.cols == 1;
        let n = if vertical { table.used_rows } else { table.used_cols };
        let i = find(&needle, n, |i| if vertical { table.get(i, 0) } else { table.get(0, i) }, Mode::Asc)
            .ok_or(ErrorKind::NA)?;
        let v = if result.cols == 1 { result.get(i, 0) } else { result.get(0, i) };
        let inside = if result.cols == 1 { i < result.rows } else { i < result.cols };
        return if inside { Ok(v) } else { Err(ErrorKind::NA) };
    } else if table.cols > table.rows {
        let i = find(&needle, table.used_cols, |i| table.get(0, i), Mode::Asc).ok_or(ErrorKind::NA)?;
        table.get(table.rows - 1, i)
    } else {
        let i = find(&needle, table.used_rows, |i| table.get(i, 0), Mode::Asc).ok_or(ErrorKind::NA)?;
        table.get(i, table.cols - 1)
    };
    Ok(pos)
});
