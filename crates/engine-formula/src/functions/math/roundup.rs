//! `ROUNDUP(number, num_digits)`.

use crate::ast::Expr;
use crate::functions::math::{map2, round_digits, Rounding};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Rounds away from zero.
pub struct RoundUp;

impl Function for RoundUp {
    fn name(&self) -> &'static str {
        "ROUNDUP"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map2(args, ctx, |x, d| {
            Value::number(round_digits(x, d, Rounding::Up))
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
        assert_eq!(eval("=ROUNDUP(2.1,0)"), Value::Number(3.0));
        assert_eq!(eval("=ROUNDUP(-2.1,0)"), Value::Number(-3.0));
        assert_eq!(eval("=ROUNDUP(2.71828,3)"), Value::Number(2.719));
        assert_eq!(eval("=ROUNDUP(1234,-2)"), Value::Number(1300.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=ROUNDUP(0,0)"), Value::Number(0.0));
        assert_eq!(eval("=ROUNDUP(2.3,1)"), Value::Number(2.3));
        assert_eq!(eval("=ROUNDUP(Z9,1)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=ROUNDUP(C1,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=ROUNDUP(A2,1)"), Value::Error(ErrorKind::Value));
    }
}
