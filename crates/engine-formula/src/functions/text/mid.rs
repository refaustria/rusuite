//! `MID`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Substring by 1-based start and length.
pub struct Mid;

impl Function for Mid {
    fn name(&self) -> &'static str {
        "MID"
    }

    fn arity(&self) -> Arity {
        Arity::exact(3)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let s = match ctx.text(&args[0]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let start = match ctx.number(&args[1]) {
            Ok(n) if n.trunc() >= 1.0 => n.trunc() as usize,
            Ok(_) => return Value::Error(crate::ast::ErrorKind::Value),
            Err(e) => return Value::Error(e),
        };
        let count = match ctx.number(&args[2]).and_then(super::count_arg) {
            Ok(n) => n,
            Err(e) => return Value::Error(e),
        };
        Value::Text(s.chars().skip(start - 1).take(count).collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn substring() {
        assert_eq!(eval("=MID(\"hello\",2,3)"), Value::Text("ell".into()));
        assert_eq!(eval("=MID(\"hello\",4,99)"), Value::Text("lo".into()));
        assert_eq!(eval("=MID(\"hello\",10,2)"), Value::Text("".into()));
        assert_eq!(eval("=MID(\"hello\",2,0)"), Value::Text("".into()));
        assert_eq!(eval("=MID(\"äöü\",2,1)"), Value::Text("ö".into()));
        assert_eq!(eval("=MID(10.5,2,3)"), Value::Text("0.5".into()));
    }

    #[test]
    fn invalid_positions() {
        assert_eq!(eval("=MID(\"a\",0,1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=MID(\"a\",1,-1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=MID(\"a\",\"x\",1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=MID(C1,1,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=MID(\"a\",C2,1)"), Value::Error(ErrorKind::NA));
    }
}
