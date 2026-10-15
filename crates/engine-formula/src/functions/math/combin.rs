//! `COMBIN(number, number_chosen)`.
use crate::ast::ErrorKind;
num2!(
    /// Binomial coefficient of the truncated arguments.
    Combin, "COMBIN", |n, k| {
    let (n, k) = (n.trunc(), k.trunc());
    if n < 0.0 || k < 0.0 || k > n {
        return Err(ErrorKind::Num);
    }
    let k = k.min(n - k);
    let mut r = 1.0;
    let mut i = 1.0;
    while i <= k {
        r = (r * (n - k + i) / i).round();
        i += 1.0;
    }
    Ok(r)
});
