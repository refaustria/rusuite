//! Relationships parts (`*.rels`, ECMA-376 Part 2, §9.3).

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::xml::{attr_local, escape_attr, local_name, DECLARATION};

/// Namespace of relationships parts.
pub const RELATIONSHIPS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

/// Whether a relationship target is a part inside the package or an external resource.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TargetMode {
    /// Target is a part in this package (the default).
    #[default]
    Internal,
    /// Target is an external URI (`TargetMode="External"`).
    External,
}

/// A single `<Relationship>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Relationship {
    /// Unique id within its relationships part, e.g. `rId1`.
    pub id: String,
    /// Relationship type URI.
    pub rel_type: String,
    /// Target URI exactly as stored (relative to the source part's directory unless absolute).
    pub target: String,
    /// Internal or external target.
    pub target_mode: TargetMode,
}

/// The relationships of one source part (or of the package).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Relationships(Vec<Relationship>);

impl Relationships {
    /// An empty set.
    pub fn new() -> Self {
        Self::default()
    }

    /// Parses a `.rels` part. `part` is only used for error messages.
    pub fn parse(xml: &[u8], part: &str) -> Result<Self> {
        let mut reader = Reader::from_reader(xml);
        let mut out = Vec::new();
        loop {
            let event = reader.read_event().map_err(|source| Error::Xml {
                part: part.to_owned(),
                source,
            })?;
            match event {
                Event::Start(el) | Event::Empty(el)
                    if local_name(el.name().as_ref().as_bytes()) == b"Relationship" =>
                {
                    let (Some(id), Some(rel_type), Some(target)) = (
                        attr_local(&el, "Id"),
                        attr_local(&el, "Type"),
                        attr_local(&el, "Target"),
                    ) else {
                        return Err(Error::Malformed {
                            part: part.to_owned(),
                            reason: "Relationship without Id/Type/Target".into(),
                        });
                    };
                    let target_mode = match attr_local(&el, "TargetMode").as_deref() {
                        None | Some("Internal") => TargetMode::Internal,
                        Some("External") => TargetMode::External,
                        Some(other) => {
                            return Err(Error::Malformed {
                                part: part.to_owned(),
                                reason: format!("unknown TargetMode {other:?}"),
                            })
                        }
                    };
                    out.push(Relationship {
                        id: id.into_owned(),
                        rel_type: rel_type.into_owned(),
                        target: target.into_owned(),
                        target_mode,
                    });
                }
                Event::Eof => break,
                _ => {}
            }
        }
        Ok(Self(out))
    }

    /// Serializes to `.rels` bytes.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut s = String::with_capacity(256 + 160 * self.0.len());
        s.push_str(DECLARATION);
        s.push_str("<Relationships xmlns=\"");
        s.push_str(RELATIONSHIPS_NS);
        s.push_str("\">");
        for r in &self.0 {
            s.push_str("<Relationship Id=\"");
            s.push_str(&escape_attr(r.id.as_str()));
            s.push_str("\" Type=\"");
            s.push_str(&escape_attr(r.rel_type.as_str()));
            s.push_str("\" Target=\"");
            s.push_str(&escape_attr(r.target.as_str()));
            if r.target_mode == TargetMode::External {
                s.push_str("\" TargetMode=\"External");
            }
            s.push_str("\"/>");
        }
        s.push_str("</Relationships>");
        s.into_bytes()
    }

    /// All relationships in document order.
    pub fn iter(&self) -> std::slice::Iter<'_, Relationship> {
        self.0.iter()
    }

    /// Number of relationships.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// `true` if there are no relationships.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Looks up a relationship by id.
    pub fn get(&self, id: &str) -> Option<&Relationship> {
        self.0.iter().find(|r| r.id == id)
    }

    /// All relationships of the given type.
    pub fn by_type<'a>(&'a self, rel_type: &'a str) -> impl Iterator<Item = &'a Relationship> {
        self.0.iter().filter(move |r| r.rel_type == rel_type)
    }

    /// The first relationship of the given type.
    pub fn first_by_type(&self, rel_type: &str) -> Option<&Relationship> {
        self.0.iter().find(|r| r.rel_type == rel_type)
    }

    /// Adds an internal relationship with the next free `rIdN` id and returns it.
    pub fn add(&mut self, rel_type: impl Into<String>, target: impl Into<String>) -> &Relationship {
        self.add_with_mode(rel_type, target, TargetMode::Internal)
    }

    /// Like [`add`](Self::add) with an explicit target mode.
    pub fn add_with_mode(
        &mut self,
        rel_type: impl Into<String>,
        target: impl Into<String>,
        target_mode: TargetMode,
    ) -> &Relationship {
        let next = self
            .0
            .iter()
            .filter_map(|r| r.id.strip_prefix("rId")?.parse::<u64>().ok())
            .max()
            .map_or(1, |n| n + 1);
        self.0.push(Relationship {
            id: format!("rId{next}"),
            rel_type: rel_type.into(),
            target: target.into(),
            target_mode,
        });
        self.0.last().expect("just pushed")
    }

    /// Removes the relationship with the given id.
    pub fn remove(&mut self, id: &str) -> Option<Relationship> {
        let idx = self.0.iter().position(|r| r.id == id)?;
        Some(self.0.remove(idx))
    }
}

impl<'a> IntoIterator for &'a Relationships {
    type Item = &'a Relationship;
    type IntoIter = std::slice::Iter<'a, Relationship>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl FromIterator<Relationship> for Relationships {
    fn from_iter<T: IntoIterator<Item = Relationship>>(iter: T) -> Self {
        Self(iter.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IMAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
    const LINK: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="custom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=2" TargetMode="External"/>
</Relationships>"#;

    #[test]
    fn parse_preserves_ids_and_external_mode() {
        let rels = Relationships::parse(SAMPLE.as_bytes(), "test").unwrap();
        assert_eq!(rels.len(), 2);
        let img = rels.get("rId7").unwrap();
        assert_eq!(img.rel_type, IMAGE);
        assert_eq!(img.target, "media/image1.png");
        assert_eq!(img.target_mode, TargetMode::Internal);
        let link = rels.first_by_type(LINK).unwrap();
        assert_eq!(link.id, "custom");
        assert_eq!(link.target, "https://example.com/?a=1&b=2");
        assert_eq!(link.target_mode, TargetMode::External);
    }

    #[test]
    fn write_roundtrip() {
        let rels = Relationships::parse(SAMPLE.as_bytes(), "test").unwrap();
        let xml = rels.to_xml();
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(text.contains(r#"TargetMode="External""#));
        assert!(text.contains("a=1&amp;b=2"));
        assert_eq!(Relationships::parse(&xml, "test").unwrap(), rels);
    }

    #[test]
    fn add_generates_next_free_id() {
        let mut rels = Relationships::parse(SAMPLE.as_bytes(), "test").unwrap();
        assert_eq!(rels.add(IMAGE, "media/image2.png").id, "rId8");
        let mut empty = Relationships::new();
        assert_eq!(empty.add(IMAGE, "a.png").id, "rId1");
        assert_eq!(
            empty
                .add_with_mode(LINK, "https://x", TargetMode::External)
                .id,
            "rId2"
        );
        assert_eq!(empty.by_type(IMAGE).count(), 1);
        assert!(empty.remove("rId1").is_some());
        assert!(empty.get("rId1").is_none());
    }

    #[test]
    fn bad_target_mode_and_missing_attrs() {
        let bad = r#"<Relationships><Relationship Id="a" Type="t" Target="x" TargetMode="Weird"/></Relationships>"#;
        assert!(matches!(
            Relationships::parse(bad.as_bytes(), "t"),
            Err(Error::Malformed { .. })
        ));
        let missing = r#"<Relationships><Relationship Id="a" Type="t"/></Relationships>"#;
        assert!(matches!(
            Relationships::parse(missing.as_bytes(), "t"),
            Err(Error::Malformed { .. })
        ));
    }
}
