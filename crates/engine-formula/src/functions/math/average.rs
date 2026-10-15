//! `AVERAGE(number1, [number2], ...)`.

use crate::ast::Expr;
use crate::functions::math::numbers;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Arithmetic mean under the [`Aggregate::Numbers`](crate::functions::Aggregate) rule; no numbers gives `#DIV/0!`.
pub struct Average;

impl Function for Average {
    fn name(&self) -> &'static str {
        "AVERAGE"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match numbers(args, ctx) {
            Err(e) => e,
            Ok(n) => {
                if n.is_empty() {
                    Value::Error(crate::ast::ErrorKind::Div0)
                } else {
                    Value::number(n.iter().sum::<f64>() / n.len() as f64)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        assert_eq!(eval("=AVERAGE(1,2,6)"), Value::Number(3.0));
        assert_eq!(eval("=AVERAGE(A1:A3)"), Value::Number(2.0));
        assert_eq!(eval("=AVERAGE(1,\"3\",TRUE)"), Value::Number(5.0 / 3.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=AVERAGE(B1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=AVERAGE(Z9,4)"), Value::Number(4.0));
        assert_eq!(eval("=AVERAGE(\"a\")"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=AVERAGE(A1:C3)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=AVERAGE(#N/A,1)"), Value::Error(ErrorKind::NA));
    }
}
