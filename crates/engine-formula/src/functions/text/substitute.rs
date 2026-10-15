//! `SUBSTITUTE`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Replaces occurrences of a substring (case-sensitive).
pub struct Substitute;

impl Function for Substitute {
    fn name(&self) -> &'static str {
        "SUBSTITUTE"
    }

    fn arity(&self) -> Arity {
        Arity::range(3, 4)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let text = match ctx.text(&args[0]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let old = match ctx.text(&args[1]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let new = match ctx.text(&args[2]) {
            Ok(s) => s,
            Err(e) => return Value::Error(e),
        };
        let instance = match args.get(3) {
            None => None,
            Some(a) => match ctx.number(a) {
                Ok(n) if n.trunc() >= 1.0 => Some(n.trunc() as usize),
                Ok(_) => return Value::Error(crate::ast::ErrorKind::Value),
                Err(e) => return Value::Error(e),
            },
        };
        if old.is_empty() {
            return Value::Text(text);
        }
        match instance {
            None => Value::Text(text.replace(&old, &new)),
            Some(n) => match text.match_indices(&old).nth(n - 1) {
                Some((i, _)) => {
                    let mut out = String::with_capacity(text.len() + new.len());
                    out.push_str(&text[..i]);
                    out.push_str(&new);
                    out.push_str(&text[i + old.len()..]);
                    Value::Text(out)
                }
                None => Value::Text(text),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn replaces() {
        assert_eq!(
            eval("=SUBSTITUTE(\"banana\",\"a\",\"o\")"),
            Value::Text("bonono".into())
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"banana\",\"a\",\"o\",2)"),
            Value::Text("banona".into())
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"banana\",\"A\",\"o\")"),
            Value::Text("banana".into())
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"aaa\",\"a\",\"b\",4)"),
            Value::Text("aaa".into())
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"äbä\",\"ä\",\"x\",2)"),
            Value::Text("äbx".into())
        );
        assert_eq!(eval("=SUBSTITUTE(A1,1,2)"), Value::Text("2".into()));
    }

    #[test]
    fn edge_cases() {
        assert_eq!(
            eval("=SUBSTITUTE(\"abc\",\"\",\"x\")"),
            Value::Text("abc".into())
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"abc\",\"b\",\"\")"),
            Value::Text("ac".into())
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"abc\",\"b\",\"x\",0)"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(eval("=SUBSTITUTE(Z9,\"a\",\"b\")"), Value::Text("".into()));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            eval("=SUBSTITUTE(C1,\"a\",\"b\")"),
            Value::Error(ErrorKind::Div0)
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"a\",C2,\"b\")"),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(
            eval("=SUBSTITUTE(\"a\",\"a\",\"b\",C1)"),
            Value::Error(ErrorKind::Div0)
        );
    }
}
