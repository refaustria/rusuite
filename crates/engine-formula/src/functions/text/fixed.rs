//! `FIXED(number, [decimals], [no_commas])`.

use crate::ast::ErrorKind;
use crate::functions::helpers::opt_num;
use crate::functions::math::{round_digits, Rounding};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Rounds to `decimals` (default 2, may be negative) and formats as
    /// text with thousands separators unless `no_commas` is true.
    Fixed, "FIXED", Arity::range(1, 3), |args, ctx| {
    let x = ctx.number(&args[0])?;
    let d = opt_num(ctx, args, 1, 2.0)?.trunc();
    let no_commas = match args.get(2) {
        Some(e) if !ctx.is_missing(e) => ctx.bool(e)?,
        _ => false,
    };
    if d > 127.0 {
        return Err(ErrorKind::Value);
    }
    let r = round_digits(x, d, Rounding::Nearest);
    let decimals = d.max(0.0) as usize;
    let body = format!("{:.*}", decimals, r.abs());
    let (int, frac) = match body.split_once('.') {
        Some((i, f)) => (i.to_string(), Some(f.to_string())),
        None => (body, None),
    };
    let int = if no_commas {
        int
    } else {
        let mut out = String::new();
        for (i, ch) in int.chars().enumerate() {
            if i > 0 && (int.len() - i) % 3 == 0 {
                out.push(',');
            }
            out.push(ch);
        }
        out
    };
    let mut s = if r < 0.0 { "-".to_string() } else { String::new() };
    s.push_str(&int);
    if let Some(f) = frac {
        s.push('.');
        s.push_str(&f);
    }
    Ok(Value::Text(s))
});
