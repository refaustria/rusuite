//! `MAX(number1, [number2], ...)`.

use crate::ast::Expr;
use crate::functions::math::numbers;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Largest number; no numbers gives 0.
pub struct Max;

impl Function for Max {
    fn name(&self) -> &'static str {
        "MAX"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match numbers(args, ctx) {
            Err(e) => e,
            Ok(n) => Value::number(n.into_iter().reduce(f64::max).unwrap_or(0.0)),
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
        assert_eq!(eval("=MAX(3,1,2)"), Value::Number(3.0));
        assert_eq!(eval("=MAX(A1:A3,-4)"), Value::Number(3.0));
        assert_eq!(eval("=MAX(TRUE,\"0.5\")"), Value::Number(1.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=MAX(B1:B2)"), Value::Number(0.0));
        assert_eq!(eval("=MAX(-3,Z9)"), Value::Number(-3.0));
        assert_eq!(eval("=MAX(A1:A3,\"x\")"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=MAX(A1:C3)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=MAX(C2,1)"), Value::Error(ErrorKind::NA));
    }
}
