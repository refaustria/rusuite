//! `FIND`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Case-sensitive 1-based position of a substring; no wildcards.
pub struct Find;

impl Function for Find {
    fn name(&self) -> &'static str {
        "FIND"
    }

    fn arity(&self) -> Arity {
        Arity::range(2, 3)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let needle = match ctx.text(&args[0]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let within = match ctx.text(&args[1]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let start = match args.get(2) {
            None => 1,
            Some(a) => match ctx.number(a) {
                Ok(n) if n.trunc() >= 1.0 && n.trunc() <= within.chars().count() as f64 + 1.0 => {
                    n.trunc() as usize
                }
                Ok(_) => return Value::Error(crate::ast::ErrorKind::Value),
                Err(e) => return Value::Error(e),
            },
        };
        let byte_start = within
            .char_indices()
            .nth(start - 1)
            .map_or(within.len(), |(i, _)| i);
        match within[byte_start..].find(&needle) {
            Some(off) => {
                let before = within[byte_start..byte_start + off].chars().count();
                Value::Number((start + before) as f64)
            }
            None => Value::Error(crate::ast::ErrorKind::Value),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn finds_position() {
        assert_eq!(eval("=FIND(\"a\",\"banana\")"), Value::Number(2.0));
        assert_eq!(eval("=FIND(\"a\",\"banana\",3)"), Value::Number(4.0));
        assert_eq!(eval("=FIND(\"ö\",\"äöü\")"), Value::Number(2.0));
        assert_eq!(eval("=FIND(\"?\",\"a?b\")"), Value::Number(2.0));
        assert_eq!(eval("=FIND(1,A1)"), Value::Number(1.0));
    }

    #[test]
    fn edge_cases() {
        assert_eq!(
            eval("=FIND(\"A\",\"banana\")"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(eval("=FIND(\"\",\"abc\")"), Value::Number(1.0));
        assert_eq!(eval("=FIND(\"\",\"abc\",3)"), Value::Number(3.0));
        assert_eq!(
            eval("=FIND(\"a\",\"abc\",0)"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(
            eval("=FIND(\"a\",\"abc\",5)"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(eval("=FIND(\"a\",Z9)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=FIND(C1,\"abc\")"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=FIND(\"a\",C2)"), Value::Error(ErrorKind::NA));
    }
}
