//! `LN(number)`.
use crate::ast::ErrorKind;
num1!(
    /// Natural logarithm; `number <= 0` is `#NUM!`.
    Ln, "LN", |x| if x > 0.0 { Ok(x.ln()) } else { Err(ErrorKind::Num) });
