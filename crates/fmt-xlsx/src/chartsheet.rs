//! Chart sheets (P9-C6): `xl/chartsheets/sheetN.xml`, a sheet that shows
//! one chart full-size (Excel's Move Chart › New sheet). The chart lives in
//! the sheet's drawing like any chart (an `xdr:absoluteAnchor`); the
//! workbook marks the sheet with [`Workbook::is_chart_sheet`].

use fmt_ooxml::xml::parse;
use fmt_ooxml::{rel, Package, PartName, TargetMode};

use crate::styles::MAIN_NS;
use crate::xml::{xml_error, XmlOut};
use crate::Result;

/// The relationship type of a chart sheet.
pub(crate) const CHARTSHEET_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet";
/// The content type of a chart sheet part.
pub(crate) const CHARTSHEET_CT: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml";

/// The drawing part of a chart sheet (`<drawing r:id>`).
pub(crate) fn drawing_of(pkg: &Package, part: &PartName) -> Result<Option<PartName>> {
    let Some(p) = pkg.part(part) else {
        return Ok(None);
    };
    let root = parse(&p.data, part.as_str()).map_err(xml_error)?;
    let Some(rid) = root.child("drawing").and_then(|d| d.attr("id")) else {
        return Ok(None);
    };
    let target = pkg
        .relationships(part)
        .and_then(|r| r.get(rid))
        .filter(|r| r.target_mode == TargetMode::Internal && r.rel_type == rel::DRAWING)
        .map(|r| part.resolve(&r.target))
        .transpose()?;
    Ok(target)
}

/// The chart sheet part (`drawing` = the relationship id of its drawing).
pub(crate) fn chartsheet_xml(selected: bool, drawing: Option<&str>) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("chartsheet", &[("xmlns", MAIN_NS), ("xmlns:r", rel::NS)]);
    x.empty("sheetPr", &[]);
    x.start("sheetViews", &[]);
    let mut a: Vec<(&str, &str)> = Vec::new();
    if selected {
        a.push(("tabSelected", "1"));
    }
    a.push(("zoomToFit", "1"));
    a.push(("workbookViewId", "0"));
    x.empty("sheetView", &a);
    x.end("sheetViews");
    x.empty(
        "pageMargins",
        &[
            ("left", "0.7"),
            ("right", "0.7"),
            ("top", "0.75"),
            ("bottom", "0.75"),
            ("header", "0.3"),
            ("footer", "0.3"),
        ],
    );
    x.empty("pageSetup", &[("orientation", "landscape")]);
    if let Some(rid) = drawing {
        x.empty("drawing", &[("r:id", rid)]);
    }
    x.end("chartsheet");
    x.finish()
}
