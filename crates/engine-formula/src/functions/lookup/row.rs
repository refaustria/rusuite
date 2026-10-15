//! `ROW([reference])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::reference_arg;
use crate::functions::{Arity, CallContext, Function};
use crate::value::{Array, Value};

/// Row number of a reference (1-based); a multi-row reference gives a
/// column array. Without argument: the host cell's row.
pub struct Row;

impl Function for Row {
    fn name(&self) -> &'static str {
        "ROW"
    }

    fn arity(&self) -> Arity {
        Arity::range(0, 1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let Some(e) = args.first().filter(|e| !ctx.is_missing(e)) else {
            return Value::Number(f64::from(ctx.current().row) + 1.0);
        };
        let r = match reference_arg(e, ctx) {
            Ok(r) => r,
            Err(k) => return Value::Error(k),
        };
        let first = Value::Number(f64::from(r.r0) + 1.0);
        if r.rows() == 1 || r.is_whole_columns() {
            return first;
        }
        let data = (r.r0..=r.r1)
            .map(|n| Value::Number(f64::from(n) + 1.0))
            .collect();
        Array::new(r.rows() as usize, 1, data)
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
    fn rows() {
        assert_eq!(eval("=ROW(C5)"), Value::Number(5.0));
        assert_eq!(eval("=ROW()"), Value::Number(10.0));
        assert_eq!(eval("=SUM(ROW(B2:B4))"), Value::Number(9.0));
        assert_eq!(eval("=ROW(B2:B4)"), Value::Number(2.0));
        assert_eq!(eval("=ROW(INDEX(A1:A3,3))"), Value::Number(3.0));
    }

    #[test]
    fn not_references() {
        assert_eq!(eval("=ROW(1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=ROW(\"A1\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=ROW(INDEX(A1:A3,9))"), Value::Error(ErrorKind::Ref));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=ROW(C1)"), Value::Number(1.0));
        assert_eq!(eval("=ROW(#N/A)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=ROW(Z100)"), Value::Number(100.0));
    }
}
