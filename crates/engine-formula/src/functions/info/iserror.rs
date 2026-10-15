//! `ISERROR(value)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// TRUE if the argument is any error value; never propagates the error.
pub struct IsError;

impl Function for IsError {
    fn name(&self) -> &'static str {
        "ISERROR"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        Value::Bool(ctx.scalar(&args[0]).is_error())
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn detects_errors() {
        for f in [
            "=ISERROR(#N/A)",
            "=ISERROR(1/0)",
            "=ISERROR(C1)",
            "=ISERROR(UNKNOWNFN(1))",
            "=ISERROR(Nope!A1)",
            "=ISERROR(A1:B3)",
        ] {
            assert_eq!(eval(f), Value::Bool(true), "{f}");
        }
        for f in [
            "=ISERROR(1)",
            "=ISERROR(\"x\")",
            "=ISERROR(Z9)",
            "=ISERROR(A1)",
        ] {
            assert_eq!(eval(f), Value::Bool(false), "{f}");
        }
    }
}
