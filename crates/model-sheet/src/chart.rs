//! Charts on sheets (P8-18): [`ChartObject`]s with their anchors, the
//! workbook API to add, change and remove them, and the resolution of
//! their data references ([`Workbook::chart_data`]).
//!
//! A chart references its data by formula text (see
//! [`core_model::chart::DataRef`]). Like conditional formatting formulas,
//! the references follow row/column inserts and deletes on the sheets they
//! point at, sheet renames, and – for the charts of a duplicated sheet –
//! the copy. Anchors move with the rows and columns of the chart's own
//! sheet (Excel's default "move and size with cells").

use core_model::chart::{Chart, ChartKind, ChartValue, ResolvedChart, ResolvedSeries, TextSource};
use engine_formula::ast::{RangeKind, MAX_COL, MAX_ROW};
use engine_formula::{
    adjust_references, parse, AdjustContext, CellCoord, Expr, SheetId, StructuralOp, Value,
};
use serde::{Deserialize, Serialize};

use crate::numfmt::display_value;
use crate::workbook::Workbook;
use crate::Error;

/// A cell corner plus an offset into the cell (EMU, 914 400 per inch).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellOffset {
    /// 0-based column and row of the cell.
    pub col: u32,
    pub row: u32,
    /// Offset from the cell's left / top edge in EMU.
    #[serde(default)]
    pub col_offset: i64,
    #[serde(default)]
    pub row_offset: i64,
}

/// Where a chart sits on the sheet (SpreadsheetML drawing anchors).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ChartAnchor {
    /// Top-left and bottom-right corners in cells (`xdr:twoCellAnchor`,
    /// Excel's default: moves and resizes with the cells).
    TwoCell { from: CellOffset, to: CellOffset },
    /// Top-left corner in cells, size in EMU (`xdr:oneCellAnchor`).
    OneCell {
        from: CellOffset,
        width: i64,
        height: i64,
    },
    /// Position and size in EMU from the sheet's top-left corner
    /// (`xdr:absoluteAnchor`).
    Absolute {
        x: i64,
        y: i64,
        width: i64,
        height: i64,
    },
}

impl ChartAnchor {
    /// Moves cell corners for a row/column insert or delete on the
    /// chart's sheet: corners inside a deleted span go to its start.
    fn shift(&mut self, op: StructuralOp) {
        let (at, _) = op.span();
        let map = |c: &mut CellOffset| {
            let i = if op.is_rows() { c.row } else { c.col };
            let (j, zero) = match op.map_index(i) {
                Some(j) => (j, false),
                None if op.is_insert() => (op.max_index(), false),
                None => (at.min(op.max_index()), true),
            };
            if op.is_rows() {
                c.row = j;
                if zero {
                    c.row_offset = 0;
                }
            } else {
                c.col = j;
                if zero {
                    c.col_offset = 0;
                }
            }
        };
        match self {
            ChartAnchor::TwoCell { from, to } => {
                map(from);
                map(to);
            }
            ChartAnchor::OneCell { from, .. } => map(from),
            ChartAnchor::Absolute { .. } => {}
        }
    }

    fn check(&self) -> Result<(), Error> {
        let cell = |c: &CellOffset| {
            c.row <= MAX_ROW && c.col <= MAX_COL && c.row_offset >= 0 && c.col_offset >= 0
        };
        let ok = match self {
            ChartAnchor::TwoCell { from, to } => {
                cell(from) && cell(to) && from.row <= to.row && from.col <= to.col
            }
            ChartAnchor::OneCell {
                from,
                width,
                height,
            } => cell(from) && *width >= 0 && *height >= 0,
            ChartAnchor::Absolute { width, height, .. } => *width >= 0 && *height >= 0,
        };
        if ok {
            Ok(())
        } else {
            Err(Error::InvalidChart("invalid anchor".into()))
        }
    }
}

/// A chart placed on a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartObject {
    /// Unique per sheet, `>= 1` (0 when adding = assign one).
    pub id: u32,
    /// The drawing object name (`"Chart 1"`); empty = `"Chart <id>"`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    pub anchor: ChartAnchor,
    pub chart: Chart,
}

/// The cells of one reference: values with their displayed text, plus
/// the number format of the first cell.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ResolvedRef {
    pub points: Vec<(ChartValue, String)>,
    pub format_code: Option<String>,
}

/// Checks a chart before it is stored.
fn check_chart(chart: &Chart) -> Result<(), Error> {
    if !(1..=48).contains(&chart.style) {
        return Err(Error::InvalidChart(format!("style {}", chart.style)));
    }
    for f in chart.formulas() {
        parse_ref(f).ok_or_else(|| Error::InvalidChart(format!("reference {f:?}")))?;
    }
    if chart.series.len() > 255 {
        return Err(Error::InvalidChart("more than 255 series".into()));
    }
    Ok(())
}

/// Parses a reference formula (without `=`).
fn parse_ref(formula: &str) -> Option<Expr> {
    let f = formula.trim();
    let f = f.strip_prefix('=').unwrap_or(f);
    parse(&format!("={f}")).ok()
}

/// Replaces sheet prefix `from` (case-insensitive) by `to` in every
/// reference of `e`; whether anything changed.
fn rename_refs(e: &mut Expr, from: &str, to: &str) -> bool {
    match e {
        Expr::Reference(r) => match &mut r.sheet {
            Some(s) if s.to_lowercase() == from.to_lowercase() => {
                *s = to.to_owned();
                true
            }
            _ => false,
        },
        Expr::Call { args, .. } => args
            .iter_mut()
            .fold(false, |acc, a| rename_refs(a, from, to) | acc),
        Expr::Unary { expr, .. } => rename_refs(expr, from, to),
        Expr::Binary { lhs, rhs, .. } => rename_refs(lhs, from, to) | rename_refs(rhs, from, to),
        Expr::Array(rows) => rows
            .iter_mut()
            .flatten()
            .fold(false, |acc, a| rename_refs(a, from, to) | acc),
        _ => false,
    }
}

/// `formula` with sheet `from` renamed to `to` (unchanged text when no
/// reference names it).
fn renamed(formula: &str, from: &str, to: &str) -> Option<String> {
    let mut ast = parse_ref(formula)?;
    rename_refs(&mut ast, from, to).then(|| ast.to_string().trim_start_matches('=').to_owned())
}

/// A chart value from a cell value: numbers, text (booleans as
/// `TRUE`/`FALSE`), blanks for empty cells and errors.
fn chart_value(v: &Value) -> ChartValue {
    match v {
        Value::Number(n) => ChartValue::Number(*n),
        Value::Text(t) => ChartValue::Text(t.clone()),
        Value::Bool(b) => ChartValue::Text(if *b { "TRUE" } else { "FALSE" }.into()),
        Value::Empty | Value::Error(_) => ChartValue::Blank,
        Value::Array(_) => chart_value(&v.clone().into_scalar()),
    }
}

impl Workbook {
    /// The charts of `sheet`, back to front.
    pub fn charts(&self, sheet: SheetId) -> &[ChartObject] {
        &self.sheet_data(sheet).charts
    }

    /// The chart `id` of `sheet`.
    pub fn chart(&self, sheet: SheetId, id: u32) -> Option<&ChartObject> {
        self.charts(sheet).iter().find(|c| c.id == id)
    }

    fn chart_index(&self, sheet: SheetId, id: u32) -> Result<usize, Error> {
        self.charts(sheet)
            .iter()
            .position(|c| c.id == id)
            .ok_or(Error::UnknownChart(id))
    }

    /// Replaces all charts of `sheet` (loading, undo). Ids 0 get fresh
    /// ids; duplicate ids, invalid anchors or charts fail and change
    /// nothing.
    pub fn set_charts(&mut self, sheet: SheetId, charts: Vec<ChartObject>) -> Result<(), Error> {
        self.sheet_data_mut(sheet)?;
        let mut charts = charts;
        let mut seen = std::collections::HashSet::new();
        for c in &charts {
            c.anchor.check()?;
            check_chart(&c.chart)?;
            if c.id != 0 && !seen.insert(c.id) {
                return Err(Error::InvalidChart(format!("duplicate chart id {}", c.id)));
            }
        }
        let mut next = seen.iter().max().copied().unwrap_or(0);
        for c in &mut charts {
            if c.id == 0 {
                next += 1;
                c.id = next;
            }
            if c.name.is_empty() {
                c.name = format!("Chart {}", c.id);
            }
        }
        self.sheet_data_mut(sheet)?.charts = charts;
        Ok(())
    }

    /// Adds a chart in front of the others (id 0 = a fresh id; an id in
    /// use fails). Returns the id.
    pub fn add_chart(&mut self, sheet: SheetId, chart: ChartObject) -> Result<u32, Error> {
        chart.anchor.check()?;
        check_chart(&chart.chart)?;
        let data = self.sheet_data_mut(sheet)?;
        let mut chart = chart;
        if chart.id == 0 {
            chart.id = data.charts.iter().map(|c| c.id).max().unwrap_or(0) + 1;
        } else if data.charts.iter().any(|c| c.id == chart.id) {
            return Err(Error::InvalidChart(format!(
                "duplicate chart id {}",
                chart.id
            )));
        }
        if chart.name.is_empty() {
            chart.name = format!("Chart {}", chart.id);
        }
        let id = chart.id;
        data.charts.push(chart);
        Ok(id)
    }

    /// Replaces the chart (not the anchor) of chart `id`; returns the old one.
    pub fn update_chart(&mut self, sheet: SheetId, id: u32, chart: Chart) -> Result<Chart, Error> {
        check_chart(&chart)?;
        let i = self.chart_index(sheet, id)?;
        let data = self.sheet_data_mut(sheet)?;
        Ok(std::mem::replace(&mut data.charts[i].chart, chart))
    }

    /// Moves/resizes chart `id`; returns the old anchor.
    pub fn set_chart_anchor(
        &mut self,
        sheet: SheetId,
        id: u32,
        anchor: ChartAnchor,
    ) -> Result<ChartAnchor, Error> {
        anchor.check()?;
        let i = self.chart_index(sheet, id)?;
        let data = self.sheet_data_mut(sheet)?;
        Ok(std::mem::replace(&mut data.charts[i].anchor, anchor))
    }

    /// Removes chart `id`; returns it.
    pub fn remove_chart(&mut self, sheet: SheetId, id: u32) -> Result<ChartObject, Error> {
        let i = self.chart_index(sheet, id)?;
        Ok(self.sheet_data_mut(sheet)?.charts.remove(i))
    }

    /// The cells a reference formula points at, row-major (one row or
    /// column in practice), resolved against the workbook; `host` is the
    /// sheet of references without a sheet prefix. Whole rows/columns are
    /// clipped to the used range. With `visible_only`, hidden rows and
    /// columns are skipped. `None` when the formula is not a single
    /// reference to an existing sheet.
    pub fn resolve_ref(
        &self,
        formula: &str,
        host: SheetId,
        visible_only: bool,
    ) -> Option<ResolvedRef> {
        let Expr::Reference(r) = parse_ref(formula)? else {
            return None;
        };
        let sheet = match &r.sheet {
            Some(name) => self.sheet_id(name)?,
            None => host,
        };
        self.engine().sheet_name(sheet)?;
        let used = self.used_range(sheet).unwrap_or((0, 0));
        let (r0, c0, r1, c1) = match r.kind {
            RangeKind::Cell(c) => (c.row, c.col, c.row, c.col),
            RangeKind::Area(a, b) => (a.row, a.col, b.row, b.col),
            RangeKind::Cols { start, end, .. } => (0, start, used.0, end),
            RangeKind::Rows { start, end, .. } => (start, 0, end, used.1),
        };
        // Huge references (A1:A1048576) end at the used range.
        let (r1, c1) = (r1.min(used.0.max(r0)), c1.min(used.1.max(c0)));
        let mut out = ResolvedRef::default();
        for row in r0..=r1 {
            if visible_only && self.row_info(sheet, row).hidden {
                continue;
            }
            for col in c0..=c1 {
                if visible_only && self.col_info(sheet, col).hidden {
                    continue;
                }
                let at = CellCoord::new(sheet, row, col);
                let value = self.value(at);
                let format = self.style(at).number_format.clone();
                if out.points.is_empty() {
                    out.format_code.clone_from(&format);
                }
                let text = display_value(&value, format.as_deref());
                out.points.push((chart_value(&value), text));
            }
        }
        Some(out)
    }

    /// The data of chart `id` on `sheet` as the renderer draws it.
    pub fn chart_data(&self, sheet: SheetId, id: u32) -> Result<ResolvedChart, Error> {
        let obj = self.chart(sheet, id).ok_or(Error::UnknownChart(id))?;
        Ok(self.resolve_chart(&obj.chart, sheet))
    }

    /// Resolves `chart` (living on `host`) against the workbook:
    /// references are read from the cells (hidden rows/columns skipped
    /// when [`Chart::plot_visible_only`]), unresolvable ones from their
    /// cached values. Values: numbers as is, text as 0 (as Excel plots
    /// it), blanks and errors as `None`.
    pub fn resolve_chart(&self, chart: &Chart, host: SheetId) -> ResolvedChart {
        if matches!(chart.kind, ChartKind::Unsupported { .. }) {
            return ResolvedChart::default();
        }
        let vis = chart.plot_visible_only;
        let data = |d: &core_model::chart::DataRef| -> ResolvedRef {
            match d {
                core_model::chart::DataRef::Ref { formula, cache } => self
                    .resolve_ref(formula, host, vis)
                    .unwrap_or_else(|| ResolvedRef {
                        points: cache
                            .iter()
                            .flatten()
                            .map(|v| (v.clone(), value_text(v)))
                            .collect(),
                        format_code: None,
                    }),
                core_model::chart::DataRef::Literal { values } => ResolvedRef {
                    points: values.iter().map(|v| (v.clone(), value_text(v))).collect(),
                    format_code: None,
                },
            }
        };
        let text = |t: &TextSource| -> String {
            match t {
                TextSource::Literal { text } => text.clone(),
                TextSource::Ref { formula, cache } => self
                    .resolve_ref(formula, host, false)
                    .map(|r| {
                        r.points
                            .into_iter()
                            .map(|(_, t)| t)
                            .filter(|t| !t.is_empty())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .or_else(|| cache.clone())
                    .unwrap_or_default(),
            }
        };
        let series: Vec<ResolvedSeries> = chart
            .series
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let vals = data(&s.values);
                let values: Vec<Option<f64>> = vals
                    .points
                    .iter()
                    .map(|(v, _)| match v {
                        ChartValue::Number(n) => Some(*n),
                        ChartValue::Text(_) => Some(0.0),
                        ChartValue::Blank => None,
                    })
                    .collect();
                let n = values.len();
                let cats = chart.series_categories(i).map(data);
                let mut categories: Vec<String> = match &cats {
                    Some(c) => c.points.iter().map(|(_, t)| t.clone()).collect(),
                    None => (1..=n).map(|k| k.to_string()).collect(),
                };
                categories.resize(n, String::new());
                let x_values = match &cats {
                    Some(c) => {
                        let numeric = c
                            .points
                            .iter()
                            .all(|(v, _)| matches!(v, ChartValue::Number(_) | ChartValue::Blank))
                            && c.points
                                .iter()
                                .any(|(v, _)| matches!(v, ChartValue::Number(_)));
                        numeric.then(|| {
                            let mut xs: Vec<Option<f64>> = c
                                .points
                                .iter()
                                .map(|(v, _)| match v {
                                    ChartValue::Number(x) => Some(*x),
                                    _ => None,
                                })
                                .collect();
                            xs.resize(n, None);
                            xs
                        })
                    }
                    None => matches!(chart.series_kind(i), ChartKind::Scatter { .. })
                        .then(|| (1..=n).map(|k| Some(k as f64)).collect()),
                };
                ResolvedSeries {
                    name: s
                        .name
                        .as_ref()
                        .map(text)
                        .unwrap_or_else(|| format!("Series{}", i + 1)),
                    categories,
                    x_values,
                    values,
                    format_code: vals.format_code,
                    category_format_code: cats.and_then(|c| c.format_code),
                }
            })
            .collect();
        let title = chart.title.as_ref().and_then(|t| match &t.text {
            Some(src) => Some(text(src)),
            None => (series.len() == 1).then(|| series[0].name.clone()),
        });
        ResolvedChart { series, title }
    }

    /// After a row/column insert or delete on `sheet`: moves the anchors
    /// of its charts and adjusts every chart reference to it.
    pub(crate) fn shift_charts(&mut self, sheet: SheetId, op: StructuralOp) {
        let names = self.sheets();
        let Some(target) = names
            .iter()
            .find(|(id, _)| *id == sheet)
            .map(|(_, n)| n.clone())
        else {
            return;
        };
        for (id, host) in &names {
            let Ok(data) = self.sheet_data_mut(*id) else {
                continue;
            };
            let ctx = AdjustContext {
                host_sheet: host,
                target_sheet: &target,
                op,
            };
            for obj in &mut data.charts {
                if *id == sheet {
                    obj.anchor.shift(op);
                }
                for f in obj.chart.formulas_mut() {
                    let Some(ast) = parse_ref(f) else { continue };
                    let adjusted = adjust_references(&ast, &ctx);
                    if adjusted != ast {
                        *f = adjusted.to_string().trim_start_matches('=').to_owned();
                    }
                }
            }
        }
    }

    /// After renaming sheet `from` to `to`: chart references follow (on
    /// every sheet, or only on `only`).
    pub(crate) fn rename_chart_refs(&mut self, only: Option<SheetId>, from: &str, to: &str) {
        for (id, _) in self.sheets() {
            if only.is_some_and(|o| o != id) {
                continue;
            }
            let Ok(data) = self.sheet_data_mut(id) else {
                continue;
            };
            for obj in &mut data.charts {
                for f in obj.chart.formulas_mut() {
                    if let Some(new) = renamed(f, from, to) {
                        *f = new;
                    }
                }
            }
        }
    }

    /// The sheets whose charts reference a cell of `cells` (cells of one
    /// or more sheets), for the UI to refresh: a chart on sheet `S`
    /// referencing a changed cell adds `S`.
    pub fn sheets_with_charts_on(&self, cells: &[CellCoord]) -> Vec<SheetId> {
        let mut out = Vec::new();
        if cells.is_empty() {
            return out;
        }
        for (host, _) in self.sheets() {
            let hits = self.charts(host).iter().any(|obj| {
                obj.chart.formulas().into_iter().any(|f| {
                    let Some(Expr::Reference(r)) = parse_ref(f) else {
                        return false;
                    };
                    let Some(sheet) = r.sheet.as_deref().map_or(Some(host), |n| self.sheet_id(n))
                    else {
                        return false;
                    };
                    let (r0, c0, r1, c1) = match r.kind {
                        RangeKind::Cell(c) => (c.row, c.col, c.row, c.col),
                        RangeKind::Area(a, b) => (a.row, a.col, b.row, b.col),
                        RangeKind::Cols { start, end, .. } => (0, start, MAX_ROW, end),
                        RangeKind::Rows { start, end, .. } => (start, 0, end, MAX_COL),
                    };
                    cells.iter().any(|c| {
                        c.sheet == sheet && (r0..=r1).contains(&c.row) && (c0..=c1).contains(&c.col)
                    })
                })
            });
            if hits {
                out.push(host);
            }
        }
        out
    }
}

fn value_text(v: &ChartValue) -> String {
    match v {
        ChartValue::Number(n) => display_value(&Value::Number(*n), None),
        ChartValue::Text(t) => t.clone(),
        ChartValue::Blank => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::chart::{CellClass, DataRef};

    fn anchor() -> ChartAnchor {
        ChartAnchor::TwoCell {
            from: CellOffset {
                col: 4,
                row: 1,
                ..CellOffset::default()
            },
            to: CellOffset {
                col: 10,
                row: 15,
                col_offset: 100,
                row_offset: 200,
            },
        }
    }

    /// Sheet "Data": A1:C4 with header row and categories.
    fn book() -> (Workbook, SheetId) {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.rename_sheet(s, "Data").unwrap();
        let rows = [
            ["", "Rev", "Cost"],
            ["Jan", "10", "4"],
            ["Feb", "", "5"],
            ["Mar", "x", "=1/0"],
        ];
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                    .unwrap();
            }
        }
        (wb, s)
    }

    fn recommended() -> Chart {
        let t = CellClass::Text;
        let n = CellClass::Number;
        let cells = vec![
            vec![CellClass::Empty, t, t],
            vec![t, n, n],
            vec![t, n, n],
            vec![t, n, n],
        ];
        Chart::from_range("Data", 0, 0, &cells).unwrap()
    }

    #[test]
    fn add_update_remove() {
        let (mut wb, s) = book();
        let obj = ChartObject {
            id: 0,
            name: String::new(),
            anchor: anchor(),
            chart: recommended(),
        };
        assert_eq!(wb.add_chart(s, obj.clone()).unwrap(), 1);
        assert_eq!(wb.add_chart(s, obj.clone()).unwrap(), 2);
        assert_eq!(wb.charts(s)[1].name, "Chart 2");
        let dup = ChartObject {
            id: 1,
            ..obj.clone()
        };
        assert!(matches!(wb.add_chart(s, dup), Err(Error::InvalidChart(_))));
        let mut bad = recommended();
        bad.series[0].values = DataRef::reference("Data!$B$2:");
        assert!(wb.update_chart(s, 1, bad).is_err());
        let old = wb.update_chart(s, 1, Chart::new(ChartKind::Pie)).unwrap();
        assert_eq!(old, recommended());
        assert!(matches!(wb.remove_chart(s, 9), Err(Error::UnknownChart(9))));
        assert_eq!(wb.remove_chart(s, 1).unwrap().id, 1);
        assert_eq!(wb.charts(s).len(), 1);
    }

    #[test]
    fn resolves_like_excel() {
        let (mut wb, s) = book();
        wb.add_chart(
            s,
            ChartObject {
                id: 0,
                name: String::new(),
                anchor: anchor(),
                chart: recommended(),
            },
        )
        .unwrap();
        let d = wb.chart_data(s, 1).unwrap();
        assert_eq!(d.series.len(), 2);
        assert_eq!(d.series[0].name, "Rev");
        assert_eq!(d.series[0].categories, ["Jan", "Feb", "Mar"]);
        assert_eq!(d.series[0].values, [Some(10.0), None, Some(0.0)]);
        assert_eq!(d.series[1].values, [Some(4.0), Some(5.0), None]);
        assert_eq!(d.series[0].x_values, None);
        assert_eq!(d.title.as_deref(), Some("Chart Title"));
        // Hidden rows are skipped (plot visible only).
        wb.set_row_hidden(s, 2, true).unwrap();
        let d = wb.chart_data(s, 1).unwrap();
        assert_eq!(d.series[1].values, [Some(4.0), None]);
        assert_eq!(d.series[1].categories, ["Jan", "Mar"]);
        // Unresolvable references fall back to the cache.
        let mut c = Chart::new(ChartKind::column());
        c.series.push(core_model::chart::Series::new(DataRef::Ref {
            formula: "Gone!$A$1:$A$2".into(),
            cache: Some(vec![ChartValue::Number(7.0), ChartValue::Blank]),
        }));
        let d = wb.resolve_chart(&c, s);
        assert_eq!(d.series[0].values, [Some(7.0), None]);
        assert_eq!(d.series[0].categories, ["1", "2"]);
        assert_eq!(d.series[0].name, "Series1");
        assert_eq!(d.title, None);
    }

    #[test]
    fn references_follow_edits() {
        let (mut wb, s) = book();
        let other = wb.add_sheet("Other").unwrap();
        let obj = ChartObject {
            id: 0,
            name: String::new(),
            anchor: anchor(),
            chart: recommended(),
        };
        wb.add_chart(other, obj.clone()).unwrap();
        wb.add_chart(s, obj).unwrap();
        wb.insert_rows(s, 0, 2).unwrap();
        let f = |wb: &Workbook, sheet| {
            wb.charts(sheet)[0]
                .chart
                .formulas()
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        assert_eq!(f(&wb, other)[0], "Data!$A$4:$A$6");
        assert_eq!(f(&wb, s)[0], "Data!$A$4:$A$6");
        // Only the chart on the edited sheet moves.
        let ChartAnchor::TwoCell { from, to } = wb.charts(s)[0].anchor else {
            panic!()
        };
        assert_eq!((from.row, to.row, to.row_offset), (3, 17, 200));
        assert_eq!(wb.charts(other)[0].anchor, anchor());
        wb.delete_cols(s, 1, 1).unwrap();
        assert_eq!(f(&wb, s)[1], "#REF!");
        assert_eq!(f(&wb, s)[2], "#REF!");
        assert_eq!(f(&wb, s)[3], "Data!$B$3");
        wb.rename_sheet(s, "New name").unwrap();
        assert_eq!(f(&wb, other)[0], "'New name'!$A$4:$A$6");
        // Deleting the rows of a chart's top edge moves it to the span start.
        wb.delete_rows(s, 0, 5).unwrap();
        let ChartAnchor::TwoCell { from, to } = wb.charts(s)[0].anchor else {
            panic!()
        };
        assert_eq!((from.row, from.row_offset, to.row), (0, 0, 12));
    }

    #[test]
    fn duplicate_sheet_repoints_charts() {
        let (mut wb, s) = book();
        wb.add_chart(
            s,
            ChartObject {
                id: 0,
                name: String::new(),
                anchor: anchor(),
                chart: recommended(),
            },
        )
        .unwrap();
        let (copy, _) = wb.duplicate_sheet(s, "Data (2)").unwrap();
        let f = wb.charts(copy)[0].chart.formulas()[0].to_owned();
        assert_eq!(f, "'Data (2)'!$A$2:$A$4");
        assert_eq!(wb.charts(s)[0].chart.formulas()[0], "Data!$A$2:$A$4");
        let cells = [CellCoord::new(copy, 1, 1)];
        assert_eq!(wb.sheets_with_charts_on(&cells), vec![copy]);
        assert!(wb
            .sheets_with_charts_on(&[CellCoord::new(s, 9, 9)])
            .is_empty());
    }
}
