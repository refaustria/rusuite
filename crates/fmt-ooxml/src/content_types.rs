//! `[Content_Types].xml` (ECMA-376 Part 2, §10.1.2).

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::xml::{attr_local, escape_attr, local_name, DECLARATION};
use crate::PartName;

/// ZIP entry name of the content types stream.
pub const CONTENT_TYPES_ENTRY: &str = "[Content_Types].xml";
/// Namespace of `[Content_Types].xml`.
pub const CONTENT_TYPES_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
/// Content type of relationships parts.
pub const RELATIONSHIPS_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-package.relationships+xml";
/// Generic XML content type used for the mandatory `xml` default.
pub const XML_CONTENT_TYPE: &str = "application/xml";

/// A `<Default Extension=… ContentType=…/>` entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DefaultEntry {
    /// Extension without the dot; compared case-insensitively.
    pub extension: String,
    /// MIME content type.
    pub content_type: String,
}

/// An `<Override PartName=… ContentType=…/>` entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverrideEntry {
    /// Part the override applies to.
    pub part_name: PartName,
    /// MIME content type.
    pub content_type: String,
}

/// Parsed `[Content_Types].xml`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentTypes {
    /// `Default` entries in document order.
    pub defaults: Vec<DefaultEntry>,
    /// `Override` entries in document order.
    pub overrides: Vec<OverrideEntry>,
}

impl ContentTypes {
    /// Parses `[Content_Types].xml`.
    pub fn parse(xml: &[u8]) -> Result<Self> {
        let malformed = |reason: String| Error::Malformed {
            part: CONTENT_TYPES_ENTRY.to_owned(),
            reason,
        };
        let mut reader = Reader::from_reader(xml);
        let mut out = ContentTypes::default();
        loop {
            let event = reader.read_event().map_err(|source| Error::Xml {
                part: CONTENT_TYPES_ENTRY.to_owned(),
                source,
            })?;
            match event {
                Event::Start(el) | Event::Empty(el) => {
                    match local_name(el.name().as_ref().as_bytes()) {
                        b"Default" => {
                            let (Some(extension), Some(content_type)) =
                                (attr_local(&el, "Extension"), attr_local(&el, "ContentType"))
                            else {
                                return Err(malformed(
                                    "Default without Extension/ContentType".into(),
                                ));
                            };
                            out.defaults.push(DefaultEntry {
                                extension: extension.into_owned(),
                                content_type: content_type.into_owned(),
                            });
                        }
                        b"Override" => {
                            let (Some(part_name), Some(content_type)) =
                                (attr_local(&el, "PartName"), attr_local(&el, "ContentType"))
                            else {
                                return Err(malformed(
                                    "Override without PartName/ContentType".into(),
                                ));
                            };
                            out.overrides.push(OverrideEntry {
                                part_name: PartName::new(part_name.into_owned())?,
                                content_type: content_type.into_owned(),
                            });
                        }
                        _ => {}
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
        Ok(out)
    }

    /// Looks up the content type of `part`: an `Override` wins over a `Default`.
    pub fn get(&self, part: &PartName) -> Option<&str> {
        self.overrides
            .iter()
            .find(|o| &o.part_name == part)
            .map(|o| o.content_type.as_str())
            .or_else(|| part.extension().and_then(|ext| self.default_for(ext)))
    }

    /// The `Default` content type for `extension` (case-insensitive).
    pub fn default_for(&self, extension: &str) -> Option<&str> {
        self.defaults
            .iter()
            .find(|d| d.extension.eq_ignore_ascii_case(extension))
            .map(|d| d.content_type.as_str())
    }

    /// Builds a fresh table for `parts`: keeps the given `defaults` (adding the
    /// mandatory `rels` and `xml` defaults if missing) and adds an `Override` for
    /// every part whose content type is not covered by a matching `Default`.
    pub fn regenerate<'a>(
        defaults: &[DefaultEntry],
        parts: impl IntoIterator<Item = (&'a PartName, &'a str)>,
    ) -> Self {
        let mut out = ContentTypes {
            defaults: defaults.to_vec(),
            overrides: Vec::new(),
        };
        for (ext, ct) in [
            ("rels", RELATIONSHIPS_CONTENT_TYPE),
            ("xml", XML_CONTENT_TYPE),
        ] {
            if out.default_for(ext).is_none() {
                out.defaults.push(DefaultEntry {
                    extension: ext.to_owned(),
                    content_type: ct.to_owned(),
                });
            }
        }
        for (name, content_type) in parts {
            let covered = name
                .extension()
                .and_then(|ext| out.default_for(ext))
                .is_some_and(|d| d == content_type);
            if !covered {
                out.overrides.push(OverrideEntry {
                    part_name: name.clone(),
                    content_type: content_type.to_owned(),
                });
            }
        }
        out
    }

    /// Serializes to `[Content_Types].xml` bytes.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut s = String::with_capacity(256 + 128 * (self.defaults.len() + self.overrides.len()));
        s.push_str(DECLARATION);
        s.push_str("<Types xmlns=\"");
        s.push_str(CONTENT_TYPES_NS);
        s.push_str("\">");
        for d in &self.defaults {
            s.push_str("<Default Extension=\"");
            s.push_str(&escape_attr(d.extension.as_str()));
            s.push_str("\" ContentType=\"");
            s.push_str(&escape_attr(d.content_type.as_str()));
            s.push_str("\"/>");
        }
        for o in &self.overrides {
            s.push_str("<Override PartName=\"");
            s.push_str(&escape_attr(o.part_name.as_str()));
            s.push_str("\" ContentType=\"");
            s.push_str(&escape_attr(o.content_type.as_str()));
            s.push_str("\"/>");
        }
        s.push_str("</Types>");
        s.into_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pn(s: &str) -> PartName {
        PartName::new(s).unwrap()
    }

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="XML" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/x-main+xml"/>
</Types>"#;

    #[test]
    fn parse_and_lookup_override_beats_default() {
        let ct = ContentTypes::parse(SAMPLE.as_bytes()).unwrap();
        assert_eq!(ct.defaults.len(), 3);
        assert_eq!(ct.overrides.len(), 1);
        assert_eq!(
            ct.get(&pn("/Word/Document.xml")),
            Some("application/x-main+xml")
        );
        assert_eq!(ct.get(&pn("/word/styles.xml")), Some("application/xml"));
        assert_eq!(ct.get(&pn("/media/A.PNG")), Some("image/png"));
        assert_eq!(ct.get(&pn("/media/a.gif")), None);
        assert_eq!(ct.get(&pn("/noext")), None);
    }

    #[test]
    fn regenerate_adds_overrides_only_where_needed() {
        let defaults = vec![DefaultEntry {
            extension: "PNG".into(),
            content_type: "image/png".into(),
        }];
        let parts = [
            (pn("/word/document.xml"), "application/x-main+xml"),
            (pn("/word/styles.xml"), "application/xml"),
            (pn("/media/a.png"), "image/png"),
            (pn("/media/b.emf"), "image/x-emf"),
            (pn("/noext"), "application/octet-stream"),
        ];
        let ct = ContentTypes::regenerate(&defaults, parts.iter().map(|(n, c)| (n, *c)));
        let exts: Vec<_> = ct.defaults.iter().map(|d| d.extension.as_str()).collect();
        assert_eq!(exts, ["PNG", "rels", "xml"]);
        let overrides: Vec<_> = ct.overrides.iter().map(|o| o.part_name.as_str()).collect();
        assert_eq!(overrides, ["/word/document.xml", "/media/b.emf", "/noext"]);
        for (name, c) in &parts {
            assert_eq!(ct.get(name), Some(*c));
        }
    }

    #[test]
    fn xml_roundtrip() {
        let ct = ContentTypes::parse(SAMPLE.as_bytes()).unwrap();
        let xml = ct.to_xml();
        assert!(xml.starts_with(DECLARATION.as_bytes()));
        assert_eq!(ContentTypes::parse(&xml).unwrap(), ct);
    }

    #[test]
    fn missing_attribute_is_malformed() {
        let err = ContentTypes::parse(br#"<Types><Default Extension="x"/></Types>"#).unwrap_err();
        assert!(matches!(err, Error::Malformed { .. }));
    }
}
