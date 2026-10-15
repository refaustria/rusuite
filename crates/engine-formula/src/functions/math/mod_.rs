//! `MOD(number, divisor)`.

use crate::ast::Expr;
use crate::functions::math::map2;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Remainder with the sign of the divisor; a zero divisor gives `#DIV/0!`.
pub struct Mod;

impl Function for Mod {
    fn name(&self) -> &'static str {
        "MOD"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        map2(args, ctx, |n, d| {
            if d == 0.0 {
                return Value::Error(crate::ast::ErrorKind::Div0);
            }
            let mut r = n % d;
            if r != 0.0 && (r < 0.0) != (d < 0.0) {
                r += d;
            }
            Value::number(r)
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
        assert_eq!(eval("=MOD(10,3)"), Value::Number(1.0));
        assert_eq!(eval("=MOD(-10,3)"), Value::Number(2.0));
        assert_eq!(eval("=MOD(10,-3)"), Value::Number(-2.0));
        assert_eq!(eval("=MOD(3.5,1)"), Value::Number(0.5));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=MOD(5,0)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=MOD(0,5)"), Value::Number(0.0));
        assert_eq!(eval("=MOD(Z9,3)"), Value::Number(0.0));
        assert_eq!(eval("=MOD(-6,3)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=MOD(C1,2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=MOD(C2,C1)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=MOD(1,A2)"), Value::Error(ErrorKind::Value));
    }
}
