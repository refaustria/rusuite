//! `COLUMN([reference])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::reference_arg;
use crate::functions::{Arity, CallContext, Function};
use crate::value::{Array, Value};

/// Column number of a reference (1-based); a multi-column reference gives
/// a row array. Without argument: the host cell's column.
pub struct Column;

impl Function for Column {
    fn name(&self) -> &'static str {
        "COLUMN"
    }

    fn arity(&self) -> Arity {
        Arity::range(0, 1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let Some(e) = args.first().filter(|e| !ctx.is_missing(e)) else {
            return Value::Number(f64::from(ctx.current().col) + 1.0);
        };
        let r = match reference_arg(e, ctx) {
            Ok(r) => r,
            Err(k) => return Value::Error(k),
        };
        let first = Value::Number(f64::from(r.c0) + 1.0);
        if r.cols() == 1 || r.is_whole_rows() {
            return first;
        }
        let data = (r.c0..=r.c1)
            .map(|n| Value::Number(f64::from(n) + 1.0))
            .collect();
        Array::new(1, r.cols() as usize, data)
            .map(Value::Array)
            .unwrap_or(Value::Error(ErrorKind::Value))
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn columns() {
        assert_eq!(eval("=COLUMN(C5)"), Value::Number(3.0));
        assert_eq!(eval("=COLUMN()"), Value::Number(10.0));
        assert_eq!(eval("=SUM(COLUMN(A1:C1))"), Value::Number(6.0));
        assert_eq!(eval("=COLUMN(XFD1)"), Value::Number(16384.0));
        assert_eq!(eval("=COLUMN(INDEX(A1:C3,1,3))"), Value::Number(3.0));
    }

    #[test]
    fn not_references() {
        assert_eq!(eval("=COLUMN(1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=COLUMN(\"A\")"), Value::Error(ErrorKind::Value));
        assert_eq!(
            eval("=COLUMN(INDEX(A1:C3,1,9))"),
            Value::Error(ErrorKind::Ref)
        );
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=COLUMN(C1)"), Value::Number(3.0));
        assert_eq!(eval("=COLUMN(#DIV/0!)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=COLUMN(AA1)"), Value::Number(27.0));
    }
}
