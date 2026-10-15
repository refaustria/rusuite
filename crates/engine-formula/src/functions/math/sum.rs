//! `SUM(number1, [number2], ...)`.

use crate::ast::Expr;
use crate::functions::{Aggregate, Arity, CallContext, Function};
use crate::value::Value;

/// Adds its arguments under the [`Aggregate::Numbers`] rule; the first
/// error encountered is the result.
pub struct Sum;

impl Function for Sum {
    fn name(&self) -> &'static str {
        "SUM"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut total = 0.0;
        for v in ctx.aggregate(args, Aggregate::Numbers) {
            match v {
                Value::Number(n) => total += n,
                Value::Error(e) => return Value::Error(e),
                _ => {}
            }
        }
        Value::number(total)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn direct_scalars_are_coerced() {
        assert_eq!(eval("=SUM(1,\"2\",TRUE)"), Value::Number(4.0));
        assert_eq!(eval("=SUM(\"a\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=SUM(1,)"), Value::Number(1.0));
        assert_eq!(eval("=SUM(Z9,2)"), Value::Number(2.0));
        assert_eq!(eval("=SUM(#N/A,1)"), Value::Error(ErrorKind::NA));
    }

    #[test]
    fn ranges_keep_only_numbers() {
        // A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5".
        assert_eq!(eval("=SUM(A1:A3)"), Value::Number(4.0));
        assert_eq!(eval("=SUM(A1:B3)"), Value::Number(4.0));
        assert_eq!(eval("=SUM(B1)"), Value::Number(0.0));
        assert_eq!(eval("=SUM({1,\"2\",TRUE})"), Value::Number(1.0));
        assert_eq!(eval("=SUM(A:A)"), Value::Number(4.0));
    }

    #[test]
    fn range_error_propagates() {
        // C1 = #DIV/0!, C2 = #N/A.
        assert_eq!(eval("=SUM(A1:C3)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=SUM(C2:C3,C1)"), Value::Error(ErrorKind::NA));
    }

    #[test]
    fn overflow_is_num() {
        assert_eq!(eval("=SUM(1E308,1E308)"), Value::Error(ErrorKind::Num));
    }
}
