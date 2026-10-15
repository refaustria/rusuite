//! `SQRT(number)`.

use crate::ast::Expr;
use crate::functions::math::map1;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Square root; a negative argument gives `#NUM!`.
pub struct Sqrt;

impl Function for Sqrt {
    fn name(&self) -> &'static str {
        "SQRT"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map1(args, ctx, |x| {
            if x < 0.0 {
                Value::Error(crate::ast::ErrorKind::Num)
            } else {
                Value::number(x.sqrt())
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
        assert_eq!(eval("=SQRT(16)"), Value::Number(4.0));
        assert_eq!(eval("=SQRT(\"9\")"), Value::Number(3.0));
        assert_eq!(eval("=SQRT(A1)"), Value::Number(1.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=SQRT(0)"), Value::Number(0.0));
        assert_eq!(eval("=SQRT(-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=SQRT(Z9)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=SQRT(C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=SQRT(A2)"), Value::Error(ErrorKind::Value));
    }
}
