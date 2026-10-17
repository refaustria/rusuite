//! `CHOOSE(index, value1, ...)`.

use crate::ast::ErrorKind;
use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Evaluates only the chosen value; index is truncated, out of range gives
/// `#VALUE!`.
pub struct Choose;

impl Function for Choose {
    fn name(&self) -> &'static str {
        "CHOOSE"
    }

    fn arity(&self) -> Arity {
        Arity::at_least(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let i = match ctx.number(&args[0]) {
            Ok(n) => n.trunc(),
            Err(e) => return Value::Error(e),
        };
        if i < 1.0 || i >= args.len() as f64 {
            return Value::Error(ErrorKind::Value);
        }
        ctx.result_value(&args[i as usize])
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn picks() {
        assert_eq!(eval("=CHOOSE(2,\"a\",\"b\")"), Value::Text("b".into()));
        assert_eq!(eval("=CHOOSE(2.9,1,2,3)"), Value::Number(2.0));
        assert_eq!(eval("=CHOOSE(\"1\",A1,A3)"), Value::Number(1.0));
    }

    #[test]
    fn lazy_and_range() {
        assert_eq!(eval("=CHOOSE(1,1,1/0)"), Value::Number(1.0));
        assert_eq!(eval("=CHOOSE(2,1,1/0)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=CHOOSE(0,1,2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=CHOOSE(3,1,2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=CHOOSE(-1,1,2)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(eval("=CHOOSE(C1,1,2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=CHOOSE(\"x\",1,2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=CHOOSE(1,C2,2)"), Value::Error(ErrorKind::NA));
    }
}
