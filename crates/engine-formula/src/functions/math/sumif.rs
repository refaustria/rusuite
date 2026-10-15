//! `SUMIF(range, criteria, [sum_range])`.

use crate::ast::Expr;
use crate::functions::math::criteria::{at, cells, Criteria};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Sums the cells of `sum_range` (default `range`) whose counterpart in
/// `range` satisfies `criteria`. `sum_range` is aligned by its top-left
/// cell and takes the shape of `range`. Errors in matching sum cells
/// propagate.
pub struct SumIf;

impl Function for SumIf {
    fn name(&self) -> &'static str {
        "SUMIF"
    }

    fn arity(&self) -> Arity {
        Arity::range(2, 3)
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
        let sum_range = match args.get(2) {
            Some(a) if !ctx.is_missing(a) => match ctx.range(a) {
                Ok(r) => Some(r),
                Err(e) => return Value::Error(e),
            },
            _ => None,
        };
        let mut total = 0.0;
        for (r, c, v) in cells(&range) {
            if !crit.matches(&v) {
                continue;
            }
            let target = match &sum_range {
                Some(s) => at(s, r, c).unwrap_or(Value::Empty),
                None => v,
            };
            match target {
                Value::Number(n) => total += n,
                Value::Error(e) => return Value::Error(e),
                _ => {}
            }
        }
        Value::number(total)
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
        assert_eq!(eval("=SUMIF(A1:A3,\">1\")"), Value::Number(3.0));
        assert_eq!(eval("=SUMIF(A1:A3,\"x\",A1:A3)"), Value::Number(0.0));
        assert_eq!(eval("=SUMIF(A1:A3,\"<>x\")"), Value::Number(4.0));
        assert_eq!(eval("=SUMIF(A1:A3,\"x\",B1:B3)"), Value::Number(0.0));
        assert_eq!(eval("=SUMIF(A1:A3,\">=1\",A1:A3)"), Value::Number(4.0));
        assert_eq!(eval("=SUMIF(A1:A3,1,A3:A5)"), Value::Number(3.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=SUMIF(A1:A3,\"zzz\")"), Value::Number(0.0));
        // sum_range smaller than range is extended to range's shape.
        assert_eq!(eval("=SUMIF(A1:A3,\">0\",A3)"), Value::Number(3.0));
        // Omitted third argument.
        assert_eq!(eval("=SUMIF(A1:A3,\">0\",)"), Value::Number(4.0));
        assert_eq!(eval("=SUMIF(A:A,\">0\")"), Value::Number(4.0));
        // Errors in the tested range are skipped.
        assert_eq!(eval("=SUMIF(C1:C2,\">0\")"), Value::Number(0.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=SUMIF(A1:A3,C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=SUMIF(A1:A3,\"<>\"&C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(
            eval("=SUMIF(C1:C2,\"#N/A\",C1:C2)"),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(eval("=SUMIF(#N/A,1)"), Value::Error(ErrorKind::NA));
    }
}
