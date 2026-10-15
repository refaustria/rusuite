//! `NA()`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Returns the `#N/A` error.
pub struct Na;

impl Function for Na {
    fn name(&self) -> &'static str {
        "NA"
    }

    fn arity(&self) -> Arity {
        Arity::exact(0)
    }

    fn call(&self, _args: &[Expr], _ctx: &mut CallContext) -> Value {
        Value::Error(ErrorKind::NA)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn returns_na() {
        assert_eq!(eval("=NA()"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=NA()+1"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=NA(1)"), Value::Error(ErrorKind::Value));
    }
}
