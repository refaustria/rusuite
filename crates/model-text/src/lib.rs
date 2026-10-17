#![forbid(unsafe_code)]
//! Write document model (paragraphs, lists, tables, inline images).
//!
//! The model follows WordprocessingML's block/inline shape (ADR 0006): a
//! [`Document`] body is a list of [`Block`]s ([`Paragraph`], [`Table`] or
//! [`Toc`]); paragraphs hold [`Inline`]s (text [`Run`]s, [`InlineImage`]s,
//! [`BreakKind`] breaks, [`Field`]s, [`NoteRef`]s and the range markers
//! of [`Comment`]s and bookmarks; text runs may carry a [`Hyperlink`]).
//! Lists are paragraphs
//! with a [`NumberingRef`], headings are paragraphs with a heading style.
//! The document is divided into [`Section`]s (page setup, headers and
//! footers); footnotes and endnotes live in [`Document::notes`], comments
//! in [`Document::comments`]. Every
//! paragraph, table, row and cell (also inside headers, footers and notes)
//! carries a document-unique [`NodeId`].
//!
//! Formatting is layered as in Word: document defaults → style chain
//! (`based_on`) → numbering level → direct formatting; see
//! [`Document::resolve_paragraph_props`] and [`Document::resolve_run_props`].
//!
//! All types derive `serde` traits (camelCase fields; enums with data are
//! tagged `{"kind": …, "value": …}` like `core_model::Color`) and double as
//! IPC payloads. Lengths use [`core_model::units`].

pub mod block;
pub mod comment;
pub mod document;
pub mod drawing;
pub mod fields;
pub mod inline;
pub mod link;
pub mod media;
pub mod numbering;
pub mod page;
pub mod properties;
pub mod props;
pub mod section;
pub mod snapshot;
pub mod style;
pub mod style_set;
pub mod table;

pub use block::{Block, NodeId, Paragraph, Table, TableCell, TableRow, Toc, TocEntry};
pub use comment::{marker_of, Comment, CommentFix, CommentId, CommentRange};
pub use core_model::units::{Emu, Pt, Twips};
pub use core_model::RunProperties;
pub use document::{Document, DocumentStatistics};
pub use drawing::{
    default_text_insets, Autofit, Crop, Drawing, DrawingKind, DrawingText, LineDash, PictureFormat,
    Recolor, ShapeFill, ShapeLine,
};
pub use fields::{FieldValue, REF_ERROR};
pub use inline::{
    Anchor, BreakKind, Field, FieldKind, HAlign, HPos, HRelative, Inline, InlineImage, Insets,
    NoteKind, NoteRef, Placement, Run, VAlignPos, VPos, VRelative, WrapKind, WrapSide,
};
pub use link::{
    bookmark_marker_of, valid_bookmark_name, BookmarkId, BookmarkRange, Hyperlink, LinkTarget,
};
pub use media::{Base64Error, Media, MediaId, MediaStore};
pub use numbering::{
    AbstractNumbering, Level, LevelAlign, LevelKind, LevelOverride, LevelSuffix, ListPreset,
    Numbering, NumberingDef,
};
pub use page::{Margins, Orientation, PageSetup, PAGE_FIELD};
pub use properties::{CoreProperties, DocumentSettings};
pub use props::{
    Alignment, BorderSide, BorderStyle, CellMargins, CellProperties, HeightRule, Indent,
    LineSpacing, NumberingRef, ParagraphBorders, ParagraphProperties, RowHeight, RowProperties,
    Spacing, TabKind, TabLeader, TabStop, TableAlignment, TableBorders, TableLayout, TableLook,
    TableProperties, TableWidth, VAlign, VMerge,
};
pub use section::{
    ColumnWidth, Columns, HeaderFooterSet, HeaderSlot, Note, NoteNumbering, NoteRestart, Section,
    SectionId, SectionKind,
};
pub use snapshot::DocumentSnapshot;
pub use style::{
    apply_character_style, is_builtin_name, ConditionalFormat, ConditionalKind, Defaults,
    LatentException, LatentStyles, Style, StyleError, StyleKind, StylePatch, StyleSheet,
    TableStyle,
};
pub use style_set::{StyleSet, StyleSetEntry, BUILTIN_STYLE_SETS, STYLE_SET_IDS};

/// Errors of the `model-text` crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A snapshot could not be serialized or parsed as JSON.
    #[error("document snapshot JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// A table operation (merge, split) that cannot be applied.
    #[error("table: {0}")]
    Table(String),
}
