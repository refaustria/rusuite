//! Charts (P8-18): the chart commands and their inverses, the
//! `chartData`, `sheetCharts` and `recommendedChart` requests, and which
//! sheets a patch reports in `chartSheets`.

use app_common::Applied;
use core_model::chart::{CellClass, Chart, ChartKind, ResolvedChart};
use engine_formula::Value;
use model_sheet::{CellCoord, ChartObject, SheetId};

use crate::command::CalcCommand;
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};
use crate::patch::CalcPatch;

/// The charts of every sheet that has any, in sheet order.
pub(crate) type ChartsState = Vec<(SheetId, Vec<ChartObject>)>;

/// Largest range `recommendedChart` looks at (cells).
const MAX_CHART_CELLS: u64 = 1 << 16;

impl CalcDocument {
    /// Applies one of the chart commands ([`CalcCommand::AddChart`] and
    /// the following variants, [`CalcCommand::RestoreCharts`]).
    pub(crate) fn charts_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        let sheet = match cmd {
            C::AddChart { sheet, .. }
            | C::UpdateChart { sheet, .. }
            | C::SetChartAnchor { sheet, .. }
            | C::SetChartSeries { sheet, .. }
            | C::RemoveChart { sheet, .. }
            | C::RestoreCharts { sheet, .. } => *sheet,
            _ => unreachable!("not a chart command: {cmd:?}"),
        };
        let s = self.sheet(sheet)?;
        let before = self.workbook().charts(s).to_vec();
        // Unsupported charts only come from files (and are read-only).
        let unsupported = |c: &Chart| matches!(c.kind, ChartKind::Unsupported { .. });
        let read_only = || model_sheet::Error::InvalidChart("unsupported chart type".into());
        match cmd {
            C::AddChart { chart, .. } | C::UpdateChart { chart, .. } if unsupported(chart) => {
                return Err(read_only().into());
            }
            C::SetChartSeries { id, .. } | C::UpdateChart { id, .. }
                if self
                    .workbook()
                    .chart(s, *id)
                    .is_some_and(|o| unsupported(&o.chart)) =>
            {
                return Err(read_only().into());
            }
            _ => {}
        }
        let restore = |charts: Vec<ChartObject>| C::RestoreCharts { sheet, charts };
        let inverse = match cmd {
            C::AddChart {
                anchor,
                chart,
                id,
                name,
                ..
            } => {
                let id = self.workbook_mut().add_chart(
                    s,
                    ChartObject {
                        id: id.unwrap_or(0),
                        name: name.clone().unwrap_or_default(),
                        anchor: *anchor,
                        chart: chart.clone(),
                    },
                )?;
                C::RemoveChart { sheet, id }
            }
            C::UpdateChart { id, chart, .. } => {
                self.workbook_mut().update_chart(s, *id, chart.clone())?;
                restore(before)
            }
            &C::SetChartAnchor { id, anchor, .. } => {
                let old = self.workbook_mut().set_chart_anchor(s, id, anchor)?;
                C::SetChartAnchor {
                    sheet,
                    id,
                    anchor: old,
                }
            }
            C::SetChartSeries {
                id,
                series,
                categories,
                ..
            } => {
                let mut chart = self
                    .workbook()
                    .chart(s, *id)
                    .ok_or(model_sheet::Error::UnknownChart(*id))?
                    .chart
                    .clone();
                chart.series.clone_from(series);
                chart.categories.clone_from(categories);
                let old = self.workbook_mut().update_chart(s, *id, chart)?;
                C::SetChartSeries {
                    sheet,
                    id: *id,
                    series: old.series,
                    categories: old.categories,
                }
            }
            &C::RemoveChart { id, .. } => {
                self.workbook_mut().remove_chart(s, id)?;
                restore(before)
            }
            C::RestoreCharts { charts, .. } => {
                self.workbook_mut().set_charts(s, charts.clone())?;
                restore(before)
            }
            _ => unreachable!("not a chart command: {cmd:?}"),
        };
        Ok(Applied {
            patch: CalcPatch {
                chart_sheets: vec![sheet],
                ..Default::default()
            },
            inverse: Some(inverse),
        })
    }

    /// The command that brings back the charts of `s` (the undo of
    /// deleting the sheet), if it has any.
    pub(crate) fn charts_inverse(&self, s: SheetId) -> Option<CalcCommand> {
        let charts = self.workbook().charts(s);
        (!charts.is_empty()).then(|| CalcCommand::RestoreCharts {
            sheet: s.0,
            charts: charts.to_vec(),
        })
    }

    /// The charts of every sheet that has any.
    pub(crate) fn charts_state(&self) -> ChartsState {
        let wb = self.workbook();
        wb.sheets()
            .into_iter()
            .map(|(s, _)| (s, wb.charts(s).to_vec()))
            .filter(|(_, c)| !c.is_empty())
            .collect()
    }

    /// After a structural edit: the commands restoring the charts that
    /// changed since `before` (moved anchors, adjusted references), and
    /// the changed sheets.
    pub(crate) fn charts_changed(&self, before: ChartsState) -> (Vec<CalcCommand>, Vec<u32>) {
        let wb = self.workbook();
        let mut restore = Vec::new();
        let mut sheets = Vec::new();
        for (s, charts) in before {
            if wb.charts(s) != charts.as_slice() {
                restore.push(CalcCommand::RestoreCharts { sheet: s.0, charts });
                sheets.push(s.0);
            }
        }
        (restore, sheets)
    }

    /// Adds to `patch.chart_sheets` every sheet whose charts may show
    /// something else now: charts referencing a changed cell; with a
    /// changed sheet list, structure or row/column visibility, every sheet
    /// with charts.
    pub(crate) fn mark_chart_sheets(&self, patch: &mut CalcPatch) {
        let wb = self.workbook();
        let with_charts: Vec<u32> = wb
            .sheets()
            .into_iter()
            .filter(|(s, _)| !wb.charts(*s).is_empty())
            .map(|(s, _)| s.0)
            .collect();
        if with_charts.is_empty() {
            return;
        }
        let broad = patch.sheets.is_some()
            || !patch.structural.is_empty()
            || !patch.rows.is_empty()
            || !patch.cols.is_empty();
        let hits: Vec<u32> = if broad {
            with_charts
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
            wb.sheets_with_charts_on(&cells)
                .into_iter()
                .map(|s| s.0)
                .collect()
        };
        for s in hits {
            if !patch.chart_sheets.contains(&s) {
                patch.chart_sheets.push(s);
            }
        }
    }

    /// The `sheetCharts` request: the charts of `sheet`, back to front.
    pub fn sheet_charts(&self, sheet: u32) -> Result<Vec<ChartObject>> {
        Ok(self.workbook().charts(self.sheet(sheet)?).to_vec())
    }

    /// The `chartData` request: the data of chart `id` as the renderer
    /// draws it.
    pub fn chart_data(&self, sheet: u32, id: u32) -> Result<ResolvedChart> {
        Ok(self.workbook().chart_data(self.sheet(sheet)?, id)?)
    }

    /// The `previewChartData` request: the data of a chart that is not
    /// (yet) on the sheet (the insert/edit dialogs' preview).
    pub fn preview_chart_data(&self, sheet: u32, chart: &Chart) -> Result<ResolvedChart> {
        Ok(self.workbook().resolve_chart(chart, self.sheet(sheet)?))
    }

    /// The `recommendedChart` request: Excel's default chart for the
    /// selected range ([`Chart::from_range`]); a single cell stands for
    /// its current region. The range is clipped to the used area. `None`
    /// without numeric data.
    pub fn recommended_chart(
        &self,
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    ) -> Result<Option<Chart>> {
        let range = self.range(sheet, r0, c0, r1, c1)?;
        let s = range.sheet;
        let wb = self.workbook();
        let range = if range.is_single_cell() {
            wb.current_region(s, r0, c0)
        } else {
            range
        };
        let Some((used_r, used_c)) = wb.used_range(s) else {
            return Ok(None);
        };
        let (r1, c1) = (range.r1.min(used_r), range.c1.min(used_c));
        if range.r0 > r1 || range.c0 > c1 {
            return Ok(None);
        }
        let cells = (u64::from(r1 - range.r0) + 1) * (u64::from(c1 - range.c0) + 1);
        if cells > MAX_CHART_CELLS {
            return Err(CalcError::RangeTooLarge);
        }
        let grid: Vec<Vec<CellClass>> = (range.r0..=r1)
            .map(|row| {
                (range.c0..=c1)
                    .map(|col| match wb.value(CellCoord::new(s, row, col)) {
                        Value::Empty => CellClass::Empty,
                        Value::Number(_) => CellClass::Number,
                        _ => CellClass::Text,
                    })
                    .collect()
            })
            .collect();
        let name = wb.engine().sheet_name(s).unwrap_or_default();
        Ok(Chart::from_range(name, range.r0, range.c0, &grid))
    }
}
