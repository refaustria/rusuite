//! The `_xlfn.` prefix Excel stores in front of functions added after
//! Excel 2007 (e.g. `_xlfn.CONCAT(A1,B1)`).
//!
//! It is stripped on read (the engine knows the plain names) and re-added on
//! write for the functions in [`XLFN_FUNCTIONS`]; Excel shows `#NAME?` for
//! those functions when the prefix is missing.

/// Functions written with the `_xlfn.` prefix (uppercase): the ones
/// Excel added after 2007 that the engine implements. Every name must be
/// a registered engine function (checked by a test).
pub const XLFN_FUNCTIONS: &[&str] = &[
    "CEILING.MATH",
    "CONCAT",
    "COVARIANCE.P",
    "COVARIANCE.S",
    "DAYS",
    "FLOOR.MATH",
    "FORECAST.LINEAR",
    "IFNA",
    "IFS",
    "ISOWEEKNUM",
    "MAXIFS",
    "MINIFS",
    "MODE.SNGL",
    "NUMBERVALUE",
    "PERCENTILE.EXC",
    "PERCENTILE.INC",
    "PERCENTRANK.INC",
    "QUARTILE.EXC",
    "QUARTILE.INC",
    "RANDARRAY",
    "RANK.AVG",
    "RANK.EQ",
    "SEQUENCE",
    "SORTBY",
    "STDEV.P",
    "STDEV.S",
    "SWITCH",
    "TEXTJOIN",
    "UNICHAR",
    "UNICODE",
    "UNIQUE",
    "VAR.P",
    "VAR.S",
    "XLOOKUP",
    "XMATCH",
    "XOR",
];

/// Dynamic array functions Excel stores as `_xlfn._xlws.NAME` (every name
/// must be a registered engine function).
pub const XLWS_FUNCTIONS: &[&str] = &["FILTER", "SORT"];

const PREFIXES: [&str; 2] = ["_xlfn.", "_xlws."];

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '\\'
}

fn is_ident_continue(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '.' || c == '\\'
}

/// Calls `on_ident(out, ident, next_char)` for every identifier outside
/// string literals and quoted sheet names; everything else is copied.
fn rewrite_idents(
    formula: &str,
    mut on_ident: impl FnMut(&mut String, &str, Option<char>),
) -> String {
    let mut out = String::with_capacity(formula.len() + 8);
    let mut rest = formula;
    while let Some(c) = rest.chars().next() {
        if c == '"' || c == '\'' {
            // Literal up to the closing quote; a doubled quote is an escape.
            let mut end = rest.len();
            let mut iter = rest.char_indices().skip(1).peekable();
            while let Some((i, q)) = iter.next() {
                if q == c {
                    if iter.peek().map(|&(_, n)| n) == Some(c) {
                        iter.next();
                    } else {
                        end = i + c.len_utf8();
                        break;
                    }
                }
            }
            out.push_str(&rest[..end]);
            rest = &rest[end..];
        } else if is_ident_start(c) || c.is_ascii_digit() {
            let end = rest
                .char_indices()
                .find(|&(_, ch)| !is_ident_continue(ch))
                .map_or(rest.len(), |(i, _)| i);
            let (ident, tail) = rest.split_at(end);
            if c.is_ascii_digit() {
                out.push_str(ident);
            } else {
                on_ident(&mut out, ident, tail.chars().next());
            }
            rest = tail;
        } else {
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// Removes `_xlfn.` / `_xlws.` prefixes (any case) from identifiers.
pub fn strip_xlfn_prefixes(formula: &str) -> String {
    if !formula.contains('_') {
        return formula.to_owned();
    }
    rewrite_idents(formula, |out, ident, _| {
        let mut ident = ident;
        while let Some(p) = PREFIXES.iter().find(|p| {
            ident.len() > p.len()
                && ident.is_char_boundary(p.len())
                && ident[..p.len()].eq_ignore_ascii_case(p)
        }) {
            ident = &ident[p.len()..];
        }
        out.push_str(ident);
    })
}

/// Adds the `_xlfn.` prefix to calls of the functions in [`XLFN_FUNCTIONS`]
/// and `_xlfn._xlws.` to those in [`XLWS_FUNCTIONS`].
pub fn add_xlfn_prefixes(formula: &str) -> String {
    rewrite_idents(formula, |out, ident, next| {
        let listed = |list: &[&str]| list.iter().any(|f| f.eq_ignore_ascii_case(ident));
        if next == Some('(') && listed(XLFN_FUNCTIONS) {
            out.push_str("_xlfn.");
        } else if next == Some('(') && listed(XLWS_FUNCTIONS) {
            out.push_str("_xlfn._xlws.");
        }
        out.push_str(ident);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_and_add() {
        assert_eq!(
            strip_xlfn_prefixes("_xlfn.CONCAT(A1,\"_xlfn.x\")"),
            "CONCAT(A1,\"_xlfn.x\")"
        );
        assert_eq!(strip_xlfn_prefixes("_XLFN.days(B2,B1)+1"), "days(B2,B1)+1");
        assert_eq!(
            strip_xlfn_prefixes("_xlfn._xlws.SORT(A1:A3)"),
            "SORT(A1:A3)"
        );
        assert_eq!(strip_xlfn_prefixes("'_xlfn.s'!A1"), "'_xlfn.s'!A1");
        assert_eq!(strip_xlfn_prefixes("SUM(A1:B2)"), "SUM(A1:B2)");

        assert_eq!(
            add_xlfn_prefixes("CONCAT(A1,\"CONCAT(\")"),
            "_xlfn.CONCAT(A1,\"CONCAT(\")"
        );
        assert_eq!(
            add_xlfn_prefixes("days(B2,B1)&concat(1)"),
            "_xlfn.days(B2,B1)&_xlfn.concat(1)"
        );
        assert_eq!(
            add_xlfn_prefixes("CONCATENATE(A1)+DAYS"),
            "CONCATENATE(A1)+DAYS"
        );
        assert_eq!(
            add_xlfn_prefixes("'it''s CONCAT('!A1+1.5E+3"),
            "'it''s CONCAT('!A1+1.5E+3"
        );
        assert_eq!(add_xlfn_prefixes("_xlfn.CONCAT(1)"), "_xlfn.CONCAT(1)");

        for f in [
            "CONCAT(A1,DAYS(B1,B2))",
            "IF(A1>2,\"x\",CONCAT(\"a\",\"b\"))",
            "Data!D7",
        ] {
            assert_eq!(strip_xlfn_prefixes(&add_xlfn_prefixes(f)), f);
        }
        assert!(XLFN_FUNCTIONS.contains(&"CONCAT") && XLFN_FUNCTIONS.contains(&"DAYS"));
    }

    #[test]
    fn every_listed_name_is_a_registered_function() {
        let reg = engine_formula::FunctionRegistry::with_builtins();
        for f in XLFN_FUNCTIONS.iter().chain(XLWS_FUNCTIONS) {
            assert!(reg.get(f).is_some(), "{f} is not an engine function");
        }
        // NETWORKDAYS.INTL / WORKDAY.INTL are stored without a prefix.
        assert!(!XLFN_FUNCTIONS.contains(&"NETWORKDAYS.INTL"));
    }

    #[test]
    fn new_functions_get_and_lose_the_prefix() {
        assert_eq!(
            add_xlfn_prefixes("XLOOKUP(1,A:A,B:B)"),
            "_xlfn.XLOOKUP(1,A:A,B:B)"
        );
        assert_eq!(add_xlfn_prefixes("STDEV.S(A1:A3)"), "_xlfn.STDEV.S(A1:A3)");
        assert_eq!(
            add_xlfn_prefixes("STDEV(A1:A3)+NETWORKDAYS.INTL(1,2)"),
            "STDEV(A1:A3)+NETWORKDAYS.INTL(1,2)"
        );
        assert_eq!(
            strip_xlfn_prefixes("_xlfn.XLOOKUP(1,A:A,B:B)"),
            "XLOOKUP(1,A:A,B:B)"
        );
        for f in XLFN_FUNCTIONS.iter().chain(XLWS_FUNCTIONS) {
            let call = format!("{f}(A1)");
            assert_eq!(strip_xlfn_prefixes(&add_xlfn_prefixes(&call)), call);
        }
        assert_eq!(
            add_xlfn_prefixes("SORT(FILTER(A1:B9,A1:A9>1))+SORTBY(A1:A3,B1:B3)"),
            "_xlfn._xlws.SORT(_xlfn._xlws.FILTER(A1:B9,A1:A9>1))+_xlfn.SORTBY(A1:A3,B1:B3)"
        );
    }
}
