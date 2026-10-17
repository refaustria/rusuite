//! `.xlsx` → [`Workbook`].

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{offset_relative, CellContent, CellCoord, ErrorKind, Expr, SheetId, Value};
use fmt_ooxml::theme::parse_color_scheme;
use fmt_ooxml::{rel, Package, PartName, TargetMode};
use model_sheet::{
    AutoFilter, BuiltinName, ColInfo, Criterion, DefinedName, DynamicFilter, Filter, FilterColumn,
    FilterOp, MergeRect, NameScope, RowInfo, SheetFormat, SheetView, SortKey, SortKind, SortState,
    StyleId, Workbook, MAX_ZOOM, MIN_ZOOM,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::a1::{cell_name, parse_cell, parse_range};
use crate::dynarray::{from_file_ast, legacy_intersection, METADATA_REL};
use crate::styles::parse_styles;
use crate::xlfn::strip_xlfn_prefixes;
use crate::xml::{
    attr, attr_bool, attr_parse, decode_x_escapes, name_of, parse_bool, push_ref, push_text,
    xml_err, xml_error,
};
use crate::{Error, Result, XlsxContext};

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
    let mut book = parse_workbook(part_data(&main)?, main.as_str())?;
    if book.date1904 {
        return Err(Error::Unsupported("date1904".into()));
    }
    let mut consumed: BTreeSet<PartName> = BTreeSet::new();
    consumed.insert(main.clone());
    for p in ["/docProps/core.xml", "/docProps/app.xml"] {
        consumed.insert(PartName::new(p)?);
    }

    // Theme.
    let mut context = XlsxContext::default();
    if let Some(theme) = pkg.related_part(&main, rel::THEME) {
        if let Some(p) = pkg.part(&theme) {
            context.color_scheme =
                parse_color_scheme(&p.data, theme.as_str()).map_err(xml_error)?;
            context.theme_xml = Some(p.data.clone());
            consumed.insert(theme);
        }
    }

    // Styles.
    let mut wb = Workbook::new();
    let mut xf_ids: Vec<StyleId> = Vec::new();
    let mut dxfs: Vec<model_sheet::DxfStyle> = Vec::new();
    let mut num_fmts: HashMap<u32, String> = HashMap::new();
    if let Some(styles) = pkg.related_part(&main, rel::STYLES) {
        let parsed = parse_styles(part_data(&styles)?, styles.as_str(), &mut |w| {
            warnings.push(w)
        })?;
        xf_ids = parsed.xfs.iter().map(|s| wb.intern_style(s)).collect();
        context.default_font = Some(parsed.default_font);
        dxfs = parsed.dxfs;
        num_fmts = parsed.num_fmts;
        if let Err(e) = wb.set_table_styles(parsed.table_styles) {
            warnings.push(format!("table styles dropped: {e}"));
        }
        consumed.insert(styles);
    }

    // Dynamic array metadata: every `t="array"` formula spills anyway.
    if let Some(part) = pkg.related_part(&main, METADATA_REL) {
        consumed.insert(part);
    }

    // Shared strings.
    let mut sst: Vec<String> = Vec::new();
    if let Some(part) = pkg.related_part(&main, rel::SHARED_STRINGS) {
        sst = parse_sst(part_data(&part)?, part.as_str())?;
        consumed.insert(part);
    }

    // Sheets: create all first so that cross-sheet formulas resolve.
    let rels = pkg.relationships(&main);
    let mut sheets: Vec<(SheetId, String, PartName)> = Vec::new();
    let mut hidden: Vec<(SheetId, bool, bool)> = Vec::new();
    for entry in &book.sheets {
        let rel = rels.and_then(|r| r.get(&entry.rid));
        let Some(rel) = rel.filter(|r| r.target_mode == TargetMode::Internal) else {
            warnings.push(format!("sheet {:?} has no part; dropped", entry.name));
            continue;
        };
        if rel.rel_type != rel::WORKSHEET {
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
        consumed.insert(part.clone());
        sheets.push((id, entry.name.clone(), part));
        hidden.push((id, entry.hidden, entry.very_hidden));
    }
    if sheets.is_empty() {
        return Err(Error::Malformed {
            part: main.to_string(),
            reason: "no worksheets".into(),
        });
    }

    // Defined names before the cells: formulas using them register edges.
    let by_index: HashMap<usize, SheetId> = book
        .sheets
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            sheets
                .iter()
                .find(|(_, n, _)| *n == e.name)
                .map(|(id, _, _)| (i, *id))
        })
        .collect();
    // A slicer cache's `#N/A` name is not a user name.
    let slicer_names = crate::slicer::cache_names(&pkg, &main, &book.slicer_caches);
    let names: Vec<RawName> = book
        .defined_names
        .drain(..)
        .filter(|n| n.local.is_some() || !slicer_names.contains(&n.name.to_ascii_lowercase()))
        .collect();
    load_names(&mut wb, &names, &by_index, &mut warnings);
    // Tables before the cells: structured references register edges.
    warnings.extend(crate::tables::load(&pkg, &mut wb, &sheets, &mut consumed)?);

    wb.begin_batch();
    let mut drawings: Vec<(SheetId, String, PartName)> = Vec::new();
    let mut pending_links: Vec<(SheetId, String, PartName, Vec<RawLink>)> = Vec::new();
    let loaded = (|| -> Result<()> {
        for (id, name, part) in &sheets {
            let mut loader = SheetLoader {
                wb: &mut wb,
                sheet: *id,
                sheet_name: name,
                xf_ids: &xf_ids,
                dxfs: &dxfs,
                sst: &sst,
                warnings: &mut warnings,
                shared: HashMap::new(),
                arrays: Vec::new(),
                drawing: None,
                links: Vec::new(),
            };
            loader.load(part_data(part)?, part.as_str())?;
            let links = std::mem::take(&mut loader.links);
            if !links.is_empty() {
                pending_links.push((*id, name.clone(), part.clone(), links));
            }
            if let Some(rid) = loader.drawing.take() {
                let target = pkg
                    .relationships(part)
                    .and_then(|r| r.get(&rid))
                    .filter(|r| r.target_mode == TargetMode::Internal && r.rel_type == rel::DRAWING)
                    .map(|r| part.resolve(&r.target))
                    .transpose()?;
                match target {
                    Some(d) => drawings.push((*id, name.clone(), d)),
                    None => warnings.push(format!("sheet {name:?}: drawing {rid} is missing")),
                }
            }
        }
        Ok(())
    })();
    wb.end_batch();
    loaded?;

    // Charts last: their references need every sheet.
    let mut slicer_anchors: HashMap<SheetId, Vec<(String, model_sheet::ChartAnchor)>> =
        HashMap::new();
    for (id, name, part) in &drawings {
        let anchors = slicer_anchors.entry(*id).or_default();
        for w in crate::drawing::load(&pkg, &mut wb, *id, part, &mut consumed, anchors)? {
            warnings.push(format!("sheet {name:?}: {w}"));
        }
    }

    for (id, name, part, links) in pending_links {
        for w in load_links(&pkg, &mut wb, id, &part, links) {
            warnings.push(format!("sheet {name:?}: {w}"));
        }
    }

    // Notes and threaded comments.
    let persons = crate::comments::load_persons(&pkg, &main, &mut consumed)?;
    wb.set_persons(persons.clone());
    for (id, name, part) in &sheets {
        for w in crate::comments::load(&pkg, &mut wb, *id, part, &persons, &mut consumed)? {
            warnings.push(format!("sheet {name:?}: {w}"));
        }
    }

    // Pivot tables: the cells are loaded; definitions attach to them.
    if !book.pivot_caches.is_empty() {
        warnings.extend(crate::pivot::load(
            &pkg,
            &main,
            &mut wb,
            &book.pivot_caches,
            &sheets,
            &num_fmts,
            &mut consumed,
        )?);
        // GETPIVOTDATA reads the tables.
        wb.recalc_all();
    }

    // Slicers: their tables and pivot tables are loaded.
    if !book.slicer_caches.is_empty() {
        warnings.extend(crate::slicer::load(
            &pkg,
            &main,
            &mut wb,
            &book.slicer_caches,
            &sheets,
            &slicer_anchors,
            &mut consumed,
        ));
    }

    // Visibility last: hiding needs another visible sheet.
    for &(id, is_hidden, very) in &hidden {
        if is_hidden && wb.set_sheet_visibility(id, true, very).is_err() {
            let name = wb.engine().sheet_name(id).unwrap_or_default().to_owned();
            warnings.push(format!(
                "sheet {name:?}: every sheet is hidden; this one is shown"
            ));
        }
    }

    wb.set_workbook_protection(book.protection.clone());
    if let Some(&id) = by_index.get(&book.active_tab) {
        wb.set_active_sheet(Some(id));
    }

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

/// Stores the hyperlinks of a sheet: external targets come from the
/// sheet's relationships (`mailto:` becomes an e-mail link), `location`
/// alone is a place in the workbook. Returns warnings.
fn load_links(
    pkg: &Package,
    wb: &mut Workbook,
    sheet: SheetId,
    part: &PartName,
    links: Vec<RawLink>,
) -> Vec<String> {
    let mut warnings = Vec::new();
    let rels = pkg.relationships(part);
    let mut out = Vec::new();
    for l in links {
        let Some((r0, c0, r1, c1)) = parse_range(&l.r#ref) else {
            warnings.push(format!("hyperlink on {:?} dropped", l.r#ref));
            continue;
        };
        let url = l
            .rid
            .as_deref()
            .and_then(|id| rels.and_then(|r| r.get(id)))
            .map(|r| r.target.clone());
        let target = match (url, l.location) {
            (Some(u), Some(loc)) if !loc.is_empty() => {
                model_sheet::LinkTarget::from_url(&format!("{u}#{loc}"))
            }
            (Some(u), _) => model_sheet::LinkTarget::from_url(&u),
            (None, Some(loc)) => model_sheet::LinkTarget::Location { location: loc },
            (None, None) => {
                warnings.push(format!("hyperlink on {} without target dropped", l.r#ref));
                continue;
            }
        };
        out.push(model_sheet::Hyperlink {
            r0: r0.min(r1),
            c0: c0.min(c1),
            r1: r0.max(r1),
            c1: c0.max(c1),
            target,
            display: l.display,
            tooltip: l.tooltip,
        });
    }
    if let Err(e) = wb.set_hyperlinks(sheet, out) {
        warnings.push(format!("hyperlinks dropped: {e}"));
    }
    warnings
}

// --- workbook.xml ------------------------------------------------------------

struct SheetEntry {
    name: String,
    rid: String,
    /// `state="hidden"` or `"veryHidden"`.
    hidden: bool,
    very_hidden: bool,
}

/// A `<definedName>` as written.
struct RawName {
    name: String,
    /// Index into `<sheets>`.
    local: Option<usize>,
    hidden: bool,
    comment: Option<String>,
    text: String,
}

struct BookInfo {
    sheets: Vec<SheetEntry>,
    date1904: bool,
    defined_names: Vec<RawName>,
    /// `<pivotCaches>`: `(cacheId, r:id)`.
    pivot_caches: Vec<(u32, String)>,
    /// The `x14:slicerCache` relationship ids of the workbook `extLst`.
    slicer_caches: Vec<String>,
    protection: Option<model_sheet::WorkbookProtection>,
    /// `<workbookView activeTab>`: position in `<sheets>`.
    active_tab: usize,
}

fn parse_workbook(xml: &[u8], part: &str) -> Result<BookInfo> {
    let mut reader = Reader::from_reader(xml);
    let mut info = BookInfo {
        sheets: Vec::new(),
        date1904: false,
        defined_names: Vec::new(),
        pivot_caches: Vec::new(),
        slicer_caches: Vec::new(),
        protection: None,
        active_tab: 0,
    };
    let mut name: Option<RawName> = None;
    loop {
        match reader.read_event().map_err(xml_err(part))? {
            Event::Start(el) if name_of(&el) == b"definedName" => {
                name = Some(RawName {
                    name: attr(&el, "name").unwrap_or_default().into_owned(),
                    local: attr_parse(&el, "localSheetId"),
                    hidden: attr_bool(&el, "hidden").unwrap_or(false),
                    comment: attr(&el, "comment").map(|c| decode_x_escapes(&c).into_owned()),
                    text: String::new(),
                });
            }
            Event::Text(t) => {
                if let Some(n) = name.as_mut() {
                    push_text(&mut n.text, &t);
                }
            }
            Event::GeneralRef(r) => {
                if let Some(n) = name.as_mut() {
                    push_ref(&mut n.text, &r);
                }
            }
            Event::End(el) if crate::xml::end_name(&el) == b"definedName" => {
                if let Some(n) = name.take() {
                    info.defined_names.push(n);
                }
            }
            Event::Start(el) | Event::Empty(el) => match name_of(&el) {
                b"workbookPr" => info.date1904 = attr_bool(&el, "date1904").unwrap_or(false),
                b"workbookProtection" => {
                    info.protection = crate::protection::workbook_protection_of(&el);
                }
                b"workbookView" if info.active_tab == 0 => {
                    info.active_tab = attr_parse(&el, "activeTab").unwrap_or(0);
                }
                b"slicerCache" => {
                    if let Some(rid) = attr(&el, "id") {
                        info.slicer_caches.push(rid.into_owned());
                    }
                }
                b"pivotCache" => {
                    if let (Some(id), Some(rid)) =
                        (attr_parse::<u32>(&el, "cacheId"), attr(&el, "id"))
                    {
                        info.pivot_caches.push((id, rid.into_owned()));
                    }
                }
                b"sheet" => {
                    let (Some(name), Some(rid)) = (attr(&el, "name"), attr(&el, "id")) else {
                        return Err(Error::Malformed {
                            part: part.into(),
                            reason: "<sheet> without name or r:id".into(),
                        });
                    };
                    let state = attr(&el, "state");
                    info.sheets.push(SheetEntry {
                        name: name.into_owned(),
                        rid: rid.into_owned(),
                        hidden: state.as_deref().is_some_and(|s| s != "visible"),
                        very_hidden: state.as_deref() == Some("veryHidden"),
                    });
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(info)
}

/// `Sheet1!#REF!` (Excel's text for a deleted reference) as `#REF!`, which
/// the formula grammar reads.
fn drop_sheet_ref_errors(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("!#REF!") {
        let head = &rest[..i];
        let start = if let Some(inner) = head.strip_suffix('\'') {
            // A quoted sheet name: back to its opening quote.
            inner.rfind('\'').unwrap_or(0)
        } else {
            head.rfind(|c: char| !(c.is_alphanumeric() || c == '_' || c == '.'))
                .map_or(0, |p| p + 1)
        };
        out.push_str(&head[..start]);
        out.push_str("#REF!");
        rest = &rest[i + 6..];
    }
    out.push_str(rest);
    out
}

/// Defines the workbook's names (`_xlnm._FilterDatabase` comes from the
/// AutoFilter; `_xlfn.*` names are Excel's placeholders for functions it
/// did not know and are dropped too).
fn load_names(
    wb: &mut Workbook,
    names: &[RawName],
    by_index: &HashMap<usize, SheetId>,
    warnings: &mut Vec<String>,
) {
    for raw in names {
        let lower = raw.name.to_ascii_lowercase();
        if lower == "_xlnm._filterdatabase" || lower.starts_with("_xlfn.") {
            continue;
        }
        let scope = match raw.local {
            None => NameScope::Workbook,
            Some(i) => match by_index.get(&i) {
                Some(id) => NameScope::Sheet(*id),
                None => {
                    warnings.push(format!(
                        "defined name {:?}: its sheet is missing; dropped",
                        raw.name
                    ));
                    continue;
                }
            },
        };
        let builtin = BuiltinName::from_file_name(&raw.name);
        let name = builtin.map_or_else(|| raw.name.clone(), |b| b.display().to_string());
        let text = strip_xlfn_prefixes(&drop_sheet_ref_errors(raw.text.trim()));
        let def = DefinedName {
            name,
            scope,
            refers_to: text,
            comment: raw.comment.clone(),
            hidden: raw.hidden,
            builtin,
        };
        if let Err(e) = wb.define_name(&def) {
            warnings.push(format!(
                "defined name {:?} ({}) dropped: {e}",
                raw.name, raw.text
            ));
        }
    }
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

/// `showGridLines`, `showRowColHeaders` and `zoomScale` of a `<sheetView>`
/// (a zoom outside Excel's 10..=400 is clamped; 0 means 100).
fn read_view_attrs(el: &BytesStart<'_>, view: &mut SheetView) {
    view.show_gridlines = attr_bool(el, "showGridLines").unwrap_or(true);
    view.show_headings = attr_bool(el, "showRowColHeaders").unwrap_or(true);
    view.zoom = match attr_parse::<u32>(el, "zoomScale") {
        None | Some(0) => 100,
        Some(z) => z.clamp(u32::from(MIN_ZOOM), u32::from(MAX_ZOOM)) as u16,
    };
}

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
    /// `ref` of an array formula (its spill range).
    range: Option<String>,
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
    (b"picture", "background picture"),
    (b"oleObjects", "OLE objects"),
    (b"controls", "form controls"),
];

struct SheetLoader<'a> {
    wb: &'a mut Workbook,
    sheet: SheetId,
    sheet_name: &'a str,
    xf_ids: &'a [StyleId],
    /// Differential formats of `styles.xml` (conditional formatting).
    dxfs: &'a [model_sheet::DxfStyle],
    sst: &'a [String],
    warnings: &'a mut Vec<String>,
    /// Shared formula index → (master AST, master row, master col).
    shared: HashMap<u32, (Expr, u32, u32)>,
    /// `(r0, c0, r1, c1)` of the array formulas read so far: their other
    /// cells hold the spilled values, which are not loaded.
    arrays: Vec<(u32, u32, u32, u32)>,
    /// `r:id` of the sheet's `<drawing>`.
    drawing: Option<String>,
    /// The `<hyperlink>` elements, resolved after loading.
    links: Vec<RawLink>,
}

/// A `<hyperlink>` as written.
pub(crate) struct RawLink {
    pub r#ref: String,
    pub rid: Option<String>,
    pub location: Option<String>,
    pub display: Option<String>,
    pub tooltip: Option<String>,
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
        let mut view = SheetView::default();
        // 0 = before the first <sheetView>, 1 = inside it, 2 = after it
        // (only the first view is read).
        let mut view_state = 0u8;
        let mut filter = FilterReader::default();
        // `<rowBreaks>` / `<colBreaks>` being read, and the breaks.
        let mut breaks_axis: Option<model_sheet::Axis> = None;
        let mut row_breaks: Vec<u32> = Vec::new();
        let mut col_breaks: Vec<u32> = Vec::new();
        // `<conditionalFormatting>`, `<dataValidations>`, `<extLst>`.
        let mut rules: Vec<fmt_ooxml::xml::El> = Vec::new();
        loop {
            let ev = reader.read_event().map_err(xml_err(part))?;
            match ev {
                Event::Start(ref el) | Event::Empty(ref el) => {
                    let empty = matches!(ev, Event::Empty(_));
                    match name_of(el) {
                        b"sheetProtection" => {
                            let p = crate::protection::sheet_protection_of(el);
                            self.wb.set_sheet_protection(self.sheet, Some(p))?;
                        }
                        b"tabColor" => {
                            let color = crate::styles::color_of_el(el);
                            self.wb.set_tab_color(self.sheet, color)?;
                        }
                        b"outlinePr" => {
                            let props = model_sheet::OutlineProps {
                                summary_below: attr_bool(el, "summaryBelow").unwrap_or(true),
                                summary_right: attr_bool(el, "summaryRight").unwrap_or(true),
                            };
                            self.wb.set_outline_props(self.sheet, props)?;
                        }
                        b"rowBreaks" if !empty => breaks_axis = Some(model_sheet::Axis::Rows),
                        b"colBreaks" if !empty => breaks_axis = Some(model_sheet::Axis::Cols),
                        b"brk" => {
                            let id = attr_parse::<u32>(el, "id").filter(|&i| i > 0);
                            match (breaks_axis, id) {
                                (Some(model_sheet::Axis::Rows), Some(i)) => row_breaks.push(i),
                                (Some(model_sheet::Axis::Cols), Some(i)) => col_breaks.push(i),
                                _ => {}
                            }
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
                                range: attr(el, "ref").map(|r| r.into_owned()),
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
                        b"sheetView" if view_state == 0 => {
                            view_state = if empty { 2 } else { 1 };
                            read_view_attrs(el, &mut view);
                        }
                        b"pane" if view_state == 1 => {
                            let state = attr(el, "state");
                            if state.as_deref().is_some_and(|s| s.starts_with("frozen")) {
                                let split = |name| {
                                    attr_parse::<f64>(el, name)
                                        .filter(|v| v.is_finite() && *v >= 0.0)
                                        .map_or(0, |v| v.round() as u32)
                                };
                                view.frozen_rows = split("ySplit").min(MAX_ROW);
                                view.frozen_cols = split("xSplit").min(MAX_COL);
                            } else {
                                dropped.insert("split panes");
                            }
                        }
                        name if filter.start(name, el, empty) => {}
                        b"drawing" => self.drawing = attr(el, "id").map(|r| r.into_owned()),
                        b"hyperlink" => {
                            let get = |n| attr(el, n).map(|v| v.into_owned());
                            if let Some(r) = get("ref") {
                                self.links.push(RawLink {
                                    r#ref: r,
                                    rid: get("id"),
                                    location: get("location"),
                                    display: get("display"),
                                    tooltip: get("tooltip"),
                                });
                            }
                        }
                        b"conditionalFormatting" | b"dataValidations" | b"extLst" => {
                            if !empty {
                                let span = reader.read_to_end(el.name()).map_err(xml_err(part))?;
                                let inner = &xml[span.start as usize..span.end as usize];
                                rules.push(crate::condfmt::subtree(el, inner, part)?);
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
                        b"rowBreaks" | b"colBreaks" => breaks_axis = None,
                        b"sheetView" if view_state == 1 => view_state = 2,
                        b"filterColumn" | b"sortState" => filter.end(name),
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
        self.wb.set_sheet_view(self.sheet, view)?;
        self.wb
            .set_page_breaks(self.sheet, model_sheet::Axis::Rows, row_breaks)?;
        self.wb
            .set_page_breaks(self.sheet, model_sheet::Axis::Cols, col_breaks)?;
        let mut bad: Vec<String> = Vec::new();
        for r in merged {
            let rect = r.split_once(':').and_then(|(a, b)| {
                let (r0, c0) = parse_cell(a)?;
                let (r1, c1) = parse_cell(b)?;
                Some(MergeRect::new(
                    r0.min(r1),
                    c0.min(c1),
                    r0.max(r1),
                    c0.max(c1),
                ))
            });
            match rect {
                Some(rect) if self.wb.add_merge(self.sheet, rect).is_ok() => {}
                _ => bad.push(r),
            }
        }
        if !bad.is_empty() {
            self.warn(format!("invalid merged cells dropped: {}", bad.join(", ")));
        }
        for what in dropped {
            self.warn(format!("{what} dropped"));
        }
        for w in crate::condfmt::load(self.wb, self.sheet, &rules, self.dxfs)? {
            self.warn(w);
        }
        self.finish_filter(filter)
    }

    /// Stores the AutoFilter and sort state read from the sheet. With
    /// active column filters, the hidden rows of the filter range are the
    /// rows the filter hid (the file does not tell them apart from rows
    /// hidden by hand).
    fn finish_filter(&mut self, f: FilterReader) -> Result<()> {
        for w in f.warnings {
            self.warn(w);
        }
        if let Some(mut af) = f.auto_filter {
            let before = af.columns.len();
            let (c0, c1) = (af.c0, af.c1);
            af.columns.retain(|c| (c0..=c1).contains(&c.col));
            if af.columns.len() != before {
                self.warn("filter columns outside the AutoFilter range dropped".into());
            }
            let rows: Vec<(u32, RowInfo)> = if af.columns.is_empty() {
                Vec::new()
            } else {
                self.wb
                    .rows(self.sheet)
                    .filter(|(r, info)| info.hidden && (af.r0 + 1..=af.r1).contains(r))
                    .collect()
            };
            self.wb.set_auto_filter(self.sheet, Some(af))?;
            for (r, info) in rows {
                let info = RowInfo {
                    filtered: true,
                    ..info
                };
                self.wb.set_row_info(self.sheet, r, info)?;
            }
        }
        if let Some(st) = f.sort_state.filter(|s| !s.keys.is_empty()) {
            self.wb.set_sort_state(self.sheet, Some(st))?;
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
            outline_level: attr_parse::<u8>(el, "outlineLevel").unwrap_or(0).min(7),
            collapsed: attr_bool(el, "collapsed").unwrap_or(false),
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
            filtered: false,
            outline_level: attr_parse::<u8>(el, "outlineLevel").unwrap_or(0).min(7),
            collapsed: attr_bool(el, "collapsed").unwrap_or(false),
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
            _ => {}
        }
        if f.text.trim().is_empty() {
            return None;
        }
        let input = format!("={}", strip_xlfn_prefixes(&f.text));
        match engine_formula::parse(&input) {
            Ok(parsed) => {
                // `ANCHORARRAY`/`SINGLE` → `#`/`@`; plain (legacy) formulas
                // intersect implicitly where Excel 2019 did. Array formulas
                // (dynamic or CSE) spill over their `ref`.
                let mut ast = from_file_ast(&parsed);
                let structured = crate::tables::has_structured(&ast);
                if structured {
                    let own = self
                        .wb
                        .table_at(CellCoord::new(self.sheet, cell.row, cell.col))
                        .map(|t| t.name.clone());
                    ast = crate::tables::to_display_refs(&ast, own.as_deref());
                }
                if f.kind == "array" {
                    let (r0, c0, r1, c1) = f
                        .range
                        .as_deref()
                        .and_then(parse_range)
                        .unwrap_or((cell.row, cell.col, cell.row, cell.col));
                    self.arrays.push((r0, c0, r1, c1));
                } else {
                    ast = legacy_intersection(&ast);
                }
                let input = if ast == parsed && !structured {
                    input
                } else {
                    format!("={ast}")
                };
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
        let formula = self.formula_of(&cell);
        let spilled = self.arrays.iter().any(|&(r0, c0, r1, c1)| {
            (r0..=r1).contains(&cell.row)
                && (c0..=c1).contains(&cell.col)
                && (cell.row, cell.col) != (r0, c0)
        });
        let content = match formula {
            Some((text, ast)) => Some(CellContent::Formula { text, ast }),
            // The cached value of a cell an array formula spills into.
            None if spilled => None,
            None => self.constant_of(&cell).map(CellContent::Value),
        };
        if let Some(content) = content {
            self.wb.set_content(c, content)?;
        }
        Ok(())
    }
}

/// Collects `<autoFilter>` (with its `<filterColumn>`s) and `<sortState>`
/// (top level or inside `<autoFilter>`) while a sheet is streamed.
#[derive(Default)]
pub(crate) struct FilterReader {
    pub(crate) auto_filter: Option<AutoFilter>,
    /// The `<filterColumn>` being read: absolute column, filter so far,
    /// and whether it holds something unsupported.
    column: Option<(u32, Option<Filter>, bool)>,
    sort_state: Option<SortState>,
    in_sort: bool,
    pub(crate) warnings: Vec<String>,
}

/// The literal text of a wildcard pattern without unescaped wildcards
/// (`~*` → `*`); `None` if it has a wildcard or is empty.
fn literal(s: &str) -> Option<String> {
    let mut out = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        match c {
            '*' | '?' => return None,
            '~' => out.push(it.next()?),
            c => out.push(c),
        }
    }
    (!out.is_empty()).then_some(out)
}

/// A `customFilter` as a criterion; `*x*`, `x*` and `*x` patterns become
/// the contains family (the form Excel stores them in).
fn filter_op(op: &str, val: &str) -> Option<(FilterOp, String)> {
    let inner = |s: &str| {
        s.strip_prefix('*')
            .and_then(|s| s.strip_suffix('*'))
            .and_then(literal)
    };
    let starts = |s: &str| s.strip_suffix('*').and_then(literal);
    let ends = |s: &str| s.strip_prefix('*').and_then(literal);
    Some(match op {
        "equal" => {
            if let Some(v) = inner(val) {
                (FilterOp::Contains, v)
            } else if let Some(v) = starts(val) {
                (FilterOp::BeginsWith, v)
            } else if let Some(v) = ends(val) {
                (FilterOp::EndsWith, v)
            } else {
                (FilterOp::Eq, val.into())
            }
        }
        "notEqual" => match inner(val) {
            Some(v) => (FilterOp::NotContains, v),
            None => (FilterOp::Ne, val.into()),
        },
        "greaterThan" => (FilterOp::Gt, val.into()),
        "greaterThanOrEqual" => (FilterOp::Ge, val.into()),
        "lessThan" => (FilterOp::Lt, val.into()),
        "lessThanOrEqual" => (FilterOp::Le, val.into()),
        _ => return None,
    })
}

impl FilterReader {
    /// Handles an opening tag; `false` if it is not a filter element.
    pub(crate) fn start(&mut self, name: &[u8], el: &BytesStart<'_>, empty: bool) -> bool {
        let range = |el: &BytesStart<'_>| attr(el, "ref").and_then(|r| parse_range(&r));
        match name {
            b"autoFilter" => match range(el) {
                Some((r0, c0, r1, c1)) => self.auto_filter = Some(AutoFilter::new(r0, c0, r1, c1)),
                None => self
                    .warnings
                    .push("auto filter without a valid range dropped".into()),
            },
            b"filterColumn" => {
                let base = self.auto_filter.as_ref().map(|af| af.c0);
                let id = attr_parse::<u32>(el, "colId");
                if let (Some(base), Some(id), false) = (base, id, empty) {
                    self.column = Some((base.saturating_add(id), None, false));
                }
            }
            b"sortState" => {
                self.in_sort = !empty;
                self.sort_state = range(el).map(|(r0, c0, r1, c1)| SortState {
                    r0,
                    c0,
                    r1,
                    c1,
                    keys: Vec::new(),
                    case_sensitive: attr_bool(el, "caseSensitive").unwrap_or(false),
                });
            }
            b"sortCondition" if self.in_sort => {
                let by = attr(el, "sortBy");
                let col = range(el).map(|(_, c0, _, _)| c0);
                match (self.sort_state.as_mut(), col) {
                    (Some(st), Some(col)) if by.as_deref().unwrap_or("value") == "value" => {
                        st.keys.push(SortKey {
                            col,
                            ascending: !attr_bool(el, "descending").unwrap_or(false),
                            kind: SortKind::Auto,
                        });
                    }
                    _ => self
                        .warnings
                        .push("sort condition by colour or icon dropped".into()),
                }
            }
            _ => {
                let Some((_, filter, bad)) = self.column.as_mut() else {
                    return false;
                };
                match name {
                    b"filters" => {
                        let blank = attr_bool(el, "blank").unwrap_or(false);
                        *filter = Some(Filter::Values {
                            values: if blank {
                                vec![String::new()]
                            } else {
                                Vec::new()
                            },
                        });
                    }
                    b"filter" => {
                        if let (Some(Filter::Values { values }), Some(v)) =
                            (filter.as_mut(), attr(el, "val"))
                        {
                            values.push(decode_x_escapes(&v).into_owned());
                        }
                    }
                    b"customFilters" => {
                        *filter = Some(Filter::Custom {
                            criteria: Vec::new(),
                            and: attr_bool(el, "and").unwrap_or(false),
                        });
                    }
                    b"customFilter" => {
                        let op =
                            attr(el, "operator").map_or_else(|| "equal".into(), |o| o.into_owned());
                        let val = attr(el, "val")
                            .map(|v| decode_x_escapes(&v).into_owned())
                            .unwrap_or_default();
                        match (filter.as_mut(), filter_op(&op, &val)) {
                            (Some(Filter::Custom { criteria, .. }), Some((op, value))) => {
                                criteria.push(Criterion { op, value });
                            }
                            _ => *bad = true,
                        }
                    }
                    b"top10" => {
                        *filter = Some(Filter::Top10 {
                            top: attr_bool(el, "top").unwrap_or(true),
                            percent: attr_bool(el, "percent").unwrap_or(false),
                            value: attr_parse::<f64>(el, "val")
                                .filter(|v| v.is_finite())
                                .unwrap_or(10.0),
                        });
                    }
                    b"dynamicFilter" => {
                        let kind = match attr(el, "type").as_deref() {
                            Some("aboveAverage") => Some(DynamicFilter::AboveAverage),
                            Some("belowAverage") => Some(DynamicFilter::BelowAverage),
                            Some("today") => Some(DynamicFilter::Today),
                            Some("yesterday") => Some(DynamicFilter::Yesterday),
                            Some("tomorrow") => Some(DynamicFilter::Tomorrow),
                            _ => None,
                        };
                        match kind {
                            Some(filter_kind) => {
                                *filter = Some(Filter::Dynamic {
                                    filter: filter_kind,
                                })
                            }
                            None => *bad = true,
                        }
                    }
                    b"dateGroupItem" | b"colorFilter" | b"iconFilter" => *bad = true,
                    _ => return false,
                }
            }
        }
        true
    }

    /// Handles a closing `</filterColumn>` or `</sortState>`.
    pub(crate) fn end(&mut self, name: &[u8]) {
        if name == b"sortState" {
            self.in_sort = false;
            return;
        }
        let Some((col, filter, bad)) = self.column.take() else {
            return;
        };
        match (filter, bad, self.auto_filter.as_mut()) {
            (Some(filter), false, Some(af)) => af.columns.push(FilterColumn { col, filter }),
            _ => self.warnings.push(format!(
                "unsupported filter of column {} dropped (date groups, colours, icons or other dynamic filters)",
                engine_formula::ast::col_to_letters(col)
            )),
        }
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
        assert_eq!(info.defined_names.len(), 1);
        assert_eq!(info.defined_names[0].text, "A!$A$1");
        assert_eq!(info.sheets[0].name, "A & B");
        assert_eq!(info.sheets[0].rid, "rId3");
        assert!(!info.sheets[0].hidden && info.sheets[1].hidden);
    }
}
