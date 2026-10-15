//! `SEARCH(find_text, within_text, [start_num])`.

use crate::ast::ErrorKind;
use crate::functions::Arity;
use crate::value::Value;

#[derive(Clone, Copy)]
enum Tok {
    Star,
    Any,
    Lit(char),
}

fn fold(c: char) -> char {
    c.to_uppercase().next().unwrap_or(c)
}

fn parse(pattern: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut it = pattern.chars();
    while let Some(c) = it.next() {
        out.push(match c {
            '*' => Tok::Star,
            '?' => Tok::Any,
            '~' => Tok::Lit(fold(it.next().unwrap_or('~'))),
            c => Tok::Lit(fold(c)),
        });
    }
    out
}

/// Whether the pattern matches a prefix of `text`.
fn matches_prefix(p: &[Tok], t: &[char]) -> bool {
    match p.split_first() {
        None => true,
        Some((Tok::Star, rest)) => (0..=t.len()).any(|k| matches_prefix(rest, &t[k..])),
        Some((Tok::Any, rest)) => !t.is_empty() && matches_prefix(rest, &t[1..]),
        Some((Tok::Lit(c), rest)) => {
            t.first().is_some_and(|x| fold(*x) == *c) && matches_prefix(rest, &t[1..])
        }
    }
}

function!(
    /// Case-insensitive 1-based position of a substring; `?` and `*`
    /// wildcards (escape with `~`). Not found or an invalid start is `#VALUE!`.
    Search, "SEARCH", Arity::range(2, 3), |args, ctx| {
    let pat = parse(&ctx.text(&args[0])?);
    let within: Vec<char> = ctx.text(&args[1])?.chars().collect();
    let start = match args.get(2) {
        None => 1,
        Some(a) => {
            let n = ctx.number(a)?.trunc();
            if n < 1.0 || n > within.len() as f64 + 1.0 {
                return Err(ErrorKind::Value);
            }
            n as usize
        }
    };
    (start - 1..=within.len())
        .find(|&i| matches_prefix(&pat, &within[i..]))
        .map(|i| Value::Number((i + 1) as f64))
        .ok_or(ErrorKind::Value)
});
