//! `TEXT(value, format_text)`.

use crate::ast::Expr;
use crate::functions::text::numfmt;
use crate::functions::{Arity, CallContext, Function};
use crate::value::{parse_number_text, to_text, Value};

/// Formats a value with an Excel number format (MVP subset, see
/// `numfmt`). Non-numeric text is returned unchanged; numeric text is
/// converted first.
pub struct Text;

impl Function for Text {
    fn name(&self) -> &'static str {
        "TEXT"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let v = ctx.scalar(&args[0]);
        let fmt = match ctx.text(&args[1]) {
            Ok(f) => f,
            Err(e) => return Value::Error(e),
        };
        let n = match &v {
            Value::Error(e) => return Value::Error(*e),
            Value::Number(n) => *n,
            Value::Empty => 0.0,
            Value::Bool(_) => return Value::from_result(to_text(&v)),
            Value::Text(s) => {
                if numfmt::has_text_section(&fmt) {
                    return Value::Text(numfmt::format_text(s, &fmt));
                }
                match parse_number_text(s) {
                    Some(n) => n,
                    None => return Value::Text(s.clone()),
                }
            }
            Value::Array(_) => return Value::from_result(to_text(&v)),
        };
        Value::from_result(numfmt::format_number(n, &fmt))
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    fn t(f: &str) -> Value {
        eval(f)
    }

    fn s(x: &str) -> Value {
        Value::Text(x.into())
    }

    #[test]
    fn numbers() {
        assert_eq!(t("=TEXT(1234.5,\"0\")"), s("1235"));
        assert_eq!(t("=TEXT(1234.567,\"0.00\")"), s("1234.57"));
        assert_eq!(t("=TEXT(1234567.891,\"#,##0\")"), s("1,234,568"));
        assert_eq!(t("=TEXT(1234567.891,\"#,##0.00\")"), s("1,234,567.89"));
        assert_eq!(t("=TEXT(0.256,\"0%\")"), s("26%"));
        assert_eq!(t("=TEXT(0.256,\"0.0%\")"), s("25.6%"));
        assert_eq!(t("=TEXT(-2,\"0.00\")"), s("-2.00"));
        assert_eq!(t("=TEXT(0.005,\"0.00\")"), s("0.01"));
        assert_eq!(t("=TEXT(999.995,\"0.00\")"), s("1000.00"));
        assert_eq!(t("=TEXT(2.5,\"0\")"), s("3"));
        assert_eq!(t("=TEXT(-2.5,\"0\")"), s("-3"));
        assert_eq!(t("=TEXT(5,\"000\")"), s("005"));
        assert_eq!(t("=TEXT(0.5,\"#.##\")"), s(".5"));
        assert_eq!(t("=TEXT(Z9,\"0\")"), s("0"));
    }

    #[test]
    fn sections_and_literals() {
        assert_eq!(t("=TEXT(5,\"0;(0)\")"), s("5"));
        assert_eq!(t("=TEXT(-5,\"0;(0)\")"), s("(5)"));
        assert_eq!(t("=TEXT(0,\"0;(0);zero\")"), s("zero"));
        assert_eq!(t("=TEXT(12,\"\"\"EUR \"\"0.00\")"), s("EUR 12.00"));
        assert_eq!(t("=TEXT(1,\"0 \"\"kg\"\"\")"), s("1 kg"));
        assert_eq!(t("=TEXT(1234,\"0,\")"), s("1"));
    }

    #[test]
    fn dates() {
        assert_eq!(t("=TEXT(45306,\"yyyy-mm-dd\")"), s("2024-01-15"));
        assert_eq!(t("=TEXT(45306,\"dd.mm.yyyy\")"), s("15.01.2024"));
        assert_eq!(t("=TEXT(45306,\"mm/dd/yyyy\")"), s("01/15/2024"));
        assert_eq!(t("=TEXT(45657,\"dd.mm.yy\")"), s("31.12.24"));
        assert_eq!(
            t("=TEXT(45306.75,\"yyyy-mm-dd hh:mm:ss\")"),
            s("2024-01-15 18:00:00")
        );
        assert_eq!(t("=TEXT(0.5,\"hh:mm\")"), s("12:00"));
        assert_eq!(t("=TEXT(60,\"yyyy-mm-dd\")"), s("1900-02-29"));
        assert_eq!(t("=TEXT(61,\"yyyy-mm-dd\")"), s("1900-03-01"));
        assert_eq!(t("=TEXT(1,\"yyyy-mm-dd\")"), s("1900-01-01"));
        assert_eq!(
            t("=TEXT(45306,\"d mmm yyyy, dddd\")"),
            s("15 Jan 2024, Monday")
        );
        assert_eq!(
            t("=TEXT(-1,\"yyyy-mm-dd\")"),
            Value::Error(ErrorKind::Value)
        );
    }

    #[test]
    fn text_input() {
        assert_eq!(t("=TEXT(\"apple\",\"@\")"), s("apple"));
        assert_eq!(t("=TEXT(1,\"@\")"), s("1"));
        assert_eq!(t("=TEXT(\"apple\",\"0\")"), s("apple"));
        assert_eq!(t("=TEXT(B2,\"0.00\")"), s("5.00"));
        assert_eq!(t("=TEXT(\"x\",\"[$-409]@\")"), s("x"));
        assert_eq!(t("=TEXT(TRUE,\"0\")"), s("TRUE"));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(t("=TEXT(C1,\"0\")"), Value::Error(ErrorKind::Div0));
        assert_eq!(t("=TEXT(1,C2)"), Value::Error(ErrorKind::NA));
    }
}
