//! Charts on slides (`p:graphicFrame` with `c:chart`): the shared
//! [`core_model::chart::Chart`] (the same model as Calc's, see
//! `docs/charts.md`) plus the data it shows. A presentation has no
//! sheet, so the data is an embedded table ([`ChartData`]: categories ×
//! series), laid out like PowerPoint's embedded workbook: `Sheet1`, the
//! series names in row 1 from column B, the categories in column A from
//! row 2 and the values below the names. The chart's references point
//! into that sheet ([`ChartShape::canonicalize`]); the file's embedded
//! workbook (`ppt/embeddings/*.xlsx`) is kept as raw bytes in the media
//! store until the data is edited.

use core_model::chart::{
    Chart, ChartKind, ChartTitle, DataRef, Legend, LegendPosition, ResolvedChart, ResolvedSeries,
    Series, TextSource,
};
use core_model::media::MediaId;
use serde::{Deserialize, Serialize};

/// The embedded sheet's name.
pub const CHART_SHEET: &str = "Sheet1";

/// Most series a chart may have (Excel's limit).
pub const MAX_SERIES: usize = 255;

/// Most categories (rows) of the embedded table.
pub const MAX_CATEGORIES: usize = 4096;

/// One series of a chart's table: its name and one value per category.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ChartSeriesData {
    /// Legend text (row 1 of the embedded sheet).
    pub name: String,
    /// One value per category (`null` = blank).
    pub values: Vec<Option<f64>>,
    /// Number format of the values (`None` = General).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub format_code: Option<String>,
}

/// The data of a chart on a slide: a literal table of categories and
/// series values (what PowerPoint keeps in the embedded workbook and in
/// the chart part's caches).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ChartData {
    /// Category labels (column A); scatter charts: the X values as text.
    pub categories: Vec<String>,
    /// Series in chart order.
    pub series: Vec<ChartSeriesData>,
}

impl ChartData {
    /// PowerPoint's sample data of a new chart: three series × four
    /// categories.
    pub fn sample() -> Self {
        let s = |name: &str, v: [f64; 4]| ChartSeriesData {
            name: name.to_owned(),
            values: v.into_iter().map(Some).collect(),
            format_code: None,
        };
        ChartData {
            categories: (1..=4).map(|i| format!("Category {i}")).collect(),
            series: vec![
                s("Series 1", [4.3, 2.5, 3.5, 4.5]),
                s("Series 2", [2.4, 4.4, 1.8, 2.8]),
                s("Series 3", [2.0, 2.0, 3.0, 5.0]),
            ],
        }
    }

    /// PowerPoint's sample data of a new scatter chart (X values 0.7,
    /// 1.8, 2.6; one series "Y-Values").
    pub fn sample_scatter() -> Self {
        ChartData {
            categories: vec!["0.7".into(), "1.8".into(), "2.6".into()],
            series: vec![ChartSeriesData {
                name: "Y-Values".into(),
                values: vec![Some(2.7), Some(3.2), Some(0.8)],
                format_code: None,
            }],
        }
    }

    /// Pads or cuts every series to the number of categories.
    pub fn normalize(&mut self) {
        let n = self.categories.len();
        for s in &mut self.series {
            s.values.resize(n, None);
        }
    }

    /// Checks the limits and that values are finite.
    pub fn validate(&self) -> Result<(), String> {
        if self.series.len() > MAX_SERIES {
            return Err(format!("more than {MAX_SERIES} series"));
        }
        if self.categories.len() > MAX_CATEGORIES {
            return Err(format!("more than {MAX_CATEGORIES} categories"));
        }
        for s in &self.series {
            if s.values.iter().flatten().any(|v| !v.is_finite()) {
                return Err(format!(
                    "series {:?} has a value that is not finite",
                    s.name
                ));
            }
        }
        Ok(())
    }

    /// Series and categories swapped (Switch Row/Column): the category
    /// labels become the series names and vice versa.
    #[must_use]
    pub fn transposed(&self) -> Self {
        let n = self.categories.len();
        ChartData {
            categories: self.series.iter().map(|s| s.name.clone()).collect(),
            series: (0..n)
                .map(|i| ChartSeriesData {
                    name: self.categories[i].clone(),
                    values: self
                        .series
                        .iter()
                        .map(|s| s.values.get(i).copied().flatten())
                        .collect(),
                    format_code: self.series.first().and_then(|s| s.format_code.clone()),
                })
                .collect(),
        }
    }

    /// The data a renderer draws for `chart` (one resolved series per
    /// chart series, by position; see `docs/charts.md` "Data
    /// resolution"): numeric categories become X values, the automatic
    /// title is the only series' name.
    pub fn resolve(&self, chart: &Chart) -> ResolvedChart {
        if matches!(chart.kind, ChartKind::Unsupported { .. }) {
            return ResolvedChart::default();
        }
        let n = self.categories.len();
        let numbers: Vec<Option<f64>> = self
            .categories
            .iter()
            .map(|c| c.trim().parse::<f64>().ok().filter(|v| v.is_finite()))
            .collect();
        let numeric = !self.categories.is_empty()
            && self
                .categories
                .iter()
                .zip(&numbers)
                .all(|(c, v)| c.trim().is_empty() || v.is_some());
        let scatter = |i: usize| matches!(chart.series_kind(i), ChartKind::Scatter { .. });
        let series: Vec<ResolvedSeries> = (0..chart.series.len())
            .map(|i| {
                let d = self.series.get(i);
                let mut values = d.map(|d| d.values.clone()).unwrap_or_default();
                values.resize(n, None);
                let categories = if self.categories.is_empty() {
                    (1..=values.len()).map(|k| k.to_string()).collect()
                } else {
                    self.categories.clone()
                };
                let x_values = if numeric {
                    Some(numbers.clone())
                } else if scatter(i) {
                    Some((1..=values.len()).map(|k| Some(k as f64)).collect())
                } else {
                    None
                };
                let name = match &chart.series[i].name {
                    Some(TextSource::Literal { text }) => text.clone(),
                    _ => d
                        .map(|d| d.name.clone())
                        .filter(|n| !n.is_empty())
                        .unwrap_or_else(|| format!("Series{}", i + 1)),
                };
                ResolvedSeries {
                    name,
                    categories,
                    x_values,
                    values,
                    format_code: d.and_then(|d| d.format_code.clone()),
                    category_format_code: None,
                }
            })
            .collect();
        let title = chart.title.as_ref().and_then(|t| match &t.text {
            Some(TextSource::Literal { text }) => Some(text.clone()),
            Some(TextSource::Ref { cache, .. }) => cache.clone(),
            None if series.len() == 1 => Some(series[0].name.clone()),
            None => None,
        });
        ResolvedChart { series, title }
    }
}

/// A chart shape's content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ChartShape {
    /// The chart (same model as Calc's; references into the embedded
    /// sheet).
    #[cfg_attr(feature = "ts", ts(type = "import(\"@rusuite/ui-shared\").ChartModel"))]
    pub chart: Chart,
    /// The data.
    pub data: ChartData,
    /// The embedded workbook of the file (`ppt/embeddings/*.xlsx`, raw
    /// bytes in the media store), kept verbatim while the data is
    /// unchanged; `None` = generated from [`data`](Self::data) on save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<crate::ts::MediaId>"))]
    pub workbook: Option<MediaId>,
}

/// `A`, `B`, …, `Z`, `AA`, … for a 0-based column.
pub fn col_letters(mut col: usize) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (col % 26) as u8);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// The reference of the embedded sheet's cells `(col, r0..=r1)` (0-based
/// column, 1-based rows).
fn sheet_ref(col: usize, r0: usize, r1: usize) -> String {
    let c = col_letters(col);
    if r0 == r1 {
        format!("{CHART_SHEET}!${c}${r0}")
    } else {
        format!("{CHART_SHEET}!${c}${r0}:${c}${r1}")
    }
}

impl ChartShape {
    /// A new chart of `kind` on PowerPoint's sample data (Insert ›
    /// Chart), with PowerPoint 2013+'s look: title "Chart Title", legend
    /// at the bottom (none for a single series), value gridlines, gap
    /// width 219 % and overlap −27 % for clustered bars, vary-coloured
    /// pies, a 75 % doughnut hole.
    pub fn sample(kind: ChartKind) -> Self {
        let scatter = matches!(kind, ChartKind::Scatter { .. });
        let data = if scatter {
            ChartData::sample_scatter()
        } else {
            ChartData::sample()
        };
        let mut chart = Chart::new(kind.clone());
        chart.title = Some(if data.series.len() == 1 {
            ChartTitle::default()
        } else {
            ChartTitle::literal("Chart Title")
        });
        if data.series.len() > 1 || matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
            chart.legend = Some(Legend {
                position: LegendPosition::Bottom,
                overlay: false,
            });
        }
        match &kind {
            ChartKind::Bar { grouping, .. } if grouping.is_stacked() => {
                chart.gap_width = Some(150);
                chart.overlap = Some(100);
            }
            ChartKind::Bar { .. } => {
                chart.gap_width = Some(219);
                chart.overlap = Some(-27);
            }
            ChartKind::Pie => chart.vary_colors = true,
            ChartKind::Doughnut => {
                chart.vary_colors = true;
                chart.hole_size = Some(75);
            }
            _ => {}
        }
        let mut shape = ChartShape {
            chart,
            data,
            workbook: None,
        };
        shape.canonicalize();
        if matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
            // a pie shows its first series
            shape.data.series.truncate(1);
            shape.canonicalize();
            shape.chart.title = Some(ChartTitle::default());
        }
        shape
    }

    /// Makes the chart's series match the table: as many series as
    /// [`ChartData::series`] (extra ones get default formatting, removed
    /// ones lose theirs), references pointing at the embedded sheet's
    /// layout (names `B1`, `C1`, …; values below them; categories
    /// `A2:A<n+1>`), no reference caches (the table holds the data).
    pub fn canonicalize(&mut self) {
        self.data.normalize();
        if matches!(self.chart.kind, ChartKind::Unsupported { .. }) {
            return;
        }
        let n = self.data.categories.len();
        let last = n.max(1) + 1;
        let m = self.data.series.len();
        let template = self.chart.series.last().cloned();
        self.chart.series.truncate(m);
        while self.chart.series.len() < m {
            let mut s = Series::new(DataRef::reference(""));
            if let Some(t) = &template {
                // a combo chart's new series take the last one's kind and axis
                s.kind.clone_from(&t.kind);
                s.axis = t.axis;
            }
            self.chart.series.push(s);
        }
        for (i, s) in self.chart.series.iter_mut().enumerate() {
            let col = i + 1;
            if !matches!(s.name, Some(TextSource::Literal { .. })) {
                s.name = Some(TextSource::reference(sheet_ref(col, 1, 1)));
            }
            s.values = DataRef::reference(sheet_ref(col, 2, last));
            s.categories = None;
            s.data_points.retain(|p| (p.idx as usize) < n.max(1));
        }
        self.chart.categories = (n > 0).then(|| DataRef::reference(sheet_ref(0, 2, last)));
    }

    /// Replaces the data (Edit Data): the series follow the table, the
    /// file's embedded workbook is dropped (a new one is generated on
    /// save).
    pub fn set_data(&mut self, data: ChartData) {
        self.data = data;
        self.workbook = None;
        self.canonicalize();
    }

    /// The resolved data to draw.
    pub fn resolved(&self) -> ResolvedChart {
        self.data.resolve(&self.chart)
    }

    /// The table cell value at `(row, col)` of the embedded sheet (0-based;
    /// row 0 = names, col 0 = categories) as text or number.
    pub fn cell(&self, row: usize, col: usize) -> Option<SheetCell> {
        match (row, col) {
            (0, 0) => None,
            (0, c) => self
                .data
                .series
                .get(c - 1)
                .map(|s| SheetCell::Text(s.name.clone())),
            (r, 0) => self
                .data
                .categories
                .get(r - 1)
                .map(|c| match c.trim().parse::<f64>() {
                    Ok(v) if v.is_finite() => SheetCell::Number(v),
                    _ => SheetCell::Text(c.clone()),
                }),
            (r, c) => self
                .data
                .series
                .get(c - 1)
                .and_then(|s| s.values.get(r - 1).copied().flatten())
                .map(SheetCell::Number),
        }
    }
}

/// A cell of the embedded sheet ([`ChartShape::cell`]).
#[derive(Debug, Clone, PartialEq)]
pub enum SheetCell {
    Text(String),
    Number(f64),
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::chart::{BarDirection, Grouping};

    fn column() -> ChartKind {
        ChartKind::Bar {
            direction: BarDirection::Column,
            grouping: Grouping::Clustered,
        }
    }

    #[test]
    fn sample_is_powerpoints() {
        let s = ChartShape::sample(column());
        assert_eq!(s.chart.series.len(), 3);
        assert_eq!(
            s.data.categories,
            ["Category 1", "Category 2", "Category 3", "Category 4"]
        );
        assert_eq!(
            s.chart.series[0].name,
            Some(TextSource::reference("Sheet1!$B$1"))
        );
        assert_eq!(
            s.chart.series[2].values,
            DataRef::reference("Sheet1!$D$2:$D$5")
        );
        assert_eq!(
            s.chart.categories,
            Some(DataRef::reference("Sheet1!$A$2:$A$5"))
        );
        assert_eq!(s.chart.gap_width, Some(219));
        assert_eq!(s.chart.title, Some(ChartTitle::literal("Chart Title")));
        let r = s.resolved();
        assert_eq!(r.series[1].name, "Series 2");
        assert_eq!(r.series[1].values[1], Some(4.4));
        assert_eq!(r.title.as_deref(), Some("Chart Title"));
        assert!(r.series[0].x_values.is_none());

        let pie = ChartShape::sample(ChartKind::Pie);
        assert_eq!(pie.chart.series.len(), 1);
        assert!(pie.chart.vary_colors);
        assert_eq!(pie.resolved().title.as_deref(), Some("Series 1"));

        let sc = ChartShape::sample(ChartKind::Scatter {
            style: core_model::chart::ScatterStyle::Marker,
        });
        let r = sc.resolved();
        assert_eq!(r.series[0].x_values.as_ref().unwrap()[1], Some(1.8));
    }

    #[test]
    fn set_data_follows_the_table() {
        let mut s = ChartShape::sample(column());
        s.workbook = Some(MediaId(4));
        s.chart.series[0].fill = Some(core_model::chart::Fill::None);
        let mut d = s.data.clone();
        d.series.truncate(2);
        d.categories.push("Category 5".into());
        s.set_data(d.clone());
        assert_eq!(s.workbook, None);
        assert_eq!(s.chart.series.len(), 2);
        assert_eq!(s.chart.series[0].fill, Some(core_model::chart::Fill::None));
        assert_eq!(s.data.series[0].values.len(), 5);
        assert_eq!(
            s.chart.series[1].values,
            DataRef::reference("Sheet1!$C$2:$C$6")
        );
        d.series.push(ChartSeriesData {
            name: "New".into(),
            values: vec![Some(1.0)],
            format_code: None,
        });
        s.set_data(d);
        assert_eq!(s.chart.series.len(), 3);
        assert_eq!(s.data.series[2].values.len(), 5);
        assert_eq!(s.resolved().series[2].name, "New");
    }

    #[test]
    fn transpose_and_cells() {
        let d = ChartData::sample();
        let t = d.transposed();
        assert_eq!(t.categories, ["Series 1", "Series 2", "Series 3"]);
        assert_eq!(t.series.len(), 4);
        assert_eq!(t.series[1].name, "Category 2");
        assert_eq!(t.series[1].values, [Some(2.5), Some(4.4), Some(2.0)]);
        assert_eq!(t.transposed(), d);
        let s = ChartShape::sample(column());
        assert_eq!(s.cell(0, 0), None);
        assert_eq!(s.cell(0, 1), Some(SheetCell::Text("Series 1".into())));
        assert_eq!(s.cell(1, 0), Some(SheetCell::Text("Category 1".into())));
        assert_eq!(s.cell(2, 3), Some(SheetCell::Number(2.0)));
        assert_eq!(col_letters(0), "A");
        assert_eq!(col_letters(26), "AA");
    }

    #[test]
    fn validate_limits() {
        let mut d = ChartData::sample();
        assert!(d.validate().is_ok());
        d.series[0].values[0] = Some(f64::NAN);
        assert!(d.validate().is_err());
        let json = serde_json::to_string(&ChartData::sample()).unwrap();
        assert!(json.starts_with(r#"{"categories":["Category 1""#), "{json}");
    }
}
