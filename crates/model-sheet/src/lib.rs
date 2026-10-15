#![forbid(unsafe_code)]
//! The Calc document model (ADR 0004).
//!
//! A [`Workbook`] owns an [`engine_formula::Engine`] that stores every
//! cell's content and computed value; this crate adds what a spreadsheet
//! document needs on top: deduplicated [`CellStyle`]s ([`StyleTable`]),
//! number formats ([`numfmt`]), column/row dimensions, sheet defaults,
//! sheet views (frozen panes, zoom), hidden sheets, merged cells, sorting
//! and AutoFilter ([`sortfilter`]).
//! [`WorkbookSnapshot`] is the serializable form (camelCase JSON) used by
//! serde, the IPC layer and `fmt-xlsx`.

pub mod numfmt;
pub mod sheet;
pub mod snapshot;
pub mod sortfilter;
pub mod style;
pub mod workbook;

pub use engine_formula::{CellContent, CellCoord, EngineError, Recalc, SheetId};
pub use sheet::{ColInfo, MergeRect, RowInfo, SheetFormat, SheetView, MAX_ZOOM, MIN_ZOOM};
pub use snapshot::{
    content_to_input, CellSnapshot, ColSnapshot, RowSnapshot, SheetSnapshot, WorkbookSnapshot,
};
pub use sortfilter::{
    AutoFilter, Criterion, DynamicFilter, Filter, FilterChange, FilterColumn, FilterOp,
    FilterValue, SortKey, SortKind, SortSpec, SortState,
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
    /// Hiding or deleting the only visible sheet.
    #[error("a workbook needs at least one visible sheet")]
    LastVisibleSheet,
    /// A merge of a single cell or outside the sheet.
    #[error("invalid merge range")]
    InvalidMerge,
    /// A merge that partially overlaps an existing merged range.
    #[error("merge range overlaps an existing merged range")]
    MergeOverlap,
    #[error("invalid sheet view: {0}")]
    InvalidSheetView(String),
    #[error("invalid snapshot: {0}")]
    InvalidSnapshot(String),
    /// Sorting a range that intersects merged cells.
    #[error("cannot sort a range containing merged cells")]
    CannotSortMerged,
    /// A filter operation on a sheet without AutoFilter.
    #[error("the sheet has no AutoFilter")]
    NoAutoFilter,
}
