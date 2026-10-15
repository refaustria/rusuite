//! `POWER(number, power)`.

use crate::ast::Expr;
use crate::functions::math::map2;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// `number^power` with the `^` operator rules (`0^0` and a negative base with
/// a fractional exponent give `#NUM!`; `0` to a negative power gives `#DIV/0!`).
pub struct Power;

impl Function for Power {
    fn name(&self) -> &'static str {
        "POWER"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map2(args, ctx, |x, y| {
            use crate::ast::ErrorKind;
            if x == 0.0 && y == 0.0 || x < 0.0 && y.fract() != 0.0 {
                Value::Error(ErrorKind::Num)
            } else if x == 0.0 && y < 0.0 {
                Value::Error(ErrorKind::Div0)
            } else {
                Value::number(x.powf(y))
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
        assert_eq!(eval("=POWER(2,10)"), Value::Number(1024.0));
        assert_eq!(eval("=POWER(2,-1)"), Value::Number(0.5));
        assert_eq!(eval("=POWER(-2,3)"), Value::Number(-8.0));
        assert_eq!(eval("=POWER(4,0.5)"), Value::Number(2.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=POWER(0,0)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=POWER(0,-1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=POWER(-8,1/3)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=POWER(10,1000)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=POWER(Z9,2)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=POWER(C1,2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=POWER(2,C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=POWER(A2,2)"), Value::Error(ErrorKind::Value));
    }
}
