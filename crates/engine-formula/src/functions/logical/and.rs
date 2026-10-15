//! `AND(logical1, [logical2], ...)`.

use crate::ast::Expr;
use crate::functions::logical::fold;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Folds all logical values; see `fold`. Not short-circuiting for errors.
pub struct And;

impl Function for And {
    fn name(&self) -> &'static str {
        "AND"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        fold(args, ctx, true, |a, b| a && b)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn scalars_and_ranges() {
        assert_eq!(eval("=AND(TRUE,TRUE)"), Value::Bool(true));
        assert_eq!(eval("=AND(TRUE,FALSE)"), Value::Bool(false));
        assert_eq!(eval("=AND(1,\"true\")"), Value::Bool(true));
        assert_eq!(eval("=AND(A1:A3)"), Value::Bool(true));
        assert_eq!(eval("=AND(B1,B2)"), Value::Bool(true));
        assert_eq!(eval("=AND(A1:A3,0)"), Value::Bool(false));
        assert_eq!(eval("=AND({1,0})"), Value::Bool(false));
        assert_eq!(eval("=AND(\"x\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=AND(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=AND(Z9)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=AND(B2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=AND(FALSE,C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=AND(C2,C1)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=AND(A1:C3)"), Value::Error(ErrorKind::Div0));
    }
}
