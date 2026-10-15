//! `TODAY()`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// The current date serial (`floor(now)`); volatile.
pub struct Today;

impl Function for Today {
    fn name(&self) -> &'static str {
        "TODAY"
    }

    fn arity(&self) -> Arity {
        Arity::exact(0)
    }

    fn call(&self, _args: &[Expr], ctx: &mut CallContext) -> Value {
        Value::number(ctx.now().floor())
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn floors_the_clock() {
        // test clock: 45000.5
        assert_eq!(eval("=TODAY()"), Value::Number(45000.0));
        assert_eq!(eval("=TODAY()+1"), Value::Number(45001.0));
    }

    #[test]
    fn takes_no_arguments() {
        assert_eq!(eval("=TODAY(1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates_through_arithmetic() {
        assert_eq!(eval("=TODAY()+C1"), Value::Error(ErrorKind::Div0));
    }
}
