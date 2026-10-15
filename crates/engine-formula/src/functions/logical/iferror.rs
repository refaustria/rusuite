//! `IFERROR(value, value_if_error)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Returns `value` unless it is an error, in which case `value_if_error`
/// is evaluated (lazily) and returned. An empty cell result is `Empty`
/// (shown as 0).
pub struct IfError;

impl Function for IfError {
    fn name(&self) -> &'static str {
        "IFERROR"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.scalar(&args[0]) {
            Value::Error(_) => ctx.scalar(&args[1]),
            v => v,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn catches_errors() {
        assert_eq!(eval("=IFERROR(1/0,\"e\")"), Value::Text("e".into()));
        assert_eq!(eval("=IFERROR(C2,0)"), Value::Number(0.0));
        assert_eq!(eval("=IFERROR(UNKNOWNFN(1),7)"), Value::Number(7.0));
        assert_eq!(eval("=IFERROR(5,\"e\")"), Value::Number(5.0));
        assert_eq!(eval("=IFERROR(A1,0)"), Value::Number(1.0));
        assert_eq!(eval("=IFERROR(Z9,1)&\"\""), Value::Text(String::new()));
    }

    #[test]
    fn fallback_is_lazy() {
        assert_eq!(eval("=IFERROR(1,1/0)"), Value::Number(1.0));
        assert_eq!(eval("=IFERROR(1,UNKNOWNFN())"), Value::Number(1.0));
    }

    #[test]
    fn fallback_error_propagates() {
        assert_eq!(eval("=IFERROR(1/0,1/0)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=IFERROR(C1,C2)"), Value::Error(ErrorKind::NA));
    }
}
