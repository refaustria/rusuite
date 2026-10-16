#![forbid(unsafe_code)]
//! Rusuite Calc document core (ADR 0005 §2): the transport-agnostic part
//! shared by the Tauri shell (`apps/calc/src-tauri`) and the wasm shell
//! (`apps/calc/src-wasm`).
//!
//! * [`CalcDocument`] wraps a [`model_sheet::Workbook`] and implements
//!   [`app_common::Document`]: [`CalcCommand`]s in, [`CalcPatch`]es out,
//!   each command returning its inverse for undo/redo.
//! * [`dispatch`] is the single JSON entry point of both shells:
//!   a [`Request`] in, a [`Response`] out.
//! * TypeScript definitions of every wire type are generated with `ts-rs`
//!   into `apps/calc/src/generated/` by `cargo test -p calc-core`.
//!
//! ```
//! use calc_core::{dispatch, CalcDocument, CalcHost};
//!
//! let mut host = CalcHost::new(CalcDocument::new());
//! let reply = dispatch(
//!     &mut host,
//!     r#"{"type":"apply","command":{"type":"setInput","sheet":0,"row":0,"col":0,"input":"=1+1"}}"#,
//! );
//! assert!(reply.starts_with(r#"{"ok":{"type":"patch","envelope":{"revision":1,"#));
//! assert!(reply.contains(r#""display":"2""#));
//! ```

mod annotations;
mod cfdv;
mod charts;
mod command;
mod dispatch;
mod display;
mod doc;
mod fill;
mod names;
mod patch;
mod pivots;
pub mod wire;
pub mod wire_annot;
pub mod wire_cf;
pub mod wire_chart;
pub mod wire_pivot;

pub use annotations::{CellAnnotations, FormulaLink, SheetAnnotations, SheetThreads};
pub use command::{CalcCommand, ClipCell, FillMode, PasteMode, Rect, SheetRect, SheetViewPatch};
pub use dispatch::{dispatch, CalcHost, Request, Response, ResponseBody};
pub use display::{display_value, UNDISPLAYABLE};
pub use doc::{CalcDocument, CalcError};
pub use fill::{plan as fill_plan, shift_input, FillItem, FillPlan};
pub use names::{name_from_text, preview_value, NameDef, NameEdges, NameInfo, NameRow};
pub use patch::{
    CalcPatch, CellCf, CellKind, CellView, ColView, CommentState, FoundCell, RegionSnapshot,
    RowView, SheetCells, SheetCols, SheetInfo, SheetMerges, SheetRows, StructuralChange,
    StructuralKind, WorkbookInfo,
};
pub use pivots::{
    PivotArea, PivotAt, PivotCellView, PivotFieldInfo, PivotInfo, PivotItemInfo, PivotPatch,
    PivotSourceSpec, PivotSummary, PivotTarget, SheetPivots,
};
