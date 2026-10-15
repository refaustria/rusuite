//! `TRUE()`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Returns the logical value TRUE.
pub struct True;

impl Function for True {
    fn name(&self) -> &'static str {
        "TRUE"
    }

    fn arity(&self) -> Arity {
        Arity::exact(0)
    }

    fn call(&self, _args: &[Expr], _ctx: &mut CallContext) -> Value {
        Value::Bool(true)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn returns_true() {
        assert_eq!(eval("=TRUE()"), Value::Bool(true));
        assert_eq!(eval("=TRUE()&\"\""), Value::Text("TRUE".into()));
        assert_eq!(eval("=TRUE(1)"), Value::Error(ErrorKind::Value));
    }
}
