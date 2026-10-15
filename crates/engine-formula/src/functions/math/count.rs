//! `COUNT(value1, [value2], ...)`.

use crate::ast::Expr;
use crate::eval::Operand;
use crate::functions::{Arity, CallContext, Function, RangeArg};
use crate::value::{parse_number_text, Value};

/// Counts numbers. Direct scalar arguments also count when they are bools
/// or numeric text; in references and arrays only numbers count. Errors
/// are never counted and never propagate.
pub struct Count;

impl Function for Count {
    fn name(&self) -> &'static str {
        "COUNT"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut n = 0u32;
        for a in args {
            match ctx.eval(a) {
                Operand::Range(r) => {
                    let arg = RangeArg::Range {
                        range: r,
                        provider: ctx.eval_context().provider,
                    };
                    n += arg
                        .values()
                        .filter(|v| matches!(v, Value::Number(_)))
                        .count() as u32;
                }
                Operand::Scalar(Value::Array(arr)) => {
                    n += arr
                        .values()
                        .iter()
                        .filter(|v| matches!(v, Value::Number(_)))
                        .count() as u32;
                }
                Operand::Scalar(Value::Number(_) | Value::Bool(_)) => n += 1,
                Operand::Scalar(Value::Text(s)) => n += u32::from(parse_number_text(&s).is_some()),
                Operand::Scalar(_) => {}
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
        // A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5".
        assert_eq!(eval("=COUNT(A1:A3)"), Value::Number(2.0));
        assert_eq!(eval("=COUNT(1,\"a\",TRUE)"), Value::Number(2.0));
        assert_eq!(eval("=COUNT(\"5\")"), Value::Number(1.0));
        assert_eq!(eval("=COUNT({1,\"2\",TRUE})"), Value::Number(1.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=COUNT(B1:B2)"), Value::Number(0.0));
        assert_eq!(eval("=COUNT(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=COUNT(A:A)"), Value::Number(2.0));
        assert_eq!(eval("=COUNT(TRUE)"), Value::Number(1.0));
    }

    #[test]
    fn errors_are_not_propagated() {
        assert_eq!(eval("=COUNT(A1:C3)"), Value::Number(2.0));
        assert_eq!(eval("=COUNT(A1,C1)"), Value::Number(1.0));
        assert_eq!(eval("=COUNT(#N/A,1)"), Value::Number(1.0));
    }
}
