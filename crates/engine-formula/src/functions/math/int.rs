//! `INT(number)`.

use crate::ast::Expr;
use crate::functions::math::map1;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Rounds down to the nearest integer (toward minus infinity).
pub struct Int;

impl Function for Int {
    fn name(&self) -> &'static str {
        "INT"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map1(args, ctx, |x| Value::number(x.floor()))
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        assert_eq!(eval("=INT(2.7)"), Value::Number(2.0));
        assert_eq!(eval("=INT(-2.1)"), Value::Number(-3.0));
        assert_eq!(eval("=INT(\"7.9\")"), Value::Number(7.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=INT(TRUE)"), Value::Number(1.0));
        assert_eq!(eval("=INT(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=INT(-0.5)"), Value::Number(-1.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=INT(C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=INT(A2)"), Value::Error(ErrorKind::Value));
    }
}
