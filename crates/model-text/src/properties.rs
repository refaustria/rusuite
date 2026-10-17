//! Document properties (File › Info: docx `docProps/core.xml` and
//! `docProps/app.xml`) and document settings kept in the model
//! (`word/settings.xml`).

use serde::{Deserialize, Serialize};

/// The core properties of a document (Dublin Core in `docProps/core.xml`)
/// plus the page count of `docProps/app.xml`. Dates are ISO 8601 strings
/// as stored in the file (the model has no clock: the UI stamps
/// `modified` when saving).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct CoreProperties {
    /// `dc:title`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub title: Option<String>,
    /// `dc:subject`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub subject: Option<String>,
    /// `dc:creator` (Word's "Author").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub author: Option<String>,
    /// `cp:keywords` (Word's "Tags").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub keywords: Option<String>,
    /// `dc:description` (Word's "Comments").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub description: Option<String>,
    /// `cp:category`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub category: Option<String>,
    /// The company (`docProps/app.xml` `Company`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub company: Option<String>,
    /// `cp:lastModifiedBy`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub last_modified_by: Option<String>,
    /// `dcterms:created` (W3CDTF, e.g. `2026-10-16T09:30:00Z`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub created: Option<String>,
    /// `dcterms:modified`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub modified: Option<String>,
    /// `cp:revision` (incremented on every save).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub revision: Option<u32>,
    /// Number of pages as of the last save (`app.xml` `Pages`; from the
    /// UI's pagination).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub pages: Option<u32>,
}

impl CoreProperties {
    /// Whether nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Overlays `patch`: every `Some` field wins; an empty (whitespace)
    /// string clears the text field.
    pub fn apply(&mut self, patch: &CoreProperties) {
        let CoreProperties {
            title,
            subject,
            author,
            keywords,
            description,
            category,
            company,
            last_modified_by,
            created,
            modified,
            revision,
            pages,
        } = patch;
        for (slot, v) in [
            (&mut self.title, title),
            (&mut self.subject, subject),
            (&mut self.author, author),
            (&mut self.keywords, keywords),
            (&mut self.description, description),
            (&mut self.category, category),
            (&mut self.company, company),
            (&mut self.last_modified_by, last_modified_by),
            (&mut self.created, created),
            (&mut self.modified, modified),
        ] {
            if let Some(v) = v {
                *slot = (!v.trim().is_empty()).then(|| v.clone());
            }
        }
        if revision.is_some() {
            self.revision = *revision;
        }
        if pages.is_some() {
            self.pages = *pages;
        }
    }
}

impl CoreProperties {
    /// The property Word's `DOCPROPERTY` field names (case-insensitive):
    /// `Title`, `Subject`, `Author`, `Keywords`, `Comments`, `Category`,
    /// `Company`, `LastSavedBy`, `Manager` is not kept.
    pub fn named(&self, name: &str) -> Option<&str> {
        let v = match name.to_ascii_lowercase().as_str() {
            "title" => &self.title,
            "subject" => &self.subject,
            "author" => &self.author,
            "keywords" => &self.keywords,
            "comments" => &self.description,
            "category" => &self.category,
            "company" => &self.company,
            "lastsavedby" => &self.last_modified_by,
            _ => return None,
        };
        v.as_deref()
    }
}

/// Document-wide settings the model keeps (the rest of `settings.xml`
/// travels verbatim in the file context).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct DocumentSettings {
    /// Layout › Hyphenation › Automatic (`w:autoHyphenation`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub auto_hyphenation: bool,
    /// Layout › Hyphenation Options › Hyphenation zone in twips
    /// (`w:hyphenationZone`; `None` = Word's 0.25 inch). Stored, the
    /// browser's hyphenation has no zone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub hyphenation_zone: Option<u32>,
    /// Endnotes at the end of each section instead of the document
    /// (`w:endnotePr/w:pos w:val="sectEnd"`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub endnotes_at_section_end: bool,
}

impl DocumentSettings {
    /// Whether everything has its default.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_sets_and_clears() {
        let mut p = CoreProperties {
            title: Some("Old".into()),
            author: Some("Ann".into()),
            ..Default::default()
        };
        p.apply(&CoreProperties {
            title: Some("New".into()),
            author: Some(" ".into()),
            revision: Some(3),
            ..Default::default()
        });
        assert_eq!(p.title.as_deref(), Some("New"));
        assert_eq!(p.author, None);
        assert_eq!(p.revision, Some(3));
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["title"], "New");
        assert!(json.get("author").is_none());
        assert!(CoreProperties::default().is_empty());
        assert!(DocumentSettings::default().is_default());
    }

    #[test]
    fn named_properties() {
        let p = CoreProperties {
            company: Some("ACME".into()),
            description: Some("Notes".into()),
            last_modified_by: Some("Bo".into()),
            ..Default::default()
        };
        assert_eq!(p.named("Company"), Some("ACME"));
        assert_eq!(p.named("COMMENTS"), Some("Notes"));
        assert_eq!(p.named("LastSavedBy"), Some("Bo"));
        assert_eq!(p.named("Title"), None);
        assert_eq!(p.named("Manager"), None);
        let mut q = p.clone();
        q.apply(&CoreProperties {
            company: Some("".into()),
            ..Default::default()
        });
        assert_eq!(q.company, None);
    }
}
