#![forbid(unsafe_code)]
//! The Calc document model (ADR 0004).
//!
//! A [`Workbook`] owns an [`engine_formula::Engine`] that stores every
//! cell's content and computed value; this crate adds what a spreadsheet
//! document needs on top: deduplicated [`CellStyle`]s ([`StyleTable`]),
//! number formats ([`numfmt`]), column/row dimensions and sheet defaults.
//! [`WorkbookSnapshot`] is the serializable form (camelCase JSON) used by
//! serde, the IPC layer and `fmt-xlsx`.

pub mod numfmt;
pub mod sheet;
pub mod snapshot;
pub mod style;
pub mod workbook;

pub use engine_formula::{CellContent, CellCoord, EngineError, Recalc, SheetId};
pub use sheet::{ColInfo, RowInfo, SheetFormat};
pub use snapshot::{
    content_to_input, CellSnapshot, ColSnapshot, RowSnapshot, SheetSnapshot, WorkbookSnapshot,
};
pub use style::{
    Alignment, BorderSide, BorderStyle, Borders, CellStyle, Fill, HAlign, StyleId, StyleTable,
    VAlign,
};
pub use workbook::{Workbook, MAX_PATCH_CELLS};

/// A rectangular cell range on one sheet: the engine's
/// [`RangeRef`](engine_formula::RangeRef) (0-based, inclusive bounds), reused
/// so that ranges pass between the model and the engine unchanged.
pub type CellRange = engine_formula::RangeRef;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Engine(#[from] EngineError),
    #[error("unknown sheet {0:?}")]
    UnknownSheet(SheetId),
    #[error("invalid range")]
    InvalidRange,
    #[error("range has more than {MAX_PATCH_CELLS} cells")]
    RangeTooLarge,
    #[error("unknown style {0:?}")]
    UnknownStyle(StyleId),
    #[error("invalid width/height {0}")]
    InvalidDimension(f64),
    #[error("invalid snapshot: {0}")]
    InvalidSnapshot(String),
}
