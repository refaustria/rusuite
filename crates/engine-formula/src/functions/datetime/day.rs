//! `DAY(serial_number)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::serial_to_ymd;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Day of month of a date serial (serial 0 is day 0, serial 60 is day 29). Negative serials are `#NUM!`.
pub struct Day;

impl Function for Day {
    fn name(&self) -> &'static str {
        "DAY"
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
            Some((_, _, d)) => Value::Number(f64::from(d)),
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
        assert_eq!(eval("=DAY(45306)"), Value::Number(15.0));
        assert_eq!(eval("=DAY(45306.75)"), Value::Number(15.0));
        assert_eq!(eval("=DAY(\"45306\")"), Value::Number(15.0));
        assert_eq!(eval("=DAY(DATE(2024,3,0))"), Value::Number(29.0));
    }

    #[test]
    fn edges() {
        assert_eq!(eval("=DAY(0)"), Value::Number(0.0));
        assert_eq!(eval("=DAY(60)"), Value::Number(29.0));
        assert_eq!(eval("=DAY(2958465)"), Value::Number(31.0));
        assert_eq!(eval("=DAY(Z9)"), Value::Number(0.0));
    }

    #[test]
    fn text_dates() {
        assert_eq!(eval("=DAY(\"2024-01-15 18:00\")"), Value::Number(15.0));
        assert_eq!(eval("=DAY(TRUE)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=DAY(-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=DAY(2958466)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=DAY(\"x\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=DAY(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=DAY(C1)"), Value::Error(ErrorKind::Div0));
    }
}
