//! Number format codes and Excel's built-in format ids.
//!
//! Cell styles store number formats as format-code strings (ADR 0004);
//! `fmt-xlsx` maps the built-in ids to codes at the file boundary with
//! [`builtin_code`] / [`builtin_id`].

/// The default number format.
pub const GENERAL: &str = "General";

/// Built-in number formats: those ECMA-376 Part 1 §18.8.30 defines, plus
/// the en-US codes Excel uses for the locale-dependent currency (5–8) and
/// accounting (41–44) ids. They map both ways (`fmt-xlsx` writes the
/// locale-dependent ones with their code as well, so that a German Excel
/// does not show its own currency).
const BUILTIN: [(u16, &str); 36] = [
    (0, GENERAL),
    (1, "0"),
    (2, "0.00"),
    (3, "#,##0"),
    (4, "#,##0.00"),
    (5, "\"$\"#,##0_);\\(\"$\"#,##0\\)"),
    (6, "\"$\"#,##0_);[Red]\\(\"$\"#,##0\\)"),
    (7, "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)"),
    (8, "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)"),
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
    (41, "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"_);_(@_)"),
    (
        42,
        "_(\"$\"* #,##0_);_(\"$\"* \\(#,##0\\);_(\"$\"* \"-\"_);_(@_)",
    ),
    (43, "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"??_);_(@_)"),
    (
        44,
        "_(\"$\"* #,##0.00_);_(\"$\"* \\(#,##0.00\\);_(\"$\"* \"-\"??_);_(@_)",
    ),
    (45, "mm:ss"),
    (46, "[h]:mm:ss"),
    (47, "mmss.0"),
    (48, "##0.0E+0"),
    (49, "@"),
];

/// Ids that are reserved for East-Asian locales (23–36, 50–81): read as
/// the nearest en-US format; never written.
fn alias(id: u16) -> Option<&'static str> {
    match id {
        23..=26 => Some(GENERAL),
        27..=31 | 34..=36 | 50..=58 => Some("m/d/yyyy"),
        32 | 33 => Some("h:mm:ss"),
        _ => None,
    }
}

/// The format code of built-in format `id` (ids 0–49 and the East-Asian
/// aliases), if any.
pub fn builtin_code(id: u16) -> Option<&'static str> {
    BUILTIN
        .iter()
        .find(|(i, _)| *i == id)
        .map(|(_, c)| *c)
        .or_else(|| alias(id))
}

/// The built-in id of format `code` (exact match; `General` matches
/// case-insensitively).
pub fn builtin_id(code: &str) -> Option<u16> {
    if code.eq_ignore_ascii_case(GENERAL) {
        return Some(0);
    }
    BUILTIN.iter().find(|(_, c)| *c == code).map(|(i, _)| *i)
}

/// Whether built-in id `id` depends on the locale (currency, accounting):
/// `fmt-xlsx` writes its code too.
pub fn is_locale_builtin(id: u16) -> bool {
    matches!(id, 5..=8 | 41..=44)
}

/// Every built-in code in id order (the Custom list of Format Cells).
pub fn builtin_codes() -> impl Iterator<Item = (u16, &'static str)> {
    BUILTIN.iter().copied()
}

/// Whether `code` formats numbers as a date and/or time: some section has
/// a `y`, `m`, `d`, `h` or `s` token (any case) outside double-quoted
/// literals, `[...]` (colours, conditions, locales), backslash escapes and
/// the `_x` / `*x` spacing/fill characters, or an elapsed-time bracket,
/// and it is not `General`.
pub fn is_date_format(code: &str) -> bool {
    engine_formula::numfmt::is_date_code(code)
}

/// Shown when a number cannot be rendered with its format (e.g. a
/// negative date), as Excel does.
pub const UNDISPLAYABLE: &str = "#####";

/// A cell value as the grid shows it (see [`format_cell`]).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CellText {
    /// The text (the fill character, if any, not repeated).
    pub text: String,
    /// The number format colour (`[Red]`) as `0xRRGGBB`.
    pub color: Option<u32>,
    /// `*x`: the fill character and the char index in `text` where the
    /// grid repeats it to fill the cell.
    pub fill: Option<(usize, char)>,
    /// A General number: a narrow cell shows fewer decimals (or
    /// scientific notation) before `####`.
    pub general: bool,
    /// The format cannot show the number (a negative date): `text` is
    /// [`UNDISPLAYABLE`] and the grid fills the cell with `#`.
    pub undisplayable: bool,
}

/// Formats a cell value as the grid shows it: numbers with
/// `number_format` (`None` or `General` → General, at most 11
/// characters), text through the format's text section if it has one,
/// booleans as `TRUE`/`FALSE`, errors as `#…`, empty as `""`.
pub fn format_cell(value: &engine_formula::Value, number_format: Option<&str>) -> CellText {
    use engine_formula::numfmt;
    use engine_formula::Value;
    let plain = |text: String| CellText {
        text,
        ..CellText::default()
    };
    match value {
        Value::Empty => plain(String::new()),
        Value::Number(n) => match numfmt::format_cell(*n, number_format.unwrap_or(GENERAL)) {
            Ok(f) => CellText {
                text: f.text,
                color: f.color,
                fill: f.fill,
                general: f.general,
                undisplayable: false,
            },
            Err(_) => CellText {
                text: UNDISPLAYABLE.into(),
                undisplayable: true,
                ..CellText::default()
            },
        },
        Value::Text(t) => match number_format {
            Some(code) if numfmt::has_text_section(code) => {
                let f = numfmt::format_cell_text(t, code);
                CellText {
                    text: f.text,
                    color: f.color,
                    fill: f.fill,
                    ..CellText::default()
                }
            }
            _ => plain(t.clone()),
        },
        Value::Bool(b) => plain(if *b { "TRUE" } else { "FALSE" }.to_string()),
        Value::Error(e) => plain(e.to_string()),
        Value::Array(_) => format_cell(&value.clone().into_scalar(), number_format),
    }
}

/// [`format_cell`]'s text: what lists, filters and charts show.
pub fn display_value(value: &engine_formula::Value, number_format: Option<&str>) -> String {
    format_cell(value, number_format).text
}

/// Estimated width of `text` in Excel character units (the width of a
/// digit of the default font): digits and most letters 1, narrow
/// punctuation ½, wide letters 1½.
pub fn text_units(text: &str) -> f64 {
    text.chars()
        .map(|c| match c {
            '.' | ',' | ':' | ';' | '\'' | '!' | 'i' | 'l' | 'j' | 'I' | '|' => 0.5,
            ' ' | '-' | '(' | ')' | '/' | 'f' | 'r' | 't' => 0.6,
            'M' | 'W' | 'm' | 'w' | '%' | '@' => 1.5,
            c if c.is_uppercase() => 1.2,
            _ => 1.0,
        })
        .sum()
}

/// Excel's "too narrow" rule for a number in a cell `width` character
/// units wide (font size `font_pt`, default 11): a General number first
/// loses decimals (then switches to scientific notation); any other
/// format shows `####`. Returns the text to show and whether the cell is
/// filled with `#` instead.
pub fn fit_number(cell: &CellText, value: f64, width: f64, font_pt: f64) -> (String, bool) {
    let scale = (font_pt / 11.0).max(0.1);
    let fits = |t: &str| text_units(t) * scale <= width + 0.01;
    if cell.undisplayable {
        return (cell.text.clone(), true);
    }
    if fits(&cell.text) {
        return (cell.text.clone(), false);
    }
    if cell.general {
        let chars = (width / scale).floor().max(0.0) as usize;
        for w in (1..=chars.min(11)).rev() {
            if let Some(t) = engine_formula::numfmt::general_fit(value, w) {
                if fits(&t) {
                    return (t, false);
                }
            }
        }
    }
    (cell.text.clone(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_roundtrip() {
        assert_eq!(BUILTIN.len(), 36);
        for (id, code) in BUILTIN {
            assert_eq!(builtin_code(id), Some(code));
            assert_eq!(builtin_id(code), Some(id));
        }
        for id in 0..=49 {
            assert!(builtin_code(id).is_some(), "{id}");
        }
        assert_eq!(builtin_code(14), Some("mm-dd-yy"));
        assert_eq!(builtin_code(22), Some("m/d/yy h:mm"));
        assert_eq!(builtin_code(49), Some("@"));
        assert_eq!(builtin_code(7), Some("\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)"));
        assert_eq!(builtin_code(27), Some("m/d/yyyy"));
        assert_eq!(builtin_code(82), None);
        assert_eq!(builtin_id("general"), Some(0));
        assert_eq!(builtin_id("0.000"), None);
        // Aliases are read-only.
        assert_eq!(builtin_id("m/d/yyyy"), None);
        assert!(is_locale_builtin(44) && !is_locale_builtin(4));
    }

    #[test]
    fn cell_text_and_fit() {
        use engine_formula::Value;
        let f = format_cell(&Value::Number(-3.0), Some("0.0;[Red]-0.0"));
        assert_eq!((f.text.as_str(), f.color), ("-3.0", Some(0xFF0000)));
        let t = format_cell(&Value::Text("x".into()), Some("0;0;0;\"<\"@\">\""));
        assert_eq!(t.text, "<x>");
        assert_eq!(
            format_cell(&Value::Text("x".into()), Some("0.00")).text,
            "x"
        );
        let neg = format_cell(&Value::Number(-1.0), Some("yyyy"));
        assert!(neg.undisplayable && neg.text == UNDISPLAYABLE);
        let g = format_cell(&Value::Number(1.0 / 3.0), None);
        assert_eq!(g.text, "0.333333333");
        assert_eq!(
            fit_number(&g, 1.0 / 3.0, 8.43, 11.0),
            ("0.333333".into(), false)
        );
        let big = format_cell(&Value::Number(123456789.0), Some("0"));
        assert!(fit_number(&big, 123456789.0, 8.43, 11.0).1);
        assert!(!fit_number(&big, 123456789.0, 12.0, 11.0).1);
        // A bigger font needs more room.
        assert!(fit_number(&big, 123456789.0, 12.0, 22.0).1);
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
        assert!(is_date_format("[ss]"));
    }
}
