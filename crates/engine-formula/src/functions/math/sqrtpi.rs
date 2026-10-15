//! `SQRTPI(number)`.
use crate::ast::ErrorKind;
num1!(
    /// Square root of `number * pi`; negative is `#NUM!`.
    SqrtPi, "SQRTPI", |x| if x < 0.0 { Err(ErrorKind::Num) } else { Ok((x * std::f64::consts::PI).sqrt()) });
