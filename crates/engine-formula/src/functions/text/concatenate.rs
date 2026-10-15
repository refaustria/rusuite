//! `CONCATENATE`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Joins scalar arguments (legacy).
pub struct Concatenate;

impl Function for Concatenate {
    fn name(&self) -> &'static str {
        "CONCATENATE"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut out = String::new();
        for a in args {
            match ctx.text(a) {
                Ok(s) => out.push_str(&s),
                Err(e) => return Value::Error(e),
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
    fn joins_scalars() {
        assert_eq!(
            eval("=CONCATENATE(\"a\",\"b\",\"c\")"),
            Value::Text("abc".into())
        );
        assert_eq!(eval("=CONCATENATE(A1,A2)"), Value::Text("1x".into()));
        assert_eq!(eval("=CONCATENATE(1/4)"), Value::Text("0.25".into()));
        assert_eq!(eval("=CONCATENATE(TRUE,Z9)"), Value::Text("TRUE".into()));
    }

    #[test]
    fn range_is_intersected() {
        // J10 is outside A1:A3 rows/columns -> #VALUE!
        assert_eq!(eval("=CONCATENATE(A1:A3)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            eval("=CONCATENATE(\"a\",C1,C2)"),
            Value::Error(ErrorKind::Div0)
        );
    }
}
