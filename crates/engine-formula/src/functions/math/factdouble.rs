//! `FACTDOUBLE(number)`.
use crate::ast::ErrorKind;
num1!(
    /// Double factorial `n!!` of the truncated number (`-1` and `0` give 1).
    FactDouble, "FACTDOUBLE", |x| {
    let n = x.trunc();
    if n < -1.0 || n > 300.0 {
        return Err(ErrorKind::Num);
    }
    let mut r = 1.0;
    let mut i = n;
    while i > 1.0 {
        r *= i;
        i -= 2.0;
    }
    Ok(r)
});
