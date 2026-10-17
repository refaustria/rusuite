//! Slicers in the document (P9-C2): Insert Slicers, clicks (selection),
//! the Slicer tab's properties, Report Connections and Delete, each one
//! undo step. Table slicers filter through the table's AutoFilter (the
//! filter machinery's undo); pivot slicers re-render the connected pivot
//! tables (the pivot journal's undo). The sheet list carries every
//! slicer with its buttons ([`SlicerView`]).

use app_common::Applied;
use model_sheet::{
    ChartAnchor, Slicer, SlicerCache, SlicerItem, SlicerSort, SlicerSource, SlicerState,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{CalcCommand, SlicerPatch};
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};
use crate::patch::CalcPatch;
use crate::tables::{append_inverse, chain};
use engine_formula::SheetId;

/// The slicers of one sheet (undo snapshots).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetSlicers {
    pub sheet: u32,
    #[ts(as = "Vec<crate::wire_data::Slicer>")]
    pub slicers: Vec<Slicer>,
}

/// A slicer as the grid draws it: the object, its cache's source and
/// sort, and the buttons.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SlicerView {
    #[ts(as = "crate::wire_data::Slicer")]
    pub slicer: Slicer,
    #[ts(as = "crate::wire_data::SlicerSource")]
    pub source: SlicerSource,
    #[ts(as = "crate::wire_data::SlicerSort")]
    pub sort: SlicerSort,
    #[ts(as = "Vec<crate::wire_data::SlicerItem>")]
    pub items: Vec<SlicerItem>,
    /// Pivot sources: every pivot table on the slicer's cache (Report
    /// Connections), connected or not.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<SlicerPivot>>")]
    pub pivot_tables: Vec<SlicerPivot>,
}

/// A pivot table a slicer can filter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SlicerPivot {
    pub id: u32,
    pub name: String,
    pub sheet: u32,
}

/// Offset of each further slicer of one Insert Slicers (rows, columns).
const CASCADE: (u32, u32) = (2, 1);

fn bad(m: impl Into<String>) -> CalcError {
    CalcError::Model(model_sheet::Error::InvalidSlicer(m.into()))
}

fn cascade(anchor: ChartAnchor, k: u32) -> ChartAnchor {
    let shift = |c: &mut model_sheet::CellOffset| {
        c.row = (c.row + CASCADE.0 * k).min(engine_formula::ast::MAX_ROW);
        c.col = (c.col + CASCADE.1 * k).min(engine_formula::ast::MAX_COL);
    };
    let mut a = anchor;
    match &mut a {
        ChartAnchor::TwoCell { from, to } => {
            shift(from);
            shift(to);
        }
        ChartAnchor::OneCell { from, .. } => shift(from),
        ChartAnchor::Absolute { x, y, .. } => {
            *x += i64::from(k) * 190_500;
            *y += i64::from(k) * 190_500;
        }
    }
    a
}

pub(crate) fn state_command(state: SlicerState) -> CalcCommand {
    CalcCommand::RestoreSlicers {
        caches: state.0,
        sheets: state
            .1
            .into_iter()
            .map(|(s, slicers)| SheetSlicers {
                sheet: s.0,
                slicers,
            })
            .collect(),
    }
}

impl CalcDocument {
    /// The slicers of `s` with their buttons.
    pub(crate) fn slicer_views(&self, s: SheetId) -> Vec<SlicerView> {
        let wb = self.workbook();
        wb.slicers(s)
            .iter()
            .filter_map(|x| {
                let cache: &SlicerCache = wb.slicer_cache(&x.cache)?;
                let pivot_tables = match &cache.source {
                    SlicerSource::Pivot { cache: id, .. } => wb
                        .sheets()
                        .into_iter()
                        .flat_map(|(s, _)| {
                            wb.pivots(s)
                                .iter()
                                .filter(|p| p.cache_id == *id && p.raw.is_none())
                                .map(move |p| SlicerPivot {
                                    id: p.id,
                                    name: p.name.clone(),
                                    sheet: s.0,
                                })
                        })
                        .collect(),
                    SlicerSource::Table { .. } => Vec::new(),
                };
                Some(SlicerView {
                    slicer: x.clone(),
                    source: cache.source.clone(),
                    sort: cache.sort,
                    items: wb.slicer_items(&cache.name),
                    pivot_tables,
                })
            })
            .collect()
    }

    fn has_slicers(&self) -> bool {
        !self.workbook().slicer_caches().is_empty()
    }

    /// Before any command: the slicer state to compare with afterwards
    /// (`None` without slicers).
    pub(crate) fn slicers_before(&self) -> Option<SlicerState> {
        self.has_slicers().then(|| self.workbook().slicer_state())
    }

    /// After any command: slicers whose source went (a deleted table,
    /// column or pivot table) are removed; a changed slicer state comes
    /// back on undo; edits refresh the buttons (the sheet list).
    pub(crate) fn mark_slicers(&mut self, before: Option<SlicerState>, applied: &mut CalcApplied) {
        let Some(before) = before else {
            return;
        };
        self.workbook_mut().prune_slicers();
        let after = self.workbook().slicer_state();
        if after != before {
            append_inverse(applied, vec![state_command(before)]);
            applied.patch.sheets = Some(self.sheet_infos());
        } else if applied.patch.sheets.is_none()
            && (!applied.patch.cells.is_empty() || !applied.patch.rows.is_empty())
        {
            applied.patch.sheets = Some(self.sheet_infos());
        }
    }

    fn slicer_sheets_patch(&self) -> CalcPatch {
        CalcPatch {
            sheets: Some(self.sheet_infos()),
            ..Default::default()
        }
    }

    /// The slicer commands.
    pub(crate) fn slicer_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        match cmd {
            C::InsertSlicers {
                sheet,
                sources,
                anchor,
            } => {
                let s = self.sheet(*sheet)?;
                if sources.is_empty() {
                    return Err(bad("no source"));
                }
                let before = self.workbook().slicer_state();
                for (k, src) in sources.iter().enumerate() {
                    let r = self.workbook_mut().insert_slicer(
                        s,
                        src.clone(),
                        cascade(*anchor, k as u32),
                    );
                    if let Err(e) = r {
                        let _ = self.workbook_mut().set_slicer_state(before);
                        return Err(e.into());
                    }
                }
                Ok(Applied {
                    patch: self.slicer_sheets_patch(),
                    inverse: Some(state_command(before)),
                })
            }
            C::SetSlicerSelection { cache, selected } => {
                self.slicer_selection(cache, selected.as_deref())
            }
            C::UpdateSlicer { id, patch } => self.update_slicer(*id, patch),
            C::DeleteSlicer { id } => {
                let (s, x) = self
                    .workbook()
                    .slicer(*id)
                    .map(|(s, x)| (s, x.clone()))
                    .ok_or_else(|| bad(format!("unknown slicer {id}")))?;
                let last = self
                    .workbook()
                    .all_slicers()
                    .iter()
                    .filter(|(_, o)| o.cache.eq_ignore_ascii_case(&x.cache))
                    .count()
                    == 1;
                // The cache's filter goes with its last slicer.
                let mut acc = if last {
                    self.slicer_selection(&x.cache, None)?
                } else {
                    crate::tables::empty_applied()
                };
                let before = self.workbook().slicer_state();
                let (mut caches, mut sheets) = before.clone();
                for (sheet, list) in &mut sheets {
                    if *sheet == s {
                        list.retain(|o| o.id != *id);
                    }
                }
                if last {
                    caches.retain(|c| !c.name.eq_ignore_ascii_case(&x.cache));
                }
                self.workbook_mut().set_slicer_state((caches, sheets))?;
                chain(
                    &mut acc,
                    Applied {
                        patch: self.slicer_sheets_patch(),
                        inverse: Some(state_command(before)),
                    },
                );
                Ok(acc)
            }
            C::SetSlicerConnections { cache, pivots } => {
                let cache = cache.clone();
                let pivots = pivots.clone();
                self.pivot_slicer_op(move |wb| wb.set_slicer_connections(&cache, pivots))
            }
            C::RestoreSlicers { caches, sheets } => {
                let before = self.workbook().slicer_state();
                let state = (
                    caches.clone(),
                    sheets
                        .iter()
                        .map(|s| (SheetId(s.sheet), s.slicers.clone()))
                        .collect(),
                );
                self.workbook_mut().set_slicer_state(state)?;
                Ok(Applied {
                    patch: self.slicer_sheets_patch(),
                    inverse: Some(state_command(before)),
                })
            }
            _ => Err(CalcError::InvalidRange),
        }
    }

    /// [`CalcCommand::SetSlicerSelection`].
    fn slicer_selection(
        &mut self,
        cache: &str,
        selected: Option<&[String]>,
    ) -> Result<CalcApplied> {
        let c = self
            .workbook()
            .slicer_cache(cache)
            .cloned()
            .ok_or_else(|| bad(format!("unknown slicer cache {cache:?}")))?;
        let selected: Option<Vec<String>> = selected.map(<[String]>::to_vec);
        match c.source {
            SlicerSource::Table { table, .. } => {
                let (s, _) = self
                    .workbook()
                    .table(table)
                    .ok_or(model_sheet::Error::UnknownTable(table))?;
                let name = c.name.clone();
                self.filter_op(s.0, move |wb, _| {
                    wb.set_slicer_selection(&name, selected.as_deref())
                })
            }
            SlicerSource::Pivot { .. } => {
                let name = c.name.clone();
                self.pivot_slicer_op(move |wb| {
                    wb.set_slicer_selection(&name, selected.as_deref())
                        .map(|f| f.recalc)
                })
            }
        }
    }

    /// A slicer operation that re-renders pivot tables: undone by the
    /// pivot journal plus the slicer state.
    fn pivot_slicer_op(
        &mut self,
        f: impl FnOnce(
            &mut model_sheet::Workbook,
        ) -> std::result::Result<model_sheet::Recalc, model_sheet::Error>,
    ) -> Result<CalcApplied> {
        let pivots = self.pivot_state();
        let slicers = self.workbook().slicer_state();
        let styles_before = self.workbook().styles().len();
        self.workbook_mut().start_pivot_journal();
        match f(self.workbook_mut()) {
            Ok(recalc) => {
                let mut applied = self.pivot_applied(pivots, recalc, vec![state_command(slicers)]);
                if self.workbook().styles().len() != styles_before {
                    applied.patch.styles = Some(self.style_list());
                }
                applied.patch.sheets = Some(self.sheet_infos());
                Ok(applied)
            }
            Err(e) => {
                let journal = self.workbook_mut().take_pivot_journal();
                // Put back what a partial update changed.
                let tables = pivots
                    .1
                    .iter()
                    .map(|s| (SheetId(s.sheet), s.pivots.clone()))
                    .collect();
                self.workbook_mut().restore_pivot_state(pivots.0, tables);
                for (c, content, style) in journal.cells {
                    let _ = self.workbook_mut().set_content(c, content);
                    let _ = self.workbook_mut().set_style(c, style);
                }
                let _ = self.workbook_mut().set_slicer_state(slicers);
                Err(e.into())
            }
        }
    }

    /// [`CalcCommand::UpdateSlicer`].
    fn update_slicer(&mut self, id: u32, patch: &SlicerPatch) -> Result<CalcApplied> {
        let before = self.workbook().slicer_state();
        let (mut caches, mut sheets) = before.clone();
        let mut found = None;
        for (_, list) in &mut sheets {
            if let Some(x) = list.iter_mut().find(|x| x.id == id) {
                if let Some(v) = &patch.name {
                    x.name = v.trim().to_string();
                }
                if let Some(v) = &patch.caption {
                    x.caption.clone_from(v);
                }
                if let Some(v) = patch.show_caption {
                    x.show_caption = v;
                }
                if let Some(v) = patch.columns {
                    x.columns = v;
                }
                if let Some(v) = patch.row_height {
                    x.row_height = v;
                }
                if let Some(v) = &patch.style {
                    if !model_sheet::slicer::is_builtin_slicer_style(v) {
                        return Err(bad(format!("unknown slicer style {v:?}")));
                    }
                    x.style.clone_from(v);
                }
                if let Some(a) = patch.anchor {
                    x.anchor = a;
                }
                found = Some(x.cache.clone());
            }
        }
        let cache = found.ok_or_else(|| bad(format!("unknown slicer {id}")))?;
        if let Some(sort) = patch.sort {
            if let Some(c) = caches
                .iter_mut()
                .find(|c| c.name.eq_ignore_ascii_case(&cache))
            {
                c.sort = sort;
            }
        }
        self.workbook_mut().set_slicer_state((caches, sheets))?;
        Ok(Applied {
            patch: self.slicer_sheets_patch(),
            inverse: Some(state_command(before)),
        })
    }
}
