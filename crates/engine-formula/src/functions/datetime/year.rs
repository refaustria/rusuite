//! `YEAR(serial_number)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::serial_to_ymd;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Year of a date serial (serial 0 is in 1900). Negative serials are `#NUM!`.
pub struct Year;

impl Function for Year {
    fn name(&self) -> &'static str {
        "YEAR"
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
            Some((y, _, _)) => Value::Number(f64::from(y)),
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
        assert_eq!(eval("=YEAR(45306)"), Value::Number(2024.0));
        assert_eq!(eval("=YEAR(45306.75)"), Value::Number(2024.0));
        assert_eq!(eval("=YEAR(\"45306\")"), Value::Number(2024.0));
        assert_eq!(eval("=YEAR(DATE(2024,3,0))"), Value::Number(2024.0));
    }

    #[test]
    fn edges() {
        assert_eq!(eval("=YEAR(0)"), Value::Number(1900.0));
        assert_eq!(eval("=YEAR(60)"), Value::Number(1900.0));
        assert_eq!(eval("=YEAR(2958465)"), Value::Number(9999.0));
        assert_eq!(eval("=YEAR(Z9)"), Value::Number(1900.0));
    }

    #[test]
    fn text_dates() {
        assert_eq!(eval("=YEAR(\"2024-01-15\")"), Value::Number(2024.0));
        assert_eq!(eval("=YEAR(TRUE)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=YEAR(-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=YEAR(2958466)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=YEAR(\"x\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=YEAR(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=YEAR(C1)"), Value::Error(ErrorKind::Div0));
    }
}
