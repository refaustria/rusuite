//! Charts on slides: `p:graphicFrame` → `a:graphicData uri=…/chart` →
//! `c:chart r:id` → `ppt/charts/chartN.xml` (read and written by
//! [`fmt_ooxml::chart`], the same code as xlsx charts), with the embedded
//! workbook `ppt/embeddings/Microsoft_Excel_WorksheetN.xlsx` (a `package`
//! relationship of the chart part, `c:externalData`).
//!
//! Reading takes the chart's data from the part's caches
//! (`c:strCache`/`c:numCache`) into [`ChartData`] and keeps the embedded
//! workbook verbatim; writing fills the caches from [`ChartData`] and
//! embeds the original workbook, or one generated with `fmt-xlsx` (the
//! table in `Sheet1`, as PowerPoint lays it out) so that PowerPoint's
//! "Edit Data" works.

use std::collections::HashMap;

use core_model::chart::{Chart, ChartValue, DataRef, TextSource};
use fmt_ooxml::chart::{ChartData as CacheData, RefData};
use model_show::{ChartData, ChartSeriesData, ChartShape};

use crate::{Error, Result};

/// `a:graphicData/@uri` of charts.
pub const CHART_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
/// Relationship type of an embedded package (the chart's workbook).
pub const PACKAGE_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
/// Content type of an embedded `.xlsx`.
pub const XLSX_CT: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

fn number_text(n: f64) -> String {
    if n == n.trunc() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn value_text(v: &ChartValue) -> String {
    match v {
        ChartValue::Number(n) => number_text(*n),
        ChartValue::Text(t) => t.clone(),
        ChartValue::Blank => String::new(),
    }
}

/// The values of a data reference from its cache or literal.
fn values_of(d: &DataRef) -> Vec<ChartValue> {
    match d {
        DataRef::Ref { cache, .. } => cache.clone().unwrap_or_default(),
        DataRef::Literal { values } => values.clone(),
    }
}

/// A chart read from a file → the chart shape: the data from the caches
/// (series names, values, the categories of the first series that has
/// some; `1, 2, …` without categories), the caches removed from the
/// series (the table holds the data). `workbook`: the embedded workbook's
/// media id.
pub fn shape_from_chart(
    mut chart: Chart,
    workbook: Option<core_model::media::MediaId>,
) -> ChartShape {
    let mut series = Vec::with_capacity(chart.series.len());
    for s in &chart.series {
        let name = match &s.name {
            Some(TextSource::Literal { text }) => text.clone(),
            Some(TextSource::Ref { cache, .. }) => cache.clone().unwrap_or_default(),
            None => String::new(),
        };
        let values = values_of(&s.values)
            .iter()
            .map(|v| match v {
                ChartValue::Number(n) => Some(*n),
                ChartValue::Text(t) => t.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
                ChartValue::Blank => None,
            })
            .collect();
        series.push(ChartSeriesData {
            name,
            values,
            format_code: None,
        });
    }
    let mut categories: Vec<String> = (0..chart.series.len())
        .find_map(|i| chart.series_categories(i))
        .map(|d| values_of(d).iter().map(value_text).collect())
        .unwrap_or_default();
    let n = series
        .iter()
        .map(|s: &ChartSeriesData| s.values.len())
        .max()
        .unwrap_or(0)
        .max(categories.len());
    if categories.is_empty() {
        categories = (1..=n).map(|i| i.to_string()).collect();
    }
    categories.resize(n, String::new());
    for s in &mut chart.series {
        if let Some(TextSource::Ref { cache, .. }) = &mut s.name {
            *cache = None;
        }
        for d in std::iter::once(&mut s.values).chain(s.categories.as_mut()) {
            if let DataRef::Ref { cache, .. } = d {
                *cache = None;
            }
        }
    }
    if let Some(DataRef::Ref { cache, .. }) = &mut chart.categories {
        *cache = None;
    }
    let mut data = ChartData { categories, series };
    data.normalize();
    ChartShape {
        chart,
        data,
        workbook,
    }
}

/// The caches of a chart shape's references, from its table.
pub struct TableData {
    refs: HashMap<String, RefData>,
}

impl TableData {
    pub fn new(shape: &ChartShape) -> Self {
        let mut refs = HashMap::new();
        let d = &shape.data;
        let cat_points: Vec<(ChartValue, String)> = d
            .categories
            .iter()
            .map(|c| match c.trim().parse::<f64>() {
                Ok(n) if n.is_finite() && !c.trim().is_empty() => {
                    (ChartValue::Number(n), c.clone())
                }
                _ => (ChartValue::Text(c.clone()), c.clone()),
            })
            .collect();
        for (i, s) in shape.chart.series.iter().enumerate() {
            let Some(sd) = d.series.get(i) else { continue };
            if let Some(f) = s.name.as_ref().and_then(TextSource::formula) {
                refs.entry(f.to_owned()).or_insert_with(|| RefData {
                    points: vec![(ChartValue::Text(sd.name.clone()), sd.name.clone())],
                    format_code: None,
                });
            }
            if let Some(f) = s.values.formula() {
                refs.entry(f.to_owned()).or_insert_with(|| RefData {
                    points: sd
                        .values
                        .iter()
                        .map(|v| match v {
                            Some(n) => (ChartValue::Number(*n), number_text(*n)),
                            None => (ChartValue::Blank, String::new()),
                        })
                        .collect(),
                    format_code: sd.format_code.clone(),
                });
            }
            if let Some(f) = shape.chart.series_categories(i).and_then(DataRef::formula) {
                refs.entry(f.to_owned()).or_insert_with(|| RefData {
                    points: cat_points.clone(),
                    format_code: None,
                });
            }
        }
        TableData { refs }
    }
}

impl CacheData for TableData {
    fn resolve(&self, formula: &str) -> Option<RefData> {
        self.refs.get(formula).cloned()
    }
}

/// A minimal workbook holding the table in `Sheet1` (series names in row
/// 1 from B, categories in column A from row 2, values below the names),
/// written with `fmt-xlsx`.
pub fn workbook_xlsx(data: &ChartData) -> Result<Vec<u8>> {
    use model_sheet::{CellContent, CellCoord, Workbook};
    let mut wb = Workbook::new();
    let sheet = wb
        .sheets()
        .first()
        .map(|(id, _)| *id)
        .ok_or_else(|| Error::InvalidPresentation("workbook without a sheet".into()))?;
    let bad =
        |e: model_sheet::EngineError| Error::InvalidPresentation(format!("chart workbook: {e}"));
    let text = |s: &str| CellContent::Value(engine_formula::Value::Text(s.to_owned()));
    let num = |n: f64| CellContent::Value(engine_formula::Value::Number(n));
    wb.begin_batch();
    let mut put = |row: usize, col: usize, c: CellContent| -> Result<()> {
        let at = CellCoord::new(sheet, row as u32, col as u32);
        wb.engine_mut().set_content(at, c).map(|_| ()).map_err(bad)
    };
    for (i, s) in data.series.iter().enumerate() {
        put(0, i + 1, text(&s.name))?;
        for (r, v) in s.values.iter().enumerate() {
            if let Some(v) = v {
                put(r + 1, i + 1, num(*v))?;
            }
        }
    }
    for (r, c) in data.categories.iter().enumerate() {
        let content = match c.trim().parse::<f64>() {
            Ok(n) if n.is_finite() && !c.trim().is_empty() => num(n),
            _ => text(c),
        };
        put(r + 1, 0, content)?;
    }
    wb.end_batch();
    fmt_xlsx::write(&wb).map_err(|e| Error::InvalidPresentation(format!("chart workbook: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::chart::ChartKind;

    #[test]
    fn caches_become_the_table_and_back() {
        let sample = ChartShape::sample(ChartKind::column());
        let xml = fmt_ooxml::chart::write_chart(&sample.chart, &TableData::new(&sample));
        let (chart, warnings) = fmt_ooxml::chart::read_chart(&xml, "/c.xml").unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        let back = shape_from_chart(chart, None);
        assert_eq!(back, sample);
    }

    #[test]
    fn generated_workbook_opens_in_fmt_xlsx() {
        let data = ChartData::sample();
        let bytes = workbook_xlsx(&data).unwrap();
        let wb = fmt_xlsx::read(&bytes).unwrap();
        let (sheet, name) = wb.sheets()[0].clone();
        assert_eq!(name, "Sheet1");
        let at = |r, c| wb.value(model_sheet::CellCoord::new(sheet, r, c));
        assert_eq!(at(0, 1), engine_formula::Value::Text("Series 1".into()));
        assert_eq!(at(1, 0), engine_formula::Value::Text("Category 1".into()));
        assert_eq!(at(2, 2), engine_formula::Value::Number(4.4));
        assert_eq!(at(4, 3), engine_formula::Value::Number(5.0));
    }
}
