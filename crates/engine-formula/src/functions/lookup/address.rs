//! `ADDRESS(row, column, [abs_num], [a1], [sheet_text])`.

use crate::ast::{col_to_letters, ErrorKind, MAX_COL, MAX_ROW};
use crate::functions::helpers::opt_num;
use crate::functions::Arity;
use crate::value::Value;

/// Sheet name as it must appear before `!`.
fn quote_sheet(name: &str) -> String {
    let plain = !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '.');
    if plain {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

function!(
    /// Cell address as text. `abs_num` 1 (default) `$A$1`, 2 `A$1`,
    /// 3 `$A1`, 4 `A1`; `a1` FALSE gives R1C1 notation (`R1C1`, `R1C[1]`,
    /// `R[1]C1`, `R[1]C[1]`); an optional sheet name is quoted when needed.
    /// Row/column outside the sheet or `abs_num` outside 1..=4 is `#VALUE!`.
    Address, "ADDRESS", Arity::range(2, 5), |args, ctx| {
    let row = ctx.number(&args[0])?.trunc();
    let col = ctx.number(&args[1])?.trunc();
    let abs = opt_num(ctx, args, 2, 1.0)?.trunc() as i32;
    let a1 = match args.get(3) {
        Some(e) if !ctx.is_missing(e) => ctx.bool(e)?,
        _ => true,
    };
    if row < 1.0 || row > f64::from(MAX_ROW) + 1.0 || col < 1.0 || col > f64::from(MAX_COL) + 1.0 || !(1..=4).contains(&abs) {
        return Err(ErrorKind::Value);
    }
    let (row, col) = (row as u32, col as u32);
    let row_abs = abs == 1 || abs == 2;
    let col_abs = abs == 1 || abs == 3;
    let mut s = String::new();
    if let Some(e) = args.get(4) {
        if !ctx.is_missing(e) {
            let name = ctx.text(e)?;
            if !name.is_empty() {
                s.push_str(&quote_sheet(&name));
                s.push('!');
            }
        }
    }
    if a1 {
        if col_abs { s.push('$'); }
        s.push_str(&col_to_letters(col - 1));
        if row_abs { s.push('$'); }
        s.push_str(&row.to_string());
    } else {
        if row_abs { s.push_str(&format!("R{row}")); } else { s.push_str(&format!("R[{row}]")); }
        if col_abs { s.push_str(&format!("C{col}")); } else { s.push_str(&format!("C[{col}]")); }
    }
    Ok(Value::Text(s))
});
