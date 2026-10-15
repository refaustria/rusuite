//! [`Workbook`] → `.xlsx`. Every part is regenerated (only the theme part
//! may come from [`XlsxContext`]); the output is deterministic.

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;

use engine_formula::{CellContent, CellCoord, RangeRef, SheetId, Value};
use fmt_ooxml::{Package, PartName, Relationships, OFFICE_DOCUMENT_REL};
use model_sheet::{ColInfo, Workbook};

use crate::a1::{cell_name, range_name};
use crate::read::{REL_NS, REL_SST, REL_STYLES, REL_THEME, REL_WORKSHEET};
use crate::styles::{builtin_default_font, write_styles, MAIN_NS};
use crate::theme::default_theme_xml;
use crate::xlfn::add_xlfn_prefixes;
use crate::xml::{encode_x_escapes, fmt_num, needs_preserve, XmlOut};
use crate::{Result, XlsxContext};

const CT_WORKBOOK: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const CT_WORKSHEET: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const CT_STYLES: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
const CT_SST: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const CT_THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";
const CT_CORE: &str = "application/vnd.openxmlformats-package.core-properties+xml";
const CT_APP: &str = "application/vnd.openxmlformats-officedocument.extended-properties+xml";
const REL_CORE: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const REL_APP: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";

/// Writes `wb` as `.xlsx` bytes with the built-in theme and default font.
pub fn write(wb: &Workbook) -> Result<Vec<u8>> {
    write_with_context(wb, &XlsxContext::default())
}

/// Writes `wb` as `.xlsx` bytes, reusing the theme part and default font
/// from `ctx` (as returned by [`read_with_context`](crate::read_with_context)).
pub fn write_with_context(wb: &Workbook, ctx: &XlsxContext) -> Result<Vec<u8>> {
    let mut sst = SharedStrings::default();
    let sheets = wb.sheets();
    let sheet_xml: Vec<Vec<u8>> = sheets
        .iter()
        .enumerate()
        .map(|(i, (id, _))| sheet_xml(wb, *id, i == 0, &mut sst))
        .collect();
    let default_font = ctx
        .default_font
        .clone()
        .unwrap_or_else(builtin_default_font);

    let pn = |s: &str| PartName::new(s);
    let main = pn("/xl/workbook.xml")?;
    let mut pkg = Package::new();
    pkg.insert_part(main.clone(), CT_WORKBOOK, workbook_xml(&sheets));
    let mut rels = Relationships::new();
    for (i, xml) in sheet_xml.into_iter().enumerate() {
        let target = format!("worksheets/sheet{}.xml", i + 1);
        pkg.insert_part(pn(&format!("/xl/{target}"))?, CT_WORKSHEET, xml);
        rels.add(REL_WORKSHEET, target);
    }
    pkg.insert_part(
        pn("/xl/theme/theme1.xml")?,
        CT_THEME,
        ctx.theme_xml.clone().unwrap_or_else(default_theme_xml),
    );
    pkg.insert_part(
        pn("/xl/styles.xml")?,
        CT_STYLES,
        write_styles(wb.styles(), &default_font),
    );
    rels.add(REL_STYLES, "styles.xml");
    rels.add(REL_THEME, "theme/theme1.xml");
    if !sst.strings.is_empty() {
        pkg.insert_part(pn("/xl/sharedStrings.xml")?, CT_SST, sst.to_xml());
        rels.add(REL_SST, "sharedStrings.xml");
    }
    pkg.set_relationships(main, rels);
    pkg.insert_part(pn("/docProps/core.xml")?, CT_CORE, core_xml());
    pkg.insert_part(pn("/docProps/app.xml")?, CT_APP, app_xml());
    let root = pkg.package_relationships_mut();
    root.add(OFFICE_DOCUMENT_REL, "xl/workbook.xml");
    root.add(REL_CORE, "docProps/core.xml");
    root.add(REL_APP, "docProps/app.xml");
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

fn workbook_xml(sheets: &[(SheetId, String)]) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("workbook", &[("xmlns", MAIN_NS), ("xmlns:r", REL_NS)]);
    x.empty("workbookPr", &[]);
    x.start("bookViews", &[]);
    x.empty("workbookView", &[("activeTab", "0")]);
    x.end("bookViews");
    x.start("sheets", &[]);
    for (i, (_, name)) in sheets.iter().enumerate() {
        let n = (i + 1).to_string();
        x.empty(
            "sheet",
            &[
                ("name", name),
                ("sheetId", &n),
                ("r:id", &format!("rId{n}")),
            ],
        );
    }
    x.end("sheets");
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

fn sheet_xml(wb: &Workbook, id: SheetId, first: bool, sst: &mut SharedStrings) -> Vec<u8> {
    let format = wb.sheet_format(id);
    let mut x = XmlOut::new();
    x.start("worksheet", &[("xmlns", MAIN_NS), ("xmlns:r", REL_NS)]);
    let dim = wb
        .used_range(id)
        .map_or_else(|| "A1".to_owned(), |(r, c)| range_name(0, 0, r, c));
    x.empty("dimension", &[("ref", &dim)]);
    x.start("sheetViews", &[]);
    let view: &[(&str, &str)] = if first {
        &[("tabSelected", "1"), ("workbookViewId", "0")]
    } else {
        &[("workbookViewId", "0")]
    };
    x.empty("sheetView", view);
    x.end("sheetViews");
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
                write_cell(&mut x, wb, c, content, sst);
            }
            x.end("row");
        } else {
            x.empty("row", &a);
        }
    }
    x.end("sheetData");
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
    x.end("worksheet");
    x.finish()
}

fn write_cell(
    x: &mut XmlOut,
    wb: &Workbook,
    c: CellCoord,
    content: &CellContent,
    sst: &mut SharedStrings,
) {
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
        CellContent::Formula { .. } => match wb.value(c).into_scalar() {
            Value::Text(s) => (Some("str"), Some(encode_x_escapes(&s).into_owned())),
            other => value_repr(&other),
        },
    };
    if let Some(t) = t {
        a.push(("t", t));
    }
    let formula = match content {
        CellContent::Formula { text, .. } => {
            Some(add_xlfn_prefixes(text.strip_prefix('=').unwrap_or(text)))
        }
        _ => None,
    };
    if formula.is_none() && v.is_none() {
        x.empty("c", &a);
        return;
    }
    x.start("c", &a);
    if let Some(f) = &formula {
        x.text_el("f", &[], f);
    }
    if let Some(v) = &v {
        x.text_el("v", &[], v);
    }
    x.end("c");
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
