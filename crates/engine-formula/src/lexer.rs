//! Tokenizer for Excel (en-US) formula text.
//!
//! Cell references, `TRUE`/`FALSE` and function names are all lexed as
//! [`TokenKind::Ident`]; the parser decides what they mean. `$` is its own
//! token so that `A$1` lexes as `Ident(A) Dollar Number(1)`.

use serde::{Deserialize, Serialize};

use crate::ast::ErrorKind;
use crate::parser::ParseError;

/// Byte range `[start, end)` into the lexed text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TokenKind {
    Number(f64),
    /// String literal with `""` already unescaped.
    String(String),
    /// Identifier: letters, digits, `_`, `.`, `?` and backslashes (starting
    /// with a letter, `_` or a backslash).
    Ident(String),
    Error(ErrorKind),
    /// Sheet name before `!`: either a quoted `'My Sheet'` (unquoted, `''`
    /// unescaped) or a plain identifier immediately followed by `!`.
    SheetName(String),
    Bang,
    Colon,
    Comma,
    Semicolon,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Dollar,
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Amp,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Percent,
    /// `@` (implicit intersection).
    At,
    /// `#` that does not start an error literal (spilled-range operator,
    /// `A1#`).
    Hash,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '\\'
}

/// Defined names may also contain backslashes and `?`.
fn is_ident_continue(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '.' | '\\' | '?')
}

/// Tokenizes `src` (without the leading `=`). Whitespace is skipped.
pub fn tokenize(src: &str) -> Result<Vec<Token>, ParseError> {
    let mut tokens = Vec::new();
    let bytes = src.as_bytes();
    let mut i = 0;
    while i < src.len() {
        let c = src[i..].chars().next().expect("in bounds");
        if c.is_whitespace() {
            i += c.len_utf8();
            continue;
        }
        let start = i;
        let simple = |k: TokenKind, len: usize| (k, start + len);
        let (kind, end) = match c {
            '!' => simple(TokenKind::Bang, 1),
            ':' => simple(TokenKind::Colon, 1),
            ',' => simple(TokenKind::Comma, 1),
            ';' => simple(TokenKind::Semicolon, 1),
            '(' => simple(TokenKind::LParen, 1),
            ')' => simple(TokenKind::RParen, 1),
            '{' => simple(TokenKind::LBrace, 1),
            '}' => simple(TokenKind::RBrace, 1),
            '$' => simple(TokenKind::Dollar, 1),
            '+' => simple(TokenKind::Plus, 1),
            '-' => simple(TokenKind::Minus, 1),
            '*' => simple(TokenKind::Star, 1),
            '/' => simple(TokenKind::Slash, 1),
            '^' => simple(TokenKind::Caret, 1),
            '&' => simple(TokenKind::Amp, 1),
            '%' => simple(TokenKind::Percent, 1),
            '@' => simple(TokenKind::At, 1),
            '=' => simple(TokenKind::Eq, 1),
            '<' => match bytes.get(i + 1) {
                Some(b'>') => simple(TokenKind::Ne, 2),
                Some(b'=') => simple(TokenKind::Le, 2),
                _ => simple(TokenKind::Lt, 1),
            },
            '>' => match bytes.get(i + 1) {
                Some(b'=') => simple(TokenKind::Ge, 2),
                _ => simple(TokenKind::Gt, 1),
            },
            '"' => lex_string(src, start)?,
            '\'' => lex_quoted_sheet(src, start)?,
            '#' => lex_error(src, start).unwrap_or((TokenKind::Hash, start + 1)),
            c if c.is_ascii_digit()
                || (c == '.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit)) =>
            {
                lex_number(src, start)?
            }
            c if is_ident_start(c) => {
                let end = src[start..]
                    .char_indices()
                    .find(|&(_, c)| !is_ident_continue(c))
                    .map_or(src.len(), |(o, _)| start + o);
                let text = src[start..end].to_string();
                if bytes.get(end) == Some(&b'!') {
                    (TokenKind::SheetName(text), end)
                } else {
                    (TokenKind::Ident(text), end)
                }
            }
            other => {
                return Err(ParseError::new(
                    start,
                    format!("unexpected character `{other}`"),
                ))
            }
        };
        tokens.push(Token {
            kind,
            span: Span { start, end },
        });
        i = end;
    }
    Ok(tokens)
}

fn lex_number(src: &str, start: usize) -> Result<(TokenKind, usize), ParseError> {
    let bytes = src.as_bytes();
    let digits = |mut i: usize| {
        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        i
    };
    let mut i = digits(start);
    if bytes.get(i) == Some(&b'.') {
        i = digits(i + 1);
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        if bytes.get(j).is_some_and(u8::is_ascii_digit) {
            i = digits(j);
        }
    }
    let text = &src[start..i];
    // Rust's float grammar does not accept a bare trailing `.` before an
    // exponent in all versions; normalise `1.e3` to `1e3` and `1.` to `1`.
    let normalized = text.replacen(".e", "e", 1).replacen(".E", "E", 1);
    let normalized = normalized.strip_suffix('.').unwrap_or(&normalized);
    let n: f64 = normalized
        .parse()
        .map_err(|_| ParseError::new(start, format!("invalid number `{text}`")))?;
    if !n.is_finite() {
        return Err(ParseError::new(
            start,
            format!("number out of range `{text}`"),
        ));
    }
    Ok((TokenKind::Number(n), i))
}

fn lex_string(src: &str, start: usize) -> Result<(TokenKind, usize), ParseError> {
    let mut out = String::new();
    let mut chars = src[start + 1..].char_indices().peekable();
    while let Some((o, c)) = chars.next() {
        if c == '"' {
            if chars.peek().map(|&(_, c)| c) == Some('"') {
                chars.next();
                out.push('"');
            } else {
                return Ok((TokenKind::String(out), start + 1 + o + 1));
            }
        } else {
            out.push(c);
        }
    }
    Err(ParseError::new(start, "unterminated string literal"))
}

fn lex_quoted_sheet(src: &str, start: usize) -> Result<(TokenKind, usize), ParseError> {
    let mut out = String::new();
    let mut chars = src[start + 1..].char_indices().peekable();
    while let Some((o, c)) = chars.next() {
        if c == '\'' {
            if chars.peek().map(|&(_, c)| c) == Some('\'') {
                chars.next();
                out.push('\'');
                continue;
            }
            let end = start + 1 + o + 1;
            if out.is_empty() {
                return Err(ParseError::new(start, "empty sheet name"));
            }
            if src.as_bytes().get(end) != Some(&b'!') {
                return Err(ParseError::new(end, "expected `!` after quoted sheet name"));
            }
            return Ok((TokenKind::SheetName(out), end));
        }
        out.push(c);
    }
    Err(ParseError::new(start, "unterminated quoted sheet name"))
}

fn lex_error(src: &str, start: usize) -> Result<(TokenKind, usize), ParseError> {
    let rest = &src[start..];
    ErrorKind::ALL
        .into_iter()
        .find(|k| {
            let t = k.as_str();
            rest.get(..t.len())
                .is_some_and(|s| s.eq_ignore_ascii_case(t))
        })
        .map(|k| (TokenKind::Error(k), start + k.as_str().len()))
        .ok_or_else(|| ParseError::new(start, "unknown error literal"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use TokenKind as T;

    fn kinds(src: &str) -> Vec<TokenKind> {
        tokenize(src).unwrap().into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn numbers() {
        assert_eq!(kinds("1"), vec![T::Number(1.0)]);
        assert_eq!(kinds("1.25"), vec![T::Number(1.25)]);
        assert_eq!(kinds("1e3"), vec![T::Number(1000.0)]);
        assert_eq!(kinds("1E+3"), vec![T::Number(1000.0)]);
        assert_eq!(kinds("2.5e-1"), vec![T::Number(0.25)]);
        assert_eq!(kinds(".5"), vec![T::Number(0.5)]);
        assert_eq!(kinds("1."), vec![T::Number(1.0)]);
        assert_eq!(kinds("1.e2"), vec![T::Number(100.0)]);
        // `e` without exponent digits is not part of the number.
        assert_eq!(kinds("2e"), vec![T::Number(2.0), T::Ident("e".into())]);
        assert!(tokenize("1e999").is_err());
    }

    #[test]
    fn strings() {
        assert_eq!(kinds(r#""abc""#), vec![T::String("abc".into())]);
        assert_eq!(kinds(r#""a""b""#), vec![T::String("a\"b".into())]);
        assert_eq!(kinds(r#""""#), vec![T::String(String::new())]);
        assert_eq!(kinds(r#""""""#), vec![T::String("\"".into())]);
        assert_eq!(kinds(r#""ä ü""#), vec![T::String("ä ü".into())]);
        let e = tokenize(r#"1&"abc"#).unwrap_err();
        assert_eq!(e.pos, 2);
    }

    #[test]
    fn sheet_names() {
        assert_eq!(
            kinds("Sheet1!A1"),
            vec![
                T::SheetName("Sheet1".into()),
                T::Bang,
                T::Ident("A1".into())
            ]
        );
        assert_eq!(
            kinds("'My Sheet'!A1"),
            vec![
                T::SheetName("My Sheet".into()),
                T::Bang,
                T::Ident("A1".into())
            ]
        );
        assert_eq!(
            kinds("'it''s'!$B$2"),
            vec![
                T::SheetName("it's".into()),
                T::Bang,
                T::Dollar,
                T::Ident("B".into()),
                T::Dollar,
                T::Number(2.0)
            ]
        );
        assert!(tokenize("'abc").is_err());
        assert!(tokenize("'abc'A1").is_err());
        assert!(tokenize("''!A1").is_err());
    }

    #[test]
    fn error_literals() {
        for k in ErrorKind::ALL {
            assert_eq!(kinds(k.as_str()), vec![T::Error(k)]);
        }
        assert_eq!(kinds("#n/a"), vec![T::Error(ErrorKind::NA)]);
        assert_eq!(kinds("#spill!"), vec![T::Error(ErrorKind::Spill)]);
        // Not an error literal: the spilled-range operator.
        assert_eq!(kinds("#FOO"), vec![T::Hash, T::Ident("FOO".into())]);
        assert_eq!(
            kinds("A1#+@B1"),
            vec![
                T::Ident("A1".into()),
                T::Hash,
                T::Plus,
                T::At,
                T::Ident("B1".into())
            ]
        );
    }

    #[test]
    fn operators_and_punctuation() {
        assert_eq!(
            kinds("+-*/^&=<><<=>>=%!:,;(){}$"),
            vec![
                T::Plus,
                T::Minus,
                T::Star,
                T::Slash,
                T::Caret,
                T::Amp,
                T::Eq,
                T::Ne,
                T::Lt,
                T::Le,
                T::Gt,
                T::Ge,
                T::Percent,
                T::Bang,
                T::Colon,
                T::Comma,
                T::Semicolon,
                T::LParen,
                T::RParen,
                T::LBrace,
                T::RBrace,
                T::Dollar
            ]
        );
    }

    #[test]
    fn identifiers() {
        assert_eq!(
            kinds("_xlfn.XLOOKUP(a1)"),
            vec![
                T::Ident("_xlfn.XLOOKUP".into()),
                T::LParen,
                T::Ident("a1".into()),
                T::RParen
            ]
        );
        assert!(tokenize("1 ~ 2").is_err());
    }

    #[test]
    fn spans() {
        let toks = tokenize(" SUM( A1 ,\"x\"\"y\")<>'a b'!B2").unwrap();
        let spans: Vec<(usize, usize)> = toks.iter().map(|t| (t.span.start, t.span.end)).collect();
        assert_eq!(
            spans,
            vec![
                (1, 4),   // SUM
                (4, 5),   // (
                (6, 8),   // A1
                (9, 10),  // ,
                (10, 16), // "x""y"
                (16, 17), // )
                (17, 19), // <>
                (19, 24), // 'a b'
                (24, 25), // !
                (25, 27), // B2
            ]
        );
    }
}
