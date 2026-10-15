//! `CEILING(number, significance)`.

use crate::ast::Expr;
use crate::functions::math::map2;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Rounds up to a multiple of `significance` (away from zero for negative
/// numbers with negative significance, toward zero with positive significance).
pub struct Ceiling;

impl Function for Ceiling {
    fn name(&self) -> &'static str {
        "CEILING"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map2(args, ctx, |x, sig| {
            if sig == 0.0 {
                Value::Number(0.0)
            } else if x > 0.0 && sig < 0.0 {
                Value::Error(crate::ast::ErrorKind::Num)
            } else {
                let q = crate::value::round_15(x / sig);
                Value::number(crate::value::round_15(q.ceil() * sig) + 0.0)
            }
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
        assert_eq!(eval("=CEILING(2.5,1)"), Value::Number(3.0));
        assert_eq!(eval("=CEILING(-2.5,-1)"), Value::Number(-3.0));
        assert_eq!(eval("=CEILING(-2.5,1)"), Value::Number(-2.0));
        assert_eq!(eval("=CEILING(1.234,0.01)"), Value::Number(1.24));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=CEILING(2.1,0)"), Value::Number(0.0));
        assert_eq!(eval("=CEILING(2.5,-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=CEILING(0,5)"), Value::Number(0.0));
        assert_eq!(eval("=CEILING(Z9,3)"), Value::Number(0.0));
        assert_eq!(eval("=CEILING(6,3)"), Value::Number(6.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=CEILING(C1,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=CEILING(1,C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=CEILING(A2,1)"), Value::Error(ErrorKind::Value));
    }
}
