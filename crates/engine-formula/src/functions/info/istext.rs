//! `ISTEXT(value)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// TRUE for text, including `""`. Never propagates errors; a multi-cell range is implicitly
/// intersected.
pub struct IsText;

impl Function for IsText {
    fn name(&self) -> &'static str {
        "ISTEXT"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let v = ctx.scalar(&args[0]);
        Value::Bool(matches!(v, Value::Text(_)))
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn cases() {
        assert_eq!(eval("=ISTEXT(A2)"), Value::Bool(true), "=ISTEXT(A2)");
        assert_eq!(eval("=ISTEXT(\"\")"), Value::Bool(true), "=ISTEXT(\"\")");
        assert_eq!(eval("=ISTEXT(A1)"), Value::Bool(false), "=ISTEXT(A1)");
        assert_eq!(eval("=ISTEXT(Z9)"), Value::Bool(false), "=ISTEXT(Z9)");
        assert_eq!(eval("=ISTEXT(B1)"), Value::Bool(false), "=ISTEXT(B1)");
        assert_eq!(eval("=ISTEXT(C2)"), Value::Bool(false), "=ISTEXT(C2)");
    }
}
