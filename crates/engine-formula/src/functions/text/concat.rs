//! `CONCAT`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Joins all values of its arguments, ranges flattened row-major.
pub struct Concat;

impl Function for Concat {
    fn name(&self) -> &'static str {
        "CONCAT"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut out = String::new();
        for a in args {
            let r = match ctx.range(a) {
                Ok(r) => r,
                Err(e) => return Value::Error(e),
            };
            for v in r.values() {
                match crate::value::to_text(&v) {
                    Ok(s) => out.push_str(&s),
                    Err(e) => return Value::Error(e),
                }
            }
        }
        Value::Text(out)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn flattens_ranges() {
        assert_eq!(eval("=CONCAT(\"a\",\"b\")"), Value::Text("ab".into()));
        assert_eq!(eval("=CONCAT(A1:A3)"), Value::Text("1x3".into()));
        assert_eq!(eval("=CONCAT(A1:A3,\"-\")"), Value::Text("1x3-".into()));
        assert_eq!(eval("=CONCAT({1,2;3,4})"), Value::Text("1234".into()));
        assert_eq!(eval("=CONCAT(1,TRUE)"), Value::Text("1TRUE".into()));
        assert_eq!(eval("=CONCAT(Z9,\"x\")"), Value::Text("x".into()));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=CONCAT(A1:C3)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=CONCAT(\"a\",#N/A,C1)"), Value::Error(ErrorKind::NA));
    }

    #[test]
    fn single_cell() {
        assert_eq!(eval("=CONCAT(B2)"), Value::Text("5".into()));
    }
}
