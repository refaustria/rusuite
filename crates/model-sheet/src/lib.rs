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
//! ([`names`]), notes, threaded comments and hyperlinks
//! ([`annotations`]), pivot tables ([`pivot`]) and sheet / workbook
//! protection ([`protection`]).
//! [`WorkbookSnapshot`] is the serializable form (camelCase JSON) used by
//! serde, the IPC layer and `fmt-xlsx`.

pub mod annotations;
pub mod chart;
pub mod condfmt;
pub mod names;
pub mod numfmt;
pub mod outline;
pub mod picture;
pub mod pivot;
pub mod protection;
mod rules;
pub mod sheet;
pub mod snapshot;
pub mod sortfilter;
pub mod style;
pub mod tables;
pub mod textio;
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
pub use outline::{Axis, OutlineProps, OutlineState, MAX_OUTLINE_LEVEL};
pub use picture::Picture;
pub use pivot::{PivotCache, PivotTable};
pub use protection::{HashedPassword, Password, SheetProtection, WorkbookProtection};
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
    Alignment, BorderSide, BorderStyle, Borders, CellStyle, Fill, HAlign, PatternFill, PatternType,
    Protection, StyleId, StyleTable, VAlign,
};
pub use tables::{Table, TableColumn, TableLook, TotalsCell, TotalsFunction, DEFAULT_TABLE_STYLE};
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
    /// A direct edit of a pivot table cell (or a row/column insert or
    /// delete cutting through a pivot table).
    #[error("cannot change this part of a pivot table")]
    PivotCell,
    /// No pivot table with this id.
    #[error("unknown pivot table {0}")]
    UnknownPivot(u32),
    /// A malformed pivot table or source.
    #[error("invalid pivot table: {0}")]
    InvalidPivot(String),
    /// Writing the pivot table would overwrite these cells (inclusive),
    /// which have content or belong to another pivot table.
    #[error("a pivot table cannot overwrite the cells R{}C{}:R{}C{}", r0 + 1, c0 + 1, r1 + 1, c1 + 1)]
    PivotOverlap { r0: u32, c0: u32, r1: u32, c1: u32 },
    /// A malformed table, name or table operation.
    #[error("invalid table: {0}")]
    InvalidTable(String),
    /// No table with this id.
    #[error("unknown table {0}")]
    UnknownTable(u32),
    /// Insert / Delete Cells would cut through merged cells.
    #[error("We can't do that to a merged cell.")]
    ShiftMerged,
    /// Insert / Delete Cells would shift cells of a table or an
    /// AutoFilter range.
    #[error("This operation is not allowed. The operation is attempting to shift cells in a table or filtered range on your worksheet.")]
    ShiftTable,
    /// A change a protected sheet does not allow (locked cells, or an
    /// action its options forbid).
    #[error("{}", protection::SHEET_PROTECTED_MESSAGE)]
    SheetProtected,
    /// A sheet change while the workbook structure is locked.
    #[error("{}", protection::WORKBOOK_PROTECTED_MESSAGE)]
    WorkbookProtected,
    /// Unprotect with a wrong password.
    #[error("{}", protection::WRONG_PASSWORD_MESSAGE)]
    WrongPassword,
}
