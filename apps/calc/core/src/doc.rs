//! [`CalcDocument`]: a [`Workbook`] behind the [`Document`] trait.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use app_common::{Applied, DispatchError, Document, Patch, Revision};
use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{CellContent, CellRect, Cycle, MoveContext, StructuralOp, Value};
use model_sheet::{
    content_to_input, CellCoord, CellRange, ColInfo, EngineError, Recalc, RowInfo, SheetId,
    StyleId, Workbook, MAX_PATCH_CELLS,
};

use crate::command::{CalcCommand, ClipCell, FillMode, PasteMode, Rect, SheetRect};
use crate::display::display_value;
use crate::fill::{move_input, plan, shift_input, FillItem};
use crate::patch::{
    CalcPatch, CellKind, CellView, ColView, FoundCell, RegionSnapshot, RowView, SheetCells,
    SheetCols, SheetInfo, SheetRows, StructuralChange, StructuralKind, WorkbookInfo,
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

/// What [`CalcDocument::write_cells`] stores in a cell.
enum WriteContent {
    /// User input (`""` clears).
    Input(String),
    /// A constant value.
    Value(Value),
}

/// One cell write: content and/or own style (`None` = unchanged).
struct Write {
    at: CellCoord,
    content: Option<WriteContent>,
    style: Option<StyleId>,
}
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
            &C::PasteRange {
                sheet,
                r0,
                c0,
                src,
                ref cells,
                mode,
                cut,
                repeat_rows,
                repeat_cols,
            } => self.paste_range(
                sheet,
                (r0, c0),
                src,
                cells,
                mode,
                cut,
                (repeat_rows, repeat_cols),
            ),
            &C::FillRange {
                sheet,
                src,
                dst,
                mode,
            } => self.fill_range(sheet, src, dst, mode),
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

    /// Writes `cells` (content and/or own style per coordinate) in one
    /// batch; returns the patch and the inverse (`RestoreCells` per
    /// sheet). On failure every written cell is put back.
    fn write_cells(&mut self, writes: Vec<Write>) -> Result<CalcApplied> {
        for w in &writes {
            if w.at.row > MAX_ROW || w.at.col > MAX_COL {
                return Err(EngineError::InvalidCoord.into());
            }
            if let Some(style) = w.style {
                if !self.workbook.styles().contains(style) {
                    return Err(model_sheet::Error::UnknownStyle(style).into());
                }
            }
        }
        let mut prev: BTreeMap<u32, Vec<(u32, u32, String, u32)>> = BTreeMap::new();
        let mut seen = BTreeSet::new();
        for w in &writes {
            if seen.insert(w.at) {
                prev.entry(w.at.sheet.0).or_default().push((
                    w.at.row,
                    w.at.col,
                    content_to_input(self.workbook.content(w.at)),
                    self.workbook.cell_style_id(w.at).0,
                ));
            }
        }
        let wb = &mut self.workbook;
        wb.begin_batch();
        let result = writes.iter().try_for_each(|w| {
            match &w.content {
                Some(WriteContent::Input(input)) => {
                    wb.set_input(w.at, input)?;
                }
                Some(WriteContent::Value(v)) => {
                    wb.set_content(w.at, CellContent::Value(v.clone()))?;
                }
                None => {}
            }
            if let Some(style) = w.style {
                wb.set_style(w.at, style)?;
            }
            Ok::<_, model_sheet::Error>(())
        });
        if result.is_err() {
            for (sheet, cells) in &prev {
                for (row, col, input, style) in cells {
                    let c = CellCoord::new(SheetId(*sheet), *row, *col);
                    let _ = wb.set_input(c, input);
                    let _ = wb.set_style(c, StyleId(*style));
                }
            }
        }
        let recalc = wb.end_batch();
        result?;
        let patch = self.content_patch(seen, &recalc);
        let mut inverses: Vec<CalcCommand> = prev
            .into_iter()
            .map(|(sheet, cells)| CalcCommand::RestoreCells { sheet, cells })
            .collect();
        let inverse = if inverses.len() == 1 {
            inverses.pop()
        } else {
            Some(CalcCommand::Compound { commands: inverses })
        };
        Ok(Applied { patch, inverse })
    }

    /// [`CalcCommand::PasteRange`] (its fields, unpacked).
    #[allow(clippy::too_many_arguments)]
    fn paste_range(
        &mut self,
        sheet: u32,
        (r0, c0): (u32, u32),
        src: SheetRect,
        cells: &[ClipCell],
        mode: PasteMode,
        cut: bool,
        (rep_rows, rep_cols): (u32, u32),
    ) -> Result<CalcApplied> {
        let source = self.range(src.sheet, src.r0, src.c0, src.r1, src.c1)?;
        let s = self.sheet(sheet)?;
        let (h, w) = (source.rows(), source.cols());
        if rep_rows == 0 || rep_cols == 0 || (cut && (rep_rows, rep_cols) != (1, 1)) {
            return Err(CalcError::InvalidRange);
        }
        let r1 = u64::from(r0) + u64::from(h) * u64::from(rep_rows) - 1;
        let c1 = u64::from(c0) + u64::from(w) * u64::from(rep_cols) - 1;
        if r1 > u64::from(MAX_ROW) || c1 > u64::from(MAX_COL) {
            return Err(CalcError::InvalidRange);
        }
        let dest = self.range(sheet, r0, c0, r1 as u32, c1 as u32)?;
        if cells.iter().any(|c| c.dr >= h || c.dc >= w) {
            return Err(CalcError::InvalidRange);
        }
        let s_src = source.sheet;
        let formulas = if cut { self.formulas() } else { Vec::new() };
        let wb = &self.workbook;
        let name = |id| wb.engine().sheet_name(id).unwrap_or_default().to_owned();
        let (src_name, dst_name) = (name(s_src), name(s));
        // A cut moves the cells: references to them (in the moved formulas
        // too) follow, as in Excel.
        let mv = MoveContext {
            host_sheet: &src_name,
            src_sheet: &src_name,
            dst_sheet: &dst_name,
            src: CellRect {
                r0: src.r0,
                c0: src.c0,
                r1: src.r1,
                c1: src.c1,
            },
            d_row: i64::from(r0) - i64::from(src.r0),
            d_col: i64::from(c0) - i64::from(src.c0),
            formula_moves: true,
        };
        let mut writes = Vec::new();
        let mut covered = BTreeSet::new();
        for ti in 0..rep_rows {
            for tj in 0..rep_cols {
                for clip in cells {
                    let at = CellCoord::new(s, r0 + ti * h + clip.dr, c0 + tj * w + clip.dc);
                    let from = CellCoord::new(s_src, src.r0 + clip.dr, src.c0 + clip.dc);
                    covered.insert((at.row, at.col));
                    let (dr, dc) = if cut {
                        (0, 0)
                    } else {
                        (
                            i64::from(at.row) - i64::from(from.row),
                            i64::from(at.col) - i64::from(from.col),
                        )
                    };
                    let style = clip.style.map(StyleId);
                    writes.push(match mode {
                        PasteMode::All => Write {
                            at,
                            content: Some(WriteContent::Input(if cut {
                                move_input(&clip.input, &mv).unwrap_or_else(|| clip.input.clone())
                            } else {
                                shift_input(&clip.input, dr, dc)
                            })),
                            style,
                        },
                        PasteMode::ValuesOnly => Write {
                            at,
                            content: Some(if clip.input.starts_with('=') {
                                WriteContent::Value(wb.value(from).into_scalar())
                            } else {
                                WriteContent::Input(clip.input.clone())
                            }),
                            style: None,
                        },
                        PasteMode::FormatsOnly => Write {
                            at,
                            content: None,
                            style,
                        },
                    });
                }
            }
        }
        // Block positions without a copied cell paste as blanks.
        let blank = |at: CellCoord| match mode {
            PasteMode::All => Write {
                at,
                content: Some(WriteContent::Input(String::new())),
                style: Some(StyleId::default()),
            },
            PasteMode::ValuesOnly => Write {
                at,
                content: Some(WriteContent::Input(String::new())),
                style: None,
            },
            PasteMode::FormatsOnly => Write {
                at,
                content: None,
                style: Some(StyleId::default()),
            },
        };
        let stale: Vec<CellCoord> = wb
            .cells_in(dest)
            .map(|(c, _, _)| c)
            .filter(|c| !covered.contains(&(c.row, c.col)))
            .collect();
        writes.extend(stale.into_iter().map(blank));
        if cut {
            let inside = |c: &CellCoord| {
                c.sheet == s
                    && (dest.r0..=dest.r1).contains(&c.row)
                    && (dest.c0..=dest.c1).contains(&c.col)
            };
            let vacated: Vec<CellCoord> = wb
                .cells_in(source)
                .map(|(c, _, _)| c)
                .filter(|c| !inside(c))
                .collect();
            // Cleared first: the block may overlap its source.
            let mut all: Vec<Write> = vacated
                .into_iter()
                .map(|at| Write {
                    at,
                    content: Some(WriteContent::Input(String::new())),
                    style: Some(StyleId::default()),
                })
                .collect();
            all.extend(writes);
            writes = all;
            // Formulas elsewhere (neither moved nor overwritten) that
            // reference the moved cells.
            for (c, text, _) in &formulas {
                if source.contains(*c) || dest.contains(*c) {
                    continue;
                }
                let host = name(c.sheet);
                let ctx = MoveContext {
                    host_sheet: &host,
                    formula_moves: false,
                    ..mv
                };
                if let Some(input) = move_input(text, &ctx) {
                    writes.push(Write {
                        at: *c,
                        content: Some(WriteContent::Input(input)),
                        style: None,
                    });
                }
            }
        }
        self.write_cells(writes)
    }

    /// [`CalcCommand::FillRange`].
    fn fill_range(
        &mut self,
        sheet: u32,
        src: Rect,
        dst: Rect,
        mode: FillMode,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        self.range(sheet, src.r0, src.c0, src.r1, src.c1)?;
        self.range(sheet, dst.r0, dst.c0, dst.r1, dst.c1)?;
        let vertical =
            src.c0 == dst.c0 && src.c1 == dst.c1 && (dst.r0 == src.r1 + 1 || dst.r1 + 1 == src.r0);
        let horizontal =
            src.r0 == dst.r0 && src.r1 == dst.r1 && (dst.c0 == src.c1 + 1 || dst.c1 + 1 == src.c0);
        if !vertical && !horizontal {
            return Err(CalcError::InvalidRange);
        }
        let wb = &self.workbook;
        // Lines run along the fill direction: columns when filling
        // vertically, rows when filling horizontally.
        let (lines, n, targets) = if vertical {
            (src.c0..=src.c1, src.r1 - src.r0 + 1, dst.r0..=dst.r1)
        } else {
            (src.r0..=src.r1, src.c1 - src.c0 + 1, dst.c0..=dst.c1)
        };
        let origin = if vertical { src.r0 } else { src.c0 };
        let at = |line: u32, pos: u32| {
            if vertical {
                CellCoord::new(s, pos, line)
            } else {
                CellCoord::new(s, line, pos)
            }
        };
        let mut writes = Vec::new();
        for line in lines {
            let sources: Vec<CellCoord> = (0..n).map(|p| at(line, origin + p)).collect();
            let items: Vec<FillItem> = sources
                .iter()
                .map(|&c| match wb.content(c) {
                    CellContent::Value(Value::Number(n)) => FillItem::Number {
                        n: *n,
                        date: wb
                            .style(c)
                            .number_format
                            .as_deref()
                            .is_some_and(model_sheet::numfmt::is_date_format),
                    },
                    CellContent::Value(Value::Text(t)) => FillItem::Text(t.clone()),
                    _ => FillItem::Other,
                })
                .collect();
            let plan = plan(&items, mode);
            for pos in targets.clone() {
                let k = i64::from(pos) - i64::from(origin);
                let p = k.rem_euclid(i64::from(n));
                let from = sources[p as usize];
                let content = match plan.value_at(k) {
                    Some(v) => WriteContent::Value(v),
                    None => {
                        let input = content_to_input(wb.content(from));
                        let d = k - p;
                        let (dr, dc) = if vertical { (d, 0) } else { (0, d) };
                        WriteContent::Input(shift_input(&input, dr, dc))
                    }
                };
                writes.push(Write {
                    at: at(line, pos),
                    content: Some(content),
                    style: Some(wb.style_id(from)),
                });
            }
        }
        self.write_cells(writes)
    }

    /// Cells whose input or displayed value contains `query` (or equals
    /// it with `whole_cell`), on `sheet` or on every sheet, in sheet
    /// order then row-major order. Only cells with content are searched.
    pub fn find_cells(
        &self,
        sheet: Option<u32>,
        query: &str,
        match_case: bool,
        whole_cell: bool,
    ) -> Result<Vec<FoundCell>> {
        let sheets: Vec<SheetId> = match sheet {
            Some(id) => vec![self.sheet(id)?],
            None => self
                .workbook
                .sheets()
                .into_iter()
                .map(|(id, _)| id)
                .collect(),
        };
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let fold = |t: &str| {
            if match_case {
                t.to_owned()
            } else {
                t.to_lowercase()
            }
        };
        let q = fold(query);
        let hit = |t: &str| {
            let t = fold(t);
            if whole_cell {
                t == q
            } else {
                t.contains(&q)
            }
        };
        let engine = self.workbook.engine();
        let mut found = Vec::new();
        for s in sheets {
            let mut cells: Vec<CellCoord> = engine.cells(s).map(|(c, _)| c).collect();
            cells.sort_by_key(|c| (c.row, c.col));
            for c in cells {
                let view = self.cell_view(c);
                if hit(&view.input) || hit(&view.display) {
                    found.push(FoundCell {
                        sheet: s.0,
                        row: c.row,
                        col: c.col,
                        input: view.input,
                        display: view.display,
                    });
                }
            }
        }
        Ok(found)
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
