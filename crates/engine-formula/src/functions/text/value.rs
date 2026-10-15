//! `VALUE(text)`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::datetime::serial::parse_date_text;
use crate::functions::{Arity, CallContext, Function};
use crate::value::{parse_number_text, Value};

/// Parses a number from text: everything the `+` operator accepts, plus
/// the dates, date-times and times of `parse_date_text` (see its grammar).
/// Numbers pass through, `Empty` is 0, booleans and
/// non-numeric text are `#VALUE!`.
pub struct ValueFn;

impl Function for ValueFn {
    fn name(&self) -> &'static str {
        "VALUE"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.scalar(&args[0]) {
            Value::Number(n) => Value::Number(n),
            Value::Empty => Value::Number(0.0),
            Value::Bool(_) => Value::Error(ErrorKind::Value),
            Value::Error(e) => Value::Error(e),
            Value::Text(s) => Value::from_result(parse_value_text(&s).ok_or(ErrorKind::Value)),
            Value::Array(a) => Value::from_result(
                crate::value::to_text(&Value::Array(a))
                    .and_then(|s| parse_value_text(&s).ok_or(ErrorKind::Value)),
            ),
        }
    }
}

fn parse_value_text(s: &str) -> Option<f64> {
    parse_number_text(s).or_else(|| parse_date_text(s))
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn numbers_and_percent() {
        assert_eq!(eval("=VALUE(\"123\")"), Value::Number(123.0));
        assert_eq!(eval("=VALUE(\" 12 \")"), Value::Number(12.0));
        assert_eq!(eval("=VALUE(\"1e3\")"), Value::Number(1000.0));
        assert_eq!(eval("=VALUE(\"50%\")"), Value::Number(0.5));
        assert_eq!(eval("=VALUE(\"1,234.5\")"), Value::Number(1234.5));
        assert_eq!(eval("=VALUE(5)"), Value::Number(5.0));
        assert_eq!(eval("=VALUE(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=VALUE(B2)"), Value::Number(5.0));
    }

    #[test]
    fn dates_and_times() {
        assert_eq!(eval("=VALUE(\"2024-01-15\")"), Value::Number(45306.0));
        assert_eq!(eval("=VALUE(\"1900-01-01\")"), Value::Number(1.0));
        assert_eq!(eval("=VALUE(\"1900-03-01\")"), Value::Number(61.0));
        assert_eq!(eval("=VALUE(\"2024-12-31\")"), Value::Number(45657.0));
        assert_eq!(eval("=VALUE(\"12:00\")"), Value::Number(0.5));
        assert_eq!(eval("=VALUE(\"06:00:00\")"), Value::Number(0.25));
        assert_eq!(
            eval("=VALUE(\"2024-01-15 18:00\")"),
            Value::Number(45306.75)
        );
        assert_eq!(
            eval("=VALUE(\"2023-02-29\")"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(eval("=VALUE(\"24:00\")"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn rejects() {
        assert_eq!(eval("=VALUE(\"abc\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(\"\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(TRUE)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(\"TRUE\")"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=VALUE(B1)"), Value::Error(ErrorKind::Value));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=VALUE(C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=VALUE(#N/A)"), Value::Error(ErrorKind::NA));
    }
}
