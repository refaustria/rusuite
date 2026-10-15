//! `LOG10(number)`.
use crate::ast::ErrorKind;
num1!(
    /// Base-10 logarithm; `number <= 0` is `#NUM!`.
    Log10, "LOG10", |x| if x > 0.0 { Ok(crate::value::round_15(x.log10())) } else { Err(ErrorKind::Num) });
