//! Charts on slides: `p:graphicFrame` → `a:graphicData uri=…/chart` →
//! `c:chart r:id` → `ppt/charts/chartN.xml` (read and written by
//! [`fmt_ooxml::chart`], the same code as xlsx charts), with the embedded
//! workbook `ppt/embeddings/Microsoft_Excel_WorksheetN.xlsx` (a `package`
//! relationship of the chart part, `c:externalData`).
//!
//! Reading takes the chart's data from the part's caches
//! (`c:strCache`/`c:numCache`) into [`ChartData`] and keeps the embedded
//! workbook verbatim; writing fills the caches from [`ChartData`] and
//! embeds the original workbook, or a minimal one generated from the
//! table (`Sheet1`, as PowerPoint lays it out; [`workbook_xlsx`]) so that
//! PowerPoint's "Edit Data" works.

use std::collections::HashMap;

use core_model::chart::{Chart, ChartValue, DataRef, TextSource};
use fmt_ooxml::chart::{ChartData as CacheData, RefData};
use model_show::{ChartData, ChartSeriesData, ChartShape};

use crate::xml::XmlOut;
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

/// The embedded workbook of a chart's table, as PowerPoint lays it out
/// (`Sheet1`: series names in row 1 from column B, categories in column A
/// from row 2, the values of each series below its name; numbers as
/// numbers, text as inline strings). A minimal SpreadsheetML package
/// (workbook, one sheet, default styles) written directly, so that the
/// Show build carries no spreadsheet engine.
pub fn workbook_xlsx(data: &ChartData) -> Result<Vec<u8>> {
    use fmt_ooxml::{rel, Package, PartName, Relationships};
    use std::io::Cursor;

    const NS_MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    let pn = |s: &str| PartName::new(s).map_err(Error::Package);
    let col_name = |mut c: usize| {
        let mut s = String::new();
        loop {
            s.insert(0, (b'A' + (c % 26) as u8) as char);
            if c < 26 {
                break;
            }
            c = c / 26 - 1;
        }
        s
    };
    // rows of (column, cell) – text or number
    enum Cell<'a> {
        Text(&'a str),
        Num(f64),
    }
    let rows = 1 + data.categories.len().max(
        data.series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0),
    );
    let mut grid: Vec<Vec<(usize, Cell<'_>)>> = (0..rows).map(|_| Vec::new()).collect();
    for (r, c) in data.categories.iter().enumerate() {
        let t = c.trim();
        let cell = match t.parse::<f64>() {
            Ok(n) if n.is_finite() && !t.is_empty() => Cell::Num(n),
            _ => Cell::Text(c),
        };
        grid[r + 1].push((0, cell));
    }
    for (i, s) in data.series.iter().enumerate() {
        grid[0].push((i + 1, Cell::Text(&s.name)));
        for (r, v) in s.values.iter().enumerate() {
            if let Some(v) = v.filter(|v| v.is_finite()) {
                grid[r + 1].push((i + 1, Cell::Num(v)));
            }
        }
    }
    let mut x = XmlOut::new();
    x.start("worksheet", &[("xmlns", NS_MAIN)]);
    x.start("sheetData", &[]);
    for (r, cells) in grid.iter_mut().enumerate() {
        if cells.is_empty() {
            continue;
        }
        cells.sort_by_key(|(c, _)| *c);
        let rn = (r + 1).to_string();
        x.start("row", &[("r", &rn)]);
        for (c, cell) in cells.iter() {
            let at = format!("{}{}", col_name(*c), r + 1);
            match cell {
                Cell::Num(n) => {
                    x.start("c", &[("r", &at)]);
                    x.text_el("v", &[], &number_text(*n));
                    x.end("c");
                }
                Cell::Text(t) => {
                    x.start("c", &[("r", &at), ("t", "inlineStr")]);
                    x.start("is", &[]);
                    x.text_el("t", &[("xml:space", "preserve")], t);
                    x.end("is");
                    x.end("c");
                }
            }
        }
        x.end("row");
    }
    x.end("sheetData");
    x.end("worksheet");
    let sheet = x.finish();

    let mut w = XmlOut::new();
    w.start("workbook", &[("xmlns", NS_MAIN), ("xmlns:r", rel::NS)]);
    w.start("sheets", &[]);
    w.empty(
        "sheet",
        &[("name", "Sheet1"), ("sheetId", "1"), ("r:id", "rId1")],
    );
    w.end("sheets");
    w.end("workbook");

    let mut st = XmlOut::new();
    st.start("styleSheet", &[("xmlns", NS_MAIN)]);
    st.start("fonts", &[("count", "1")]);
    st.start("font", &[]);
    st.empty("sz", &[("val", "11")]);
    st.empty("name", &[("val", "Calibri")]);
    st.end("font");
    st.end("fonts");
    st.start("fills", &[("count", "2")]);
    for p in ["none", "gray125"] {
        st.start("fill", &[]);
        st.empty("patternFill", &[("patternType", p)]);
        st.end("fill");
    }
    st.end("fills");
    st.start("borders", &[("count", "1")]);
    st.empty("border", &[]);
    st.end("borders");
    st.start("cellStyleXfs", &[("count", "1")]);
    st.empty(
        "xf",
        &[
            ("numFmtId", "0"),
            ("fontId", "0"),
            ("fillId", "0"),
            ("borderId", "0"),
        ],
    );
    st.end("cellStyleXfs");
    st.start("cellXfs", &[("count", "1")]);
    st.empty(
        "xf",
        &[
            ("numFmtId", "0"),
            ("fontId", "0"),
            ("fillId", "0"),
            ("borderId", "0"),
            ("xfId", "0"),
        ],
    );
    st.end("cellXfs");
    st.end("styleSheet");

    let mut pkg = Package::new();
    let book = pn("/xl/workbook.xml")?;
    pkg.insert_part(
        book.clone(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        w.finish(),
    );
    pkg.insert_part(
        pn("/xl/worksheets/sheet1.xml")?,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
        sheet,
    );
    pkg.insert_part(
        pn("/xl/styles.xml")?,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
        st.finish(),
    );
    let mut rels = Relationships::new();
    rels.add(rel::WORKSHEET, "worksheets/sheet1.xml");
    rels.add(rel::STYLES, "styles.xml");
    pkg.set_relationships(book, rels);
    pkg.package_relationships_mut()
        .add(rel::OFFICE_DOCUMENT, "xl/workbook.xml");
    Ok(pkg.write(Cursor::new(Vec::new()))?.into_inner())
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
