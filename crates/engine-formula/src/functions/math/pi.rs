//! `PI()`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// The constant pi; takes no arguments.
pub struct Pi;

impl Function for Pi {
    fn name(&self) -> &'static str {
        "PI"
    }

    fn arity(&self) -> Arity {
        Arity::exact(0)
    }

    fn call(&self, _args: &[Expr], _ctx: &mut CallContext) -> Value {
        Value::Number(std::f64::consts::PI)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn value() {
        assert_eq!(eval("=PI()"), Value::Number(std::f64::consts::PI));
        assert_eq!(eval("=ROUND(PI()*100,0)"), Value::Number(314.0));
    }

    #[test]
    fn arithmetic() {
        assert_eq!(eval("=PI()/PI()"), Value::Number(1.0));
    }

    #[test]
    fn arity_and_errors() {
        assert_eq!(eval("=PI(1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=PI()+C1"), Value::Error(ErrorKind::Div0));
    }
}
