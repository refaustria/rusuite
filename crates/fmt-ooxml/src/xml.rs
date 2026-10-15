//! XML helpers shared by the OOXML format crates: escaping, attribute
//! lookup by local name, scalar parsers, a tiny owned DOM for reading parts
//! ([`parse`] → [`El`]) and a small element writer ([`XmlOut`]).
//!
//! The parts the format crates read through the DOM are small (a few
//! hundred KB at most), so building a tree first keeps the mapping code
//! simple. Elements and attributes are matched by *local* name (`w:p` → `p`,
//! `r:embed` → `embed`), which also tolerates unusual namespace prefixes.
//! Large parts (worksheets) are better streamed with `quick_xml::Reader`
//! and [`attr_local`].

use std::borrow::Cow;

use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer, XmlVersion};

use crate::{Error, Result};

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

// --- scalars -------------------------------------------------------------------

/// An xsd:boolean / ST_OnOff value (`1`/`true`/`on`, `0`/`false`/`off`).
pub fn parse_bool(v: &str) -> Option<bool> {
    match v.trim() {
        "1" | "true" | "on" => Some(true),
        "0" | "false" | "off" => Some(false),
        _ => None,
    }
}

/// Parses a signed integer attribute (also accepting `12.0`).
pub fn parse_i64(v: &str) -> Option<i64> {
    let v = v.trim();
    v.parse::<i64>().ok().or_else(|| {
        let f: f64 = v.parse().ok()?;
        (f.is_finite() && f.abs() <= 9.0e15).then_some(f.round() as i64)
    })
}

/// Parses an unsigned integer attribute (also accepting `12.0`).
pub fn parse_u32(v: &str) -> Option<u32> {
    let v = v.trim();
    v.parse::<u32>().ok().or_else(|| {
        let f: f64 = v.parse().ok()?;
        (f.is_finite() && f >= 0.0 && f <= f64::from(u32::MAX)).then_some(f.round() as u32)
    })
}

/// Whether a character may appear in XML 1.0 content.
pub fn is_xml_char(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..)
}

/// Removes characters XML 1.0 cannot carry.
pub fn xml_safe(s: &str) -> Cow<'_, str> {
    if s.chars().all(is_xml_char) {
        Cow::Borrowed(s)
    } else {
        Cow::Owned(s.chars().filter(|&c| is_xml_char(c)).collect())
    }
}

// --- DOM -----------------------------------------------------------------------

/// A node of the tree: element or character data.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// A child element.
    El(El),
    /// Character data (text, CDATA and resolved references, merged).
    Text(String),
}

/// An element with local name, attributes (local name → unescaped value)
/// and children.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct El {
    /// Local name (`p` for `w:p`).
    pub name: String,
    /// Namespace prefix as written (`w` for `w:p`), empty if none.
    pub prefix: String,
    /// Attributes by local name, in document order.
    pub attrs: Vec<(String, String)>,
    /// Child nodes.
    pub children: Vec<Node>,
}

impl El {
    /// Attribute value by local name.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// The `val` attribute (`w:val`, `a:srgbClr/@val`).
    pub fn val(&self) -> Option<&str> {
        self.attr("val")
    }

    /// Child elements.
    pub fn elements(&self) -> impl Iterator<Item = &El> {
        self.children.iter().filter_map(|n| match n {
            Node::El(e) => Some(e),
            Node::Text(_) => None,
        })
    }

    /// First child element with local name `name`.
    pub fn child(&self, name: &str) -> Option<&El> {
        self.elements().find(|e| e.name == name)
    }

    /// First descendant element (depth-first, excluding `self`) named `name`.
    pub fn find(&self, name: &str) -> Option<&El> {
        for e in self.elements() {
            if e.name == name {
                return Some(e);
            }
            if let Some(found) = e.find(name) {
                return Some(found);
            }
        }
        None
    }

    /// Concatenated character data of the direct text children.
    pub fn text(&self) -> String {
        let mut out = String::new();
        for n in &self.children {
            if let Node::Text(t) = n {
                out.push_str(t);
            }
        }
        out
    }

    /// Qualified name for messages (`w:p`).
    pub fn qname(&self) -> String {
        if self.prefix.is_empty() {
            self.name.clone()
        } else {
            format!("{}:{}", self.prefix, self.name)
        }
    }
}

fn split_qname(q: &[u8]) -> (String, String) {
    let local = local_name(q);
    let prefix = if local.len() < q.len() {
        &q[..q.len() - local.len() - 1]
    } else {
        &[][..]
    };
    (
        String::from_utf8_lossy(local).into_owned(),
        String::from_utf8_lossy(prefix).into_owned(),
    )
}

fn element_of(start: &BytesStart<'_>) -> El {
    let (name, prefix) = split_qname(start.name().as_ref().as_bytes());
    let attrs = start
        .attributes()
        .with_checks(false)
        .flatten()
        .filter_map(|a| {
            let key = String::from_utf8_lossy(local_name(a.key.as_ref().as_bytes())).into_owned();
            let value = a.normalized_value(XmlVersion::Implicit1_0).ok()?;
            Some((key, value.into_owned()))
        })
        .collect();
    El {
        name,
        prefix,
        attrs,
        children: Vec::new(),
    }
}

fn push_text(stack: &mut [El], s: &str) {
    if let Some(top) = stack.last_mut() {
        if let Some(Node::Text(t)) = top.children.last_mut() {
            t.push_str(s);
        } else {
            top.children.push(Node::Text(s.to_owned()));
        }
    }
}

/// Parses `xml` into its root element.
///
/// Fails with [`Error::Xml`] on malformed XML and [`Error::Malformed`] if
/// there is no root element; `part` names the part in both.
pub fn parse(xml: &[u8], part: &str) -> Result<El> {
    let err = |source| Error::Xml {
        part: part.to_owned(),
        source,
    };
    let mut reader = Reader::from_reader(xml);
    let mut stack: Vec<El> = Vec::new();
    let mut root: Option<El> = None;
    loop {
        match reader.read_event().map_err(err)? {
            Event::Start(s) => stack.push(element_of(&s)),
            Event::Empty(s) => {
                let el = element_of(&s);
                match stack.last_mut() {
                    Some(top) => top.children.push(Node::El(el)),
                    None => root = root.or(Some(el)),
                }
            }
            Event::End(_) => {
                let Some(el) = stack.pop() else {
                    continue;
                };
                match stack.last_mut() {
                    Some(top) => top.children.push(Node::El(el)),
                    None => root = root.or(Some(el)),
                }
            }
            Event::Text(t) => push_text(&mut stack, &t.xml10_content()),
            Event::CData(t) => push_text(&mut stack, &t.xml10_content()),
            Event::GeneralRef(r) => {
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    push_text(&mut stack, c.encode_utf8(&mut [0; 4]));
                } else if let Some(s) = quick_xml::escape::resolve_predefined_entity(&r) {
                    push_text(&mut stack, s);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    root.ok_or_else(|| Error::Malformed {
        part: part.to_owned(),
        reason: "no root element".into(),
    })
}

// --- writer --------------------------------------------------------------------

/// A tiny element writer. Writing into a `Vec` cannot fail, so the I/O
/// results are unwrapped. Characters XML 1.0 cannot carry are dropped from
/// attribute values and text (callers that must preserve them encode them
/// first, e.g. SpreadsheetML's `_xHHHH_`).
pub struct XmlOut {
    w: Writer<Vec<u8>>,
}

impl Default for XmlOut {
    fn default() -> Self {
        Self::new()
    }
}

impl XmlOut {
    /// A new document starting with the standalone XML declaration.
    pub fn new() -> Self {
        XmlOut {
            w: Writer::new(DECLARATION.as_bytes().to_vec()),
        }
    }

    /// A writer for an XML fragment (no declaration).
    pub fn fragment() -> Self {
        XmlOut {
            w: Writer::new(Vec::new()),
        }
    }

    /// Appends already-serialized XML verbatim.
    pub fn raw(&mut self, xml: &[u8]) {
        self.w.get_mut().extend_from_slice(xml);
    }

    fn el<'a>(name: &'a str, attrs: &[(&str, &str)]) -> BytesStart<'a> {
        let mut el = BytesStart::new(name);
        for &(k, v) in attrs {
            el.push_attribute((k, xml_safe(v).as_ref()));
        }
        el
    }

    fn put(&mut self, ev: Event<'_>) {
        self.w
            .write_event(ev)
            .expect("writing XML into a Vec cannot fail");
    }

    /// `<name attrs>`.
    pub fn start(&mut self, name: &str, attrs: &[(&str, &str)]) {
        self.put(Event::Start(Self::el(name, attrs)));
    }

    /// `<name attrs/>`.
    pub fn empty(&mut self, name: &str, attrs: &[(&str, &str)]) {
        self.put(Event::Empty(Self::el(name, attrs)));
    }

    /// `</name>`.
    pub fn end(&mut self, name: &str) {
        self.put(Event::End(BytesEnd::new(name)));
    }

    /// Character data; only `<`, `>` and `&` are escaped, characters XML
    /// cannot carry are dropped.
    pub fn text(&mut self, text: &str) {
        let safe = xml_safe(text);
        self.put(Event::Text(BytesText::from_escaped(escape_text(
            safe.as_ref(),
        ))));
    }

    /// `<name attrs>text</name>`.
    pub fn text_el(&mut self, name: &str, attrs: &[(&str, &str)], text: &str) {
        self.start(name, attrs);
        self.text(text);
        self.end(name);
    }

    /// The serialized bytes.
    pub fn finish(self) -> Vec<u8> {
        self.w.into_inner()
    }
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

    #[test]
    fn scalars() {
        assert_eq!(parse_i64("-5"), Some(-5));
        assert_eq!(parse_i64(" 12.0 "), Some(12));
        assert_eq!(parse_i64("x"), None);
        assert_eq!(parse_u32("22"), Some(22));
        assert_eq!(parse_u32("22.0"), Some(22));
        assert_eq!(parse_u32("-1"), None);
        assert_eq!(parse_bool("1"), Some(true));
        assert_eq!(parse_bool(" off "), Some(false));
        assert_eq!(parse_bool("yes"), None);
        assert_eq!(xml_safe("a\u{1}b\u{FFFE}"), "ab");
        assert!(matches!(xml_safe("plain"), Cow::Borrowed(_)));
    }

    #[test]
    fn dom_parse() {
        let xml = br#"<?xml version="1.0"?><w:p xmlns:w="x"><w:r><w:t xml:space="preserve"> a &amp; b&#x41;</w:t><w:tab/><w:b w:val="0"/></w:r></w:p>"#;
        let root = parse(xml, "t").unwrap();
        assert_eq!(root.name, "p");
        assert_eq!(root.qname(), "w:p");
        let r = root.child("r").unwrap();
        let t = r.child("t").unwrap();
        assert_eq!(t.text(), " a & bA");
        assert_eq!(t.attr("space"), Some("preserve"));
        assert!(r.child("tab").is_some());
        assert_eq!(r.child("b").and_then(El::val), Some("0"));
        assert!(root.find("tab").is_some());
        assert!(matches!(parse(b"", "t"), Err(Error::Malformed { .. })));
        assert!(matches!(parse(b"<a></b>", "t"), Err(Error::Xml { .. })));
    }

    #[test]
    fn writer_escapes_and_strips() {
        let mut x = XmlOut::new();
        x.text_el("a", &[("k", "<\"&>\u{1}")], "1 < 2 & \u{1}3 \"q\" 'a'");
        let s = String::from_utf8(x.finish()).unwrap();
        assert!(s.starts_with(DECLARATION));
        assert!(
            s.contains(r#"<a k="&lt;&quot;&amp;&gt;">1 &lt; 2 &amp; 3 "q" 'a'</a>"#),
            "{s}"
        );
        let mut f = XmlOut::fragment();
        f.empty("b", &[]);
        f.raw(b"<c/>");
        assert_eq!(f.finish(), b"<b/><c/>");
    }
}
