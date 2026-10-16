//! Reference cases: `(value, code) → text`, taken from Excel's documented
//! behaviour ("Review guidelines for customizing a number format",
//! "Number format codes", the `TEXT` function article) and checked against
//! Excel where the documentation is silent (see docs/number-formats.md).

use super::*;

/// 2024-01-15 (serial 45306, a Monday) plus a time of day.
fn at(h: u32, m: u32, s: u32) -> f64 {
    45306.0 + f64::from(h * 3600 + m * 60 + s) / 86_400.0
}

const CASES: &[(f64, &str, &str)] = &[
    // General (cell display: at most 11 characters).
    (0.0, "General", "0"),
    (1234.5, "General", "1234.5"),
    (-1234.5, "General", "-1234.5"),
    (0.1, "General", "0.1"),
    (1.0 / 3.0, "General", "0.333333333"),
    (2.0 / 3.0, "General", "0.666666667"),
    (-1.0 / 3.0, "General", "-0.33333333"),
    (12345678901.0, "General", "12345678901"),
    (123456789012.0, "General", "1.23457E+11"),
    (-12345678901.0, "General", "-1.2346E+10"),
    (1e15, "General", "1E+15"),
    (1e21, "General", "1E+21"),
    (0.0001, "General", "0.0001"),
    (0.00001, "General", "1E-05"),
    (0.000012345, "General", "1.2345E-05"),
    (0.1 + 0.2, "General", "0.3"),
    (123456.7891234, "General", "123456.7891"),
    (1.5e-10, "General", "1.5E-10"),
    (1e100, "General", "1E+100"),
    (99999999999.6, "General", "1E+11"),
    // Digit placeholders.
    (1234.59, "0", "1235"),
    (8.9, "#.000", "8.900"),
    (0.631, "0.#", "0.6"),
    (12.0, "#.0#", "12.0"),
    (1234.568, "#.0#", "1234.57"),
    (44.398, "???.???", " 44.398"),
    (102.65, "???.???", "102.65 "),
    (2.8, "???.???", "  2.8  "),
    (5.0, "000", "005"),
    (0.5, "#.##", ".5"),
    (0.5, "0.00", "0.50"),
    (0.0, "#", ""),
    (0.0, "#.#", "."),
    (0.0, "0.0", "0.0"),
    (-0.4, "0", "-0"),
    (-2.0, "0.00", "-2.00"),
    (2.5, "0", "3"),
    (-2.5, "0", "-3"),
    (0.005, "0.00", "0.01"),
    (999.995, "0.00", "1000.00"),
    (1.005, "0.00", "1.01"),
    (123.0, "0.", "123."),
    // Thousands separator and scaling.
    (12000.0, "#,###", "12,000"),
    (12000.0, "#,", "12"),
    (12200000.0, "0.0,,", "12.2"),
    (1234567.891, "#,##0", "1,234,568"),
    (1234567.891, "#,##0.00", "1,234,567.89"),
    (-1234.5, "#,##0.00", "-1,234.50"),
    (1234.0, "0,", "1"),
    (999.0, "#,##0", "999"),
    (0.0, "#,##0", "0"),
    (0.0, "#,###", ""),
    (1234567.0, "#,##0,", "1,235"),
    (1500000.0, "#,##0.0,,\"M\"", "1.5M"),
    (5.0, "0,000", "0,005"),
    (1e9, "#,##0", "1,000,000,000"),
    // Percent.
    (0.256, "0%", "26%"),
    (0.256, "0.0%", "25.6%"),
    (0.08, "0%", "8%"),
    (2.8, "0.00%", "280.00%"),
    (-0.5, "0%", "-50%"),
    (1.0, "0.0%", "100.0%"),
    // Scientific.
    (12345.0, "0.00E+00", "1.23E+04"),
    (0.000123, "0.00E+00", "1.23E-04"),
    (12345.0, "0.00E-00", "1.23E04"),
    (0.000123, "0.00E-00", "1.23E-04"),
    (12345.0, "##0.0E+0", "12.3E+3"),
    (123456.0, "##0.0E+0", "123.5E+3"),
    (1234.0, "##0.0E+0", "1.2E+3"),
    (0.0012, "##0.0E+0", "1.2E-3"),
    (0.0, "0.00E+00", "0.00E+00"),
    (9.999, "0.00E+00", "1.00E+01"),
    (-12345.0, "0.00E+00", "-1.23E+04"),
    (1e100, "0.00E+00", "1.00E+100"),
    (12345.0, "00.00E+00", "12.35E+03"),
    (12345.0, "0E+0", "1E+4"),
    (1.5, "0.0E+00", "1.5E+00"),
    // Fractions.
    (5.25, "# ?/?", "5 1/4"),
    (5.3, "# ??/??", "5  3/10"),
    (2.75, "# ?/?", "2 3/4"),
    (0.5, "# ?/?", " 1/2"),
    (1.0 / 3.0, "?/?", "1/3"),
    (std::f64::consts::PI, "# ??/??", "3 14/99"),
    (std::f64::consts::PI, "# ???/???", "3  16/113"),
    (0.75, "?/8", "6/8"),
    (1.25, "# ?/8", "1 2/8"),
    (0.3, "# ??/100", " 30/100"),
    (1.5, "?/?", "3/2"),
    (5.0, "# ?/?", "5    "),
    (0.1, "# ?/?", " 1/9"),
    (0.125, "# ?/??", " 1/8 "),
    (-2.5, "# ?/?", "-2 1/2"),
    (0.6667, "# ??/??", "  2/3 "),
    (3.999, "# ?/?", "4    "),
    // Sections.
    (5.0, "0;(0)", "5"),
    (-5.0, "0;(0)", "(5)"),
    (0.0, "0;(0);\"zero\"", "zero"),
    (0.0, "0;(0)", "0"),
    (-5.0, "0.00;-0.00", "-5.00"),
    (-5.0, "#,##0;[Red]-#,##0", "-5"),
    (5.0, "0;-0;;@", "5"),
    (0.0, "0;-0;;@", ""),
    (5.0, ";;;", ""),
    (-1234.0, "#,##0 ;(#,##0)", "(1,234)"),
    (1234.0, "#,##0 ;(#,##0)", "1,234 "),
    (-1234.0, "#,##0.00_);(#,##0.00)", "(1,234.00)"),
    (1234.0, "#,##0.00_);(#,##0.00)", "1,234.00 "),
    // Conditions.
    (150.0, "[>=100]\"big\";\"small\"", "big"),
    (50.0, "[>=100]\"big\";\"small\"", "small"),
    (-5.0, "[<0]-0.0;0.0", "-5.0"),
    (5.0, "[<0]-0.0;0.0", "5.0"),
    (-5.0, "[Red][<0]-0.0;0.0", "-5.0"),
    (50.0, "[<=100]0;[>100]0.00", "50"),
    (500.0, "[<=100]0;[>100]0.00", "500.00"),
    (-5.0, "[<=100]0;[>100]0.00", "-5"),
    (1.0, "[=1]\"one\";[=2]\"two\";\"many\"", "one"),
    (2.0, "[=1]\"one\";[=2]\"two\";\"many\"", "two"),
    (3.0, "[=1]\"one\";[=2]\"two\";\"many\"", "many"),
    (0.0, "[<>0]0;\"none\"", "none"),
    // Colours do not change the text.
    (1.5, "[Red]0.0", "1.5"),
    (-1.5, "0.0;[Red]0.0", "1.5"),
    (3.0, "[Color10]0", "3"),
    (3.0, "[Blue]0;[Red]-0", "3"),
    // Literals.
    (12.0, "\"EUR \"0.00", "EUR 12.00"),
    (1.0, "0 \"kg\"", "1 kg"),
    (5.0, "$0.00", "$5.00"),
    (5.0, "0.00 \\€", "5.00 €"),
    (123456789.0, "000-00-0000", "123-45-6789"),
    (5551234567.0, "(###) ###-####", "(555) 123-4567"),
    (1234567.0, "(###) ###-####", "() 123-4567"),
    (12.0, "\"Total: \"0", "Total: 12"),
    (5.0, "0 \"pcs\";-0 \"pcs\"", "5 pcs"),
    (-5.0, "+0;-0", "-5"),
    (5.0, "+0;-0", "+5"),
    (7.0, "[$€-407] #,##0.00", "€ 7.00"),
    (7.0, "#,##0.00 [$€-407]", "7.00 €"),
    (7.0, "[$USD] 0", "USD 7"),
    (1234.5, "_(* #,##0.00_)", " 1,234.50 "),
    (5.0, "0_)", "5 "),
    (5.0, "General\" units\"", "5 units"),
    (-5.0, "General;-General", "-5"),
    // Dates.
    (45306.0, "yyyy-mm-dd", "2024-01-15"),
    (45306.0, "dd.mm.yyyy", "15.01.2024"),
    (45306.0, "mm/dd/yyyy", "01/15/2024"),
    (45306.0, "m/d/yy", "1/15/24"),
    (45306.0, "d-mmm-yy", "15-Jan-24"),
    (45306.0, "d-mmm", "15-Jan"),
    (45306.0, "mmm-yy", "Jan-24"),
    (45306.0, "mmmm d, yyyy", "January 15, 2024"),
    (45306.0, "mmmmm", "J"),
    (45306.0, "dddd", "Monday"),
    (45306.0, "ddd", "Mon"),
    (45306.0, "d mmm yyyy, dddd", "15 Jan 2024, Monday"),
    (45306.0, "yy", "24"),
    (
        45306.0,
        "[$-407]dddd, d. mmmm yyyy",
        "Montag, 15. Januar 2024",
    ),
    (45306.0, "[$-407]ddd mmm", "Mo Jan"),
    (45306.0, "[$-C07]d. mmmm yyyy", "15. Jänner 2024"),
    (45366.0, "[$-407]mmmm", "März"),
    (45657.0, "dd.mm.yy", "31.12.24"),
    (60.0, "yyyy-mm-dd", "1900-02-29"),
    (61.0, "yyyy-mm-dd", "1900-03-01"),
    (1.0, "yyyy-mm-dd", "1900-01-01"),
    (0.0, "yyyy-mm-dd", "1900-01-00"),
    (1.0, "dddd", "Sunday"),
    (2958465.0, "yyyy-mm-dd", "9999-12-31"),
    // Times.
    (0.5, "hh:mm", "12:00"),
    (0.5, "h:mm AM/PM", "12:00 PM"),
    (0.75, "h:mm:ss", "18:00:00"),
    (45306.75, "yyyy-mm-dd hh:mm:ss", "2024-01-15 18:00:00"),
    (45306.75, "m/d/yy h:mm", "1/15/24 18:00"),
    (0.25, "h AM/PM", "6 AM"),
    (0.75, "h:mm am/pm", "6:00 pm"),
    (0.75, "h:mm A/P", "6:00 P"),
    (0.5 / 24.0, "mm:ss", "30:00"),
    (1.0 / 86_400.0 * 61.5, "mm:ss.0", "01:01.5"),
    (1.0 / 86_400.0 * 1.234, "ss.000", "01.234"),
    (1.0 / 86_400.0 * 59.96, "ss.0", "00.0"),
    (1.0 / 86_400.0 * 59.96, "mm:ss.0", "01:00.0"),
    (
        1.0 + 2.0 / 24.0 + 3.0 / 1440.0 + 4.0 / 86_400.0,
        "[h]:mm:ss",
        "26:03:04",
    ),
    (
        1.0 + 2.0 / 24.0 + 3.0 / 1440.0 + 4.0 / 86_400.0,
        "[mm]:ss",
        "1563:04",
    ),
    (
        1.0 + 2.0 / 24.0 + 3.0 / 1440.0 + 4.0 / 86_400.0,
        "[ss]",
        "93784",
    ),
    (100.0, "[h]", "2400"),
    (0.5 / 24.0, "[h]:mm:ss", "0:30:00"),
    (1.0 / 86_400.0 * 1.5, "[ss].00", "01.50"),
    (45306.999999, "yyyy-mm-dd hh:mm:ss", "2024-01-16 00:00:00"),
    (0.0, "h:mm", "0:00"),
    // Text sections.
    (5.0, "0;-0;0;\"text: \"@", "5"),
    (5.0, "@", "5"),
    (0.123, "@", "0.123"),
];

#[test]
fn reference_cases() {
    assert!(CASES.len() >= 150, "{} cases", CASES.len());
    let mut failures = Vec::new();
    for &(v, code, want) in CASES {
        match format_cell(v, code) {
            Ok(f) if f.text == want => {}
            got => failures.push(format!("{v} {code:?}: want {want:?}, got {got:?}")),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn text_sections() {
    let t = |s: &str, code: &str| format_cell_text(s, code).text;
    assert_eq!(t("apple", "@"), "apple");
    assert_eq!(t("apple", "0;-0;0;\"text: \"@"), "text: apple");
    assert_eq!(t("apple", "0.00"), "apple");
    assert_eq!(t("apple", "0;@\" (x)\""), "apple (x)");
    assert_eq!(t("a", "[$-409]@"), "a");
    assert_eq!(t("a", "[Blue]@"), "a");
    assert_eq!(format_cell_text("a", "0;0;0;[Blue]@").color, Some(0x0000FF));
    assert!(has_text_section("0;@"));
    assert!(!has_text_section("0.00"));
}

#[test]
fn colours_and_fill() {
    let f = format_cell(-1.0, "0;[Red]0").unwrap();
    assert_eq!((f.text.as_str(), f.color), ("1", Some(0xFF0000)));
    assert_eq!(format_cell(1.0, "0;[Red]0").unwrap().color, None);
    assert_eq!(
        format_cell(1.0, "[Color 10]0").unwrap().color,
        Some(0x008000)
    );
    assert_eq!(
        format_cell(1.0, "[Color56]0").unwrap().color,
        Some(0x333333)
    );
    assert_eq!(format_cell(1.0, "[GREEN]0").unwrap().color, Some(0x00FF00));
    assert_eq!(color_for(-3.0, "[Red][<0]-0.0;0.0"), Some(0xFF0000));
    assert_eq!(color_for(3.0, "[Red][<0]-0.0;0.0"), None);
    let acc = format_cell(1234.5, "_(\"$\"* #,##0.00_)").unwrap();
    assert_eq!(acc.text, " $1,234.50 ");
    assert_eq!(acc.fill, Some((2, ' ')));
    let dots = format_cell(5.0, "0*.").unwrap();
    assert_eq!((dots.text.as_str(), dots.fill), ("5", Some((1, '.'))));
    assert!(format_cell(1.0, "General").unwrap().general);
    assert!(!format_cell(1.0, "0").unwrap().general);
    // TEXT drops the fill character.
    assert_eq!(format_number(5.0, "0*-").unwrap(), "5");
}

#[test]
fn undisplayable_dates() {
    assert!(format_cell(-1.0, "yyyy-mm-dd").is_err());
    assert!(format_cell(3e6, "yyyy-mm-dd").is_err());
    assert!(format_cell(-1.0, "[h]:mm").is_err());
    // A negative number in a numeric section of a date code is fine.
    assert_eq!(format_cell(-1.0, "yyyy-mm-dd;\"neg\"").unwrap().text, "neg");
}

#[test]
fn date_detection() {
    assert!(is_date_code("yyyy-mm-dd"));
    assert!(is_date_code("[h]:mm:ss"));
    assert!(is_date_code("[$-407]dddd"));
    assert!(!is_date_code("0.00E+00"));
    assert!(!is_date_code("\"m\"0"));
    assert!(!is_date_code("General"));
    assert!(!is_date_code("[Red]0"));
}

#[test]
fn general_fits_narrow_cells() {
    assert_eq!(general_fit(1.0 / 3.0, 8).as_deref(), Some("0.333333"));
    assert_eq!(general_fit(123456789.0, 8).as_deref(), Some("1.23E+08"));
    assert_eq!(general_fit(1234.5, 4).as_deref(), Some("1235"));
    assert_eq!(general_fit(123456789.0, 3), None);
    assert_eq!(general_fit(5.0, 1).as_deref(), Some("5"));
}

#[test]
fn twelve_hour_clock() {
    let f = |v: f64, c: &str| format_cell(v, c).unwrap().text;
    assert_eq!(f(at(0, 5, 0), "h:mm AM/PM"), "12:05 AM");
    assert_eq!(f(at(9, 5, 0), "h:mm AM/PM"), "9:05 AM");
    assert_eq!(f(at(12, 0, 0), "h:mm AM/PM"), "12:00 PM");
    assert_eq!(f(at(15, 7, 9), "hh:mm:ss am/pm"), "03:07:09 pm");
    assert_eq!(f(at(23, 59, 59), "h:mm A/P"), "11:59 P");
    assert_eq!(f(at(1, 0, 0), "h a/p"), "1 a");
    assert_eq!(f(at(15, 7, 0), "h:mm"), "15:07");
    assert_eq!(f(at(15, 7, 0), "h \\a mm"), "15 a 07");
}
