//! `OFFSET(reference, rows, cols, [height], [width])`.

use crate::ast::{ErrorKind, Expr, MAX_COL, MAX_ROW};
use crate::eval::{range_value, Operand, RangeRef};
use crate::functions::helpers::present;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

fn target(args: &[Expr], ctx: &CallContext) -> Result<RangeRef, ErrorKind> {
    let base = match ctx.eval_ref(&args[0]) {
        Operand::Range(r) => r,
        Operand::Scalar(Value::Error(e)) => return Err(e),
        Operand::Scalar(_) => return Err(ErrorKind::Value),
    };
    let rows = ctx.number(&args[1])?.trunc();
    let cols = ctx.number(&args[2])?.trunc();
    let h = if present(ctx, args, 3) {
        ctx.number(&args[3])?.trunc()
    } else {
        f64::from(base.rows())
    };
    let w = if present(ctx, args, 4) {
        ctx.number(&args[4])?.trunc()
    } else {
        f64::from(base.cols())
    };
    if h < 1.0 || w < 1.0 {
        return Err(ErrorKind::Ref);
    }
    let r0 = f64::from(base.r0) + rows;
    let c0 = f64::from(base.c0) + cols;
    let r1 = r0 + h - 1.0;
    let c1 = c0 + w - 1.0;
    if r0 < 0.0 || c0 < 0.0 || r1 > f64::from(MAX_ROW) || c1 > f64::from(MAX_COL) {
        return Err(ErrorKind::Ref);
    }
    Ok(RangeRef {
        sheet: base.sheet,
        r0: r0 as u32,
        c0: c0 as u32,
        r1: r1 as u32,
        c1: c1 as u32,
    })
}

/// A reference displaced from a start reference by rows/columns and
/// optionally resized. Out of the sheet or non-positive size is `#REF!`;
/// a non-reference first argument is `#VALUE!`. Volatile. Usable wherever
/// a reference is expected (`SUM(OFFSET(A1,1,0,3,1))`).
pub struct Offset;

impl Function for Offset {
    fn name(&self) -> &'static str {
        "OFFSET"
    }
    fn arity(&self) -> Arity {
        Arity::range(3, 5)
    }
    fn is_volatile(&self) -> bool {
        true
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match target(args, ctx) {
            Ok(r) => range_value(r, ctx.eval_context()),
            Err(e) => Value::Error(e),
        }
    }
    fn call_ref(&self, args: &[Expr], ctx: &mut CallContext) -> Option<Operand> {
        Some(match target(args, ctx) {
            Ok(r) => Operand::Range(r),
            Err(e) => Operand::Scalar(Value::Error(e)),
        })
    }
}
