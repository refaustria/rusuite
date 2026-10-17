//! Sparklines (P9-C6): the worksheet `<extLst>` entry
//! `x14:sparklineGroups` (Excel 2010, `{05C60535-…}`) ↔
//! [`model_sheet::SparklineGroup`]. The `<ext>` element is written by
//! [`sheet_ext_xml`] inside the sheet's `<extLst>` (see `write.rs`), read
//! from the captured `<extLst>` subtree by [`load`].

use engine_formula::SheetId;
use fmt_ooxml::xml::{parse_bool, El};
use model_sheet::{
    Sparkline, SparklineAxis, SparklineColors, SparklineEmpty, SparklineGroup, SparklineKind,
    Workbook,
};

use crate::a1::cell_name;
use crate::styles::{color_el, color_of_dom};
use crate::xml::{fmt_num, XmlOut};

/// The `<ext>` URI of the sparkline groups.
pub(crate) const EXT_SPARKLINES: &str = "{05C60535-1F16-4fd2-B633-F4F36F0B64E0}";
const X14_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const XM_NS: &str = "http://schemas.microsoft.com/office/excel/2006/main";

/// Whether `sheet` has sparklines (an `<ext>` to write).
pub(crate) fn has_sheet_ext(wb: &Workbook, sheet: SheetId) -> bool {
    !wb.sparkline_groups(sheet).is_empty()
}

fn axis_attr(a: SparklineAxis) -> &'static str {
    match a {
        SparklineAxis::Individual => "individual",
        SparklineAxis::Group => "group",
        SparklineAxis::Custom { .. } => "custom",
    }
}

/// The `<ext>` with the sparkline groups of `sheet` (nothing without).
pub(crate) fn sheet_ext_xml(x: &mut XmlOut, wb: &Workbook, sheet: SheetId) {
    let groups = wb.sparkline_groups(sheet);
    if groups.is_empty() {
        return;
    }
    x.start("ext", &[("uri", EXT_SPARKLINES), ("xmlns:x14", X14_NS)]);
    x.start("x14:sparklineGroups", &[("xmlns:xm", XM_NS)]);
    for g in groups {
        let weight = fmt_num(g.line_weight);
        let min = match g.min_axis {
            SparklineAxis::Custom { value } => Some(fmt_num(value)),
            _ => None,
        };
        let max = match g.max_axis {
            SparklineAxis::Custom { value } => Some(fmt_num(value)),
            _ => None,
        };
        let mut a: Vec<(&str, &str)> = Vec::new();
        if let Some(v) = &max {
            a.push(("manualMax", v));
        }
        if let Some(v) = &min {
            a.push(("manualMin", v));
        }
        if g.line_weight != 0.75 {
            a.push(("lineWeight", &weight));
        }
        match g.kind {
            SparklineKind::Line => {}
            SparklineKind::Column => a.push(("type", "column")),
            SparklineKind::WinLoss => a.push(("type", "stacked")),
        }
        if g.date_range.is_some() {
            a.push(("dateAxis", "1"));
        }
        a.push((
            "displayEmptyCellsAs",
            match g.empty_cells {
                SparklineEmpty::Gap => "gap",
                SparklineEmpty::Zero => "zero",
                SparklineEmpty::Span => "span",
            },
        ));
        for (name, on) in [
            ("markers", g.markers),
            ("high", g.high),
            ("low", g.low),
            ("first", g.first),
            ("last", g.last),
            ("negative", g.negative),
            ("displayXAxis", g.show_axis),
            ("displayHidden", g.display_hidden),
            ("rightToLeft", g.right_to_left),
        ] {
            if on {
                a.push((name, "1"));
            }
        }
        if g.min_axis != SparklineAxis::Individual {
            a.push(("minAxisType", axis_attr(g.min_axis)));
        }
        if g.max_axis != SparklineAxis::Individual {
            a.push(("maxAxisType", axis_attr(g.max_axis)));
        }
        x.start("x14:sparklineGroup", &a);
        let c = &g.colors;
        for (name, color) in [
            ("x14:colorSeries", c.series),
            ("x14:colorNegative", c.negative),
            ("x14:colorAxis", c.axis),
            ("x14:colorMarkers", c.markers),
            ("x14:colorFirst", c.first),
            ("x14:colorLast", c.last),
            ("x14:colorHigh", c.high),
            ("x14:colorLow", c.low),
        ] {
            color_el(x, name, color);
        }
        if let Some(d) = &g.date_range {
            x.text_el("xm:f", &[], d);
        }
        x.start("x14:sparklines", &[]);
        for s in &g.sparklines {
            x.start("x14:sparkline", &[]);
            x.text_el("xm:f", &[], &s.data);
            x.text_el("xm:sqref", &[], &cell_name(s.row, s.col));
            x.end("x14:sparkline");
        }
        x.end("x14:sparklines");
        x.end("x14:sparklineGroup");
    }
    x.end("x14:sparklineGroups");
    x.end("ext");
}

fn group_of(el: &El, warnings: &mut Vec<String>) -> Option<SparklineGroup> {
    let flag = |name: &str| el.attr(name).and_then(parse_bool).unwrap_or(false);
    let num = |name: &str| {
        el.attr(name)
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite())
    };
    let axis = |ty: &str, manual: &str| match el.attr(ty) {
        Some("group") => SparklineAxis::Group,
        Some("custom") => SparklineAxis::Custom {
            value: num(manual).unwrap_or(0.0),
        },
        _ => SparklineAxis::Individual,
    };
    let kind = match el.attr("type") {
        Some("column") => SparklineKind::Column,
        Some("stacked") => SparklineKind::WinLoss,
        _ => SparklineKind::Line,
    };
    let mut sparklines = Vec::new();
    for s in el
        .child("sparklines")
        .into_iter()
        .flat_map(El::elements)
        .filter(|e| e.name == "sparkline")
    {
        let data = s.child("f").map(|f| f.text().trim().to_owned());
        let at = s
            .child("sqref")
            .and_then(|q| crate::a1::parse_cell(q.text().trim()));
        match (data, at) {
            (Some(data), Some((row, col))) if !data.is_empty() => {
                sparklines.push(Sparkline { row, col, data })
            }
            _ => warnings.push("a sparkline without data or location dropped".into()),
        }
    }
    if sparklines.is_empty() {
        return None;
    }
    let defaults = SparklineColors::default();
    let color = |name: &str, d| el.child(name).and_then(color_of_dom).unwrap_or(d);
    let mut g = SparklineGroup::new(kind, sparklines);
    g.colors = SparklineColors {
        series: color("colorSeries", defaults.series),
        negative: color("colorNegative", defaults.negative),
        axis: color("colorAxis", defaults.axis),
        markers: color("colorMarkers", defaults.markers),
        first: color("colorFirst", defaults.first),
        last: color("colorLast", defaults.last),
        high: color("colorHigh", defaults.high),
        low: color("colorLow", defaults.low),
    };
    g.high = flag("high");
    g.low = flag("low");
    g.first = flag("first");
    g.last = flag("last");
    g.negative = flag("negative");
    g.markers = flag("markers");
    g.show_axis = flag("displayXAxis");
    g.display_hidden = flag("displayHidden");
    g.right_to_left = flag("rightToLeft");
    g.min_axis = axis("minAxisType", "manualMin");
    g.max_axis = axis("maxAxisType", "manualMax");
    g.line_weight = num("lineWeight").filter(|w| *w >= 0.0).unwrap_or(0.75);
    // The schema default is `zero`; Excel always writes the attribute.
    g.empty_cells = match el.attr("displayEmptyCellsAs") {
        Some("gap") => SparklineEmpty::Gap,
        Some("span") => SparklineEmpty::Span,
        _ => SparklineEmpty::Zero,
    };
    g.date_range = el
        .child("f")
        .map(|f| f.text().trim().to_owned())
        .filter(|f| !f.is_empty());
    Some(g)
}

/// Loads the sparkline groups of the captured `<extLst>` subtrees of a
/// sheet; returns warnings.
pub(crate) fn load(wb: &mut Workbook, sheet: SheetId, subtrees: &[El]) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut groups = Vec::new();
    for ext in subtrees
        .iter()
        .filter(|e| e.name == "extLst")
        .flat_map(El::elements)
    {
        for list in ext.elements().filter(|e| e.name == "sparklineGroups") {
            for g in list.elements().filter(|e| e.name == "sparklineGroup") {
                groups.extend(group_of(g, &mut warnings));
            }
        }
    }
    if groups.is_empty() {
        return warnings;
    }
    if let Err(e) = wb.set_sparkline_groups(sheet, groups) {
        warnings.push(format!("sparklines dropped ({e})"));
    }
    warnings
}
