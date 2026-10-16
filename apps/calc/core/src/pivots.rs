//! Pivot tables (P8-30): the pivot commands and their inverses, the
//! `pivotInfo` / `pivotAt` / `pivotItems` requests, the `pivot` part of
//! cell views, stale caches, and how other commands undo pivot changes.
//!
//! Undo works by state, like annotations: a pivot command's inverse is
//! `RestoreCells` of every cell it wrote (the model's write journal) plus
//! `RestorePivots` of the previous caches and tables. Commands that change
//! pivot tables as a side effect (row/column inserts and deletes, sheet
//! deletion, duplication, renaming) get `RestorePivots` appended to their
//! inverse by [`CalcDocument::mark_pivots`]. Stale flags are not undone
//! (as in Excel, where a refresh is needed after any source edit).

use std::collections::{BTreeMap, BTreeSet};

use app_common::{Applied, Patch};
use model_sheet::pivot::{
    CellRole, FieldKind, Item, PageSelection, PivotCache, PivotSource, PivotTable,
};
use model_sheet::{content_to_input, CellCoord, SheetId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{CalcCommand, Rect};
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};
use crate::patch::CalcPatch;

/// The source of a new pivot table: a range (a single cell: its current
/// region, as Excel does) or a defined name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PivotSourceSpec {
    Range {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    Name {
        name: String,
    },
}

/// Where a pivot table goes: a cell, or a new sheet (inserted before the
/// source sheet, the table at A3, as in Excel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PivotTarget {
    Cell { sheet: u32, row: u32, col: u32 },
    NewSheet,
}

/// The parts of a pivot table [`CalcCommand::UpdatePivot`] changes;
/// absent = unchanged. Lists replace the whole axis.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Vec<crate::wire_pivot::AxisField>>")]
    pub rows: Option<Vec<model_sheet::pivot::AxisField>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Vec<crate::wire_pivot::AxisField>>")]
    pub cols: Option<Vec<model_sheet::pivot::AxisField>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Vec<crate::wire_pivot::DataField>>")]
    pub values: Option<Vec<model_sheet::pivot::DataField>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<Vec<crate::wire_pivot::PageField>>")]
    pub filters: Option<Vec<model_sheet::pivot::PageField>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire_pivot::PivotOptions>")]
    pub options: Option<model_sheet::pivot::PivotOptions>,
    /// Excel's Report Layout: sets the layout of every row field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire_pivot::PivotLayout>")]
    pub layout: Option<model_sheet::pivot::PivotLayout>,
}

/// The pivot tables of one sheet ([`CalcCommand::RestorePivots`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetPivots {
    pub sheet: u32,
    #[ts(as = "Vec<crate::wire_pivot::PivotTable>")]
    pub pivots: Vec<PivotTable>,
}

/// The `pivot` part of a [`CellView`](crate::CellView).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotCellView {
    /// The pivot table.
    pub id: u32,
    #[ts(as = "crate::wire_pivot::PivotCellKind")]
    pub kind: CellRole,
    /// Axis depth (0 = outermost field).
    pub level: u8,
    /// Labels of items with inner items: collapsed (`+`) or expanded
    /// (`−`); absent = no button.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub collapsed: Option<bool>,
    /// The cache field of a label, field header or page cell (for the
    /// expand button and the filter dropdown).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub field: Option<u32>,
    /// The shared item of a label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item: Option<u32>,
}

/// A pivot table of a sheet, for drawing (region snapshots).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotSummary {
    pub id: u32,
    pub name: String,
    /// Everything the table occupies (page fields included).
    pub location: Rect,
    /// The table without page fields.
    pub table: Rect,
    /// The pivot style (`PivotStyleLight16`) and its options.
    pub style: String,
    pub banded: bool,
    /// Banded columns.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub banded_cols: bool,
    pub row_headers: bool,
    pub col_headers: bool,
    /// The source changed since the last refresh.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub stale: bool,
    /// An unsupported table from a file: read-only.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub read_only: bool,
}

/// Where a cache field is used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PivotArea {
    Rows,
    Columns,
    Filters,
}

/// A cache field in the field list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotFieldInfo {
    pub index: u32,
    pub name: String,
    #[ts(as = "crate::wire_pivot::FieldKind")]
    pub kind: FieldKind,
    /// Number of distinct items.
    pub items: u32,
    /// The axis it is on; absent = none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub area: Option<PivotArea>,
    /// Used by a data field.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub value: bool,
}

/// The reply to `pivotInfo`: the field list and the current layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotInfo {
    pub sheet: u32,
    #[ts(as = "crate::wire_pivot::PivotTable")]
    pub table: PivotTable,
    #[ts(as = "crate::wire_pivot::PivotSource")]
    pub source: PivotSource,
    pub fields: Vec<PivotFieldInfo>,
    /// The captions of the data fields (`Sum of Sales`), in order.
    pub captions: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub stale: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub read_only: bool,
}

/// One item of `pivotItems`, in display order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotItemInfo {
    /// Shared item index (what commands use).
    pub index: u32,
    pub label: String,
    #[ts(as = "crate::wire_pivot::PivotItem")]
    pub value: Item,
    /// Checked in the dropdown: not hidden (axis field) / selected (page
    /// field).
    pub checked: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub collapsed: bool,
    /// The item has records at present (Excel lists retained items too).
    pub has_data: bool,
}

/// The reply to `pivotAt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PivotAt {
    pub id: u32,
    pub name: String,
    /// The cell's role; absent for a cell between page fields and table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cell: Option<PivotCellView>,
}

/// The pivot state of the workbook (undo).
pub(crate) type PivotState = (Vec<PivotCache>, Vec<SheetPivots>);

fn rect(r: model_sheet::pivot::PivotRect) -> Rect {
    Rect {
        r0: r.r0,
        c0: r.c0,
        r1: r.r1,
        c1: r.c1,
    }
}

fn bad(m: &str) -> CalcError {
    model_sheet::Error::InvalidPivot(m.into()).into()
}

impl CalcDocument {
    /// The caches and every sheet's tables.
    pub(crate) fn pivot_state(&self) -> PivotState {
        let wb = self.workbook();
        (
            wb.pivot_caches().to_vec(),
            wb.sheets()
                .into_iter()
                .filter(|(s, _)| !wb.pivots(*s).is_empty())
                .map(|(s, _)| SheetPivots {
                    sheet: s.0,
                    pivots: wb.pivots(s).to_vec(),
                })
                .collect(),
        )
    }

    fn has_pivots(&self) -> bool {
        !self.workbook().pivot_caches().is_empty()
    }

    /// Whether `cmd` may change pivot tables as a side effect.
    pub(crate) fn may_touch_pivots(&self, cmd: &CalcCommand) -> bool {
        use CalcCommand as C;
        self.has_pivots()
            && matches!(
                cmd,
                C::InsertRows { .. }
                    | C::DeleteRows { .. }
                    | C::InsertCols { .. }
                    | C::DeleteCols { .. }
                    | C::DeleteSheet { .. }
                    | C::DuplicateSheet { .. }
                    | C::RenameSheet { .. }
                    | C::RestoreSheet { .. }
                    | C::Compound { .. }
            )
    }

    /// After a command that may have changed pivot tables as a side
    /// effect: reports the sheets and appends the restore to the inverse.
    pub(crate) fn mark_pivots(&self, before: Option<PivotState>, applied: &mut CalcApplied) {
        let Some(before) = before else { return };
        let after = self.pivot_state();
        if before == after {
            return;
        }
        let sheets: BTreeSet<u32> = before
            .1
            .iter()
            .chain(&after.1)
            .map(|s| s.sheet)
            .filter(|s| self.sheet(*s).is_ok())
            .collect();
        applied.patch.merge(CalcPatch {
            pivot_sheets: sheets.into_iter().collect(),
            ..Default::default()
        });
        let restore = CalcCommand::RestorePivots {
            caches: before.0,
            sheets: before.1,
        };
        let mut commands = match applied.inverse.take() {
            Some(CalcCommand::Compound { commands }) if commands.is_empty() => Vec::new(),
            Some(inv) => vec![inv],
            None => Vec::new(),
        };
        commands.push(restore);
        applied.inverse = Some(if commands.len() == 1 {
            commands.pop().expect("one")
        } else {
            CalcCommand::Compound { commands }
        });
    }

    /// After any command: caches whose source cells changed become stale;
    /// the patch lists the stale tables when that set changed.
    pub(crate) fn mark_stale(&mut self, before: Vec<u32>, applied: &mut CalcApplied) {
        if !self.has_pivots() {
            return;
        }
        let cells: Vec<CellCoord> = applied
            .patch
            .cells
            .iter()
            .flat_map(|g| {
                g.cells
                    .iter()
                    .map(move |c| CellCoord::new(SheetId(g.sheet), c.row, c.col))
            })
            .collect();
        self.workbook_mut().mark_pivot_sources_stale(&cells);
        let after = self.workbook().stale_pivots();
        if after != before {
            applied.patch.stale_pivots = Some(after);
        }
    }

    /// The `pivot` part of the view of `c`.
    pub(crate) fn pivot_cell_view(&self, c: CellCoord) -> Option<PivotCellView> {
        let (id, cell) = self.workbook().pivot_cell(c)?;
        Some(PivotCellView {
            id,
            kind: cell.kind,
            level: cell.level,
            collapsed: cell.collapsed,
            field: cell.field,
            item: cell.item,
        })
    }

    /// The pivot tables of `s` for a region snapshot.
    pub(crate) fn pivot_summaries(&self, s: SheetId) -> Vec<PivotSummary> {
        let wb = self.workbook();
        wb.pivots(s)
            .iter()
            .map(|p| {
                let table = wb.pivot_output(p.id).map_or(p.location, |o| o.table);
                PivotSummary {
                    id: p.id,
                    name: p.name.clone(),
                    location: rect(p.location),
                    table: rect(table),
                    style: p.options.style.clone(),
                    banded: p.options.banded,
                    banded_cols: p.options.banded_cols,
                    row_headers: p.options.row_headers_bold,
                    col_headers: p.options.col_headers_bold,
                    stale: wb.pivot_cache(p.cache_id).is_some_and(|c| c.stale),
                    read_only: p.raw.is_some(),
                }
            })
            .collect()
    }

    // --- requests -------------------------------------------------------------------

    /// `pivotInfo`.
    pub fn pivot_info(&self, id: u32) -> Result<PivotInfo> {
        let wb = self.workbook();
        let (s, t) = wb.pivot(id).ok_or(model_sheet::Error::UnknownPivot(id))?;
        let cache = wb.pivot_cache(t.cache_id).ok_or_else(|| bad("no cache"))?;
        let fields = cache
            .fields
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let i = i as u32;
                let area = if t.rows.iter().any(|a| a.field == i) {
                    Some(PivotArea::Rows)
                } else if t.cols.iter().any(|a| a.field == i) {
                    Some(PivotArea::Columns)
                } else if t.filters.iter().any(|p| p.field == i) {
                    Some(PivotArea::Filters)
                } else {
                    None
                };
                PivotFieldInfo {
                    index: i,
                    name: f.name.clone(),
                    kind: f.kind,
                    items: f.shared_items.len() as u32,
                    area,
                    value: t.values.iter().any(|d| d.field == i),
                }
            })
            .collect();
        Ok(PivotInfo {
            sheet: s.0,
            captions: t.values.iter().map(|d| d.caption(cache)).collect(),
            table: t.clone(),
            source: cache.source.clone(),
            fields,
            stale: cache.stale,
            read_only: t.raw.is_some(),
        })
    }

    /// `pivotAt`.
    pub fn pivot_at(&self, sheet: u32, row: u32, col: u32) -> Result<Option<PivotAt>> {
        let s = self.sheet(sheet)?;
        let c = CellCoord::new(s, row, col);
        let wb = self.workbook();
        let Some(t) = wb.pivots(s).iter().find(|p| p.location.contains(row, col)) else {
            return Ok(None);
        };
        Ok(Some(PivotAt {
            id: t.id,
            name: t.name.clone(),
            cell: self.pivot_cell_view(c),
        }))
    }

    /// `pivotItems`: the items of `field` in display order.
    pub fn pivot_items(&self, id: u32, field: u32) -> Result<Vec<PivotItemInfo>> {
        let wb = self.workbook();
        let (_, t) = wb.pivot(id).ok_or(model_sheet::Error::UnknownPivot(id))?;
        let cache = wb.pivot_cache(t.cache_id).ok_or_else(|| bad("no cache"))?;
        let cf = cache
            .fields
            .get(field as usize)
            .ok_or_else(|| bad("no such field"))?;
        let present: BTreeSet<u32> = cache
            .records
            .iter()
            .filter_map(|r| cf.item_index(r.get(field as usize)?))
            .collect();
        let axis = t.axis_field(field);
        let page = t.filters.iter().find(|p| p.field == field);
        Ok(t.item_order(cache, field)
            .into_iter()
            .map(|i| PivotItemInfo {
                index: i,
                label: cf.item_label(i),
                value: cf.shared_items[i as usize].clone(),
                checked: match (axis, page) {
                    (Some(a), _) => !a.hidden_items.contains(&i),
                    (None, Some(p)) => match &p.selected {
                        PageSelection::All => true,
                        PageSelection::Items { items } => items.contains(&i),
                    },
                    _ => true,
                },
                collapsed: axis.is_some_and(|a| a.collapsed_items.contains(&i)),
                has_data: present.contains(&i),
            })
            .collect())
    }

    // --- commands -------------------------------------------------------------------

    /// The patch and inverse of a pivot command from the write journal
    /// and the state before.
    fn pivot_applied(
        &mut self,
        before: PivotState,
        recalc: model_sheet::Recalc,
        extra_inverse: Vec<CalcCommand>,
    ) -> CalcApplied {
        let journal = self.workbook_mut().take_pivot_journal();
        let mut restore: BTreeMap<u32, Vec<(u32, u32, String, u32)>> = BTreeMap::new();
        for (c, content, style) in &journal.cells {
            restore.entry(c.sheet.0).or_default().push((
                c.row,
                c.col,
                content_to_input(content),
                style.0,
            ));
        }
        let mut sheets: BTreeSet<u32> = before
            .1
            .iter()
            .map(|s| s.sheet)
            .chain(self.pivot_state().1.iter().map(|s| s.sheet))
            .collect();
        sheets.extend(restore.keys());
        let sheets: Vec<u32> = sheets
            .into_iter()
            .filter(|s| self.sheet(*s).is_ok())
            .collect();
        let coords = journal.cells.iter().map(|(c, _, _)| *c);
        let mut patch = self.content_patch(coords, &recalc);
        patch.pivot_sheets = sheets;
        let mut inverse: Vec<CalcCommand> = restore
            .into_iter()
            .map(|(sheet, cells)| CalcCommand::RestoreCells { sheet, cells })
            .collect();
        inverse.push(CalcCommand::RestorePivots {
            caches: before.0,
            sheets: before.1,
        });
        inverse.extend(extra_inverse);
        Applied {
            patch,
            inverse: Some(CalcCommand::Compound { commands: inverse }),
        }
    }

    fn source_of(&self, spec: &PivotSourceSpec) -> Result<PivotSource> {
        Ok(match spec {
            &PivotSourceSpec::Range {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let range = self.range(sheet, r0, c0, r1, c1)?;
                // A cell of a table: the table (Excel names it as the source).
                if r0 == r1 && c0 == c1 {
                    if let Some(t) =
                        self.workbook()
                            .table_at(model_sheet::CellCoord::new(range.sheet, r0, c0))
                    {
                        return Ok(PivotSource::Table {
                            name: t.name.clone(),
                        });
                    }
                }
                let range = if r0 == r1 && c0 == c1 {
                    self.workbook().current_region(range.sheet, r0, c0)
                } else {
                    range
                };
                let name = self
                    .workbook()
                    .engine()
                    .sheet_name(range.sheet)
                    .unwrap_or_default()
                    .to_owned();
                PivotSource::range(&name, range.r0, range.c0, range.r1, range.c1)
            }
            PivotSourceSpec::Name { name } if self.workbook().table_by_name(name).is_some() => {
                PivotSource::Table { name: name.clone() }
            }
            PivotSourceSpec::Name { name } => PivotSource::Name { name: name.clone() },
        })
    }

    /// A new sheet for a pivot table (`Sheet<n>`, before `before`):
    /// returns its id and the inverse that deletes it.
    fn new_pivot_sheet(
        &mut self,
        before: Option<SheetId>,
    ) -> Result<(SheetId, CalcCommand, CalcPatch)> {
        let names: BTreeSet<String> = self
            .workbook()
            .sheets()
            .into_iter()
            .map(|(_, n)| n.to_lowercase())
            .collect();
        let name = (1u32..)
            .map(|n| format!("Sheet{n}"))
            .find(|n| !names.contains(&n.to_lowercase()))
            .expect("unbounded");
        let index = before
            .and_then(|s| self.workbook().sheet_position(s))
            .map(|p| p as u32);
        let applied = self.apply_cmd(&CalcCommand::AddSheet {
            name: name.clone(),
            index,
        })?;
        let id = self
            .workbook()
            .sheet_id(&name)
            .ok_or(CalcError::UnknownSheet(0))?;
        let inverse = applied
            .inverse
            .unwrap_or(CalcCommand::DeleteSheet { sheet: id.0 });
        Ok((id, inverse, applied.patch))
    }

    /// Applies one of the pivot commands ([`CalcCommand::CreatePivot`] to
    /// [`CalcCommand::RestorePivots`]).
    pub(crate) fn pivot_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        let before = self.pivot_state();
        if let C::RestorePivots { caches, sheets } = cmd {
            let tables = sheets
                .iter()
                .map(|s| (SheetId(s.sheet), s.pivots.clone()))
                .collect();
            self.workbook_mut()
                .restore_pivot_state(caches.clone(), tables);
            let mut sheets: BTreeSet<u32> = before.1.iter().map(|s| s.sheet).collect();
            sheets.extend(self.pivot_state().1.iter().map(|s| s.sheet));
            let recalc = self.workbook_mut().recalc_all();
            let mut patch = self.content_patch([], &recalc);
            patch.pivot_sheets = sheets
                .into_iter()
                .filter(|s| self.sheet(*s).is_ok())
                .collect();
            patch.stale_pivots = Some(self.workbook().stale_pivots());
            return Ok(Applied {
                patch,
                inverse: Some(C::RestorePivots {
                    caches: before.0,
                    sheets: before.1,
                }),
            });
        }
        let styles_before = self.workbook().styles().len();
        self.workbook_mut().start_pivot_journal();
        let result = self.pivot_cmd_inner(cmd);
        match result {
            Ok((recalc, extra, extra_patch)) => {
                let mut applied = self.pivot_applied(before, recalc, extra);
                // Layouts intern number formats and indents: the grown
                // style table comes with the patch.
                if self.workbook().styles().len() != styles_before {
                    applied.patch.styles = Some(
                        self.workbook()
                            .styles()
                            .iter()
                            .map(|(_, s)| s.clone())
                            .collect(),
                    );
                }
                if let Some(p) = extra_patch {
                    let mut p = p;
                    p.merge(std::mem::take(&mut applied.patch));
                    applied.patch = p;
                }
                Ok(applied)
            }
            Err(e) => {
                let _ = self.workbook_mut().take_pivot_journal();
                Err(e)
            }
        }
    }

    #[allow(clippy::type_complexity)]
    fn pivot_cmd_inner(
        &mut self,
        cmd: &CalcCommand,
    ) -> Result<(model_sheet::Recalc, Vec<CalcCommand>, Option<CalcPatch>)> {
        use CalcCommand as C;
        let none = Vec::new;
        match cmd {
            C::CreatePivot {
                source,
                target,
                fields,
            } => {
                let src = self.source_of(source)?;
                let (sheet, row, col, extra, patch) = match *target {
                    PivotTarget::Cell { sheet, row, col } => {
                        (self.sheet(sheet)?, row, col, none(), None)
                    }
                    PivotTarget::NewSheet => {
                        let before = self.workbook().pivot_source_range(&src).map(|r| r.sheet);
                        let (s, inv, mut patch) = self.new_pivot_sheet(before)?;
                        patch.activate_sheet = Some(s.0);
                        (s, 2, 0, vec![inv], Some(patch))
                    }
                };
                match self
                    .workbook_mut()
                    .create_pivot(src, sheet, row, col, fields.clone())
                {
                    Ok((_, recalc)) => Ok((recalc, extra, patch)),
                    Err(e) => {
                        for inv in extra {
                            let _ = self.apply_cmd(&inv);
                        }
                        Err(e.into())
                    }
                }
            }
            C::UpdatePivot { id, patch } => {
                let (_, t) = self
                    .workbook()
                    .pivot(*id)
                    .ok_or(model_sheet::Error::UnknownPivot(*id))?;
                let mut def = t.clone();
                if let Some(n) = &patch.name {
                    def.name.clone_from(n);
                }
                if let Some(v) = &patch.rows {
                    def.rows.clone_from(v);
                }
                if let Some(v) = &patch.cols {
                    def.cols.clone_from(v);
                }
                if let Some(v) = &patch.values {
                    def.values.clone_from(v);
                }
                if let Some(v) = &patch.filters {
                    def.filters.clone_from(v);
                }
                if let Some(o) = &patch.options {
                    def.options = o.clone();
                }
                if let Some(l) = patch.layout {
                    for a in &mut def.rows {
                        a.layout = l;
                    }
                }
                Ok((self.workbook_mut().update_pivot(*id, def)?, none(), None))
            }
            C::RefreshPivot { id } => match id {
                Some(id) => Ok((self.workbook_mut().refresh_pivot(*id)?, none(), None)),
                None => {
                    let ids: Vec<u32> = self
                        .workbook()
                        .pivot_caches()
                        .iter()
                        .filter(|c| c.raw.is_none())
                        .map(|c| c.id)
                        .collect();
                    let mut recalc = model_sheet::Recalc::default();
                    for c in ids {
                        let r = self.workbook_mut().refresh_cache(c)?;
                        recalc.changed.extend(r.changed);
                    }
                    Ok((recalc, none(), None))
                }
            },
            C::DeletePivot { id } => Ok((self.workbook_mut().delete_pivot(*id)?, none(), None)),
            C::MovePivot { id, target } => {
                let (sheet, row, col, extra, patch) = match *target {
                    PivotTarget::Cell { sheet, row, col } => {
                        (self.sheet(sheet)?, row, col, none(), None)
                    }
                    PivotTarget::NewSheet => {
                        let here = self.workbook().pivot(*id).map(|(s, _)| s);
                        let (s, inv, mut patch) = self.new_pivot_sheet(here)?;
                        patch.activate_sheet = Some(s.0);
                        (s, 2, 0, vec![inv], Some(patch))
                    }
                };
                match self.workbook_mut().move_pivot(*id, sheet, row, col) {
                    Ok(recalc) => Ok((recalc, extra, patch)),
                    Err(e) => {
                        for inv in extra {
                            let _ = self.apply_cmd(&inv);
                        }
                        Err(e.into())
                    }
                }
            }
            &C::ExpandCollapse {
                id,
                field,
                item,
                collapsed,
            } => {
                let (_, t) = self
                    .workbook()
                    .pivot(id)
                    .ok_or(model_sheet::Error::UnknownPivot(id))?;
                let mut def = t.clone();
                let n = self
                    .workbook()
                    .pivot_cache(def.cache_id)
                    .and_then(|c| c.fields.get(field as usize))
                    .map_or(0, |f| f.shared_items.len() as u32);
                let a = def
                    .axis_field_mut(field)
                    .ok_or_else(|| bad("the field is not on rows or columns"))?;
                let items: Vec<u32> = match item {
                    Some(i) if i < n => vec![i],
                    Some(_) => return Err(bad("no such item")),
                    None => (0..n).collect(),
                };
                for i in items {
                    if collapsed {
                        a.collapsed_items.insert(i);
                    } else {
                        a.collapsed_items.remove(&i);
                    }
                }
                Ok((self.workbook_mut().update_pivot(id, def)?, none(), None))
            }
            C::SetPageFilter {
                id,
                field,
                selected,
            } => {
                let (_, t) = self
                    .workbook()
                    .pivot(*id)
                    .ok_or(model_sheet::Error::UnknownPivot(*id))?;
                let mut def = t.clone();
                let p = def
                    .filters
                    .iter_mut()
                    .find(|p| p.field == *field)
                    .ok_or_else(|| bad("the field is not a filter"))?;
                p.selected = match selected {
                    None => PageSelection::All,
                    Some(items) => PageSelection::Items {
                        items: items.iter().copied().collect(),
                    },
                };
                Ok((self.workbook_mut().update_pivot(*id, def)?, none(), None))
            }
            C::ChangePivotSource { id, source } => {
                let src = self.source_of(source)?;
                Ok((
                    self.workbook_mut().change_pivot_source(*id, src)?,
                    none(),
                    None,
                ))
            }
            &C::ShowPivotDetails { id, row, col } => {
                let (names, rows) = self.workbook().pivot_details(id, row, col)?;
                let here = self.workbook().pivot(id).map(|(s, _)| s);
                let (s, inv, mut patch) = self.new_pivot_sheet(here)?;
                patch.activate_sheet = Some(s.0);
                let mut cells: Vec<(u32, u32, String, u32)> = Vec::new();
                for (c, n) in names.iter().enumerate() {
                    cells.push((0, c as u32, model_sheet::tables::header_input(n), 0));
                }
                for (r, rec) in rows.iter().enumerate() {
                    for (c, v) in rec.iter().enumerate() {
                        let input =
                            content_to_input(&engine_formula::CellContent::Value(v.clone()));
                        if !input.is_empty() {
                            cells.push((r as u32 + 1, c as u32, input, 0));
                        }
                    }
                }
                let a = self.apply_cmd(&C::RestoreCells { sheet: s.0, cells })?;
                patch.merge(a.patch);
                // The records as a table, as Excel shows them.
                let last_row = rows.len() as u32 + u32::from(rows.is_empty());
                let width = names.len().max(1) as u32;
                let a = self.apply_cmd(&C::CreateTable {
                    sheet: s.0,
                    r0: 0,
                    c0: 0,
                    r1: last_row,
                    c1: width - 1,
                    has_headers: true,
                    style: None,
                })?;
                patch.merge(a.patch);
                patch.sheets = Some(self.sheet_infos());
                Ok((model_sheet::Recalc::default(), vec![inv], Some(patch)))
            }
            _ => unreachable!("not a pivot command: {cmd:?}"),
        }
    }

    /// Fails with `pivot_cell` when a direct edit of `cmd` touches a pivot
    /// table (formats may change; contents not).
    pub(crate) fn check_pivot_edit(&self, cmd: &CalcCommand) -> Result<()> {
        use CalcCommand as C;
        if !self.has_pivots() {
            return Ok(());
        }
        let check = |sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32| -> Result<()> {
            let s = self.sheet(sheet)?;
            let (r1, c1) = (r1.max(r0), c1.max(c0));
            self.workbook()
                .check_pivot_edit(model_sheet::CellRange::new(s, r0, c0, r1, c1))
                .map_err(CalcError::from)
        };
        match cmd {
            &C::SetInput {
                sheet, row, col, ..
            } => check(sheet, row, col, row, col),
            &C::ClearRange {
                sheet,
                r0,
                c0,
                r1,
                c1,
            }
            | &C::MergeCells {
                sheet,
                r0,
                c0,
                r1,
                c1,
            }
            | &C::SortRange {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ..
            } => check(sheet, r0, c0, r1, c1),
            &C::SortSheetByColumn {
                sheet, row, col, ..
            } => check(sheet, row, col, row, col),
            C::SetHyperlink {
                sheet,
                r0,
                c0,
                text: Some(_),
                ..
            } => check(*sheet, *r0, *c0, *r0, *c0),
            C::FillRange { sheet, dst, .. } => check(*sheet, dst.r0, dst.c0, dst.r1, dst.c1),
            C::PasteRange {
                sheet,
                r0,
                c0,
                src,
                cut,
                repeat_rows,
                repeat_cols,
                mode,
                ..
            } => {
                if *mode != crate::command::PasteMode::FormatsOnly {
                    let h = (src.r1 - src.r0 + 1).saturating_mul((*repeat_rows).max(1));
                    let w = (src.c1 - src.c0 + 1).saturating_mul((*repeat_cols).max(1));
                    check(
                        *sheet,
                        *r0,
                        *c0,
                        r0.saturating_add(h - 1),
                        c0.saturating_add(w - 1),
                    )?;
                }
                if *cut {
                    check(src.sheet, src.r0, src.c0, src.r1, src.c1)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}
