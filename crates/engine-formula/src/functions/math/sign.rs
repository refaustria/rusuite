//! `SIGN(number)`.
num1!(
    /// 1, 0 or -1.
    Sign, "SIGN", |x| Ok(if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { 0.0 }));
