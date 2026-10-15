//! `TEXTJOIN(delimiter, ignore_empty, text1, ...)`.

use crate::ast::ErrorKind;
use crate::functions::helpers::flat_values;
use crate::functions::Arity;
use crate::value::{to_text, Value};

function!(
    /// Joins the values of its arguments (ranges flattened row-major) with
    /// a delimiter (a range of delimiters is cycled); empty values are
    /// skipped when `ignore_empty` is true. Errors propagate; a result
    /// above 32767 characters is `#VALUE!`.
    TextJoin, "TEXTJOIN", Arity::range(3, 255), |args, ctx| {
    let delims: Vec<String> = flat_values(ctx, &args[0])?
        .iter()
        .map(to_text)
        .collect::<Result<_, _>>()?;
    let ignore = ctx.bool(&args[1])?;
    let mut parts: Vec<String> = Vec::new();
    for a in &args[2..] {
        for v in flat_values(ctx, a)? {
            let s = to_text(&v)?;
            if ignore && s.is_empty() {
                continue;
            }
            parts.push(s);
        }
    }
    let mut out = String::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 && !delims.is_empty() {
            out.push_str(&delims[(i - 1) % delims.len()]);
        }
        out.push_str(p);
    }
    if out.chars().count() > 32767 {
        return Err(ErrorKind::Value);
    }
    Ok(Value::Text(out))
});
