//! `LOWER`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Lower-cases the text (Unicode aware).
pub struct Lower;

impl Function for Lower {
    fn name(&self) -> &'static str {
        "LOWER"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.text(&args[0]) {
            Ok(s) => Value::Text(s.to_lowercase()),
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
    fn lowercases() {
        assert_eq!(eval("=LOWER(\"ABC\")"), Value::Text("abc".into()));
        assert_eq!(eval("=LOWER(\"ÄÖ\")"), Value::Text("äö".into()));
        assert_eq!(eval("=LOWER(TRUE)"), Value::Text("true".into()));
        assert_eq!(eval("=LOWER(Z9)"), Value::Text("".into()));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=LOWER(C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=LOWER(#DIV/0!)"), Value::Error(ErrorKind::Div0));
    }

    #[test]
    fn numbers_use_general_text() {
        assert_eq!(eval("=LOWER(1/4)"), Value::Text("0.25".into()));
    }
}
