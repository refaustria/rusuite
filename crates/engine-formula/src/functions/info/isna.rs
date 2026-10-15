//! `ISNA(value)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// TRUE only for `#N/A`. Never propagates errors; a multi-cell range is implicitly
/// intersected.
pub struct IsNa;

impl Function for IsNa {
    fn name(&self) -> &'static str {
        "ISNA"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let v = ctx.scalar(&args[0]);
        Value::Bool(matches!(v, Value::Error(crate::ast::ErrorKind::NA)))
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn cases() {
        assert_eq!(eval("=ISNA(C2)"), Value::Bool(true), "=ISNA(C2)");
        assert_eq!(eval("=ISNA(NA())"), Value::Bool(true), "=ISNA(NA())");
        assert_eq!(eval("=ISNA(C1)"), Value::Bool(false), "=ISNA(C1)");
        assert_eq!(eval("=ISNA(A1)"), Value::Bool(false), "=ISNA(A1)");
        assert_eq!(eval("=ISNA(Z9)"), Value::Bool(false), "=ISNA(Z9)");
    }
}
