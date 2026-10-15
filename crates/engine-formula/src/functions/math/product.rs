//! `PRODUCT(number1, [number2], ...)`.

use crate::ast::Expr;
use crate::functions::math::numbers;
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Product of numbers; no numbers gives 0.
pub struct Product;

impl Function for Product {
    fn name(&self) -> &'static str {
        "PRODUCT"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 255)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match numbers(args, ctx) {
            Err(e) => e,
            Ok(n) => {
                if n.is_empty() {
                    Value::Number(0.0)
                } else {
                    Value::number(n.iter().product::<f64>())
                }
            }
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
        assert_eq!(eval("=PRODUCT(2,3,4)"), Value::Number(24.0));
        assert_eq!(eval("=PRODUCT(A1:A3)"), Value::Number(3.0));
        assert_eq!(eval("=PRODUCT(\"2\",TRUE,3)"), Value::Number(6.0));
    }

    #[test]
    fn edge() {
        assert_eq!(eval("=PRODUCT(B1:B2)"), Value::Number(0.0));
        assert_eq!(eval("=PRODUCT(Z9)"), Value::Number(0.0));
        assert_eq!(eval("=PRODUCT(1E200,1E200)"), Value::Error(ErrorKind::Num));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=PRODUCT(A1:C3)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=PRODUCT(\"x\")"), Value::Error(ErrorKind::Value));
    }
}
