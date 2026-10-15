//! `DAYS(end_date, start_date)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// `INT(end) - INT(start)`; the time part is ignored.
pub struct Days;

impl Function for Days {
    fn name(&self) -> &'static str {
        "DAYS"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let end = match super::serial::date_arg(ctx, &args[0]) {
            Ok(n) => n,
            Err(e) => return Value::Error(e),
        };
        match super::serial::date_arg(ctx, &args[1]) {
            Ok(start) => Value::number(end.floor() - start.floor()),
            Err(e) => Value::Error(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn differences() {
        assert_eq!(eval("=DAYS(45657,45306)"), Value::Number(351.0));
        assert_eq!(eval("=DAYS(45306,45657)"), Value::Number(-351.0));
        assert_eq!(
            eval("=DAYS(DATE(2024,3,1),DATE(2024,2,1))"),
            Value::Number(29.0)
        );
    }

    #[test]
    fn time_part_ignored() {
        assert_eq!(eval("=DAYS(45306.75,45306)"), Value::Number(0.0));
        assert_eq!(eval("=DAYS(45307.1,45306.9)"), Value::Number(1.0));
        assert_eq!(eval("=DAYS(Z9,45306)"), Value::Number(-45306.0));
    }

    #[test]
    fn text_dates() {
        assert_eq!(
            eval("=DAYS(\"2024-12-31\",\"2024-01-15\")"),
            Value::Number(351.0)
        );
        assert_eq!(eval("=DAYS(TRUE,1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=DAYS(A2,1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=DAYS(C1,C2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=DAYS(1,C2)"), Value::Error(ErrorKind::NA));
    }
}
