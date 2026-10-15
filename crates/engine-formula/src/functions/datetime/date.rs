//! `DATE(year, month, day)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::ymd_to_serial;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Builds a date serial. Arguments are truncated; years 0..=1899 get 1900
/// added; month and day roll over; a result outside the valid range
/// (negative, or beyond 9999-12-31) is `#NUM!`.
pub struct Date;

fn int(x: f64) -> Result<i32, ErrorKind> {
    let t = x.trunc();
    if t.abs() > 1e9 {
        return Err(ErrorKind::Num);
    }
    Ok(t as i32)
}

impl Function for Date {
    fn name(&self) -> &'static str {
        "DATE"
    }

    fn arity(&self) -> Arity {
        Arity::exact(3)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut parts = [0.0; 3];
        for (p, a) in parts.iter_mut().zip(args) {
            match ctx.number(a) {
                Ok(n) => *p = n,
                Err(e) => return Value::Error(e),
            }
        }
        let [y, m, d] = parts.map(int);
        let (Ok(mut y), Ok(m), Ok(d)) = (y, m, d) else {
            return Value::Error(ErrorKind::Num);
        };
        if (0..=1899).contains(&y) {
            y += 1900;
        }
        if !(0..=9999).contains(&y) {
            return Value::Error(ErrorKind::Num);
        }
        match ymd_to_serial(y, m, d) {
            Some(s) => Value::Number(s),
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
    fn builds_dates() {
        assert_eq!(eval("=DATE(2024,1,15)"), Value::Number(45306.0));
        assert_eq!(eval("=DATE(2024,2,30)"), Value::Number(45352.0));
        assert_eq!(eval("=DATE(\"2024\",\"1\",15.9)"), Value::Number(45306.0));
        assert_eq!(eval("=DATE(1900,1,1)"), Value::Number(1.0));
        assert_eq!(eval("=DATE(1,1,1)"), Value::Number(367.0));
    }

    #[test]
    fn rolls_over() {
        assert_eq!(eval("=DATE(2024,13,1)"), Value::Number(45658.0));
        assert_eq!(eval("=DATE(2024,1,0)"), Value::Number(45291.0));
        assert_eq!(eval("=DATE(2024,0,1)"), Value::Number(45261.0));
        assert_eq!(eval("=DATE(2024,-1,1)"), Value::Number(45231.0));
    }

    #[test]
    fn range_and_errors() {
        assert_eq!(eval("=DATE(10000,1,1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=DATE(-1,1,1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=DATE(1900,1,-1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=DATE(1E300,1,1)"), Value::Error(ErrorKind::Num));
        assert_eq!(eval("=DATE(A2,1,1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=DATE(2024,C1,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=DATE(C2,C1,1)"), Value::Error(ErrorKind::NA));
    }
}
