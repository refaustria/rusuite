//! `QUOTIENT(numerator, denominator)`.
use crate::ast::ErrorKind;
num2!(
    /// Integer part of the division; denominator 0 is `#DIV/0!`.
    Quotient, "QUOTIENT", |n, d| if d == 0.0 { Err(ErrorKind::Div0) } else { Ok(crate::value::round_15(n / d).trunc() + 0.0) });
