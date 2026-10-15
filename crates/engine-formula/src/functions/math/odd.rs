//! `ODD(number)`.
num1!(
    /// Rounds away from zero to the nearest odd integer.
    Odd, "ODD", |x| {
    let n = x.abs().ceil();
    let n = if n % 2.0 == 1.0 { n } else { n + 1.0 };
    Ok(if x < 0.0 { -n } else { n })
});
