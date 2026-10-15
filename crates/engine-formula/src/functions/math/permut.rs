//! `PERMUT(number, number_chosen)`.
use crate::ast::ErrorKind;
num2!(
    /// Number of ordered selections `n! / (n-k)!` of the truncated arguments.
    Permut, "PERMUT", |n, k| {
    let (n, k) = (n.trunc(), k.trunc());
    if n < 0.0 || k < 0.0 || k > n {
        return Err(ErrorKind::Num);
    }
    let mut r = 1.0;
    let mut i = 0.0;
    while i < k {
        r *= n - i;
        i += 1.0;
    }
    Ok(r)
});
