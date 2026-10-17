//! Sparklines (P9-C6): the `setSparklineGroups` command and its inverse,
//! the `sheetSparklines` request, the undo of structural edits, and which
//! sheets a patch reports in `sparklineSheets`.

use app_common::Applied;
use model_sheet::{CellCoord, SheetId, SparklineData, SparklineGroup};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::CalcCommand;
use crate::doc::{CalcApplied, CalcDocument, Result};
use crate::patch::CalcPatch;

/// A sparkline group with the data of each of its sparklines (in order).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SparklineGroupView {
    #[ts(as = "crate::wire_sparkline::SparklineGroup")]
    pub group: SparklineGroup,
    #[ts(as = "Vec<crate::wire_sparkline::SparklineData>")]
    pub data: Vec<SparklineData>,
}

/// The sparkline groups of every sheet that has any.
pub(crate) type SparklinesState = Vec<(SheetId, Vec<SparklineGroup>)>;

impl CalcDocument {
    /// [`CalcCommand::SetSparklineGroups`].
    pub(crate) fn sparklines_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        let CalcCommand::SetSparklineGroups { sheet, groups } = cmd else {
            unreachable!("not a sparkline command: {cmd:?}");
        };
        let s = self.sheet(*sheet)?;
        let old = self
            .workbook_mut()
            .set_sparkline_groups(s, groups.clone())?;
        Ok(Applied {
            patch: CalcPatch {
                sparkline_sheets: vec![*sheet],
                ..Default::default()
            },
            inverse: Some(CalcCommand::SetSparklineGroups {
                sheet: *sheet,
                groups: old,
            }),
        })
    }

    /// The sparkline groups of every sheet that has any.
    pub(crate) fn sparklines_state(&self) -> SparklinesState {
        let wb = self.workbook();
        wb.sheets()
            .into_iter()
            .map(|(s, _)| (s, wb.sparkline_groups(s).to_vec()))
            .filter(|(_, g)| !g.is_empty())
            .collect()
    }

    /// After a structural edit: the commands restoring the sparkline
    /// groups that changed since `before`, and the changed sheets.
    pub(crate) fn sparklines_changed(
        &self,
        before: SparklinesState,
    ) -> (Vec<CalcCommand>, Vec<u32>) {
        let wb = self.workbook();
        let mut restore = Vec::new();
        let mut sheets = Vec::new();
        for (s, groups) in before {
            if wb.sparkline_groups(s) != groups.as_slice() {
                restore.push(CalcCommand::SetSparklineGroups { sheet: s.0, groups });
                sheets.push(s.0);
            }
        }
        (restore, sheets)
    }

    /// Adds to `patch.sparkline_sheets` every sheet whose sparklines may
    /// show something else now (see [`CalcPatch::sparkline_sheets`]).
    pub(crate) fn mark_sparkline_sheets(&self, patch: &mut CalcPatch) {
        let wb = self.workbook();
        let with: Vec<u32> = wb
            .sheets()
            .into_iter()
            .filter(|(s, _)| !wb.sparkline_groups(*s).is_empty())
            .map(|(s, _)| s.0)
            .collect();
        if with.is_empty() {
            return;
        }
        let broad = patch.sheets.is_some()
            || !patch.structural.is_empty()
            || !patch.rows.is_empty()
            || !patch.cols.is_empty();
        let hits: Vec<u32> = if broad {
            with
        } else {
            let cells: Vec<CellCoord> = patch
                .cells
                .iter()
                .flat_map(|g| {
                    g.cells
                        .iter()
                        .map(move |c| CellCoord::new(SheetId(g.sheet), c.row, c.col))
                })
                .collect();
            wb.sheets_with_sparklines_on(&cells)
                .into_iter()
                .map(|s| s.0)
                .collect()
        };
        for s in hits {
            if !patch.sparkline_sheets.contains(&s) {
                patch.sparkline_sheets.push(s);
            }
        }
    }

    /// The `sheetSparklines` request.
    pub fn sheet_sparklines(&self, sheet: u32) -> Result<Vec<SparklineGroupView>> {
        let s = self.sheet(sheet)?;
        let wb = self.workbook();
        Ok(wb
            .sparkline_groups(s)
            .iter()
            .map(|g| SparklineGroupView {
                group: g.clone(),
                data: wb.sparkline_data(s, g),
            })
            .collect())
    }
}
