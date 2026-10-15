//! `NUMBERVALUE(text, [decimal_separator], [group_separator])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::present;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Locale-independent text to number: whitespace is ignored, group
    /// separators are dropped, trailing `%` signs divide by 100, empty
    /// text is 0. Equal separators or malformed numbers are `#VALUE!`.
    NumberValue, "NUMBERVALUE", Arity::range(1, 3), |args, ctx| {
    let text = ctx.text(&args[0])?;
    let dec = if present(ctx, args, 1) { ctx.text(&args[1])?.chars().next().unwrap_or('.') } else { '.' };
    let grp = if present(ctx, args, 2) { ctx.text(&args[2])?.chars().next() } else { Some(',') };
    if Some(dec) == grp {
        return Err(ErrorKind::Value);
    }
    let mut s: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let mut pct = 0;
    while let Some(r) = s.strip_suffix('%') {
        s = r.to_string();
        pct += 1;
    }
    if s.is_empty() {
        return Ok(Value::Number(0.0));
    }
    let s: String = s
        .chars()
        .filter(|c| Some(*c) != grp)
        .map(|c| if c == dec { '.' } else { c })
        .collect();
    if !s.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '+' | '-' | 'e' | 'E')) {
        return Err(ErrorKind::Value);
    }
    let n: f64 = s.parse().map_err(|_| ErrorKind::Value)?;
    Ok(Value::number(n / 100f64.powi(pct)))
});
