//! Excel tables in the document (P8-35): the table commands, the typing
//! rules (auto-expansion below and right of a table, calculated columns,
//! header cells naming the columns) and their undo.
//!
//! Undo is generic: [`CalcDocument::mark_tables`] compares the tables
//! before and after every command and appends `RestoreTables` to the
//! inverse; cell writes carry their own `RestoreCells`; column renames
//! (which rewrite formulas) are undone by the opposite rename.

use std::collections::BTreeSet;

use app_common::{Applied, Patch};
use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{CellContent, Value};
use model_sheet::{
    content_to_input, CellCoord, CellRange, SheetId, StyleId, Table, TableColumn, TotalsCell,
    TotalsFunction,
};

use crate::command::{CalcCommand, ClipCell, PasteMode, Rect, SheetRect};
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};
use crate::fill::shift_input;
use crate::patch::CalcPatch;

/// The tables of every sheet that has some, in sheet order.
pub(crate) type TablesState = Vec<(u32, Vec<Table>)>;

fn bad(m: impl Into<String>) -> CalcError {
    CalcError::Model(model_sheet::Error::InvalidTable(m.into()))
}

/// `inverse` followed by `after` (one undo step).
pub(crate) fn append_inverse(applied: &mut CalcApplied, after: Vec<CalcCommand>) {
    if after.is_empty() {
        return;
    }
    let mut commands = match applied.inverse.take() {
        Some(CalcCommand::Compound { commands }) => commands,
        Some(inv) => vec![inv],
        None => Vec::new(),
    };
    commands.extend(after);
    applied.inverse = Some(CalcCommand::Compound { commands });
}

/// `before` followed by `inverse`.
pub(crate) fn prepend_inverse(applied: &mut CalcApplied, before: Vec<CalcCommand>) {
    if before.is_empty() {
        return;
    }
    let mut commands = before;
    match applied.inverse.take() {
        Some(CalcCommand::Compound { commands: c }) => commands.extend(c),
        Some(inv) => commands.push(inv),
        None => {}
    }
    applied.inverse = Some(CalcCommand::Compound { commands });
}

/// Merges `next` (applied after `acc`) into `acc`: patches merged, the
/// inverse undoes `next` first.
pub(crate) fn chain(acc: &mut CalcApplied, next: CalcApplied) {
    acc.patch.merge(next.patch);
    if let Some(inv) = next.inverse {
        prepend_inverse(acc, vec![inv]);
    }
}

pub(crate) fn empty_applied() -> CalcApplied {
    Applied {
        patch: CalcPatch::default(),
        inverse: Some(CalcCommand::Compound {
            commands: Vec::new(),
        }),
    }
}

/// The input that writes `name` as a header text.
fn header_input(name: &str) -> String {
    model_sheet::tables::header_input(name)
}

/// The totals cell input of a column.
fn totals_input(totals: Option<&TotalsCell>, column: &str) -> String {
    match totals {
        Some(TotalsCell::Function { function }) => function.formula(column),
        Some(TotalsCell::Label { text }) => header_input(text),
        Some(TotalsCell::Custom { formula }) => format!("={formula}"),
        None => String::new(),
    }
}

impl CalcDocument {
    pub(crate) fn tables_state(&self) -> TablesState {
        let wb = self.workbook();
        wb.sheets()
            .into_iter()
            .filter(|(id, _)| !wb.tables(*id).is_empty())
            .map(|(id, _)| (id.0, wb.tables(id).to_vec()))
            .collect()
    }

    /// After any command: header cells that no longer match their column
    /// names rename the columns (formulas follow); tables that changed
    /// are reported (`sheets`) and restored by the inverse.
    pub(crate) fn mark_tables(
        &mut self,
        before: TablesState,
        cmd: &CalcCommand,
        applied: &mut CalcApplied,
    ) {
        if matches!(cmd, CalcCommand::RestoreTables { .. }) {
            return;
        }
        if let Ok(sync) = self.sync_headers() {
            if let Some(inv) = sync.inverse {
                prepend_inverse(applied, vec![inv]);
            }
            applied.patch.merge(sync.patch);
        }
        let after = self.tables_state();
        if after == before {
            return;
        }
        let sheets: BTreeSet<u32> = before.iter().chain(&after).map(|(s, _)| *s).collect();
        let restore: Vec<CalcCommand> = sheets
            .into_iter()
            .map(|s| CalcCommand::RestoreTables {
                sheet: s,
                tables: before
                    .iter()
                    .find(|(b, _)| *b == s)
                    .map(|(_, t)| t.clone())
                    .unwrap_or_default(),
            })
            .collect();
        append_inverse(applied, restore);
        applied.patch.merge(CalcPatch {
            sheets: Some(self.sheet_infos()),
            ..Default::default()
        });
    }

    /// Header cells whose text differs from the column name: the column
    /// is renamed after the cell (made unique; an empty cell names it
    /// `Column<n>`, written back).
    fn sync_headers(&mut self) -> Result<CalcApplied> {
        let mut acc = empty_applied();
        let mut changed = false;
        for (sheet, tables) in self.tables_state() {
            let s = SheetId(sheet);
            for t in tables.iter().filter(|t| t.header_row) {
                for (i, col) in t.columns.iter().enumerate() {
                    let c = CellCoord::new(s, t.r0, t.c0 + i as u32);
                    let wb = self.workbook();
                    let text = match wb.value(c) {
                        Value::Empty => String::new(),
                        _ => wb.display_text(c),
                    };
                    if text == col.name
                        && matches!(wb.content(c), CellContent::Value(Value::Text(_)))
                    {
                        continue;
                    }
                    let current = self
                        .workbook()
                        .table(t.id)
                        .map(|(_, t)| t.clone())
                        .ok_or(CalcError::InvalidRange)?;
                    let base = if text.is_empty() {
                        format!("Column{}", i + 1)
                    } else {
                        text.clone()
                    };
                    let name = current.unique_column_name(&base, Some(i));
                    if name != col.name {
                        let a = self.apply_cmd(&CalcCommand::RenameTableColumn {
                            id: t.id,
                            index: i as u32,
                            name: name.clone(),
                        })?;
                        chain(&mut acc, a);
                        changed = true;
                    }
                    let cell_ok = matches!(self.workbook().content(c), CellContent::Value(Value::Text(x)) if *x == name);
                    if !cell_ok {
                        let a = self.apply_cmd(&CalcCommand::SetInput {
                            sheet,
                            row: c.row,
                            col: c.col,
                            input: header_input(&name),
                        })?;
                        chain(&mut acc, a);
                        changed = true;
                    }
                }
            }
        }
        if !changed {
            acc.inverse = None;
        }
        Ok(acc)
    }

    /// Typing into a cell of, below or right of a table (see the module
    /// docs); `None` when no table rule applies.
    pub(crate) fn table_set_input(
        &mut self,
        sheet: u32,
        row: u32,
        col: u32,
        input: &str,
    ) -> Option<Result<CalcApplied>> {
        let s = self.sheet(sheet).ok()?;
        let wb = self.workbook();
        let tables = wb.tables(s);
        let is_formula = input.starts_with('=');
        // Inside a data row: calculated columns.
        if let Some(t) = tables.iter().find(|t| t.contains(row, col)) {
            let (d0, d1) = t.data_rows();
            if is_formula && (d0..=d1).contains(&row) {
                return self.calculated_column(s, t.clone(), row, col, input);
            }
            return None;
        }
        if input.is_empty() {
            return None;
        }
        // Directly below (no totals row): a new data row.
        if let Some(t) = tables
            .iter()
            .find(|t| !t.totals_row && row == t.r1 + 1 && (t.c0..=t.c1).contains(&col))
        {
            let t = t.clone();
            return Some(self.expand_table(s, t, 1, 0, Some((row, col, input.to_string()))));
        }
        // Directly right: a new column.
        if let Some(t) = tables
            .iter()
            .find(|t| t.header_row && col == t.c1 + 1 && (t.r0..=t.data_rows().1).contains(&row))
        {
            let t = t.clone();
            return Some(self.expand_table(s, t, 0, 1, Some((row, col, input.to_string()))));
        }
        None
    }

    /// A formula typed into a data cell of column `col`: when the other
    /// data cells of the column are empty (or hold the column's
    /// calculated formula), the whole column gets it.
    fn calculated_column(
        &mut self,
        s: SheetId,
        t: Table,
        row: u32,
        col: u32,
        input: &str,
    ) -> Option<Result<CalcApplied>> {
        let (d0, d1) = t.data_rows();
        let i = (col - t.c0) as usize;
        let wb = self.workbook();
        let old = t.columns[i]
            .calculated_formula
            .as_ref()
            .map(|f| format!("={f}"));
        let fillable = (d0..=d1).filter(|&r| r != row).all(|r| {
            let c = CellCoord::new(s, r, col);
            match wb.content(c) {
                CellContent::Empty => true,
                CellContent::Formula { text, .. } => old.as_ref().is_some_and(|o| {
                    shift_input(o, i64::from(r) - i64::from(d0), 0) == *text || o == text
                }),
                _ => false,
            }
        });
        if !fillable || d0 == d1 && old.is_none() {
            if d0 == d1 && old.is_none() && fillable {
                // A one-row table: the column still becomes calculated.
            } else {
                return None;
            }
        }
        let parsed = engine_formula::parse(input).ok()?;
        let base_row = row;
        let mut cells = Vec::new();
        for r in d0..=d1 {
            let c = CellCoord::new(s, r, col);
            let text = shift_input(input, i64::from(r) - i64::from(base_row), 0);
            cells.push((r, col, text, self.workbook().cell_style_id(c).0));
        }
        let formula =
            engine_formula::offset_relative(&parsed, i64::from(d0) - i64::from(base_row), 0)
                .to_string();
        let mut new = t.clone();
        new.columns[i].calculated_formula = Some(formula);
        Some((|| {
            let mut acc = self.set_table(s, new)?;
            let a = self.apply_cmd(&CalcCommand::RestoreCells { sheet: s.0, cells })?;
            chain(&mut acc, a);
            Ok(acc)
        })())
    }

    /// Replaces table `t.id` on sheet `s`.
    pub(crate) fn set_table(&mut self, s: SheetId, t: Table) -> Result<CalcApplied> {
        let mut list = self.workbook().tables(s).to_vec();
        match list.iter_mut().find(|x| x.id == t.id) {
            Some(slot) => *slot = t,
            None => list.push(t),
        }
        let recalc = self.workbook_mut().set_tables(s, list)?;
        Ok(Applied {
            patch: self.content_patch([], &recalc),
            inverse: Some(CalcCommand::Compound {
                commands: Vec::new(),
            }),
        })
    }

    /// Grows table `t` by `rows` data rows at the bottom (before a totals
    /// row) or `cols` columns at the right; new rows get the calculated
    /// formulas, new columns `Column<n>` (or the typed header). `typed`:
    /// the input that triggered the expansion, written last.
    fn expand_table(
        &mut self,
        s: SheetId,
        t: Table,
        rows: u32,
        cols: u32,
        typed: Option<(u32, u32, String)>,
    ) -> Result<CalcApplied> {
        let mut new = t.clone();
        let mut writes: Vec<(u32, u32, String, u32)> = Vec::new();
        let style = |doc: &CalcDocument, r: u32, c: u32| {
            doc.workbook().cell_style_id(CellCoord::new(s, r, c)).0
        };
        if rows > 0 {
            let (_, last) = t.data_rows();
            new.r1 += rows;
            for k in 1..=rows {
                let r = last + k;
                for (i, c) in t.columns.iter().enumerate() {
                    if let Some(f) = &c.calculated_formula {
                        let col = t.c0 + i as u32;
                        let (d0, _) = t.data_rows();
                        let text = shift_input(&format!("={f}"), i64::from(r) - i64::from(d0), 0);
                        writes.push((r, col, text, style(self, r, col)));
                    }
                }
            }
        }
        if cols > 0 {
            new.c1 += cols;
            for k in 1..=cols {
                let col = t.c1 + k;
                let id = new.columns.iter().map(|c| c.id).max().unwrap_or(0) + 1;
                let typed_header = typed
                    .as_ref()
                    .filter(|(r, c, _)| *r == t.r0 && *c == col)
                    .map(|(_, _, v)| v.trim_start_matches('\'').to_string());
                let base =
                    typed_header.unwrap_or_else(|| format!("Column{}", new.columns.len() + 1));
                let name = new.unique_column_name(&base, None);
                new.columns.push(TableColumn::new(id, &name));
                if t.header_row {
                    writes.push((t.r0, col, header_input(&name), style(self, t.r0, col)));
                }
            }
        }
        self.check_table_area(s, &new, Some(t.id))?;
        if let Some((r, c, v)) = typed {
            if !(cols > 0 && r == t.r0) {
                let st = style(self, r, c);
                writes.push((r, c, v, st));
            }
        }
        let mut acc = self.set_table(s, new)?;
        if !writes.is_empty() {
            let a = self.apply_cmd(&CalcCommand::RestoreCells {
                sheet: s.0,
                cells: writes,
            })?;
            chain(&mut acc, a);
        }
        Ok(acc)
    }

    /// The table area must not meet another table, a pivot table or a
    /// merged range sticking out of it.
    fn check_table_area(&self, s: SheetId, t: &Table, except: Option<u32>) -> Result<()> {
        let wb = self.workbook();
        if t.r1 > MAX_ROW || t.c1 > MAX_COL {
            return Err(CalcError::InvalidRange);
        }
        if wb
            .tables(s)
            .iter()
            .any(|o| Some(o.id) != except && o.intersects(t.r0, t.c0, t.r1, t.c1))
        {
            return Err(bad("tables cannot overlap"));
        }
        if !wb
            .pivot_cells_in(CellRange::new(s, t.r0, t.c0, t.r1, t.c1))
            .is_empty()
        {
            return Err(bad("a table cannot overlap a pivot table"));
        }
        let rect = model_sheet::MergeRect::new(t.r0, t.c0, t.r1, t.c1);
        if wb.merges(s).iter().any(|m| m.intersects(&rect)) {
            return Err(bad("a table cannot contain merged cells"));
        }
        Ok(())
    }

    fn table_of(&self, id: u32) -> Result<(SheetId, Table)> {
        self.workbook()
            .table(id)
            .map(|(s, t)| (s, t.clone()))
            .ok_or(CalcError::Model(model_sheet::Error::UnknownTable(id)))
    }

    /// Moves the block `block` of sheet `s` by `(dr, dc)` (cut and paste:
    /// references follow); tables lying inside the block move along.
    /// Fails when a table or pivot table sticks out of the block.
    pub(crate) fn shift_block(
        &mut self,
        s: SheetId,
        block: Rect,
        dr: i64,
        dc: i64,
        except: Option<u32>,
    ) -> Result<CalcApplied> {
        let wb = self.workbook();
        let range = CellRange::new(s, block.r0, block.c0, block.r1, block.c1);
        let cells: Vec<ClipCell> = wb
            .cells_in(range)
            .map(|(c, content, style)| ClipCell {
                dr: c.row - block.r0,
                dc: c.col - block.c0,
                input: content_to_input(content),
                style: Some(style.0),
            })
            .collect();
        let inside = |t: &Table| {
            block.r0 <= t.r0 && t.r1 <= block.r1 && block.c0 <= t.c0 && t.c1 <= block.c1
        };
        let mut moved = Vec::new();
        for t in wb.tables(s) {
            if Some(t.id) == except {
                continue;
            }
            let meets =
                t.r0 <= block.r1 && block.r0 <= t.r1 && t.c0 <= block.c1 && block.c0 <= t.c1;
            if meets && !inside(t) {
                return Err(bad("this would move part of another table"));
            }
            if meets {
                moved.push(t.clone());
            }
        }
        if !wb.pivot_cells_in(range).is_empty() {
            return Err(CalcError::Model(model_sheet::Error::PivotCell));
        }
        let (r0, c0) = (i64::from(block.r0) + dr, i64::from(block.c0) + dc);
        let r1 = i64::from(block.r1) + dr;
        let c1 = i64::from(block.c1) + dc;
        if r0 < 0 || c0 < 0 || r1 > i64::from(MAX_ROW) || c1 > i64::from(MAX_COL) {
            return Err(CalcError::InvalidRange);
        }
        let mut acc = empty_applied();
        if !cells.is_empty() {
            let a = self.apply_cmd(&CalcCommand::PasteRange {
                sheet: s.0,
                r0: r0 as u32,
                c0: c0 as u32,
                src: SheetRect {
                    sheet: s.0,
                    r0: block.r0,
                    c0: block.c0,
                    r1: block.r1,
                    c1: block.c1,
                },
                cells,
                mode: PasteMode::All,
                cut: true,
                repeat_rows: 1,
                repeat_cols: 1,
                annotations: true,
                special: None,
            })?;
            chain(&mut acc, a);
        }
        for mut t in moved {
            t.r0 = (i64::from(t.r0) + dr) as u32;
            t.r1 = (i64::from(t.r1) + dr) as u32;
            t.c0 = (i64::from(t.c0) + dc) as u32;
            t.c1 = (i64::from(t.c1) + dc) as u32;
            if let Some(af) = t.auto_filter.as_mut() {
                for fc in &mut af.columns {
                    fc.col = (i64::from(fc.col) + dc) as u32;
                }
            }
            let a = self.set_table(s, t)?;
            chain(&mut acc, a);
        }
        Ok(acc)
    }

    /// Clears contents and formats of a range.
    fn clear_fully(&mut self, s: SheetId, r: Rect) -> Result<CalcApplied> {
        let cells: Vec<(u32, u32, String, u32)> = self
            .workbook()
            .cells_in(CellRange::new(s, r.r0, r.c0, r.r1, r.c1))
            .map(|(c, _, _)| (c.row, c.col, String::new(), 0))
            .collect();
        if cells.is_empty() {
            return Ok(empty_applied());
        }
        self.apply_cmd(&CalcCommand::RestoreCells { sheet: s.0, cells })
    }

    /// The last used row of columns `c0..=c1` at or below `from` (or
    /// `from - 1` when none).
    fn last_row_in(&self, s: SheetId, from: u32, c0: u32, c1: u32) -> u32 {
        let wb = self.workbook();
        let Some((max_r, _)) = wb.used_range(s) else {
            return from.saturating_sub(1);
        };
        wb.cells_in(CellRange::new(s, from, c0, max_r, c1))
            .map(|(c, _, _)| c.row)
            .max()
            .unwrap_or(from.saturating_sub(1))
    }

    fn last_col_in(&self, s: SheetId, from: u32, r0: u32, r1: u32) -> u32 {
        let wb = self.workbook();
        let Some((_, max_c)) = wb.used_range(s) else {
            return from.saturating_sub(1);
        };
        wb.cells_in(CellRange::new(s, r0, from, r1, max_c))
            .map(|(c, _, _)| c.col)
            .max()
            .unwrap_or(from.saturating_sub(1))
    }

    /// Shifts the cells of columns `c0..=c1` from row `at` down by
    /// `count` ("insert cells, shift down"); tables inside move along.
    fn insert_cells_down(
        &mut self,
        s: SheetId,
        at: u32,
        count: u32,
        c0: u32,
        c1: u32,
        except: Option<u32>,
    ) -> Result<CalcApplied> {
        let last = self.last_row_in(s, at, c0, c1);
        if last < at {
            return Ok(empty_applied());
        }
        self.shift_block(
            s,
            Rect {
                r0: at,
                c0,
                r1: last,
                c1,
            },
            i64::from(count),
            0,
            except,
        )
    }

    fn insert_cells_right(
        &mut self,
        s: SheetId,
        at: u32,
        count: u32,
        r0: u32,
        r1: u32,
        except: Option<u32>,
    ) -> Result<CalcApplied> {
        let last = self.last_col_in(s, at, r0, r1);
        if last < at {
            return Ok(empty_applied());
        }
        self.shift_block(
            s,
            Rect {
                r0,
                c0: at,
                r1,
                c1: last,
            },
            0,
            i64::from(count),
            except,
        )
    }

    /// Deletes rows `at..at+count` of columns `c0..=c1` ("delete cells,
    /// shift up").
    fn delete_cells_up(
        &mut self,
        s: SheetId,
        at: u32,
        count: u32,
        c0: u32,
        c1: u32,
        except: Option<u32>,
    ) -> Result<CalcApplied> {
        let mut acc = self.clear_fully(
            s,
            Rect {
                r0: at,
                c0,
                r1: at + count - 1,
                c1,
            },
        )?;
        let from = at + count;
        let last = self.last_row_in(s, from, c0, c1);
        if last >= from {
            let a = self.shift_block(
                s,
                Rect {
                    r0: from,
                    c0,
                    r1: last,
                    c1,
                },
                -i64::from(count),
                0,
                except,
            )?;
            chain(&mut acc, a);
        }
        Ok(acc)
    }

    fn delete_cells_left(
        &mut self,
        s: SheetId,
        at: u32,
        count: u32,
        r0: u32,
        r1: u32,
        except: Option<u32>,
    ) -> Result<CalcApplied> {
        let mut acc = self.clear_fully(
            s,
            Rect {
                r0,
                c0: at,
                r1,
                c1: at + count - 1,
            },
        )?;
        let from = at + count;
        let last = self.last_col_in(s, from, r0, r1);
        if last >= from {
            let a = self.shift_block(
                s,
                Rect {
                    r0,
                    c0: from,
                    r1,
                    c1: last,
                },
                0,
                -i64::from(count),
                except,
            )?;
            chain(&mut acc, a);
        }
        Ok(acc)
    }

    /// The writes that fill the calculated columns of rows `r0..=r1` of
    /// table `t`.
    fn calc_writes(&self, s: SheetId, t: &Table, r0: u32, r1: u32) -> Vec<(u32, u32, String, u32)> {
        let (d0, _) = t.data_rows();
        let mut out = Vec::new();
        for (i, c) in t.columns.iter().enumerate() {
            let Some(f) = &c.calculated_formula else {
                continue;
            };
            let col = t.c0 + i as u32;
            for r in r0..=r1 {
                let text = shift_input(&format!("={f}"), i64::from(r) - i64::from(d0), 0);
                let st = self.workbook().cell_style_id(CellCoord::new(s, r, col)).0;
                out.push((r, col, text, st));
            }
        }
        out
    }

    fn write(&mut self, s: SheetId, cells: Vec<(u32, u32, String, u32)>) -> Result<CalcApplied> {
        if cells.is_empty() {
            return Ok(empty_applied());
        }
        self.apply_cmd(&CalcCommand::RestoreCells { sheet: s.0, cells })
    }

    /// The table commands.
    pub(crate) fn table_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        match cmd {
            &C::CreateTable {
                sheet,
                r0,
                c0,
                r1,
                c1,
                has_headers,
                ref style,
            } => self.create_table(sheet, Rect { r0, c0, r1, c1 }, has_headers, style.clone()),
            C::RenameTable { id, name } => {
                let (s, mut t) = self.table_of(*id)?;
                if t.name == *name {
                    return Ok(empty_applied());
                }
                self.workbook().check_table_name(name, Some(*id))?;
                let old = std::mem::replace(&mut t.name, name.clone());
                let recalc = self
                    .workbook_mut()
                    .engine_mut()
                    .rename_table_refs(&old, name);
                let mut acc = self.set_table(s, t)?;
                acc.patch.merge(self.content_patch([], &recalc));
                acc.patch.names = Some(self.name_infos());
                prepend_inverse(&mut acc, vec![C::RenameTable { id: *id, name: old }]);
                Ok(acc)
            }
            C::RenameTableColumn { id, index, name } => {
                let (s, mut t) = self.table_of(*id)?;
                let i = *index as usize;
                let col = t.columns.get_mut(i).ok_or(CalcError::InvalidRange)?;
                let old = std::mem::replace(&mut col.name, name.clone());
                let recalc = self
                    .workbook_mut()
                    .engine_mut()
                    .rename_table_column_refs(&t.name, &old, name);
                let mut acc = self.set_table(s, t)?;
                acc.patch.merge(self.content_patch([], &recalc));
                prepend_inverse(
                    &mut acc,
                    vec![C::RenameTableColumn {
                        id: *id,
                        index: *index,
                        name: old,
                    }],
                );
                Ok(acc)
            }
            C::SetTableStyle { id, style, look } => {
                let (s, mut t) = self.table_of(*id)?;
                if let Some(st) = style {
                    t.style = st.clone();
                }
                if let Some(l) = look {
                    t.look = *l;
                }
                self.set_table(s, t)
            }
            &C::SetTableOptions {
                id,
                header_row,
                totals_row,
                filter_button,
            } => self.table_options(id, header_row, totals_row, filter_button),
            C::SetTotalsFunction { id, col, totals } => {
                let (s, mut t) = self.table_of(*id)?;
                let i = col
                    .checked_sub(t.c0)
                    .filter(|i| (*i as usize) < t.columns.len())
                    .ok_or(CalcError::InvalidRange)? as usize;
                t.columns[i].totals = totals.clone();
                let name = t.columns[i].name.clone();
                let mut acc = self.set_table(s, t.clone())?;
                if let Some(r) = t.totals_index() {
                    let st = self.workbook().cell_style_id(CellCoord::new(s, r, *col)).0;
                    let a =
                        self.write(s, vec![(r, *col, totals_input(totals.as_ref(), &name), st)])?;
                    chain(&mut acc, a);
                }
                Ok(acc)
            }
            &C::ResizeTable { id, r0, c0, r1, c1 } => {
                self.resize_table(id, Rect { r0, c0, r1, c1 })
            }
            C::ConvertToRange { id, formats } => {
                let (s, t) = self.table_of(*id)?;
                let formulas_before: Vec<(CellCoord, String, StyleId)> = self.formulas();
                let recalc = self.workbook_mut().engine_mut().table_refs_to_a1(&t.name);
                let rest: Vec<Table> = self
                    .workbook()
                    .tables(s)
                    .iter()
                    .filter(|x| x.id != *id)
                    .cloned()
                    .collect();
                let r2 = self.workbook_mut().set_tables(s, rest)?;
                let mut acc = Applied {
                    patch: self.content_patch(recalc.changed.iter().copied(), &r2),
                    inverse: Some(C::Compound {
                        commands: Vec::new(),
                    }),
                };
                // The rewritten formulas' texts come back on undo.
                let mut restore: std::collections::BTreeMap<u32, Vec<(u32, u32, String, u32)>> =
                    Default::default();
                for (c, text, style) in formulas_before {
                    if self.workbook().formula_text(c) != Some(text.as_str()) {
                        restore
                            .entry(c.sheet.0)
                            .or_default()
                            .push((c.row, c.col, text, style.0));
                    }
                }
                append_inverse(
                    &mut acc,
                    restore
                        .into_iter()
                        .map(|(sheet, cells)| C::RestoreCells { sheet, cells })
                        .collect(),
                );
                for f in formats {
                    let a = self.apply_cmd(&C::ApplyStyle {
                        sheet: s.0,
                        r0: f.r0,
                        c0: f.c0,
                        r1: f.r1,
                        c1: f.c1,
                        patch: f.patch.clone(),
                    })?;
                    chain(&mut acc, a);
                }
                acc.patch.names = Some(self.name_infos());
                Ok(acc)
            }
            &C::InsertTableRows { id, at, count } => {
                let (s, t) = self.table_of(id)?;
                let (d0, d1) = t.data_rows();
                if count == 0 || !(d0..=d1 + 1).contains(&at) {
                    return Err(CalcError::InvalidRange);
                }
                let mut acc = self.insert_cells_down(s, at, count, t.c0, t.c1, Some(id))?;
                let mut new = t.clone();
                new.r1 += count;
                self.check_table_area(s, &new, Some(id))?;
                let a = self.set_table(s, new.clone())?;
                chain(&mut acc, a);
                let writes = self.calc_writes(s, &new, at, at + count - 1);
                let a = self.write(s, writes)?;
                chain(&mut acc, a);
                Ok(acc)
            }
            &C::DeleteTableRows { id, at, count } => {
                let (s, t) = self.table_of(id)?;
                let (d0, d1) = t.data_rows();
                if count == 0 || at < d0 || at + count - 1 > d1 {
                    return Err(CalcError::InvalidRange);
                }
                // A table keeps one (empty) data row.
                let all = at == d0 && at + count - 1 == d1;
                let count_del = if all { count - 1 } else { count };
                let mut acc = empty_applied();
                if all {
                    let a = self.clear_fully(
                        s,
                        Rect {
                            r0: d1,
                            c0: t.c0,
                            r1: d1,
                            c1: t.c1,
                        },
                    )?;
                    chain(&mut acc, a);
                }
                if count_del > 0 {
                    let mut new = t.clone();
                    new.r1 -= count_del;
                    let a = self.set_table(s, new)?;
                    chain(&mut acc, a);
                    let a = self.delete_cells_up(s, at, count_del, t.c0, t.c1, Some(id))?;
                    chain(&mut acc, a);
                }
                Ok(acc)
            }
            &C::InsertTableCols { id, at, count } => {
                let (s, t) = self.table_of(id)?;
                if count == 0 || !(t.c0..=t.c1 + 1).contains(&at) {
                    return Err(CalcError::InvalidRange);
                }
                let mut acc = self.insert_cells_right(s, at, count, t.r0, t.r1, Some(id))?;
                let mut new = t.clone();
                let pos = (at - t.c0) as usize;
                let mut headers = Vec::new();
                for k in 0..count {
                    let cid = new.columns.iter().map(|c| c.id).max().unwrap_or(0) + 1;
                    let name =
                        new.unique_column_name(&format!("Column{}", pos + k as usize + 1), None);
                    new.columns
                        .insert(pos + k as usize, TableColumn::new(cid, &name));
                    if t.header_row {
                        headers.push((t.r0, at + k, header_input(&name), 0));
                    }
                }
                new.c1 += count;
                self.check_table_area(s, &new, Some(id))?;
                let a = self.set_table(s, new)?;
                chain(&mut acc, a);
                let a = self.write(s, headers)?;
                chain(&mut acc, a);
                Ok(acc)
            }
            &C::DeleteTableCols { id, at, count } => {
                let (s, t) = self.table_of(id)?;
                if count == 0 || at < t.c0 || at + count - 1 > t.c1 {
                    return Err(CalcError::InvalidRange);
                }
                let mut acc = empty_applied();
                if count == t.c1 - t.c0 + 1 {
                    // Every column: the table goes with its cells.
                    let rest: Vec<Table> = self
                        .workbook()
                        .tables(s)
                        .iter()
                        .filter(|x| x.id != id)
                        .cloned()
                        .collect();
                    let r = self.workbook_mut().set_tables(s, rest)?;
                    acc.patch.merge(self.content_patch([], &r));
                    let a = self.delete_cells_left(s, at, count, t.r0, t.r1, Some(id))?;
                    chain(&mut acc, a);
                    return Ok(acc);
                }
                let mut new = t.clone();
                let pos = (at - t.c0) as usize;
                new.columns.drain(pos..pos + count as usize);
                new.c1 -= count;
                if let Some(af) = new.auto_filter.as_mut() {
                    af.columns.retain(|fc| fc.col < at || fc.col >= at + count);
                    for fc in &mut af.columns {
                        if fc.col >= at + count {
                            fc.col -= count;
                        }
                    }
                }
                let a = self.set_table(s, new)?;
                chain(&mut acc, a);
                let a = self.delete_cells_left(s, at, count, t.r0, t.r1, Some(id))?;
                chain(&mut acc, a);
                Ok(acc)
            }
            C::SetTableFilter { id, col, filter } => {
                let (s, t) = self.table_of(*id)?;
                let filter = filter.clone();
                let col = *col;
                let tid = t.id;
                self.filter_op(s.0, move |wb, s| {
                    wb.set_table_filter_column(s, tid, col, filter)?;
                    wb.apply_table_filter(s, tid)
                })
            }
            C::RestoreTables { sheet, tables } => {
                // A deleted sheet without tables: nothing to restore.
                if tables.is_empty() && self.sheet(*sheet).is_err() {
                    return Ok(empty_applied());
                }
                let s = self.sheet(*sheet)?;
                let old = self.workbook().tables(s).to_vec();
                let recalc = self.workbook_mut().set_tables(s, tables.clone())?;
                let mut patch = self.content_patch([], &recalc);
                patch.sheets = Some(self.sheet_infos());
                Ok(Applied {
                    patch,
                    inverse: Some(C::RestoreTables {
                        sheet: *sheet,
                        tables: old,
                    }),
                })
            }
            _ => Err(CalcError::InvalidRange),
        }
    }

    /// [`CalcCommand::CreateTable`].
    fn create_table(
        &mut self,
        sheet: u32,
        r: Rect,
        has_headers: bool,
        style: Option<String>,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let range = self.range(sheet, r.r0, r.c0, r.r1, r.c1)?;
        let range = if range.rows() == 1 && range.cols() == 1 {
            self.workbook().current_region(s, r.r0, r.c0)
        } else {
            range
        };
        let mut acc = empty_applied();
        let (mut r0, c0, mut r1, c1) = (range.r0, range.c0, range.r1, range.c1);
        // A sheet AutoFilter on the range becomes the table's.
        if let Some(af) = self.workbook().auto_filter(s) {
            if af.r0 <= r1 && r0 <= af.r1 && af.c0 <= c1 && c0 <= af.c1 {
                let a = self.apply_cmd(&CalcCommand::SetAutoFilter { sheet, range: None })?;
                chain(&mut acc, a);
            }
        }
        if !has_headers {
            // A header row above the data: the data moves down one row.
            let a = self.insert_cells_down(s, r0, 1, c0, c1, None)?;
            chain(&mut acc, a);
            r1 += 1;
        }
        if r1 == r0 {
            // A header alone: one empty data row below it.
            r1 += 1;
        }
        let wb = self.workbook();
        let mut names: Vec<String> = Vec::new();
        for c in c0..=c1 {
            let cell = CellCoord::new(s, r0, c);
            let text = if has_headers {
                match wb.value(cell) {
                    Value::Empty => String::new(),
                    _ => wb.display_text(cell),
                }
            } else {
                String::new()
            };
            let base = if text.is_empty() {
                format!("Column{}", c - c0 + 1)
            } else {
                text
            };
            let name = model_sheet::tables::unique_name(&base, |n| {
                names.iter().any(|x| x.eq_ignore_ascii_case(n))
            });
            names.push(name);
        }
        let id = wb.next_table_id();
        let name = wb.fresh_table_name();
        let mut t = Table::new(id, &name, r0, c0, r1, c1, &names);
        if let Some(st) = style {
            t.style = st;
        }
        self.check_table_area(s, &t, None)?;
        let _ = &mut r0;
        let headers: Vec<(u32, u32, String, u32)> = names
            .iter()
            .enumerate()
            .filter(|(i, n)| {
                !matches!(self.workbook().content(CellCoord::new(s, r0, c0 + *i as u32)),
                    CellContent::Value(Value::Text(x)) if x == *n)
            })
            .map(|(i, n)| {
                let c = c0 + i as u32;
                (
                    r0,
                    c,
                    header_input(n),
                    self.workbook().cell_style_id(CellCoord::new(s, r0, c)).0,
                )
            })
            .collect();
        let a = self.write(s, headers)?;
        chain(&mut acc, a);
        let a = self.set_table(s, t)?;
        chain(&mut acc, a);
        Ok(acc)
    }

    /// [`CalcCommand::SetTableOptions`].
    fn table_options(
        &mut self,
        id: u32,
        header: Option<bool>,
        totals: Option<bool>,
        filter: Option<bool>,
    ) -> Result<CalcApplied> {
        let mut acc = empty_applied();
        if let Some(on) = totals {
            let (s, t) = self.table_of(id)?;
            if on && !t.totals_row {
                let row = t.r1 + 1;
                let busy = self
                    .workbook()
                    .cells_in(CellRange::new(s, row, t.c0, row, t.c1))
                    .any(|(_, c, _)| !matches!(c, CellContent::Empty));
                if busy {
                    let a = self.insert_cells_down(s, row, 1, t.c0, t.c1, Some(id))?;
                    chain(&mut acc, a);
                }
                let mut new = t.clone();
                new.r1 += 1;
                new.totals_row = true;
                // Excel's defaults when the columns have no totals yet.
                if new.columns.iter().all(|c| c.totals.is_none()) {
                    let last = new.columns.len() - 1;
                    let (d0, d1) = t.data_rows();
                    let numeric = (d0..=d1).any(|r| {
                        matches!(
                            self.workbook().value(CellCoord::new(s, r, t.c1)),
                            Value::Number(_)
                        )
                    });
                    if last > 0 {
                        new.columns[0].totals = Some(TotalsCell::Label {
                            text: "Total".into(),
                        });
                    }
                    new.columns[last].totals = Some(TotalsCell::Function {
                        function: if numeric {
                            TotalsFunction::Sum
                        } else {
                            TotalsFunction::Count
                        },
                    });
                }
                self.check_table_area(s, &new, Some(id))?;
                let writes: Vec<(u32, u32, String, u32)> = new
                    .columns
                    .iter()
                    .enumerate()
                    .map(|(i, c)| {
                        let col = new.c0 + i as u32;
                        (
                            row,
                            col,
                            totals_input(c.totals.as_ref(), &c.name),
                            self.workbook().cell_style_id(CellCoord::new(s, row, col)).0,
                        )
                    })
                    .collect();
                let a = self.set_table(s, new)?;
                chain(&mut acc, a);
                let a = self.write(s, writes)?;
                chain(&mut acc, a);
            } else if !on && t.totals_row {
                let mut new = t.clone();
                new.r1 -= 1;
                new.totals_row = false;
                let a = self.set_table(s, new)?;
                chain(&mut acc, a);
                let a = self.clear_fully(
                    s,
                    Rect {
                        r0: t.r1,
                        c0: t.c0,
                        r1: t.r1,
                        c1: t.c1,
                    },
                )?;
                chain(&mut acc, a);
            }
        }
        if let Some(on) = header {
            let (s, t) = self.table_of(id)?;
            if !on && t.header_row {
                let mut new = t.clone();
                new.header_row = false;
                new.r0 += 1;
                new.auto_filter = None;
                let a = self.set_table(s, new)?;
                chain(&mut acc, a);
                let a = self.clear_fully(
                    s,
                    Rect {
                        r0: t.r0,
                        c0: t.c0,
                        r1: t.r0,
                        c1: t.c1,
                    },
                )?;
                chain(&mut acc, a);
            } else if on && !t.header_row {
                let free = t.r0 > 0
                    && !self
                        .workbook()
                        .cells_in(CellRange::new(s, t.r0 - 1, t.c0, t.r0 - 1, t.c1))
                        .any(|(_, c, _)| !matches!(c, CellContent::Empty))
                    && !self
                        .workbook()
                        .tables(s)
                        .iter()
                        .any(|o| o.id != id && o.intersects(t.r0 - 1, t.c0, t.r0 - 1, t.c1));
                let mut new = t.clone();
                if free {
                    new.r0 -= 1;
                } else {
                    let a = self.insert_cells_down(s, t.r0, 1, t.c0, t.c1, None)?;
                    chain(&mut acc, a);
                    new.r1 += 1;
                }
                new.header_row = true;
                let writes: Vec<(u32, u32, String, u32)> = new
                    .columns
                    .iter()
                    .enumerate()
                    .map(|(i, c)| (new.r0, new.c0 + i as u32, header_input(&c.name), 0))
                    .collect();
                let a = self.set_table(s, new)?;
                chain(&mut acc, a);
                let a = self.write(s, writes)?;
                chain(&mut acc, a);
            }
        }
        if let Some(on) = filter {
            let (s, t) = self.table_of(id)?;
            if on != t.auto_filter.is_some() {
                let mut new = t.clone();
                if on {
                    if !t.header_row {
                        return Err(bad("filter buttons need the header row"));
                    }
                    new.auto_filter = Some(new.filter_range());
                    let a = self.set_table(s, new)?;
                    chain(&mut acc, a);
                } else {
                    let (r0, r1) = (t.r0, t.data_rows().1);
                    let a = self.filter_op(s.0, move |wb, s| {
                        let shown = wb.show_filtered_rows(s, r0, r1)?;
                        let mut list = wb.tables(s).to_vec();
                        if let Some(x) = list.iter_mut().find(|x| x.id == id) {
                            x.auto_filter = None;
                        }
                        wb.set_tables(s, list)?;
                        Ok(shown)
                    })?;
                    chain(&mut acc, a);
                }
            }
        }
        Ok(acc)
    }

    /// [`CalcCommand::ResizeTable`].
    fn resize_table(&mut self, id: u32, r: Rect) -> Result<CalcApplied> {
        let (s, t) = self.table_of(id)?;
        self.range(s.0, r.r0, r.c0, r.r1, r.c1)?;
        if t.header_row && r.r0 != t.r0 {
            return Err(bad("the headers must remain in the same row"));
        }
        if !t.intersects(r.r0, r.c0, r.r1, r.c1) {
            return Err(bad("the new range must overlap the table"));
        }
        let mut new = t.clone();
        new.r0 = r.r0;
        new.c0 = r.c0;
        new.r1 = r.r1;
        new.c1 = r.c1;
        let wb = self.workbook();
        let mut columns: Vec<TableColumn> = Vec::new();
        let mut headers = Vec::new();
        let mut next_id = t.columns.iter().map(|c| c.id).max().unwrap_or(0) + 1;
        for col in r.c0..=r.c1 {
            if let Some(c) = t.column_at(col) {
                columns.push(c.clone());
                continue;
            }
            let cell = CellCoord::new(s, r.r0, col);
            let text = if t.header_row {
                match wb.value(cell) {
                    Value::Empty => String::new(),
                    _ => wb.display_text(cell),
                }
            } else {
                String::new()
            };
            let base = if text.is_empty() {
                format!("Column{}", col - r.c0 + 1)
            } else {
                text
            };
            let kept = |n: &str| {
                t.columns.iter().enumerate().any(|(i, c)| {
                    (r.c0..=r.c1).contains(&(t.c0 + i as u32)) && c.name.eq_ignore_ascii_case(n)
                })
            };
            let name = model_sheet::tables::unique_name(&base, |n| {
                columns.iter().any(|c| c.name.eq_ignore_ascii_case(n)) || kept(n)
            });
            if t.header_row {
                headers.push((r.r0, col, header_input(&name), wb.cell_style_id(cell).0));
            }
            columns.push(TableColumn::new(next_id, &name));
            next_id += 1;
        }
        new.columns = columns;
        if new.r1 < new.r0 + u32::from(new.header_row) + u32::from(new.totals_row) {
            return Err(bad("a table needs a data row"));
        }
        if let Some(af) = new.auto_filter.as_mut() {
            af.columns.retain(|fc| (r.c0..=r.c1).contains(&fc.col));
        }
        self.check_table_area(s, &new, Some(id))?;
        let mut writes = headers;
        // The totals row moves to the new last row.
        if t.totals_row && new.r1 != t.r1 {
            for (i, c) in t.columns.iter().enumerate() {
                let col = t.c0 + i as u32;
                if (r.c0..=r.c1).contains(&col) && c.totals.is_some() {
                    writes.push((
                        t.r1,
                        col,
                        String::new(),
                        wb.cell_style_id(CellCoord::new(s, t.r1, col)).0,
                    ));
                }
            }
            for (i, c) in new.columns.iter().enumerate() {
                let col = new.c0 + i as u32;
                if c.totals.is_some() {
                    writes.retain(|w| !(w.0 == new.r1 && w.1 == col));
                    writes.push((
                        new.r1,
                        col,
                        totals_input(c.totals.as_ref(), &c.name),
                        wb.cell_style_id(CellCoord::new(s, new.r1, col)).0,
                    ));
                }
            }
        }
        let (_, old_last) = t.data_rows();
        let (_, new_last) = new.data_rows();
        let mut acc = self.set_table(s, new.clone())?;
        if new_last > old_last {
            writes.extend(self.calc_writes(s, &new, old_last + 1, new_last));
        }
        let a = self.write(s, writes)?;
        chain(&mut acc, a);
        Ok(acc)
    }
}
