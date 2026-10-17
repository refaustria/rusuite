//! `AREAS(reference)`.

use crate::ast::{BinaryOp, ErrorKind, Expr};
use crate::eval::{areas_of, Operand};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Number of areas of a reference: a union `(A1:B2,D4)` has one per
    /// operand, a 3-D reference one per sheet, any other reference one.
    /// A value that is not a reference is `#VALUE!`.
    Areas, "AREAS", Arity::exact(1), |args, ctx| {
    let e = &args[0];
    let multi = matches!(e, Expr::Binary { op: BinaryOp::Union, .. })
        || matches!(e, Expr::Reference(r) if r.is_3d());
    if multi {
        let parts = areas_of(e, ctx.eval_context().provider);
        let mut n = 0.0;
        for p in &parts {
            match ctx.eval_ref(p) {
                Operand::Range(_) => n += 1.0,
                Operand::Scalar(Value::Error(k)) => return Err(k),
                Operand::Scalar(_) => return Err(ErrorKind::Value),
            }
        }
        return Ok(Value::Number(n));
    }
    match ctx.eval_ref(e) {
        Operand::Range(_) => Ok(Value::Number(1.0)),
        Operand::Scalar(Value::Error(k)) => Err(k),
        Operand::Scalar(_) => Err(ErrorKind::Value),
    }
});
