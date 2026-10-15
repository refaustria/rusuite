//! `ABS(number)`.

use crate::ast::Expr;
use crate::functions::math::map1;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Absolute value.
pub struct Abs;

impl Function for Abs {
    fn name(&self) -> &'static str {
        "ABS"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map1(args, ctx, |x| Value::number(x.abs()))
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        assert_eq!(eval("=ABS(-5)"), Value::Number(5.0));
        assert_eq!(eval("=ABS(2.5)"), Value::Number(2.5));
        assert_eq!(eval("=ABS(\"-3\")"), Value::Number(3.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=ABS(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=ABS(TRUE)"), Value::Number(1.0));
        assert_eq!(eval("=ABS(-0)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=ABS(C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=ABS(A2)"), Value::Error(ErrorKind::Value));
    }
}
