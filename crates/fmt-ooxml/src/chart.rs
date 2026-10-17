//! DrawingML chart parts (`c:chartSpace`, ECMA-376 Part 1 §21.2) ↔
//! [`core_model::chart::Chart`]. Shared by `fmt-xlsx` (charts in
//! `xl/charts/`) and, later, `fmt-pptx`.
//!
//! [`read_chart`] maps the supported chart groups (`barChart`,
//! `lineChart`, `areaChart`, `pieChart`, `doughnutChart`,
//! `scatterChart`; several groups = a combo chart) and keeps any other
//! chart as [`ChartKind::Unsupported`] with its XML (written back
//! verbatim by [`write_chart`]). Elements outside the model are dropped
//! with one warning per chart, except purely cosmetic ones (text
//! properties, layouts, chart area fill, tick marks) and structural
//! elements the writer regenerates (axis ids, positions), which are
//! dropped silently. The exact list is in `docs/ooxml-subset.md`.
//!
//! [`write_chart`] regenerates the part. Reference caches (`c:numCache`,
//! `c:strCache`) come from a [`ChartData`] source (Calc resolves the
//! references against the workbook), else from the model's caches.

use std::collections::BTreeSet;

use core_model::chart::{
    AreaFill, Axes, Axis, AxisGroup, BarDirection, Chart, ChartKind, ChartTitle, ChartValue,
    Crosses, DataLabels, DataPoint, DataRef, DataTable, DisplayBlanks, ErrorAmount,
    ErrorBarDirection, ErrorBarType, ErrorBars, Fill, GradientStop, Grouping, LabelPosition,
    Legend, LegendPosition, LineDash, LineFormat, ManualLayout, Marker, MarkerSymbol, PointLabel,
    ScatterStyle, Series, ShapeFormat, TextFormat, TextSource, TickLabels, Trendline,
    TrendlineKind, UpDownBars,
};
use core_model::{apply_tint, Color, Rgb, ThemeColorSlot};
use quick_xml::events::Event;
use quick_xml::{Reader, Writer};

use crate::xml::{parse, parse_bool, parse_i64, El, XmlOut};
use crate::Result;

/// The chart namespace (`c:`).
pub const CHART_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
/// The DrawingML main namespace (`a:`).
pub const DRAWINGML_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
/// The relationships namespace (`r:`).
const REL_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// The chart groups the model supports.
const SUPPORTED_GROUPS: [&str; 6] = [
    "barChart",
    "lineChart",
    "areaChart",
    "pieChart",
    "doughnutChart",
    "scatterChart",
];

/// Every chart group element of `c:plotArea`.
const ALL_GROUPS: [&str; 16] = [
    "areaChart",
    "area3DChart",
    "lineChart",
    "line3DChart",
    "stockChart",
    "radarChart",
    "scatterChart",
    "pieChart",
    "pie3DChart",
    "doughnutChart",
    "barChart",
    "bar3DChart",
    "ofPieChart",
    "surfaceChart",
    "surface3DChart",
    "bubbleChart",
];

/// Elements dropped without a warning: cosmetic formatting the renderer
/// takes from the chart style, and structure the writer regenerates.
const SILENT: [&str; 31] = [
    "date1904",
    "lang",
    "roundedCorners",
    "AlternateContent",
    "style",
    "clrMapOvr",
    "printSettings",
    "extLst",
    "layout",
    "txPr",
    "spPr",
    "axId",
    "axPos",
    "crossAx",
    "majorTickMark",
    "minorTickMark",
    "lblAlgn",
    "lblOffset",
    "noMultiLvlLbl",
    "crossBetween",
    "auto",
    "idx",
    "order",
    "invertIfNegative",
    "showDLblsOverMax",
    "separator",
    "showBubbleSize",
    "showLeaderLines",
    "view3D",
    "shape",
    "leaderLines",
];

// --- reading ---------------------------------------------------------------------

struct Ctx {
    dropped: BTreeSet<String>,
    pictures: Vec<(PictureSlot, String)>,
}

impl Ctx {
    fn drop(&mut self, el: &El) {
        if !SILENT.contains(&el.name.as_str()) {
            self.dropped.insert(el.name.clone());
        }
    }
}

fn val<'a>(el: &'a El, name: &str) -> Option<&'a str> {
    el.child(name).and_then(El::val)
}

/// A `CT_Boolean` child: absent = `None`, present without `val` = true.
fn flag(el: &El, name: &str) -> Option<bool> {
    el.child(name)
        .map(|c| c.val().and_then(parse_bool).unwrap_or(true))
}

fn num(el: &El, name: &str) -> Option<f64> {
    val(el, name)
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite())
}

/// Reads a chart part. Returns the chart and warnings about dropped
/// content (without a part prefix).
pub fn read_chart(xml: &[u8], part: &str) -> Result<(Chart, Vec<String>)> {
    read_chart_inner(xml, part, false).map(|r| (r.chart, r.warnings))
}

/// A chart part as [`read_chart_ext`] returns it.
#[derive(Debug, Clone, PartialEq)]
pub struct ChartPart {
    pub chart: Chart,
    /// Warnings about dropped content (without a part prefix).
    pub warnings: Vec<String>,
    /// `c:externalData/@r:id`: the relationship of the embedded workbook
    /// (PowerPoint/Word charts), which the caller resolves.
    pub external_data: Option<String>,
    /// Picture fills (`a:blip/@r:embed`) of the chart area / plot area:
    /// the caller resolves the relationships and fills in the media
    /// ([`resolve_picture_fills`]); unresolved pictures are dropped.
    pub pictures: Vec<(PictureSlot, String)>,
}

/// Where a picture fill sits ([`ChartPart::pictures`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PictureSlot {
    ChartArea,
    PlotArea,
}

/// The picture fill of `slot` (if the chart has one).
pub fn picture_fill_mut(chart: &mut Chart, slot: PictureSlot) -> Option<&mut AreaFill> {
    let f = match slot {
        PictureSlot::ChartArea => chart.chart_area.as_mut()?.fill.as_mut()?,
        PictureSlot::PlotArea => chart.plot_area.as_mut()?.fill.as_mut()?,
    };
    matches!(f, AreaFill::Picture { .. }).then_some(f)
}

/// Fills in the picture fills of a read chart: `media(rid)` returns the
/// image of a relationship; pictures without one become no fill.
pub fn resolve_picture_fills(
    part: &mut ChartPart,
    mut media: impl FnMut(&str) -> Option<core_model::Media>,
) {
    for slot in [PictureSlot::ChartArea, PictureSlot::PlotArea] {
        let rid = part
            .pictures
            .iter()
            .find(|(s, _)| *s == slot)
            .map(|(_, r)| r.clone());
        let found = rid.as_deref().and_then(&mut media);
        if let Some(f) = picture_fill_mut(&mut part.chart, slot) {
            match (found, f) {
                (Some(m), AreaFill::Picture { media, .. }) => *media = m,
                (None, f) => *f = AreaFill::None,
                _ => {}
            }
        }
    }
}

/// Like [`read_chart`], with the picture fills' relationships
/// ([`ChartPart::pictures`]); `c:externalData` is dropped with a warning.
pub fn read_chart_part(xml: &[u8], part: &str) -> Result<ChartPart> {
    read_chart_inner(xml, part, false)
}

/// Like [`read_chart`], but `c:externalData` is not dropped: its
/// relationship id is returned (for pptx/docx charts with an embedded
/// workbook).
pub fn read_chart_ext(xml: &[u8], part: &str) -> Result<ChartPart> {
    read_chart_inner(xml, part, true)
}

fn read_chart_inner(xml: &[u8], part: &str, keep_external: bool) -> Result<ChartPart> {
    let root = parse(xml, part)?;
    let external_data = root
        .child("externalData")
        .filter(|_| keep_external)
        .and_then(|e| e.attr("id").map(str::to_owned));
    let mut ctx = Ctx {
        dropped: BTreeSet::new(),
        pictures: Vec::new(),
    };
    let mut warnings = Vec::new();
    let Some(chart_el) = root.child("chart") else {
        return Err(crate::Error::Malformed {
            part: part.to_owned(),
            reason: "chartSpace without chart".into(),
        });
    };
    let plot = chart_el.child("plotArea");
    let groups: Vec<&El> = plot
        .map(|p| {
            p.elements()
                .filter(|e| ALL_GROUPS.contains(&e.name.as_str()))
                .collect()
        })
        .unwrap_or_default();
    if let Some(bad) = groups
        .iter()
        .find(|g| !SUPPORTED_GROUPS.contains(&g.name.as_str()))
    {
        warnings.push(format!(
            "{} chart is not supported; kept unchanged (read-only)",
            bad.name
        ));
        let (xml, stripped) = strip_rel_elements(xml);
        if stripped {
            warnings.push("chart user shapes / external data dropped".into());
        }
        let chart = Chart::new(ChartKind::Unsupported {
            kind: bad.name.clone(),
            xml: String::from_utf8_lossy(&xml).into_owned(),
        });
        return Ok(ChartPart {
            chart,
            warnings,
            external_data: None,
            pictures: Vec::new(),
        });
    }

    let mut chart = Chart::new(ChartKind::column());
    // Chart space level.
    for el in root.elements() {
        match el.name.as_str() {
            "chart" => {}
            "style" => {
                if let Some(s) = el.val().and_then(|v| v.parse::<u8>().ok()) {
                    chart.style = s;
                }
            }
            "AlternateContent" if root.child("style").is_none() => {
                if let Some(s) = alternate_style(el) {
                    chart.style = s;
                }
            }
            "externalData" if keep_external => {}
            "externalData" | "userShapes" => {
                warnings.push("chart user shapes / external data dropped".into())
            }
            "roundedCorners" => chart.rounded_corners = el.val().and_then(parse_bool) == Some(true),
            "spPr" => {
                let shape = read_shape(el, PictureSlot::ChartArea, &mut ctx);
                // PowerPoint's transparent chart area is Show's default.
                let transparent = ShapeFormat {
                    fill: Some(AreaFill::None),
                    line: Some(LineFormat::hidden()),
                    shadow: false,
                };
                if !(shape.is_empty() || keep_external && shape == transparent) {
                    chart.chart_area = Some(shape);
                }
            }
            "txPr" => chart.text_format = read_text_format(el),
            _ => ctx.drop(el),
        }
    }
    if !(1..=48).contains(&chart.style) {
        chart.style = 2;
    }

    // Groups and series.
    let mut primary_ids: Option<(String, String)> = None;
    let mut secondary_val_id: Option<String> = None;
    let mut kinds: Vec<ChartKind> = Vec::new();
    for (gi, g) in groups.iter().enumerate() {
        let ids: Vec<String> = g
            .elements()
            .filter(|e| e.name == "axId")
            .filter_map(|e| e.val().map(str::to_owned))
            .collect();
        let axis = match (&primary_ids, ids.as_slice()) {
            (None, [a, b, ..]) => {
                primary_ids = Some((a.clone(), b.clone()));
                AxisGroup::Primary
            }
            (Some((_, pv)), [_, b, ..]) if b != pv => {
                secondary_val_id.get_or_insert_with(|| b.clone());
                AxisGroup::Secondary
            }
            _ => AxisGroup::Primary,
        };
        let kind = read_group(g, gi == 0, &mut chart, &mut ctx);
        let group_labels = g.child("dLbls").map(|d| read_labels(d, &mut ctx));
        let mut sers: Vec<(u32, Series)> = g
            .elements()
            .filter(|e| e.name == "ser")
            .map(|s| {
                let order = val(s, "order")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(u32::MAX);
                (order, read_series(s, &kind, &mut ctx))
            })
            .collect();
        sers.sort_by_key(|(o, _)| *o);
        let mut sers: Vec<Series> = sers.into_iter().map(|(_, s)| s).collect();
        let kind = settle_markers(kind, &mut sers);
        for s in &mut sers {
            s.axis = axis;
            if gi > 0 {
                if let Some(l) = group_labels.as_ref().filter(|l| **l != chart.data_labels) {
                    s.data_labels.get_or_insert_with(|| l.clone());
                }
            }
        }
        if gi == 0 {
            if let Some(l) = group_labels {
                chart.data_labels = l;
            }
        }
        for s in sers {
            kinds.push(kind.clone());
            chart.series.push(s);
        }
        if gi == 0 {
            chart.kind = kind;
        }
    }
    if groups.is_empty() {
        warnings.push("chart without a plot area or chart group".into());
    }
    if groups.len() > 1 {
        chart.kind = ChartKind::Combo;
        for (s, k) in chart.series.iter_mut().zip(kinds) {
            s.kind = Some(k);
        }
    }
    // Shared categories: every series has the same reference.
    let first = chart.series.first().and_then(|s| s.categories.clone());
    if first.as_ref().and_then(DataRef::formula).is_some()
        && chart.series.iter().all(|s| s.categories == first)
    {
        chart.categories = first;
        for s in &mut chart.series {
            s.categories = None;
        }
    }

    // Axes.
    if let Some(p) = plot {
        let axes: Vec<&El> = p
            .elements()
            .filter(|e| matches!(e.name.as_str(), "catAx" | "valAx" | "dateAx" | "serAx"))
            .collect();
        let by_id = |id: &str| axes.iter().find(|a| val(a, "axId") == Some(id)).copied();
        let mut a = Axes::default();
        if let Some((c, v)) = &primary_ids {
            if let Some(el) = by_id(c) {
                a.cat = read_axis(el, &mut ctx);
            }
            if let Some(el) = by_id(v) {
                a.val = read_axis(el, &mut ctx);
            }
        }
        if let Some(el) = secondary_val_id.as_deref().and_then(by_id) {
            a.second_val = Some(read_axis(el, &mut ctx));
        }
        if axes.iter().any(|e| e.name == "serAx") {
            ctx.dropped.insert("serAx".into());
        }
        chart.axes = a;
        for el in p.elements() {
            let n = el.name.as_str();
            match n {
                "layout" => chart.plot_layout = read_layout(el),
                "spPr" => {
                    let shape = read_shape(el, PictureSlot::PlotArea, &mut ctx);
                    if !shape.is_empty() {
                        chart.plot_area = Some(shape);
                    }
                }
                "dTable" => chart.data_table = Some(read_data_table(el)),
                _ if ALL_GROUPS.contains(&n)
                    || matches!(n, "catAx" | "valAx" | "dateAx" | "serAx") => {}
                _ => ctx.drop(el),
            }
        }
    }

    // Chart level.
    let mut auto_deleted = false;
    for el in chart_el.elements() {
        match el.name.as_str() {
            "plotArea" => {}
            "title" => chart.title = Some(read_title(el, &mut ctx)),
            "autoTitleDeleted" => auto_deleted = el.val().and_then(parse_bool).unwrap_or(true),
            "legend" => chart.legend = Some(read_legend(el, &mut chart, &mut ctx)),
            "plotVisOnly" => {
                chart.plot_visible_only = el.val().and_then(parse_bool).unwrap_or(true)
            }
            "dispBlanksAs" => {
                chart.display_blanks_as = match el.val() {
                    Some("zero") => DisplayBlanks::Zero,
                    Some("span") => DisplayBlanks::Span,
                    _ => DisplayBlanks::Gap,
                }
            }
            "floor" | "sideWall" | "backWall" => {}
            _ => ctx.drop(el),
        }
    }
    // Excel shows the only series' name when the title is not deleted.
    if chart.title.is_none() && !auto_deleted && chart.series.len() == 1 {
        chart.title = Some(ChartTitle::default());
    }
    if !ctx.dropped.is_empty() {
        let names: Vec<&str> = ctx.dropped.iter().map(String::as_str).collect();
        warnings.push(format!("chart elements dropped: {}", names.join(", ")));
    }
    Ok(ChartPart {
        chart,
        warnings,
        external_data,
        pictures: ctx.pictures,
    })
}

/// `mc:AlternateContent` around the chart style: `c:style` in the
/// fallback, or `c14:style` (100 + n) in the choice.
fn alternate_style(el: &El) -> Option<u8> {
    if let Some(s) = el
        .child("Fallback")
        .and_then(|f| f.child("style"))
        .and_then(El::val)
        .and_then(|v| v.parse::<u8>().ok())
    {
        return Some(s);
    }
    el.child("Choice")
        .and_then(|c| c.child("style"))
        .and_then(El::val)
        .and_then(|v| v.parse::<u16>().ok())
        .map(|v| if v > 100 { v - 100 } else { v })
        .and_then(|v| u8::try_from(v).ok())
}

/// The kind of a chart group; group-level settings go into `chart` when
/// `first`.
fn read_group(g: &El, first: bool, chart: &mut Chart, ctx: &mut Ctx) -> ChartKind {
    let grouping = |default: Grouping| match val(g, "grouping") {
        Some("clustered") => Grouping::Clustered,
        Some("stacked") => Grouping::Stacked,
        Some("percentStacked") => Grouping::PercentStacked,
        Some("standard") => Grouping::Standard,
        _ => default,
    };
    let kind = match g.name.as_str() {
        "barChart" => {
            let mut grouping = grouping(Grouping::Clustered);
            if grouping == Grouping::Standard {
                grouping = Grouping::Clustered;
            }
            if first {
                chart.gap_width = num(g, "gapWidth").map(|v| v.clamp(0.0, 500.0) as u16);
                chart.overlap = num(g, "overlap").map(|v| v.clamp(-100.0, 100.0) as i8);
            }
            ChartKind::Bar {
                direction: if val(g, "barDir") == Some("bar") {
                    BarDirection::Bar
                } else {
                    BarDirection::Column
                },
                grouping,
            }
        }
        "lineChart" => {
            let mut grouping = grouping(Grouping::Standard);
            if grouping == Grouping::Clustered {
                grouping = Grouping::Standard;
            }
            ChartKind::Line {
                grouping,
                markers: flag(g, "marker").unwrap_or(true),
            }
        }
        "areaChart" => {
            let mut grouping = grouping(Grouping::Standard);
            if grouping == Grouping::Clustered {
                grouping = Grouping::Standard;
            }
            ChartKind::Area { grouping }
        }
        "pieChart" => ChartKind::Pie,
        "doughnutChart" => {
            if first {
                // `None` means 50 %, which the writer spells out.
                chart.hole_size = num(g, "holeSize")
                    .map(|v| v.clamp(10.0, 90.0) as u8)
                    .filter(|v| *v != 50);
            }
            ChartKind::Doughnut
        }
        _ => ChartKind::Scatter {
            style: match val(g, "scatterStyle") {
                Some("marker") => ScatterStyle::Marker,
                Some("line") => ScatterStyle::Line,
                Some("smooth") => ScatterStyle::Smooth,
                Some("smoothMarker") => ScatterStyle::SmoothMarker,
                _ => ScatterStyle::LineMarker,
            },
        },
    };
    if first {
        chart.vary_colors = flag(g, "varyColors").unwrap_or(false);
        if matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
            chart.first_slice_angle =
                num(g, "firstSliceAng").map(|v| v.clamp(0.0, 360.0) as u16 % 360);
        }
    }
    for el in g.elements() {
        match el.name.as_str() {
            "barDir" | "grouping" | "varyColors" | "ser" | "dLbls" | "gapWidth" | "overlap"
            | "marker" | "holeSize" | "firstSliceAng" | "scatterStyle" | "smooth" => {}
            // Invisible lines (LibreOffice writes them).
            "hiLowLines" | "dropLines" | "serLines"
                if el
                    .child("spPr")
                    .and_then(|s| read_sp(s).1)
                    .is_some_and(|l| l.none) => {}
            "hiLowLines" if g.name == "lineChart" && first => {
                chart.high_low_lines = Some(
                    el.child("spPr")
                        .and_then(|s| read_sp(s).1)
                        .unwrap_or_default(),
                );
            }
            "upDownBars" if g.name == "lineChart" && first => {
                let bars = |name: &str, ctx: &mut Ctx| {
                    el.child(name)
                        .and_then(|b| b.child("spPr"))
                        .map(|sp| read_shape(sp, PictureSlot::PlotArea, ctx))
                        .filter(|s| !s.is_empty())
                };
                chart.up_down_bars = Some(UpDownBars {
                    gap_width: num(el, "gapWidth").map(|v| v.clamp(0.0, 500.0) as u16),
                    up: bars("upBars", ctx),
                    down: bars("downBars", ctx),
                });
            }
            _ => ctx.drop(el),
        }
    }
    kind
}

/// Line and scatter charts: folds the per-series "no marker" / "no line"
/// / smooth settings into the chart kind (as Excel's chart types do) and
/// removes them from the series.
fn settle_markers(kind: ChartKind, sers: &mut [Series]) -> ChartKind {
    let plain_none = |m: &Option<Marker>| matches!(m, Some(m) if m.symbol == MarkerSymbol::None && m.size.is_none() && m.fill.is_none() && m.line.is_none());
    let no_markers = !sers.is_empty() && sers.iter().all(|s| plain_none(&s.marker));
    match kind {
        ChartKind::Line { grouping, markers } => {
            let markers = markers && !no_markers;
            if !markers {
                for s in sers.iter_mut().filter(|s| plain_none(&s.marker)) {
                    s.marker = None;
                }
            }
            ChartKind::Line { grouping, markers }
        }
        ChartKind::Scatter { style } => {
            let hidden = |s: &Series| s.line == Some(LineFormat::hidden());
            let no_lines = !sers.is_empty() && sers.iter().all(hidden);
            let lines = style.has_lines() && !no_lines;
            let markers =
                !no_markers && !matches!(style, ScatterStyle::Line | ScatterStyle::Smooth);
            let smooth = if sers.is_empty() {
                style.is_smooth()
            } else {
                sers.iter().all(|s| s.smooth.unwrap_or(style.is_smooth()))
            };
            let style = ScatterStyle::from_parts(lines, markers || !lines, smooth);
            for s in sers.iter_mut() {
                if !style.has_lines() && hidden(s) {
                    s.line = None;
                }
                if !style.has_markers() && plain_none(&s.marker) {
                    s.marker = None;
                }
                if s.smooth == Some(style.is_smooth()) || !style.has_lines() {
                    s.smooth = None;
                }
            }
            ChartKind::Scatter { style }
        }
        k => {
            for s in sers.iter_mut() {
                s.smooth = None;
            }
            k
        }
    }
}

fn read_series(s: &El, kind: &ChartKind, ctx: &mut Ctx) -> Series {
    let scatter = matches!(kind, ChartKind::Scatter { .. });
    let values = s
        .child(if scatter { "yVal" } else { "val" })
        .and_then(|v| read_data(v, ctx))
        .unwrap_or(DataRef::Literal { values: Vec::new() });
    let mut out = Series::new(values);
    out.categories = s
        .child(if scatter { "xVal" } else { "cat" })
        .and_then(|v| read_data(v, ctx));
    out.name = s.child("tx").and_then(read_series_text);
    if let Some(sp) = s.child("spPr") {
        let (fill, line) = read_sp(sp);
        out.fill = fill;
        out.line = line;
    }
    out.marker = s.child("marker").map(read_marker);
    out.data_labels = s.child("dLbls").map(|d| read_labels(d, ctx));
    out.smooth = flag(s, "smooth").filter(|&v| v || scatter);
    for el in s.elements() {
        match el.name.as_str() {
            "dPt" => {
                let Some(idx) = val(el, "idx").and_then(|v| v.parse().ok()) else {
                    continue;
                };
                let (fill, line) = el.child("spPr").map(read_sp).unwrap_or_default();
                out.data_points.push(DataPoint {
                    idx,
                    fill,
                    line,
                    marker: el.child("marker").map(read_marker),
                });
                for c in el.elements() {
                    let zero = c.name == "explosion" && c.val().and_then(parse_i64) == Some(0);
                    if !zero && !matches!(c.name.as_str(), "idx" | "spPr" | "marker" | "bubble3D") {
                        ctx.drop(c);
                    }
                }
            }
            "trendline" => {
                if out.trendline.is_some() {
                    ctx.dropped.insert("trendline".into());
                } else {
                    out.trendline = read_trendline(el, ctx);
                }
            }
            "errBars" => match read_err_bars(el, ctx) {
                Some(e) if out.error_bars.len() < 2 => out.error_bars.push(e),
                _ => {
                    ctx.dropped.insert("errBars".into());
                }
            },
            "extLst" => {
                // Office 2013 "Value From Cells" label range.
                if let Some(r) = el.find("datalabelsRange") {
                    if let Some(f) = r.child("f").map(|f| f.text().trim().to_owned()) {
                        let cache = r.child("dlblRangeCache").map(|c| cache_values(c, false));
                        out.data_labels
                            .get_or_insert_with(DataLabels::default)
                            .range = Some(DataRef::Ref { formula: f, cache });
                    }
                }
            }
            "tx" | "spPr" | "marker" | "dLbls" | "smooth" | "val" | "cat" | "xVal" | "yVal" => {}
            "explosion" if el.val().and_then(parse_i64) == Some(0) => {}
            _ => ctx.drop(el),
        }
    }
    out
}

fn read_err_bars(el: &El, ctx: &mut Ctx) -> Option<ErrorBars> {
    let data = |name: &str, ctx: &mut Ctx| el.child(name).and_then(|d| read_data(d, ctx));
    let value = num(el, "val").unwrap_or(1.0);
    let amount = match val(el, "errValType")? {
        "fixedVal" => ErrorAmount::Fixed { value },
        "percentage" => ErrorAmount::Percentage { value },
        "stdDev" => ErrorAmount::StdDev { value },
        "stdErr" => ErrorAmount::StdErr,
        "cust" => ErrorAmount::Custom {
            plus: data("plus", ctx),
            minus: data("minus", ctx),
        },
        _ => return None,
    };
    Some(ErrorBars {
        direction: if val(el, "errDir") == Some("x") {
            ErrorBarDirection::X
        } else {
            ErrorBarDirection::Y
        },
        bar_type: match val(el, "errBarType") {
            Some("plus") => ErrorBarType::Plus,
            Some("minus") => ErrorBarType::Minus,
            _ => ErrorBarType::Both,
        },
        amount,
        no_end_cap: flag(el, "noEndCap").unwrap_or(false),
        line: el.child("spPr").and_then(|sp| read_sp(sp).1),
    })
}

/// `c:tx` of a series: a cell reference or a literal `c:v`.
fn read_series_text(tx: &El) -> Option<TextSource> {
    if let Some(r) = tx.child("strRef") {
        let formula = r.child("f")?.text().trim().to_owned();
        let cache = r.child("strCache").map(|c| {
            points(c)
                .into_iter()
                .map(|(_, v)| v)
                .collect::<Vec<_>>()
                .join(" ")
        });
        return Some(TextSource::Ref { formula, cache });
    }
    if let Some(v) = tx.child("v") {
        return Some(TextSource::literal(v.text()));
    }
    tx.child("rich").map(|r| TextSource::literal(rich_text(r)))
}

/// `(idx, text)` of the `c:pt` children of a cache or literal.
fn points(cache: &El) -> Vec<(usize, String)> {
    cache
        .elements()
        .filter(|e| e.name == "pt")
        .filter_map(|p| {
            let idx = p.attr("idx")?.parse().ok()?;
            Some((idx, p.child("v").map(El::text).unwrap_or_default()))
        })
        .collect()
}

/// A cache or literal as values (`ptCount` slots, blanks where no `pt`).
fn cache_values(cache: &El, numeric: bool) -> Vec<ChartValue> {
    let pts = points(cache);
    let count = val(cache, "ptCount")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0)
        .max(pts.iter().map(|(i, _)| i + 1).max().unwrap_or(0))
        .min(1 << 20);
    let mut out = vec![ChartValue::Blank; count];
    for (i, text) in pts {
        if i < count {
            out[i] = match text.trim().parse::<f64>() {
                Ok(n) if numeric && n.is_finite() => ChartValue::Number(n),
                _ => ChartValue::Text(text),
            };
        }
    }
    out
}

/// `c:cat` / `c:val` / `c:xVal` / `c:yVal`.
fn read_data(el: &El, ctx: &mut Ctx) -> Option<DataRef> {
    for c in el.elements() {
        match c.name.as_str() {
            "numRef" | "strRef" | "multiLvlStrRef" => {
                if c.name == "multiLvlStrRef" {
                    ctx.dropped.insert("multi-level categories".into());
                }
                let formula = c.child("f")?.text().trim().to_owned();
                let cache = c
                    .elements()
                    .find(|e| matches!(e.name.as_str(), "numCache" | "strCache"))
                    .map(|k| cache_values(k, k.name == "numCache"));
                return Some(DataRef::Ref { formula, cache });
            }
            "numLit" | "strLit" => {
                return Some(DataRef::Literal {
                    values: cache_values(c, c.name == "numLit"),
                })
            }
            _ => {}
        }
    }
    None
}

fn rich_text(rich: &El) -> String {
    rich.elements()
        .filter(|p| p.name == "p")
        .map(|p| {
            let mut s = String::new();
            for r in p.elements() {
                match r.name.as_str() {
                    "r" | "fld" => {
                        if let Some(t) = r.child("t") {
                            s.push_str(&t.text());
                        }
                    }
                    "br" => s.push('\n'),
                    _ => {}
                }
            }
            s
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_title(el: &El, ctx: &mut Ctx) -> ChartTitle {
    let rich = el.child("tx").and_then(|tx| tx.child("rich"));
    let text = el.child("tx").and_then(|tx| {
        if let Some(r) = tx.child("rich") {
            Some(TextSource::literal(rich_text(r)))
        } else {
            read_series_text(tx)
        }
    });
    for c in el.elements() {
        if !matches!(c.name.as_str(), "tx" | "overlay" | "layout" | "txPr") {
            ctx.drop(c);
        }
    }
    ChartTitle {
        text,
        overlay: flag(el, "overlay").unwrap_or(false),
        text_format: rich
            .and_then(read_text_format)
            .or_else(|| el.child("txPr").and_then(read_text_format)),
        layout: el.child("layout").and_then(read_layout),
    }
}

/// `c:layout/c:manualLayout` in `edge` mode (factor mode = automatic).
fn read_layout(el: &El) -> Option<ManualLayout> {
    let m = el.child("manualLayout")?;
    let edge = |name: &str| val(m, name).map_or(true, |v| v == "edge");
    // Excel's default x/y mode is `factor` (an offset from the automatic
    // place), which the model does not keep.
    if val(m, "xMode") != Some("edge") || val(m, "yMode") != Some("edge") {
        return None;
    }
    let f = |name: &str| num(m, name).map(|v| v.clamp(0.0, 1.0));
    Some(ManualLayout {
        x: f("x")?,
        y: f("y")?,
        w: f("w").filter(|_| edge("wMode")),
        h: f("h").filter(|_| edge("hMode")),
    })
}

/// Text properties of `c:txPr` or `c:rich`: `a:bodyPr/@rot`, the first
/// paragraph's `a:defRPr` and (rich text) its first run's `a:rPr`.
fn read_text_format(el: &El) -> Option<TextFormat> {
    let mut tf = TextFormat::default();
    if let Some(rot) = el
        .child("bodyPr")
        .and_then(|b| b.attr("rot"))
        .and_then(parse_i64)
    {
        // Excel's `-60000000` means "automatic".
        if rot != 0 && rot.abs() <= 5_400_000 {
            tf.rotation = Some(((rot as f64) / 60_000.0).round() as i32);
        }
    }
    if let Some(p) = el.child("p") {
        if let Some(d) = p.child("pPr").and_then(|pp| pp.child("defRPr")) {
            read_rpr(d, &mut tf);
        }
        if let Some(r) = p.child("r").and_then(|r| r.child("rPr")) {
            read_rpr(r, &mut tf);
        }
    }
    (!tf.is_empty()).then_some(tf)
}

fn read_rpr(el: &El, tf: &mut TextFormat) {
    if let Some(sz) = el.attr("sz").and_then(parse_i64).filter(|v| *v > 0) {
        tf.size = Some(sz as f64 / 100.0);
    }
    if let Some(b) = el.attr("b").and_then(parse_bool) {
        tf.bold = Some(b);
    }
    if let Some(i) = el.attr("i").and_then(parse_bool) {
        tf.italic = Some(i);
    }
    if let Some(c) = el.child("solidFill").and_then(read_color) {
        tf.color = Some(c);
    }
    if let Some(f) = el
        .child("latin")
        .and_then(|l| l.attr("typeface"))
        .filter(|f| !f.is_empty() && !f.starts_with('+'))
    {
        tf.font = Some(f.to_owned());
    }
}

/// `c:spPr` of an area: fill (also gradients and pictures), outline and
/// the outer shadow.
fn read_shape(sp: &El, slot: PictureSlot, ctx: &mut Ctx) -> ShapeFormat {
    ShapeFormat {
        fill: read_area_fill(sp, slot, ctx),
        line: read_sp(sp).1,
        shadow: sp
            .child("effectLst")
            .is_some_and(|e| e.child("outerShdw").is_some()),
    }
}

fn read_area_fill(parent: &El, slot: PictureSlot, ctx: &mut Ctx) -> Option<AreaFill> {
    for c in parent.elements() {
        match c.name.as_str() {
            "noFill" => return Some(AreaFill::None),
            "solidFill" => return read_color(c).map(|color| AreaFill::Solid { color }),
            "gradFill" => {
                let mut stops: Vec<GradientStop> = c
                    .child("gsLst")
                    .map(|l| {
                        l.elements()
                            .filter(|g| g.name == "gs")
                            .filter_map(|g| {
                                Some(GradientStop {
                                    pos: g.attr("pos").and_then(parse_i64).unwrap_or(0) as f64
                                        / 100_000.0,
                                    color: read_color(g)?,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                stops.sort_by(|a, b| a.pos.total_cmp(&b.pos));
                if stops.is_empty() {
                    return None;
                }
                let angle = c
                    .child("lin")
                    .and_then(|l| l.attr("ang"))
                    .and_then(parse_i64)
                    .map_or(0.0, |a| (a as f64 / 60_000.0) % 360.0);
                return Some(AreaFill::Gradient {
                    stops,
                    angle,
                    radial: c.child("path").is_some(),
                });
            }
            "pattFill" => {
                return c
                    .child("fgClr")
                    .and_then(read_color)
                    .map(|color| AreaFill::Solid { color })
            }
            "blipFill" => {
                let rid = c.child("blip").and_then(|b| b.attr("embed"))?;
                ctx.pictures.push((slot, rid.to_owned()));
                return Some(AreaFill::Picture {
                    media: core_model::Media {
                        content_type: String::new(),
                        data: Vec::new(),
                    },
                    tile: c.child("tile").is_some(),
                });
            }
            _ => {}
        }
    }
    None
}

fn read_data_table(el: &El) -> DataTable {
    let f = |name: &str| flag(el, name).unwrap_or(false);
    DataTable {
        horizontal: f("showHorzBorder"),
        vertical: f("showVertBorder"),
        outline: f("showOutline"),
        keys: f("showKeys"),
        text_format: el.child("txPr").and_then(read_text_format),
    }
}

fn read_legend(el: &El, chart: &mut Chart, ctx: &mut Ctx) -> Legend {
    for c in el.elements() {
        if !matches!(c.name.as_str(), "legendPos" | "overlay" | "layout" | "txPr") {
            ctx.drop(c);
        }
    }
    chart.legend_text_format = el.child("txPr").and_then(read_text_format);
    chart.legend_layout = el.child("layout").and_then(read_layout);
    Legend {
        position: val(el, "legendPos")
            .and_then(LegendPosition::from_ooxml_name)
            .unwrap_or(LegendPosition::Right),
        overlay: flag(el, "overlay").unwrap_or(false),
    }
}

/// `c15:showDataLabelsRange` in the `c:extLst` of a `c:dLbls`/`c:dLbl`.
fn shows_range(el: &El) -> bool {
    el.child("extLst")
        .and_then(|x| x.find("showDataLabelsRange"))
        .is_some_and(|r| r.val().and_then(parse_bool).unwrap_or(true))
}

fn label_number_format(el: &El) -> Option<String> {
    el.child("numFmt")
        .filter(|n| n.attr("sourceLinked").and_then(parse_bool) != Some(true))
        .and_then(|n| n.attr("formatCode"))
        .map(str::to_owned)
}

fn read_labels(el: &El, ctx: &mut Ctx) -> DataLabels {
    let mut points = Vec::new();
    for c in el.elements() {
        match c.name.as_str() {
            "numFmt" | "dLblPos" | "showLegendKey" | "showVal" | "showCatName" | "showSerName"
            | "showPercent" | "delete" | "txPr" | "showLeaderLines" | "extLst" => {}
            "dLbl" => {
                let Some(idx) = val(c, "idx").and_then(|v| v.parse().ok()) else {
                    continue;
                };
                let f = |name| flag(c, name).unwrap_or(false);
                points.push(PointLabel {
                    idx,
                    delete: f("delete"),
                    show_value: f("showVal"),
                    show_percent: f("showPercent"),
                    show_category: f("showCatName"),
                    show_series: f("showSerName"),
                    show_range: shows_range(c),
                    position: val(c, "dLblPos").and_then(LabelPosition::from_ooxml_name),
                    number_format: label_number_format(c),
                    text_format: c.child("txPr").and_then(read_text_format),
                    layout: c.child("layout").and_then(read_layout),
                });
                for x in c.elements() {
                    if x.name == "tx" {
                        ctx.dropped.insert("custom data label text".into());
                    }
                }
            }
            _ => ctx.drop(c),
        }
    }
    if flag(el, "delete") == Some(true) {
        return DataLabels {
            points,
            ..DataLabels::default()
        };
    }
    let f = |name| flag(el, name).unwrap_or(false);
    DataLabels {
        show_value: f("showVal"),
        show_percent: f("showPercent"),
        show_category: f("showCatName"),
        show_series: f("showSerName"),
        show_legend_key: f("showLegendKey"),
        position: val(el, "dLblPos").and_then(LabelPosition::from_ooxml_name),
        number_format: label_number_format(el),
        range: None,
        show_range: shows_range(el),
        leader_lines: f("showLeaderLines"),
        text_format: el.child("txPr").and_then(read_text_format),
        points,
    }
}

fn read_axis(el: &El, ctx: &mut Ctx) -> Axis {
    let scaling = el.child("scaling");
    let sc = |name| scaling.and_then(|s| num(s, name));
    let crosses = if let Some(v) = num(el, "crossesAt") {
        Crosses::At { value: v }
    } else {
        match val(el, "crosses") {
            Some("min") => Crosses::Min,
            Some("max") => Crosses::Max,
            _ => Crosses::AutoZero,
        }
    };
    for c in el.elements() {
        match c.name.as_str() {
            "scaling" | "delete" | "majorGridlines" | "minorGridlines" | "title" | "numFmt"
            | "tickLblPos" | "crosses" | "crossesAt" | "majorUnit" | "minorUnit" | "txPr"
            | "spPr" => {}
            // Date axes are read as category axes.
            "baseTimeUnit" | "majorTimeUnit" | "minorTimeUnit" | "tickLblSkip" | "tickMarkSkip" => {
            }
            _ => ctx.drop(c),
        }
    }
    let vertical = matches!(val(el, "axPos"), Some("l" | "r"));
    let title = el.child("title").map(|t| {
        let mut t = read_title(t, ctx);
        // The writer's (and Excel's) default for vertical axes.
        if let Some(tf) = t.text_format.as_mut().filter(|_| vertical) {
            if tf.rotation == Some(-90) {
                tf.rotation = None;
            }
            if tf.is_empty() {
                t.text_format = None;
            }
        }
        t
    });
    Axis {
        title,
        min: sc("min"),
        max: sc("max"),
        major_unit: num(el, "majorUnit"),
        minor_unit: num(el, "minorUnit"),
        number_format: el
            .child("numFmt")
            .filter(|n| n.attr("sourceLinked").and_then(parse_bool) != Some(true))
            .and_then(|n| n.attr("formatCode"))
            .map(str::to_owned),
        log_base: sc("logBase"),
        reverse: scaling.and_then(|s| val(s, "orientation")) == Some("maxMin"),
        crosses,
        major_gridlines: el.child("majorGridlines").is_some(),
        minor_gridlines: el.child("minorGridlines").is_some(),
        tick_labels: match val(el, "tickLblPos") {
            Some("high") => TickLabels::High,
            Some("low") => TickLabels::Low,
            Some("none") => TickLabels::None,
            _ => TickLabels::NextTo,
        },
        delete: flag(el, "delete").unwrap_or(false),
        text_format: el.child("txPr").and_then(read_text_format),
        line: el.child("spPr").and_then(|sp| read_sp(sp).1),
    }
}

fn read_marker(el: &El) -> Marker {
    let (fill, line) = el.child("spPr").map(read_sp).unwrap_or_default();
    Marker {
        symbol: val(el, "symbol")
            .and_then(MarkerSymbol::from_name)
            .unwrap_or(MarkerSymbol::Auto),
        size: num(el, "size").map(|v| v.clamp(2.0, 72.0) as u8),
        fill,
        line,
    }
}

fn read_trendline(el: &El, ctx: &mut Ctx) -> Option<Trendline> {
    let kind = match val(el, "trendlineType")? {
        "linear" => TrendlineKind::Linear,
        "exp" => TrendlineKind::Exponential,
        "log" => TrendlineKind::Logarithmic,
        "power" => TrendlineKind::Power,
        "poly" => TrendlineKind::Polynomial {
            order: num(el, "order").map_or(2, |v| v.clamp(2.0, 6.0) as u8),
        },
        "movingAvg" => TrendlineKind::MovingAverage {
            period: num(el, "period").map_or(2, |v| v.clamp(2.0, 255.0) as u32),
        },
        _ => return None,
    };
    for c in el.elements() {
        if !matches!(
            c.name.as_str(),
            "name" | "spPr" | "trendlineType" | "order" | "period" | "dispRSqr" | "dispEq"
        ) {
            ctx.drop(c);
        }
    }
    Some(Trendline {
        kind,
        name: el.child("name").map(El::text),
        display_equation: flag(el, "dispEq").unwrap_or(false),
        display_r_squared: flag(el, "dispRSqr").unwrap_or(false),
        line: el.child("spPr").and_then(|sp| read_sp(sp).1),
    })
}

/// `c:spPr` → (fill, line). Gradients and patterns are read as a solid
/// fill with their first color.
fn read_sp(sp: &El) -> (Option<Fill>, Option<LineFormat>) {
    let fill = read_fill(sp);
    let line = sp.child("ln").map(|ln| {
        let mut l = LineFormat {
            width: ln.attr("w").and_then(parse_i64).filter(|w| *w >= 0),
            dash: val(ln, "prstDash").and_then(LineDash::from_name),
            ..LineFormat::default()
        };
        match read_fill(ln) {
            Some(Fill::None) => l.none = true,
            Some(Fill::Solid { color }) => l.color = Some(color),
            None => {}
        }
        l
    });
    (fill, line)
}

fn read_fill(parent: &El) -> Option<Fill> {
    for c in parent.elements() {
        match c.name.as_str() {
            "noFill" => return Some(Fill::None),
            "solidFill" => {
                return read_color(c).map(|color| Fill::Solid { color });
            }
            "gradFill" => {
                return c
                    .find("gs")
                    .and_then(read_color)
                    .map(|color| Fill::Solid { color })
            }
            "pattFill" => {
                return c
                    .child("fgClr")
                    .and_then(read_color)
                    .map(|color| Fill::Solid { color })
            }
            _ => {}
        }
    }
    None
}

/// The first DrawingML color child of `parent`.
pub fn read_color(parent: &El) -> Option<Color> {
    parent.elements().find_map(color_of)
}

/// A DrawingML color element (`a:srgbClr`, `a:schemeClr`, `a:sysClr`,
/// `a:prstClr`) with `lumMod`/`lumOff`/`shade`/`tint` modifiers mapped to
/// a tint (exact for `lumMod`/`lumOff`).
fn color_of(el: &El) -> Option<Color> {
    let tint = || {
        let pct = |c: &El| c.val().and_then(parse_i64).unwrap_or(100_000) as f64 / 100_000.0;
        let (mut lum_mod, mut lum_off, mut other) = (1.0, 0.0, 0.0);
        for c in el.elements() {
            match c.name.as_str() {
                "lumMod" => lum_mod = pct(c),
                "lumOff" => lum_off = pct(c),
                "shade" => other = -(1.0 - pct(c)),
                "tint" => other = 1.0 - pct(c),
                _ => {}
            }
        }
        let t: f64 = if lum_off > 0.0 {
            lum_off
        } else if lum_mod < 1.0 {
            lum_mod - 1.0
        } else {
            other
        };
        (t.clamp(-1.0, 1.0) * 100_000.0).round() / 100_000.0
    };
    let rgb = |rgb: Rgb| Color::Rgb(apply_tint(rgb, tint()));
    match el.name.as_str() {
        "srgbClr" => Rgb::from_hex(el.val()?).ok().map(rgb),
        "sysClr" => el
            .attr("lastClr")
            .and_then(|h| Rgb::from_hex(h).ok())
            .map(rgb),
        "prstClr" => {
            let hex = match el.val()? {
                "black" => "000000",
                "white" => "FFFFFF",
                "red" => "FF0000",
                "green" => "008000",
                "blue" => "0000FF",
                "yellow" => "FFFF00",
                "gray" | "grey" => "808080",
                _ => "000000",
            };
            Rgb::from_hex(hex).ok().map(rgb)
        }
        "schemeClr" => {
            let slot = ThemeColorSlot::from_ooxml_name(el.val()?)?;
            Some(Color::Theme { slot, tint: tint() })
        }
        _ => None,
    }
}

/// Copies `xml` without `c:externalData` and `c:userShapes` (their
/// relationship targets are not kept); `true` when something was removed.
fn strip_rel_elements(xml: &[u8]) -> (Vec<u8>, bool) {
    let wanted = |name: &[u8]| {
        let local = crate::xml::local_name(name);
        local == b"externalData" || local == b"userShapes"
    };
    let mut reader = Reader::from_reader(xml);
    let mut writer = Writer::new(Vec::with_capacity(xml.len()));
    let mut skip = 0usize;
    let mut stripped = false;
    loop {
        let ev = match reader.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(ev) => ev,
        };
        match &ev {
            Event::Start(e) if skip > 0 || wanted(e.name().as_ref().as_bytes()) => {
                skip += 1;
                stripped = true;
                continue;
            }
            Event::Empty(e) if skip > 0 || wanted(e.name().as_ref().as_bytes()) => {
                stripped = true;
                continue;
            }
            Event::End(_) if skip > 0 => {
                skip -= 1;
                continue;
            }
            _ if skip > 0 => continue,
            _ => {}
        }
        if writer.write_event(ev).is_err() {
            return (xml.to_vec(), false);
        }
    }
    if stripped {
        (writer.into_inner(), true)
    } else {
        (xml.to_vec(), false)
    }
}

// --- writing -----------------------------------------------------------------------

/// The resolved data of one reference, for the caches.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RefData {
    /// One entry per cell: the value and its displayed text.
    pub points: Vec<(ChartValue, String)>,
    /// Number format of the first cell (`None` = General).
    pub format_code: Option<String>,
}

/// Resolves references for the caches written with a chart.
pub trait ChartData {
    /// The data of a reference formula; `None` = unknown (the model's
    /// cache, if any, is written instead).
    fn resolve(&self, formula: &str) -> Option<RefData>;
}

/// No data: only the model's caches are written.
pub struct NoData;

impl ChartData for NoData {
    fn resolve(&self, _: &str) -> Option<RefData> {
        None
    }
}

fn fmt_num(n: f64) -> String {
    if n == n.trunc() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

const PRIMARY_CAT: &str = "500000001";
const PRIMARY_VAL: &str = "500000002";
const SECONDARY_CAT: &str = "500000003";
const SECONDARY_VAL: &str = "500000004";

/// Writes a chart part (`c:chartSpace`); an unsupported chart is
/// returned verbatim.
pub fn write_chart(chart: &Chart, data: &dyn ChartData) -> Vec<u8> {
    write_chart_with(chart, data, &ChartWriteOptions::default())
}

/// Options of [`write_chart_with`] (pptx/docx charts).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ChartWriteOptions {
    /// Writes `c:externalData r:id` (+ `c:autoUpdate val="0"`): the
    /// relationship of the embedded workbook.
    pub external_data: Option<String>,
    /// Writes a chart area without fill and outline (`c:spPr` with
    /// `a:noFill` and `a:ln/a:noFill`), as PowerPoint's charts on slides,
    /// unless the chart has its own [`Chart::chart_area`].
    pub transparent_area: bool,
}

const C15_NS: &str = "http://schemas.microsoft.com/office/drawing/2012/chart";
const EXT_LABEL_RANGE: &str = "{02D57815-91ED-43cb-92C2-25804820EDAC}";
const EXT_SHOW_RANGE: &str = "{CE6537A1-D6FC-4f65-9D91-7224C49458BB}";

/// [`write_chart`] with options.
pub fn write_chart_with(chart: &Chart, data: &dyn ChartData, opts: &ChartWriteOptions) -> Vec<u8> {
    write_chart_full(chart, data, opts, &[])
}

/// [`write_chart_with`] plus the relationship ids of the picture fills
/// (chart area, plot area) that the caller writes as image parts;
/// pictures without one are written as no fill.
pub fn write_chart_full(
    chart: &Chart,
    data: &dyn ChartData,
    opts: &ChartWriteOptions,
    pictures: &[(PictureSlot, String)],
) -> Vec<u8> {
    if let ChartKind::Unsupported { xml, .. } = &chart.kind {
        return xml.as_bytes().to_vec();
    }
    let mut x = XmlOut::new();
    x.start(
        "c:chartSpace",
        &[
            ("xmlns:c", CHART_NS),
            ("xmlns:a", DRAWINGML_NS),
            ("xmlns:r", REL_NS),
        ],
    );
    x.empty("c:date1904", &[("val", "0")]);
    x.empty(
        "c:roundedCorners",
        &[("val", bool_val(chart.rounded_corners))],
    );
    x.empty("c:style", &[("val", &chart.style.clamp(1, 48).to_string())]);
    x.start("c:chart", &[]);
    match &chart.title {
        Some(t) => {
            write_title(&mut x, t, false, data);
            x.empty("c:autoTitleDeleted", &[("val", "0")]);
        }
        None => x.empty("c:autoTitleDeleted", &[("val", "1")]),
    }
    x.start("c:plotArea", &[]);
    write_layout(&mut x, chart.plot_layout.as_ref(), true);
    let groups = plan_groups(chart);
    let horizontal = groups.iter().any(|g| {
        matches!(
            g.kind,
            ChartKind::Bar {
                direction: BarDirection::Bar,
                ..
            }
        )
    });
    let mut used_secondary = false;
    for g in &groups {
        used_secondary |= g.axis == AxisGroup::Secondary && g.kind.has_axes();
        write_group(&mut x, chart, g, data);
    }
    let axis_kind = groups
        .first()
        .map(|g| g.kind.clone())
        .unwrap_or_else(ChartKind::column);
    if axis_kind.has_axes() {
        let scatter = matches!(axis_kind, ChartKind::Scatter { .. });
        let between = match &axis_kind {
            ChartKind::Bar { .. } | ChartKind::Line { .. } => "between",
            _ => "midCat",
        };
        let (cat_pos, val_pos, sval_pos) = if horizontal {
            ("l", "b", "t")
        } else {
            ("b", "l", "r")
        };
        let a = &chart.axes;
        write_axis(
            &mut x,
            &a.cat,
            AxisSpec {
                element: if scatter { "c:valAx" } else { "c:catAx" },
                id: PRIMARY_CAT,
                cross: PRIMARY_VAL,
                pos: cat_pos,
                vertical: horizontal,
                between: None,
            },
            data,
        );
        write_axis(
            &mut x,
            &a.val,
            AxisSpec {
                element: "c:valAx",
                id: PRIMARY_VAL,
                cross: PRIMARY_CAT,
                pos: val_pos,
                vertical: !horizontal,
                between: Some(between),
            },
            data,
        );
        if used_secondary {
            let hidden = Axis {
                delete: true,
                ..Axis::default()
            };
            write_axis(
                &mut x,
                &hidden,
                AxisSpec {
                    element: if scatter { "c:valAx" } else { "c:catAx" },
                    id: SECONDARY_CAT,
                    cross: SECONDARY_VAL,
                    pos: cat_pos,
                    vertical: horizontal,
                    between: None,
                },
                data,
            );
            let second = a.second_val.clone().unwrap_or_else(|| Axis {
                major_gridlines: false,
                crosses: Crosses::Max,
                ..Axis::value()
            });
            write_axis(
                &mut x,
                &second,
                AxisSpec {
                    element: "c:valAx",
                    id: SECONDARY_VAL,
                    cross: SECONDARY_CAT,
                    pos: sval_pos,
                    vertical: !horizontal,
                    between: Some(between),
                },
                data,
            );
        }
    }
    if let Some(t) = &chart.data_table {
        x.start("c:dTable", &[]);
        x.empty("c:showHorzBorder", &[("val", bool_val(t.horizontal))]);
        x.empty("c:showVertBorder", &[("val", bool_val(t.vertical))]);
        x.empty("c:showOutline", &[("val", bool_val(t.outline))]);
        x.empty("c:showKeys", &[("val", bool_val(t.keys))]);
        if let Some(tf) = &t.text_format {
            write_text_format(&mut x, "c:txPr", tf, None);
        }
        x.end("c:dTable");
    }
    if let Some(p) = &chart.plot_area {
        write_shape(&mut x, p, picture_id(pictures, PictureSlot::PlotArea));
    }
    x.end("c:plotArea");
    if let Some(l) = &chart.legend {
        x.start("c:legend", &[]);
        x.empty("c:legendPos", &[("val", l.position.ooxml_name())]);
        if chart.legend_layout.is_some() {
            write_layout(&mut x, chart.legend_layout.as_ref(), false);
        }
        x.empty("c:overlay", &[("val", bool_val(l.overlay))]);
        if let Some(tf) = &chart.legend_text_format {
            write_text_format(&mut x, "c:txPr", tf, None);
        }
        x.end("c:legend");
    }
    x.empty(
        "c:plotVisOnly",
        &[("val", bool_val(chart.plot_visible_only))],
    );
    x.empty(
        "c:dispBlanksAs",
        &[(
            "val",
            match chart.display_blanks_as {
                DisplayBlanks::Gap => "gap",
                DisplayBlanks::Zero => "zero",
                DisplayBlanks::Span => "span",
            },
        )],
    );
    x.end("c:chart");
    if let Some(area) = &chart.chart_area {
        write_shape(&mut x, area, picture_id(pictures, PictureSlot::ChartArea));
    } else if opts.transparent_area {
        x.start("c:spPr", &[]);
        x.empty("a:noFill", &[]);
        x.start("a:ln", &[]);
        x.empty("a:noFill", &[]);
        x.end("a:ln");
        x.end("c:spPr");
    }
    if let Some(tf) = &chart.text_format {
        write_text_format(&mut x, "c:txPr", tf, None);
    }
    if let Some(rid) = &opts.external_data {
        x.start("c:externalData", &[("r:id", rid)]);
        x.empty("c:autoUpdate", &[("val", "0")]);
        x.end("c:externalData");
    }
    x.end("c:chartSpace");
    x.finish()
}

fn bool_val(b: bool) -> &'static str {
    if b {
        "1"
    } else {
        "0"
    }
}

/// One chart group to write: a kind, an axis group and series indices.
struct Group {
    kind: ChartKind,
    axis: AxisGroup,
    series: Vec<usize>,
}

/// Series grouped by (kind, axis) in order of first appearance.
fn plan_groups(chart: &Chart) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    for i in 0..chart.series.len() {
        let mut kind = chart.series_kind(i).clone();
        if matches!(kind, ChartKind::Combo | ChartKind::Unsupported { .. }) {
            kind = ChartKind::column();
        }
        let axis = if kind.has_axes() {
            chart.series[i].axis
        } else {
            AxisGroup::Primary
        };
        match groups.iter_mut().find(|g| g.kind == kind && g.axis == axis) {
            Some(g) => g.series.push(i),
            None => groups.push(Group {
                kind,
                axis,
                series: vec![i],
            }),
        }
    }
    if groups.is_empty() {
        let kind = match &chart.kind {
            ChartKind::Combo | ChartKind::Unsupported { .. } => ChartKind::column(),
            k => k.clone(),
        };
        groups.push(Group {
            kind,
            axis: AxisGroup::Primary,
            series: Vec::new(),
        });
    }
    groups
}

fn grouping_name(g: Grouping) -> &'static str {
    match g {
        Grouping::Standard => "standard",
        Grouping::Clustered => "clustered",
        Grouping::Stacked => "stacked",
        Grouping::PercentStacked => "percentStacked",
    }
}

fn write_group(x: &mut XmlOut, chart: &Chart, g: &Group, data: &dyn ChartData) {
    let vary = [("val", bool_val(chart.vary_colors))];
    let labels = |x: &mut XmlOut| {
        if !chart.data_labels.is_empty() {
            write_labels(x, &chart.data_labels);
        }
    };
    let series = |x: &mut XmlOut| {
        for &i in &g.series {
            write_series(x, chart, i, &g.kind, data);
        }
    };
    let (ids, ids_secondary) = ([PRIMARY_CAT, PRIMARY_VAL], [SECONDARY_CAT, SECONDARY_VAL]);
    let axis_ids = |x: &mut XmlOut| {
        let ids = if g.axis == AxisGroup::Secondary {
            ids_secondary
        } else {
            ids
        };
        for id in ids {
            x.empty("c:axId", &[("val", id)]);
        }
    };
    match &g.kind {
        ChartKind::Bar {
            direction,
            grouping,
        } => {
            x.start("c:barChart", &[]);
            let dir = match direction {
                BarDirection::Column => "col",
                BarDirection::Bar => "bar",
            };
            x.empty("c:barDir", &[("val", dir)]);
            let grouping = if *grouping == Grouping::Standard {
                Grouping::Clustered
            } else {
                *grouping
            };
            x.empty("c:grouping", &[("val", grouping_name(grouping))]);
            x.empty("c:varyColors", &vary);
            series(x);
            labels(x);
            if let Some(w) = chart.gap_width {
                x.empty("c:gapWidth", &[("val", &w.min(500).to_string())]);
            }
            let overlap = match chart.overlap {
                Some(o) => Some(o.clamp(-100, 100)),
                None if grouping.is_stacked() => Some(100),
                None => None,
            };
            if let Some(o) = overlap {
                x.empty("c:overlap", &[("val", &o.to_string())]);
            }
            axis_ids(x);
            x.end("c:barChart");
        }
        ChartKind::Line { grouping, .. } => {
            x.start("c:lineChart", &[]);
            let grouping = if *grouping == Grouping::Clustered {
                Grouping::Standard
            } else {
                *grouping
            };
            x.empty("c:grouping", &[("val", grouping_name(grouping))]);
            x.empty("c:varyColors", &vary);
            series(x);
            labels(x);
            let first_line = plan_groups(chart)
                .iter()
                .find(|o| matches!(o.kind, ChartKind::Line { .. }))
                .is_some_and(|o| o.series == g.series);
            if first_line {
                if let Some(l) = &chart.high_low_lines {
                    x.start("c:hiLowLines", &[]);
                    write_sp(x, None, Some(l));
                    x.end("c:hiLowLines");
                }
                if let Some(u) = &chart.up_down_bars {
                    x.start("c:upDownBars", &[]);
                    x.empty(
                        "c:gapWidth",
                        &[("val", &u.gap_width.unwrap_or(150).min(500).to_string())],
                    );
                    for (name, f) in [("c:upBars", &u.up), ("c:downBars", &u.down)] {
                        match f {
                            Some(f) => {
                                x.start(name, &[]);
                                write_shape(x, f, None);
                                x.end(name);
                            }
                            None => x.empty(name, &[]),
                        }
                    }
                    x.end("c:upDownBars");
                }
            }
            // Excel writes `1` and hides the markers per series.
            x.empty("c:marker", &[("val", "1")]);
            axis_ids(x);
            x.end("c:lineChart");
        }
        ChartKind::Area { grouping } => {
            x.start("c:areaChart", &[]);
            let grouping = if *grouping == Grouping::Clustered {
                Grouping::Standard
            } else {
                *grouping
            };
            x.empty("c:grouping", &[("val", grouping_name(grouping))]);
            x.empty("c:varyColors", &vary);
            series(x);
            labels(x);
            axis_ids(x);
            x.end("c:areaChart");
        }
        ChartKind::Pie | ChartKind::Doughnut => {
            let doughnut = g.kind == ChartKind::Doughnut;
            let name = if doughnut {
                "c:doughnutChart"
            } else {
                "c:pieChart"
            };
            x.start(name, &[]);
            x.empty("c:varyColors", &vary);
            series(x);
            labels(x);
            if let Some(a) = chart.first_slice_angle {
                x.empty("c:firstSliceAng", &[("val", &a.min(360).to_string())]);
            }
            if doughnut {
                x.empty(
                    "c:holeSize",
                    &[(
                        "val",
                        &chart.hole_size.unwrap_or(50).clamp(10, 90).to_string(),
                    )],
                );
            }
            x.end(name);
        }
        ChartKind::Scatter { style } => {
            x.start("c:scatterChart", &[]);
            let s = if style.is_smooth() {
                "smoothMarker"
            } else {
                "lineMarker"
            };
            x.empty("c:scatterStyle", &[("val", s)]);
            x.empty("c:varyColors", &vary);
            series(x);
            labels(x);
            axis_ids(x);
            x.end("c:scatterChart");
        }
        ChartKind::Combo | ChartKind::Unsupported { .. } => {}
    }
}

fn write_series(x: &mut XmlOut, chart: &Chart, i: usize, kind: &ChartKind, data: &dyn ChartData) {
    let s = &chart.series[i];
    let n = i.to_string();
    x.start("c:ser", &[]);
    x.empty("c:idx", &[("val", &n)]);
    x.empty("c:order", &[("val", &n)]);
    if let Some(name) = &s.name {
        x.start("c:tx", &[]);
        match name {
            TextSource::Literal { text } => x.text_el("c:v", &[], text),
            TextSource::Ref { formula, cache } => {
                let text = data
                    .resolve(formula)
                    .map(|d| {
                        d.points
                            .iter()
                            .map(|(_, t)| t.as_str())
                            .filter(|t| !t.is_empty())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .or_else(|| cache.clone());
                x.start("c:strRef", &[]);
                x.text_el("c:f", &[], formula);
                if let Some(t) = text {
                    x.start("c:strCache", &[]);
                    x.empty("c:ptCount", &[("val", "1")]);
                    x.start("c:pt", &[("idx", "0")]);
                    x.text_el("c:v", &[], &t);
                    x.end("c:pt");
                    x.end("c:strCache");
                }
                x.end("c:strRef");
            }
        }
        x.end("c:tx");
    }
    // Lines and scatter: series-level "no marker" / "no line" from the kind.
    let (line_kind, scatter) = match kind {
        ChartKind::Line { markers, .. } => (Some(*markers), None),
        ChartKind::Scatter { style } => (Some(style.has_markers()), Some(*style)),
        _ => (None, None),
    };
    let mut line = s.line;
    if let Some(style) = scatter {
        if !style.has_lines() && line.is_none() {
            line = Some(LineFormat::hidden());
        }
    }
    write_sp(x, s.fill.as_ref(), line.as_ref());
    if matches!(kind, ChartKind::Bar { .. }) {
        x.empty("c:invertIfNegative", &[("val", "0")]);
    }
    if let Some(with_markers) = line_kind {
        let marker = s.marker.or_else(|| {
            (!with_markers).then_some(Marker {
                symbol: MarkerSymbol::None,
                size: None,
                fill: None,
                line: None,
            })
        });
        if let Some(m) = &marker {
            write_marker(x, m);
        }
    }
    for p in &s.data_points {
        x.start("c:dPt", &[]);
        x.empty("c:idx", &[("val", &p.idx.to_string())]);
        if matches!(kind, ChartKind::Bar { .. }) {
            x.empty("c:invertIfNegative", &[("val", "0")]);
        }
        if line_kind.is_some() {
            if let Some(m) = &p.marker {
                write_marker(x, m);
            }
        }
        if matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
            x.empty("c:bubble3D", &[("val", "0")]);
        }
        write_sp(x, p.fill.as_ref(), p.line.as_ref());
        x.end("c:dPt");
    }
    if let Some(l) = &s.data_labels {
        write_labels(x, l);
    }
    if let Some(t) = &s.trendline {
        if !matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
            write_trendline(x, t);
        }
    }
    if !matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
        let max = if scatter.is_some() { 2 } else { 1 };
        for e in s
            .error_bars
            .iter()
            .filter(|e| scatter.is_some() || e.direction == ErrorBarDirection::Y)
            .take(max)
        {
            write_err_bars(x, e, scatter.is_some(), data);
        }
    }
    let (cat_el, val_el) = if scatter.is_some() {
        ("c:xVal", "c:yVal")
    } else {
        ("c:cat", "c:val")
    };
    if let Some(cat) = chart.series_categories(i) {
        x.start(cat_el, &[]);
        write_data(x, cat, data, false);
        x.end(cat_el);
    }
    x.start(val_el, &[]);
    write_data(x, &s.values, data, true);
    x.end(val_el);
    match (kind, scatter) {
        (ChartKind::Line { .. }, _) => {
            x.empty("c:smooth", &[("val", bool_val(s.smooth.unwrap_or(false)))]);
        }
        (_, Some(style)) => {
            let smooth = style.has_lines() && s.smooth.unwrap_or(style.is_smooth());
            x.empty("c:smooth", &[("val", bool_val(smooth))]);
        }
        _ => {}
    }
    if let Some(range) = s.data_labels.as_ref().and_then(|l| l.range.as_ref()) {
        if let Some(f) = range.formula() {
            x.start("c:extLst", &[]);
            x.start("c:ext", &[("uri", EXT_LABEL_RANGE), ("xmlns:c15", C15_NS)]);
            x.start("c15:datalabelsRange", &[]);
            x.text_el("c15:f", &[], f);
            let points = data.resolve(f).map(|r| r.points).or_else(|| match range {
                DataRef::Ref { cache: Some(c), .. } => {
                    Some(c.iter().map(|v| (v.clone(), value_text(v))).collect())
                }
                _ => None,
            });
            if let Some(points) = points {
                x.start("c15:dlblRangeCache", &[]);
                x.empty("c:ptCount", &[("val", &points.len().to_string())]);
                for (i, (_, t)) in points
                    .iter()
                    .enumerate()
                    .filter(|(_, (_, t))| !t.is_empty())
                {
                    x.start("c:pt", &[("idx", &i.to_string())]);
                    x.text_el("c:v", &[], t);
                    x.end("c:pt");
                }
                x.end("c15:dlblRangeCache");
            }
            x.end("c15:datalabelsRange");
            x.end("c:ext");
            x.end("c:extLst");
        }
    }
    x.end("c:ser");
}

fn write_err_bars(x: &mut XmlOut, e: &ErrorBars, scatter: bool, data: &dyn ChartData) {
    x.start("c:errBars", &[]);
    if scatter {
        let dir = match e.direction {
            ErrorBarDirection::X => "x",
            ErrorBarDirection::Y => "y",
        };
        x.empty("c:errDir", &[("val", dir)]);
    }
    let ty = match e.bar_type {
        ErrorBarType::Both => "both",
        ErrorBarType::Plus => "plus",
        ErrorBarType::Minus => "minus",
    };
    x.empty("c:errBarType", &[("val", ty)]);
    let (vt, value) = match &e.amount {
        ErrorAmount::Fixed { value } => ("fixedVal", Some(*value)),
        ErrorAmount::Percentage { value } => ("percentage", Some(*value)),
        ErrorAmount::StdDev { value } => ("stdDev", Some(*value)),
        ErrorAmount::StdErr => ("stdErr", None),
        ErrorAmount::Custom { .. } => ("cust", None),
    };
    x.empty("c:errValType", &[("val", vt)]);
    x.empty("c:noEndCap", &[("val", bool_val(e.no_end_cap))]);
    if let ErrorAmount::Custom { plus, minus } = &e.amount {
        for (name, d) in [("c:plus", plus), ("c:minus", minus)] {
            if let Some(d) = d {
                x.start(name, &[]);
                write_data(x, d, data, true);
                x.end(name);
            }
        }
    }
    if let Some(v) = value {
        x.empty("c:val", &[("val", &fmt_num(v))]);
    }
    if let Some(l) = &e.line {
        write_sp(x, None, Some(l));
    }
    x.end("c:errBars");
}

fn picture_id(pictures: &[(PictureSlot, String)], slot: PictureSlot) -> Option<&str> {
    pictures
        .iter()
        .find(|(s, _)| *s == slot)
        .map(|(_, r)| r.as_str())
}

/// `c:layout` (empty = automatic); `inner`: the plot area's inner box.
fn write_layout(x: &mut XmlOut, l: Option<&ManualLayout>, inner: bool) {
    let Some(l) = l else {
        x.empty("c:layout", &[]);
        return;
    };
    x.start("c:layout", &[]);
    x.start("c:manualLayout", &[]);
    if inner {
        x.empty("c:layoutTarget", &[("val", "inner")]);
    }
    x.empty("c:xMode", &[("val", "edge")]);
    x.empty("c:yMode", &[("val", "edge")]);
    if l.w.is_some() {
        x.empty("c:wMode", &[("val", "edge")]);
    }
    if l.h.is_some() {
        x.empty("c:hMode", &[("val", "edge")]);
    }
    let f = |v: f64| fmt_num((v.clamp(0.0, 1.0) * 1e6).round() / 1e6);
    x.empty("c:x", &[("val", &f(l.x))]);
    x.empty("c:y", &[("val", &f(l.y))]);
    // In edge mode w/h are the right/bottom edges.
    if let Some(w) = l.w {
        x.empty("c:w", &[("val", &f(w))]);
    }
    if let Some(h) = l.h {
        x.empty("c:h", &[("val", &f(h))]);
    }
    x.end("c:manualLayout");
    x.end("c:layout");
}

/// The `a:defRPr` / `a:rPr` of a text format.
fn write_rpr(x: &mut XmlOut, name: &str, tf: &TextFormat, extra: &[(&str, &str)]) {
    let sz = tf
        .size
        .map(|v| ((v * 100.0).round() as i64).clamp(100, 400_000).to_string());
    let mut a: Vec<(&str, &str)> = extra.to_vec();
    if let Some(sz) = &sz {
        a.push(("sz", sz));
    }
    if let Some(b) = tf.bold {
        a.push(("b", bool_val(b)));
    }
    if let Some(i) = tf.italic {
        a.push(("i", bool_val(i)));
    }
    if tf.color.is_none() && tf.font.is_none() {
        x.empty(name, &a);
        return;
    }
    x.start(name, &a);
    if let Some(c) = &tf.color {
        write_fill(x, &Fill::Solid { color: *c });
    }
    if let Some(f) = &tf.font {
        x.empty("a:latin", &[("typeface", f)]);
    }
    x.end(name);
}

fn body_pr(x: &mut XmlOut, tf: Option<&TextFormat>, default_rot: Option<i32>) {
    match tf.and_then(|t| t.rotation).or(default_rot) {
        Some(r) => {
            let rot = (i64::from(r.clamp(-90, 90)) * 60_000).to_string();
            x.empty("a:bodyPr", &[("rot", &rot), ("vert", "horz")]);
        }
        None => x.empty("a:bodyPr", &[]),
    }
}

/// `c:txPr` (or another name of the same type).
fn write_text_format(x: &mut XmlOut, name: &str, tf: &TextFormat, default_rot: Option<i32>) {
    x.start(name, &[]);
    body_pr(x, Some(tf), default_rot);
    x.empty("a:lstStyle", &[]);
    x.start("a:p", &[]);
    x.start("a:pPr", &[]);
    write_rpr(x, "a:defRPr", tf, &[]);
    x.end("a:pPr");
    x.empty("a:endParaRPr", &[("lang", "en-US")]);
    x.end("a:p");
    x.end(name);
}

/// `c:spPr` of an area (fill incl. gradient / picture, outline, shadow).
fn write_shape(x: &mut XmlOut, s: &ShapeFormat, picture: Option<&str>) {
    if s.is_empty() {
        return;
    }
    x.start("c:spPr", &[]);
    match &s.fill {
        None => {}
        Some(AreaFill::None) => x.empty("a:noFill", &[]),
        Some(AreaFill::Solid { color }) => write_fill(x, &Fill::Solid { color: *color }),
        Some(AreaFill::Gradient {
            stops,
            angle,
            radial,
        }) => {
            x.start("a:gradFill", &[("rotWithShape", "1")]);
            x.start("a:gsLst", &[]);
            for st in stops {
                let pos = ((st.pos.clamp(0.0, 1.0) * 100_000.0).round() as i64).to_string();
                x.start("a:gs", &[("pos", &pos)]);
                write_color(x, &st.color);
                x.end("a:gs");
            }
            x.end("a:gsLst");
            if *radial {
                x.start("a:path", &[("path", "circle")]);
                x.empty(
                    "a:fillToRect",
                    &[
                        ("l", "50000"),
                        ("t", "50000"),
                        ("r", "50000"),
                        ("b", "50000"),
                    ],
                );
                x.end("a:path");
            } else {
                let ang = ((angle.rem_euclid(360.0) * 60_000.0).round() as i64).to_string();
                x.empty("a:lin", &[("ang", &ang), ("scaled", "1")]);
            }
            x.end("a:gradFill");
        }
        Some(AreaFill::Picture { media, tile }) => match picture {
            Some(rid) if !media.data.is_empty() => {
                x.start("a:blipFill", &[]);
                x.empty("a:blip", &[("r:embed", rid)]);
                if *tile {
                    x.empty("a:tile", &[]);
                } else {
                    x.start("a:stretch", &[]);
                    x.empty("a:fillRect", &[]);
                    x.end("a:stretch");
                }
                x.end("a:blipFill");
            }
            _ => x.empty("a:noFill", &[]),
        },
    }
    if let Some(l) = &s.line {
        write_line(x, l);
    }
    if s.shadow {
        x.start("a:effectLst", &[]);
        x.start(
            "a:outerShdw",
            &[
                ("blurRad", "50800"),
                ("dist", "38100"),
                ("dir", "2700000"),
                ("algn", "tl"),
                ("rotWithShape", "0"),
            ],
        );
        x.start("a:prstClr", &[("val", "black")]);
        x.empty("a:alpha", &[("val", "40000")]);
        x.end("a:prstClr");
        x.end("a:outerShdw");
        x.end("a:effectLst");
    }
    x.end("c:spPr");
}

/// A reference or literal with its cache. Values are always numeric
/// (`numRef`); categories are numeric when every non-blank point is a
/// number, else text (`strRef`).
fn write_data(x: &mut XmlOut, d: &DataRef, data: &dyn ChartData, values: bool) {
    let (formula, points, format) = match d {
        DataRef::Ref { formula, cache } => match data.resolve(formula) {
            Some(r) => (Some(formula), Some(r.points), r.format_code),
            None => (
                Some(formula),
                cache.as_ref().map(|c| {
                    c.iter()
                        .map(|v| (v.clone(), value_text(v)))
                        .collect::<Vec<_>>()
                }),
                None,
            ),
        },
        DataRef::Literal { values } => (
            None,
            Some(values.iter().map(|v| (v.clone(), value_text(v))).collect()),
            None,
        ),
    };
    let numeric = values
        || points.as_ref().is_some_and(|p| {
            p.iter()
                .all(|(v, _)| matches!(v, ChartValue::Number(_) | ChartValue::Blank))
                && p.iter().any(|(v, _)| matches!(v, ChartValue::Number(_)))
        });
    let format = format.unwrap_or_else(|| "General".to_owned());
    let body = |x: &mut XmlOut, points: &[(ChartValue, String)]| {
        if numeric {
            x.text_el("c:formatCode", &[], &format);
        }
        x.empty("c:ptCount", &[("val", &points.len().to_string())]);
        for (i, (v, text)) in points.iter().enumerate() {
            let out = if numeric {
                match v {
                    ChartValue::Number(n) => Some(fmt_num(*n)),
                    _ => None,
                }
            } else {
                (!matches!(v, ChartValue::Blank) || !text.is_empty()).then(|| text.clone())
            };
            if let Some(out) = out {
                x.start("c:pt", &[("idx", &i.to_string())]);
                x.text_el("c:v", &[], &out);
                x.end("c:pt");
            }
        }
    };
    match formula {
        Some(f) => {
            let (r, c) = if numeric {
                ("c:numRef", "c:numCache")
            } else {
                ("c:strRef", "c:strCache")
            };
            x.start(r, &[]);
            x.text_el("c:f", &[], f);
            if let Some(p) = &points {
                x.start(c, &[]);
                body(x, p);
                x.end(c);
            }
            x.end(r);
        }
        None => {
            let lit = if numeric { "c:numLit" } else { "c:strLit" };
            x.start(lit, &[]);
            body(x, points.as_deref().unwrap_or_default());
            x.end(lit);
        }
    }
}

fn value_text(v: &ChartValue) -> String {
    match v {
        ChartValue::Number(n) => fmt_num(*n),
        ChartValue::Text(t) => t.clone(),
        ChartValue::Blank => String::new(),
    }
}

fn show_range_ext(x: &mut XmlOut, on: bool) {
    if on {
        x.start("c:extLst", &[]);
        x.start("c:ext", &[("uri", EXT_SHOW_RANGE), ("xmlns:c15", C15_NS)]);
        x.empty("c15:showDataLabelsRange", &[("val", "1")]);
        x.end("c:ext");
        x.end("c:extLst");
    }
}

fn write_labels(x: &mut XmlOut, l: &DataLabels) {
    x.start("c:dLbls", &[]);
    for p in &l.points {
        x.start("c:dLbl", &[]);
        x.empty("c:idx", &[("val", &p.idx.to_string())]);
        if p.delete {
            x.empty("c:delete", &[("val", "1")]);
        } else {
            write_layout(x, p.layout.as_ref(), false);
            if let Some(f) = &p.number_format {
                x.empty("c:numFmt", &[("formatCode", f), ("sourceLinked", "0")]);
            }
            if let Some(tf) = &p.text_format {
                write_text_format(x, "c:txPr", tf, None);
            }
            if let Some(pos) = p.position {
                x.empty("c:dLblPos", &[("val", pos.ooxml_name())]);
            }
            for (name, on) in [
                ("c:showLegendKey", false),
                ("c:showVal", p.show_value),
                ("c:showCatName", p.show_category),
                ("c:showSerName", p.show_series),
                ("c:showPercent", p.show_percent),
                ("c:showBubbleSize", false),
            ] {
                x.empty(name, &[("val", bool_val(on))]);
            }
            show_range_ext(x, p.show_range);
        }
        x.end("c:dLbl");
    }
    if let Some(f) = &l.number_format {
        x.empty("c:numFmt", &[("formatCode", f), ("sourceLinked", "0")]);
    }
    if let Some(tf) = &l.text_format {
        write_text_format(x, "c:txPr", tf, None);
    }
    if let Some(p) = l.position {
        x.empty("c:dLblPos", &[("val", p.ooxml_name())]);
    }
    for (name, on) in [
        ("c:showLegendKey", l.show_legend_key),
        ("c:showVal", l.show_value),
        ("c:showCatName", l.show_category),
        ("c:showSerName", l.show_series),
        ("c:showPercent", l.show_percent),
        ("c:showBubbleSize", false),
    ] {
        x.empty(name, &[("val", bool_val(on))]);
    }
    if l.leader_lines {
        x.empty("c:showLeaderLines", &[("val", "1")]);
    }
    show_range_ext(x, l.show_range);
    x.end("c:dLbls");
}

fn write_trendline(x: &mut XmlOut, t: &Trendline) {
    x.start("c:trendline", &[]);
    if let Some(n) = &t.name {
        x.text_el("c:name", &[], n);
    }
    if let Some(l) = &t.line {
        write_sp(x, None, Some(l));
    }
    let kind = match t.kind {
        TrendlineKind::Linear => "linear",
        TrendlineKind::Exponential => "exp",
        TrendlineKind::Logarithmic => "log",
        TrendlineKind::Power => "power",
        TrendlineKind::Polynomial { .. } => "poly",
        TrendlineKind::MovingAverage { .. } => "movingAvg",
    };
    x.empty("c:trendlineType", &[("val", kind)]);
    match t.kind {
        TrendlineKind::Polynomial { order } => {
            x.empty("c:order", &[("val", &order.clamp(2, 6).to_string())])
        }
        TrendlineKind::MovingAverage { period } => {
            x.empty("c:period", &[("val", &period.clamp(2, 255).to_string())])
        }
        _ => {}
    }
    x.empty("c:dispRSqr", &[("val", bool_val(t.display_r_squared))]);
    x.empty("c:dispEq", &[("val", bool_val(t.display_equation))]);
    x.end("c:trendline");
}

fn write_marker(x: &mut XmlOut, m: &Marker) {
    x.start("c:marker", &[]);
    x.empty("c:symbol", &[("val", m.symbol.name())]);
    if let Some(s) = m.size {
        x.empty("c:size", &[("val", &s.clamp(2, 72).to_string())]);
    }
    write_sp(x, m.fill.as_ref(), m.line.as_ref());
    x.end("c:marker");
}

/// `c:spPr` with a fill and/or a line; nothing when both are absent.
fn write_sp(x: &mut XmlOut, fill: Option<&Fill>, line: Option<&LineFormat>) {
    if fill.is_none() && line.is_none() {
        return;
    }
    x.start("c:spPr", &[]);
    if let Some(f) = fill {
        write_fill(x, f);
    }
    if let Some(l) = line {
        write_line(x, l);
    }
    x.end("c:spPr");
}

fn write_line(x: &mut XmlOut, l: &LineFormat) {
    let w = l.width.map(|w| w.max(0).to_string());
    let attrs: Vec<(&str, &str)> = w.iter().map(|w| ("w", w.as_str())).collect();
    x.start("a:ln", &attrs);
    if l.none {
        x.empty("a:noFill", &[]);
    } else if let Some(c) = &l.color {
        write_fill(x, &Fill::Solid { color: *c });
    }
    if let Some(d) = l.dash {
        x.empty("a:prstDash", &[("val", d.name())]);
    }
    x.end("a:ln");
}

fn write_fill(x: &mut XmlOut, f: &Fill) {
    match f {
        Fill::None => x.empty("a:noFill", &[]),
        Fill::Solid { color } => {
            x.start("a:solidFill", &[]);
            write_color(x, color);
            x.end("a:solidFill");
        }
    }
}

/// Writes a DrawingML color element (theme tints as `lumMod`/`lumOff`).
pub fn write_color(x: &mut XmlOut, c: &Color) {
    match *c {
        Color::Auto => x.empty("a:schemeClr", &[("val", "tx1")]),
        Color::Rgb(rgb) => x.empty("a:srgbClr", &[("val", &rgb.to_hex())]),
        Color::Theme { slot, tint } => {
            let val = match slot {
                ThemeColorSlot::Dark1 => "tx1",
                ThemeColorSlot::Light1 => "bg1",
                ThemeColorSlot::Dark2 => "tx2",
                ThemeColorSlot::Light2 => "bg2",
                other => other.ooxml_scheme_name(),
            };
            if tint == 0.0 || tint.is_nan() {
                x.empty("a:schemeClr", &[("val", val)]);
                return;
            }
            let t = tint.clamp(-1.0, 1.0);
            let n = |v: f64| ((v * 100_000.0).round() as i64).to_string();
            x.start("a:schemeClr", &[("val", val)]);
            if t < 0.0 {
                x.empty("a:lumMod", &[("val", &n(1.0 + t))]);
            } else {
                x.empty("a:lumMod", &[("val", &n(1.0 - t))]);
                x.empty("a:lumOff", &[("val", &n(t))]);
            }
            x.end("a:schemeClr");
        }
    }
}

/// `c:title`; `vertical` rotates the text (vertical axes).
fn write_title(x: &mut XmlOut, t: &ChartTitle, vertical: bool, data: &dyn ChartData) {
    x.start("c:title", &[]);
    let default_rot = vertical.then_some(-90);
    let tf = t.text_format.clone().unwrap_or_default();
    match &t.text {
        Some(TextSource::Literal { text }) => {
            x.start("c:tx", &[]);
            x.start("c:rich", &[]);
            body_pr(x, Some(&tf), default_rot);
            x.empty("a:lstStyle", &[]);
            for line in text.split('\n') {
                x.start("a:p", &[]);
                x.start("a:pPr", &[]);
                write_rpr(x, "a:defRPr", &tf, &[]);
                x.end("a:pPr");
                x.start("a:r", &[]);
                if !tf.is_empty() {
                    write_rpr(x, "a:rPr", &tf, &[("lang", "en-US")]);
                }
                x.text_el("a:t", &[], line);
                x.end("a:r");
                x.end("a:p");
            }
            x.end("c:rich");
            x.end("c:tx");
        }
        Some(TextSource::Ref { formula, cache }) => {
            let text = data
                .resolve(formula)
                .and_then(|d| d.points.into_iter().next().map(|(_, t)| t))
                .or_else(|| cache.clone());
            x.start("c:tx", &[]);
            x.start("c:strRef", &[]);
            x.text_el("c:f", &[], formula);
            if let Some(t) = text {
                x.start("c:strCache", &[]);
                x.empty("c:ptCount", &[("val", "1")]);
                x.start("c:pt", &[("idx", "0")]);
                x.text_el("c:v", &[], &t);
                x.end("c:pt");
                x.end("c:strCache");
            }
            x.end("c:strRef");
            x.end("c:tx");
        }
        None => {}
    }
    if t.layout.is_some() {
        write_layout(x, t.layout.as_ref(), false);
    }
    x.empty("c:overlay", &[("val", bool_val(t.overlay))]);
    let literal = matches!(t.text, Some(TextSource::Literal { .. }));
    if !literal && (!tf.is_empty() || vertical) {
        write_text_format(x, "c:txPr", &tf, default_rot);
    }
    x.end("c:title");
}

struct AxisSpec<'a> {
    element: &'a str,
    id: &'a str,
    cross: &'a str,
    pos: &'a str,
    vertical: bool,
    /// `crossBetween` (value axes).
    between: Option<&'a str>,
}

fn write_axis(x: &mut XmlOut, a: &Axis, spec: AxisSpec<'_>, data: &dyn ChartData) {
    x.start(spec.element, &[]);
    x.empty("c:axId", &[("val", spec.id)]);
    x.start("c:scaling", &[]);
    if let Some(b) = a.log_base {
        x.empty("c:logBase", &[("val", &fmt_num(b.clamp(2.0, 1000.0)))]);
    }
    x.empty(
        "c:orientation",
        &[("val", if a.reverse { "maxMin" } else { "minMax" })],
    );
    if let Some(v) = a.max {
        x.empty("c:max", &[("val", &fmt_num(v))]);
    }
    if let Some(v) = a.min {
        x.empty("c:min", &[("val", &fmt_num(v))]);
    }
    x.end("c:scaling");
    x.empty("c:delete", &[("val", bool_val(a.delete))]);
    x.empty("c:axPos", &[("val", spec.pos)]);
    if a.major_gridlines {
        x.empty("c:majorGridlines", &[]);
    }
    if a.minor_gridlines {
        x.empty("c:minorGridlines", &[]);
    }
    if let Some(t) = &a.title {
        write_title(x, t, spec.vertical, data);
    }
    match &a.number_format {
        Some(f) => x.empty("c:numFmt", &[("formatCode", f), ("sourceLinked", "0")]),
        None => x.empty(
            "c:numFmt",
            &[("formatCode", "General"), ("sourceLinked", "1")],
        ),
    }
    x.empty("c:majorTickMark", &[("val", "out")]);
    x.empty("c:minorTickMark", &[("val", "none")]);
    let lbl = match a.tick_labels {
        TickLabels::NextTo => "nextTo",
        TickLabels::High => "high",
        TickLabels::Low => "low",
        TickLabels::None => "none",
    };
    x.empty("c:tickLblPos", &[("val", lbl)]);
    if let Some(l) = &a.line {
        write_sp(x, None, Some(l));
    }
    if let Some(tf) = &a.text_format {
        write_text_format(x, "c:txPr", tf, None);
    }
    x.empty("c:crossAx", &[("val", spec.cross)]);
    match a.crosses {
        Crosses::AutoZero => x.empty("c:crosses", &[("val", "autoZero")]),
        Crosses::Min => x.empty("c:crosses", &[("val", "min")]),
        Crosses::Max => x.empty("c:crosses", &[("val", "max")]),
        Crosses::At { value } => x.empty("c:crossesAt", &[("val", &fmt_num(value))]),
    }
    match spec.between {
        Some(b) => {
            x.empty("c:crossBetween", &[("val", b)]);
            if let Some(v) = a.major_unit.filter(|v| *v > 0.0) {
                x.empty("c:majorUnit", &[("val", &fmt_num(v))]);
            }
            if let Some(v) = a.minor_unit.filter(|v| *v > 0.0) {
                x.empty("c:minorUnit", &[("val", &fmt_num(v))]);
            }
        }
        None if spec.element == "c:valAx" => {
            // Scatter X axis.
            x.empty("c:crossBetween", &[("val", "midCat")]);
            if let Some(v) = a.major_unit.filter(|v| *v > 0.0) {
                x.empty("c:majorUnit", &[("val", &fmt_num(v))]);
            }
            if let Some(v) = a.minor_unit.filter(|v| *v > 0.0) {
                x.empty("c:minorUnit", &[("val", &fmt_num(v))]);
            }
        }
        None => {
            x.empty("c:auto", &[("val", "1")]);
            x.empty("c:lblAlgn", &[("val", "ctr")]);
            x.empty("c:lblOffset", &[("val", "100")]);
            x.empty("c:noMultiLvlLbl", &[("val", "0")]);
        }
    }
    x.end(spec.element);
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::chart::DataPoint;

    fn roundtrip(chart: &Chart) -> Chart {
        let xml = write_chart(chart, &NoData);
        let (back, warnings) = read_chart(&xml, "/c.xml").unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        back
    }

    fn series(f: &str) -> Series {
        Series {
            name: Some(TextSource::reference(format!("S!$B$1{f}"))),
            ..Series::new(DataRef::reference(format!("S!$B$2:$B$5{f}")))
        }
    }

    #[test]
    fn external_data_option() {
        let mut c = Chart::new(ChartKind::column());
        c.series = vec![series("")];
        let opts = ChartWriteOptions {
            external_data: Some("rId3".into()),
            transparent_area: true,
        };
        let xml = write_chart_with(&c, &NoData, &opts);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(
            text.contains(r#"<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:externalData r:id="rId3"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>"#),
            "{text}"
        );
        let part = read_chart_ext(&xml, "/c.xml").unwrap();
        assert_eq!(part.external_data.as_deref(), Some("rId3"));
        assert!(part.warnings.is_empty(), "{:?}", part.warnings);
        assert_eq!(part.chart, c);
        // the xlsx reader keeps dropping it with a warning
        let (_, warnings) = read_chart(&xml, "/c.xml").unwrap();
        assert_eq!(warnings, ["chart user shapes / external data dropped"]);
        // without options the output is unchanged
        assert_eq!(
            write_chart_with(&c, &NoData, &ChartWriteOptions::default()),
            write_chart(&c, &NoData)
        );
    }

    #[test]
    fn every_kind_roundtrips() {
        let kinds = [
            ChartKind::column(),
            ChartKind::Bar {
                direction: BarDirection::Bar,
                grouping: Grouping::PercentStacked,
            },
            ChartKind::Line {
                grouping: Grouping::Stacked,
                markers: false,
            },
            ChartKind::Line {
                grouping: Grouping::Standard,
                markers: true,
            },
            ChartKind::Area {
                grouping: Grouping::Standard,
            },
            ChartKind::Pie,
            ChartKind::Doughnut,
            ChartKind::Scatter {
                style: ScatterStyle::Marker,
            },
            ChartKind::Scatter {
                style: ScatterStyle::LineMarker,
            },
            ChartKind::Scatter {
                style: ScatterStyle::Line,
            },
            ChartKind::Scatter {
                style: ScatterStyle::SmoothMarker,
            },
            ChartKind::Scatter {
                style: ScatterStyle::Smooth,
            },
        ];
        for kind in kinds {
            let mut c = Chart::new(kind.clone());
            c.series = vec![series(""), series("0")];
            c.categories = Some(DataRef::reference("S!$A$2:$A$5"));
            c.title = Some(ChartTitle::literal("Two\nlines"));
            c.legend = Some(Legend {
                position: LegendPosition::TopRight,
                overlay: true,
            });
            if kind == ChartKind::Doughnut {
                c.hole_size = Some(60);
            }
            if matches!(kind, ChartKind::Bar { .. }) {
                c.gap_width = Some(219);
                c.overlap = Some(100);
            }
            if matches!(kind, ChartKind::Pie | ChartKind::Doughnut) {
                c.vary_colors = true;
                c.first_slice_angle = Some(90);
            }
            assert_eq!(roundtrip(&c), c, "{kind:?}");
        }
    }

    #[test]
    fn combo_secondary_axis_and_formatting() {
        let mut c = Chart::new(ChartKind::Combo);
        let mut a = series("");
        a.kind = Some(ChartKind::column());
        a.fill = Some(Fill::Solid {
            color: Color::Theme {
                slot: ThemeColorSlot::Accent2,
                tint: -0.25,
            },
        });
        a.data_points = vec![DataPoint {
            idx: 2,
            fill: Some(Fill::Solid {
                color: Color::Rgb(Rgb::new(255, 0, 0)),
            }),
            line: Some(LineFormat::hidden()),
            marker: None,
        }];
        a.data_labels = Some(DataLabels {
            show_value: true,
            position: Some(LabelPosition::OutsideEnd),
            number_format: Some("0.0".into()),
            ..DataLabels::default()
        });
        let mut b = series("0");
        b.kind = Some(ChartKind::Line {
            grouping: Grouping::Standard,
            markers: true,
        });
        b.axis = AxisGroup::Secondary;
        b.line = Some(LineFormat {
            width: Some(28575),
            dash: Some(LineDash::SysDash),
            color: Some(Color::Rgb(Rgb::new(0, 0, 255))),
            none: false,
        });
        b.marker = Some(Marker {
            symbol: MarkerSymbol::Diamond,
            size: Some(9),
            fill: Some(Fill::None),
            line: None,
        });
        b.smooth = Some(true);
        b.trendline = Some(Trendline {
            kind: TrendlineKind::Polynomial { order: 3 },
            name: Some("Trend".into()),
            display_equation: true,
            display_r_squared: false,
            line: None,
        });
        c.series = vec![a, b];
        c.categories = Some(DataRef::reference("S!$A$2:$A$5"));
        c.axes.cat.title = Some(ChartTitle::default());
        c.axes.val = Axis {
            title: Some(ChartTitle {
                text: Some(TextSource::reference("S!$C$1")),
                ..ChartTitle::default()
            }),
            min: Some(0.0),
            max: Some(100.0),
            major_unit: Some(20.0),
            minor_unit: Some(5.0),
            number_format: Some("0%".into()),
            log_base: None,
            reverse: true,
            crosses: Crosses::At { value: 3.5 },
            major_gridlines: true,
            minor_gridlines: true,
            tick_labels: TickLabels::Low,
            delete: false,
            text_format: None,
            line: None,
        };
        c.axes.second_val = Some(Axis {
            log_base: Some(10.0),
            crosses: Crosses::Max,
            ..Axis::default()
        });
        c.style = 34;
        c.plot_visible_only = false;
        c.display_blanks_as = DisplayBlanks::Span;
        c.data_labels = DataLabels {
            show_category: true,
            show_series: true,
            show_legend_key: true,
            show_percent: true,
            ..DataLabels::default()
        };
        assert_eq!(roundtrip(&c), c);
    }

    #[test]
    fn caches_from_data_and_literals() {
        struct Data;
        impl ChartData for Data {
            fn resolve(&self, f: &str) -> Option<RefData> {
                let points = match f {
                    "S!$A$2:$A$3" => vec![
                        (ChartValue::Text("Jan".into()), "Jan".into()),
                        (ChartValue::Blank, String::new()),
                    ],
                    "S!$B$1" => vec![(ChartValue::Number(2024.0), "2024".into())],
                    _ => vec![
                        (ChartValue::Number(1.5), "1.50".into()),
                        (ChartValue::Text("x".into()), "x".into()),
                    ],
                };
                Some(RefData {
                    points,
                    format_code: Some("0.00".into()),
                })
            }
        }
        let mut c = Chart::new(ChartKind::column());
        let mut s = Series::new(DataRef::reference("S!$B$2:$B$3"));
        s.name = Some(TextSource::reference("S!$B$1"));
        s.categories = Some(DataRef::reference("S!$A$2:$A$3"));
        let lit = Series {
            categories: Some(DataRef::Literal {
                values: vec![ChartValue::Number(1.0), ChartValue::Number(2.0)],
            }),
            name: Some(TextSource::literal("Lit")),
            ..Series::new(DataRef::Literal {
                values: vec![ChartValue::Number(3.0), ChartValue::Blank],
            })
        };
        c.series = vec![s, lit];
        let xml = String::from_utf8(write_chart(&c, &Data)).unwrap();
        assert!(xml.contains("<c:strRef><c:f>S!$A$2:$A$3</c:f><c:strCache><c:ptCount val=\"2\"/><c:pt idx=\"0\"><c:v>Jan</c:v></c:pt></c:strCache>"), "{xml}");
        assert!(xml.contains("<c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val=\"2\"/><c:pt idx=\"0\"><c:v>1.5</c:v></c:pt></c:numCache>"), "{xml}");
        assert!(xml.contains("<c:strCache><c:ptCount val=\"1\"/><c:pt idx=\"0\"><c:v>2024</c:v>"));
        assert!(xml.contains("<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val=\"2\"/><c:pt idx=\"0\"><c:v>1</c:v></c:pt>"), "{xml}");
        let (back, w) = read_chart(xml.as_bytes(), "c").unwrap();
        assert!(w.is_empty());
        assert_eq!(
            back.series[0].values,
            DataRef::Ref {
                formula: "S!$B$2:$B$3".into(),
                cache: Some(vec![ChartValue::Number(1.5), ChartValue::Blank]),
            }
        );
        assert_eq!(
            back.series[0].name,
            Some(TextSource::Ref {
                formula: "S!$B$1".into(),
                cache: Some("2024".into())
            })
        );
        assert_eq!(back.series[1].values, c.series[1].values);
        assert_eq!(back.series[1].categories, c.series[1].categories);
    }

    #[test]
    fn unsupported_kept_verbatim_and_unknown_elements_warned() {
        let xml = br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="r"><c:chart><c:plotArea><c:radarChart><c:radarStyle val="marker"/></c:radarChart></c:plotArea></c:chart><c:userShapes r:id="rId2"/></c:chartSpace>"#;
        let (c, w) = read_chart(xml, "c").unwrap();
        let ChartKind::Unsupported { kind, xml: raw } = &c.kind else {
            panic!("{c:?}")
        };
        assert_eq!(kind, "radarChart");
        assert!(!raw.contains("userShapes") && raw.contains("radarStyle"));
        assert_eq!(w.len(), 2);
        assert_eq!(write_chart(&c, &NoData), raw.as_bytes());

        let xml = br#"<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"><mc:AlternateContent xmlns:mc="mc"><mc:Choice Requires="c14"><c14:style xmlns:c14="x" val="102"/></mc:Choice><mc:Fallback><style val="7"/></mc:Fallback></mc:AlternateContent><chart><plotArea><barChart><barDir val="col"/><ser><idx val="0"/><order val="0"/><val><numLit><ptCount val="1"/><pt idx="0"><v>1</v></pt></numLit></val><errBars/></ser><upDownBars/></barChart></plotArea></chart></chartSpace>"#;
        let (c, w) = read_chart(xml, "c").unwrap();
        assert_eq!(c.style, 7);
        // Error bars without a value type; up/down bars outside a line chart.
        assert_eq!(w, ["chart elements dropped: errBars, upDownBars"]);
        // One series, title not deleted: automatic title.
        assert_eq!(c.title, Some(ChartTitle::default()));
    }

    fn rgb(r: u8, g: u8, b: u8) -> Color {
        Color::Rgb(Rgb::new(r, g, b))
    }

    #[test]
    fn chart_and_plot_area_formats_roundtrip() {
        let mut c = Chart::new(ChartKind::column());
        c.series = vec![series("")];
        c.rounded_corners = true;
        c.chart_area = Some(ShapeFormat {
            fill: Some(AreaFill::Gradient {
                stops: vec![
                    GradientStop {
                        pos: 0.0,
                        color: rgb(255, 255, 255),
                    },
                    GradientStop {
                        pos: 1.0,
                        color: Color::theme(ThemeColorSlot::Accent1),
                    },
                ],
                angle: 90.0,
                radial: false,
            }),
            line: Some(LineFormat {
                color: Some(rgb(0, 0, 0)),
                width: Some(19050),
                dash: Some(LineDash::Dash),
                none: false,
            }),
            shadow: true,
        });
        c.plot_area = Some(ShapeFormat {
            fill: Some(AreaFill::Solid {
                color: rgb(242, 242, 242),
            }),
            ..ShapeFormat::default()
        });
        assert_eq!(roundtrip(&c), c);
        // Radial gradients and no fill.
        c.chart_area.as_mut().unwrap().fill = Some(AreaFill::Gradient {
            stops: vec![GradientStop {
                pos: 0.5,
                color: rgb(1, 2, 3),
            }],
            angle: 0.0,
            radial: true,
        });
        c.plot_area = Some(ShapeFormat {
            fill: Some(AreaFill::None),
            line: Some(LineFormat::hidden()),
            shadow: false,
        });
        assert_eq!(roundtrip(&c), c);
        // A picture fill needs the caller's relationship id.
        let media = core_model::Media {
            content_type: "image/png".into(),
            data: vec![1, 2, 3],
        };
        c.chart_area = Some(ShapeFormat {
            fill: Some(AreaFill::Picture {
                media: media.clone(),
                tile: false,
            }),
            ..ShapeFormat::default()
        });
        let pictures = [(PictureSlot::ChartArea, "rId7".to_owned())];
        let xml = write_chart_full(&c, &NoData, &ChartWriteOptions::default(), &pictures);
        assert!(String::from_utf8_lossy(&xml).contains(r#"<a:blip r:embed="rId7"/>"#));
        let mut part = read_chart_ext(&xml, "c").unwrap();
        assert_eq!(part.pictures, [(PictureSlot::ChartArea, "rId7".to_owned())]);
        resolve_picture_fills(&mut part, |rid| (rid == "rId7").then(|| media.clone()));
        assert_eq!(part.chart, c);
        // Without an id: no fill.
        let plain = write_chart(&c, &NoData);
        assert!(String::from_utf8_lossy(&plain).contains("<c:spPr><a:noFill/></c:spPr>"));
    }

    #[test]
    fn text_formats_and_rotation_roundtrip() {
        let tf = |size: f64, rot: Option<i32>| TextFormat {
            font: Some("Arial".into()),
            size: Some(size),
            bold: Some(true),
            italic: Some(false),
            color: Some(rgb(192, 0, 0)),
            rotation: rot,
        };
        let mut c = Chart::new(ChartKind::column());
        let mut s = series("");
        s.data_labels = Some(DataLabels {
            show_value: true,
            text_format: Some(tf(8.0, None)),
            ..DataLabels::default()
        });
        c.series = vec![s, series("0")];
        c.text_format = Some(TextFormat {
            font: Some("Calibri".into()),
            ..TextFormat::default()
        });
        c.title = Some(ChartTitle {
            text_format: Some(tf(18.0, None)),
            ..ChartTitle::literal("Sales")
        });
        c.axes.cat.text_format = Some(tf(9.0, Some(-45)));
        c.axes.cat.title = Some(ChartTitle {
            text_format: Some(tf(10.0, None)),
            ..ChartTitle::default()
        });
        c.axes.val.title = Some(ChartTitle {
            text_format: Some(tf(10.0, None)),
            ..ChartTitle::literal("Units")
        });
        c.axes.val.line = Some(LineFormat {
            color: Some(rgb(0, 0, 0)),
            ..LineFormat::default()
        });
        c.legend = Some(Legend::at(LegendPosition::Right));
        c.legend_text_format = Some(tf(11.0, None));
        assert_eq!(roundtrip(&c), c);
        let xml = String::from_utf8(write_chart(&c, &NoData)).unwrap();
        assert!(
            xml.contains(r#"<a:bodyPr rot="-2700000" vert="horz"/>"#),
            "{xml}"
        );
        assert!(xml.contains(r#"<a:defRPr sz="1800" b="1" i="0"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr>"#), "{xml}");
        // Excel's automatic rotation and theme fonts are not explicit values.
        let el = parse(
            br#"<c:txPr xmlns:c="c" xmlns:a="a"><a:bodyPr rot="-60000000" vert="horz"/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr></a:p></c:txPr>"#,
            "x",
        )
        .unwrap();
        assert_eq!(
            read_text_format(&el),
            Some(TextFormat {
                size: Some(9.0),
                ..TextFormat::default()
            })
        );
    }

    #[test]
    fn error_bars_roundtrip() {
        let line = LineFormat {
            color: Some(rgb(0, 0, 0)),
            width: Some(9525),
            ..LineFormat::default()
        };
        let amounts = [
            ErrorAmount::Fixed { value: 2.5 },
            ErrorAmount::Percentage { value: 5.0 },
            ErrorAmount::StdDev { value: 1.0 },
            ErrorAmount::StdErr,
            ErrorAmount::Custom {
                plus: Some(DataRef::reference("S!$D$2:$D$5")),
                minus: Some(DataRef::Literal {
                    values: vec![ChartValue::Number(1.0)],
                }),
            },
        ];
        for (i, amount) in amounts.into_iter().enumerate() {
            let mut c = Chart::new(ChartKind::column());
            let mut s = series("");
            s.error_bars = vec![ErrorBars {
                direction: ErrorBarDirection::Y,
                bar_type: [ErrorBarType::Both, ErrorBarType::Plus, ErrorBarType::Minus][i % 3],
                amount,
                no_end_cap: i % 2 == 1,
                line: Some(line),
            }];
            c.series = vec![s];
            assert_eq!(roundtrip(&c), c, "{i}");
        }
        // Scatter: X and Y error bars.
        let mut c = Chart::new(ChartKind::Scatter {
            style: ScatterStyle::Marker,
        });
        let mut s = series("");
        s.error_bars = vec![
            ErrorBars {
                direction: ErrorBarDirection::X,
                bar_type: ErrorBarType::Both,
                amount: ErrorAmount::Fixed { value: 1.0 },
                no_end_cap: false,
                line: None,
            },
            ErrorBars {
                direction: ErrorBarDirection::Y,
                bar_type: ErrorBarType::Plus,
                amount: ErrorAmount::Percentage { value: 10.0 },
                no_end_cap: true,
                line: None,
            },
        ];
        c.series = vec![s];
        assert_eq!(roundtrip(&c), c);
        // Error bars follow reference adjustment.
        assert!(amounts_formula_listed());
    }

    fn amounts_formula_listed() -> bool {
        let mut s = series("");
        s.error_bars = vec![ErrorBars {
            direction: ErrorBarDirection::Y,
            bar_type: ErrorBarType::Both,
            amount: ErrorAmount::Custom {
                plus: Some(DataRef::reference("S!$Z$1:$Z$4")),
                minus: None,
            },
            no_end_cap: false,
            line: None,
        }];
        let mut c = Chart::new(ChartKind::column());
        c.series = vec![s];
        c.formulas().contains(&"S!$Z$1:$Z$4")
    }

    #[test]
    fn data_table_up_down_bars_and_high_low_lines_roundtrip() {
        let mut c = Chart::new(ChartKind::Line {
            grouping: Grouping::Standard,
            markers: false,
        });
        c.series = vec![series(""), series("0")];
        c.categories = Some(DataRef::reference("S!$A$2:$A$5"));
        c.data_table = Some(DataTable {
            keys: true,
            vertical: false,
            ..DataTable::default()
        });
        c.up_down_bars = Some(UpDownBars {
            gap_width: Some(100),
            up: Some(ShapeFormat {
                fill: Some(AreaFill::Solid {
                    color: rgb(0, 176, 80),
                }),
                ..ShapeFormat::default()
            }),
            down: None,
        });
        c.high_low_lines = Some(LineFormat::default());
        assert_eq!(roundtrip(&c), c);
        let xml = String::from_utf8(write_chart(&c, &NoData)).unwrap();
        let hi = xml.find("<c:hiLowLines").unwrap();
        let ud = xml.find("<c:upDownBars").unwrap();
        let mk = xml.find("<c:marker val=\"1\"/>").unwrap();
        assert!(hi < ud && ud < mk, "schema order");
        assert!(xml.find("<c:dTable>").unwrap() > xml.find("</c:valAx>").unwrap());
    }

    #[test]
    fn manual_layouts_roundtrip() {
        let mut c = Chart::new(ChartKind::column());
        c.series = vec![series(""), series("0")];
        c.plot_layout = Some(ManualLayout {
            x: 0.1,
            y: 0.15,
            w: Some(0.7),
            h: Some(0.6),
        });
        c.title = Some(ChartTitle {
            layout: Some(ManualLayout {
                x: 0.3,
                y: 0.02,
                w: None,
                h: None,
            }),
            ..ChartTitle::literal("T")
        });
        c.legend = Some(Legend::at(LegendPosition::Right));
        c.legend_layout = Some(ManualLayout {
            x: 0.8,
            y: 0.3,
            w: Some(0.18),
            h: Some(0.4),
        });
        assert_eq!(roundtrip(&c), c);
        // Excel's factor mode (offsets from the automatic place) is automatic.
        let el = parse(
            br#"<c:layout xmlns:c="c"><c:manualLayout><c:x val="0.1"/><c:y val="0.2"/></c:manualLayout></c:layout>"#,
            "x",
        )
        .unwrap();
        assert_eq!(read_layout(&el), None);
    }

    #[test]
    fn point_labels_and_value_from_cells_roundtrip() {
        let mut c = Chart::new(ChartKind::column());
        let mut s = series("");
        s.data_labels = Some(DataLabels {
            show_value: true,
            leader_lines: true,
            show_range: true,
            range: Some(DataRef::reference("S!$D$2:$D$5")),
            points: vec![
                PointLabel {
                    idx: 1,
                    delete: true,
                    ..PointLabel::default()
                },
                PointLabel {
                    idx: 2,
                    show_value: true,
                    show_category: true,
                    position: Some(LabelPosition::InsideEnd),
                    number_format: Some("0.0".into()),
                    layout: Some(ManualLayout {
                        x: 0.5,
                        y: 0.5,
                        w: None,
                        h: None,
                    }),
                    ..PointLabel::default()
                },
            ],
            ..DataLabels::default()
        });
        c.series = vec![s];
        assert_eq!(roundtrip(&c), c);
        assert!(c.formulas().contains(&"S!$D$2:$D$5"));
    }

    #[test]
    fn colors_map_to_theme_tints() {
        let el = parse(
            br#"<a:solidFill xmlns:a="a"><a:schemeClr val="accent2"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr></a:solidFill>"#,
            "x",
        )
        .unwrap();
        assert_eq!(
            read_color(&el),
            Some(Color::Theme {
                slot: ThemeColorSlot::Accent2,
                tint: 0.4
            })
        );
        let mut x = XmlOut::fragment();
        write_color(
            &mut x,
            &Color::Theme {
                slot: ThemeColorSlot::Dark1,
                tint: -0.5,
            },
        );
        assert_eq!(
            String::from_utf8(x.finish()).unwrap(),
            r#"<a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr>"#
        );
    }
}
