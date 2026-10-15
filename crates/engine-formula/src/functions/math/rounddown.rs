//! `ROUNDDOWN(number, num_digits)`.

use crate::ast::Expr;
use crate::functions::math::{map2, round_digits, Rounding};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Rounds toward zero.
pub struct RoundDown;

impl Function for RoundDown {
    fn name(&self) -> &'static str {
        "ROUNDDOWN"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map2(args, ctx, |x, d| {
            Value::number(round_digits(x, d, Rounding::Down))
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        assert_eq!(eval("=ROUNDDOWN(2.9,0)"), Value::Number(2.0));
        assert_eq!(eval("=ROUNDDOWN(-2.9,0)"), Value::Number(-2.0));
        assert_eq!(eval("=ROUNDDOWN(1.23456,3)"), Value::Number(1.234));
        assert_eq!(eval("=ROUNDDOWN(1999,-3)"), Value::Number(1000.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=ROUNDDOWN(-0.4,0)"), Value::Number(0.0));
        assert_eq!(eval("=ROUNDDOWN(2.3,1)"), Value::Number(2.3));
        assert_eq!(eval("=ROUNDDOWN(Z9,0)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=ROUNDDOWN(C1,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=ROUNDDOWN(1,A2)"), Value::Error(ErrorKind::Value));
    }
}
