//! [`CalcDocument`]: a [`Workbook`] behind the [`Document`] trait.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use app_common::{Applied, DispatchError, Document, Patch, Revision};
use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{CellContent, Cycle, StructuralOp, Value};
use model_sheet::{
    content_to_input, CellCoord, CellRange, ColInfo, EngineError, Recalc, RowInfo, SheetId,
    StyleId, Workbook, MAX_PATCH_CELLS,
};

use crate::command::CalcCommand;
use crate::display::display_value;
use crate::patch::{
    CalcPatch, CellKind, CellView, ColView, RegionSnapshot, RowView, SheetCells, SheetCols,
    SheetInfo, SheetRows, StructuralChange, StructuralKind, WorkbookInfo,
};

/// Errors of [`CalcDocument`]; [`code`](Self::code) is the stable
/// [`DispatchError::code`].
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum CalcError {
    #[error(transparent)]
    Model(#[from] model_sheet::Error),
    #[error("unknown sheet {0}")]
    UnknownSheet(u32),
    #[error("invalid range")]
    InvalidRange,
    #[error("range has more than {MAX_PATCH_CELLS} cells")]
    RangeTooLarge,
    /// The bytes are not a readable `.xlsx` file.
    #[error("cannot read xlsx: {0}")]
    ReadXlsx(String),
    /// Writing the `.xlsx` file failed.
    #[error("cannot write xlsx: {0}")]
    WriteXlsx(String),
}

impl From<EngineError> for CalcError {
    fn from(e: EngineError) -> Self {
        CalcError::Model(e.into())
    }
}

impl CalcError {
    /// Machine-readable error code sent to the UI.
    pub fn code(&self) -> &'static str {
        use model_sheet::Error as M;
        match self {
            CalcError::UnknownSheet(_)
            | CalcError::Model(M::UnknownSheet(_) | M::Engine(EngineError::UnknownSheet(_))) => {
                "unknown_sheet"
            }
            CalcError::InvalidRange | CalcError::Model(M::InvalidRange) => "invalid_range",
            CalcError::RangeTooLarge | CalcError::Model(M::RangeTooLarge) => "range_too_large",
            CalcError::Model(M::Engine(EngineError::Parse(_))) => "invalid_formula",
            CalcError::Model(M::Engine(EngineError::DuplicateSheet(_))) => "duplicate_sheet",
            CalcError::Model(M::Engine(EngineError::InvalidCoord)) => "invalid_coord",
            CalcError::Model(M::UnknownStyle(_)) => "unknown_style",
            CalcError::Model(M::InvalidDimension(_)) => "invalid_dimension",
            CalcError::Model(M::InvalidSnapshot(_)) => "invalid_snapshot",
            CalcError::ReadXlsx(_) => "invalid_file",
            CalcError::WriteXlsx(_) => "internal",
        }
    }
}

impl From<CalcError> for DispatchError {
    fn from(e: CalcError) -> Self {
        DispatchError::new(e.code(), e.to_string())
    }
}

/// The Calc document: owns a [`Workbook`] and applies [`CalcCommand`]s.
#[derive(Debug, Default)]
pub struct CalcDocument {
    workbook: Workbook,
    /// File-level `.xlsx` data (theme, default font) kept from
    /// [`open_xlsx`](Self::open_xlsx) for [`save_xlsx`](Self::save_xlsx).
    pub xlsx_context: Option<fmt_xlsx::XlsxContext>,
    /// The file name the document was opened from (no directory).
    pub source_name: Option<String>,
}

/// `A`, `B`, …, `Z`, `AA`, … for a 0-based column.
fn col_letters(mut col: u32) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (col % 26) as u8);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

fn kind_of(v: &Value) -> CellKind {
    match v {
        Value::Empty => CellKind::Empty,
        Value::Number(_) => CellKind::Number,
        Value::Text(_) => CellKind::Text,
        Value::Bool(_) => CellKind::Bool,
        Value::Error(_) => CellKind::Error,
        Value::Array(_) => kind_of(&v.clone().into_scalar()),
    }
}

fn col_view(col: u32, info: ColInfo) -> ColView {
    ColView {
        col,
        width: info.width,
        hidden: info.hidden,
        style: info.style.map(|s| s.0),
    }
}

fn row_view(row: u32, info: RowInfo) -> RowView {
    RowView {
        row,
        height: info.height,
        hidden: info.hidden,
        style: info.style.map(|s| s.0),
    }
}

type Result<T, E = CalcError> = std::result::Result<T, E>;
type CalcApplied = Applied<CalcCommand, CalcPatch>;

impl CalcDocument {
    /// A document with one empty sheet `Sheet1`.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_workbook(workbook: Workbook) -> Self {
        CalcDocument {
            workbook,
            ..Self::default()
        }
    }

    /// Reads an `.xlsx` file; `name` is the file name shown to the user.
    /// Returns the document and the reader's warnings about content that
    /// was dropped or approximated.
    pub fn open_xlsx(bytes: &[u8], name: &str) -> Result<(Self, Vec<String>)> {
        let out =
            fmt_xlsx::read_with_context(bytes).map_err(|e| CalcError::ReadXlsx(e.to_string()))?;
        let doc = CalcDocument {
            workbook: out.workbook,
            xlsx_context: Some(out.context),
            source_name: Some(name.to_owned()),
        };
        Ok((doc, out.warnings))
    }

    /// Writes the document as `.xlsx`, with the file-level data it was
    /// opened with (if any).
    pub fn save_xlsx(&self) -> Result<Vec<u8>> {
        let default_ctx = fmt_xlsx::XlsxContext::default();
        let ctx = self.xlsx_context.as_ref().unwrap_or(&default_ctx);
        fmt_xlsx::write_with_context(&self.workbook, ctx)
            .map_err(|e| CalcError::WriteXlsx(e.to_string()))
    }

    /// The file name to offer when saving: the source name with an
    /// `.xlsx` extension, else `Untitled.xlsx`.
    pub fn suggested_name(&self) -> String {
        match self.source_name.as_deref() {
            None | Some("") => "Untitled.xlsx".to_owned(),
            Some(n) if n.to_ascii_lowercase().ends_with(".xlsx") => n.to_owned(),
            Some(n) => {
                let stem = n.rsplit_once('.').map_or(n, |(stem, _)| stem);
                format!("{stem}.xlsx")
            }
        }
    }

    pub fn workbook(&self) -> &Workbook {
        &self.workbook
    }

    /// Direct access (bypasses undo; for loading and host setup).
    pub fn workbook_mut(&mut self) -> &mut Workbook {
        &mut self.workbook
    }

    pub fn into_workbook(self) -> Workbook {
        self.workbook
    }

    fn sheet_infos(&self) -> Vec<SheetInfo> {
        self.workbook
            .sheets()
            .into_iter()
            .map(|(id, name)| SheetInfo { id: id.0, name })
            .collect()
    }

    fn style_list(&self) -> Vec<model_sheet::CellStyle> {
        self.workbook
            .styles()
            .iter()
            .map(|(_, s)| s.clone())
            .collect()
    }

    /// Sheets and styles; `revision` is 0 (the host fills it in).
    pub fn info(&self) -> WorkbookInfo {
        WorkbookInfo {
            sheets: self.sheet_infos(),
            styles: self.style_list(),
            revision: Revision(0),
        }
    }

    /// The cells with content or an own style, and the non-default
    /// rows/columns, of `r0..=r1 × c0..=c1` on `sheet`.
    pub fn snapshot(
        &self,
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    ) -> Result<RegionSnapshot> {
        let range = self.range(sheet, r0, c0, r1, c1)?;
        let s = range.sheet;
        let wb = &self.workbook;
        Ok(RegionSnapshot {
            sheet,
            r0,
            c0,
            r1,
            c1,
            cells: wb
                .cells_in(range)
                .map(|(c, _, _)| self.cell_view(c))
                .collect(),
            cols: wb
                .cols(s)
                .filter(|(i, _)| (c0..=c1).contains(i))
                .map(|(i, info)| col_view(i, info))
                .collect(),
            rows: wb
                .rows(s)
                .filter(|(i, _)| (r0..=r1).contains(i))
                .map(|(i, info)| row_view(i, info))
                .collect(),
            format: wb.sheet_format(s),
        })
    }

    /// The rendered state of one cell.
    pub fn cell_view(&self, c: CellCoord) -> CellView {
        let wb = &self.workbook;
        let value = wb.value(c);
        let style = wb.style_id(c);
        let format = wb.styles().get(style).number_format.as_deref();
        CellView {
            row: c.row,
            col: c.col,
            input: content_to_input(wb.content(c)),
            display: display_value(&value, format),
            kind: kind_of(&value),
            style: style.0,
        }
    }

    // --- validation -------------------------------------------------------

    fn sheet(&self, id: u32) -> Result<SheetId> {
        let s = SheetId(id);
        self.workbook
            .engine()
            .sheet_name(s)
            .map(|_| s)
            .ok_or(CalcError::UnknownSheet(id))
    }

    fn range(&self, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> Result<CellRange> {
        let s = self.sheet(sheet)?;
        if r0 > r1 || c0 > c1 || r1 > MAX_ROW || c1 > MAX_COL {
            return Err(CalcError::InvalidRange);
        }
        let range = CellRange::new(s, r0, c0, r1, c1);
        if u64::from(range.rows()) * u64::from(range.cols()) > MAX_PATCH_CELLS {
            return Err(CalcError::RangeTooLarge);
        }
        Ok(range)
    }

    // --- patch helpers ----------------------------------------------------

    /// Cell views of `coords`, grouped by sheet and sorted, skipping
    /// `skip_sheet`.
    fn cells_patch(
        &self,
        coords: impl IntoIterator<Item = CellCoord>,
        skip_sheet: Option<SheetId>,
    ) -> Vec<SheetCells> {
        let mut by_sheet: BTreeMap<u32, BTreeSet<(u32, u32)>> = BTreeMap::new();
        for c in coords {
            if Some(c.sheet) != skip_sheet {
                by_sheet
                    .entry(c.sheet.0)
                    .or_default()
                    .insert((c.row, c.col));
            }
        }
        by_sheet
            .into_iter()
            .map(|(sheet, cells)| SheetCells {
                sheet,
                cells: cells
                    .into_iter()
                    .map(|(r, c)| self.cell_view(CellCoord::new(SheetId(sheet), r, c)))
                    .collect(),
            })
            .collect()
    }

    fn cycle_text(&self, cycle: Option<&Cycle>) -> Option<String> {
        let cycle = cycle?;
        let names: Vec<String> = cycle
            .cells
            .iter()
            .chain(cycle.cells.first())
            .map(|c| {
                let sheet = self.workbook.engine().sheet_name(c.sheet).unwrap_or("?");
                format!("{sheet}!{}{}", col_letters(c.col), c.row + 1)
            })
            .collect();
        Some(format!("Circular reference: {}", names.join(" → ")))
    }

    fn content_patch(
        &self,
        edited: impl IntoIterator<Item = CellCoord>,
        recalc: &Recalc,
    ) -> CalcPatch {
        CalcPatch {
            cells: self.cells_patch(
                edited.into_iter().chain(recalc.changed.iter().copied()),
                None,
            ),
            cycle: self.cycle_text(recalc.cycle.as_ref()),
            ..Default::default()
        }
    }

    fn styles_if_grew(&self, before: usize) -> Option<Vec<model_sheet::CellStyle>> {
        (self.workbook.styles().len() != before).then(|| self.style_list())
    }

    /// Every formula cell: `(coord, text, own style)`.
    fn formulas(&self) -> Vec<(CellCoord, String, StyleId)> {
        let engine = self.workbook.engine();
        engine
            .sheets()
            .flat_map(|(s, _)| engine.cells(s))
            .filter_map(|(c, content)| match content {
                CellContent::Formula { text, .. } => {
                    Some((c, text.clone(), self.workbook.cell_style_id(c)))
                }
                _ => None,
            })
            .collect()
    }

    fn formula_values(&self) -> HashMap<CellCoord, Value> {
        self.formulas()
            .into_iter()
            .map(|(c, _, _)| (c, self.workbook.value(c)))
            .collect()
    }

    /// Patch for a sheet-list change: the sheet list plus every formula
    /// whose value differs from `before` (names re-resolve).
    fn sheets_patch(&self, before: &HashMap<CellCoord, Value>) -> CalcPatch {
        let changed = self
            .formula_values()
            .into_iter()
            .filter(|(c, v)| before.get(c) != Some(v))
            .map(|(c, _)| c);
        CalcPatch {
            sheets: Some(self.sheet_infos()),
            cells: self.cells_patch(changed, None),
            ..Default::default()
        }
    }

    // --- commands ---------------------------------------------------------

    fn apply_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        match cmd {
            &C::SetInput {
                sheet,
                row,
                col,
                ref input,
            } => {
                let c = CellCoord::new(self.sheet(sheet)?, row, col);
                let prev = content_to_input(self.workbook.content(c));
                let recalc = self.workbook.set_input(c, input)?;
                let inverse = if prev.is_empty() {
                    C::ClearRange {
                        sheet,
                        r0: row,
                        c0: col,
                        r1: row,
                        c1: col,
                    }
                } else {
                    C::SetInput {
                        sheet,
                        row,
                        col,
                        input: prev,
                    }
                };
                Ok(Applied {
                    patch: self.content_patch([c], &recalc),
                    inverse: Some(inverse),
                })
            }
            &C::ClearRange {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let range = self.range(sheet, r0, c0, r1, c1)?;
                let cleared: Vec<(CellCoord, String, StyleId)> = self
                    .workbook
                    .cells_in(range)
                    .filter(|(_, content, _)| !matches!(content, CellContent::Empty))
                    .map(|(c, content, style)| (c, content_to_input(content), style))
                    .collect();
                self.workbook.begin_batch();
                let cleared_ok = cleared
                    .iter()
                    .try_for_each(|(c, _, _)| self.workbook.clear(*c).map(drop));
                let recalc = self.workbook.end_batch();
                cleared_ok?;
                let patch = self.content_patch(cleared.iter().map(|x| x.0), &recalc);
                let cells = cleared
                    .into_iter()
                    .map(|(c, input, style)| (c.row, c.col, input, style.0))
                    .collect();
                Ok(Applied {
                    patch,
                    inverse: Some(C::RestoreCells { sheet, cells }),
                })
            }
            C::RestoreCells { sheet, cells } => self.restore_cells(*sheet, cells),
            &C::ApplyStyle {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ref patch,
            } => {
                let range = self.range(sheet, r0, c0, r1, c1)?;
                let before = self.workbook.styles().len();
                let own: HashMap<(u32, u32), StyleId> = self
                    .workbook
                    .cells_in(range)
                    .map(|(c, _, style)| ((c.row, c.col), style))
                    .collect();
                let changed = self.workbook.apply_style_patch(range, patch)?;
                let cells = changed
                    .iter()
                    .map(|c| {
                        let old = own.get(&(c.row, c.col)).copied().unwrap_or_default();
                        (c.row, c.col, old.0)
                    })
                    .collect();
                Ok(Applied {
                    patch: CalcPatch {
                        cells: self.cells_patch(changed, None),
                        styles: self.styles_if_grew(before),
                        ..Default::default()
                    },
                    inverse: Some(C::RestoreStyles { sheet, cells }),
                })
            }
            C::RestoreStyles { sheet, cells } => {
                let s = self.sheet(*sheet)?;
                for &(row, col, style) in cells {
                    if row > MAX_ROW || col > MAX_COL {
                        return Err(EngineError::InvalidCoord.into());
                    }
                    if !self.workbook.styles().contains(StyleId(style)) {
                        return Err(model_sheet::Error::UnknownStyle(StyleId(style)).into());
                    }
                }
                let mut prev = Vec::with_capacity(cells.len());
                for &(row, col, style) in cells {
                    let c = CellCoord::new(s, row, col);
                    prev.push((row, col, self.workbook.cell_style_id(c).0));
                    self.workbook.set_style(c, StyleId(style))?;
                }
                let coords = cells.iter().map(|&(r, c, _)| CellCoord::new(s, r, c));
                Ok(Applied {
                    patch: CalcPatch {
                        cells: self.cells_patch(coords, None),
                        ..Default::default()
                    },
                    inverse: Some(C::RestoreStyles {
                        sheet: *sheet,
                        cells: prev,
                    }),
                })
            }
            &C::SetColWidth { sheet, col, width } => {
                let info = ColInfo {
                    width,
                    ..self.workbook.col_info(self.sheet(sheet)?, col)
                };
                self.restore_cols(sheet, &[col_view(col, info)])
            }
            &C::SetColHidden { sheet, col, hidden } => {
                let info = ColInfo {
                    hidden,
                    ..self.workbook.col_info(self.sheet(sheet)?, col)
                };
                self.restore_cols(sheet, &[col_view(col, info)])
            }
            &C::SetRowHeight { sheet, row, height } => {
                let info = RowInfo {
                    height,
                    ..self.workbook.row_info(self.sheet(sheet)?, row)
                };
                self.restore_rows(sheet, &[row_view(row, info)])
            }
            &C::SetRowHidden { sheet, row, hidden } => {
                let info = RowInfo {
                    hidden,
                    ..self.workbook.row_info(self.sheet(sheet)?, row)
                };
                self.restore_rows(sheet, &[row_view(row, info)])
            }
            C::RestoreCols { sheet, cols } => self.restore_cols(*sheet, cols),
            C::RestoreRows { sheet, rows } => self.restore_rows(*sheet, rows),
            &C::InsertRows { sheet, at, count } => {
                self.structural(sheet, StructuralOp::InsertRows { at, count })
            }
            &C::DeleteRows { sheet, at, count } => {
                self.structural(sheet, StructuralOp::DeleteRows { at, count })
            }
            &C::InsertCols { sheet, at, count } => {
                self.structural(sheet, StructuralOp::InsertCols { at, count })
            }
            &C::DeleteCols { sheet, at, count } => {
                self.structural(sheet, StructuralOp::DeleteCols { at, count })
            }
            C::AddSheet { name } => {
                let before = self.formula_values();
                self.workbook.add_sheet(name)?;
                Ok(Applied {
                    patch: self.sheets_patch(&before),
                    inverse: None,
                })
            }
            C::RenameSheet { sheet, name } => {
                let s = self.sheet(*sheet)?;
                let before = self.formula_values();
                let old = self
                    .workbook
                    .engine()
                    .sheet_name(s)
                    .unwrap_or_default()
                    .to_string();
                self.workbook.rename_sheet(s, name)?;
                Ok(Applied {
                    patch: self.sheets_patch(&before),
                    inverse: Some(C::RenameSheet {
                        sheet: *sheet,
                        name: old,
                    }),
                })
            }
            C::Compound { commands } => {
                let mut patch = CalcPatch::default();
                let mut inverses = Vec::with_capacity(commands.len());
                for cmd in commands {
                    match self.apply_cmd(cmd) {
                        Ok(applied) => {
                            patch.merge(applied.patch);
                            inverses.push(applied.inverse);
                        }
                        Err(e) => {
                            // Roll back what was applied (best effort).
                            for inv in inverses.into_iter().rev().flatten() {
                                let _ = self.apply_cmd(&inv);
                            }
                            return Err(e);
                        }
                    }
                }
                let inverse = inverses
                    .into_iter()
                    .rev()
                    .collect::<Option<Vec<_>>>()
                    .map(|commands| C::Compound { commands });
                Ok(Applied { patch, inverse })
            }
        }
    }

    /// Sets `(row, col, input, style)` per cell in one batch; on failure
    /// every listed cell is put back.
    fn restore_cells(
        &mut self,
        sheet: u32,
        cells: &[(u32, u32, String, u32)],
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let wb = &mut self.workbook;
        let prev: Vec<(u32, u32, String, u32)> = cells
            .iter()
            .map(|(row, col, _, _)| {
                let c = CellCoord::new(s, *row, *col);
                (
                    *row,
                    *col,
                    content_to_input(wb.content(c)),
                    wb.cell_style_id(c).0,
                )
            })
            .collect();
        let set = |wb: &mut Workbook, list: &[(u32, u32, String, u32)]| {
            list.iter().try_for_each(|(row, col, input, style)| {
                let c = CellCoord::new(s, *row, *col);
                wb.set_input(c, input)?;
                wb.set_style(c, StyleId(*style))
            })
        };
        wb.begin_batch();
        let result = set(wb, cells);
        if result.is_err() {
            let _ = set(wb, &prev);
        }
        let recalc = wb.end_batch();
        result?;
        let coords = cells.iter().map(|&(r, c, _, _)| CellCoord::new(s, r, c));
        Ok(Applied {
            patch: self.content_patch(coords, &recalc),
            inverse: Some(CalcCommand::RestoreCells { sheet, cells: prev }),
        })
    }

    /// Replaces column properties; on failure the previous ones are put
    /// back. The patch lists the columns.
    fn restore_cols(&mut self, sheet: u32, cols: &[ColView]) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let wb = &mut self.workbook;
        let prev: Vec<ColView> = cols
            .iter()
            .map(|v| col_view(v.col, wb.col_info(s, v.col)))
            .collect();
        let set = |wb: &mut Workbook, list: &[ColView]| {
            list.iter().try_for_each(|v| {
                let info = ColInfo {
                    width: v.width,
                    hidden: v.hidden,
                    style: v.style.map(StyleId),
                };
                wb.set_col_info(s, v.col, info)
            })
        };
        if let Err(e) = set(wb, cols) {
            let _ = set(wb, &prev);
            return Err(e.into());
        }
        let cols = cols
            .iter()
            .map(|v| col_view(v.col, self.workbook.col_info(s, v.col)))
            .collect();
        Ok(Applied {
            patch: CalcPatch {
                cols: vec![SheetCols { sheet, cols }],
                ..Default::default()
            },
            inverse: Some(CalcCommand::RestoreCols { sheet, cols: prev }),
        })
    }

    /// Row counterpart of [`restore_cols`](Self::restore_cols).
    fn restore_rows(&mut self, sheet: u32, rows: &[RowView]) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let wb = &mut self.workbook;
        let prev: Vec<RowView> = rows
            .iter()
            .map(|v| row_view(v.row, wb.row_info(s, v.row)))
            .collect();
        let set = |wb: &mut Workbook, list: &[RowView]| {
            list.iter().try_for_each(|v| {
                let info = RowInfo {
                    height: v.height,
                    hidden: v.hidden,
                    style: v.style.map(StyleId),
                };
                wb.set_row_info(s, v.row, info)
            })
        };
        if let Err(e) = set(wb, rows) {
            let _ = set(wb, &prev);
            return Err(e.into());
        }
        let rows = rows
            .iter()
            .map(|v| row_view(v.row, self.workbook.row_info(s, v.row)))
            .collect();
        Ok(Applied {
            patch: CalcPatch {
                rows: vec![SheetRows { sheet, rows }],
                ..Default::default()
            },
            inverse: Some(CalcCommand::RestoreRows { sheet, rows: prev }),
        })
    }

    /// Row/column insert or delete.
    ///
    /// The inverse is the opposite operation, followed (for a delete) by
    /// restoring the deleted rows'/columns' properties, cells and styles,
    /// and (for both) by restoring the original text of every formula in
    /// the workbook that the operation rewrote: reference adjustment is
    /// not reversible in general (`#REF!`, ranges clipped at their end).
    /// Styles and dimensions pushed past the sheet end by an insert are
    /// not restored.
    fn structural(&mut self, sheet: u32, op: StructuralOp) -> Result<CalcApplied> {
        use CalcCommand as C;
        let s = self.sheet(sheet)?;
        let (at, count) = op.span();
        let formulas = self.formulas();
        let wb = &self.workbook;

        // What a delete destroys.
        let mut span_cells = Vec::new();
        let mut span_dims = None;
        if !op.is_insert() && count > 0 {
            let last = (u64::from(at) + u64::from(count) - 1).min(u64::from(op.max_index())) as u32;
            let span = if op.is_rows() {
                CellRange::new(s, at, 0, last, MAX_COL)
            } else {
                CellRange::new(s, 0, at, MAX_ROW, last)
            };
            span_cells = wb
                .cells_in(span)
                .map(|(c, content, style)| (c.row, c.col, content_to_input(content), style.0))
                .collect();
            let inside = |i: &u32| (at..=last).contains(i);
            span_dims = Some(if op.is_rows() {
                C::RestoreRows {
                    sheet,
                    rows: wb
                        .rows(s)
                        .filter(|(i, _)| inside(i))
                        .map(|(i, info)| row_view(i, info))
                        .collect(),
                }
            } else {
                C::RestoreCols {
                    sheet,
                    cols: wb
                        .cols(s)
                        .filter(|(i, _)| inside(i))
                        .map(|(i, info)| col_view(i, info))
                        .collect(),
                }
            });
        }

        let (kind, recalc, opposite) = match op {
            StructuralOp::InsertRows { .. } => (
                StructuralKind::InsertRows,
                self.workbook.insert_rows(s, at, count)?,
                C::DeleteRows { sheet, at, count },
            ),
            StructuralOp::DeleteRows { .. } => (
                StructuralKind::DeleteRows,
                self.workbook.delete_rows(s, at, count)?,
                C::InsertRows { sheet, at, count },
            ),
            StructuralOp::InsertCols { .. } => (
                StructuralKind::InsertCols,
                self.workbook.insert_cols(s, at, count)?,
                C::DeleteCols { sheet, at, count },
            ),
            StructuralOp::DeleteCols { .. } => (
                StructuralKind::DeleteCols,
                self.workbook.delete_cols(s, at, count)?,
                C::InsertCols { sheet, at, count },
            ),
        };

        // Formulas rewritten by the operation, at their original place.
        let mut rewritten: BTreeMap<u32, Vec<(u32, u32, String, u32)>> = BTreeMap::new();
        for (c, text, style) in formulas {
            let now = if c.sheet == s {
                op.map_cell(c.row, c.col)
            } else {
                Some((c.row, c.col))
            };
            let Some((row, col)) = now else {
                continue; // deleted: restored with the span
            };
            let current = self
                .workbook
                .formula_text(CellCoord::new(c.sheet, row, col));
            if current != Some(text.as_str()) {
                rewritten
                    .entry(c.sheet.0)
                    .or_default()
                    .push((c.row, c.col, text, style.0));
            }
        }

        let mut inverse = vec![opposite];
        if let Some(dims) = span_dims {
            let empty = match &dims {
                C::RestoreRows { rows, .. } => rows.is_empty(),
                C::RestoreCols { cols, .. } => cols.is_empty(),
                _ => true,
            };
            if !empty {
                inverse.push(dims);
            }
        }
        if !span_cells.is_empty() {
            inverse.push(C::RestoreCells {
                sheet,
                cells: span_cells,
            });
        }
        for (sheet, cells) in rewritten {
            inverse.push(C::RestoreCells { sheet, cells });
        }
        let inverse = if inverse.len() == 1 {
            inverse.pop()
        } else {
            Some(C::Compound { commands: inverse })
        };

        let structural = if count > 0 {
            vec![StructuralChange {
                sheet,
                kind,
                at,
                count,
            }]
        } else {
            Vec::new()
        };
        Ok(Applied {
            patch: CalcPatch {
                cells: self.cells_patch(recalc.changed.iter().copied(), Some(s)),
                cycle: self.cycle_text(recalc.cycle.as_ref()),
                structural,
                ..Default::default()
            },
            inverse,
        })
    }
}

impl Document for CalcDocument {
    type Command = CalcCommand;
    type Patch = CalcPatch;
    type Error = CalcError;

    fn apply(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        self.apply_cmd(cmd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_letters() {
        assert_eq!(col_letters(0), "A");
        assert_eq!(col_letters(25), "Z");
        assert_eq!(col_letters(26), "AA");
        assert_eq!(col_letters(701), "ZZ");
        assert_eq!(col_letters(702), "AAA");
        assert_eq!(col_letters(MAX_COL), "XFD");
    }

    #[test]
    fn suggested_names() {
        let named = |n: &str| CalcDocument {
            source_name: Some(n.into()),
            ..CalcDocument::new()
        };
        assert_eq!(CalcDocument::new().suggested_name(), "Untitled.xlsx");
        assert_eq!(named("a.xlsx").suggested_name(), "a.xlsx");
        assert_eq!(named("b.XLSX").suggested_name(), "b.XLSX");
        assert_eq!(named("c.xls").suggested_name(), "c.xlsx");
        assert_eq!(named("d").suggested_name(), "d.xlsx");
    }

    #[test]
    fn open_rejects_garbage() {
        let err = CalcDocument::open_xlsx(b"not a zip", "x.xlsx").unwrap_err();
        assert_eq!(err.code(), "invalid_file");
    }
}
