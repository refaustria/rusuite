//! `OR(logical1, [logical2], ...)`.

use crate::ast::Expr;
use crate::functions::logical::fold;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Folds all logical values; see [`fold`]. Not short-circuiting for errors.
pub struct Or;

impl Function for Or {
    fn name(&self) -> &'static str {
        "OR"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        fold(args, ctx, false, |a, b| a || b)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn scalars_and_ranges() {
        assert_eq!(eval("=OR(FALSE,FALSE)"), Value::Bool(false));
        assert_eq!(eval("=OR(0,TRUE)"), Value::Bool(true));
        assert_eq!(eval("=OR(A1:A3)"), Value::Bool(true));
        assert_eq!(eval("=OR(Z9,FALSE)"), Value::Bool(false));
        assert_eq!(eval("=OR(0,\"false\")"), Value::Bool(false));
        assert_eq!(eval("=OR({0,2})"), Value::Bool(true));
        assert_eq!(eval("=OR(\"x\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=OR(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=OR(TRUE,C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=OR(C2,C1)"), Value::Error(ErrorKind::NA));
    }
}
