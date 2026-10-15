//! XML helpers: a tiny owned DOM for reading PresentationML parts and a
//! small element writer.
//!
//! Copied from `fmt-docx` (format crates never depend on each other,
//! ADR 0003); a shared home in `fmt-ooxml` is a ROADMAP item.
//!
//! The parts we read are small (a few hundred KB at most), so building a
//! tree first keeps the mapping code simple. Elements and attributes are
//! matched by *local* name (`p:sp` → `sp`, `r:embed` → `embed`), which also
//! tolerates unusual namespace prefixes.

use fmt_ooxml::xml::{local_name, DECLARATION};
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer, XmlVersion};

use crate::Error;

/// A node of the tree: element or character data.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    El(El),
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
pub fn parse(xml: &[u8], part: &str) -> Result<El, Error> {
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

/// An xsd:boolean / ST_OnOff value.
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
pub fn xml_safe(s: &str) -> std::borrow::Cow<'_, str> {
    if s.chars().all(is_xml_char) {
        std::borrow::Cow::Borrowed(s)
    } else {
        std::borrow::Cow::Owned(s.chars().filter(|&c| is_xml_char(c)).collect())
    }
}

/// A tiny element writer. Writing into a `Vec` cannot fail, so the I/O
/// results are unwrapped.
pub struct XmlOut {
    w: Writer<Vec<u8>>,
}

impl XmlOut {
    /// A new document starting with the standalone XML declaration.
    pub fn new() -> Self {
        XmlOut {
            w: Writer::new(DECLARATION.as_bytes().to_vec()),
        }
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
        self.put(Event::Text(BytesText::from_escaped(
            fmt_ooxml::xml::escape_text(safe.as_ref()),
        )));
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

    #[test]
    fn dom_parse() {
        let xml = br#"<?xml version="1.0"?><w:p xmlns:w="x"><w:r><w:t xml:space="preserve"> a &amp; b&#x41;</w:t><w:tab/></w:r></w:p>"#;
        let root = parse(xml, "t").unwrap();
        assert_eq!(root.name, "p");
        assert_eq!(root.qname(), "w:p");
        let r = root.child("r").unwrap();
        let t = r.child("t").unwrap();
        assert_eq!(t.text(), " a & bA");
        assert_eq!(t.attr("space"), Some("preserve"));
        assert!(r.child("tab").is_some());
        assert!(root.find("tab").is_some());
        assert!(parse(b"", "t").is_err());
    }

    #[test]
    fn numbers() {
        assert_eq!(parse_i64("-5"), Some(-5));
        assert_eq!(parse_i64(" 12.0 "), Some(12));
        assert_eq!(parse_i64("x"), None);
        assert_eq!(parse_u32("22"), Some(22));
        assert_eq!(parse_u32("22.0"), Some(22));
        assert_eq!(parse_u32("-1"), None);
        assert_eq!(parse_bool("1"), Some(true));
        assert_eq!(parse_bool("false"), Some(false));
    }

    #[test]
    fn writer_escapes_and_strips() {
        let mut x = XmlOut::new();
        x.text_el("a", &[("k", "<\"&>")], "1 < 2 & \u{1}3");
        let s = String::from_utf8(x.finish()).unwrap();
        assert!(
            s.contains(r#"<a k="&lt;&quot;&amp;&gt;">1 &lt; 2 &amp; 3</a>"#),
            "{s}"
        );
    }
}
