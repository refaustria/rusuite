//! `.xlsx` → [`Workbook`].

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;

use engine_formula::ast::MAX_COL;
use engine_formula::{offset_relative, CellContent, CellCoord, ErrorKind, Expr, SheetId, Value};
use fmt_ooxml::{Package, PartName, TargetMode};
use model_sheet::{ColInfo, RowInfo, SheetFormat, StyleId, Workbook};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::a1::{cell_name, parse_cell};
use crate::styles::parse_styles;
use crate::theme::parse_color_scheme;
use crate::xlfn::strip_xlfn_prefixes;
use crate::xml::{
    attr, attr_bool, attr_parse, decode_x_escapes, name_of, parse_bool, push_ref, push_text,
    xml_err,
};
use crate::{Error, Result, XlsxContext};

pub(crate) const REL_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub(crate) const REL_WORKSHEET: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
pub(crate) const REL_STYLES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
pub(crate) const REL_THEME: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
pub(crate) const REL_SST: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";

/// Everything [`read_with_context`] returns.
#[derive(Debug)]
pub struct ReadOutput {
    pub workbook: Workbook,
    /// File-level data to pass to [`write_with_context`](crate::write_with_context).
    pub context: XlsxContext,
    /// Human-readable notes about content that was dropped or approximated.
    pub warnings: Vec<String>,
}

/// Reads an `.xlsx` file. Unsupported content is dropped silently; use
/// [`read_with_warnings`] to learn what was dropped.
pub fn read(bytes: &[u8]) -> Result<Workbook> {
    Ok(read_with_context(bytes)?.workbook)
}

/// Like [`read()`], also returning notes about dropped/approximated content.
pub fn read_with_warnings(bytes: &[u8]) -> Result<(Workbook, Vec<String>)> {
    let out = read_with_context(bytes)?;
    Ok((out.workbook, out.warnings))
}

/// Reads an `.xlsx` file, returning the workbook, the file context (theme
/// part, default font) and warnings.
pub fn read_with_context(bytes: &[u8]) -> Result<ReadOutput> {
    let pkg = Package::open(Cursor::new(bytes))?;
    let mut warnings: Vec<String> = Vec::new();
    let main = pkg.main_document_part().ok_or_else(|| {
        Error::MissingPart("officeDocument relationship (xl/workbook.xml)".into())
    })?;
    let part_data = |name: &PartName| -> Result<&[u8]> {
        pkg.part(name)
            .map(|p| p.data.as_slice())
            .ok_or_else(|| Error::MissingPart(name.to_string()))
    };
    let book = parse_workbook(part_data(&main)?, main.as_str())?;
    if book.date1904 {
        return Err(Error::Unsupported("date1904".into()));
    }
    if book.defined_names > 0 {
        warnings.push(format!("{} defined name(s) dropped", book.defined_names));
    }
    let mut consumed: BTreeSet<PartName> = BTreeSet::new();
    consumed.insert(main.clone());
    for p in ["/docProps/core.xml", "/docProps/app.xml"] {
        consumed.insert(PartName::new(p)?);
    }

    // Theme.
    let mut context = XlsxContext::default();
    if let Some(theme) = pkg.related_part(&main, REL_THEME) {
        if let Some(p) = pkg.part(&theme) {
            context.color_scheme = parse_color_scheme(&p.data, theme.as_str())?;
            context.theme_xml = Some(p.data.clone());
            consumed.insert(theme);
        }
    }

    // Styles.
    let mut wb = Workbook::new();
    let mut xf_ids: Vec<StyleId> = Vec::new();
    if let Some(styles) = pkg.related_part(&main, REL_STYLES) {
        let parsed = parse_styles(part_data(&styles)?, styles.as_str(), &mut |w| {
            warnings.push(w)
        })?;
        xf_ids = parsed.xfs.iter().map(|s| wb.intern_style(s)).collect();
        context.default_font = Some(parsed.default_font);
        consumed.insert(styles);
    }

    // Shared strings.
    let mut sst: Vec<String> = Vec::new();
    if let Some(part) = pkg.related_part(&main, REL_SST) {
        sst = parse_sst(part_data(&part)?, part.as_str())?;
        consumed.insert(part);
    }

    // Sheets: create all first so that cross-sheet formulas resolve.
    let rels = pkg.relationships(&main);
    let mut sheets: Vec<(SheetId, String, PartName)> = Vec::new();
    for entry in &book.sheets {
        let rel = rels.and_then(|r| r.get(&entry.rid));
        let Some(rel) = rel.filter(|r| r.target_mode == TargetMode::Internal) else {
            warnings.push(format!("sheet {:?} has no part; dropped", entry.name));
            continue;
        };
        if rel.rel_type != REL_WORKSHEET {
            warnings.push(format!(
                "sheet {:?} is not a worksheet ({}); dropped",
                entry.name,
                rel.rel_type.rsplit('/').next().unwrap_or("")
            ));
            continue;
        }
        let part = main.resolve(&rel.target)?;
        let id = if sheets.is_empty() {
            wb.rename_sheet(SheetId(0), &entry.name)?;
            SheetId(0)
        } else {
            wb.add_sheet(&entry.name)?
        };
        if entry.hidden {
            warnings.push(format!("sheet {:?}: hidden state dropped", entry.name));
        }
        consumed.insert(part.clone());
        sheets.push((id, entry.name.clone(), part));
    }
    if sheets.is_empty() {
        return Err(Error::Malformed {
            part: main.to_string(),
            reason: "no worksheets".into(),
        });
    }

    wb.begin_batch();
    let loaded = (|| -> Result<()> {
        for (id, name, part) in &sheets {
            let mut loader = SheetLoader {
                wb: &mut wb,
                sheet: *id,
                sheet_name: name,
                xf_ids: &xf_ids,
                sst: &sst,
                warnings: &mut warnings,
                shared: HashMap::new(),
            };
            loader.load(part_data(part)?, part.as_str())?;
        }
        Ok(())
    })();
    wb.end_batch();
    loaded?;

    for (name, part) in pkg.parts() {
        if !consumed.contains(name) {
            warnings.push(format!("part {name} ({}) dropped", part.content_type));
        }
    }
    Ok(ReadOutput {
        workbook: wb,
        context,
        warnings,
    })
}

// --- workbook.xml ------------------------------------------------------------

struct SheetEntry {
    name: String,
    rid: String,
    hidden: bool,
}

struct BookInfo {
    sheets: Vec<SheetEntry>,
    date1904: bool,
    defined_names: usize,
}

fn parse_workbook(xml: &[u8], part: &str) -> Result<BookInfo> {
    let mut reader = Reader::from_reader(xml);
    let mut info = BookInfo {
        sheets: Vec::new(),
        date1904: false,
        defined_names: 0,
    };
    loop {
        match reader.read_event().map_err(xml_err(part))? {
            Event::Start(el) | Event::Empty(el) => match name_of(&el) {
                b"workbookPr" => info.date1904 = attr_bool(&el, "date1904").unwrap_or(false),
                b"sheet" => {
                    let (Some(name), Some(rid)) = (attr(&el, "name"), attr(&el, "id")) else {
                        return Err(Error::Malformed {
                            part: part.into(),
                            reason: "<sheet> without name or r:id".into(),
                        });
                    };
                    info.sheets.push(SheetEntry {
                        name: name.into_owned(),
                        rid: rid.into_owned(),
                        hidden: attr(&el, "state").is_some_and(|s| s != "visible"),
                    });
                }
                b"definedName" => info.defined_names += 1,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(info)
}

// --- sharedStrings.xml -------------------------------------------------------

/// Parses the shared string table: plain `<si><t>` and rich text
/// `<si><r><t>` (run formatting dropped, phonetic `<rPh>` runs skipped).
pub(crate) fn parse_sst(xml: &[u8], part: &str) -> Result<Vec<String>> {
    let mut reader = Reader::from_reader(xml);
    let mut out = Vec::new();
    let mut buf: Option<String> = None;
    let mut in_t = false;
    let mut in_rph = false;
    loop {
        match reader.read_event().map_err(xml_err(part))? {
            Event::Start(el) => match name_of(&el) {
                b"si" => buf = Some(String::new()),
                b"rPh" => in_rph = true,
                b"t" => in_t = buf.is_some() && !in_rph,
                _ => {}
            },
            Event::Empty(el) => {
                if name_of(&el) == b"si" {
                    out.push(String::new());
                }
            }
            Event::Text(t) if in_t => push_text(buf.as_mut().expect("in <si>"), &t),
            Event::CData(t) if in_t => {
                buf.as_mut().expect("in <si>").push_str(&t.xml10_content());
            }
            Event::GeneralRef(r) if in_t => push_ref(buf.as_mut().expect("in <si>"), &r),
            Event::End(el) => match crate::xml::end_name(&el) {
                b"si" => {
                    if let Some(s) = buf.take() {
                        out.push(decode_x_escapes(&s).into_owned());
                    }
                }
                b"rPh" => in_rph = false,
                b"t" => in_t = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

// --- worksheets --------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Capture {
    None,
    V,
    F,
    IsT,
}

#[derive(Default)]
struct FormulaBuf {
    kind: String,
    si: Option<u32>,
    text: String,
}

#[derive(Default)]
struct CellBuf {
    row: u32,
    col: u32,
    xf: usize,
    t: String,
    f: Option<FormulaBuf>,
    v: Option<String>,
    is: Option<String>,
}

/// Elements we drop, with the wording used in the warning.
const DROPPED: &[(&[u8], &str)] = &[
    (b"conditionalFormatting", "conditional formatting"),
    (b"dataValidations", "data validation"),
    (b"hyperlinks", "hyperlinks"),
    (b"drawing", "drawings/charts"),
    (b"legacyDrawing", "comments/legacy drawings"),
    (b"tableParts", "tables"),
    (b"autoFilter", "auto filter"),
    (b"sheetProtection", "sheet protection"),
    (b"picture", "background picture"),
    (b"oleObjects", "OLE objects"),
    (b"controls", "form controls"),
];

struct SheetLoader<'a> {
    wb: &'a mut Workbook,
    sheet: SheetId,
    sheet_name: &'a str,
    xf_ids: &'a [StyleId],
    sst: &'a [String],
    warnings: &'a mut Vec<String>,
    /// Shared formula index → (master AST, master row, master col).
    shared: HashMap<u32, (Expr, u32, u32)>,
}

impl SheetLoader<'_> {
    fn warn(&mut self, msg: String) {
        self.warnings
            .push(format!("sheet {:?}: {msg}", self.sheet_name));
    }

    fn style(&self, xf: usize) -> StyleId {
        self.xf_ids.get(xf).copied().unwrap_or_default()
    }

    fn load(&mut self, xml: &[u8], part: &str) -> Result<()> {
        let mut reader = Reader::from_reader(xml);
        let mut format = SheetFormat::default();
        let mut row: u32 = 0;
        let mut next_row: u32 = 0;
        let mut next_col: u32 = 0;
        let mut cell: Option<CellBuf> = None;
        let mut capture = Capture::None;
        let mut in_rph = false;
        let mut text = String::new();
        let mut merged: Vec<String> = Vec::new();
        let mut dropped: BTreeSet<&'static str> = BTreeSet::new();
        loop {
            let ev = reader.read_event().map_err(xml_err(part))?;
            match ev {
                Event::Start(ref el) | Event::Empty(ref el) => {
                    let empty = matches!(ev, Event::Empty(_));
                    match name_of(el) {
                        b"tabColor" => {
                            let color = crate::styles::color_of_el(el);
                            self.wb.set_tab_color(self.sheet, color)?;
                        }
                        b"sheetFormatPr" => {
                            if let Some(w) = attr_parse::<f64>(el, "defaultColWidth") {
                                format.default_col_width = w;
                            }
                            if let Some(h) = attr_parse::<f64>(el, "defaultRowHeight") {
                                format.default_row_height = h;
                            }
                            self.wb.set_sheet_format(self.sheet, format)?;
                        }
                        b"col" => self.load_col(el, format)?,
                        b"row" => {
                            row = attr_parse::<u32>(el, "r")
                                .filter(|&r| r >= 1)
                                .map_or(next_row, |r| r - 1);
                            next_row = row + 1;
                            next_col = 0;
                            self.load_row(el, row)?;
                        }
                        b"c" => {
                            let (r, c) = attr(el, "r")
                                .and_then(|r| parse_cell(&r))
                                .unwrap_or((row, next_col));
                            next_col = c + 1;
                            let buf = CellBuf {
                                row: r,
                                col: c,
                                xf: attr_parse(el, "s").unwrap_or(0),
                                t: attr(el, "t").map_or_else(|| "n".into(), |t| t.into_owned()),
                                ..CellBuf::default()
                            };
                            if empty {
                                self.finish_cell(buf)?;
                            } else {
                                cell = Some(buf);
                            }
                        }
                        b"f" if cell.is_some() => {
                            let f = FormulaBuf {
                                kind: attr(el, "t")
                                    .map_or_else(|| "normal".into(), |t| t.into_owned()),
                                si: attr_parse(el, "si"),
                                text: String::new(),
                            };
                            cell.as_mut().expect("checked").f = Some(f);
                            if !empty {
                                capture = Capture::F;
                                text.clear();
                            }
                        }
                        b"v" if cell.is_some() && !empty => {
                            capture = Capture::V;
                            text.clear();
                        }
                        b"is" if cell.is_some() => {
                            cell.as_mut().expect("checked").is = Some(String::new());
                        }
                        b"rPh" if !empty => in_rph = true,
                        b"t" if !empty
                            && !in_rph
                            && cell.as_ref().is_some_and(|c| c.is.is_some()) =>
                        {
                            capture = Capture::IsT;
                            text.clear();
                        }
                        b"mergeCell" => {
                            if let Some(r) = attr(el, "ref") {
                                merged.push(r.into_owned());
                            }
                        }
                        b"pane" => {
                            if attr(el, "state").is_some_and(|s| s.starts_with("frozen")) {
                                dropped.insert("freeze panes");
                            }
                        }
                        name => {
                            if let Some((_, what)) = DROPPED.iter().find(|(n, _)| *n == name) {
                                dropped.insert(what);
                            }
                        }
                    }
                }
                Event::Text(ref t) if capture != Capture::None => push_text(&mut text, t),
                Event::CData(ref t) if capture != Capture::None => {
                    text.push_str(&t.xml10_content());
                }
                Event::GeneralRef(ref r) if capture != Capture::None => push_ref(&mut text, r),
                Event::End(ref el) => {
                    let name = crate::xml::end_name(el);
                    match name {
                        b"c" => {
                            if let Some(buf) = cell.take() {
                                self.finish_cell(buf)?;
                            }
                        }
                        b"rPh" => in_rph = false,
                        b"f" | b"v" | b"t" if capture != Capture::None => {
                            if let Some(c) = cell.as_mut() {
                                let s = std::mem::take(&mut text);
                                match capture {
                                    Capture::F => {
                                        if let Some(f) = c.f.as_mut() {
                                            f.text = s;
                                        }
                                    }
                                    Capture::V => c.v = Some(s),
                                    Capture::IsT => {
                                        c.is.get_or_insert_with(String::new).push_str(&s)
                                    }
                                    Capture::None => {}
                                }
                            }
                            capture = Capture::None;
                        }
                        _ => {}
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
        if !merged.is_empty() {
            self.warn(format!("merged cells dropped: {}", merged.join(", ")));
        }
        for what in dropped {
            self.warn(format!("{what} dropped"));
        }
        Ok(())
    }

    fn load_col(&mut self, el: &BytesStart<'_>, format: SheetFormat) -> Result<()> {
        let (Some(min), Some(max)) = (attr_parse::<u32>(el, "min"), attr_parse::<u32>(el, "max"))
        else {
            return Ok(());
        };
        if min == 0 || max < min || min - 1 > MAX_COL {
            return Ok(());
        }
        // A width counts when marked custom, or (customWidth absent) when it
        // differs from the sheet default.
        let width = attr_parse::<f64>(el, "width").filter(|&w| {
            w.is_finite()
                && w >= 0.0
                && attr_bool(el, "customWidth")
                    .unwrap_or((w - format.default_col_width).abs() > 1e-9)
        });
        let info = ColInfo {
            width,
            hidden: attr_bool(el, "hidden").unwrap_or(false),
            style: attr_parse::<usize>(el, "style")
                .map(|s| self.style(s))
                .filter(|s| !s.is_default()),
        };
        if info.is_default() {
            return Ok(());
        }
        for col in (min - 1)..=(max - 1).min(MAX_COL) {
            self.wb.set_col_info(self.sheet, col, info)?;
        }
        Ok(())
    }

    fn load_row(&mut self, el: &BytesStart<'_>, row: u32) -> Result<()> {
        let height = attr_parse::<f64>(el, "ht")
            .filter(|h| h.is_finite() && *h >= 0.0 && attr_bool(el, "customHeight") == Some(true));
        let style = if attr_bool(el, "customFormat") == Some(true) {
            attr_parse::<usize>(el, "s")
                .map(|s| self.style(s))
                .filter(|s| !s.is_default())
        } else {
            None
        };
        let info = RowInfo {
            height,
            hidden: attr_bool(el, "hidden").unwrap_or(false),
            style,
        };
        if !info.is_default() {
            self.wb.set_row_info(self.sheet, row, info)?;
        }
        Ok(())
    }

    /// The formula of `cell` as `(input text, AST)`, if it has a usable one.
    fn formula_of(&mut self, cell: &CellBuf) -> Option<(String, Expr)> {
        let f = cell.f.as_ref()?;
        let at = cell_name(cell.row, cell.col);
        match f.kind.as_str() {
            "shared" if f.text.trim().is_empty() => {
                let si = f.si?;
                let Some((master, mr, mc)) = self.shared.get(&si) else {
                    self.warn(format!(
                        "{at}: shared formula {si} has no master; cached value kept"
                    ));
                    return None;
                };
                let ast = offset_relative(
                    master,
                    i64::from(cell.row) - i64::from(*mr),
                    i64::from(cell.col) - i64::from(*mc),
                );
                return Some((format!("={ast}"), ast));
            }
            "dataTable" => {
                self.warn(format!(
                    "{at}: data table formula dropped; cached value kept"
                ));
                return None;
            }
            "array" => self.warn(format!(
                "{at}: array formula loaded as a plain formula of its top-left cell"
            )),
            _ => {}
        }
        if f.text.trim().is_empty() {
            return None;
        }
        let input = format!("={}", strip_xlfn_prefixes(&f.text));
        match engine_formula::parse(&input) {
            Ok(ast) => {
                if f.kind == "shared" {
                    if let Some(si) = f.si {
                        self.shared.insert(si, (ast.clone(), cell.row, cell.col));
                    }
                }
                Some((input, ast))
            }
            Err(e) => {
                self.warn(format!(
                    "{at}: formula {input:?} not supported ({e}); cached value kept"
                ));
                None
            }
        }
    }

    fn constant_of(&mut self, cell: &CellBuf) -> Option<Value> {
        let at = || cell_name(cell.row, cell.col);
        let v = cell.v.as_deref();
        Some(match cell.t.as_str() {
            "s" => {
                let idx: usize = v?.trim().parse().ok()?;
                match self.sst.get(idx) {
                    Some(s) => Value::Text(s.clone()),
                    None => {
                        self.warn(format!("{}: shared string {idx} out of range", at()));
                        return None;
                    }
                }
            }
            "inlineStr" => Value::Text(decode_x_escapes(cell.is.as_deref().or(v)?).into_owned()),
            "str" => Value::Text(decode_x_escapes(v?).into_owned()),
            "b" => Value::Bool(parse_bool(v?).unwrap_or(false)),
            "e" => match v?.trim().parse::<ErrorKind>() {
                Ok(k) => Value::Error(k),
                Err(_) => {
                    self.warn(format!("{}: unknown error {:?} kept as text", at(), v?));
                    Value::Text(v?.to_owned())
                }
            },
            "d" => {
                self.warn(format!("{}: ISO date cell kept as text", at()));
                Value::Text(v?.to_owned())
            }
            _ => match v?.trim() {
                "" => return None,
                s => match s.parse::<f64>() {
                    Ok(n) if n.is_finite() => Value::Number(n),
                    _ => {
                        self.warn(format!("{}: invalid number {s:?} dropped", at()));
                        return None;
                    }
                },
            },
        })
    }

    fn finish_cell(&mut self, cell: CellBuf) -> Result<()> {
        let c = CellCoord::new(self.sheet, cell.row, cell.col);
        let style = self.style(cell.xf);
        if !style.is_default() {
            self.wb.set_style(c, style)?;
        }
        let content = match self.formula_of(&cell) {
            Some((text, ast)) => Some(CellContent::Formula { text, ast }),
            None => self.constant_of(&cell).map(CellContent::Value),
        };
        if let Some(content) = content {
            self.wb.set_content(c, content)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_strings_rich_text_and_preserve() {
        let xml = r#"<sst xmlns="x" count="5" uniqueCount="5">
            <si><t>plain</t></si>
            <si><r><rPr><b/></rPr><t>Rich </t></r><r><t xml:space="preserve"> text</t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si>
            <si><t xml:space="preserve">  padded  </t></si>
            <si/>
            <si><t>a &amp; b&#x41;_x000D_</t></si>
        </sst>"#;
        let sst = parse_sst(xml.as_bytes(), "sst").unwrap();
        assert_eq!(
            sst,
            vec!["plain", "Rich  text", "  padded  ", "", "a & bA\r"]
        );
    }

    #[test]
    fn workbook_info() {
        let xml = br#"<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets>
            <sheet name="A &amp; B" sheetId="1" r:id="rId3"/><sheet name="H" sheetId="2" state="hidden" r:id="rId4"/></sheets>
            <definedNames><definedName name="x">A!$A$1</definedName></definedNames></workbook>"#;
        let info = parse_workbook(xml, "wb").unwrap();
        assert!(info.date1904);
        assert_eq!(info.defined_names, 1);
        assert_eq!(info.sheets[0].name, "A & B");
        assert_eq!(info.sheets[0].rid, "rId3");
        assert!(!info.sheets[0].hidden && info.sheets[1].hidden);
    }
}
