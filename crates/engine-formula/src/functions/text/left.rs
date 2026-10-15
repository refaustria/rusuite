//! `LEFT`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Leading characters (default 1).
pub struct Left;

impl Function for Left {
    fn name(&self) -> &'static str {
        "LEFT"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let s = match ctx.text(&args[0]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let n = match args.get(1) {
            None => 1,
            Some(a) => match ctx.number(a).and_then(super::count_arg) {
                Ok(n) => n,
                Err(e) => return Value::Error(e),
            },
        };
        Value::Text(s.chars().take(n).collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn takes_leading_chars() {
        assert_eq!(eval("=LEFT(\"hello\",2)"), Value::Text("he".into()));
        assert_eq!(eval("=LEFT(\"hello\")"), Value::Text("h".into()));
        assert_eq!(eval("=LEFT(\"hello\",0)"), Value::Text("".into()));
        assert_eq!(eval("=LEFT(\"hello\",99)"), Value::Text("hello".into()));
        assert_eq!(eval("=LEFT(\"äöü\",2.9)"), Value::Text("äö".into()));
        assert_eq!(eval("=LEFT(12345,3)"), Value::Text("123".into()));
    }

    #[test]
    fn negative_count() {
        assert_eq!(eval("=LEFT(\"a\",-1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=LEFT(\"a\",\"x\")"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=LEFT(C1,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=LEFT(\"a\",C2)"), Value::Error(ErrorKind::NA));
    }
}
