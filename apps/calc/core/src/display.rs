//! Cell value → display text.

use engine_formula::Value;

pub use model_sheet::numfmt::UNDISPLAYABLE;

/// Formats a cell value for the grid: numbers with `number_format`
/// (`None` or `General` → Excel's General format), booleans as
/// `TRUE`/`FALSE`, errors as `#…`, text as is, empty as `""`
/// (see [`model_sheet::numfmt::display_value`]).
///
/// ```
/// use calc_core::display_value;
/// use engine_formula::Value;
///
/// assert_eq!(display_value(&Value::Number(1234.5), Some("#,##0.00")), "1,234.50");
/// assert_eq!(display_value(&Value::Number(45306.0), Some("yyyy-mm-dd")), "2024-01-15");
/// assert_eq!(display_value(&Value::Number(0.1 + 0.2), None), "0.3");
/// ```
pub fn display_value(value: &Value, number_format: Option<&str>) -> String {
    model_sheet::numfmt::display_value(value, number_format)
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::ErrorKind;

    #[test]
    fn formats() {
        let n = |x: f64, f: &str| display_value(&Value::Number(x), Some(f));
        assert_eq!(n(1.23456, "0.00"), "1.23");
        assert_eq!(n(-2.5, "0.00"), "-2.50");
        assert_eq!(n(1234567.0, "#,##0"), "1,234,567");
        assert_eq!(n(45306.0, "yyyy-mm-dd"), "2024-01-15");
        assert_eq!(n(-1.0, "yyyy-mm-dd"), UNDISPLAYABLE);
        assert_eq!(n(1234.5, "General"), "1234.5");
        assert_eq!(display_value(&Value::Number(1e21), None), "1E+21");
        assert_eq!(display_value(&Value::Bool(true), Some("0.00")), "TRUE");
        assert_eq!(
            display_value(&Value::Error(ErrorKind::Div0), None),
            "#DIV/0!"
        );
        assert_eq!(display_value(&Value::Text("x".into()), Some("0.00")), "x");
        assert_eq!(display_value(&Value::Empty, Some("0.00")), "");
    }
}
