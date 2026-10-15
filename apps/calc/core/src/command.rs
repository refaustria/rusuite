//! [`CalcCommand`]: every edit the UI can send (ADR 0002 §1).
//!
//! Coordinates are 0-based; sheets are identified by their id (see
//! [`SheetInfo`](crate::SheetInfo)); ranges are inclusive
//! (`r0..=r1`, `c0..=c1`, `r0 <= r1`, `c0 <= c1`).

use core_model::Color;
use model_sheet::{CellStyle, SheetFormat, SheetView};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::patch::{ColView, RowView};

/// A document edit. JSON: `{"type":"setInput","sheet":0,"row":0,"col":0,"input":"=A2"}`.
///
/// The variants after [`FillRange`](Self::FillRange) are **internal**:
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
    /// Adds an empty sheet at position `index` of the sheet order (absent:
    /// last). Undo deletes it; redo brings back the same sheet id.
    AddSheet {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        index: Option<u32>,
    },
    RenameSheet {
        sheet: u32,
        name: String,
    },
    /// Deletes a sheet (not the last one): references to it in the other
    /// sheets become `#REF!`. Undo restores the sheet (same id and
    /// position) with its contents, styles, dimensions, format and tab
    /// colour, and the original text of the rewritten formulas.
    DeleteSheet {
        sheet: u32,
    },
    /// Copies a sheet (contents, formulas, styles, dimensions, tab colour)
    /// to a new sheet `name` right after it; the copy's references to its
    /// source sheet point at the copy.
    DuplicateSheet {
        sheet: u32,
        name: String,
    },
    /// Moves a sheet to position `index` of the sheet order (0 = first).
    MoveSheet {
        sheet: u32,
        index: u32,
    },
    /// Sets the tab colour; `null` = default.
    SetSheetTabColor {
        sheet: u32,
        #[ts(as = "Option<app_common::wire::Color>")]
        color: Option<Color>,
    },
    /// Freezes rows `0..rows` and columns `0..cols` (`0, 0` unfreezes).
    /// The sheet list in the patch carries the new view.
    SetFreeze {
        sheet: u32,
        rows: u32,
        cols: u32,
    },
    /// Changes the listed view settings (zoom 10..=400).
    SetSheetView {
        sheet: u32,
        patch: SheetViewPatch,
    },
    /// Hides or shows a sheet. Hiding the last visible sheet fails with
    /// `last_visible_sheet`. The patch carries the sheet list and
    /// `activateSheet`. `veryHidden` (with `hidden`) is Excel's
    /// "very hidden" state; the UI never needs to send it.
    SetSheetHidden {
        sheet: u32,
        hidden: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        very_hidden: Option<bool>,
    },
    /// Merges the range (at least two cells): only the top-left cell keeps
    /// its content, the others are cleared (styles stay); merges lying
    /// inside the range are absorbed, one sticking out fails with
    /// `merge_overlap`. Undo restores the cleared contents.
    MergeCells {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Removes every merge that intersects the range.
    UnmergeCells {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Pastes a copied block at `(r0, c0)` of `sheet` as one undo step.
    ///
    /// `src` is the copied range: its size is the block size, its top-left
    /// the origin of the paste offset. `cells` are the block's non-empty
    /// cells (`dr`/`dc` relative to `src`); block positions without a cell
    /// are pasted as blanks. The block is repeated `repeat_rows ×
    /// repeat_cols` times (Excel fills a selection that is a multiple of
    /// the block). Formulas are shifted by the offset of each pasted copy
    /// (relative parts move, `$` parts stay), except for a `cut`, which
    /// moves the cells: formulas keep their text and the source cells not
    /// overwritten are cleared (contents and formats). References to the
    /// moved cells, in the moved formulas and anywhere in the workbook,
    /// follow them (undo restores the original formula texts).
    PasteRange {
        sheet: u32,
        r0: u32,
        c0: u32,
        src: SheetRect,
        cells: Vec<ClipCell>,
        mode: PasteMode,
        cut: bool,
        repeat_rows: u32,
        repeat_cols: u32,
    },
    /// The fill handle: fills `dst` (adjacent to `src`: below, above, to
    /// the right or to the left, spanning the same columns/rows) from
    /// `src`, line by line, as one undo step. See [`FillMode`].
    FillRange {
        sheet: u32,
        src: Rect,
        dst: Rect,
        mode: FillMode,
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
    /// *Internal.* Brings back a deleted sheet, empty, at position
    /// `index` (the undo of [`DeleteSheet`](Self::DeleteSheet)).
    RestoreSheet {
        sheet: u32,
        name: String,
        index: u32,
        #[ts(as = "Option<app_common::wire::Color>")]
        tab_color: Option<Color>,
        #[ts(as = "crate::wire::SheetFormat")]
        format: SheetFormat,
    },
    /// *Internal.* Replaces all merged ranges of the sheet.
    RestoreMerges {
        sheet: u32,
        merges: Vec<Rect>,
    },
    /// *Internal.* Applies the commands in order as one undo step.
    Compound {
        commands: Vec<CalcCommand>,
    },
}

/// The view settings [`CalcCommand::SetSheetView`] changes; absent fields
/// stay as they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetViewPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frozen_rows: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frozen_cols: Option<u32>,
    /// Percent, 10..=400.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub zoom: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_gridlines: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_headings: Option<bool>,
}

impl SheetViewPatch {
    /// A patch that sets every field to `view`'s value.
    pub fn full(view: SheetView) -> Self {
        SheetViewPatch {
            frozen_rows: Some(view.frozen_rows),
            frozen_cols: Some(view.frozen_cols),
            zoom: Some(view.zoom),
            show_gridlines: Some(view.show_gridlines),
            show_headings: Some(view.show_headings),
        }
    }

    /// `view` with the present fields replaced.
    pub fn apply(&self, view: SheetView) -> SheetView {
        SheetView {
            frozen_rows: self.frozen_rows.unwrap_or(view.frozen_rows),
            frozen_cols: self.frozen_cols.unwrap_or(view.frozen_cols),
            zoom: self.zoom.unwrap_or(view.zoom),
            show_gridlines: self.show_gridlines.unwrap_or(view.show_gridlines),
            show_headings: self.show_headings.unwrap_or(view.show_headings),
        }
    }
}

/// An inclusive cell range on an implied sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Rect {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

/// An inclusive cell range on `sheet`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetRect {
    pub sheet: u32,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

/// One copied cell of a [`CalcCommand::PasteRange`] block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct ClipCell {
    /// Offset from the block's top-left cell.
    pub dr: u32,
    pub dc: u32,
    /// The cell's input as copied (a formula as written at its source).
    pub input: String,
    /// Style id to paste; absent = keep the destination's style (plain
    /// text from the system clipboard).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub style: Option<u32>,
}

/// What a paste writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PasteMode {
    /// Contents and formats.
    All,
    /// Values only (a formula pastes the current value of its source
    /// cell); destination formats are kept.
    ValuesOnly,
    /// Formats only; destination contents are kept.
    FormatsOnly,
}

/// How [`CalcCommand::FillRange`] extends each line of the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum FillMode {
    /// Excel's plain drag: one number is copied; two or more numbers
    /// continue their linear (best-fit) trend; dates step by a day; text
    /// ending in a number counts up; anything else (formulas with
    /// relative references shifted) repeats.
    Auto,
    /// Ctrl+drag: series and copy swapped relative to `Auto`.
    Alternate,
    /// Always repeat the source.
    Copy,
    /// Always a series where one is possible (a single number steps by 1).
    Series,
}
