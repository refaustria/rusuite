//! `EXACT`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Case-sensitive text equality.
pub struct Exact;

impl Function for Exact {
    fn name(&self) -> &'static str {
        "EXACT"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let a = match ctx.text(&args[0]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        match ctx.text(&args[1]) {
            Ok(b) => Value::Bool(a == b),
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
    fn case_sensitive() {
        assert_eq!(eval("=EXACT(\"a\",\"a\")"), Value::Bool(true));
        assert_eq!(eval("=EXACT(\"a\",\"A\")"), Value::Bool(false));
        assert_eq!(eval("=EXACT(\"a \",\"a\")"), Value::Bool(false));
    }

    #[test]
    fn numbers_as_text() {
        assert_eq!(eval("=EXACT(A1,1)"), Value::Bool(true));
        assert_eq!(eval("=EXACT(Z9,\"\")"), Value::Bool(true));
        assert_eq!(eval("=EXACT(B1,\"5\")"), Value::Bool(false));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=EXACT(C1,C2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=EXACT(\"a\",C2)"), Value::Error(ErrorKind::NA));
    }
}
