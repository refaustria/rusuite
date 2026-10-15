//! `PROPER(text)`.

use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Upper-cases every letter that follows a non-letter and lower-cases
    /// the others.
    Proper, "PROPER", Arity::exact(1), |args, ctx| {
    let s = ctx.text(&args[0])?;
    let mut out = String::with_capacity(s.len());
    let mut prev_letter = false;
    for c in s.chars() {
        if c.is_alphabetic() {
            if prev_letter {
                out.extend(c.to_lowercase());
            } else {
                out.extend(c.to_uppercase());
            }
            prev_letter = true;
        } else {
            out.push(c);
            prev_letter = false;
        }
    }
    Ok(Value::Text(out))
});
