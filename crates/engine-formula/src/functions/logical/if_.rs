//! `IF(logical_test, [value_if_true], [value_if_false])`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Evaluates only the selected branch. An omitted or empty
/// `value_if_true` gives `Empty` (shown as 0); an absent `value_if_false`
/// gives `FALSE`, an empty one (`IF(c,1,)`) gives `Empty`.
pub struct If;

impl Function for If {
    fn name(&self) -> &'static str {
        "IF"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 3)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.bool(&args[0]) {
            Err(e) => Value::Error(e),
            Ok(true) => match args.get(1) {
                Some(a) => ctx.scalar(a),
                None => Value::Empty,
            },
            Ok(false) => match args.get(2) {
                Some(a) => ctx.scalar(a),
                None => Value::Bool(false),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn selects_branch() {
        assert_eq!(eval("=IF(TRUE,1,2)"), Value::Number(1.0));
        assert_eq!(eval("=IF(0,1,2)"), Value::Number(2.0));
        assert_eq!(eval("=IF(\"true\",\"y\",\"n\")"), Value::Text("y".into()));
        assert_eq!(eval("=IF(Z9,1,2)"), Value::Number(2.0));
        assert_eq!(eval("=IF(\"x\",1,2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=IF(#N/A,1,2)"), Value::Error(ErrorKind::NA));
    }

    #[test]
    fn is_lazy() {
        assert_eq!(eval("=IF(TRUE,1,1/0)"), Value::Number(1.0));
        assert_eq!(eval("=IF(FALSE,1/0,2)"), Value::Number(2.0));
        assert_eq!(eval("=IF(FALSE,UNKNOWNFN(),2)"), Value::Number(2.0));
        assert_eq!(eval("=IF(TRUE,1/0,2)"), Value::Error(ErrorKind::Div0));
    }

    #[test]
    fn missing_branches() {
        assert_eq!(eval("=IF(TRUE,,1)"), Value::Number(0.0));
        assert_eq!(eval("=IF(TRUE,,1)&\"\""), Value::Text(String::new()));
        assert_eq!(eval("=IF(FALSE,1)"), Value::Bool(false));
        assert_eq!(eval("=IF(FALSE,1,)"), Value::Number(0.0));
        assert_eq!(eval("=IF(TRUE)"), Value::Number(0.0));
    }
}
