//! The Data tab's tools (P8-35): Text to Columns, Remove Duplicates,
//! Group / Ungroup / Subtotal (outlines), Goal Seek; manual page breaks,
//! pictures, and CSV import/export.

use std::collections::HashSet;

use app_common::{Applied, Patch as _};
use engine_formula::ast::col_to_letters;
use engine_formula::{CellContent, Value};
use model_sheet::textio::{self, Imported, TextImportOptions};
use model_sheet::{
    content_to_input, Axis, CellCoord, CellRange, ChartAnchor, OutlineState, SheetId, Workbook,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{CalcCommand, Rect, SubtotalFunction};
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};
use crate::patch::{CalcPatch, ColView, RowView};
use crate::tables::{chain, empty_applied};

/// The result of Remove Duplicates (Excel's message: "N duplicate
/// values found and removed; M unique values remain").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct DuplicatesResult {
    pub removed: u32,
    pub remaining: u32,
}

/// The result of Goal Seek.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct GoalSeekResult {
    /// A solution within Excel's tolerance (0.001) was found.
    pub found: bool,
    /// The value for the changing cell (the best one tried when not
    /// found).
    pub value: f64,
    /// The set cell's value with it.
    pub result: f64,
    pub iterations: u32,
}

/// What Open (text) learned about a file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct DecodedText {
    pub text: String,
    #[ts(as = "crate::wire_tables::TextEncoding")]
    pub encoding: textio::TextEncoding,
    /// The likely field separator and decimal separator.
    pub separator: String,
    pub decimal: String,
}

/// Excel's Goal Seek limits.
const GOAL_ITERATIONS: u32 = 100;
const GOAL_TOLERANCE: f64 = 0.001;

/// The cell outline state as row/column views.
fn row_views(wb: &Workbook, s: SheetId, plan: &[(u32, OutlineState)]) -> Vec<RowView> {
    plan.iter()
        .map(|&(i, st)| {
            let info = wb.row_info(s, i);
            RowView {
                row: i,
                height: info.height,
                hidden: st.hidden,
                style: info.style.map(|s| s.0),
                filtered: info.filtered && st.hidden,
                outline_level: st.level,
                collapsed: st.collapsed,
            }
        })
        .collect()
}

fn col_views(wb: &Workbook, s: SheetId, plan: &[(u32, OutlineState)]) -> Vec<ColView> {
    plan.iter()
        .map(|&(i, st)| {
            let info = wb.col_info(s, i);
            ColView {
                col: i,
                width: info.width,
                hidden: st.hidden,
                style: info.style.map(|s| s.0),
                outline_level: st.level,
                collapsed: st.collapsed,
            }
        })
        .collect()
}

/// A comparison key of a cell value for Remove Duplicates (text
/// ignoring case; numbers by value).
fn dup_key(v: &Value) -> String {
    match v {
        Value::Empty => "e:".into(),
        Value::Number(n) => format!("n:{n}"),
        Value::Text(t) => format!("t:{}", t.to_lowercase()),
        Value::Bool(b) => format!("b:{b}"),
        Value::Error(e) => format!("x:{e}"),
        Value::Array(_) => dup_key(&v.clone().into_scalar()),
    }
}

impl CalcDocument {
    /// Applies an outline plan as row or column changes.
    fn outline_apply(
        &mut self,
        s: SheetId,
        axis: Axis,
        plan: Vec<(u32, OutlineState)>,
    ) -> Result<CalcApplied> {
        if plan.is_empty() {
            return Ok(empty_applied());
        }
        let wb = self.workbook();
        let mut a = match axis {
            Axis::Rows => self.apply_cmd(&CalcCommand::RestoreRows {
                sheet: s.0,
                rows: row_views(wb, s, &plan),
            })?,
            Axis::Cols => self.apply_cmd(&CalcCommand::RestoreCols {
                sheet: s.0,
                cols: col_views(wb, s, &plan),
            })?,
        };
        a.patch.sheets = Some(self.sheet_infos());
        Ok(a)
    }

    /// The Data tab commands of this module.
    pub(crate) fn data_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        match cmd {
            &C::GroupOutline {
                sheet,
                axis,
                i0,
                i1,
                ungroup,
            } => {
                let s = self.sheet(sheet)?;
                let plan = self
                    .workbook()
                    .group_plan(s, axis, i0.min(i1), i0.max(i1), ungroup)?;
                self.outline_apply(s, axis, plan)
            }
            &C::SetOutlineCollapsed {
                sheet,
                axis,
                index,
                collapsed,
            } => {
                let s = self.sheet(sheet)?;
                let plan = self.workbook().collapse_plan(s, axis, index, collapsed);
                self.outline_apply(s, axis, plan)
            }
            &C::ShowOutlineLevel { sheet, axis, level } => {
                let s = self.sheet(sheet)?;
                let plan = self.workbook().level_plan(s, axis, level.max(1));
                self.outline_apply(s, axis, plan)
            }
            &C::ClearOutline { sheet, axis } => {
                let s = self.sheet(sheet)?;
                let mut acc = empty_applied();
                for ax in [Axis::Rows, Axis::Cols] {
                    if axis.is_some_and(|a| a != ax) {
                        continue;
                    }
                    let plan = self.workbook().clear_outline_plan(s, ax);
                    let a = self.outline_apply(s, ax, plan)?;
                    chain(&mut acc, a);
                }
                acc.patch.sheets = Some(self.sheet_infos());
                Ok(acc)
            }
            &C::SetOutlineProps { sheet, props } => {
                let s = self.sheet(sheet)?;
                let old = self.workbook().outline_props(s);
                self.workbook_mut().set_outline_props(s, props)?;
                Ok(Applied {
                    patch: CalcPatch {
                        sheets: Some(self.sheet_infos()),
                        ..Default::default()
                    },
                    inverse: Some(C::SetOutlineProps { sheet, props: old }),
                })
            }
            C::SetPageBreaks {
                sheet,
                axis,
                breaks,
            } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().page_breaks(s, *axis).to_vec();
                self.workbook_mut()
                    .set_page_breaks(s, *axis, breaks.clone())?;
                Ok(Applied {
                    patch: CalcPatch {
                        sheets: Some(self.sheet_infos()),
                        ..Default::default()
                    },
                    inverse: Some(C::SetPageBreaks {
                        sheet: *sheet,
                        axis: *axis,
                        breaks: old,
                    }),
                })
            }
            C::AddPicture { sheet, picture } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().pictures(s).to_vec();
                self.workbook_mut().add_picture(s, picture.clone())?;
                Ok(self.pictures_applied(*sheet, old))
            }
            C::SetPictureAnchor { sheet, id, anchor } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().pictures(s).to_vec();
                let mut list = old.clone();
                let p = list
                    .iter_mut()
                    .find(|p| p.id == *id)
                    .ok_or(CalcError::InvalidRange)?;
                p.anchor = *anchor;
                self.workbook_mut().set_pictures(s, list)?;
                Ok(self.pictures_applied(*sheet, old))
            }
            C::SetPictureFormat { sheet, id, format } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().pictures(s).to_vec();
                let mut list = old.clone();
                let i = list
                    .iter()
                    .position(|p| p.id == *id)
                    .ok_or(CalcError::InvalidRange)?;
                let mut p = list[i].clone();
                if let Some(n) = &format.name {
                    p.name.clone_from(n);
                }
                if let Some(d) = &format.descr {
                    p.descr.clone_from(d);
                }
                if let Some(placement) = format.placement {
                    // Excel keeps a two-cell anchor and records the choice in `editAs`.
                    if !matches!(p.anchor, ChartAnchor::TwoCell { .. }) {
                        let rect = self.workbook().anchor_px(s, &p.anchor);
                        p.anchor = self.workbook().px_anchor(s, rect);
                    }
                    p.edit_as = placement;
                }
                if let Some(c) = format.crop {
                    p.crop = c;
                }
                if format.no_line {
                    p.line = None;
                } else if let Some(l) = format.line {
                    p.line = Some(l);
                }
                if let Some(t) = format.transparency {
                    p.transparency = t;
                }
                list[i] = p;
                self.workbook_mut().set_pictures(s, list)?;
                Ok(self.pictures_applied(*sheet, old))
            }
            C::ReorderPicture { sheet, id, to } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().pictures(s).to_vec();
                self.workbook_mut().reorder_picture(s, *id, *to)?;
                Ok(self.pictures_applied(*sheet, old))
            }
            C::RemovePicture { sheet, id } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().pictures(s).to_vec();
                let list: Vec<_> = old.iter().filter(|p| p.id != *id).cloned().collect();
                if list.len() == old.len() {
                    return Err(CalcError::InvalidRange);
                }
                self.workbook_mut().set_pictures(s, list)?;
                Ok(self.pictures_applied(*sheet, old))
            }
            C::RestorePictures { sheet, pictures } => {
                let s = self.sheet(*sheet)?;
                let old = self.workbook().pictures(s).to_vec();
                self.workbook_mut().set_pictures(s, pictures.clone())?;
                Ok(self.pictures_applied(*sheet, old))
            }
            &C::RemoveDuplicates {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ref columns,
                has_header,
            } => self.remove_duplicates(sheet, Rect { r0, c0, r1, c1 }, columns, has_header),
            &C::TextToColumns {
                sheet,
                r0,
                c0,
                r1,
                ref options,
                dest,
            } => self.text_to_columns(sheet, r0, c0, r1, options, dest),
            &C::Subtotal {
                sheet,
                r0,
                c0,
                r1,
                c1,
                group_by,
                function,
                ref columns,
                replace,
                summary_below,
            } => self.subtotal(
                sheet,
                Rect { r0, c0, r1, c1 },
                group_by,
                function,
                columns,
                replace,
                summary_below,
            ),
            &C::AutoOutline {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let s = self.sheet(sheet)?;
                let range = self.range(sheet, r0, c0, r1, c1)?;
                let range = if range.rows() == 1 && range.cols() == 1 {
                    let (r, c) = self
                        .workbook()
                        .used_range(s)
                        .ok_or(CalcError::InvalidRange)?;
                    CellRange::new(s, 0, 0, r, c)
                } else {
                    range
                };
                let (rows, cols) = self.workbook().auto_outline_plan(range);
                if rows.is_empty() && cols.is_empty() {
                    // Excel: "Cannot create an outline."
                    return Err(CalcError::Model(model_sheet::Error::InvalidRule(
                        "cannot create an outline".into(),
                    )));
                }
                let mut acc = self.outline_apply(s, Axis::Rows, rows)?;
                let a = self.outline_apply(s, Axis::Cols, cols)?;
                chain(&mut acc, a);
                acc.patch.sheets = Some(self.sheet_infos());
                Ok(acc)
            }
            C::Consolidate {
                sheet,
                row,
                col,
                function,
                sources,
                top_row,
                left_col,
                links,
            } => self.consolidate(
                *sheet, *row, *col, *function, sources, *top_row, *left_col, *links,
            ),
            C::FlashFill { sheet, col, cells } => {
                let s = self.sheet(*sheet)?;
                if cells.is_empty() {
                    return Err(CalcError::InvalidRange);
                }
                let wb = self.workbook();
                let writes = cells
                    .iter()
                    .map(|c| {
                        let st = wb.cell_style_id(CellCoord::new(s, c.row, *col)).0;
                        (c.row, *col, c.input.clone(), st)
                    })
                    .collect();
                self.apply_cmd(&C::RestoreCells {
                    sheet: *sheet,
                    cells: writes,
                })
            }
            &C::RemoveSubtotals {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => self.remove_subtotals(sheet, Rect { r0, c0, r1, c1 }),
            _ => Err(CalcError::InvalidRange),
        }
    }

    fn pictures_applied(&self, sheet: u32, old: Vec<model_sheet::Picture>) -> CalcApplied {
        Applied {
            patch: CalcPatch {
                picture_sheets: vec![sheet],
                ..Default::default()
            },
            inverse: Some(CalcCommand::RestorePictures {
                sheet,
                pictures: old,
            }),
        }
    }

    /// The pictures of a sheet (the `sheetPictures` request).
    pub fn sheet_pictures(&self, sheet: u32) -> Result<Vec<model_sheet::Picture>> {
        Ok(self.workbook().pictures(self.sheet(sheet)?).to_vec())
    }

    /// [`CalcCommand::RemoveDuplicates`].
    fn remove_duplicates(
        &mut self,
        sheet: u32,
        r: Rect,
        columns: &[u32],
        has_header: bool,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let range = self.range(sheet, r.r0, r.c0, r.r1, r.c1)?;
        let wb = self.workbook();
        let table = (range.rows() == 1 && range.cols() == 1)
            .then(|| wb.table_at(CellCoord::new(s, r.r0, r.c0)).cloned())
            .flatten();
        let (range, has_header) = match &table {
            Some(t) => {
                let (d0, d1) = t.data_rows();
                (
                    CellRange::new(s, t.r0, t.c0, d1, t.c1),
                    t.header_row && d0 > t.r0,
                )
            }
            None if range.rows() == 1 && range.cols() == 1 => {
                (wb.current_region(s, r.r0, r.c0), has_header)
            }
            None => (range, has_header),
        };
        let keys: Vec<u32> = if columns.is_empty() {
            (range.c0..=range.c1).collect()
        } else {
            columns
                .iter()
                .copied()
                .filter(|c| (range.c0..=range.c1).contains(c))
                .collect()
        };
        if keys.is_empty() {
            return Err(CalcError::InvalidRange);
        }
        let first = range.r0 + u32::from(has_header);
        let last = range.r1.min(wb.used_range(s).map_or(range.r0, |(r, _)| r));
        let mut seen = HashSet::new();
        let mut kept = Vec::new();
        let mut total = 0u32;
        for row in first..=last {
            total += 1;
            let key: Vec<String> = keys
                .iter()
                .map(|&c| dup_key(&wb.value(CellCoord::new(s, row, c))))
                .collect();
            if seen.insert(key) {
                kept.push(row);
            }
        }
        let removed = total - kept.len() as u32;
        let mut acc = empty_applied();
        if removed > 0 {
            // The kept rows move up inside the range; the rest is emptied.
            let mut cells: Vec<(u32, u32, String, u32)> = Vec::new();
            for (k, &from) in kept.iter().enumerate() {
                let to = first + k as u32;
                for col in range.c0..=range.c1 {
                    let c = CellCoord::new(s, from, col);
                    // Deleted cells shift up: moved formulas keep their references.
                    let input = content_to_input(wb.content(c));
                    if to != from || !matches!(wb.content(c), CellContent::Empty) {
                        cells.push((to, col, input, wb.cell_style_id(c).0));
                    }
                }
            }
            for row in first + kept.len() as u32..=last {
                for col in range.c0..=range.c1 {
                    cells.push((row, col, String::new(), 0));
                }
            }
            cells.retain(|(row, col, input, style)| {
                let c = CellCoord::new(s, *row, *col);
                content_to_input(wb.content(c)) != *input || wb.cell_style_id(c).0 != *style
            });
            let a = self.apply_cmd(&CalcCommand::RestoreCells { sheet, cells })?;
            chain(&mut acc, a);
            if let Some(mut t) = table {
                // The table shrinks by the removed rows (a totals row moves up).
                let had_totals = t.totals_row;
                if had_totals {
                    let a = self.move_totals_row(s, &t, removed)?;
                    chain(&mut acc, a);
                }
                let keep_rows = (kept.len() as u32).max(1);
                t.r1 = first + keep_rows - 1 + u32::from(had_totals);
                let a = self.set_table(s, t)?;
                chain(&mut acc, a);
            }
        }
        acc.patch.duplicates = Some(DuplicatesResult {
            removed,
            remaining: kept.len() as u32,
        });
        Ok(acc)
    }

    /// Moves the totals row of `t` up by `by` rows (Remove Duplicates).
    fn move_totals_row(
        &mut self,
        s: SheetId,
        t: &model_sheet::Table,
        by: u32,
    ) -> Result<CalcApplied> {
        let wb = self.workbook();
        let from = t.r1;
        let to = t.r1 - by;
        let mut cells = Vec::new();
        for col in t.c0..=t.c1 {
            let c = CellCoord::new(s, from, col);
            cells.push((
                to,
                col,
                content_to_input(wb.content(c)),
                wb.cell_style_id(c).0,
            ));
            cells.push((from, col, String::new(), 0));
        }
        // Write the destination after clearing the source.
        cells.sort_by_key(|(r, _, _, _)| u32::from(*r != from));
        self.apply_cmd(&CalcCommand::RestoreCells { sheet: s.0, cells })
    }

    /// [`CalcCommand::Consolidate`].
    #[allow(clippy::too_many_arguments)]
    fn consolidate(
        &mut self,
        sheet: u32,
        row: u32,
        col: u32,
        function: model_sheet::ConsolidateFunction,
        sources: &[crate::command::SheetRect],
        top_row: bool,
        left_col: bool,
        links: bool,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let mut ranges = Vec::new();
        for r in sources {
            let range = self.range(r.sheet, r.r0, r.c0, r.r1, r.c1)?;
            ranges.push(range);
        }
        let spec = model_sheet::ConsolidateSpec {
            function,
            sources: ranges,
            top_row,
            left_col,
            links,
        };
        let plan = self
            .workbook()
            .consolidate_plan(&spec, CellCoord::new(s, row, col))?;
        let wb = self.workbook();
        let (mut r1, mut c1) = (row, col);
        let cells: Vec<(u32, u32, String, u32)> = plan
            .into_iter()
            .map(|(r, c, input)| {
                r1 = r1.max(r);
                c1 = c1.max(c);
                (r, c, input, wb.cell_style_id(CellCoord::new(s, r, c)).0)
            })
            .collect();
        let mut acc = self.apply_cmd(&CalcCommand::RestoreCells { sheet, cells })?;
        // Excel names the destination `Consolidate_Area`.
        let area = format!(
            "{}{}",
            model_sheet::names::sheet_prefix(
                self.workbook().engine().sheet_name(s).unwrap_or_default()
            ),
            model_sheet::names::abs_area(row, col, r1, c1)
        );
        let recalc = self.workbook_mut().set_builtin_name(
            s,
            model_sheet::BuiltinName::ConsolidateArea,
            Some(&area),
        )?;
        acc.patch.merge(self.content_patch([], &recalc));
        acc.patch.names = Some(self.name_infos());
        Ok(acc)
    }

    /// [`CalcCommand::TextToColumns`].
    fn text_to_columns(
        &mut self,
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        options: &TextImportOptions,
        dest: Option<(u32, u32)>,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        self.range(sheet, r0, c0, r1, c0)?;
        let wb = self.workbook();
        let records: Vec<Vec<String>> = (r0..=r1)
            .map(|r| {
                let c = CellCoord::new(s, r, c0);
                match wb.value(c) {
                    Value::Empty => Vec::new(),
                    Value::Text(t) => textio::split_line(&t, options),
                    _ => textio::split_line(&wb.display_text(c), options),
                }
            })
            .collect();
        let (dr, dc) = dest.unwrap_or((r0, c0));
        let plan = textio::import_plan(&records, options);
        let date_fmt = "m/d/yyyy";
        let mut cells = Vec::new();
        let styles_before = self.workbook().styles().len();
        for (rr, cc, v) in plan {
            let row = dr + rr;
            let col = dc + cc;
            if row > engine_formula::ast::MAX_ROW || col > engine_formula::ast::MAX_COL {
                return Err(CalcError::InvalidRange);
            }
            let c = CellCoord::new(s, row, col);
            let style = self.workbook().cell_style_id(c);
            let (input, style) = match v {
                Imported::Empty => (String::new(), style),
                Imported::Input(t) => (t, style),
                Imported::Date(n) => {
                    let mut st = self.workbook().styles().get(style).clone();
                    st.number_format = Some(date_fmt.into());
                    (format!("{n}"), self.workbook_mut().intern_style(&st))
                }
            };
            cells.push((row, col, input, style.0));
        }
        // Rows that split into nothing keep their cell (Excel).
        let mut a = self.apply_cmd(&CalcCommand::RestoreCells { sheet, cells })?;
        if self.workbook().styles().len() != styles_before {
            a.patch.styles = Some(
                self.workbook()
                    .styles()
                    .iter()
                    .map(|(_, s)| s.clone())
                    .collect(),
            );
        }
        Ok(a)
    }

    /// [`CalcCommand::Subtotal`].
    #[allow(clippy::too_many_arguments)]
    fn subtotal(
        &mut self,
        sheet: u32,
        r: Rect,
        group_by: u32,
        function: SubtotalFunction,
        columns: &[u32],
        replace: bool,
        summary_below: bool,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        self.range(sheet, r.r0, r.c0, r.r1, r.c1)?;
        let mut acc = empty_applied();
        let mut rect = r;
        if replace {
            let before = self.workbook().used_range(s).map_or(0, |(r, _)| r);
            let a = self.remove_subtotals(sheet, rect)?;
            chain(&mut acc, a);
            let after = self.workbook().used_range(s).map_or(0, |(r, _)| r);
            rect.r1 = rect.r1.saturating_sub(before.saturating_sub(after));
        }
        if !(rect.c0..=rect.c1).contains(&group_by)
            || columns.iter().any(|c| !(rect.c0..=rect.c1).contains(c))
        {
            return Err(CalcError::InvalidRange);
        }
        let wb = self.workbook();
        let last_used = wb.used_range(s).map_or(rect.r0, |(r, _)| r);
        let (d0, d1) = (rect.r0 + 1, rect.r1.min(last_used));
        if d0 > d1 {
            return Err(CalcError::InvalidRange);
        }
        // The groups: runs of equal labels in the group-by column.
        let label = |row: u32| wb.display_text(CellCoord::new(s, row, group_by));
        let mut groups: Vec<(u32, u32, String)> = Vec::new();
        for row in d0..=d1 {
            let l = label(row);
            match groups.last_mut() {
                Some((_, end, name)) if name.to_lowercase() == l.to_lowercase() => *end = row,
                _ => groups.push((row, row, l)),
            }
        }
        let n = groups.len() as u32;
        // Insert the summary rows bottom-up (positions above stay valid).
        let mut commands = Vec::new();
        if summary_below {
            for (i, (_, end, _)) in groups.iter().enumerate().rev() {
                let count = if i as u32 == n - 1 { 2 } else { 1 };
                commands.push(CalcCommand::InsertRows {
                    sheet,
                    at: end + 1,
                    count,
                });
            }
        } else {
            for (start, _, _) in groups.iter().rev() {
                commands.push(CalcCommand::InsertRows {
                    sheet,
                    at: *start,
                    count: 1,
                });
            }
            commands.push(CalcCommand::InsertRows {
                sheet,
                at: d0,
                count: 1,
            });
        }
        let a = self.apply_cmd(&CalcCommand::Compound { commands })?;
        chain(&mut acc, a);
        // Final positions.
        let code = function.code();
        let mut cells: Vec<(u32, u32, String, u32)> = Vec::new();
        let mut levels: Vec<(u32, OutlineState)> = Vec::new();
        let col_name = |c: u32| col_to_letters(c);
        let sub = |c: u32, a: u32, b: u32| {
            format!(
                "=SUBTOTAL({code},{}{}:{}{})",
                col_name(c),
                a + 1,
                col_name(c),
                b + 1
            )
        };
        let (grand_row, all0, all1);
        if summary_below {
            for (offset, (start, end, name)) in (0u32..).zip(groups.iter()) {
                let a = start + offset;
                let b = end + offset;
                let row = b + 1;
                for d in a..=b {
                    levels.push((
                        d,
                        OutlineState {
                            level: 2,
                            hidden: false,
                            collapsed: false,
                        },
                    ));
                }
                levels.push((
                    row,
                    OutlineState {
                        level: 1,
                        hidden: false,
                        collapsed: false,
                    },
                ));
                cells.push((
                    row,
                    group_by,
                    model_sheet::tables::header_input(&format!("{name} Total")),
                    0,
                ));
                for &c in columns {
                    cells.push((row, c, sub(c, a, b), 0));
                }
            }
            all0 = d0;
            all1 = d1 + n;
            grand_row = all1 + 1;
        } else {
            grand_row = d0;
            for (offset, (start, end, name)) in (1u32..).zip(groups.iter()) {
                let row = start + offset;
                let a = row + 1;
                let b = end + offset + 1;
                levels.push((
                    row,
                    OutlineState {
                        level: 1,
                        hidden: false,
                        collapsed: false,
                    },
                ));
                for d in a..=b {
                    levels.push((
                        d,
                        OutlineState {
                            level: 2,
                            hidden: false,
                            collapsed: false,
                        },
                    ));
                }
                cells.push((
                    row,
                    group_by,
                    model_sheet::tables::header_input(&format!("{name} Total")),
                    0,
                ));
                for &c in columns {
                    cells.push((row, c, sub(c, a, b), 0));
                }
            }
            all0 = d0 + 1;
            all1 = d1 + n + 1;
        }
        cells.push((grand_row, group_by, "Grand Total".into(), 0));
        for &c in columns {
            cells.push((grand_row, c, sub(c, all0, all1), 0));
        }
        // Labels and totals bold, as Excel shows them.
        let wbm = self.workbook_mut();
        for cell in &mut cells {
            let c = CellCoord::new(s, cell.0, cell.1);
            let mut st = wbm.styles().get(wbm.cell_style_id(c)).clone();
            if cell.1 == group_by {
                st.font.bold = Some(true);
            }
            cell.3 = wbm.intern_style(&st).0;
        }
        let a = self.apply_cmd(&CalcCommand::RestoreCells { sheet, cells })?;
        chain(&mut acc, a);
        let props = model_sheet::OutlineProps {
            summary_below,
            ..self.workbook().outline_props(s)
        };
        let a = self.apply_cmd(&CalcCommand::SetOutlineProps { sheet, props })?;
        chain(&mut acc, a);
        let a = self.outline_apply(s, Axis::Rows, levels)?;
        chain(&mut acc, a);
        acc.patch.styles = Some(
            self.workbook()
                .styles()
                .iter()
                .map(|(_, s)| s.clone())
                .collect(),
        );
        acc.patch.sheets = Some(self.sheet_infos());
        Ok(acc)
    }

    /// [`CalcCommand::RemoveSubtotals`]: deletes the rows of the range
    /// holding a `SUBTOTAL` formula and clears the row outline.
    fn remove_subtotals(&mut self, sheet: u32, r: Rect) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        self.range(sheet, r.r0, r.c0, r.r1, r.c1)?;
        let wb = self.workbook();
        let mut rows: Vec<u32> = wb
            .cells_in(CellRange::new(s, r.r0, r.c0, r.r1, r.c1))
            .filter(|(_, content, _)| {
                matches!(content, CellContent::Formula { text, .. } if text.to_ascii_uppercase().starts_with("=SUBTOTAL("))
            })
            .map(|(c, _, _)| c.row)
            .collect();
        rows.sort_unstable();
        rows.dedup();
        let mut commands: Vec<CalcCommand> = rows
            .iter()
            .rev()
            .map(|&at| CalcCommand::DeleteRows {
                sheet,
                at,
                count: 1,
            })
            .collect();
        let mut acc = empty_applied();
        if !commands.is_empty() {
            let a = self.apply_cmd(&CalcCommand::Compound {
                commands: std::mem::take(&mut commands),
            })?;
            chain(&mut acc, a);
        }
        let plan = self.workbook().clear_outline_plan(s, Axis::Rows);
        let a = self.outline_apply(s, Axis::Rows, plan)?;
        chain(&mut acc, a);
        acc.patch.sheets = Some(self.sheet_infos());
        Ok(acc)
    }

    /// Goal Seek: the value of the changing cell that makes the set cell
    /// (a formula) equal `goal`. The document is left unchanged (the UI
    /// applies the value). Secant steps with bisection once the goal is
    /// bracketed; Excel's limits (100 iterations, 0.001).
    pub fn goal_seek(
        &mut self,
        sheet: u32,
        set: (u32, u32),
        goal: f64,
        changing: (u32, u32),
    ) -> Result<GoalSeekResult> {
        let s = self.sheet(sheet)?;
        let target = CellCoord::new(s, set.0, set.1);
        let var = CellCoord::new(s, changing.0, changing.1);
        if !matches!(self.workbook().content(target), CellContent::Formula { .. }) {
            return Err(CalcError::GoalSeek(
                "the set cell must contain a formula".into(),
            ));
        }
        let original = content_to_input(self.workbook().content(var));
        let x0 = match self.workbook().content(var) {
            CellContent::Formula { .. } => {
                return Err(CalcError::GoalSeek(
                    "the changing cell must contain a value".into(),
                ))
            }
            CellContent::Value(Value::Number(n)) => *n,
            CellContent::Empty => 0.0,
            _ => {
                return Err(CalcError::GoalSeek(
                    "the changing cell must contain a number".into(),
                ))
            }
        };
        let eval = |doc: &mut CalcDocument, x: f64| -> Option<f64> {
            doc.workbook_mut()
                .set_content(var, CellContent::Value(Value::Number(x)))
                .ok()?;
            match doc.workbook().value(target) {
                Value::Number(n) if n.is_finite() => Some(n - goal),
                Value::Empty => Some(-goal),
                _ => None,
            }
        };
        let mut iterations = 0u32;
        let mut best = (x0, f64::INFINITY);
        let mut found = false;
        let mut xa = x0;
        let mut fa = eval(self, xa);
        let mut xb = if x0 == 0.0 { 0.01 } else { x0 * 1.01 };
        let mut bracket: Option<(f64, f64, f64, f64)> = None; // (lo, f(lo), hi, f(hi))
        if let Some(f) = fa {
            best = (x0, f.abs());
            found = f.abs() < GOAL_TOLERANCE;
        }
        while !found && iterations < GOAL_ITERATIONS {
            iterations += 1;
            let fb = eval(self, xb);
            if let Some(f) = fb {
                if f.abs() < best.1 {
                    best = (xb, f.abs());
                }
                if f.abs() < GOAL_TOLERANCE {
                    found = true;
                    break;
                }
                if let Some(fa) = fa {
                    if fa.signum() != f.signum() {
                        bracket = Some(if xa < xb {
                            (xa, fa, xb, f)
                        } else {
                            (xb, f, xa, fa)
                        });
                    }
                }
            }
            let next = match (fa, fb, bracket) {
                (_, _, Some((lo, flo, hi, fhi))) => {
                    // Keep the bracket around the root; regula falsi with a midpoint fallback.
                    let (lo, flo, hi, fhi) = match fb {
                        Some(f) if xb > lo && xb < hi => {
                            if f.signum() == flo.signum() {
                                (xb, f, hi, fhi)
                            } else {
                                (lo, flo, xb, f)
                            }
                        }
                        _ => (lo, flo, hi, fhi),
                    };
                    bracket = Some((lo, flo, hi, fhi));
                    let x = lo - flo * (hi - lo) / (fhi - flo);
                    if x.is_finite() && x > lo && x < hi && iterations % 3 != 0 {
                        x
                    } else {
                        (lo + hi) / 2.0
                    }
                }
                (Some(fa), Some(fb), None) if fb != fa => {
                    let x = xb - fb * (xb - xa) / (fb - fa);
                    if x.is_finite() {
                        x
                    } else {
                        xb * 2.0 + 1.0
                    }
                }
                (_, Some(_), None) => xb + (xb - xa).abs().max(1.0),
                _ => (xa + xb) / 2.0,
            };
            xa = xb;
            fa = fb;
            xb = next;
        }
        let mut value = best.0;
        if found {
            // Prefer the shortest decimal that is at least as close (`30`, not `29.99999999999956`).
            for digits in 0..=12 {
                let m = 10f64.powi(digits);
                let c = (value * m).round() / m;
                if c == value {
                    break;
                }
                if eval(self, c).is_some_and(|f| f.abs() <= best.1) {
                    value = c;
                    break;
                }
            }
        }
        let result = eval(self, value).map_or(f64::NAN, |f| f + goal);
        // Back to the original content.
        let _ = self.workbook_mut().set_input(var, &original);
        Ok(GoalSeekResult {
            found,
            value,
            result,
            iterations,
        })
    }

    /// A new document from a text file (Open of a `.csv`/`.txt` through
    /// the import wizard).
    pub fn open_text(text: &str, name: &str, options: &TextImportOptions) -> Result<Self> {
        let mut wb = Workbook::new();
        let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
        let sheet_name: String = stem
            .chars()
            .filter(|c| !"[]*?/\\:".contains(*c))
            .take(31)
            .collect();
        if !sheet_name.is_empty() {
            let _ = wb.rename_sheet(SheetId(0), &sheet_name);
        }
        let records = textio::split_records(text, options);
        wb.begin_batch();
        let r = wb.import_records(SheetId(0), 0, 0, &records, options);
        wb.end_batch();
        r?;
        let mut doc = CalcDocument::from_workbook(wb);
        doc.source_name = Some(name.to_owned());
        Ok(doc)
    }

    /// Save As CSV of one sheet.
    pub fn save_csv(&self, sheet: u32, options: &textio::CsvOptions) -> Result<Vec<u8>> {
        Ok(self.workbook().to_csv(self.sheet(sheet)?, options))
    }
}

/// Decodes a text file and guesses its separators (the first step of the
/// import wizard).
pub fn decode_text(bytes: &[u8], encoding: Option<textio::TextEncoding>) -> DecodedText {
    let (text, encoding) = textio::decode_text(bytes, encoding);
    let separator = textio::detect_separator(&text);
    let decimal = textio::detect_decimal(&text, separator);
    DecodedText {
        text,
        encoding,
        separator: separator.to_string(),
        decimal: decimal.to_string(),
    }
}

/// The wizard's preview: the first `max` records of `text` split with
/// `options` (fields as text).
pub fn split_preview(text: &str, options: &TextImportOptions, max: usize) -> Vec<Vec<String>> {
    let mut out = textio::split_records(text, options);
    out.truncate(max);
    out
}
