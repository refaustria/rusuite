#![forbid(unsafe_code)]
//! Write document model (paragraphs, lists, tables, inline images).
//!
//! The model follows WordprocessingML's block/inline shape (ADR 0006): a
//! [`Document`] body is a list of [`Block`]s ([`Paragraph`] or [`Table`]);
//! paragraphs hold [`Inline`]s (text [`Run`]s, [`InlineImage`]s and
//! [`BreakKind`] breaks). Lists are paragraphs with a [`NumberingRef`],
//! headings are paragraphs with a heading style. Every paragraph, table, row
//! and cell carries a document-unique [`NodeId`].
//!
//! Formatting is layered as in Word: document defaults → style chain
//! (`based_on`) → numbering level → direct formatting; see
//! [`Document::resolve_paragraph_props`] and [`Document::resolve_run_props`].
//!
//! All types derive `serde` traits (camelCase fields; enums with data are
//! tagged `{"kind": …, "value": …}` like `core_model::Color`) and double as
//! IPC payloads. Lengths use [`core_model::units`].

pub mod block;
pub mod document;
pub mod inline;
pub mod media;
pub mod numbering;
pub mod page;
pub mod props;
pub mod snapshot;
pub mod style;

pub use block::{Block, NodeId, Paragraph, Table, TableCell, TableRow};
pub use core_model::units::{Emu, Pt, Twips};
pub use core_model::RunProperties;
pub use document::Document;
pub use inline::{BreakKind, Inline, InlineImage, Run};
pub use media::{Base64Error, Media, MediaId, MediaStore};
pub use numbering::{Level, LevelKind, Numbering, NumberingDef};
pub use page::{Margins, Orientation, PageSetup, PAGE_FIELD};
pub use props::{
    Alignment, BorderSide, BorderStyle, CellMargins, CellProperties, HeightRule, Indent,
    LineSpacing, NumberingRef, ParagraphProperties, RowHeight, RowProperties, Spacing,
    TableBorders, TableProperties, TableWidth, VAlign,
};
pub use snapshot::DocumentSnapshot;
pub use style::{Defaults, Style, StyleKind, StyleSheet};

/// Errors of the `model-text` crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A snapshot could not be serialized or parsed as JSON.
    #[error("document snapshot JSON: {0}")]
    Json(#[from] serde_json::Error),
}
