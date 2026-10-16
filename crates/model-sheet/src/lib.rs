#![forbid(unsafe_code)]
//! The Calc document model (ADR 0004).
//!
//! A [`Workbook`] owns an [`engine_formula::Engine`] that stores every
//! cell's content and computed value; this crate adds what a spreadsheet
//! document needs on top: deduplicated [`CellStyle`]s ([`StyleTable`]),
//! number formats ([`numfmt`]), column/row dimensions, sheet defaults,
//! sheet views (frozen panes, zoom), hidden sheets, merged cells, sorting
//! and AutoFilter ([`sortfilter`]), conditional formatting ([`condfmt`])
//! data validation ([`validation`]), charts ([`chart`]), defined names
//! ([`names`]) and notes, threaded comments and hyperlinks
//! ([`annotations`]).
//! [`WorkbookSnapshot`] is the serializable form (camelCase JSON) used by
//! serde, the IPC layer and `fmt-xlsx`.

pub mod annotations;
pub mod chart;
pub mod condfmt;
pub mod names;
pub mod numfmt;
mod rules;
pub mod sheet;
pub mod snapshot;
pub mod sortfilter;
pub mod style;
pub mod validation;
pub mod workbook;

pub use annotations::{
    guid, initials_of, Hyperlink, LinkTarget, Note, NoteBounds, NoteRun, Person, Reply, Thread,
};
pub use chart::{CellOffset, ChartAnchor, ChartObject, ResolvedRef};
pub use condfmt::{
    CfKind, CfResult, CfRule, CfValue, ColorPoint, CompareOp, DxfStyle, IconSetKind,
};
pub use engine_formula::CellRect;

pub use engine_formula::{CellContent, CellCoord, EngineError, NameScope, Recalc, SheetId};
pub use names::{BuiltinName, DefinedName};
pub use sheet::{ColInfo, MergeRect, RowInfo, SheetFormat, SheetView, MAX_ZOOM, MIN_ZOOM};
pub use snapshot::{
    content_to_input, CellSnapshot, ColSnapshot, NameSnapshot, RowSnapshot, SheetSnapshot,
    WorkbookSnapshot,
};
pub use sortfilter::{
    AutoFilter, Criterion, DynamicFilter, Filter, FilterChange, FilterColumn, FilterOp,
    FilterValue, SortKey, SortKind, SortSpec, SortState,
};
pub use style::{
    Alignment, BorderSide, BorderStyle, Borders, CellStyle, Fill, HAlign, StyleId, StyleTable,
    VAlign,
};
pub use validation::{
    DataValidation, ErrorStyle, ListSource, ValidationKind, ValidationResult, DEFAULT_ERROR_MESSAGE,
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
    /// A malformed conditional formatting rule or data validation.
    #[error("invalid rule: {0}")]
    InvalidRule(String),
    /// No conditional formatting rule with this id on the sheet.
    #[error("unknown rule {0}")]
    UnknownRule(u32),
    /// A malformed chart or anchor.
    #[error("invalid chart: {0}")]
    InvalidChart(String),
    /// No chart with this id on the sheet.
    #[error("unknown chart {0}")]
    UnknownChart(u32),
    /// A malformed note, comment or hyperlink.
    #[error("invalid annotation: {0}")]
    InvalidAnnotation(String),
}
