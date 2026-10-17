//! R1C1 reference style (Excel's File › Options › Formulas › R1C1
//! reference style), for display and entry only: formulas are stored in
//! A1 style. [`Expr::to_r1c1`](crate::Expr::to_r1c1) prints a formula in
//! R1C1 style; [`r1c1_to_a1`] and [`parse_r1c1`] read one back.
//!
//! `R2C3` is the absolute cell `$C$2`, `R[-1]C` the cell one row up in
//! the same column, `R1` / `R[1]:R[2]` whole rows, `C2` / `C[-1]` whole
//! columns. Offsets are relative to the formula cell.
//!
//! ```
//! use engine_formula::r1c1::r1c1_to_a1;
//! assert_eq!(r1c1_to_a1("=SUM(R1C1:R[1]C)", 4, 1).unwrap(), "=SUM($A$1:B6)");
//! let ast = engine_formula::parse("=SUM($A$1:B6)").unwrap();
//! assert_eq!(ast.to_r1c1(4, 1), "SUM(R1C1:R[1]C)");
//! ```

use crate::ast::{col_to_letters, MAX_COL, MAX_ROW};
use crate::parser::{parse, ParseError};
use crate::Expr;

/// One part of an R1C1 coordinate: absolute (0-based) or relative.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Part {
    Abs(u32),
    Rel(i64),
}

/// A matched R1C1 token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Token {
    Cell(Part, Part),
    Row(Part),
    Col(Part),
}

fn ident_continue(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '.' | '\\' | '?')
}

/// Reads `[n]`, `n` or nothing after `R`/`C` at byte `i`.
fn part(s: &str, i: usize) -> Option<(Part, usize)> {
    let b = s.as_bytes();
    if b.get(i) == Some(&b'[') {
        let close = s[i..].find(']')? + i;
        let n: i64 = s[i + 1..close].trim().parse().ok()?;
        return Some((Part::Rel(n), close + 1));
    }
    let digits = s[i..].bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return Some((Part::Rel(0), i));
    }
    let n: u64 = s[i..i + digits].parse().ok()?;
    if n == 0 || n > u64::from(MAX_ROW) + 1 {
        return None;
    }
    Some((Part::Abs((n - 1) as u32), i + digits))
}

/// Matches an R1C1 token at byte `i`; returns it and its end.
fn token_at(s: &str, i: usize) -> Option<(Token, usize)> {
    let b = s.as_bytes();
    let tok = match b.get(i).map(u8::to_ascii_uppercase) {
        Some(b'R') => {
            let (r, j) = part(s, i + 1)?;
            if b.get(j).map(u8::to_ascii_uppercase) == Some(b'C') {
                let (c, k) = part(s, j + 1)?;
                (Token::Cell(r, c), k)
            } else {
                (Token::Row(r), j)
            }
        }
        Some(b'C') => {
            let (c, j) = part(s, i + 1)?;
            (Token::Col(c), j)
        }
        _ => return None,
    };
    let next = s[tok.1..].chars().next();
    if next.is_some_and(|c| ident_continue(c) || c == '(' || c == '[') {
        return None;
    }
    Some(tok)
}

fn resolve(p: Part, here: u32, max: u32, pos: usize) -> Result<(u32, bool), ParseError> {
    match p {
        Part::Abs(v) if v <= max => Ok((v, true)),
        Part::Abs(_) => Err(ParseError::new(pos, "reference out of range")),
        Part::Rel(d) => {
            let v = i64::from(here) + d;
            if (0..=i64::from(max)).contains(&v) {
                Ok((v as u32, false))
            } else {
                Err(ParseError::new(pos, "reference leaves the sheet"))
            }
        }
    }
}

fn dollar(abs: bool) -> &'static str {
    if abs {
        "$"
    } else {
        ""
    }
}

/// Converts formula text in R1C1 style, entered in the cell `(row, col)`
/// (0-based), to A1 style. Strings, quoted sheet names and structured
/// references are copied unchanged.
pub fn r1c1_to_a1(text: &str, row: u32, col: u32) -> Result<String, ParseError> {
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut prev: Option<char> = None;
    while i < text.len() {
        let c = text[i..].chars().next().expect("in bounds");
        match c {
            '"' | '\'' => {
                // Copy the literal (doubled quotes escape).
                let mut j = i + 1;
                loop {
                    match text[j..].find(c) {
                        Some(o) => {
                            j += o + 1;
                            if text[j..].starts_with(c) {
                                j += 1;
                                continue;
                            }
                            break;
                        }
                        None => {
                            j = text.len();
                            break;
                        }
                    }
                }
                out.push_str(&text[i..j]);
                prev = Some(c);
                i = j;
                continue;
            }
            '[' => {
                // A structured reference's brackets.
                let mut depth = 0;
                let mut j = i;
                for (o, ch) in text[i..].char_indices() {
                    match ch {
                        '[' => depth += 1,
                        ']' => {
                            depth -= 1;
                            if depth == 0 {
                                j = i + o + 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                if j == i {
                    j = text.len();
                }
                out.push_str(&text[i..j]);
                prev = Some(']');
                i = j;
                continue;
            }
            _ => {}
        }
        let boundary = !prev.is_some_and(ident_continue);
        if boundary {
            if let Some((tok, end)) = token_at(text, i) {
                let (a1, end) = convert(text, tok, end, row, col, i)?;
                out.push_str(&a1);
                prev = Some('1');
                i = end;
                continue;
            }
        }
        if boundary && (c.is_alphabetic() || c == '_' || c == '\\') {
            // Copy a whole identifier (and a structured reference after it).
            let len = text[i..]
                .char_indices()
                .find(|&(_, ch)| !ident_continue(ch))
                .map_or(text.len() - i, |(o, _)| o);
            out.push_str(&text[i..i + len]);
            prev = text[i..i + len].chars().last();
            i += len;
            continue;
        }
        out.push(c);
        prev = Some(c);
        i += c.len_utf8();
    }
    Ok(out)
}

/// The A1 text of `tok` (and of a following `:tok` of the same kind for
/// rows and columns); returns the text and the end of what was consumed.
fn convert(
    text: &str,
    tok: Token,
    end: usize,
    row: u32,
    col: u32,
    pos: usize,
) -> Result<(String, usize), ParseError> {
    match tok {
        Token::Cell(r, c) => {
            let (r, ra) = resolve(r, row, MAX_ROW, pos)?;
            let (c, ca) = resolve(c, col, MAX_COL, pos)?;
            Ok((
                format!("{}{}{}{}", dollar(ca), col_to_letters(c), dollar(ra), r + 1),
                end,
            ))
        }
        Token::Row(_) | Token::Col(_) => {
            // `R1:R3` / `C1:C2`: a pair; a single one means that row/column.
            let pair = text[end..]
                .strip_prefix(':')
                .and_then(|_| token_at(text, end + 1))
                .filter(|(t, _)| {
                    matches!(
                        (tok, t),
                        (Token::Row(_), Token::Row(_)) | (Token::Col(_), Token::Col(_))
                    )
                });
            let (second, end) = match pair {
                Some((t, e)) => (t, e),
                None => (tok, end),
            };
            let one = |t: Token| -> Result<String, ParseError> {
                Ok(match t {
                    Token::Row(p) => {
                        let (r, a) = resolve(p, row, MAX_ROW, pos)?;
                        format!("{}{}", dollar(a), r + 1)
                    }
                    Token::Col(p) => {
                        let (c, a) = resolve(p, col, MAX_COL, pos)?;
                        format!("{}{}", dollar(a), col_to_letters(c))
                    }
                    Token::Cell(..) => unreachable!("rows and columns only"),
                })
            };
            Ok((format!("{}:{}", one(tok)?, one(second)?), end))
        }
    }
}

/// Parses formula text in R1C1 style entered in `(row, col)`.
pub fn parse_r1c1(text: &str, row: u32, col: u32) -> Result<Expr, ParseError> {
    parse(&r1c1_to_a1(text, row, col)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_rows_and_columns() {
        let a1 = |s: &str| r1c1_to_a1(s, 4, 2).unwrap();
        assert_eq!(a1("=R1C1"), "=$A$1");
        assert_eq!(a1("=RC"), "=C5");
        assert_eq!(a1("=R[-1]C[1]*2"), "=D4*2");
        assert_eq!(a1("=R[-1]C1+R2C[-2]"), "=$A4+A$2");
        assert_eq!(a1("=SUM(R1:R[1])"), "=SUM($1:6)");
        assert_eq!(a1("=SUM(C2)"), "=SUM($B:$B)");
        assert_eq!(a1("=SUM(C[-1]:C)"), "=SUM(B:C)");
        assert_eq!(a1("=SUM(R)"), "=SUM(5:5)");
        assert_eq!(a1("=Sheet2!R1C1&\"R1C1\""), "=Sheet2!$A$1&\"R1C1\"");
        assert_eq!(a1("='R1C1'!RC"), "='R1C1'!C5");
        assert_eq!(
            a1("=ROUND(RC[-1],0)+COUNT(C1)"),
            "=ROUND(B5,0)+COUNT($A:$A)"
        );
        assert_eq!(a1("=Table1[R1]"), "=Table1[R1]");
        assert!(r1c1_to_a1("=R[-9]C", 4, 2).is_err());
    }

    #[test]
    fn roundtrip_with_the_printer() {
        for (f, row, col) in [
            ("=SUM($A$1:B6)*C$3", 4, 1),
            ("=A:A+$2:$2+Sheet2!$B1", 0, 0),
            ("=Sheet1:Sheet3!B2+(A1,C3)", 9, 9),
            ("=A1:B5 B3:C7", 2, 2),
        ] {
            let ast = parse(f).unwrap();
            let r1c1 = ast.to_r1c1(row, col);
            assert_eq!(parse_r1c1(&r1c1, row, col).unwrap(), ast, "{f} -> {r1c1}");
        }
        assert_eq!(parse("=A:A").unwrap().to_r1c1(0, 0), "C");
        assert_eq!(parse("=$2:$3").unwrap().to_r1c1(0, 0), "R2:R3");
    }
}
