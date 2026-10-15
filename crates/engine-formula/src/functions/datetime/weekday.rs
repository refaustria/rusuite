//! `WEEKDAY(serial_number, [return_type])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Day of the week. Types 1 (Sun=1), 2 (Mon=1), 3 (Mon=0) and 11..=17
/// (Mon=1 .. Sun=1); other types and negative serials are `#NUM!`. Serial 1
/// is a Sunday, serial 0 a Saturday.
pub struct Weekday;

impl Function for Weekday {
    fn name(&self) -> &'static str {
        "WEEKDAY"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let serial = match super::serial::date_arg(ctx, &args[0]) {
            Ok(n) => n,
            Err(e) => return Value::Error(e),
        };
        let kind = match args.get(1) {
            Some(a) if !ctx.is_missing(a) => match ctx.number(a) {
                Ok(n) => n.trunc(),
                Err(e) => return Value::Error(e),
            },
            _ => 1.0,
        };
        let s = serial.floor();
        if !(0.0..=super::serial::MAX_SERIAL).contains(&s) {
            return Value::Error(ErrorKind::Num);
        }
        // 0 = Sunday .. 6 = Saturday; serial 1 is a Sunday.
        let sun0 = (s as i64 - 1).rem_euclid(7);
        let from = |start: i64| (sun0 - start).rem_euclid(7);
        let r = match kind as i64 {
            1 | 17 => from(0) + 1,
            2 => from(1) + 1,
            3 => from(1),
            k @ 11..=16 => from(k - 10) + 1,
            _ => return Value::Error(ErrorKind::Num),
        };
        Value::Number(r as f64)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    fn n(x: f64) -> Value {
        Value::Number(x)
    }

    #[test]
    fn return_types() {
        // 45306 = Monday 2024-01-15
        assert_eq!(eval("=WEEKDAY(45306)"), n(2.0));
        assert_eq!(eval("=WEEKDAY(45306,1)"), n(2.0));
        assert_eq!(eval("=WEEKDAY(45306,2)"), n(1.0));
        assert_eq!(eval("=WEEKDAY(45306,3)"), n(0.0));
        assert_eq!(eval("=WEEKDAY(45306,11)"), n(1.0));
        assert_eq!(eval("=WEEKDAY(45306,12)"), n(7.0));
        assert_eq!(eval("=WEEKDAY(45306,17)"), n(2.0));
        assert_eq!(eval("=WEEKDAY(45305,2)"), n(7.0));
        assert_eq!(eval("=WEEKDAY(45305,3)"), n(6.0));
        assert_eq!(eval("=WEEKDAY(45306.75)"), n(2.0));
    }

    #[test]
    fn early_serials() {
        assert_eq!(eval("=WEEKDAY(0)"), n(7.0));
        assert_eq!(eval("=WEEKDAY(1)"), n(1.0));
        assert_eq!(eval("=WEEKDAY(45306,)"), n(2.0));
    }

    #[test]
    fn text_dates() {
        assert_eq!(eval("=WEEKDAY(\"2024-01-15\")"), Value::Number(2.0));
        assert_eq!(eval("=WEEKDAY(TRUE)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=WEEKDAY(45306,4)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=WEEKDAY(45306,0)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=WEEKDAY(45306,18)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=WEEKDAY(-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=WEEKDAY(A2)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=WEEKDAY(C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=WEEKDAY(1,C2)"), Value::Error(ErrorKind::NA));
    }
}
