//! `SUMPRODUCT(array1, [array2], ...)`.

use crate::ast::Expr;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Sum of the element-wise products of equally shaped ranges/arrays.
/// Non-numeric entries count as 0; a shape mismatch gives `#VALUE!`; the
/// first error entry is the result.
pub struct SumProduct;

impl Function for SumProduct {
    fn name(&self) -> &'static str {
        "SUMPRODUCT"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let mut arrays = Vec::with_capacity(args.len());
        for a in args {
            match ctx.range(a) {
                Ok(r) => arrays.push(r),
                Err(e) => return Value::Error(e),
            }
        }
        let (rows, cols) = (arrays[0].rows(), arrays[0].cols());
        if arrays.iter().any(|a| a.rows() != rows || a.cols() != cols) {
            return Value::Error(crate::ast::ErrorKind::Value);
        }
        let mut total = 0.0;
        for r in 0..rows {
            for c in 0..cols {
                let mut p = 1.0;
                for a in &arrays {
                    match a.get(r, c) {
                        Some(Value::Number(n)) => p *= n,
                        Some(Value::Error(e)) => return Value::Error(e),
                        _ => p = 0.0,
                    }
                }
                total += p;
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
        // A1:A3 = 1, "x", 3.
        assert_eq!(eval("=SUMPRODUCT({1,2,3},{4,5,6})"), Value::Number(32.0));
        assert_eq!(eval("=SUMPRODUCT(A1:A3)"), Value::Number(4.0));
        assert_eq!(eval("=SUMPRODUCT(A1:A3,A1:A3)"), Value::Number(10.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=SUMPRODUCT(A1:A3,B1:B3)"), Value::Number(0.0));
        assert_eq!(
            eval("=SUMPRODUCT(A1:A3,A1:A2)"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(
            eval("=SUMPRODUCT(A1:A3,A1:B3)"),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(eval("=SUMPRODUCT(5)"), Value::Number(5.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=SUMPRODUCT(C1:C2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(
            eval("=SUMPRODUCT(A1:A2,C1:C2)"),
            Value::Error(ErrorKind::Div0)
        );
        assert_eq!(eval("=SUMPRODUCT(#N/A)"), Value::Error(ErrorKind::NA));
    }
}
