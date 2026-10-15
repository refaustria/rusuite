//! `NOT(logical)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Negates a scalar under the `to_bool` coercion.
pub struct Not;

impl Function for Not {
    fn name(&self) -> &'static str {
        "NOT"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.bool(&args[0]) {
            Ok(b) => Value::Bool(!b),
            Err(e) => Value::Error(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn negates() {
        assert_eq!(eval("=NOT(TRUE)"), Value::Bool(false));
        assert_eq!(eval("=NOT(0)"), Value::Bool(true));
        assert_eq!(eval("=NOT(\"true\")"), Value::Bool(false));
    }

    #[test]
    fn empty_is_false() {
        assert_eq!(eval("=NOT(Z9)"), Value::Bool(true));
        assert_eq!(eval("=NOT(A1)"), Value::Bool(false));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=NOT(\"abc\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=NOT(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=NOT(C1)"), Value::Error(ErrorKind::Div0));
    }
}
