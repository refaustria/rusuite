//! XML helpers: the shared DOM and element writer from
//! [`fmt_ooxml::xml`] plus WordprocessingML specifics (`w:val` toggles and
//! twip measures).

pub use fmt_ooxml::xml::{parse_bool, parse_u32, El, Node, XmlOut};

use crate::Error;

/// Parses `xml` into its root element ([`fmt_ooxml::xml::parse`] with this
/// crate's error variants).
pub fn parse(xml: &[u8], part: &str) -> Result<El, Error> {
    fmt_ooxml::xml::parse(xml, part).map_err(xml_error)
}

/// Maps the XML-level errors of `fmt-ooxml` helpers onto [`Error::Xml`] and
/// [`Error::Malformed`]; anything else stays a package error.
pub fn xml_error(e: fmt_ooxml::Error) -> Error {
    match e {
        fmt_ooxml::Error::Xml { part, source } => Error::Xml { part, source },
        fmt_ooxml::Error::Malformed { part, reason } => Error::Malformed { part, reason },
        other => Error::Package(other),
    }
}

/// `<name w:val="val"/>` for [`XmlOut`].
pub trait WriteVal {
    /// Writes `<name w:val="val"/>`.
    fn val(&mut self, name: &str, val: &str);
}

impl WriteVal for XmlOut {
    fn val(&mut self, name: &str, val: &str) {
        self.empty(name, &[("w:val", val)]);
    }
}

/// A toggle element such as `<w:b/>` (true) or `<w:b w:val="0"/>`.
pub fn toggle(el: &El) -> bool {
    el.val().and_then(parse_bool).unwrap_or(true)
}

/// Parses a signed measure in twips: a plain number, or a universal
/// measure (`2.54cm`, `1in`, `72pt`, `6pc`, `25.4mm`, `1pi`).
pub fn parse_twips(v: &str) -> Option<i32> {
    let v = v.trim();
    let (num, factor) = [
        ("mm", 1440.0 / 25.4),
        ("cm", 1440.0 / 2.54),
        ("in", 1440.0),
        ("pt", 20.0),
        ("pc", 240.0),
        ("pi", 240.0),
    ]
    .iter()
    .find_map(|(unit, f)| v.strip_suffix(unit).map(|n| (n, *f)))
    .unwrap_or((v, 1.0));
    let n: f64 = num.trim().parse().ok()?;
    let t = (n * factor).round();
    (t.is_finite() && t.abs() <= f64::from(i32::MAX)).then_some(t as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures() {
        assert_eq!(parse_twips("1440"), Some(1440));
        assert_eq!(parse_twips("-5"), Some(-5));
        assert_eq!(parse_twips("1in"), Some(1440));
        assert_eq!(parse_twips("2.54cm"), Some(1440));
        assert_eq!(parse_twips("12pt"), Some(240));
        assert_eq!(parse_twips("x"), None);
        assert!(toggle(&El::default()));
    }

    #[test]
    fn errors_keep_crate_variants() {
        assert!(matches!(parse(b"", "p"), Err(Error::Malformed { .. })));
        assert!(matches!(parse(b"<a></b>", "p"), Err(Error::Xml { .. })));
    }

    #[test]
    fn val_writer() {
        let mut x = XmlOut::fragment();
        x.val("w:b", "0");
        assert_eq!(x.finish(), br#"<w:b w:val="0"/>"#);
    }
}
