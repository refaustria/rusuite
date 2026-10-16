//! [`Workbook`] → `.xlsx`. Every part is regenerated (only the theme part
//! may come from [`XlsxContext`]); the output is deterministic.

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{CellContent, CellCoord, RangeRef, SheetId, Value};
use fmt_ooxml::theme::office_theme_xml;
use fmt_ooxml::{ct, rel, Package, PartName, Relationships};
use model_sheet::{
    AutoFilter, ColInfo, DynamicFilter, Filter, FilterOp, SheetView, SortState, Workbook,
};

use crate::a1::{cell_name, range_name};
use crate::dynarray::{metadata_xml, needs_dynamic, to_file_ast, METADATA_CT, METADATA_REL};
use crate::styles::{builtin_default_font, color_el, write_styles_with_dxfs, MAIN_NS};
use crate::xlfn::add_xlfn_prefixes;
use crate::xml::{encode_x_escapes, fmt_num, needs_preserve, XmlOut};
use crate::{Result, XlsxContext};

/// Writes `wb` as `.xlsx` bytes with the built-in theme and default font.
pub fn write(wb: &Workbook) -> Result<Vec<u8>> {
    write_with_context(wb, &XlsxContext::default())
}

/// Writes `wb` as `.xlsx` bytes, reusing the theme part and default font
/// from `ctx` (as returned by [`read_with_context`](crate::read_with_context)).
pub fn write_with_context(wb: &Workbook, ctx: &XlsxContext) -> Result<Vec<u8>> {
    let mut sst = SharedStrings::default();
    let dxfs = crate::condfmt::collect_dxfs(wb);
    let sheets = wb.sheets();
    // The first visible sheet is the selected (active) one.
    let active = sheets
        .iter()
        .position(|(id, _)| !wb.is_sheet_hidden(*id))
        .unwrap_or(0);
    let mut dynamic = false;
    let sheet_xml: Vec<Vec<u8>> = sheets
        .iter()
        .enumerate()
        .map(|(i, (id, _))| sheet_xml(wb, *id, i == active, &mut sst, &dxfs, &mut dynamic))
        .collect();
    let mut drawings = crate::drawing::DrawingParts::default();
    let default_font = ctx
        .default_font
        .clone()
        .unwrap_or_else(builtin_default_font);

    let pn = |s: &str| PartName::new(s);
    let main = pn("/xl/workbook.xml")?;
    let mut pkg = Package::new();
    pkg.insert_part(
        main.clone(),
        ct::WORKBOOK,
        workbook_xml(wb, &sheets, active),
    );
    let mut rels = Relationships::new();
    for (i, xml) in sheet_xml.into_iter().enumerate() {
        let target = format!("worksheets/sheet{}.xml", i + 1);
        let part = pn(&format!("/xl/{target}"))?;
        pkg.insert_part(part.clone(), ct::WORKSHEET, xml);
        rels.add(rel::WORKSHEET, target);
        let id = sheets[i].0;
        if !wb.charts(id).is_empty() {
            let drawing = drawings.write(&mut pkg, wb, id)?;
            let mut sheet_rels = Relationships::new();
            sheet_rels.add(rel::DRAWING, drawing);
            pkg.set_relationships(part, sheet_rels);
        }
    }
    pkg.insert_part(
        pn("/xl/theme/theme1.xml")?,
        ct::THEME,
        ctx.theme_xml
            .clone()
            .unwrap_or_else(|| office_theme_xml(false)),
    );
    pkg.insert_part(
        pn("/xl/styles.xml")?,
        ct::SPREADSHEET_STYLES,
        write_styles_with_dxfs(wb.styles(), &default_font, &dxfs),
    );
    rels.add(rel::STYLES, "styles.xml");
    rels.add(rel::THEME, "theme/theme1.xml");
    if !sst.strings.is_empty() {
        pkg.insert_part(
            pn("/xl/sharedStrings.xml")?,
            ct::SHARED_STRINGS,
            sst.to_xml(),
        );
        rels.add(rel::SHARED_STRINGS, "sharedStrings.xml");
    }
    if dynamic {
        pkg.insert_part(pn("/xl/metadata.xml")?, METADATA_CT, metadata_xml());
        rels.add(METADATA_REL, "metadata.xml");
    }
    pkg.set_relationships(main, rels);
    pkg.insert_part(pn("/docProps/core.xml")?, ct::CORE_PROPERTIES, core_xml());
    pkg.insert_part(pn("/docProps/app.xml")?, ct::EXTENDED_PROPERTIES, app_xml());
    let root = pkg.package_relationships_mut();
    root.add(rel::OFFICE_DOCUMENT, "xl/workbook.xml");
    root.add(rel::CORE_PROPERTIES, "docProps/core.xml");
    root.add(rel::EXTENDED_PROPERTIES, "docProps/app.xml");
    Ok(pkg.write(Cursor::new(Vec::new()))?.into_inner())
}

/// The shared string table, in first-use order.
#[derive(Default)]
struct SharedStrings {
    strings: Vec<String>,
    index: HashMap<String, usize>,
    count: usize,
}

impl SharedStrings {
    fn add(&mut self, s: &str) -> usize {
        self.count += 1;
        if let Some(&i) = self.index.get(s) {
            return i;
        }
        let i = self.strings.len();
        self.strings.push(s.to_owned());
        self.index.insert(s.to_owned(), i);
        i
    }

    fn to_xml(&self) -> Vec<u8> {
        let mut x = XmlOut::new();
        x.start(
            "sst",
            &[
                ("xmlns", MAIN_NS),
                ("count", &self.count.to_string()),
                ("uniqueCount", &self.strings.len().to_string()),
            ],
        );
        for s in &self.strings {
            x.start("si", &[]);
            let attrs: &[(&str, &str)] = if needs_preserve(s) {
                &[("xml:space", "preserve")]
            } else {
                &[]
            };
            x.text_el("t", attrs, &encode_x_escapes(s));
            x.end("si");
        }
        x.end("sst");
        x.finish()
    }
}

fn workbook_xml(wb: &Workbook, sheets: &[(SheetId, String)], active: usize) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("workbook", &[("xmlns", MAIN_NS), ("xmlns:r", rel::NS)]);
    x.empty("workbookPr", &[]);
    x.start("bookViews", &[]);
    x.empty("workbookView", &[("activeTab", &active.to_string())]);
    x.end("bookViews");
    x.start("sheets", &[]);
    for (i, (id, name)) in sheets.iter().enumerate() {
        let n = (i + 1).to_string();
        let rid = format!("rId{n}");
        let mut a: Vec<(&str, &str)> = vec![("name", name), ("sheetId", &n)];
        if wb.is_sheet_very_hidden(*id) {
            a.push(("state", "veryHidden"));
        } else if wb.is_sheet_hidden(*id) {
            a.push(("state", "hidden"));
        }
        a.push(("r:id", &rid));
        x.empty("sheet", &a);
    }
    x.end("sheets");
    // Excel names every AutoFilter range `_xlnm._FilterDatabase`.
    let filters: Vec<(usize, String)> = sheets
        .iter()
        .enumerate()
        .filter_map(|(i, (id, name))| {
            let af = wb.auto_filter(*id)?;
            let quoted = name.replace('\'', "''");
            Some((
                i,
                format!("'{quoted}'!{}", abs_range(af.r0, af.c0, af.r1, af.c1)),
            ))
        })
        .collect();
    if !filters.is_empty() {
        x.start("definedNames", &[]);
        for (i, target) in &filters {
            let local = i.to_string();
            x.text_el(
                "definedName",
                &[
                    ("name", "_xlnm._FilterDatabase"),
                    ("localSheetId", &local),
                    ("hidden", "1"),
                ],
                target,
            );
        }
        x.end("definedNames");
    }
    x.empty("calcPr", &[("fullCalcOnLoad", "1")]);
    x.end("workbook");
    x.finish()
}

fn core_xml() -> Vec<u8> {
    // No timestamps: core crates have no clock (ADR 0005), and fixed fake
    // dates would be misleading. Both are optional.
    let mut x = XmlOut::new();
    x.empty(
        "cp:coreProperties",
        &[
            (
                "xmlns:cp",
                "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
            ),
            ("xmlns:dc", "http://purl.org/dc/elements/1.1/"),
            ("xmlns:dcterms", "http://purl.org/dc/terms/"),
            ("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"),
        ],
    );
    x.finish()
}

fn app_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "Properties",
        &[(
            "xmlns",
            "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
        )],
    );
    x.text_el("Application", &[], "Rusuite");
    x.end("Properties");
    x.finish()
}

/// Groups consecutive columns with identical properties into
/// `(first, last, info)` runs (0-based, inclusive).
pub(crate) fn col_runs(cols: impl IntoIterator<Item = (u32, ColInfo)>) -> Vec<(u32, u32, ColInfo)> {
    let mut runs: Vec<(u32, u32, ColInfo)> = Vec::new();
    for (col, info) in cols {
        match runs.last_mut() {
            Some((_, last, prev)) if *last + 1 == col && *prev == info => *last = col,
            _ => runs.push((col, col, info)),
        }
    }
    runs
}

fn sheet_xml(
    wb: &Workbook,
    id: SheetId,
    selected: bool,
    sst: &mut SharedStrings,
    dxfs: &[model_sheet::DxfStyle],
    dynamic: &mut bool,
) -> Vec<u8> {
    let format = wb.sheet_format(id);
    let mut x = XmlOut::new();
    x.start("worksheet", &[("xmlns", MAIN_NS), ("xmlns:r", rel::NS)]);
    let filter_mode = wb.auto_filter(id).is_some_and(|af| !af.columns.is_empty());
    let pr: &[(&str, &str)] = if filter_mode {
        &[("filterMode", "1")]
    } else {
        &[]
    };
    match wb.tab_color(id) {
        Some(color) => {
            x.start("sheetPr", pr);
            color_el(&mut x, "tabColor", color);
            x.end("sheetPr");
        }
        None if filter_mode => x.empty("sheetPr", pr),
        None => {}
    }
    let dim = wb
        .used_range(id)
        .map_or_else(|| "A1".to_owned(), |(r, c)| range_name(0, 0, r, c));
    x.empty("dimension", &[("ref", &dim)]);
    sheet_view_xml(&mut x, &wb.sheet_view(id), selected);
    let col_w = fmt_num(format.default_col_width);
    let row_h = fmt_num(format.default_row_height);
    let mut fmt_attrs = vec![
        ("defaultColWidth", col_w.as_str()),
        ("defaultRowHeight", row_h.as_str()),
    ];
    if format.default_row_height != 15.0 {
        fmt_attrs.push(("customHeight", "1"));
    }
    x.empty("sheetFormatPr", &fmt_attrs);

    let runs = col_runs(wb.cols(id));
    if !runs.is_empty() {
        x.start("cols", &[]);
        for (first, last, info) in runs {
            let min = (first + 1).to_string();
            let max = (last + 1).to_string();
            let width = fmt_num(info.width.unwrap_or(format.default_col_width));
            let style = info.style.map(|s| s.0.to_string());
            let mut a: Vec<(&str, &str)> = vec![("min", &min), ("max", &max), ("width", &width)];
            if let Some(s) = &style {
                a.push(("style", s));
            }
            if info.hidden {
                a.push(("hidden", "1"));
            }
            if info.width.is_some() {
                a.push(("customWidth", "1"));
            }
            x.empty("col", &a);
        }
        x.end("cols");
    }

    x.start("sheetData", &[]);
    let all = RangeRef::new(
        id,
        0,
        0,
        engine_formula::ast::MAX_ROW,
        engine_formula::ast::MAX_COL,
    );
    let mut cells: Vec<(CellCoord, &CellContent)> = wb
        .cells_in(all)
        .map(|(c, content, _)| (c, content))
        .collect();
    cells.reverse(); // pop() yields row-major order
    let rows: BTreeSet<u32> = wb
        .rows(id)
        .map(|(r, _)| r)
        .chain(cells.iter().map(|(c, _)| c.row))
        .collect();
    for row in rows {
        let info = wb.row_info(id, row);
        let r = (row + 1).to_string();
        let style = info.style.map(|s| s.0.to_string());
        let ht = info.height.map(fmt_num);
        let mut a: Vec<(&str, &str)> = vec![("r", &r)];
        if let Some(s) = &style {
            a.push(("s", s));
            a.push(("customFormat", "1"));
        }
        if let Some(h) = &ht {
            a.push(("ht", h));
            a.push(("customHeight", "1"));
        }
        if info.hidden {
            a.push(("hidden", "1"));
        }
        if cells.last().is_some_and(|(c, _)| c.row == row) {
            x.start("row", &a);
            while let Some(&(c, content)) = cells.last().filter(|(c, _)| c.row == row) {
                cells.pop();
                *dynamic |= write_cell(&mut x, wb, c, content, sst);
            }
            x.end("row");
        } else {
            x.empty("row", &a);
        }
    }
    x.end("sheetData");
    if let Some(af) = wb.auto_filter(id) {
        auto_filter_xml(&mut x, af);
    }
    if let Some(st) = wb.sort_state(id) {
        sort_state_xml(&mut x, st);
    }
    let merges = wb.merges(id);
    if !merges.is_empty() {
        x.start("mergeCells", &[("count", &merges.len().to_string())]);
        for m in merges {
            x.empty("mergeCell", &[("ref", &range_name(m.r0, m.c0, m.r1, m.c1))]);
        }
        x.end("mergeCells");
    }
    crate::condfmt::write_sheet_rules(&mut x, wb, id, dxfs);
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
    // The drawing part is the sheet's only relationship (`rId1`).
    if !wb.charts(id).is_empty() {
        x.empty("drawing", &[("r:id", "rId1")]);
    }
    x.end("worksheet");
    x.finish()
}

/// `$A$1:$B$2` (absolute, as in defined names).
fn abs_range(r0: u32, c0: u32, r1: u32, c1: u32) -> String {
    let cell = |r: u32, c: u32| format!("${}${}", engine_formula::ast::col_to_letters(c), r + 1);
    format!("{}:{}", cell(r0, c0), cell(r1, c1))
}

/// `<autoFilter>` with one `<filterColumn>` per filtered column (`colId`
/// relative to the range). Text conditions of the contains family are
/// stored as `equal`/`notEqual` wildcard patterns, as Excel does.
fn auto_filter_xml(x: &mut XmlOut, af: &AutoFilter) {
    let r = range_name(af.r0, af.c0, af.r1, af.c1);
    if af.columns.is_empty() {
        x.empty("autoFilter", &[("ref", &r)]);
        return;
    }
    x.start("autoFilter", &[("ref", &r)]);
    for fc in &af.columns {
        let id = (fc.col - af.c0).to_string();
        x.start("filterColumn", &[("colId", &id)]);
        match &fc.filter {
            Filter::Values { values } => {
                let blank = values.iter().any(String::is_empty);
                let a: &[(&str, &str)] = if blank { &[("blank", "1")] } else { &[] };
                let vals: Vec<&String> = values.iter().filter(|v| !v.is_empty()).collect();
                if vals.is_empty() {
                    x.empty("filters", a);
                } else {
                    x.start("filters", a);
                    for v in vals {
                        x.empty("filter", &[("val", &encode_x_escapes(v))]);
                    }
                    x.end("filters");
                }
            }
            Filter::Custom { criteria, and } => {
                let a: &[(&str, &str)] = if *and { &[("and", "1")] } else { &[] };
                x.start("customFilters", a);
                for c in criteria {
                    let esc = || {
                        c.value
                            .chars()
                            .flat_map(|ch| match ch {
                                '*' | '?' | '~' => vec!['~', ch],
                                _ => vec![ch],
                            })
                            .collect::<String>()
                    };
                    let (op, val) = match c.op {
                        FilterOp::Eq => ("equal", c.value.clone()),
                        FilterOp::Ne => ("notEqual", c.value.clone()),
                        FilterOp::Gt => ("greaterThan", c.value.clone()),
                        FilterOp::Ge => ("greaterThanOrEqual", c.value.clone()),
                        FilterOp::Lt => ("lessThan", c.value.clone()),
                        FilterOp::Le => ("lessThanOrEqual", c.value.clone()),
                        FilterOp::Contains => ("equal", format!("*{}*", esc())),
                        FilterOp::NotContains => ("notEqual", format!("*{}*", esc())),
                        FilterOp::BeginsWith => ("equal", format!("{}*", esc())),
                        FilterOp::EndsWith => ("equal", format!("*{}", esc())),
                    };
                    let val = encode_x_escapes(&val);
                    let mut a: Vec<(&str, &str)> = Vec::new();
                    if op != "equal" {
                        a.push(("operator", op));
                    }
                    a.push(("val", &val));
                    x.empty("customFilter", &a);
                }
                x.end("customFilters");
            }
            Filter::Top10 {
                top,
                percent,
                value,
            } => {
                let v = fmt_num(*value);
                let mut a: Vec<(&str, &str)> = Vec::new();
                if !top {
                    a.push(("top", "0"));
                }
                if *percent {
                    a.push(("percent", "1"));
                }
                a.push(("val", &v));
                x.empty("top10", &a);
            }
            Filter::Dynamic { filter } => {
                let t = match filter {
                    DynamicFilter::AboveAverage => "aboveAverage",
                    DynamicFilter::BelowAverage => "belowAverage",
                    DynamicFilter::Today => "today",
                    DynamicFilter::Yesterday => "yesterday",
                    DynamicFilter::Tomorrow => "tomorrow",
                };
                x.empty("dynamicFilter", &[("type", t)]);
            }
        }
        x.end("filterColumn");
    }
    x.end("autoFilter");
}

/// `<sortState>` with one `<sortCondition>` per key.
fn sort_state_xml(x: &mut XmlOut, st: &SortState) {
    let r = range_name(st.r0, st.c0, st.r1, st.c1);
    let mut a: Vec<(&str, &str)> = vec![("ref", &r)];
    if st.case_sensitive {
        a.push(("caseSensitive", "1"));
    }
    x.start("sortState", &a);
    for k in &st.keys {
        let col = range_name(st.r0, k.col, st.r1, k.col);
        let mut a: Vec<(&str, &str)> = Vec::new();
        if !k.ascending {
            a.push(("descending", "1"));
        }
        a.push(("ref", &col));
        x.empty("sortCondition", &a);
    }
    x.end("sortState");
}

/// `<sheetViews>` with one `<sheetView>`: non-default gridlines, headings
/// and zoom as attributes, frozen panes as a `<pane state="frozen">`.
fn sheet_view_xml(x: &mut XmlOut, view: &SheetView, selected: bool) {
    x.start("sheetViews", &[]);
    let zoom = view.zoom.to_string();
    let mut a: Vec<(&str, &str)> = Vec::new();
    if !view.show_gridlines {
        a.push(("showGridLines", "0"));
    }
    if !view.show_headings {
        a.push(("showRowColHeaders", "0"));
    }
    if selected {
        a.push(("tabSelected", "1"));
    }
    if view.zoom != 100 {
        a.push(("zoomScale", &zoom));
    }
    a.push(("workbookViewId", "0"));
    let (rows, cols) = (view.frozen_rows, view.frozen_cols);
    if rows == 0 && cols == 0 {
        x.empty("sheetView", &a);
    } else {
        x.start("sheetView", &a);
        let (x_split, y_split) = (cols.to_string(), rows.to_string());
        let top_left = cell_name(rows.min(MAX_ROW), cols.min(MAX_COL));
        let pane = match (rows > 0, cols > 0) {
            (true, true) => "bottomRight",
            (true, false) => "bottomLeft",
            _ => "topRight",
        };
        let mut p: Vec<(&str, &str)> = Vec::new();
        if cols > 0 {
            p.push(("xSplit", &x_split));
        }
        if rows > 0 {
            p.push(("ySplit", &y_split));
        }
        p.extend([
            ("topLeftCell", top_left.as_str()),
            ("activePane", pane),
            ("state", "frozen"),
        ]);
        x.empty("pane", &p);
        x.empty("selection", &[("pane", pane)]);
        x.end("sheetView");
    }
    x.end("sheetViews");
}

/// Writes one `<c>`; returns whether it is a dynamic array formula.
fn write_cell(
    x: &mut XmlOut,
    wb: &Workbook,
    c: CellCoord,
    content: &CellContent,
    sst: &mut SharedStrings,
) -> bool {
    let r = cell_name(c.row, c.col);
    // Excel applies a row/column style only to cells absent from
    // <sheetData>, so a written cell carries its effective style.
    let style = wb.style_id(c);
    let s = style.0.to_string();
    let mut a: Vec<(&str, &str)> = vec![("r", &r)];
    if !style.is_default() {
        a.push(("s", &s));
    }
    let (t, v): (Option<&str>, Option<String>) = match content {
        CellContent::Empty => (None, None),
        CellContent::Value(v) => match v {
            Value::Text(s) => (Some("s"), Some(sst.add(s).to_string())),
            other => value_repr(other),
        },
        // Spilled cells are stored as plain values (as Excel does).
        CellContent::Formula { .. } | CellContent::Spilled { .. } => {
            match wb.value(c).into_scalar() {
                Value::Text(s) => (Some("str"), Some(encode_x_escapes(&s).into_owned())),
                other => value_repr(&other),
            }
        }
    };
    if let Some(t) = t {
        a.push(("t", t));
    }
    let formula = match content {
        CellContent::Formula { text, ast } => Some(match to_file_ast(ast) {
            Some(file) => add_xlfn_prefixes(&file.to_string()),
            None => add_xlfn_prefixes(text.strip_prefix('=').unwrap_or(text)),
        }),
        _ => None,
    };
    // Dynamic array formula: `cm` on the cell, `t="array"` with the spill
    // range (the anchor alone when blocked or a single value).
    let array_ref = match content {
        CellContent::Formula { ast, .. }
            if wb.engine().spill(c).is_some() || needs_dynamic(ast) =>
        {
            Some(match wb.engine().spill_range(c) {
                Some(r) => range_name(r.r0, r.c0, r.r1, r.c1),
                None => r.clone(),
            })
        }
        _ => None,
    };
    if array_ref.is_some() {
        a.push(("cm", "1"));
    }
    if formula.is_none() && v.is_none() {
        x.empty("c", &a);
        return false;
    }
    x.start("c", &a);
    if let Some(f) = &formula {
        match &array_ref {
            Some(r) => x.text_el("f", &[("t", "array"), ("ref", r)], f),
            None => x.text_el("f", &[], f),
        }
    }
    if let Some(v) = &v {
        x.text_el("v", &[], v);
    }
    x.end("c");
    array_ref.is_some()
}

/// `t` attribute and `<v>` text of a non-text value.
fn value_repr(v: &Value) -> (Option<&'static str>, Option<String>) {
    match v {
        Value::Number(n) => (None, Some(fmt_num(*n))),
        Value::Bool(b) => (Some("b"), Some(if *b { "1" } else { "0" }.to_owned())),
        Value::Error(e) => (Some("e"), Some(e.as_str().to_owned())),
        Value::Text(s) => (Some("str"), Some(encode_x_escapes(s).into_owned())),
        Value::Empty | Value::Array(_) => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(width: f64) -> ColInfo {
        ColInfo {
            width: Some(width),
            ..Default::default()
        }
    }

    #[test]
    fn column_runs_merge_consecutive_identical() {
        let hidden = ColInfo {
            hidden: true,
            ..Default::default()
        };
        let cols = vec![
            (0, w(10.0)),
            (1, w(10.0)),
            (2, w(10.0)),
            (3, w(12.0)),
            (5, w(12.0)),
            (6, hidden),
            (7, hidden),
        ];
        assert_eq!(
            col_runs(cols),
            vec![
                (0, 2, w(10.0)),
                (3, 3, w(12.0)),
                (5, 5, w(12.0)),
                (6, 7, hidden)
            ]
        );
        assert!(col_runs(Vec::new()).is_empty());
    }

    #[test]
    fn shared_strings_count_and_preserve() {
        let mut sst = SharedStrings::default();
        assert_eq!(sst.add("a"), 0);
        assert_eq!(sst.add(" b"), 1);
        assert_eq!(sst.add("a"), 0);
        let xml = String::from_utf8(sst.to_xml()).unwrap();
        assert!(xml.contains(r#"count="3" uniqueCount="2""#), "{xml}");
        assert!(
            xml.contains(r#"<si><t xml:space="preserve"> b</t></si>"#),
            "{xml}"
        );
        let back = crate::read::parse_sst(xml.as_bytes(), "sst").unwrap();
        assert_eq!(back, vec!["a", " b"]);
    }
}
