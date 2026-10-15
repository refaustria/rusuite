//! `FACT(number)`.
use crate::ast::ErrorKind;
num1!(
    /// Factorial of the truncated number; negative or above 170 is `#NUM!`.
    Fact, "FACT", |x| {
    let n = x.trunc();
    if !(0.0..=170.0).contains(&n) {
        return Err(ErrorKind::Num);
    }
    Ok((1..=n as u32).fold(1.0, |a, i| a * f64::from(i)))
});
