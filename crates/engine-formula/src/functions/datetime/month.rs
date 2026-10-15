//! `MONTH(serial_number)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::serial_to_ymd;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Month of a date serial (serial 60 is February). Negative serials are `#NUM!`.
pub struct Month;

impl Function for Month {
    fn name(&self) -> &'static str {
        "MONTH"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let n = match super::serial::date_arg(ctx, &args[0]) {
            Ok(n) => n,
            Err(e) => return Value::Error(e),
        };
        match serial_to_ymd(n) {
            Some((_, m, _)) => Value::Number(f64::from(m)),
            None => Value::Error(ErrorKind::Num),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        assert_eq!(eval("=MONTH(45306)"), Value::Number(1.0));
        assert_eq!(eval("=MONTH(45306.75)"), Value::Number(1.0));
        assert_eq!(eval("=MONTH(\"45306\")"), Value::Number(1.0));
        assert_eq!(eval("=MONTH(DATE(2024,3,0))"), Value::Number(2.0));
    }

    #[test]
    fn edges() {
        assert_eq!(eval("=MONTH(0)"), Value::Number(1.0));
        assert_eq!(eval("=MONTH(60)"), Value::Number(2.0));
        assert_eq!(eval("=MONTH(2958465)"), Value::Number(12.0));
        assert_eq!(eval("=MONTH(Z9)"), Value::Number(1.0));
    }

    #[test]
    fn text_dates() {
        assert_eq!(eval("=MONTH(\"12/31/2024\")"), Value::Number(12.0));
        assert_eq!(eval("=MONTH(TRUE)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=MONTH(-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=MONTH(2958466)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=MONTH(\"x\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=MONTH(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=MONTH(C1)"), Value::Error(ErrorKind::Div0));
    }
}
