//! XML helpers: attribute access, text decoding (including Excel's
//! `_xHHHH_` escapes) and a small writer over `quick_xml::Writer`.

use std::borrow::Cow;

use fmt_ooxml::xml::{attr_local, DECLARATION};
use quick_xml::events::{BytesEnd, BytesRef, BytesStart, BytesText, Event};
use quick_xml::Writer;

use crate::Error;

/// Local name of an element.
pub fn name_of<'a>(el: &'a BytesStart<'_>) -> &'a [u8] {
    el.local_name().into_inner().as_bytes()
}

/// Local name of a closing tag.
pub fn end_name<'a>(el: &'a BytesEnd<'_>) -> &'a [u8] {
    el.local_name().into_inner().as_bytes()
}

/// Unescaped attribute value by local name.
pub fn attr<'a>(el: &'a BytesStart<'_>, name: &str) -> Option<Cow<'a, str>> {
    attr_local(el, name)
}

/// An xsd:boolean attribute (`1`/`true`/`0`/`false`).
pub fn attr_bool(el: &BytesStart<'_>, name: &str) -> Option<bool> {
    attr(el, name).and_then(|v| parse_bool(&v))
}

/// An attribute parsed with `FromStr`.
pub fn attr_parse<T: std::str::FromStr>(el: &BytesStart<'_>, name: &str) -> Option<T> {
    attr(el, name).and_then(|v| v.trim().parse().ok())
}

pub fn parse_bool(v: &str) -> Option<bool> {
    match v.trim() {
        "1" | "true" | "on" => Some(true),
        "0" | "false" | "off" => Some(false),
        _ => None,
    }
}

/// A boolean toggle element such as `<b/>` or `<b val="0"/>`.
pub fn toggle(el: &BytesStart<'_>) -> bool {
    attr_bool(el, "val").unwrap_or(true)
}

/// Builds an [`Error::Xml`] for `part`.
pub fn xml_err(part: &str) -> impl Fn(quick_xml::Error) -> Error + '_ {
    move |source| Error::Xml {
        part: part.to_owned(),
        source,
    }
}

/// Appends the decoded content of a text event to `buf`.
pub fn push_text(buf: &mut String, t: &BytesText<'_>) {
    buf.push_str(&t.xml10_content());
}

/// Appends a resolved entity / character reference to `buf`.
pub fn push_ref(buf: &mut String, r: &BytesRef<'_>) {
    if let Ok(Some(c)) = r.resolve_char_ref() {
        buf.push(c);
    } else if let Some(s) = quick_xml::escape::resolve_predefined_entity(r) {
        buf.push_str(s);
    }
}

/// Decodes Excel's `_xHHHH_` escapes (ECMA-376 Part 1, §22.9.2.19).
pub fn decode_x_escapes(s: &str) -> Cow<'_, str> {
    if !s.contains("_x") {
        return Cow::Borrowed(s);
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("_x") {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let code = tail
            .get(2..6)
            .filter(|h| {
                h.bytes().all(|b| b.is_ascii_hexdigit()) && tail.as_bytes().get(6) == Some(&b'_')
            })
            .and_then(|h| u32::from_str_radix(h, 16).ok())
            .and_then(char::from_u32);
        match code {
            Some(c) => {
                out.push(c);
                rest = &tail[7..];
            }
            None => {
                out.push_str("_x");
                rest = &tail[2..];
            }
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// Encodes characters XML 1.0 cannot carry (and literal `_xHHHH_`
/// sequences) as `_xHHHH_`.
pub fn encode_x_escapes(s: &str) -> Cow<'_, str> {
    let needs = |c: char| c.is_control() && !matches!(c, '\t' | '\n' | '\r');
    if !s.chars().any(needs) && !s.contains("_x") {
        return Cow::Borrowed(s);
    }
    let mut out = String::with_capacity(s.len() + 8);
    for (i, c) in s.char_indices() {
        if needs(c) {
            out.push_str(&format!("_x{:04X}_", c as u32));
        } else if c == '_' && is_x_escape(&s[i..]) {
            out.push_str("_x005F_");
        } else {
            out.push(c);
        }
    }
    Cow::Owned(out)
}

fn is_x_escape(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 7 && b[1] == b'x' && b[2..6].iter().all(u8::is_ascii_hexdigit) && b[6] == b'_'
}

/// Whether text needs `xml:space="preserve"`.
pub fn needs_preserve(s: &str) -> bool {
    s.starts_with(char::is_whitespace) || s.ends_with(char::is_whitespace) || s.contains('\n')
}

/// Formats a number for `<v>`: shortest round-trip form, exponent notation
/// for very large/small magnitudes.
pub fn fmt_num(n: f64) -> String {
    let a = n.abs();
    if n == 0.0 {
        "0".to_owned()
    } else if (1e-5..1e15).contains(&a) {
        format!("{n}")
    } else {
        format!("{n:e}")
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

    /// A writer for an XML fragment (no declaration).
    pub fn fragment() -> Self {
        XmlOut {
            w: Writer::new(Vec::new()),
        }
    }

    /// Appends already-serialized XML.
    pub fn raw(&mut self, xml: &[u8]) {
        self.w.get_mut().extend_from_slice(xml);
    }

    fn el<'a>(name: &'a str, attrs: &[(&str, &str)]) -> BytesStart<'a> {
        let mut el = BytesStart::new(name);
        for &(k, v) in attrs {
            el.push_attribute((k, v));
        }
        el
    }

    fn put(&mut self, ev: Event<'_>) {
        self.w
            .write_event(ev)
            .expect("writing XML into a Vec cannot fail");
    }

    pub fn start(&mut self, name: &str, attrs: &[(&str, &str)]) {
        self.put(Event::Start(Self::el(name, attrs)));
    }

    pub fn empty(&mut self, name: &str, attrs: &[(&str, &str)]) {
        self.put(Event::Empty(Self::el(name, attrs)));
    }

    pub fn end(&mut self, name: &str) {
        self.put(Event::End(BytesEnd::new(name)));
    }

    /// Character data; only `<`, `>` and `&` are escaped.
    pub fn text(&mut self, text: &str) {
        self.put(Event::Text(BytesText::from_escaped(
            fmt_ooxml::xml::escape_text(text),
        )));
    }

    /// `<name attrs>text</name>`.
    pub fn text_el(&mut self, name: &str, attrs: &[(&str, &str)], text: &str) {
        self.start(name, attrs);
        self.text(text);
        self.end(name);
    }

    pub fn finish(self) -> Vec<u8> {
        self.w.into_inner()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x_escapes() {
        assert_eq!(decode_x_escapes("a_x000D_b"), "a\rb");
        assert_eq!(decode_x_escapes("_x005F_x0041_"), "_x0041_");
        assert_eq!(decode_x_escapes("_x12_ _xZZZZ_"), "_x12_ _xZZZZ_");
        for s in ["plain", "a\u{1}b", "_x0041_", "x_x", "tab\there"] {
            assert_eq!(decode_x_escapes(&encode_x_escapes(s)), s, "{s:?}");
        }
        assert_eq!(encode_x_escapes("a\u{1}"), "a_x0001_");
    }

    #[test]
    fn numbers() {
        assert_eq!(fmt_num(0.0), "0");
        assert_eq!(fmt_num(42.0), "42");
        assert_eq!(fmt_num(-2.5), "-2.5");
        assert_eq!(fmt_num(1e15), "1e15");
        assert_eq!(fmt_num(1e-7), "1e-7");
        for n in [
            0.1 + 0.2,
            1e300,
            -1.5e-300,
            123456.789,
            1e15,
            999999999999999.0,
        ] {
            assert_eq!(fmt_num(n).parse::<f64>().unwrap(), n);
        }
    }

    #[test]
    fn writer_escapes() {
        let mut x = XmlOut::new();
        x.text_el("a", &[("k", "<\"&>")], "1 < 2 & 3 \"q\" 'a'");
        let s = String::from_utf8(x.finish()).unwrap();
        assert!(s.starts_with(DECLARATION));
        assert!(
            s.contains(r#"<a k="&lt;&quot;&amp;&gt;">1 &lt; 2 &amp; 3 "q" 'a'</a>"#),
            "{s}"
        );
    }
}
