//! `RIGHT`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Trailing characters (default 1).
pub struct Right;

impl Function for Right {
    fn name(&self) -> &'static str {
        "RIGHT"
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
        let len = s.chars().count();
        Value::Text(s.chars().skip(len.saturating_sub(n)).collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn takes_trailing_chars() {
        assert_eq!(eval("=RIGHT(\"hello\",2)"), Value::Text("lo".into()));
        assert_eq!(eval("=RIGHT(\"hello\")"), Value::Text("o".into()));
        assert_eq!(eval("=RIGHT(\"hello\",0)"), Value::Text("".into()));
        assert_eq!(eval("=RIGHT(\"hello\",99)"), Value::Text("hello".into()));
        assert_eq!(eval("=RIGHT(\"äöü\",2)"), Value::Text("öü".into()));
        assert_eq!(eval("=RIGHT(12345,2)"), Value::Text("45".into()));
    }

    #[test]
    fn negative_count() {
        assert_eq!(eval("=RIGHT(\"a\",-1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=RIGHT(C2,1)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=RIGHT(\"a\",C1)"), Value::Error(ErrorKind::Div0));
    }
}
