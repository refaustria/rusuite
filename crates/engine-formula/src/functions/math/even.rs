//! `EVEN(number)`.
num1!(
    /// Rounds away from zero to the nearest even integer.
    Even, "EVEN", |x| {
    let n = x.abs().ceil();
    let n = if n % 2.0 == 0.0 { n } else { n + 1.0 };
    Ok(if x < 0.0 { -n } else { n })
});
