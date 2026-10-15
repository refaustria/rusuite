//! `UPPER`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Upper-cases the text (Unicode aware).
pub struct Upper;

impl Function for Upper {
    fn name(&self) -> &'static str {
        "UPPER"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.text(&args[0]) {
            Ok(s) => Value::Text(s.to_uppercase()),
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
    fn uppercases() {
        assert_eq!(eval("=UPPER(\"abc\")"), Value::Text("ABC".into()));
        assert_eq!(eval("=UPPER(\"äö\")"), Value::Text("ÄÖ".into()));
        assert_eq!(eval("=UPPER(Z9)"), Value::Text("".into()));
        assert_eq!(eval("=UPPER(1.5)"), Value::Text("1.5".into()));
        assert_eq!(eval("=UPPER(TRUE)"), Value::Text("TRUE".into()));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=UPPER(C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=UPPER(#N/A)"), Value::Error(ErrorKind::NA));
    }
}
