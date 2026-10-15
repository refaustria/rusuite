//! The [`Workbook`]: an [`Engine`] for cell contents plus styles and
//! dimensions (ADR 0004).
//!
//! ```
//! use model_sheet::{CellStyle, Fill, Workbook};
//! use engine_formula::{CellCoord, RangeRef, Value};
//! use core_model::{Color, Rgb};
//!
//! let mut wb = Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! wb.set_input(CellCoord::new(s, 0, 0), "2").unwrap();
//! wb.set_input(CellCoord::new(s, 0, 1), "=A1*21").unwrap();
//! assert_eq!(wb.value(CellCoord::new(s, 0, 1)), Value::Number(42.0));
//!
//! let yellow = CellStyle {
//!     fill: Some(Fill::Solid(Color::Rgb(Rgb::new(255, 255, 0)))),
//!     ..Default::default()
//! };
//! let changed = wb.apply_style_patch(RangeRef::new(s, 0, 0, 0, 1), &yellow).unwrap();
//! assert_eq!(changed.len(), 2);
//! ```
//!
//! # Effective cell style
//!
//! [`Workbook::style_id`] resolves a cell's style like Excel: the cell's
//! own style if it has one, else the row style, else the column style,
//! else the default style. A cell styled with [`StyleId::DEFAULT`] has no
//! own style, so inside a styled row/column it shows that style.

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{
    CellContent, CellCoord, Engine, EngineError, Recalc, SheetId, StructuralOp, Value,
};

use crate::sheet::{ColInfo, RowInfo, SheetData, SheetFormat};
use crate::style::{CellStyle, StyleId, StyleTable};
use crate::{CellRange, Error};

/// Upper bound on the number of cells [`Workbook::apply_style_patch`]
/// touches (whole-row/column formatting belongs in [`ColInfo::style`] /
/// [`RowInfo::style`], not in per-cell entries).
pub const MAX_PATCH_CELLS: u64 = 1 << 22;

/// A Calc document. See the module docs.
pub struct Workbook {
    engine: Engine,
    /// Indexed by `SheetId.0`; extended lazily if sheets were added through
    /// [`Workbook::engine_mut`].
    sheets: Vec<SheetData>,
    styles: StyleTable,
}

impl Default for Workbook {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for Workbook {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Workbook")
            .field("sheets", &self.sheets())
            .field("styles", &self.styles.len())
            .finish_non_exhaustive()
    }
}

static DEFAULT_SHEET: std::sync::OnceLock<SheetData> = std::sync::OnceLock::new();

fn check_coord(c: CellCoord) -> Result<(), Error> {
    if c.row > MAX_ROW || c.col > MAX_COL {
        return Err(Error::Engine(EngineError::InvalidCoord));
    }
    Ok(())
}

fn check_dimension(v: Option<f64>) -> Result<(), Error> {
    match v {
        Some(x) if !x.is_finite() || x < 0.0 => Err(Error::InvalidDimension(x)),
        _ => Ok(()),
    }
}

impl Workbook {
    /// A workbook with one empty sheet `Sheet1`.
    pub fn new() -> Self {
        Workbook {
            engine: Engine::new(),
            sheets: vec![SheetData::default()],
            styles: StyleTable::new(),
        }
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// Direct engine access. Content edits made here are fine; styles and
    /// dimensions are not adjusted.
    pub fn engine_mut(&mut self) -> &mut Engine {
        &mut self.engine
    }

    // --- sheets -----------------------------------------------------------

    pub fn add_sheet(&mut self, name: &str) -> Result<SheetId, Error> {
        let id = self.engine.add_sheet(name)?;
        self.sheet_data_mut(id)?;
        Ok(id)
    }

    pub fn rename_sheet(&mut self, id: SheetId, new_name: &str) -> Result<(), Error> {
        self.engine.rename_sheet(id, new_name)?;
        Ok(())
    }

    /// All sheets in order.
    pub fn sheets(&self) -> Vec<(SheetId, String)> {
        self.engine
            .sheets()
            .map(|(id, name)| (id, name.to_string()))
            .collect()
    }

    /// Case-insensitive lookup.
    pub fn sheet_id(&self, name: &str) -> Option<SheetId> {
        self.engine.sheet_id(name)
    }

    fn sheet_data(&self, id: SheetId) -> &SheetData {
        self.sheets
            .get(id.0 as usize)
            .unwrap_or_else(|| DEFAULT_SHEET.get_or_init(SheetData::default))
    }

    fn sheet_data_mut(&mut self, id: SheetId) -> Result<&mut SheetData, Error> {
        if self.engine.sheet_name(id).is_none() {
            return Err(Error::UnknownSheet(id));
        }
        let idx = id.0 as usize;
        if self.sheets.len() <= idx {
            self.sheets.resize_with(idx + 1, SheetData::default);
        }
        Ok(&mut self.sheets[idx])
    }

    // --- contents (delegated to the engine) -------------------------------

    /// See [`Engine::set_input`].
    pub fn set_input(&mut self, c: CellCoord, input: &str) -> Result<Recalc, Error> {
        Ok(self.engine.set_input(c, input)?)
    }

    /// See [`Engine::set_content`].
    pub fn set_content(&mut self, c: CellCoord, content: CellContent) -> Result<Recalc, Error> {
        Ok(self.engine.set_content(c, content)?)
    }

    /// Clears the content of `c`; its style is kept ("clear contents").
    pub fn clear(&mut self, c: CellCoord) -> Result<Recalc, Error> {
        Ok(self.engine.clear(c)?)
    }

    pub fn content(&self, c: CellCoord) -> &CellContent {
        self.engine.content(c)
    }

    pub fn value(&self, c: CellCoord) -> Value {
        self.engine.value(c)
    }

    pub fn formula_text(&self, c: CellCoord) -> Option<&str> {
        self.engine.formula_text(c)
    }

    /// See [`Engine::begin_batch`].
    pub fn begin_batch(&mut self) {
        self.engine.begin_batch();
    }

    /// See [`Engine::end_batch`].
    pub fn end_batch(&mut self) -> Recalc {
        self.engine.end_batch()
    }

    pub fn recalc_all(&mut self) -> Recalc {
        self.engine.recalc_all()
    }

    // --- styles -----------------------------------------------------------

    /// The effective style of `c` (cell → row → column → default; see the
    /// module docs).
    pub fn style_id(&self, c: CellCoord) -> StyleId {
        let data = self.sheet_data(c.sheet);
        data.cell_styles
            .get(&(c.row, c.col))
            .copied()
            .or_else(|| data.rows.get(&c.row).and_then(|r| r.style))
            .or_else(|| data.cols.get(&c.col).and_then(|r| r.style))
            .unwrap_or_default()
    }

    /// The cell's own style (no row/column fallback).
    pub fn cell_style_id(&self, c: CellCoord) -> StyleId {
        self.sheet_data(c.sheet)
            .cell_styles
            .get(&(c.row, c.col))
            .copied()
            .unwrap_or_default()
    }

    /// The effective style of `c`.
    pub fn style(&self, c: CellCoord) -> &CellStyle {
        self.styles.get(self.style_id(c))
    }

    /// Sets the cell's own style.
    pub fn set_style(&mut self, c: CellCoord, id: StyleId) -> Result<(), Error> {
        check_coord(c)?;
        if !self.styles.contains(id) {
            return Err(Error::UnknownStyle(id));
        }
        self.sheet_data_mut(c.sheet)?
            .set_cell_style(c.row, c.col, id);
        Ok(())
    }

    /// Merges `patch` into the effective style of every cell of `range`
    /// and stores the result as the cell's own style. Returns the cells
    /// whose effective style changed, in row-major order.
    pub fn apply_style_patch(
        &mut self,
        range: CellRange,
        patch: &CellStyle,
    ) -> Result<Vec<CellCoord>, Error> {
        if range.r0 > range.r1 || range.c0 > range.c1 || range.r1 > MAX_ROW || range.c1 > MAX_COL {
            return Err(Error::InvalidRange);
        }
        if u64::from(range.rows()) * u64::from(range.cols()) > MAX_PATCH_CELLS {
            return Err(Error::RangeTooLarge);
        }
        self.sheet_data_mut(range.sheet)?;
        let mut changed = Vec::new();
        for row in range.r0..=range.r1 {
            for col in range.c0..=range.c1 {
                let c = CellCoord::new(range.sheet, row, col);
                let old = self.style_id(c);
                let new = self.styles.get(old).merged_with(patch);
                let new = self.styles.intern(&new);
                if new != old {
                    self.sheets[range.sheet.0 as usize].set_cell_style(row, col, new);
                    changed.push(c);
                }
            }
        }
        Ok(changed)
    }

    pub fn styles(&self) -> &StyleTable {
        &self.styles
    }

    pub fn intern_style(&mut self, style: &CellStyle) -> StyleId {
        self.styles.intern(style)
    }

    // --- dimensions -------------------------------------------------------

    /// Column `col` of `sheet` (default info when unset or unknown sheet).
    pub fn col_info(&self, sheet: SheetId, col: u32) -> ColInfo {
        self.sheet_data(sheet)
            .cols
            .get(&col)
            .copied()
            .unwrap_or_default()
    }

    /// Row `row` of `sheet` (default info when unset or unknown sheet).
    pub fn row_info(&self, sheet: SheetId, row: u32) -> RowInfo {
        self.sheet_data(sheet)
            .rows
            .get(&row)
            .copied()
            .unwrap_or_default()
    }

    /// Replaces all properties of a column (e.g. when loading a file).
    pub fn set_col_info(&mut self, sheet: SheetId, col: u32, info: ColInfo) -> Result<(), Error> {
        check_coord(CellCoord::new(sheet, 0, col))?;
        check_dimension(info.width)?;
        if let Some(id) = info.style.filter(|id| !self.styles.contains(*id)) {
            return Err(Error::UnknownStyle(id));
        }
        self.sheet_data_mut(sheet)?.set_col(col, info);
        Ok(())
    }

    /// Replaces all properties of a row (e.g. when loading a file).
    pub fn set_row_info(&mut self, sheet: SheetId, row: u32, info: RowInfo) -> Result<(), Error> {
        check_coord(CellCoord::new(sheet, row, 0))?;
        check_dimension(info.height)?;
        if let Some(id) = info.style.filter(|id| !self.styles.contains(*id)) {
            return Err(Error::UnknownStyle(id));
        }
        self.sheet_data_mut(sheet)?.set_row(row, info);
        Ok(())
    }

    /// Sets a column width in character units; `None` = sheet default.
    pub fn set_col_width(
        &mut self,
        sheet: SheetId,
        col: u32,
        width: Option<f64>,
    ) -> Result<(), Error> {
        let info = ColInfo {
            width,
            ..self.col_info(sheet, col)
        };
        self.set_col_info(sheet, col, info)
    }

    /// Sets a row height in points; `None` = sheet default.
    pub fn set_row_height(
        &mut self,
        sheet: SheetId,
        row: u32,
        height: Option<f64>,
    ) -> Result<(), Error> {
        let info = RowInfo {
            height,
            ..self.row_info(sheet, row)
        };
        self.set_row_info(sheet, row, info)
    }

    pub fn set_col_hidden(&mut self, sheet: SheetId, col: u32, hidden: bool) -> Result<(), Error> {
        let info = ColInfo {
            hidden,
            ..self.col_info(sheet, col)
        };
        self.set_col_info(sheet, col, info)
    }

    pub fn set_row_hidden(&mut self, sheet: SheetId, row: u32, hidden: bool) -> Result<(), Error> {
        let info = RowInfo {
            hidden,
            ..self.row_info(sheet, row)
        };
        self.set_row_info(sheet, row, info)
    }

    /// Non-default columns of `sheet`, ascending.
    pub fn cols(&self, sheet: SheetId) -> impl Iterator<Item = (u32, ColInfo)> + '_ {
        self.sheet_data(sheet).cols.iter().map(|(&i, &c)| (i, c))
    }

    /// Non-default rows of `sheet`, ascending.
    pub fn rows(&self, sheet: SheetId) -> impl Iterator<Item = (u32, RowInfo)> + '_ {
        self.sheet_data(sheet).rows.iter().map(|(&i, &r)| (i, r))
    }

    pub fn sheet_format(&self, sheet: SheetId) -> SheetFormat {
        self.sheet_data(sheet).format
    }

    pub fn set_sheet_format(&mut self, sheet: SheetId, format: SheetFormat) -> Result<(), Error> {
        check_dimension(Some(format.default_col_width))?;
        check_dimension(Some(format.default_row_height))?;
        self.sheet_data_mut(sheet)?.format = format;
        Ok(())
    }

    // --- structure --------------------------------------------------------

    /// Inserts `count` empty rows before row `at` of `sheet`: contents and
    /// formulas move via [`Engine::insert_rows`]; cell styles and row
    /// dimensions at or below `at` move down with them (the new rows get
    /// default dimensions; styles pushed past the last row are dropped).
    pub fn insert_rows(&mut self, sheet: SheetId, at: u32, count: u32) -> Result<Recalc, Error> {
        self.structural(sheet, StructuralOp::InsertRows { at, count })
    }

    /// Deletes rows `at..at + count` of `sheet` with their contents, cell
    /// styles and row dimensions; later rows move up. See
    /// [`Engine::delete_rows`].
    pub fn delete_rows(&mut self, sheet: SheetId, at: u32, count: u32) -> Result<Recalc, Error> {
        self.structural(sheet, StructuralOp::DeleteRows { at, count })
    }

    /// Inserts `count` empty columns before column `at`. See
    /// [`insert_rows`](Self::insert_rows).
    pub fn insert_cols(&mut self, sheet: SheetId, at: u32, count: u32) -> Result<Recalc, Error> {
        self.structural(sheet, StructuralOp::InsertCols { at, count })
    }

    /// Deletes columns `at..at + count`. See
    /// [`delete_rows`](Self::delete_rows).
    pub fn delete_cols(&mut self, sheet: SheetId, at: u32, count: u32) -> Result<Recalc, Error> {
        self.structural(sheet, StructuralOp::DeleteCols { at, count })
    }

    /// Runs `op` on the engine, then moves cell styles and the row/column
    /// dimension map of the affected axis with
    /// [`StructuralOp::map_cell`] / [`StructuralOp::map_index`] (entries
    /// mapped to `None` are dropped).
    fn structural(&mut self, sheet: SheetId, op: StructuralOp) -> Result<Recalc, Error> {
        let recalc = match op {
            StructuralOp::InsertRows { at, count } => self.engine.insert_rows(sheet, at, count),
            StructuralOp::DeleteRows { at, count } => self.engine.delete_rows(sheet, at, count),
            StructuralOp::InsertCols { at, count } => self.engine.insert_cols(sheet, at, count),
            StructuralOp::DeleteCols { at, count } => self.engine.delete_cols(sheet, at, count),
        }?;
        if op.span().1 == 0 {
            return Ok(recalc);
        }
        let data = self.sheet_data_mut(sheet)?;
        data.cell_styles = std::mem::take(&mut data.cell_styles)
            .into_iter()
            .filter_map(|((r, c), id)| op.map_cell(r, c).map(|p| (p, id)))
            .collect();
        fn shift<T>(op: StructuralOp, map: &mut std::collections::BTreeMap<u32, T>) {
            *map = std::mem::take(map)
                .into_iter()
                .filter_map(|(i, v)| op.map_index(i).map(|j| (j, v)))
                .collect();
        }
        if op.is_rows() {
            shift(op, &mut data.rows);
        } else {
            shift(op, &mut data.cols);
        }
        Ok(recalc)
    }

    // --- queries ----------------------------------------------------------

    /// `(max_row, max_col)` over non-empty contents (the engine's used
    /// range) and cells with an own non-default style. Column/row
    /// dimension entries (widths, hidden flags, row/column styles) do not
    /// extend it. `None` for an empty or unknown sheet. Costs O(styled
    /// cells) per call.
    pub fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
        self.sheet_data(sheet)
            .cell_styles
            .keys()
            .copied()
            .chain(self.engine.used_range(sheet))
            .reduce(|(r, c), (r2, c2)| (r.max(r2), c.max(c2)))
    }

    /// The cells of `range` that have content or an own non-default style,
    /// in row-major order, with their own style id (see
    /// [`cell_style_id`](Self::cell_style_id)).
    ///
    /// The range is clipped to [`used_range`](Self::used_range) and then
    /// scanned cell by cell: the engine exposes no cell iterator, so the
    /// cost is O(clipped area).
    pub fn cells_in(
        &self,
        range: CellRange,
    ) -> impl Iterator<Item = (CellCoord, &CellContent, StyleId)> + '_ {
        let bounds = self.used_range(range.sheet).and_then(|(mr, mc)| {
            let (r1, c1) = (range.r1.min(mr), range.c1.min(mc));
            (range.r0 <= r1 && range.c0 <= c1).then_some((range.r0, range.c0, r1, c1))
        });
        let data = self.sheet_data(range.sheet);
        bounds
            .into_iter()
            .flat_map(|(r0, c0, r1, c1)| {
                (r0..=r1).flat_map(move |row| (c0..=c1).map(move |col| (row, col)))
            })
            .filter_map(move |(row, col)| {
                let c = CellCoord::new(range.sheet, row, col);
                let content = self.engine.content(c);
                let style = data
                    .cell_styles
                    .get(&(row, col))
                    .copied()
                    .unwrap_or_default();
                (!matches!(content, CellContent::Empty) || !style.is_default())
                    .then_some((c, content, style))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style::Fill;
    use core_model::{Color, Rgb};

    fn styled(wb: &mut Workbook, r: u8) -> StyleId {
        wb.intern_style(&CellStyle {
            fill: Some(Fill::Solid(Color::Rgb(Rgb::new(r, 0, 0)))),
            ..Default::default()
        })
    }

    #[test]
    fn insert_and_delete_rows_move_styles_and_heights() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, c| CellCoord::new(s, r, c);
        let (a, b) = (styled(&mut wb, 1), styled(&mut wb, 2));
        wb.set_input(c(0, 0), "1").unwrap();
        wb.set_input(c(2, 0), "2").unwrap();
        wb.set_input(c(3, 1), "=A1+A3").unwrap();
        wb.set_style(c(0, 0), a).unwrap();
        wb.set_style(c(2, 0), b).unwrap();
        wb.set_row_height(s, 0, Some(20.0)).unwrap();
        wb.set_row_height(s, 2, Some(30.0)).unwrap();
        wb.set_col_width(s, 1, Some(12.0)).unwrap();

        wb.insert_rows(s, 1, 2).unwrap();
        assert_eq!(wb.cell_style_id(c(0, 0)), a);
        assert_eq!(wb.cell_style_id(c(4, 0)), b);
        assert_eq!(wb.cell_style_id(c(2, 0)), StyleId::DEFAULT);
        assert_eq!(wb.row_info(s, 0).height, Some(20.0));
        assert_eq!(wb.row_info(s, 1).height, None);
        assert_eq!(wb.row_info(s, 2).height, None);
        assert_eq!(wb.row_info(s, 4).height, Some(30.0));
        assert_eq!(wb.col_info(s, 1).width, Some(12.0));
        assert_eq!(wb.formula_text(c(5, 1)), Some("=A1+A5"));
        assert_eq!(wb.value(c(5, 1)), Value::Number(3.0));

        // Delete rows 0..=1: row 0 (style a, height 20) vanishes.
        wb.delete_rows(s, 0, 2).unwrap();
        assert_eq!(wb.cell_style_id(c(2, 0)), b);
        assert!(wb.cells_in(CellRange::new(s, 0, 0, 1, 5)).next().is_none());
        assert_eq!(wb.rows(s).collect::<Vec<_>>().len(), 1);
        assert_eq!(wb.row_info(s, 2).height, Some(30.0));
        assert_eq!(wb.formula_text(c(3, 1)), Some("=#REF!+A3"));
        assert_eq!(
            wb.value(c(3, 1)),
            Value::Error(engine_formula::ErrorKind::Ref)
        );
    }

    #[test]
    fn insert_and_delete_cols_move_styles_and_widths() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, c| CellCoord::new(s, r, c);
        let a = styled(&mut wb, 1);
        wb.set_input(c(0, 1), "5").unwrap();
        wb.set_input(c(1, 0), "=B1*2").unwrap();
        wb.set_style(c(0, 1), a).unwrap();
        wb.set_style(c(5, 3), a).unwrap();
        wb.set_col_width(s, 1, Some(20.0)).unwrap();
        wb.set_col_hidden(s, 3, true).unwrap();
        wb.set_row_height(s, 0, Some(9.0)).unwrap();

        wb.insert_cols(s, 1, 1).unwrap();
        assert_eq!(wb.cell_style_id(c(0, 2)), a);
        assert_eq!(wb.cell_style_id(c(0, 1)), StyleId::DEFAULT);
        assert_eq!(wb.cell_style_id(c(5, 4)), a);
        assert_eq!(wb.col_info(s, 1), ColInfo::default());
        assert_eq!(wb.col_info(s, 2).width, Some(20.0));
        assert!(wb.col_info(s, 4).hidden);
        assert_eq!(wb.row_info(s, 0).height, Some(9.0));
        assert_eq!(wb.formula_text(c(1, 0)), Some("=C1*2"));

        wb.delete_cols(s, 2, 1).unwrap();
        assert_eq!(wb.cell_style_id(c(0, 2)), StyleId::DEFAULT);
        assert_eq!(wb.cell_style_id(c(5, 3)), a);
        assert_eq!(wb.col_info(s, 2), ColInfo::default());
        assert!(wb.col_info(s, 3).hidden);
        assert_eq!(
            wb.value(c(1, 0)),
            Value::Error(engine_formula::ErrorKind::Ref)
        );
        assert_eq!(wb.used_range(s), Some((5, 3)));
    }

    #[test]
    fn structural_errors_leave_styles_alone() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let a = styled(&mut wb, 1);
        wb.set_style(CellCoord::new(s, 3, 0), a).unwrap();
        assert!(wb.insert_rows(SheetId(7), 0, 1).is_err());
        assert!(wb.delete_rows(s, MAX_ROW, 2).is_err());
        wb.insert_rows(s, 0, 0).unwrap();
        assert_eq!(wb.cell_style_id(CellCoord::new(s, 3, 0)), a);
    }
}
