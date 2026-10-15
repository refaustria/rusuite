//! [`CalcCommand`]: every edit the UI can send (ADR 0002 §1).
//!
//! Coordinates are 0-based; sheets are identified by their id (see
//! [`SheetInfo`](crate::SheetInfo)); ranges are inclusive
//! (`r0..=r1`, `c0..=c1`, `r0 <= r1`, `c0 <= c1`).

use model_sheet::CellStyle;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::patch::{ColView, RowView};

/// A document edit. JSON: `{"type":"setInput","sheet":0,"row":0,"col":0,"input":"=A2"}`.
///
/// The variants after [`RenameSheet`](Self::RenameSheet) are **internal**:
/// the document produces them as inverses for undo/redo. They are
/// serializable (the undo stack holds commands) but the UI never needs to
/// send them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CalcCommand {
    /// Sets a cell from user input (`""` clears it, `=` starts a formula,
    /// `'` forces text).
    SetInput {
        sheet: u32,
        row: u32,
        col: u32,
        input: String,
    },
    /// Clears the contents of a range ("Delete" key); styles are kept.
    ClearRange {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Merges `patch` into the effective style of every cell of the range
    /// (only the parts present in `patch` change).
    ApplyStyle {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        #[ts(as = "crate::wire::CellStyle")]
        patch: CellStyle,
    },
    /// Column width in character units; `null` = sheet default.
    SetColWidth {
        sheet: u32,
        col: u32,
        width: Option<f64>,
    },
    /// Row height in points; `null` = sheet default.
    SetRowHeight {
        sheet: u32,
        row: u32,
        height: Option<f64>,
    },
    SetColHidden {
        sheet: u32,
        col: u32,
        hidden: bool,
    },
    SetRowHidden {
        sheet: u32,
        row: u32,
        hidden: bool,
    },
    /// Inserts `count` rows before row `at`.
    InsertRows {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Deletes rows `at..at + count`.
    DeleteRows {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Inserts `count` columns before column `at`.
    InsertCols {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Deletes columns `at..at + count`.
    DeleteCols {
        sheet: u32,
        at: u32,
        count: u32,
    },
    /// Appends a sheet (not undoable yet).
    AddSheet {
        name: String,
    },
    RenameSheet {
        sheet: u32,
        name: String,
    },
    /// *Internal.* Sets `(row, col, input, own style id)` per cell.
    RestoreCells {
        sheet: u32,
        cells: Vec<(u32, u32, String, u32)>,
    },
    /// *Internal.* Sets `(row, col, own style id)` per cell.
    RestoreStyles {
        sheet: u32,
        cells: Vec<(u32, u32, u32)>,
    },
    /// *Internal.* Replaces the listed columns' properties.
    RestoreCols {
        sheet: u32,
        cols: Vec<ColView>,
    },
    /// *Internal.* Replaces the listed rows' properties.
    RestoreRows {
        sheet: u32,
        rows: Vec<RowView>,
    },
    /// *Internal.* Applies the commands in order as one undo step.
    Compound {
        commands: Vec<CalcCommand>,
    },
}
