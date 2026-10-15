//! `<conditionalFormatting>`, `<dataValidations>` and `<dxfs>` ↔ the
//! rules of [`model_sheet::condfmt`] and [`model_sheet::validation`].
//!
//! The sheet reader hands over the raw subtrees (parsed into
//! [`fmt_ooxml::xml::El`]) of `<conditionalFormatting>`, `<dataValidations>`
//! and the worksheet `<extLst>`; rules are added to the workbook one by one
//! so that a rule the model rejects is dropped with a warning instead of
//! failing the file. Excel 2010 conditional formatting extensions
//! (`x14:conditionalFormattings`) are dropped with a warning; x14 data
//! validations (Excel writes list sources on other sheets there) are read
//! like standard ones and written back as standard `<dataValidation>`s.

use core_model::Color;
use engine_formula::SheetId;
use fmt_ooxml::xml::{parse_bool, El};
use model_sheet::numfmt::{builtin_code, builtin_id};
use model_sheet::{
    BorderSide, BorderStyle, Borders, CellRect, CfKind, CfRule, CfValue, ColorPoint, CompareOp,
    DataValidation, DxfStyle, ErrorStyle, IconSetKind, ListSource, ValidationKind, Workbook,
};
use quick_xml::events::BytesStart;

use crate::a1::{cell_name, parse_range, range_name};
use crate::styles::color_el;
use crate::xlfn::{add_xlfn_prefixes, strip_xlfn_prefixes};
use crate::xml::XmlOut;
use crate::Result;

// --- subtrees --------------------------------------------------------------------

/// Parses a captured element (`el` is its start tag, `inner` the bytes
/// between start and end tag) into a DOM.
pub(crate) fn subtree(el: &BytesStart<'_>, inner: &[u8], part: &str) -> Result<El> {
    let name = el.name();
    let mut xml = Vec::with_capacity(inner.len() + 2 * el.len() + 8);
    xml.push(b'<');
    xml.extend_from_slice(el.as_bytes());
    xml.push(b'>');
    xml.extend_from_slice(inner);
    xml.extend_from_slice(b"</");
    xml.extend_from_slice(name.as_ref().as_bytes());
    xml.push(b'>');
    fmt_ooxml::xml::parse(&xml, part).map_err(crate::xml::xml_error)
}

fn flag(el: &El, name: &str) -> Option<bool> {
    el.attr(name).and_then(parse_bool)
}

fn num<T: std::str::FromStr>(el: &El, name: &str) -> Option<T> {
    el.attr(name).and_then(|v| v.trim().parse().ok())
}

/// The text of a `<formula>`/`<formula1>` child (also the x14 form with
/// an `<xm:f>` child), `_xlfn.` prefixes stripped.
fn formula_text(el: &El) -> String {
    let text = match el.child("f") {
        Some(f) => f.text(),
        None => el.text(),
    };
    strip_xlfn_prefixes(text.trim())
}

/// `sqref` (space-separated A1 ranges); `None` if any part is malformed.
fn sqref(s: &str) -> Option<Vec<CellRect>> {
    let ranges: Option<Vec<CellRect>> = s
        .split_whitespace()
        .map(|r| {
            let (r0, c0, r1, c1) = parse_range(r)?;
            Some(CellRect { r0, c0, r1, c1 })
        })
        .collect();
    ranges.filter(|r| !r.is_empty())
}

fn sqref_text(ranges: &[CellRect]) -> String {
    ranges
        .iter()
        .map(|r| range_name(r.r0, r.c0, r.r1, r.c1))
        .collect::<Vec<_>>()
        .join(" ")
}

// --- dxfs ------------------------------------------------------------------------

fn border_style_of(v: &str) -> Option<BorderStyle> {
    Some(match v {
        "thin" => BorderStyle::Thin,
        "medium" => BorderStyle::Medium,
        "thick" => BorderStyle::Thick,
        "dotted" => BorderStyle::Dotted,
        "double" => BorderStyle::Double,
        "hair" => BorderStyle::Hair,
        "none" => return None,
        _ => BorderStyle::Dashed,
    })
}

fn border_style_name(s: BorderStyle) -> &'static str {
    match s {
        BorderStyle::Thin => "thin",
        BorderStyle::Medium => "medium",
        BorderStyle::Thick => "thick",
        BorderStyle::Dashed => "dashed",
        BorderStyle::Dotted => "dotted",
        BorderStyle::Double => "double",
        BorderStyle::Hair => "hair",
    }
}

/// Parses `<dxfs>`; `color` resolves a `CT_Color` element.
pub(crate) fn parse_dxfs(dxfs: &El, color: &dyn Fn(&El) -> Option<Color>) -> Vec<DxfStyle> {
    dxfs.elements()
        .filter(|e| e.name == "dxf")
        .map(|dxf| {
            let mut d = DxfStyle::default();
            if let Some(font) = dxf.child("font") {
                for e in font.elements() {
                    let on = || flag(e, "val").unwrap_or(true);
                    match e.name.as_str() {
                        "b" => d.bold = Some(on()),
                        "i" => d.italic = Some(on()),
                        "strike" => d.strike = Some(on()),
                        "u" => d.underline = Some(e.attr("val") != Some("none")),
                        "color" => d.font_color = color(e),
                        _ => {}
                    }
                }
            }
            if let Some(nf) = dxf.child("numFmt") {
                d.number_format = nf.attr("formatCode").map(str::to_owned).or_else(|| {
                    num::<u16>(nf, "numFmtId")
                        .and_then(builtin_code)
                        .map(str::to_owned)
                });
            }
            if let Some(p) = dxf.child("fill").and_then(|f| f.child("patternFill")) {
                if p.attr("patternType") != Some("none") {
                    d.fill = p
                        .child("bgColor")
                        .or_else(|| p.child("fgColor"))
                        .and_then(color);
                }
            }
            if let Some(b) = dxf.child("border") {
                let side = |names: &[&str]| -> Option<BorderSide> {
                    let e = b.elements().find(|e| names.contains(&e.name.as_str()))?;
                    Some(BorderSide {
                        style: border_style_of(e.attr("style")?)?,
                        color: e.child("color").and_then(color).unwrap_or(Color::Auto),
                    })
                };
                d.borders = Borders {
                    left: side(&["left", "start"]),
                    right: side(&["right", "end"]),
                    top: side(&["top"]),
                    bottom: side(&["bottom"]),
                };
            }
            d
        })
        .collect()
}

/// Every distinct dxf of the workbook's rules, in first-use order.
pub(crate) fn collect_dxfs(wb: &Workbook) -> Vec<DxfStyle> {
    let mut out: Vec<DxfStyle> = Vec::new();
    for (id, _) in wb.sheets() {
        for rule in wb.cf_rules(id) {
            if let Some(d) = rule.dxf.as_ref() {
                if !out.contains(d) {
                    out.push(d.clone());
                }
            }
        }
    }
    out
}

/// First number format id used for dxf-only custom formats (well above
/// the cell formats, which start at 164).
const DXF_NUMFMT_BASE: usize = 1000;

/// `<dxfs count>` with one `<dxf>` per entry.
pub(crate) fn write_dxfs(x: &mut XmlOut, dxfs: &[DxfStyle]) {
    if dxfs.is_empty() {
        x.empty("dxfs", &[("count", "0")]);
        return;
    }
    x.start("dxfs", &[("count", &dxfs.len().to_string())]);
    for (i, d) in dxfs.iter().enumerate() {
        x.start("dxf", &[]);
        let has_font = d.bold.is_some()
            || d.italic.is_some()
            || d.strike.is_some()
            || d.underline.is_some()
            || d.font_color.is_some();
        if has_font {
            x.start("font", &[]);
            let toggle = |x: &mut XmlOut, name: &str, v: Option<bool>| match v {
                Some(true) => x.empty(name, &[]),
                Some(false) => x.empty(name, &[("val", "0")]),
                None => {}
            };
            toggle(x, "b", d.bold);
            toggle(x, "i", d.italic);
            toggle(x, "strike", d.strike);
            match d.underline {
                Some(true) => x.empty("u", &[]),
                Some(false) => x.empty("u", &[("val", "none")]),
                None => {}
            }
            if let Some(c) = d.font_color {
                color_el(x, "color", c);
            }
            x.end("font");
        }
        if let Some(code) = &d.number_format {
            let id = builtin_id(code).map_or(DXF_NUMFMT_BASE + i, usize::from);
            x.empty(
                "numFmt",
                &[("numFmtId", &id.to_string()), ("formatCode", code)],
            );
        }
        if let Some(c) = d.fill {
            x.start("fill", &[]);
            x.start("patternFill", &[]);
            color_el(x, "bgColor", c);
            x.end("patternFill");
            x.end("fill");
        }
        if !d.borders.is_default() {
            x.start("border", &[]);
            let b = &d.borders;
            for (name, side) in [
                ("left", b.left),
                ("right", b.right),
                ("top", b.top),
                ("bottom", b.bottom),
            ] {
                if let Some(s) = side {
                    x.start(name, &[("style", border_style_name(s.style))]);
                    color_el(x, "color", s.color);
                    x.end(name);
                }
            }
            x.end("border");
        }
        x.end("dxf");
    }
    x.end("dxfs");
}

// --- reading rules ---------------------------------------------------------------

fn cfvo(el: &El) -> Option<CfValue> {
    let val = || el.attr("val").unwrap_or("0").trim().to_owned();
    Some(match el.attr("type")? {
        "min" | "autoMin" => CfValue::Min,
        "max" | "autoMax" => CfValue::Max,
        "num" => CfValue::Num(strip_xlfn_prefixes(&val())),
        "percent" => CfValue::Percent(strip_xlfn_prefixes(&val())),
        "percentile" => CfValue::Percentile(strip_xlfn_prefixes(&val())),
        "formula" => CfValue::Formula(strip_xlfn_prefixes(&val())),
        _ => return None,
    })
}

/// One `<cfRule>` (without ranges); `Err` is the reason it is dropped.
fn cf_rule(
    el: &El,
    dxfs: &[DxfStyle],
    notes: &mut Vec<String>,
) -> std::result::Result<CfRule, String> {
    let ty = el.attr("type").unwrap_or("");
    let formulas: Vec<String> = el
        .elements()
        .filter(|e| e.name == "formula")
        .map(formula_text)
        .collect();
    let text = || {
        el.attr("text")
            .map(str::to_owned)
            .ok_or_else(|| format!("{ty} rule without text"))
    };
    let colors = |p: &El| -> Vec<Option<Color>> {
        p.elements()
            .filter(|e| e.name == "color")
            .map(crate::styles::color_of_dom)
            .collect()
    };
    let cfvos = |p: &El| -> Option<Vec<CfValue>> {
        p.elements()
            .filter(|e| e.name == "cfvo")
            .map(cfvo)
            .collect()
    };
    let kind = match ty {
        "cellIs" => {
            let op = el
                .attr("operator")
                .and_then(CompareOp::from_name)
                .ok_or("cellIs rule with an unknown operator")?;
            CfKind::CellIs { op, formulas }
        }
        "expression" => CfKind::Expression {
            formula: formulas
                .into_iter()
                .next()
                .ok_or("expression without formula")?,
        },
        "containsText" => CfKind::ContainsText { text: text()? },
        "notContainsText" => CfKind::NotContainsText { text: text()? },
        "beginsWith" => CfKind::BeginsWith { text: text()? },
        "endsWith" => CfKind::EndsWith { text: text()? },
        "containsBlanks" => CfKind::ContainsBlanks,
        "notContainsBlanks" => CfKind::NotContainsBlanks,
        "containsErrors" => CfKind::ContainsErrors,
        "notContainsErrors" => CfKind::NotContainsErrors,
        "top10" => CfKind::Top10 {
            rank: num(el, "rank").unwrap_or(10),
            percent: flag(el, "percent").unwrap_or(false),
            bottom: flag(el, "bottom").unwrap_or(false),
        },
        "aboveAverage" => {
            if el.attr("stdDev").is_some() {
                notes.push("standard deviation of an above/below average rule ignored".into());
            }
            CfKind::AboveAverage {
                above: flag(el, "aboveAverage").unwrap_or(true),
                equal: flag(el, "equalAverage").unwrap_or(false),
            }
        }
        "duplicateValues" => CfKind::DuplicateValues,
        "uniqueValues" => CfKind::UniqueValues,
        "dataBar" => {
            let bar = el
                .child("dataBar")
                .ok_or("dataBar rule without <dataBar>")?;
            let v = cfvos(bar)
                .filter(|v| v.len() == 2)
                .ok_or("data bar thresholds")?;
            let color = colors(bar)
                .into_iter()
                .next()
                .flatten()
                .ok_or("data bar without colour")?;
            let mut v = v.into_iter();
            CfKind::DataBar {
                min: v.next().ok_or("data bar thresholds")?,
                max: v.next().ok_or("data bar thresholds")?,
                color,
                show_value: flag(bar, "showValue").unwrap_or(true),
            }
        }
        "colorScale" => {
            let scale = el
                .child("colorScale")
                .ok_or("colorScale rule without <colorScale>")?;
            let values = cfvos(scale).ok_or("colour scale thresholds")?;
            let cols = colors(scale);
            if values.len() != cols.len() {
                return Err("colour scale with mismatched thresholds and colours".into());
            }
            let points = values
                .into_iter()
                .zip(cols)
                .map(|(value, color)| {
                    Some(ColorPoint {
                        value,
                        color: color?,
                    })
                })
                .collect::<Option<Vec<_>>>()
                .ok_or("colour scale colour")?;
            CfKind::ColorScale { points }
        }
        "iconSet" => {
            let set_el = el
                .child("iconSet")
                .ok_or("iconSet rule without <iconSet>")?;
            let name = set_el.attr("iconSet").unwrap_or("3TrafficLights1");
            let set = IconSetKind::from_name(name).ok_or_else(|| format!("icon set {name}"))?;
            if set_el.elements().any(|e| flag(e, "gte") == Some(false)) {
                notes.push("icon set threshold \"greater than\" read as \">=\"".into());
            }
            CfKind::IconSet {
                set,
                thresholds: cfvos(set_el).ok_or("icon set thresholds")?,
                reverse: flag(set_el, "reverse").unwrap_or(false),
                show_value: flag(set_el, "showValue").unwrap_or(true),
            }
        }
        other => return Err(format!("rule type {other:?}")),
    };
    let dxf = match num::<usize>(el, "dxfId") {
        Some(i) => Some(dxfs.get(i).cloned().ok_or("unknown dxfId")?),
        None => None,
    };
    Ok(CfRule {
        priority: num(el, "priority").unwrap_or(u32::MAX),
        stop_if_true: flag(el, "stopIfTrue").unwrap_or(false),
        dxf,
        ..CfRule::new(kind)
    })
}

fn error_style_of(v: Option<&str>) -> ErrorStyle {
    match v {
        Some("warning") => ErrorStyle::Warning,
        Some("information") => ErrorStyle::Information,
        _ => ErrorStyle::Stop,
    }
}

/// `"a,b,""c"""` → `["a", "b", "\"c\""]`.
fn literal_list(f: &str) -> Option<Vec<String>> {
    let inner = f.strip_prefix('"')?.strip_suffix('"')?;
    Some(
        inner
            .replace("\"\"", "\"")
            .split(',')
            .map(str::to_owned)
            .collect(),
    )
}

/// One `<dataValidation>` (standard or x14).
fn data_validation(el: &El) -> std::result::Result<DataValidation, String> {
    let ranges = el
        .attr("sqref")
        .map(str::to_owned)
        .or_else(|| el.child("sqref").map(El::text))
        .as_deref()
        .and_then(sqref)
        .ok_or("data validation without a valid sqref")?;
    let f = |name: &str| el.child(name).map(formula_text).filter(|t| !t.is_empty());
    let op = el
        .attr("operator")
        .map_or(Some(CompareOp::Between), CompareOp::from_name)
        .ok_or("unknown operator")?;
    let compare = || -> std::result::Result<(CompareOp, String, Option<String>), String> {
        let f1 = f("formula1").ok_or("formula1 missing")?;
        let f2 = if op.needs_two() {
            Some(f("formula2").ok_or("formula2 missing")?)
        } else {
            None
        };
        Ok((op, f1, f2))
    };
    let kind = match el.attr("type").unwrap_or("none") {
        "none" => ValidationKind::Any,
        "list" => {
            let f1 = f("formula1").ok_or("list without source")?;
            ValidationKind::List {
                source: match literal_list(&f1) {
                    Some(values) => ListSource::Literal { values },
                    None => ListSource::Formula { formula: f1 },
                },
            }
        }
        "whole" => {
            let (op, f1, f2) = compare()?;
            ValidationKind::Whole { op, f1, f2 }
        }
        "decimal" => {
            let (op, f1, f2) = compare()?;
            ValidationKind::Decimal { op, f1, f2 }
        }
        "date" => {
            let (op, f1, f2) = compare()?;
            ValidationKind::Date { op, f1, f2 }
        }
        "time" => {
            let (op, f1, f2) = compare()?;
            ValidationKind::Time { op, f1, f2 }
        }
        "textLength" => {
            let (op, f1, f2) = compare()?;
            ValidationKind::TextLength { op, f1, f2 }
        }
        "custom" => ValidationKind::Custom {
            formula: f("formula1").ok_or("custom validation without formula")?,
        },
        other => return Err(format!("type {other:?}")),
    };
    let text = |name: &str| el.attr(name).filter(|t| !t.is_empty()).map(str::to_owned);
    Ok(DataValidation {
        ranges,
        kind,
        allow_blank: flag(el, "allowBlank").unwrap_or(false),
        // `showDropDown="1"` *hides* the in-cell dropdown.
        show_dropdown: !flag(el, "showDropDown").unwrap_or(false),
        show_input: flag(el, "showInputMessage").unwrap_or(false),
        show_error: flag(el, "showErrorMessage").unwrap_or(false),
        input_title: text("promptTitle"),
        input_message: text("prompt"),
        error_title: text("errorTitle"),
        error_message: text("error"),
        error_style: error_style_of(el.attr("errorStyle")),
    })
}

/// Loads the captured `<conditionalFormatting>`, `<dataValidations>` and
/// `<extLst>` subtrees of one sheet into the workbook; returns warnings.
pub(crate) fn load(
    wb: &mut Workbook,
    sheet: SheetId,
    subtrees: &[El],
    dxfs: &[DxfStyle],
) -> Result<Vec<String>> {
    let mut warnings: Vec<String> = Vec::new();
    let mut rules: Vec<(u32, usize, CfRule)> = Vec::new();
    let mut validations: Vec<DataValidation> = Vec::new();
    let dv_error = |e: String, warnings: &mut Vec<String>| {
        warnings.push(format!("data validation dropped ({e})"));
    };
    for el in subtrees {
        match el.name.as_str() {
            "conditionalFormatting" => {
                let ranges = el.attr("sqref").and_then(sqref);
                for r in el.elements().filter(|e| e.name == "cfRule") {
                    let mut notes = Vec::new();
                    match (cf_rule(r, dxfs, &mut notes), &ranges) {
                        (Ok(rule), Some(ranges)) => {
                            let order = rules.len();
                            rules.push((
                                rule.priority,
                                order,
                                CfRule {
                                    ranges: ranges.clone(),
                                    ..rule
                                },
                            ));
                        }
                        (Ok(_), None) => warnings
                            .push("conditional formatting without a valid sqref dropped".into()),
                        (Err(e), _) => {
                            warnings.push(format!("conditional formatting rule dropped ({e})"))
                        }
                    }
                    for n in notes {
                        warnings.push(format!("conditional formatting: {n}"));
                    }
                }
            }
            "dataValidations" => {
                for d in el.elements().filter(|e| e.name == "dataValidation") {
                    match data_validation(d) {
                        Ok(dv) => validations.push(dv),
                        Err(e) => dv_error(e, &mut warnings),
                    }
                }
            }
            "extLst" => {
                for ext in el.elements() {
                    for part in ext.elements() {
                        match part.name.as_str() {
                            "conditionalFormattings" => {
                                let n = part
                                    .elements()
                                    .flat_map(El::elements)
                                    .filter(|e| e.name == "cfRule")
                                    .count();
                                warnings.push(format!(
                                    "{n} Excel 2010 conditional formatting extension(s) (x14) dropped"
                                ));
                            }
                            "dataValidations" => {
                                let mut read = 0;
                                for d in part.elements().filter(|e| e.name == "dataValidation") {
                                    match data_validation(d) {
                                        Ok(dv) => {
                                            read += 1;
                                            validations.push(dv);
                                        }
                                        Err(e) => dv_error(e, &mut warnings),
                                    }
                                }
                                if read > 0 {
                                    warnings.push(format!(
                                        "{read} Excel 2010 data validation(s) (x14) read; saved as standard data validation"
                                    ));
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }
    rules.sort_by_key(|(p, order, _)| (*p, *order));
    for (_, _, rule) in rules {
        let rule = CfRule {
            priority: u32::MAX,
            ..rule
        };
        if let Err(e) = wb.add_cf_rule(sheet, rule) {
            warnings.push(format!("conditional formatting rule dropped ({e})"));
        }
    }
    for dv in validations {
        if let Err(e) = wb.set_validation(sheet, dv) {
            warnings.push(format!("data validation dropped ({e})"));
        }
    }
    Ok(warnings)
}

// --- writing rules ---------------------------------------------------------------

fn quote(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

fn cfvo_xml(x: &mut XmlOut, v: &CfValue) {
    let (ty, val) = match v {
        CfValue::Min => ("min", None),
        CfValue::Max => ("max", None),
        CfValue::Num(s) => ("num", Some(s)),
        CfValue::Percent(s) => ("percent", Some(s)),
        CfValue::Percentile(s) => ("percentile", Some(s)),
        CfValue::Formula(s) => ("formula", Some(s)),
    };
    match val {
        Some(v) => x.empty("cfvo", &[("type", ty), ("val", &add_xlfn_prefixes(v))]),
        None => x.empty("cfvo", &[("type", ty)]),
    }
}

/// One `<conditionalFormatting>` per rule.
fn write_rule(x: &mut XmlOut, rule: &CfRule, dxfs: &[DxfStyle]) {
    let Some((ar, ac)) = rule
        .ranges
        .iter()
        .map(|r| r.r0)
        .min()
        .zip(rule.ranges.iter().map(|r| r.c0).min())
    else {
        return;
    };
    let cell = cell_name(ar, ac);
    let mut a: Vec<(&str, String)> = Vec::new();
    let mut formulas: Vec<String> = Vec::new();
    let ty = match &rule.kind {
        CfKind::CellIs { op, formulas: f } => {
            a.push(("operator", op.name().into()));
            formulas.extend(f.iter().cloned());
            "cellIs"
        }
        CfKind::Expression { formula } => {
            formulas.push(formula.clone());
            "expression"
        }
        CfKind::ContainsText { text } => {
            a.push(("operator", "containsText".into()));
            a.push(("text", text.clone()));
            formulas.push(format!("NOT(ISERROR(SEARCH({},{cell})))", quote(text)));
            "containsText"
        }
        CfKind::NotContainsText { text } => {
            a.push(("operator", "notContains".into()));
            a.push(("text", text.clone()));
            formulas.push(format!("ISERROR(SEARCH({},{cell}))", quote(text)));
            "notContainsText"
        }
        CfKind::BeginsWith { text } => {
            a.push(("operator", "beginsWith".into()));
            a.push(("text", text.clone()));
            let q = quote(text);
            formulas.push(format!("LEFT({cell},LEN({q}))={q}"));
            "beginsWith"
        }
        CfKind::EndsWith { text } => {
            a.push(("operator", "endsWith".into()));
            a.push(("text", text.clone()));
            let q = quote(text);
            formulas.push(format!("RIGHT({cell},LEN({q}))={q}"));
            "endsWith"
        }
        CfKind::ContainsBlanks => {
            formulas.push(format!("LEN(TRIM({cell}))=0"));
            "containsBlanks"
        }
        CfKind::NotContainsBlanks => {
            formulas.push(format!("LEN(TRIM({cell}))>0"));
            "notContainsBlanks"
        }
        CfKind::ContainsErrors => {
            formulas.push(format!("ISERROR({cell})"));
            "containsErrors"
        }
        CfKind::NotContainsErrors => {
            formulas.push(format!("NOT(ISERROR({cell}))"));
            "notContainsErrors"
        }
        CfKind::Top10 {
            rank,
            percent,
            bottom,
        } => {
            if *percent {
                a.push(("percent", "1".into()));
            }
            if *bottom {
                a.push(("bottom", "1".into()));
            }
            a.push(("rank", rank.to_string()));
            "top10"
        }
        CfKind::AboveAverage { above, equal } => {
            if !above {
                a.push(("aboveAverage", "0".into()));
            }
            if *equal {
                a.push(("equalAverage", "1".into()));
            }
            "aboveAverage"
        }
        CfKind::DuplicateValues => "duplicateValues",
        CfKind::UniqueValues => "uniqueValues",
        CfKind::DataBar { .. } => "dataBar",
        CfKind::ColorScale { .. } => "colorScale",
        CfKind::IconSet { .. } => "iconSet",
    };
    let dxf = rule
        .dxf
        .as_ref()
        .filter(|_| rule.kind.is_highlight())
        .and_then(|d| dxfs.iter().position(|x| x == d))
        .map(|i| i.to_string());
    let priority = rule.priority.max(1).to_string();
    let mut attrs: Vec<(&str, &str)> = vec![("type", ty)];
    if let Some(d) = &dxf {
        attrs.push(("dxfId", d));
    }
    attrs.push(("priority", &priority));
    if rule.stop_if_true {
        attrs.push(("stopIfTrue", "1"));
    }
    attrs.extend(a.iter().map(|(k, v)| (*k, v.as_str())));
    x.start(
        "conditionalFormatting",
        &[("sqref", &sqref_text(&rule.ranges))],
    );
    if formulas.is_empty() && rule.kind.is_highlight() {
        x.empty("cfRule", &attrs);
        x.end("conditionalFormatting");
        return;
    }
    x.start("cfRule", &attrs);
    for f in &formulas {
        x.text_el("formula", &[], &add_xlfn_prefixes(f));
    }
    match &rule.kind {
        CfKind::DataBar {
            color,
            min,
            max,
            show_value,
        } => {
            let a: &[(&str, &str)] = if *show_value {
                &[]
            } else {
                &[("showValue", "0")]
            };
            x.start("dataBar", a);
            cfvo_xml(x, min);
            cfvo_xml(x, max);
            color_el(x, "color", *color);
            x.end("dataBar");
        }
        CfKind::ColorScale { points } => {
            x.start("colorScale", &[]);
            for p in points {
                cfvo_xml(x, &p.value);
            }
            for p in points {
                color_el(x, "color", p.color);
            }
            x.end("colorScale");
        }
        CfKind::IconSet {
            set,
            thresholds,
            reverse,
            show_value,
        } => {
            let mut a: Vec<(&str, &str)> = vec![("iconSet", set.name())];
            if *reverse {
                a.push(("reverse", "1"));
            }
            if !show_value {
                a.push(("showValue", "0"));
            }
            x.start("iconSet", &a);
            for t in thresholds {
                cfvo_xml(x, t);
            }
            x.end("iconSet");
        }
        _ => {}
    }
    x.end("cfRule");
    x.end("conditionalFormatting");
}

fn write_validation(x: &mut XmlOut, dv: &DataValidation) {
    let (ty, op, f1, f2) = match &dv.kind {
        ValidationKind::Any => (None, None, None, None),
        ValidationKind::List { source } => {
            let f1 = match source {
                ListSource::Formula { formula } => formula.clone(),
                ListSource::Literal { values } => quote(&values.join(",")),
            };
            (Some("list"), None, Some(f1), None)
        }
        ValidationKind::Whole { op, f1, f2 } => {
            (Some("whole"), Some(*op), Some(f1.clone()), f2.clone())
        }
        ValidationKind::Decimal { op, f1, f2 } => {
            (Some("decimal"), Some(*op), Some(f1.clone()), f2.clone())
        }
        ValidationKind::Date { op, f1, f2 } => {
            (Some("date"), Some(*op), Some(f1.clone()), f2.clone())
        }
        ValidationKind::Time { op, f1, f2 } => {
            (Some("time"), Some(*op), Some(f1.clone()), f2.clone())
        }
        ValidationKind::TextLength { op, f1, f2 } => {
            (Some("textLength"), Some(*op), Some(f1.clone()), f2.clone())
        }
        ValidationKind::Custom { formula } => (Some("custom"), None, Some(formula.clone()), None),
    };
    let mut a: Vec<(&str, &str)> = Vec::new();
    if let Some(t) = ty {
        a.push(("type", t));
    }
    match dv.error_style {
        ErrorStyle::Stop => {}
        ErrorStyle::Warning => a.push(("errorStyle", "warning")),
        ErrorStyle::Information => a.push(("errorStyle", "information")),
    }
    if let Some(op) = op.filter(|o| *o != CompareOp::Between) {
        a.push(("operator", op.name()));
    }
    for (name, on) in [
        ("allowBlank", dv.allow_blank),
        ("showDropDown", !dv.show_dropdown),
        ("showInputMessage", dv.show_input),
        ("showErrorMessage", dv.show_error),
    ] {
        if on {
            a.push((name, "1"));
        }
    }
    for (name, text) in [
        ("errorTitle", &dv.error_title),
        ("error", &dv.error_message),
        ("promptTitle", &dv.input_title),
        ("prompt", &dv.input_message),
    ] {
        if let Some(t) = text {
            a.push((name, t));
        }
    }
    let sq = sqref_text(&dv.ranges);
    a.push(("sqref", &sq));
    if f1.is_none() {
        x.empty("dataValidation", &a);
        return;
    }
    x.start("dataValidation", &a);
    if let Some(f) = f1 {
        x.text_el("formula1", &[], &add_xlfn_prefixes(&f));
    }
    if let Some(f) = f2 {
        x.text_el("formula2", &[], &add_xlfn_prefixes(&f));
    }
    x.end("dataValidation");
}

/// `<conditionalFormatting>`s and `<dataValidations>` of a sheet (between
/// `<mergeCells>` and `<pageMargins>`).
pub(crate) fn write_sheet_rules(x: &mut XmlOut, wb: &Workbook, sheet: SheetId, dxfs: &[DxfStyle]) {
    for rule in wb.cf_rules(sheet) {
        write_rule(x, rule, dxfs);
    }
    let dvs = wb.validations(sheet);
    if !dvs.is_empty() {
        x.start("dataValidations", &[("count", &dvs.len().to_string())]);
        for dv in dvs {
            write_validation(x, dv);
        }
        x.end("dataValidations");
    }
}
