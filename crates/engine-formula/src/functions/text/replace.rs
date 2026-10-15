//! `REPLACE(old_text, start_num, num_chars, new_text)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Replaces `num_chars` characters from `start_num` (1-based) with
    /// `new_text`; a start beyond the end appends; start < 1 or
    /// `num_chars` < 0 is `#VALUE!`.
    Replace, "REPLACE", Arity::exact(4), |args, ctx| {
    let old: Vec<char> = ctx.text(&args[0])?.chars().collect();
    let start = ctx.number(&args[1])?.trunc();
    let count = ctx.number(&args[2])?.trunc();
    let new = ctx.text(&args[3])?;
    if start < 1.0 || count < 0.0 {
        return Err(ErrorKind::Value);
    }
    let s = ((start - 1.0).min(old.len() as f64)) as usize;
    let e = (s as f64 + count).min(old.len() as f64) as usize;
    let mut out: String = old[..s].iter().collect();
    out.push_str(&new);
    out.extend(&old[e..]);
    Ok(Value::Text(out))
});
