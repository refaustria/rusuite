//! `NOW()`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// The current date-time serial; volatile.
pub struct Now;

impl Function for Now {
    fn name(&self) -> &'static str {
        "NOW"
    }

    fn arity(&self) -> Arity {
        Arity::exact(0)
    }

    fn call(&self, _args: &[Expr], ctx: &mut CallContext) -> Value {
        Value::number(ctx.now())
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn returns_the_clock() {
        // test clock: 45000.5
        assert_eq!(eval("=NOW()"), Value::Number(45000.5));
        assert_eq!(eval("=NOW()+1"), Value::Number(45001.5));
    }

    #[test]
    fn takes_no_arguments() {
        assert_eq!(eval("=NOW(1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates_through_arithmetic() {
        assert_eq!(eval("=NOW()+C1"), Value::Error(ErrorKind::Div0));
    }
}
