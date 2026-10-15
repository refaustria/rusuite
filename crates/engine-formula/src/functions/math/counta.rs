//! `COUNTA(value1, [value2], ...)`.

use crate::ast::Expr;
use crate::eval::Operand;
use crate::functions::{Arity, CallContext, Function, RangeArg};
use crate::value::Value;

/// Counts non-empty values: every non-`Empty` cell of a range (errors and
/// empty strings included) and every direct argument that is not omitted.
pub struct CountA;

impl Function for CountA {
    fn name(&self) -> &'static str {
        "COUNTA"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut n = 0u32;
        for a in args {
            if ctx.is_missing(a) {
                continue;
            }
            match ctx.eval(a) {
                Operand::Range(r) => {
                    let arg = RangeArg::Range {
                        range: r,
                        provider: ctx.eval_context().provider,
                    };
                    n += arg.values().filter(|v| !matches!(v, Value::Empty)).count() as u32;
                }
                Operand::Scalar(Value::Array(arr)) => {
                    n += arr
                        .values()
                        .iter()
                        .filter(|v| !matches!(v, Value::Empty))
                        .count() as u32;
                }
                Operand::Scalar(Value::Empty) => {}
                Operand::Scalar(_) => n += 1,
            }
        }
        Value::Number(f64::from(n))
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        // A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5"; C1 = #DIV/0!; C2 = #N/A.
        assert_eq!(eval("=COUNTA(A1:A3)"), Value::Number(3.0));
        assert_eq!(eval("=COUNTA(1,\"\",TRUE)"), Value::Number(3.0));
        assert_eq!(eval("=COUNTA({1,\"a\"})"), Value::Number(2.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=COUNTA(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=COUNTA(A1:C3)"), Value::Number(7.0));
        assert_eq!(eval("=COUNTA(1,)"), Value::Number(1.0));
        assert_eq!(eval("=COUNTA(A:A)"), Value::Number(3.0));
    }

    #[test]
    fn errors_are_counted() {
        assert_eq!(eval("=COUNTA(C1:C2)"), Value::Number(2.0));
        assert_eq!(eval("=COUNTA(#N/A)"), Value::Number(1.0));
        assert_eq!(eval("=COUNTA(C1)"), Value::Number(1.0));
    }
}
