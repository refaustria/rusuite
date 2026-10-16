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
//!
//! # Merged cells
//!
//! Each sheet keeps a list of pairwise disjoint [`MergeRect`]s of at least
//! two cells. [`Workbook::merge_cells`] follows Excel: only the top-left
//! cell keeps its content, the other cells' contents are cleared (their
//! styles stay). Row/column inserts and deletes move, grow and clip the
//! merges like references ([`StructuralOp::map_interval`]); a merge clipped
//! to one cell disappears. The frozen row/column counts of the
//! [`SheetView`] follow the same rule.

use core_model::Color;
use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{
    CellContent, CellCoord, CellShift, Engine, EngineError, Recalc, RowHidden, SheetId,
    StructuralOp, Value,
};

use crate::sheet::{
    ColInfo, MergeRect, RowInfo, SheetData, SheetFormat, SheetView, MAX_ZOOM, MIN_ZOOM,
};
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
    /// Comment, hidden flag and built-in kind of the defined names (the
    /// definitions live in the engine).
    pub(crate) name_meta: std::collections::HashMap<crate::names::NameKey, crate::names::NameMeta>,
    /// Authors of threaded comments (`personList`).
    pub(crate) persons: Vec<crate::annotations::Person>,
    /// Pivot caches (the tables live on the sheets).
    pub(crate) pivot_caches: Vec<crate::pivot::PivotCache>,
    /// While recording: the previous content and own style of every cell
    /// a pivot table operation wrote (see [`Workbook::start_pivot_journal`]).
    pub(crate) pivot_journal: Option<crate::pivot::PivotJournal>,
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
            name_meta: std::collections::HashMap::new(),
            persons: Vec::new(),
            pivot_caches: Vec::new(),
            pivot_journal: None,
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

    /// Renames a sheet; returns the formula cells whose text was rewritten
    /// (see [`Engine::rename_sheet`]).
    pub fn rename_sheet(&mut self, id: SheetId, new_name: &str) -> Result<Vec<CellCoord>, Error> {
        let old = self.engine.sheet_name(id).map(str::to_owned);
        let rewritten = self.engine.rename_sheet(id, new_name)?;
        if let Some(old) = old.filter(|o| o != new_name) {
            self.rename_chart_refs(None, &old, new_name);
            self.rename_pivot_sources(&old, new_name);
        }
        Ok(rewritten)
    }

    /// Deletes a sheet with its contents, styles and dimensions; references
    /// to it in the other sheets become `#REF!`. See [`Engine::remove_sheet`].
    /// Fails with [`Error::LastVisibleSheet`] for the only visible sheet
    /// of a workbook that has hidden ones.
    pub fn remove_sheet(&mut self, id: SheetId) -> Result<Recalc, Error> {
        if self.engine.sheet_name(id).is_some()
            && self.engine.sheets().count() > 1
            && !self.is_sheet_hidden(id)
            && !self.has_other_visible_sheet(id)
        {
            return Err(Error::LastVisibleSheet);
        }
        let recalc = self.engine.remove_sheet(id)?;
        if let Some(data) = self.sheets.get_mut(id.0 as usize) {
            *data = SheetData::default();
        }
        self.drop_pivot_engine(id);
        self.sync_name_meta(None);
        let tables = self.sync_tables();
        let mut recalc = recalc;
        recalc.changed.extend(tables.changed);
        Ok(recalc)
    }

    /// Brings back a removed sheet, empty and with default dimensions, at
    /// position `index` (undo of [`remove_sheet`](Self::remove_sheet)).
    /// See [`Engine::restore_sheet`].
    pub fn restore_sheet(&mut self, id: SheetId, name: &str, index: usize) -> Result<(), Error> {
        self.engine.restore_sheet(id, name, index)?;
        *self.sheet_data_mut(id)? = SheetData::default();
        Ok(())
    }

    /// Moves a sheet to position `index` of the sheet order.
    pub fn move_sheet(&mut self, id: SheetId, index: usize) -> Result<(), Error> {
        Ok(self.engine.move_sheet(id, index)?)
    }

    /// Position of a sheet in the sheet order (`None`: unknown or removed).
    pub fn sheet_position(&self, id: SheetId) -> Option<usize> {
        self.engine.sheet_position(id)
    }

    /// Copies a sheet (contents, formulas, cell styles, dimensions, sheet
    /// format, tab colour, view, merges, charts, notes, threads and
    /// hyperlinks) to a new, visible
    /// sheet `name` right after it. See [`Engine::duplicate_sheet`]. The
    /// copied charts' references to the source sheet point at the copy
    /// (as in Excel).
    pub fn duplicate_sheet(&mut self, id: SheetId, name: &str) -> Result<(SheetId, Recalc), Error> {
        let source = self.engine.sheet_name(id).map(str::to_owned);
        let (new, recalc) = self.engine.duplicate_sheet(id, name)?;
        let mut data = self.sheet_data(id).clone();
        data.hidden = false;
        data.very_hidden = false;
        *self.sheet_data_mut(new)? = data;
        if let Some(source) = source {
            self.rename_chart_refs(Some(new), &source, name);
        }
        self.sync_name_meta(Some((id, new)));
        self.renew_thread_ids(new);
        self.renew_pivot_ids(new);
        self.copy_tables(id, new);
        Ok((new, recalc))
    }

    /// Colour of the sheet tab (`None` = default).
    pub fn tab_color(&self, id: SheetId) -> Option<Color> {
        self.sheet_data(id).tab_color
    }

    pub fn set_tab_color(&mut self, id: SheetId, color: Option<Color>) -> Result<(), Error> {
        self.sheet_data_mut(id)?.tab_color = color;
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

    pub(crate) fn sheet_data(&self, id: SheetId) -> &SheetData {
        self.sheets
            .get(id.0 as usize)
            .unwrap_or_else(|| DEFAULT_SHEET.get_or_init(SheetData::default))
    }

    pub(crate) fn sheet_data_mut(&mut self, id: SheetId) -> Result<&mut SheetData, Error> {
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
    /// `filtered` without `hidden` is dropped. The engine learns the row's
    /// visibility; the returned recalculation lists the `SUBTOTAL`s that
    /// changed (empty inside a batch).
    pub fn set_row_info(
        &mut self,
        sheet: SheetId,
        row: u32,
        info: RowInfo,
    ) -> Result<Recalc, Error> {
        check_coord(CellCoord::new(sheet, row, 0))?;
        check_dimension(info.height)?;
        if let Some(id) = info.style.filter(|id| !self.styles.contains(*id)) {
            return Err(Error::UnknownStyle(id));
        }
        let info = RowInfo {
            filtered: info.filtered && info.hidden,
            ..info
        };
        self.sheet_data_mut(sheet)?.set_row(row, info);
        let state = match (info.hidden, info.filtered) {
            (false, _) => RowHidden::Visible,
            (true, false) => RowHidden::Manual,
            (true, true) => RowHidden::Filtered,
        };
        Ok(self.engine.set_row_hidden(sheet, row, state)?)
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
        self.set_row_info(sheet, row, info).map(drop)
    }

    pub fn set_col_hidden(&mut self, sheet: SheetId, col: u32, hidden: bool) -> Result<(), Error> {
        let info = ColInfo {
            hidden,
            ..self.col_info(sheet, col)
        };
        self.set_col_info(sheet, col, info)
    }

    /// Hides or shows a row by hand (clears `filtered`). See
    /// [`set_row_info`](Self::set_row_info) for the result.
    pub fn set_row_hidden(
        &mut self,
        sheet: SheetId,
        row: u32,
        hidden: bool,
    ) -> Result<Recalc, Error> {
        let info = RowInfo {
            hidden,
            filtered: false,
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

    // --- view and visibility ---------------------------------------------

    /// Frozen panes, zoom, gridlines and headings of `sheet`.
    pub fn sheet_view(&self, sheet: SheetId) -> SheetView {
        self.sheet_data(sheet).view
    }

    /// Replaces the view of `sheet`. The zoom must lie in
    /// [`MIN_ZOOM`]..=[`MAX_ZOOM`], the frozen counts inside the sheet.
    pub fn set_sheet_view(&mut self, sheet: SheetId, view: SheetView) -> Result<(), Error> {
        if !(MIN_ZOOM..=MAX_ZOOM).contains(&view.zoom) {
            return Err(Error::InvalidSheetView(format!("zoom {}", view.zoom)));
        }
        if view.frozen_rows > MAX_ROW || view.frozen_cols > MAX_COL {
            return Err(Error::InvalidSheetView(
                "frozen panes outside the sheet".into(),
            ));
        }
        self.sheet_data_mut(sheet)?.view = view;
        Ok(())
    }

    /// Freezes rows `0..rows` and columns `0..cols` (`0, 0` unfreezes).
    pub fn set_frozen(&mut self, sheet: SheetId, rows: u32, cols: u32) -> Result<(), Error> {
        let view = SheetView {
            frozen_rows: rows,
            frozen_cols: cols,
            ..self.sheet_view(sheet)
        };
        self.set_sheet_view(sheet, view)
    }

    /// Hidden or very hidden.
    pub fn is_sheet_hidden(&self, sheet: SheetId) -> bool {
        self.sheet_data(sheet).hidden
    }

    /// Excel's `veryHidden` state.
    pub fn is_sheet_very_hidden(&self, sheet: SheetId) -> bool {
        self.sheet_data(sheet).very_hidden
    }

    fn has_other_visible_sheet(&self, sheet: SheetId) -> bool {
        self.engine
            .sheets()
            .any(|(id, _)| id != sheet && !self.is_sheet_hidden(id))
    }

    /// Hides (`very_hidden`: very hides) or shows a sheet. Showing clears
    /// both flags; hiding the last visible sheet fails with
    /// [`Error::LastVisibleSheet`].
    pub fn set_sheet_visibility(
        &mut self,
        sheet: SheetId,
        hidden: bool,
        very_hidden: bool,
    ) -> Result<(), Error> {
        self.sheet_data_mut(sheet)?;
        if hidden && !self.is_sheet_hidden(sheet) && !self.has_other_visible_sheet(sheet) {
            return Err(Error::LastVisibleSheet);
        }
        let data = self.sheet_data_mut(sheet)?;
        data.hidden = hidden;
        data.very_hidden = hidden && very_hidden;
        Ok(())
    }

    /// [`set_sheet_visibility`](Self::set_sheet_visibility) without very
    /// hiding.
    pub fn set_sheet_hidden(&mut self, sheet: SheetId, hidden: bool) -> Result<(), Error> {
        self.set_sheet_visibility(sheet, hidden, false)
    }

    // --- merged cells -----------------------------------------------------

    /// The merged ranges of `sheet`, sorted by top-left cell.
    pub fn merges(&self, sheet: SheetId) -> &[MergeRect] {
        &self.sheet_data(sheet).merges
    }

    /// The merged range containing `c`, if any.
    pub fn merge_at(&self, c: CellCoord) -> Option<&MergeRect> {
        self.merges(c.sheet)
            .iter()
            .find(|m| m.contains(c.row, c.col))
    }

    fn check_merge(rect: &MergeRect) -> Result<(), Error> {
        if rect.r0 > rect.r1
            || rect.c0 > rect.c1
            || rect.r1 > MAX_ROW
            || rect.c1 > MAX_COL
            || rect.cells() < 2
        {
            return Err(Error::InvalidMerge);
        }
        Ok(())
    }

    /// Adds a merged range without touching contents (loading files).
    /// Fails with [`Error::InvalidMerge`] for a single cell or a range
    /// outside the sheet and with [`Error::MergeOverlap`] when it
    /// intersects an existing merge.
    pub fn add_merge(&mut self, sheet: SheetId, rect: MergeRect) -> Result<(), Error> {
        Self::check_merge(&rect)?;
        let data = self.sheet_data_mut(sheet)?;
        if data.merges.iter().any(|m| m.intersects(&rect)) {
            return Err(Error::MergeOverlap);
        }
        let at = data.merges.partition_point(|m| *m < rect);
        data.merges.insert(at, rect);
        Ok(())
    }

    /// Removes exactly `rect`; `false` if it was not merged.
    pub fn remove_merge(&mut self, sheet: SheetId, rect: MergeRect) -> Result<bool, Error> {
        let data = self.sheet_data_mut(sheet)?;
        let before = data.merges.len();
        data.merges.retain(|m| *m != rect);
        Ok(data.merges.len() != before)
    }

    /// Replaces all merges of `sheet` (validated like
    /// [`add_merge`](Self::add_merge); on error nothing changes).
    pub fn set_merges(&mut self, sheet: SheetId, merges: Vec<MergeRect>) -> Result<(), Error> {
        self.sheet_data_mut(sheet)?;
        let mut sorted = merges;
        sorted.sort_unstable();
        for (i, m) in sorted.iter().enumerate() {
            Self::check_merge(m)?;
            // Sorted by r0: only later ranges starting at or above m.r1 can
            // intersect.
            if sorted[i + 1..]
                .iter()
                .take_while(|n| n.r0 <= m.r1)
                .any(|n| n.intersects(m))
            {
                return Err(Error::MergeOverlap);
            }
        }
        self.sheet_data_mut(sheet)?.merges = sorted;
        Ok(())
    }

    /// Merges `range` (Excel's "Merge Cells"): every cell but the top-left
    /// one loses its content (styles are kept); merges lying completely
    /// inside `range` are absorbed. Fails with [`Error::MergeOverlap`]
    /// when an existing merge sticks out of `range`.
    pub fn merge_cells(&mut self, range: CellRange) -> Result<Recalc, Error> {
        let rect = MergeRect::new(range.r0, range.c0, range.r1, range.c1);
        Self::check_merge(&rect)?;
        let sheet = range.sheet;
        let data = self.sheet_data_mut(sheet)?;
        if data
            .merges
            .iter()
            .any(|m| m.intersects(&rect) && !rect.covers(m))
        {
            return Err(Error::MergeOverlap);
        }
        let cleared: Vec<CellCoord> = self
            .cells_in(range)
            .filter(|(c, content, _)| {
                !matches!(content, CellContent::Empty) && (c.row, c.col) != (rect.r0, rect.c0)
            })
            .map(|(c, _, _)| c)
            .collect();
        self.engine.begin_batch();
        let result = cleared
            .iter()
            .try_for_each(|c| self.engine.clear(*c).map(drop));
        let recalc = self.engine.end_batch();
        result?;
        let data = self.sheet_data_mut(sheet)?;
        data.merges.retain(|m| !rect.covers(m));
        let at = data.merges.partition_point(|m| *m < rect);
        data.merges.insert(at, rect);
        Ok(recalc)
    }

    /// Removes every merge that intersects `range` (Excel's "Unmerge
    /// Cells"); returns the removed merges.
    pub fn unmerge_cells(&mut self, range: CellRange) -> Result<Vec<MergeRect>, Error> {
        let rect = MergeRect::new(range.r0, range.c0, range.r1, range.c1);
        let data = self.sheet_data_mut(range.sheet)?;
        let (removed, kept) = std::mem::take(&mut data.merges)
            .into_iter()
            .partition(|m| m.intersects(&rect));
        data.merges = kept;
        Ok(removed)
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

    /// Excel's Insert / Delete Cells with a shift: `op` restricted to the
    /// band `lo..=hi` of the other axis ([`CellShift`]; `InsertCols` =
    /// "shift cells right" for rows `lo..=hi`, `DeleteRows` = "shift cells
    /// up" for columns `lo..=hi`, …). Contents, formulas
    /// ([`engine_formula::adjust_references_shift`]), cell styles, merges
    /// lying inside the band, notes, threads, hyperlinks, rule ranges and
    /// formulas and chart references follow; dimensions, frozen panes,
    /// charts' and pictures' positions stay. Refused like Excel when the
    /// edit would cut a merge ([`Error::ShiftMerged`]) or shift cells of a
    /// table or the AutoFilter range ([`Error::ShiftTable`]) or of a pivot
    /// table ([`Error::PivotCell`]).
    pub fn shift_cells(
        &mut self,
        sheet: SheetId,
        op: StructuralOp,
        lo: u32,
        hi: u32,
    ) -> Result<Recalc, Error> {
        let shift = CellShift::new(op, lo, hi);
        let data = self.sheet_data(sheet);
        if data
            .merges
            .iter()
            .any(|m| shift.splits((m.r0, m.c0, m.r1, m.c1)))
        {
            return Err(Error::ShiftMerged);
        }
        let filtered = data
            .auto_filter
            .as_ref()
            .is_some_and(|af| shift.touches((af.r0, af.c0, af.r1, af.c1)));
        let in_table = self
            .tables(sheet)
            .iter()
            .any(|t| shift.touches((t.r0, t.c0, t.r1, t.c1)));
        if filtered || in_table {
            return Err(Error::ShiftTable);
        }
        let (at, _) = op.span();
        let (lo, hi) = (lo.min(hi), lo.max(hi));
        let region = if op.is_rows() {
            CellRange::new(sheet, at, lo, MAX_ROW, hi)
        } else {
            CellRange::new(sheet, lo, at, hi, MAX_COL)
        };
        self.check_pivot_edit(region)?;
        let recalc = self.engine.shift_cells(sheet, op, lo, hi)?;
        if op.span().1 == 0 {
            return Ok(recalc);
        }
        let data = self.sheet_data_mut(sheet)?;
        let styles = std::mem::take(&mut data.cell_styles)
            .into_iter()
            .filter_map(|((r, c), id)| shift.map_cell(r, c).map(|p| (p, id)))
            .collect();
        data.replace_cell_styles(styles);
        data.merges = std::mem::take(&mut data.merges)
            .into_iter()
            .filter_map(|m| {
                let (r0, c0, r1, c1) = shift.map_rect((m.r0, m.c0, m.r1, m.c1))?;
                let m = MergeRect { r0, c0, r1, c1 };
                (m.cells() >= 2).then_some(m)
            })
            .collect();
        self.shift_rules(sheet, shift);
        self.shift_charts(sheet, shift);
        self.shift_annotations(sheet, shift);
        Ok(recalc)
    }

    /// Runs `op` on the engine, then moves cell styles and the row/column
    /// dimension map of the affected axis with
    /// [`StructuralOp::map_cell`] / [`StructuralOp::map_index`] (entries
    /// mapped to `None` are dropped), and maps merges and frozen panes with
    /// [`StructuralOp::map_interval`] (see the module docs).
    fn structural(&mut self, sheet: SheetId, op: StructuralOp) -> Result<Recalc, Error> {
        self.check_pivot_structural(sheet, op)?;
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
        let styles = std::mem::take(&mut data.cell_styles)
            .into_iter()
            .filter_map(|((r, c), id)| op.map_cell(r, c).map(|p| (p, id)))
            .collect();
        data.replace_cell_styles(styles);
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
        data.merges = std::mem::take(&mut data.merges)
            .into_iter()
            .filter_map(|m| {
                let m = if op.is_rows() {
                    let (r0, r1) = op.map_interval(m.r0, m.r1)?;
                    MergeRect { r0, r1, ..m }
                } else {
                    let (c0, c1) = op.map_interval(m.c0, m.c1)?;
                    MergeRect { c0, c1, ..m }
                };
                (m.cells() >= 2).then_some(m)
            })
            .collect();
        // The frozen area is the interval 0..frozen: an insert inside it
        // grows it, a delete clips it.
        let frozen = |n: u32| {
            if n == 0 {
                0
            } else {
                op.map_interval(0, n - 1)
                    .map_or(0, |(_, hi)| (hi + 1).min(op.max_index()))
            }
        };
        if op.is_rows() {
            data.view.frozen_rows = frozen(data.view.frozen_rows);
        } else {
            data.view.frozen_cols = frozen(data.view.frozen_cols);
        }
        // The AutoFilter and the sort state move like merges; filtered or
        // sort columns that are deleted disappear.
        let span = |r0: u32, c0: u32, r1: u32, c1: u32| {
            if op.is_rows() {
                op.map_interval(r0, r1).map(|(r0, r1)| (r0, c0, r1, c1))
            } else {
                op.map_interval(c0, c1).map(|(c0, c1)| (r0, c0, r1, c1))
            }
        };
        let col = |c: u32| {
            if op.is_rows() {
                Some(c)
            } else {
                op.map_index(c)
            }
        };
        data.auto_filter = data.auto_filter.take().and_then(|af| {
            let (r0, c0, r1, c1) = span(af.r0, af.c0, af.r1, af.c1)?;
            let columns = af
                .columns
                .into_iter()
                .filter_map(|fc| {
                    Some(crate::FilterColumn {
                        col: col(fc.col)?,
                        ..fc
                    })
                })
                .collect();
            Some(crate::AutoFilter {
                r0,
                c0,
                r1,
                c1,
                columns,
            })
        });
        data.sort_state = data.sort_state.take().and_then(|st| {
            let (r0, c0, r1, c1) = span(st.r0, st.c0, st.r1, st.c1)?;
            let keys: Vec<crate::SortKey> = st
                .keys
                .into_iter()
                .filter_map(|k| {
                    Some(crate::SortKey {
                        col: col(k.col)?,
                        ..k
                    })
                })
                .collect();
            (!keys.is_empty()).then_some(crate::SortState {
                r0,
                c0,
                r1,
                c1,
                keys,
                ..st
            })
        });
        self.shift_rules(sheet, op.into());
        self.shift_charts(sheet, op.into());
        self.shift_annotations(sheet, op.into());
        self.shift_pivots(sheet, op);
        self.shift_page_breaks(sheet, op);
        self.shift_pictures(sheet, op);
        let tables = self.shift_tables(sheet, op);
        let mut recalc = recalc;
        recalc.changed.extend(tables.changed);
        recalc.changed.sort_unstable();
        recalc.changed.dedup();
        Ok(recalc)
    }

    // --- queries ----------------------------------------------------------

    /// `(max_row, max_col)` over non-empty contents (the engine's used
    /// range) and cells with an own non-default style. Column/row
    /// dimension entries (widths, hidden flags, row/column styles) do not
    /// extend it. `None` for an empty or unknown sheet. O(log n): the
    /// styled bound is kept from per-row/column counts of styled cells.
    pub fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
        self.sheet_data(sheet)
            .styled_bound()
            .into_iter()
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

    #[test]
    fn sheet_operations_carry_styles_dims_and_tab_colour() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let red = Color::Rgb(Rgb::new(255, 0, 0));
        let a = styled(&mut wb, 1);
        let c = |s, r, col| CellCoord::new(s, r, col);
        wb.set_input(c(s, 0, 0), "4").unwrap();
        wb.set_input(c(s, 0, 1), "=A1*2").unwrap();
        wb.set_style(c(s, 0, 0), a).unwrap();
        wb.set_col_width(s, 1, Some(20.0)).unwrap();
        wb.set_row_height(s, 3, Some(30.0)).unwrap();
        wb.set_tab_color(s, Some(red)).unwrap();
        let other = wb.add_sheet("Other").unwrap();
        wb.set_input(c(other, 0, 0), "=Sheet1!B1").unwrap();

        let (copy, _) = wb.duplicate_sheet(s, "Copy").unwrap();
        let names: Vec<String> = wb.sheets().into_iter().map(|(_, n)| n).collect();
        assert_eq!(names, ["Sheet1", "Copy", "Other"]);
        assert_eq!(wb.cell_style_id(c(copy, 0, 0)), a);
        assert_eq!(wb.col_info(copy, 1).width, Some(20.0));
        assert_eq!(wb.row_info(copy, 3).height, Some(30.0));
        assert_eq!(wb.tab_color(copy), Some(red));
        assert_eq!(wb.value(c(copy, 0, 1)), Value::Number(8.0));

        wb.move_sheet(other, 0).unwrap();
        assert_eq!(wb.sheet_position(other), Some(0));
        wb.remove_sheet(s).unwrap();
        assert_eq!(wb.formula_text(c(other, 0, 0)), Some("=#REF!"));
        assert_eq!(wb.tab_color(s), None);
        assert_eq!(wb.cols(s).count(), 0);
        assert_eq!(wb.used_range(s), None);
        assert!(wb.set_tab_color(s, Some(red)).is_err());
        wb.restore_sheet(s, "Sheet1", 2).unwrap();
        assert_eq!(wb.sheet_position(s), Some(2));
        assert_eq!(wb.cell_style_id(c(s, 0, 0)), StyleId::DEFAULT);

        // Snapshots keep the order and the tab colour.
        wb.set_tab_color(copy, Some(red)).unwrap();
        let snap = wb.to_snapshot();
        let back = Workbook::from_snapshot(&snap).unwrap();
        assert_eq!(back.to_snapshot(), snap);
        let names: Vec<String> = back.sheets().into_iter().map(|(_, n)| n).collect();
        assert_eq!(names, ["Other", "Copy", "Sheet1"]);
        assert_eq!(back.tab_color(back.sheet_id("Copy").unwrap()), Some(red));
    }
    #[test]
    fn merge_cells_keeps_top_left_content_and_styles() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        let a = styled(&mut wb, 1);
        wb.set_input(c(0, 0), "1").unwrap();
        wb.set_input(c(0, 1), "2").unwrap();
        wb.set_input(c(1, 1), "=A1").unwrap();
        wb.set_input(c(5, 0), "=SUM(A1:B2)").unwrap();
        wb.set_style(c(1, 0), a).unwrap();
        wb.add_merge(s, MergeRect::new(1, 0, 1, 1)).unwrap();

        // A single cell, an overlap and a sticking-out merge are rejected.
        let range = |r0, c0, r1, c1| CellRange::new(s, r0, c0, r1, c1);
        assert_eq!(wb.merge_cells(range(3, 3, 3, 3)), Err(Error::InvalidMerge));
        assert_eq!(
            wb.add_merge(s, MergeRect::new(0, 1, 1, 2)),
            Err(Error::MergeOverlap)
        );
        assert_eq!(wb.merge_cells(range(0, 1, 2, 2)), Err(Error::MergeOverlap));

        let recalc = wb.merge_cells(range(0, 0, 2, 1)).unwrap();
        assert!(recalc.changed.contains(&c(5, 0)));
        assert_eq!(wb.value(c(0, 0)), Value::Number(1.0));
        assert_eq!(wb.content(c(0, 1)), &CellContent::Empty);
        assert_eq!(wb.content(c(1, 1)), &CellContent::Empty);
        assert_eq!(wb.value(c(5, 0)), Value::Number(1.0));
        assert_eq!(wb.cell_style_id(c(1, 0)), a);
        // The inner merge was absorbed.
        assert_eq!(wb.merges(s), &[MergeRect::new(0, 0, 2, 1)]);
        assert_eq!(wb.merge_at(c(2, 1)), Some(&MergeRect::new(0, 0, 2, 1)));
        assert_eq!(wb.merge_at(c(3, 1)), None);

        wb.add_merge(s, MergeRect::new(0, 5, 0, 6)).unwrap();
        wb.add_merge(s, MergeRect::new(9, 0, 9, 9)).unwrap();
        let removed = wb.unmerge_cells(range(0, 1, 0, 5)).unwrap();
        assert_eq!(
            removed,
            vec![MergeRect::new(0, 0, 2, 1), MergeRect::new(0, 5, 0, 6)]
        );
        assert_eq!(wb.merges(s), &[MergeRect::new(9, 0, 9, 9)]);
        assert!(wb.remove_merge(s, MergeRect::new(9, 0, 9, 9)).unwrap());
        assert!(!wb.remove_merge(s, MergeRect::new(9, 0, 9, 9)).unwrap());
        assert_eq!(
            wb.set_merges(
                s,
                vec![MergeRect::new(0, 0, 3, 3), MergeRect::new(3, 3, 4, 4)]
            ),
            Err(Error::MergeOverlap)
        );
        assert!(wb.merges(s).is_empty());
    }

    #[test]
    fn structural_edits_move_merges_and_frozen_panes() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.set_frozen(s, 3, 2).unwrap();
        wb.set_merges(
            s,
            vec![
                MergeRect::new(0, 0, 0, 1), // header, columns A:B
                MergeRect::new(4, 0, 6, 0), // A5:A7
                MergeRect::new(10, 3, 11, 3),
            ],
        )
        .unwrap();
        // Insert inside the frozen rows and inside A5:A7.
        wb.insert_rows(s, 1, 1).unwrap();
        wb.insert_rows(s, 6, 2).unwrap();
        assert_eq!(wb.sheet_view(s).frozen_rows, 4);
        assert_eq!(
            wb.merges(s),
            &[
                MergeRect::new(0, 0, 0, 1),
                MergeRect::new(5, 0, 9, 0),
                MergeRect::new(13, 3, 14, 3),
            ]
        );
        // Deleting a column clips A1:B1 to one cell: it disappears.
        wb.delete_cols(s, 1, 1).unwrap();
        assert_eq!(wb.sheet_view(s).frozen_cols, 1);
        assert_eq!(
            wb.merges(s),
            &[MergeRect::new(5, 0, 9, 0), MergeRect::new(13, 2, 14, 2)]
        );
        // Deleting rows straddling the frozen boundary and a merge.
        wb.delete_rows(s, 2, 5).unwrap();
        assert_eq!(wb.sheet_view(s).frozen_rows, 2);
        assert_eq!(
            wb.merges(s),
            &[MergeRect::new(2, 0, 4, 0), MergeRect::new(8, 2, 9, 2)]
        );
        wb.delete_rows(s, 0, 9).unwrap();
        assert_eq!(wb.sheet_view(s).frozen_rows, 0);
        assert!(wb.merges(s).is_empty());
    }

    #[test]
    fn views_and_hidden_sheets() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        assert!(wb.sheet_view(s).is_default());
        let bad = SheetView {
            zoom: 5,
            ..Default::default()
        };
        assert!(matches!(
            wb.set_sheet_view(s, bad),
            Err(Error::InvalidSheetView(_))
        ));
        let view = SheetView {
            frozen_rows: 1,
            zoom: 150,
            show_gridlines: false,
            ..Default::default()
        };
        wb.set_sheet_view(s, view).unwrap();
        assert_eq!(wb.sheet_view(s), view);

        assert_eq!(wb.set_sheet_hidden(s, true), Err(Error::LastVisibleSheet));
        let b = wb.add_sheet("B").unwrap();
        wb.set_sheet_visibility(s, true, true).unwrap();
        assert!(wb.is_sheet_hidden(s) && wb.is_sheet_very_hidden(s));
        assert_eq!(wb.set_sheet_hidden(b, true), Err(Error::LastVisibleSheet));
        assert_eq!(wb.remove_sheet(b), Err(Error::LastVisibleSheet));
        wb.add_merge(s, MergeRect::new(0, 0, 1, 1)).unwrap();

        // Duplicates are visible and keep view and merges.
        let (copy, _) = wb.duplicate_sheet(s, "Copy").unwrap();
        assert!(!wb.is_sheet_hidden(copy));
        assert_eq!(wb.sheet_view(copy), view);
        assert_eq!(wb.merges(copy), wb.merges(s));

        let snap = wb.to_snapshot();
        assert!(snap.sheets[0].hidden && snap.sheets[0].very_hidden);
        let back = Workbook::from_snapshot(&snap).unwrap();
        assert_eq!(back.to_snapshot(), snap);
        let json = serde_json::to_value(&snap.sheets[0]).unwrap();
        assert_eq!(json["view"]["zoom"], 150);
        assert_eq!(json["merges"][0]["r1"], 1);
        assert!(serde_json::to_value(&snap.sheets[2])
            .unwrap()
            .get("hidden")
            .is_none());

        wb.set_sheet_hidden(s, false).unwrap();
        assert!(!wb.is_sheet_hidden(s) && !wb.is_sheet_very_hidden(s));
        wb.remove_sheet(b).unwrap();

        // A snapshot with every sheet hidden keeps one shown.
        let mut all_hidden = wb.to_snapshot();
        for sh in &mut all_hidden.sheets {
            sh.hidden = true;
        }
        let wb = Workbook::from_snapshot(&all_hidden).unwrap();
        assert_eq!(
            wb.sheets()
                .iter()
                .filter(|(id, _)| !wb.is_sheet_hidden(*id))
                .count(),
            1
        );
    }
}
