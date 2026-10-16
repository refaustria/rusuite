#![forbid(unsafe_code)]
//! Reads and writes `.docx` files, mapping to and from
//! [`model_text::Document`].
//!
//! The supported WordprocessingML subset (paragraphs, runs, lists, tables,
//! inline images, styles, numbering, page setup) and everything that is
//! dropped are listed in `docs/ooxml-subset.md`.
//!
//! ```
//! use model_text::{Block, Document, Paragraph};
//!
//! let mut doc = Document::new();
//! let id = doc.alloc_id();
//! doc.body = vec![Block::Paragraph(Paragraph::with_text(id, "Hello"))];
//!
//! let bytes = fmt_docx::write(&doc)?;
//! let back = fmt_docx::read(&bytes)?;
//! assert_eq!(back.plain_text(), "Hello");
//! assert_eq!(back.styles, doc.styles);
//! # Ok::<(), fmt_docx::Error>(())
//! ```
//!
//! [`read()`] / [`write()`] work on bytes and compile for `wasm32` (ADR 0005);
//! the `*_path` helpers exist on native targets only.

mod drawing;
mod numbering;
mod props;
mod read;
mod sections;
mod styles;
mod toc;
mod write;
mod xml;

use core_model::Theme;
use serde::{Deserialize, Serialize};

pub use props::{
    highlight_name, highlight_rgb, nearest_highlight, theme_shade_to_tint, theme_tint_to_tint,
    tint_to_theme_attr, HIGHLIGHT_COLORS,
};
pub use read::{read, read_with_context, read_with_warnings, ReadOutput};
pub use write::{write, write_with_context};

/// Result alias of this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong while reading or writing a `.docx` file.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The OPC container (ZIP, content types, relationships) is broken.
    #[error(transparent)]
    Package(#[from] fmt_ooxml::Error),
    /// A WordprocessingML part is not well-formed XML.
    #[error("xml error in {part}: {source}")]
    Xml {
        /// The part name.
        part: String,
        /// The parser error.
        source: quick_xml::Error,
    },
    /// A required part is missing.
    #[error("missing part: {0}")]
    MissingPart(String),
    /// Well-formed XML that violates the schema in a way we cannot recover
    /// from (e.g. a `w:document` without `w:body`).
    #[error("malformed {part}: {reason}")]
    Malformed {
        /// The part name.
        part: String,
        /// What is wrong.
        reason: String,
    },
    /// The document to write violates a model invariant (e.g. an image
    /// whose media is missing from the store).
    #[error("invalid document: {0}")]
    InvalidDocument(String),
    /// I/O error (only from the `*_path` helpers).
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

/// One `w:num` of the file that was read and how it was defined: which
/// `w:abstractNum` it used and which levels had a `w:startOverride`.
///
/// Informational: the model keeps this itself
/// ([`model_text::NumberingDef::abstract_id`] and `overrides`), and the
/// writer uses the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumInstance {
    /// `w:numId`.
    pub num_id: u32,
    /// `w:abstractNumId` it referenced.
    pub abstract_id: u32,
    /// Levels (`w:ilvl`) that had a `w:startOverride`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub start_overrides: Vec<u8>,
}

/// File-level data that has no slot in [`model_text::Document`] but should
/// survive a read → write cycle. Obtained from [`read_with_context`], passed
/// to [`write_with_context`]; [`DocxContext::default`] is what [`write()`]
/// uses.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxContext {
    /// Raw `word/theme/theme1.xml`, written back verbatim. `None` = the
    /// built-in Office theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_xml: Option<Vec<u8>>,
    /// The parsed theme (colors and fonts), used to resolve theme fonts and
    /// the `w:val` fallback of theme colors. `None` = the Office theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    /// Raw `word/settings.xml`, written back verbatim. `None` = a minimal
    /// settings part (compatibility mode 15).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings_xml: Option<Vec<u8>>,
    /// How the nums of the file shared abstract definitions
    /// (informational, see [`NumInstance`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub numbering: Vec<NumInstance>,
    /// Ids of the separator and continuation-separator footnotes as listed
    /// in the settings part (`w:footnotePr/w:footnote`); the writer reuses
    /// them so the kept settings stay consistent. `None` = `-1` and `0`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footnote_separators: Option<(i32, i32)>,
    /// Like [`footnote_separators`](Self::footnote_separators) for
    /// endnotes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endnote_separators: Option<(i32, i32)>,
}

impl DocxContext {
    /// The theme in effect (the context's or the Office default).
    pub fn theme_or_default(&self) -> std::borrow::Cow<'_, Theme> {
        match &self.theme {
            Some(t) => std::borrow::Cow::Borrowed(t),
            None => std::borrow::Cow::Owned(Theme::default()),
        }
    }
}

/// Reads a `.docx` file from disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn read_path(path: impl AsRef<std::path::Path>) -> Result<model_text::Document> {
    read(&std::fs::read(path)?)
}

/// Writes `doc` as a `.docx` file to disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn write_path(doc: &model_text::Document, path: impl AsRef<std::path::Path>) -> Result<()> {
    std::fs::write(path, write(doc)?)?;
    Ok(())
}

/// Collects warnings, merging repeats into one line with a count.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    order: Vec<String>,
    counts: std::collections::HashMap<String, usize>,
}

impl Warnings {
    pub(crate) fn add(&mut self, msg: impl Into<String>) {
        let msg = msg.into();
        let n = self.counts.entry(msg.clone()).or_insert(0);
        if *n == 0 {
            self.order.push(msg);
        }
        *n += 1;
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    pub(crate) fn into_vec(self) -> Vec<String> {
        self.order
            .into_iter()
            .map(|m| match self.counts[&m] {
                1 => m,
                n => format!("{m} ({n}x)"),
            })
            .collect()
    }
}
