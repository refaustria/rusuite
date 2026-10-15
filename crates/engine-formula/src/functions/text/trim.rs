//! `TRIM`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Strips leading/trailing spaces and collapses inner runs (U+0020 only).
pub struct Trim;

impl Function for Trim {
    fn name(&self) -> &'static str {
        "TRIM"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match ctx.text(&args[0]) {
            Ok(s) => Value::Text(
                s.split(' ')
                    .filter(|p| !p.is_empty())
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
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
    fn collapses_spaces() {
        assert_eq!(eval("=TRIM(\"  a  b  \")"), Value::Text("a b".into()));
        assert_eq!(eval("=TRIM(\"   \")"), Value::Text("".into()));
        assert_eq!(eval("=TRIM(12)"), Value::Text("12".into()));
    }

    #[test]
    fn only_ascii_space() {
        assert_eq!(
            eval("=TRIM(\"\u{a0}a\u{a0}\")"),
            Value::Text("\u{a0}a\u{a0}".into())
        );
        assert_eq!(eval("=LEN(TRIM(\" a\tb \"))"), Value::Number(3.0));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(eval("=TRIM(C1)"), Value::Error(ErrorKind::Div0));
    }
}
