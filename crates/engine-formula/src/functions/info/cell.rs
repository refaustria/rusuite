//! `CELL(info_type, [reference])` (basic subset).

use crate::ast::{col_to_letters, ErrorKind};
use crate::eval::{CellCoord, Operand};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Information about the top-left cell of `reference` (default: the
    /// formula cell). Supported `info_type` values: `"address"` (`$A$1`),
    /// `"row"`, `"col"`, `"contents"`, `"type"` (`b` blank, `l` text,
    /// `v` anything else). Others are `#VALUE!`.
    Cell, "CELL", Arity::range(1, 2), |args, ctx| {
    let kind = ctx.text(&args[0])?.to_ascii_lowercase();
    let at = match args.get(1) {
        Some(e) => match ctx.eval_ref(e) {
            Operand::Range(r) => CellCoord { sheet: r.sheet, row: r.r0, col: r.c0 },
            Operand::Scalar(Value::Error(k)) => return Err(k),
            Operand::Scalar(_) => return Err(ErrorKind::Value),
        },
        None => ctx.current(),
    };
    let value = || ctx.eval_context().provider.value(at);
    Ok(match kind.as_str() {
        "address" => Value::Text(format!("${}${}", col_to_letters(at.col), at.row + 1)),
        "row" => Value::Number(f64::from(at.row) + 1.0),
        "col" => Value::Number(f64::from(at.col) + 1.0),
        "contents" => match value() {
            Value::Empty => Value::Number(0.0),
            v => v.into_scalar(),
        },
        "type" => Value::Text(
            match value() {
                Value::Empty => "b",
                Value::Text(_) => "l",
                _ => "v",
            }
            .to_string(),
        ),
        _ => return Err(ErrorKind::Value),
    })
});
