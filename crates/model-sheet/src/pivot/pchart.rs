//! PivotCharts (P9-C3): charts bound to a pivot table
//! ([`ChartObject::pivot`](crate::ChartObject::pivot)) take their series
//! from the table's layout like Excel's – the innermost row items are the
//! categories, every innermost column line (column items × value fields)
//! is a series; subtotals and grand totals are left out. The series are
//! derived again whenever the table is rendered (refresh, filter, sort,
//! layout changes), as references to the table's cells when the rows are
//! contiguous, else as literal values.

use core_model::chart::{ChartValue, DataRef, Series, TextSource};
use engine_formula::{SheetId, Value};

use super::{AxisLine, CellRole, LineKind, PivotOutput};
use crate::names::{abs_area, sheet_prefix};
use crate::workbook::Workbook;

/// The categories and series of a pivot chart.
#[derive(Debug, Clone, PartialEq)]
pub struct PivotChartData {
    pub categories: Option<DataRef>,
    /// `(name, values)` per series.
    pub series: Vec<(TextSource, DataRef)>,
}

/// The positions of the innermost data lines of an axis.
fn leaves(lines: &[AxisLine]) -> Vec<usize> {
    let mut out = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if l.kind != LineKind::Data {
            continue;
        }
        let deeper = lines.get(i + 1).is_some_and(|n| {
            n.kind == LineKind::Data
                && n.items.len() > l.items.len()
                && n.items[..l.items.len()] == l.items[..]
        });
        if !deeper {
            out.push(i);
        }
    }
    out
}

fn contiguous(v: &[u32]) -> bool {
    v.windows(2).all(|w| w[1] == w[0] + 1)
}

fn text(out: &PivotOutput, r: u32, c: u32) -> String {
    out.cell(r, c).map_or_else(String::new, |cell| {
        crate::numfmt::display_value(&cell.value, cell.number_format.as_deref())
    })
}

/// The series of a pivot table's layout (`sheet` = the table's sheet).
pub fn chart_data_of(out: &PivotOutput, sheet_name: &str) -> PivotChartData {
    let t = out.table;
    let first_row = t.r0 + out.header_rows;
    let data_col = t.c0 + out.label_cols;
    let rows: Vec<u32> = leaves(&out.row_items)
        .into_iter()
        .map(|i| first_row + i as u32)
        .collect();
    let cols: Vec<u32> = leaves(&out.col_items)
        .into_iter()
        .map(|j| data_col + j as u32)
        .collect();
    let prefix = sheet_prefix(sheet_name);
    let label_cols = out.label_cols;
    // Categories: the innermost label of each leaf row, outer labels in
    // front when there are several label columns or levels.
    let categories = if rows.is_empty() || label_cols == 0 {
        None
    } else if contiguous(&rows) && label_cols == 1 && out.row_fields.len() <= 1 {
        Some(DataRef::reference(format!(
            "{prefix}{}",
            abs_area(rows[0], t.c0, *rows.last().expect("rows"), t.c0)
        )))
    } else {
        let mut outer: Vec<String> = Vec::new();
        let mut labels = Vec::new();
        let mut last_row = first_row;
        for &r in &rows {
            // Outer labels from the lines up to this one (compact parents).
            for rr in last_row..=r {
                for c in t.c0..t.c0 + label_cols {
                    if let Some(cell) = out.cell(rr, c) {
                        if cell.kind == CellRole::RowLabel {
                            let lvl = cell.level as usize;
                            outer.truncate(lvl);
                            outer.push(text(out, rr, c));
                        }
                    }
                }
            }
            last_row = r + 1;
            labels.push(ChartValue::Text(outer.join(" - ")));
        }
        Some(DataRef::Literal { values: labels })
    };
    let header_rows: Vec<u32> = (t.r0..first_row).collect();
    let mut series = Vec::new();
    for &c in &cols {
        let col_labels: Vec<u32> = header_rows
            .iter()
            .copied()
            .filter(|&r| out.cell(r, c).is_some_and(|x| x.kind == CellRole::ColLabel))
            .collect();
        let name = match col_labels.as_slice() {
            [r] => TextSource::reference(format!("{prefix}{}", abs_area(*r, c, *r, c))),
            [] => {
                // No column items: the data caption above the column.
                let caption = header_rows
                    .iter()
                    .rev()
                    .find(|&&r| out.cell(r, c).is_some_and(|x| x.kind == CellRole::Header))
                    .map(|&r| text(out, r, c))
                    .filter(|s| !s.is_empty() && s != "Column Labels")
                    .unwrap_or_else(|| "Total".to_owned());
                TextSource::literal(caption)
            }
            many => TextSource::literal(
                many.iter()
                    .map(|&r| text(out, r, c))
                    .collect::<Vec<_>>()
                    .join(" - "),
            ),
        };
        let values = if rows.is_empty() {
            DataRef::Literal { values: Vec::new() }
        } else if contiguous(&rows) {
            DataRef::reference(format!(
                "{prefix}{}",
                abs_area(rows[0], c, *rows.last().expect("rows"), c)
            ))
        } else {
            DataRef::Literal {
                values: rows
                    .iter()
                    .map(|&r| match out.cell(r, c).map(|x| &x.value) {
                        Some(Value::Number(n)) => ChartValue::Number(*n),
                        _ => ChartValue::Blank,
                    })
                    .collect(),
            }
        };
        series.push((name, values));
    }
    PivotChartData { categories, series }
}

impl Workbook {
    /// The series pivot table `id` gives a PivotChart (`None`: no such
    /// table, or not laid out).
    pub fn pivot_chart_data(&self, id: u32) -> Option<PivotChartData> {
        let (s, _) = self.pivot(id)?;
        let out = self.pivot_output(id)?;
        let name = self.engine().sheet_name(s)?;
        Some(chart_data_of(out, name))
    }

    /// Re-derives the series of every PivotChart from its table (keeping
    /// each series' formatting by position). Charts whose table is gone
    /// keep their series.
    pub fn sync_pivot_charts(&mut self) {
        let sheets: Vec<SheetId> = self.sheets().into_iter().map(|(s, _)| s).collect();
        for s in sheets {
            let bound: Vec<(usize, u32)> = self
                .charts(s)
                .iter()
                .enumerate()
                .filter_map(|(i, c)| Some((i, c.pivot?)))
                .collect();
            for (i, pid) in bound {
                let Some(data) = self.pivot_chart_data(pid) else {
                    continue;
                };
                let Ok(sd) = self.sheet_data_mut(s) else {
                    continue;
                };
                let chart = &mut sd.charts[i].chart;
                let old = std::mem::take(&mut chart.series);
                chart.categories = data.categories;
                chart.series = data
                    .series
                    .into_iter()
                    .take(255)
                    .enumerate()
                    .map(|(k, (name, values))| {
                        let mut ser = old.get(k).cloned().unwrap_or_else(|| {
                            Series::new(DataRef::Literal { values: Vec::new() })
                        });
                        ser.name = Some(name);
                        ser.values = values;
                        ser.categories = None;
                        ser
                    })
                    .collect();
            }
        }
    }
}
