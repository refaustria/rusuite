//! Paragraph content: text runs, inline images, breaks, fields and
//! footnote/endnote references.

use core_model::units::Emu;
use core_model::RunProperties;
use serde::{Deserialize, Serialize};

use crate::media::MediaId;

/// One piece of paragraph content.
///
/// Serializes as `{"kind":"run","value":{…}}`, `{"kind":"image","value":{…}}`,
/// `{"kind":"break","value":"line"}`, `{"kind":"field","value":{…}}` or
/// `{"kind":"noteRef","value":{…}}`. Images, breaks, fields and note
/// references occupy one position each.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum Inline {
    /// Formatted text.
    Run(Run),
    /// An image placed inline with the text.
    Image(InlineImage),
    /// A manual line or page break.
    Break(BreakKind),
    /// A field (page number, date, …) with its last computed result.
    Field(Field),
    /// The reference mark of a footnote or endnote (the note's content
    /// lives in [`crate::Document::notes`]).
    NoteRef(NoteRef),
}

impl Inline {
    /// The run, if this is a [`Inline::Run`].
    pub fn as_run(&self) -> Option<&Run> {
        match self {
            Inline::Run(run) => Some(run),
            _ => None,
        }
    }
}

/// A span of text with uniform formatting.
///
/// Tabs are kept as `'\t'` in `text`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Run {
    /// Direct character formatting.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub props: RunProperties,
    /// The text.
    pub text: String,
}

impl Run {
    /// A run without direct formatting.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            props: RunProperties::default(),
            text: text.into(),
        }
    }

    /// A run with direct formatting.
    pub fn with_props(text: impl Into<String>, props: RunProperties) -> Self {
        Self {
            props,
            text: text.into(),
        }
    }
}

/// Kind of a manual break.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum BreakKind {
    /// Line break (Shift+Enter).
    Line,
    /// Page break.
    Page,
}

/// An image placed inline with the text.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct InlineImage {
    /// The image data in the document's [`crate::MediaStore`].
    #[cfg_attr(feature = "ts", ts(as = "crate::media::MediaIdTs"))]
    pub media: MediaId,
    /// Displayed width.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Displayed height.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub height: Emu,
    /// Alternative text (docx `wp:docPr/@descr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    /// Object name (docx `wp:docPr/@name`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// What a [`Field`] computes.
///
/// Serializes as `{"kind":"page"}` or `{"kind":"date","value":{"format":"d.M.yyyy"}}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind",
    content = "value"
)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum FieldKind {
    /// The current page number (docx `PAGE`).
    Page,
    /// The number of pages (docx `NUMPAGES`).
    NumPages,
    /// The current date (docx `DATE`); `format` is Word's date picture
    /// (`\@` switch, e.g. `d MMMM yyyy`), `None` = the default format.
    Date {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts", ts(optional))]
        format: Option<String>,
    },
    /// The current time (docx `TIME`), `format` like [`FieldKind::Date`].
    Time {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts", ts(optional))]
        format: Option<String>,
    },
    /// The document's file name (docx `FILENAME`).
    FileName,
    /// The document author (docx `AUTHOR`).
    Author,
}

impl FieldKind {
    /// The field instruction as written to docx (`PAGE`, `DATE \@ "d.M.yyyy"`).
    pub fn instruction(&self) -> String {
        let with_format = |name: &str, format: &Option<String>| match format {
            Some(f) => format!("{name} \\@ \"{f}\""),
            None => name.to_owned(),
        };
        match self {
            FieldKind::Page => "PAGE".into(),
            FieldKind::NumPages => "NUMPAGES".into(),
            FieldKind::Date { format } => with_format("DATE", format),
            FieldKind::Time { format } => with_format("TIME", format),
            FieldKind::FileName => "FILENAME".into(),
            FieldKind::Author => "AUTHOR".into(),
        }
    }

    /// Parses a field instruction (`" PAGE \\* MERGEFORMAT "`,
    /// `DATE \\@ "dd.MM.yyyy"`); `None` for fields that are not modelled.
    /// Formatting switches (`\\*`) are ignored; the date/time picture
    /// keeps Word's escapes as written.
    pub fn parse(instr: &str) -> Option<Self> {
        let instr = instr.trim();
        let (name, rest) = instr.split_once(char::is_whitespace).unwrap_or((instr, ""));
        let format = || picture(rest);
        Some(match name.to_ascii_uppercase().as_str() {
            "PAGE" => FieldKind::Page,
            "NUMPAGES" => FieldKind::NumPages,
            "DATE" => FieldKind::Date { format: format() },
            "TIME" => FieldKind::Time { format: format() },
            "FILENAME" => FieldKind::FileName,
            "AUTHOR" => FieldKind::Author,
            _ => return None,
        })
    }
}

/// The argument of a `\\@` switch: a quoted string (`\\@ "d MMM"`, also
/// without space: `\\@"d"`) or one word.
fn picture(switches: &str) -> Option<String> {
    let at = switches.find("\\@")?;
    let arg = switches[at + 2..].trim_start();
    if let Some(quoted) = arg.strip_prefix('"') {
        let end = quoted.find('"').unwrap_or(quoted.len());
        Some(quoted[..end].to_owned())
    } else {
        arg.split_whitespace().next().map(str::to_owned)
    }
    .filter(|f| !f.is_empty())
}

/// A field: what it computes, its last result and the result's
/// formatting. The result is shown until the UI recomputes it (page
/// numbers come from pagination).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Field {
    /// What the field computes.
    pub kind: FieldKind,
    /// The last computed result (as stored in the file).
    #[serde(default)]
    pub cached: String,
    /// Formatting of the result.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(
        feature = "ts",
        ts(as = "Option<app_common::wire::RunProperties>", optional)
    )]
    pub props: RunProperties,
}

impl Field {
    /// A field of `kind` with an empty result and no formatting.
    pub fn new(kind: FieldKind) -> Self {
        Self {
            kind,
            cached: String::new(),
            props: RunProperties::default(),
        }
    }
}

/// Footnote or endnote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum NoteKind {
    /// A footnote (bottom of the page).
    #[default]
    Foot,
    /// An endnote (end of the document).
    End,
}

/// The reference mark of a note in the text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct NoteRef {
    /// Id of the [`crate::Note`] (unique across foot- and endnotes).
    pub id: u32,
    /// Footnote or endnote.
    pub kind: NoteKind,
    /// Direct formatting of the mark (on top of the reference style,
    /// which makes it superscript).
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(
        feature = "ts",
        ts(as = "Option<app_common::wire::RunProperties>", optional)
    )]
    pub props: RunProperties,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_instructions() {
        assert_eq!(
            FieldKind::parse(" PAGE \\* MERGEFORMAT "),
            Some(FieldKind::Page)
        );
        assert_eq!(FieldKind::parse("numpages"), Some(FieldKind::NumPages));
        assert_eq!(
            FieldKind::parse(r#" DATE \@"d\.M\.yyyy" "#),
            Some(FieldKind::Date {
                format: Some(r"d\.M\.yyyy".into())
            })
        );
        assert_eq!(
            FieldKind::parse(r#"TIME \@ "HH:mm" \* MERGEFORMAT"#),
            Some(FieldKind::Time {
                format: Some("HH:mm".into())
            })
        );
        assert_eq!(
            FieldKind::parse("DATE \\@ yyyy"),
            Some(FieldKind::Date {
                format: Some("yyyy".into())
            })
        );
        assert_eq!(
            FieldKind::parse("DATE"),
            Some(FieldKind::Date { format: None })
        );
        assert_eq!(FieldKind::parse("REF _Ref1 \\h"), None);
        assert_eq!(FieldKind::parse(""), None);
        for k in [
            FieldKind::Page,
            FieldKind::Date {
                format: Some("d MMMM yyyy".into()),
            },
            FieldKind::Time { format: None },
            FieldKind::FileName,
            FieldKind::Author,
        ] {
            assert_eq!(FieldKind::parse(&k.instruction()), Some(k));
        }
    }

    #[test]
    fn json_shapes() {
        let f = Inline::Field(Field {
            kind: FieldKind::Date {
                format: Some("yyyy".into()),
            },
            cached: "2026".into(),
            props: RunProperties::default(),
        });
        assert_eq!(
            serde_json::to_string(&f).unwrap(),
            r#"{"kind":"field","value":{"kind":{"kind":"date","value":{"format":"yyyy"}},"cached":"2026"}}"#
        );
        let n = Inline::NoteRef(NoteRef {
            id: 3,
            kind: NoteKind::End,
            props: RunProperties::default(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert_eq!(json, r#"{"kind":"noteRef","value":{"id":3,"kind":"end"}}"#);
        assert_eq!(serde_json::from_str::<Inline>(&json).unwrap(), n);
    }
}
