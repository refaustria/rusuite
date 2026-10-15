//! Minimal XML helpers shared by OOXML format crates.
//!
//! Intentionally tiny: format crates own their own XML handling.

use std::borrow::Cow;

use quick_xml::events::BytesStart;
use quick_xml::XmlVersion;

pub use quick_xml::escape::escape as escape_attr;
pub use quick_xml::escape::partial_escape as escape_text;

/// The standard OOXML XML declaration, including the trailing CRLF Office writes.
pub const DECLARATION: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";

/// Returns [`DECLARATION`].
pub fn declaration() -> &'static str {
    DECLARATION
}

/// Strips a namespace prefix: `w:body` → `body`.
pub fn local_name(qname: &[u8]) -> &[u8] {
    match qname.iter().rposition(|&b| b == b':') {
        Some(i) => &qname[i + 1..],
        None => qname,
    }
}

/// Returns the unescaped value of the first attribute whose *local* name is `name`.
///
/// Malformed attributes are skipped.
pub fn attr_local<'a>(el: &'a BytesStart<'_>, name: &str) -> Option<Cow<'a, str>> {
    el.attributes()
        .with_checks(false)
        .flatten()
        .find(|a| local_name(a.key.as_ref().as_bytes()) == name.as_bytes())
        .and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use quick_xml::events::Event;
    use quick_xml::Reader;

    #[test]
    fn local_names() {
        assert_eq!(local_name(b"w:body"), b"body");
        assert_eq!(local_name(b"body"), b"body");
    }

    #[test]
    fn attr_lookup_by_local_name() {
        let mut r = Reader::from_str(r#"<a r:id="rId1" Target="a&amp;b"/>"#);
        let Event::Empty(el) = r.read_event().unwrap() else {
            panic!("expected empty element");
        };
        assert_eq!(attr_local(&el, "id").as_deref(), Some("rId1"));
        assert_eq!(attr_local(&el, "Target").as_deref(), Some("a&b"));
        assert_eq!(attr_local(&el, "missing"), None);
    }

    #[test]
    fn escaping_and_declaration() {
        assert_eq!(escape_attr("a\"<&"), "a&quot;&lt;&amp;");
        assert_eq!(escape_text("a\"<&"), "a\"&lt;&amp;");
        assert!(declaration().starts_with("<?xml version=\"1.0\""));
        assert!(declaration().ends_with("?>\r\n"));
    }
}
