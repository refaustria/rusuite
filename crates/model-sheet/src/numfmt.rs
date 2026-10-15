//! Number format codes and Excel's built-in format ids.
//!
//! Cell styles store number formats as format-code strings (ADR 0004);
//! `fmt-xlsx` maps the built-in ids to codes at the file boundary with
//! [`builtin_code`] / [`builtin_id`].

/// The default number format.
pub const GENERAL: &str = "General";

/// Built-in number formats defined by ECMA-376 Part 1, §18.8.30.
///
/// Ids 5–8, 23–36 and 41–44 are locale-dependent (currency, East-Asian
/// dates) and not defined by the standard, so they are not listed.
const BUILTIN: [(u16, &str); 28] = [
    (0, GENERAL),
    (1, "0"),
    (2, "0.00"),
    (3, "#,##0"),
    (4, "#,##0.00"),
    (9, "0%"),
    (10, "0.00%"),
    (11, "0.00E+00"),
    (12, "# ?/?"),
    (13, "# ??/??"),
    (14, "mm-dd-yy"),
    (15, "d-mmm-yy"),
    (16, "d-mmm"),
    (17, "mmm-yy"),
    (18, "h:mm AM/PM"),
    (19, "h:mm:ss AM/PM"),
    (20, "h:mm"),
    (21, "h:mm:ss"),
    (22, "m/d/yy h:mm"),
    (37, "#,##0 ;(#,##0)"),
    (38, "#,##0 ;[Red](#,##0)"),
    (39, "#,##0.00;(#,##0.00)"),
    (40, "#,##0.00;[Red](#,##0.00)"),
    (45, "mm:ss"),
    (46, "[h]:mm:ss"),
    (47, "mmss.0"),
    (48, "##0.0E+0"),
    (49, "@"),
];

/// The format code of built-in format `id`, if the standard defines it.
pub fn builtin_code(id: u16) -> Option<&'static str> {
    BUILTIN.iter().find(|(i, _)| *i == id).map(|(_, c)| *c)
}

/// The built-in id of format `code` (exact match; `General` matches
/// case-insensitively).
pub fn builtin_id(code: &str) -> Option<u16> {
    if code.eq_ignore_ascii_case(GENERAL) {
        return Some(0);
    }
    BUILTIN.iter().find(|(_, c)| *c == code).map(|(i, _)| *i)
}

/// Whether `code` formats numbers as a date and/or time: it contains a
/// `y`, `m`, `d`, `h` or `s` token (any case) outside double-quoted
/// literals, `[...]` sections (colors, conditions, locales), backslash
/// escapes and the `_x` / `*x` spacing/fill characters, and is not
/// `General`.
///
/// Elapsed-time formats such as `[h]:mm:ss` count as time formats through
/// their unbracketed tokens.
pub fn is_date_format(code: &str) -> bool {
    if code.eq_ignore_ascii_case(GENERAL) {
        return false;
    }
    let mut chars = code.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                for q in chars.by_ref() {
                    if q == '"' {
                        break;
                    }
                }
            }
            '[' => {
                for q in chars.by_ref() {
                    if q == ']' {
                        break;
                    }
                }
            }
            '\\' | '_' | '*' => {
                chars.next();
            }
            c if matches!(c.to_ascii_lowercase(), 'y' | 'm' | 'd' | 'h' | 's') => return true,
            _ => {}
        }
    }
    false
}

/// Shown when a number cannot be rendered with its format (e.g. a
/// negative date), as Excel does.
pub const UNDISPLAYABLE: &str = "#####";

/// Formats a cell value as the grid shows it: numbers with
/// `number_format` (`None` or `General` → Excel's General format),
/// booleans as `TRUE`/`FALSE`, errors as `#…`, text as is, empty as `""`.
pub fn display_value(value: &engine_formula::Value, number_format: Option<&str>) -> String {
    use engine_formula::Value;
    match value {
        Value::Empty => String::new(),
        Value::Number(n) => match number_format {
            Some(code) if !code.trim().eq_ignore_ascii_case("general") => {
                engine_formula::format_number(*n, code).unwrap_or_else(|| UNDISPLAYABLE.into())
            }
            _ => engine_formula::value::format_general(*n),
        },
        Value::Text(t) => t.clone(),
        Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Value::Error(e) => e.to_string(),
        Value::Array(_) => display_value(&value.clone().into_scalar(), number_format),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_roundtrip() {
        assert_eq!(BUILTIN.len(), 28);
        for (id, code) in BUILTIN {
            assert_eq!(builtin_code(id), Some(code));
            assert_eq!(builtin_id(code), Some(id));
        }
        for id in (0..=22).chain(37..=40).chain(45..=49) {
            assert_eq!(builtin_code(id).is_some(), !(5..=8).contains(&id), "{id}");
        }
        assert_eq!(builtin_code(14), Some("mm-dd-yy"));
        assert_eq!(builtin_code(22), Some("m/d/yy h:mm"));
        assert_eq!(builtin_code(49), Some("@"));
        assert_eq!(builtin_code(5), None);
        assert_eq!(builtin_code(50), None);
        assert_eq!(builtin_id("general"), Some(0));
        assert_eq!(builtin_id("0.000"), None);
    }

    #[test]
    fn date_formats() {
        assert!(is_date_format("yyyy-mm-dd"));
        assert!(!is_date_format("\"m\"0.00"));
        assert!(!is_date_format("[Red]0"));
        assert!(!is_date_format("General"));
        assert!(!is_date_format("general"));
        assert!(is_date_format("h:mm"));
        assert!(!is_date_format("@"));
        assert!(is_date_format("[h]:mm:ss"));
        assert!(is_date_format("DD.MM.YYYY"));
        assert!(!is_date_format("0.00E+00"));
        assert!(!is_date_format("#,##0 \\d"));
        assert!(!is_date_format("0_s"));
        assert!(!is_date_format("[$-409]0"));
        for (id, code) in BUILTIN {
            assert_eq!(
                is_date_format(code),
                (14..=22).contains(&id) || (45..=47).contains(&id),
                "{code}"
            );
        }
    }
}
