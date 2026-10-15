//! OPC part names (ECMA-376 Part 2, §9.1.1).

use std::cmp::Ordering;
use std::fmt;
use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// An absolute OPC part name such as `/word/document.xml`.
///
/// Validated on construction. Equality, ordering and hashing are
/// ASCII-case-insensitive as required by OPC; `Display` shows the original spelling.
#[derive(Clone, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PartName(String);

impl PartName {
    /// Validates `name` and wraps it.
    ///
    /// Rules: leading `/`, no trailing `/`, no empty segments, no `.` or `..` segments.
    pub fn new(name: impl Into<String>) -> Result<Self> {
        let name = name.into();
        let invalid = |reason| Error::InvalidPartName {
            name: name.clone(),
            reason,
        };
        let Some(rest) = name.strip_prefix('/') else {
            return Err(invalid("must start with '/'"));
        };
        if rest.is_empty() {
            return Err(invalid("must not be the root"));
        }
        if rest.ends_with('/') {
            return Err(invalid("must not end with '/'"));
        }
        for segment in rest.split('/') {
            match segment {
                "" => return Err(invalid("empty segment")),
                "." | ".." => return Err(invalid("'.' or '..' segment")),
                _ => {}
            }
        }
        Ok(Self(name))
    }

    /// The part name as originally spelled, including the leading `/`.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The ZIP entry name: the part name without the leading `/`.
    pub fn zip_entry_name(&self) -> &str {
        &self.0[1..]
    }

    /// The last segment, e.g. `document.xml`.
    pub fn file_name(&self) -> &str {
        let idx = self.0.rfind('/').unwrap_or(0);
        &self.0[idx + 1..]
    }

    /// The extension of the last segment without the dot (`xml`), if any.
    pub fn extension(&self) -> Option<&str> {
        let file = self.file_name();
        file.rfind('.').map(|i| &file[i + 1..])
    }

    /// The containing directory with trailing `/`, e.g. `/word/` (`/` for top-level parts).
    pub fn parent_dir(&self) -> &str {
        let idx = self.0.rfind('/').unwrap_or(0);
        &self.0[..=idx]
    }

    /// The name of the relationships part for this part:
    /// `/word/document.xml` → `/word/_rels/document.xml.rels`.
    pub fn rels_part_name(&self) -> PartName {
        PartName(format!(
            "{}_rels/{}.rels",
            self.parent_dir(),
            self.file_name()
        ))
    }

    /// Resolves a relationship target relative to this part (the source part).
    ///
    /// Handles `..`/`.` segments and absolute targets (leading `/`).
    pub fn resolve(&self, relative_target: &str) -> Result<PartName> {
        resolve_from(self.parent_dir(), relative_target)
    }

    /// If this is a relationships part (`<dir>/_rels/<file>.rels`), returns its source.
    pub(crate) fn rels_source(&self) -> Option<RelsSource> {
        let file = self.file_name();
        let dir = self.parent_dir();
        let stem_len = file.len().checked_sub(".rels".len())?;
        if !file.is_char_boundary(stem_len) || !file[stem_len..].eq_ignore_ascii_case(".rels") {
            return None;
        }
        let dir_len = dir.len().checked_sub("_rels/".len())?;
        if !dir.is_char_boundary(dir_len) || !dir[dir_len..].eq_ignore_ascii_case("_rels/") {
            return None;
        }
        let source_dir = &dir[..dir_len];
        let stem = &file[..stem_len];
        if stem.is_empty() {
            return (source_dir == "/").then_some(RelsSource::Package);
        }
        PartName::new(format!("{source_dir}{stem}"))
            .ok()
            .map(RelsSource::Part)
    }

    fn cmp_key(&self) -> impl Iterator<Item = u8> + '_ {
        self.0.bytes().map(|b| b.to_ascii_lowercase())
    }
}

/// What a relationships part belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RelsSource {
    /// `/_rels/.rels`
    Package,
    /// `/<dir>/_rels/<file>.rels`
    Part(PartName),
}

/// Resolves `target` against `base_dir` (which ends in `/`).
pub(crate) fn resolve_from(base_dir: &str, target: &str) -> Result<PartName> {
    let joined = if target.starts_with('/') {
        target.to_owned()
    } else {
        format!("{base_dir}{target}")
    };
    let mut segments: Vec<&str> = Vec::new();
    for segment in joined.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(Error::InvalidPartName {
                        name: target.to_owned(),
                        reason: "target escapes the package root",
                    });
                }
            }
            s => segments.push(s),
        }
    }
    if joined.ends_with('/') {
        return Err(Error::InvalidPartName {
            name: target.to_owned(),
            reason: "must not end with '/'",
        });
    }
    PartName::new(format!("/{}", segments.join("/")))
}

impl fmt::Display for PartName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Debug for PartName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, f)
    }
}

impl PartialEq for PartName {
    fn eq(&self, other: &Self) -> bool {
        self.0.eq_ignore_ascii_case(&other.0)
    }
}

impl Eq for PartName {}

impl PartialOrd for PartName {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PartName {
    fn cmp(&self, other: &Self) -> Ordering {
        self.cmp_key().cmp(other.cmp_key())
    }
}

impl Hash for PartName {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for b in self.cmp_key() {
            state.write_u8(b);
        }
        state.write_u8(0xff);
    }
}

impl TryFrom<String> for PartName {
    type Error = Error;
    fn try_from(value: String) -> Result<Self> {
        Self::new(value)
    }
}

impl TryFrom<&str> for PartName {
    type Error = Error;
    fn try_from(value: &str) -> Result<Self> {
        Self::new(value)
    }
}

impl From<PartName> for String {
    fn from(value: PartName) -> Self {
        value.0
    }
}

impl AsRef<str> for PartName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::hash_map::DefaultHasher;

    fn pn(s: &str) -> PartName {
        PartName::new(s).unwrap()
    }

    fn hash_of(p: &PartName) -> u64 {
        let mut h = DefaultHasher::new();
        p.hash(&mut h);
        h.finish()
    }

    #[test]
    fn validation() {
        assert!(PartName::new("/word/document.xml").is_ok());
        assert!(PartName::new("/[trash]/0000.dat").is_ok());
        for bad in [
            "",
            "/",
            "word/document.xml",
            "/word/",
            "/word//document.xml",
            "/word/./document.xml",
            "/word/../document.xml",
            "/..",
        ] {
            assert!(
                matches!(PartName::new(bad), Err(Error::InvalidPartName { .. })),
                "{bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn case_insensitive_eq_ord_hash_display_original() {
        let a = pn("/Word/Document.XML");
        let b = pn("/word/document.xml");
        assert_eq!(a, b);
        assert_eq!(a.cmp(&b), Ordering::Equal);
        assert_eq!(hash_of(&a), hash_of(&b));
        assert_eq!(a.to_string(), "/Word/Document.XML");
        assert_ne!(a, pn("/word/document2.xml"));
        assert!(pn("/a/B.xml") < pn("/a/c.xml"));
    }

    #[test]
    fn components() {
        let p = pn("/word/document.xml");
        assert_eq!(p.extension(), Some("xml"));
        assert_eq!(p.parent_dir(), "/word/");
        assert_eq!(p.file_name(), "document.xml");
        assert_eq!(p.zip_entry_name(), "word/document.xml");
        assert_eq!(pn("/noext").extension(), None);
        assert_eq!(pn("/top.bin").parent_dir(), "/");
    }

    #[test]
    fn rels_mapping_both_ways() {
        let src = pn("/word/document.xml");
        let rels = src.rels_part_name();
        assert_eq!(rels.as_str(), "/word/_rels/document.xml.rels");
        assert_eq!(rels.rels_source(), Some(RelsSource::Part(src)));
        assert_eq!(pn("/_rels/.rels").rels_source(), Some(RelsSource::Package));
        assert_eq!(
            pn("/_RELS/x.RELS").rels_source(),
            Some(RelsSource::Part(pn("/x")))
        );
        assert_eq!(
            pn("/top.xml").rels_part_name().as_str(),
            "/_rels/top.xml.rels"
        );
        assert_eq!(pn("/word/document.xml").rels_source(), None);
        assert_eq!(pn("/word/foo.rels").rels_source(), None);
        // `.rels` inside a non-root `_rels` has no valid source part.
        assert_eq!(pn("/word/_rels/.rels").rels_source(), None);
    }

    #[test]
    fn resolve_targets() {
        let src = pn("/word/document.xml");
        assert_eq!(
            src.resolve("../media/image1.png").unwrap().as_str(),
            "/media/image1.png"
        );
        assert_eq!(
            src.resolve("media/image1.png").unwrap().as_str(),
            "/word/media/image1.png"
        );
        assert_eq!(
            src.resolve("./styles.xml").unwrap().as_str(),
            "/word/styles.xml"
        );
        assert_eq!(
            src.resolve("/customXml/item1.xml").unwrap().as_str(),
            "/customXml/item1.xml"
        );
        let deep = pn("/xl/worksheets/sheet1.xml");
        assert_eq!(
            deep.resolve("../drawings/drawing1.xml").unwrap().as_str(),
            "/xl/drawings/drawing1.xml"
        );
        assert!(src.resolve("../../x.xml").is_err());
        assert!(src.resolve("media/").is_err());
    }

    #[test]
    fn try_from_validates() {
        assert_eq!(
            PartName::try_from("/a/b.xml".to_owned()).unwrap().as_str(),
            "/a/b.xml"
        );
        assert!(PartName::try_from("a/b.xml").is_err());
    }
}
