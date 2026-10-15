//! `CHAR(number)` and `CODE(text)` (Windows-1252), `UNICHAR`, `UNICODE`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

/// Code points of the Windows-1252 bytes 0x80..=0x9F.
const CP1252: [u32; 32] = [
    0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0x8D, 0x017D, 0x8F, 0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
];

function!(
    /// The character for a Windows-1252 code 1..=255; others are `#VALUE!`.
    Char, "CHAR", Arity::exact(1), |args, ctx| {
    let n = ctx.number(&args[0])?.trunc();
    if !(1.0..=255.0).contains(&n) {
        return Err(ErrorKind::Value);
    }
    let n = n as u32;
    let cp = if (0x80..0xA0).contains(&n) { CP1252[(n - 0x80) as usize] } else { n };
    Ok(Value::Text(char::from_u32(cp).map(String::from).unwrap_or_default()))
});

function!(
    /// Windows-1252 code of the first character (`63` for characters it
    /// cannot represent); empty text is `#VALUE!`.
    Code, "CODE", Arity::exact(1), |args, ctx| {
    let s = ctx.text(&args[0])?;
    let c = s.chars().next().ok_or(ErrorKind::Value)? as u32;
    let code = if c < 0x80 || (0xA0..=0xFF).contains(&c) {
        c
    } else if let Some(i) = CP1252.iter().position(|&x| x == c) {
        0x80 + i as u32
    } else {
        63
    };
    Ok(Value::Number(f64::from(code)))
});

function!(
    /// Unicode code point of the first character; empty text is `#VALUE!`.
    Unicode, "UNICODE", Arity::exact(1), |args, ctx| {
    let s = ctx.text(&args[0])?;
    Ok(Value::Number(f64::from(s.chars().next().ok_or(ErrorKind::Value)? as u32)))
});

function!(
    /// The character of a Unicode code point; 0, surrogates and values
    /// above 0x10FFFF are `#VALUE!`.
    UniChar, "UNICHAR", Arity::exact(1), |args, ctx| {
    let n = ctx.number(&args[0])?.trunc();
    if !(1.0..=1_114_111.0).contains(&n) {
        return Err(ErrorKind::Value);
    }
    char::from_u32(n as u32)
        .map(|c| Value::Text(c.to_string()))
        .ok_or(ErrorKind::Value)
});
