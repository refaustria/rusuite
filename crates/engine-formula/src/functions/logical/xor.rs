//! `XOR(logical1, ...)`.

use crate::functions::logical::fold;
use crate::functions::Arity;

function!(
    /// TRUE when an odd number of arguments is true (same coercion rules
    /// as `AND`/`OR`).
    Xor, "XOR", Arity::range(1, 255), |args, ctx| {
    Ok(fold(args, ctx, false, |a, b| a != b))
});
