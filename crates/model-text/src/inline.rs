//! Paragraph content: text runs, inline images and breaks.

use core_model::units::Emu;
use core_model::RunProperties;
use serde::{Deserialize, Serialize};

use crate::media::MediaId;

/// One piece of paragraph content.
///
/// Serializes as `{"kind":"run","value":{…}}`, `{"kind":"image","value":{…}}`
/// or `{"kind":"break","value":"line"}`.
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
