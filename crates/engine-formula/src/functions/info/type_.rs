//! `TYPE(value)`.

use crate::eval::Operand;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// 1 number (and blank), 2 text, 4 logical, 16 error, 64 array
    /// (including multi-cell ranges).
    Type, "TYPE", Arity::exact(1), |args, ctx| {
    let v = match ctx.eval(&args[0]) {
        Operand::Range(r) if !r.is_single_cell() => return Ok(Value::Number(64.0)),
        Operand::Range(r) => ctx.eval_context().provider.value(crate::eval::CellCoord {
            sheet: r.sheet,
            row: r.r0,
            col: r.c0,
        }),
        Operand::Scalar(v) => v,
    };
    Ok(Value::Number(match v {
        Value::Array(_) => 64.0,
        Value::Text(_) => 2.0,
        Value::Bool(_) => 4.0,
        Value::Error(_) => 16.0,
        _ => 1.0,
    }))
});
