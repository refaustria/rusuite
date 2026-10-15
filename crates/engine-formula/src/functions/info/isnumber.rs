//! `ISNUMBER(value)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// TRUE for numbers (dates included); not for numeric text or bools. Never propagates errors; a multi-cell range is implicitly
/// intersected.
pub struct IsNumber;

impl Function for IsNumber {
    fn name(&self) -> &'static str {
        "ISNUMBER"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let v = ctx.scalar(&args[0]);
        Value::Bool(matches!(v, Value::Number(_)))
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn cases() {
        assert_eq!(eval("=ISNUMBER(1)"), Value::Bool(true), "=ISNUMBER(1)");
        assert_eq!(eval("=ISNUMBER(A1)"), Value::Bool(true), "=ISNUMBER(A1)");
        assert_eq!(eval("=ISNUMBER(B2)"), Value::Bool(false), "=ISNUMBER(B2)");
        assert_eq!(
            eval("=ISNUMBER(\"1\")"),
            Value::Bool(false),
            "=ISNUMBER(\"1\")"
        );
        assert_eq!(eval("=ISNUMBER(B1)"), Value::Bool(false), "=ISNUMBER(B1)");
        assert_eq!(eval("=ISNUMBER(C1)"), Value::Bool(false), "=ISNUMBER(C1)");
        assert_eq!(eval("=ISNUMBER(Z9)"), Value::Bool(false), "=ISNUMBER(Z9)");
    }
}
