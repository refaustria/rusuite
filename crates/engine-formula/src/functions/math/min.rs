//! `MIN(number1, [number2], ...)`.

use crate::ast::Expr;
use crate::functions::math::numbers;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Smallest number; no numbers gives 0.
pub struct Min;

impl Function for Min {
    fn name(&self) -> &'static str {
        "MIN"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match numbers(args, ctx) {
            Err(e) => e,
            Ok(n) => Value::number(n.into_iter().reduce(f64::min).unwrap_or(0.0)),
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
        assert_eq!(eval("=MIN(3,1,2)"), Value::Number(1.0));
        assert_eq!(eval("=MIN(A1:A3,-4)"), Value::Number(-4.0));
        assert_eq!(eval("=MIN(TRUE,5)"), Value::Number(1.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=MIN(B1:B2)"), Value::Number(0.0));
        assert_eq!(eval("=MIN(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=MIN(\"x\")"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=MIN(A1:C3)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=MIN(#N/A,#DIV/0!)"), Value::Error(ErrorKind::NA));
    }
}
