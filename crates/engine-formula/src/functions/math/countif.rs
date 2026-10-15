//! `COUNTIF(range, criteria)`.

use crate::ast::Expr;
use crate::functions::math::criteria::{cells, Criteria};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Counts the cells of `range` that satisfy `criteria` (see
/// [`Criteria`]). An error in `criteria` or `range` is the result.
pub struct CountIf;

impl Function for CountIf {
    fn name(&self) -> &'static str {
        "COUNTIF"
    }

    fn arity(&self) -> Arity {
        Arity::exact(2)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let range = match ctx.range(&args[0]) {
            Ok(r) => r,
            Err(e) => return Value::Error(e),
        };
        let crit = match Criteria::parse(&ctx.scalar(&args[1])) {
            Ok(c) => c,
            Err(e) => return Value::Error(e),
        };
        let n = cells(&range)
            .iter()
            .filter(|(_, _, v)| crit.matches(v))
            .count();
        Value::Number(n as f64)
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn normal() {
        // A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5".
        assert_eq!(eval("=COUNTIF(A1:A3,\">1\")"), Value::Number(1.0));
        assert_eq!(eval("=COUNTIF(A1:A3,3)"), Value::Number(1.0));
        assert_eq!(eval("=COUNTIF(A1:A3,\"X\")"), Value::Number(1.0));
        assert_eq!(eval("=COUNTIF(A1:B3,\"?\")"), Value::Number(2.0));
        assert_eq!(eval("=COUNTIF(B1:B2,5)"), Value::Number(1.0));
        assert_eq!(eval("=COUNTIF(B1:B2,TRUE)"), Value::Number(1.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=COUNTIF(A1:A3,\"\")"), Value::Number(0.0));
        assert_eq!(eval("=COUNTIF(A1:C4,\"\")"), Value::Number(5.0));
        assert_eq!(eval("=COUNTIF(A1:A3,\"<>x\")"), Value::Number(2.0));
        assert_eq!(eval("=COUNTIF(C1:C2,\"#N/A\")"), Value::Number(1.0));
        assert_eq!(eval("=COUNTIF(A:A,\">0\")"), Value::Number(2.0));
        assert_eq!(eval("=COUNTIF(Z9,0)"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=COUNTIF(A1:A3,C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(
            eval("=COUNTIF(A1:A3,\"<>\"&C2)"),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(eval("=COUNTIF(#N/A,1)"), Value::Error(ErrorKind::NA));
    }
}
