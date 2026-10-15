//! `LEN(text)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Number of characters (Unicode scalar values) of the argument's text
/// form; numbers are measured on their General text, `LEN(TRUE)` = 4.
pub struct Len;

impl Function for Len {
    fn name(&self) -> &'static str {
        "LEN"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.text(&args[0]) {
            Ok(s) => Value::Number(s.chars().count() as f64),
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
    fn counts_characters() {
        assert_eq!(eval("=LEN(\"abc\")"), Value::Number(3.0));
        assert_eq!(eval("=LEN(\"\")"), Value::Number(0.0));
        assert_eq!(eval("=LEN(\"äöü\")"), Value::Number(3.0));
        assert_eq!(eval("=LEN(12.5)"), Value::Number(4.0));
        assert_eq!(eval("=LEN(TRUE)"), Value::Number(4.0));
        assert_eq!(eval("=LEN(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=LEN(A2)"), Value::Number(1.0));
        assert_eq!(eval("=LEN(#N/A)"), Value::Error(ErrorKind::NA));
    }
}
