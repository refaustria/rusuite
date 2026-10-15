//! XML helpers: the shared DOM and element writer from [`fmt_ooxml::xml`],
//! with parse errors mapped onto this crate's [`Error`].

pub use fmt_ooxml::xml::{parse_bool, parse_i64, parse_u32, El, XmlOut};

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_keep_crate_variants() {
        assert!(matches!(parse(b"", "p"), Err(Error::Malformed { .. })));
        assert!(matches!(parse(b"<a></b>", "p"), Err(Error::Xml { .. })));
        assert_eq!(parse(b"<p:sld/>", "p").unwrap().qname(), "p:sld");
    }
}
