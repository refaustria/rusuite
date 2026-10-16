//! Worksheet drawings with charts: `xl/drawings/drawingN.xml`
//! (`xdr:wsDr` anchors) and the chart parts they reference
//! (`xl/charts/chartN.xml`, read and written by [`fmt_ooxml::chart`]).
//!
//! Only chart graphic frames are modelled; pictures, shapes, groups and
//! other graphic frames in a drawing are dropped with a warning.

use std::collections::BTreeSet;

use core_model::chart::{Chart, DataRef, TextSource};
use engine_formula::SheetId;
use fmt_ooxml::chart::{read_chart, write_chart, ChartData, RefData, CHART_NS, DRAWINGML_NS};
use fmt_ooxml::xml::{parse, parse_i64, El};
use fmt_ooxml::{ct, rel, Package, PartName, Relationships, TargetMode};
use model_sheet::{CellOffset, ChartAnchor, ChartObject, Workbook};

use crate::xml::{xml_error, XmlOut};
use crate::Result;

/// The SpreadsheetML drawing namespace (`xdr:`).
pub(crate) const XDR_NS: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

fn int(el: &El, name: &str) -> i64 {
    el.child(name)
        .and_then(|c| parse_i64(&c.text()))
        .unwrap_or(0)
}

fn cell_offset(el: &El) -> CellOffset {
    let idx = |name| u32::try_from(int(el, name).max(0)).unwrap_or(0);
    CellOffset {
        col: idx("col").min(engine_formula::ast::MAX_COL),
        row: idx("row").min(engine_formula::ast::MAX_ROW),
        col_offset: int(el, "colOff").max(0),
        row_offset: int(el, "rowOff").max(0),
    }
}

fn ext(el: &El) -> (i64, i64) {
    let e = el.child("ext");
    let v = |a| {
        e.and_then(|e| e.attr(a))
            .and_then(parse_i64)
            .unwrap_or(0)
            .max(0)
    };
    (v("cx"), v("cy"))
}

/// Removes caches of references that resolve in the workbook (Calc
/// recomputes them); caches of unresolvable references stay.
fn drop_resolvable_caches(chart: &mut Chart, wb: &Workbook, host: SheetId) {
    let resolves = |f: &str| wb.resolve_ref(f, host, false).is_some();
    let data = |d: &mut DataRef| {
        if let DataRef::Ref { formula, cache } = d {
            if resolves(formula) {
                *cache = None;
            }
        }
    };
    let text = |t: &mut TextSource| {
        if let TextSource::Ref { formula, cache } = t {
            if resolves(formula) {
                *cache = None;
            }
        }
    };
    let title = |t: &mut Option<core_model::chart::ChartTitle>| {
        if let Some(src) = t.as_mut().and_then(|t| t.text.as_mut()) {
            text(src);
        }
    };
    title(&mut chart.title);
    title(&mut chart.axes.cat.title);
    title(&mut chart.axes.val.title);
    if let Some(a) = chart.axes.second_val.as_mut() {
        title(&mut a.title);
    }
    if let Some(c) = chart.categories.as_mut() {
        data(c);
    }
    for s in &mut chart.series {
        data(&mut s.values);
        if let Some(c) = s.categories.as_mut() {
            data(c);
        }
        if let Some(n) = s.name.as_mut() {
            text(n);
        }
    }
}

/// Reads the drawing `drawing` of `sheet` and adds its charts. Marks the
/// parts read in `consumed`; returns warnings.
pub(crate) fn load(
    pkg: &Package,
    wb: &mut Workbook,
    sheet: SheetId,
    drawing: &PartName,
    consumed: &mut BTreeSet<PartName>,
) -> Result<Vec<String>> {
    let mut warnings = Vec::new();
    let Some(part) = pkg.part(drawing) else {
        warnings.push(format!("drawing {drawing} is missing"));
        return Ok(warnings);
    };
    consumed.insert(drawing.clone());
    let root = parse(&part.data, drawing.as_str()).map_err(xml_error)?;
    let rels = pkg.relationships(drawing);
    let mut dropped: BTreeSet<&'static str> = BTreeSet::new();
    let mut charts: Vec<ChartObject> = Vec::new();
    for anchor_el in root.elements() {
        let anchor = match anchor_el.name.as_str() {
            "twoCellAnchor" => {
                let (Some(from), Some(to)) = (anchor_el.child("from"), anchor_el.child("to"))
                else {
                    continue;
                };
                ChartAnchor::TwoCell {
                    from: cell_offset(from),
                    to: cell_offset(to),
                }
            }
            "oneCellAnchor" => {
                let Some(from) = anchor_el.child("from") else {
                    continue;
                };
                let (width, height) = ext(anchor_el);
                ChartAnchor::OneCell {
                    from: cell_offset(from),
                    width,
                    height,
                }
            }
            "absoluteAnchor" => {
                let pos = anchor_el.child("pos");
                let p = |a| pos.and_then(|p| p.attr(a)).and_then(parse_i64).unwrap_or(0);
                let (width, height) = ext(anchor_el);
                ChartAnchor::Absolute {
                    x: p("x"),
                    y: p("y"),
                    width,
                    height,
                }
            }
            _ => continue,
        };
        for obj in anchor_el.elements() {
            match obj.name.as_str() {
                "from" | "to" | "ext" | "pos" | "clientData" => {}
                "graphicFrame" => {
                    let Some(rid) = obj.find("chart").and_then(|c| c.attr("id")) else {
                        dropped.insert("graphic frames (SmartArt, tables, …)");
                        continue;
                    };
                    let target = rels
                        .and_then(|r| r.get(rid))
                        .filter(|r| r.target_mode == TargetMode::Internal)
                        .and_then(|r| drawing.resolve(&r.target).ok());
                    let Some(chart_part) = target.filter(|t| pkg.part(t).is_some()) else {
                        warnings.push(format!("chart {rid} of {drawing} is missing"));
                        continue;
                    };
                    let data = &pkg.part(&chart_part).expect("checked").data;
                    let (mut chart, w) =
                        read_chart(data, chart_part.as_str()).map_err(xml_error)?;
                    warnings.extend(w.into_iter().map(|w| format!("{chart_part}: {w}")));
                    consumed.insert(chart_part.clone());
                    // Office 2013 style and color parts are cosmetic.
                    if let Some(r) = pkg.relationships(&chart_part) {
                        for rl in r.iter() {
                            if rl.rel_type == rel::CHART_STYLE
                                || rl.rel_type == rel::CHART_COLOR_STYLE
                            {
                                if let Ok(p) = chart_part.resolve(&rl.target) {
                                    consumed.insert(p);
                                }
                            }
                        }
                    }
                    drop_resolvable_caches(&mut chart, wb, sheet);
                    let name = obj
                        .find("cNvPr")
                        .and_then(|c| c.attr("name"))
                        .unwrap_or_default()
                        .to_owned();
                    charts.push(ChartObject {
                        id: charts.len() as u32 + 1,
                        name,
                        anchor,
                        chart,
                    });
                }
                "pic" => {
                    dropped.insert("pictures");
                }
                "sp" | "cxnSp" => {
                    dropped.insert("shapes");
                }
                "grpSp" => {
                    dropped.insert("shape groups");
                }
                _ => {
                    dropped.insert("drawing objects");
                }
            }
        }
    }
    for what in dropped {
        warnings.push(format!("{what} dropped"));
    }
    if let Err(e) = wb.set_charts(sheet, charts) {
        warnings.push(format!("charts dropped: {e}"));
    }
    Ok(warnings)
}

/// Resolves chart references against the workbook for the caches.
struct WorkbookData<'a> {
    wb: &'a Workbook,
    host: SheetId,
}

impl ChartData for WorkbookData<'_> {
    fn resolve(&self, formula: &str) -> Option<RefData> {
        let r = self.wb.resolve_ref(formula, self.host, false)?;
        Some(RefData {
            points: r.points,
            format_code: r.format_code,
        })
    }
}

/// Counters of the drawing and chart parts written so far.
#[derive(Default)]
pub(crate) struct DrawingParts {
    drawings: usize,
    charts: usize,
}

impl DrawingParts {
    /// Writes the drawing and chart parts of `sheet` (which has charts)
    /// and returns the drawing's target relative to `xl/worksheets/`.
    pub(crate) fn write(
        &mut self,
        pkg: &mut Package,
        wb: &Workbook,
        sheet: SheetId,
    ) -> Result<String> {
        self.drawings += 1;
        let drawing = PartName::new(format!("/xl/drawings/drawing{}.xml", self.drawings))?;
        let mut rels = Relationships::new();
        let mut x = XmlOut::new();
        x.start(
            "xdr:wsDr",
            &[("xmlns:xdr", XDR_NS), ("xmlns:a", DRAWINGML_NS)],
        );
        let data = WorkbookData { wb, host: sheet };
        for (i, obj) in wb.charts(sheet).iter().enumerate() {
            self.charts += 1;
            let chart_part = PartName::new(format!("/xl/charts/chart{}.xml", self.charts))?;
            pkg.insert_part(chart_part, ct::CHART, write_chart(&obj.chart, &data));
            let rid = rels
                .add(rel::CHART, format!("../charts/chart{}.xml", self.charts))
                .id
                .clone();
            let offset = |x: &mut XmlOut, name: &str, c: &CellOffset| {
                x.start(name, &[]);
                x.text_el("xdr:col", &[], &c.col.to_string());
                x.text_el("xdr:colOff", &[], &c.col_offset.to_string());
                x.text_el("xdr:row", &[], &c.row.to_string());
                x.text_el("xdr:rowOff", &[], &c.row_offset.to_string());
                x.end(name);
            };
            let ext = |x: &mut XmlOut, w: i64, h: i64| {
                x.empty("xdr:ext", &[("cx", &w.to_string()), ("cy", &h.to_string())]);
            };
            let anchor = match &obj.anchor {
                ChartAnchor::TwoCell { from, to } => {
                    x.start("xdr:twoCellAnchor", &[]);
                    offset(&mut x, "xdr:from", from);
                    offset(&mut x, "xdr:to", to);
                    "xdr:twoCellAnchor"
                }
                ChartAnchor::OneCell {
                    from,
                    width,
                    height,
                } => {
                    x.start("xdr:oneCellAnchor", &[]);
                    offset(&mut x, "xdr:from", from);
                    ext(&mut x, *width, *height);
                    "xdr:oneCellAnchor"
                }
                ChartAnchor::Absolute {
                    x: px,
                    y: py,
                    width,
                    height,
                } => {
                    x.start("xdr:absoluteAnchor", &[]);
                    x.empty("xdr:pos", &[("x", &px.to_string()), ("y", &py.to_string())]);
                    ext(&mut x, *width, *height);
                    "xdr:absoluteAnchor"
                }
            };
            x.start("xdr:graphicFrame", &[("macro", "")]);
            x.start("xdr:nvGraphicFramePr", &[]);
            let name = if obj.name.is_empty() {
                format!("Chart {}", obj.id)
            } else {
                obj.name.clone()
            };
            x.empty(
                "xdr:cNvPr",
                &[("id", &(i + 2).to_string()), ("name", &name)],
            );
            x.empty("xdr:cNvGraphicFramePr", &[]);
            x.end("xdr:nvGraphicFramePr");
            x.start("xdr:xfrm", &[]);
            x.empty("a:off", &[("x", "0"), ("y", "0")]);
            x.empty("a:ext", &[("cx", "0"), ("cy", "0")]);
            x.end("xdr:xfrm");
            x.start("a:graphic", &[]);
            x.start("a:graphicData", &[("uri", CHART_NS)]);
            x.empty(
                "c:chart",
                &[("xmlns:c", CHART_NS), ("xmlns:r", rel::NS), ("r:id", &rid)],
            );
            x.end("a:graphicData");
            x.end("a:graphic");
            x.end("xdr:graphicFrame");
            x.empty("xdr:clientData", &[]);
            x.end(anchor);
        }
        x.end("xdr:wsDr");
        pkg.insert_part(drawing.clone(), ct::DRAWING, x.finish());
        pkg.set_relationships(drawing, rels);
        Ok(format!("../drawings/drawing{}.xml", self.drawings))
    }
}
