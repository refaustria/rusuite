//! `ROUND(number, num_digits)`.

use crate::ast::Expr;
use crate::functions::math::{map2, round_digits, Rounding};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Rounds half away from zero; negative `num_digits` round left of the point.
pub struct Round;

impl Function for Round {
    fn name(&self) -> &'static str {
        "ROUND"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map2(args, ctx, |x, d| {
            Value::number(round_digits(x, d, Rounding::Nearest))
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
        assert_eq!(eval("=ROUND(2.5,0)"), Value::Number(3.0));
        assert_eq!(eval("=ROUND(-2.5,0)"), Value::Number(-3.0));
        assert_eq!(eval("=ROUND(2.675,2)"), Value::Number(2.68));
        assert_eq!(eval("=ROUND(1234.5678,-2)"), Value::Number(1200.0));
        assert_eq!(eval("=ROUND(1.005,2)"), Value::Number(1.01));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=ROUND(\"3.7\",0)"), Value::Number(4.0));
        assert_eq!(eval("=ROUND(Z9,2)"), Value::Number(0.0));
        assert_eq!(eval("=ROUND(2.9,0.9)"), Value::Number(3.0));
        assert_eq!(eval("=ROUND(5,-3)"), Value::Number(0.0));
        assert_eq!(eval("=ROUND(1.5,400)"), Value::Number(1.5));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=ROUND(A2,0)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=ROUND(C1,C2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=ROUND(1,#N/A)"), Value::Error(ErrorKind::NA));
    }
}
