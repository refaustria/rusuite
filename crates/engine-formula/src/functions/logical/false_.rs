//! `FALSE()`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Returns the logical value FALSE.
pub struct False;

impl Function for False {
    fn name(&self) -> &'static str {
        "FALSE"
    }

    fn arity(&self) -> Arity {
        Arity::exact(0)
    }

    fn call(&self, _args: &[Expr], _ctx: &mut CallContext) -> Value {
        Value::Bool(false)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn returns_false() {
        assert_eq!(eval("=FALSE()"), Value::Bool(false));
        assert_eq!(eval("=FALSE()+1"), Value::Number(1.0));
        assert_eq!(eval("=FALSE(1)"), Value::Error(ErrorKind::Value));
    }
}
