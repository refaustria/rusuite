//! `ISBLANK(value)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// TRUE only for a truly empty cell (not for `""`). Never propagates errors; a multi-cell range is implicitly
/// intersected.
pub struct IsBlank;

impl Function for IsBlank {
    fn name(&self) -> &'static str {
        "ISBLANK"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let v = ctx.scalar(&args[0]);
        Value::Bool(matches!(v, Value::Empty))
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn cases() {
        assert_eq!(eval("=ISBLANK(Z9)"), Value::Bool(true), "=ISBLANK(Z9)");
        assert_eq!(eval("=ISBLANK(A1)"), Value::Bool(false), "=ISBLANK(A1)");
        assert_eq!(eval("=ISBLANK(\"\")"), Value::Bool(false), "=ISBLANK(\"\")");
        assert_eq!(eval("=ISBLANK(C1)"), Value::Bool(false), "=ISBLANK(C1)");
        assert_eq!(eval("=ISBLANK(#N/A)"), Value::Bool(false), "=ISBLANK(#N/A)");
        assert_eq!(
            eval("=ISBLANK(A1:A3)"),
            Value::Bool(false),
            "=ISBLANK(A1:A3)"
        );
        assert_eq!(
            eval("=ISBLANK(D9:D11)"),
            Value::Bool(true),
            "=ISBLANK(D9:D11)"
        );
    }
}
