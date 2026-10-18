//! Notes and threaded comments (P8-26).
//!
//! * Notes are legacy comments: `xl/commentsN.xml` (`authors`,
//!   `commentList/comment` with rich `text`) plus a VML drawing
//!   (`xl/drawings/vmlDrawingN.vml`) with one shape per comment that holds
//!   the box (`x:Anchor`) and the visibility (`x:Visible`). A missing or
//!   unreadable VML part is tolerated (default box, hidden).
//! * Threaded comments live in `xl/threadedComments/threadedCommentN.xml`
//!   (`threadedComment` with `id`, `ref`, `dT`, `personId`, `parentId`,
//!   `done`), their authors in the workbook's `xl/persons/person.xml`.
//!   Like Excel, the writer also stores a legacy placeholder comment
//!   (`[Threaded comment] …`, author `tc={id}`) per thread so older
//!   applications show it; the reader prefers the threaded part and skips
//!   the placeholders.

use std::collections::BTreeSet;

use core_model::{FontFace, FontSize, RunProperties, Underline, VerticalAlign};
use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::SheetId;
use fmt_ooxml::xml::{parse, El};
use fmt_ooxml::{Package, PartName, Relationships, TargetMode};
use model_sheet::{Note, NoteBounds, NoteRun, Person, Reply, Thread, Workbook};

use crate::a1::{cell_name, parse_cell};
use crate::styles::{color_el, color_of_dom, MAIN_NS};
use crate::warn::{note, Note as Warn};
use crate::xml::{decode_x_escapes, encode_x_escapes, needs_preserve, xml_error, XmlOut};
use crate::Result;

pub(crate) const COMMENTS_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
pub(crate) const VML_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
pub(crate) const THREADED_REL: &str =
    "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
pub(crate) const PERSON_REL: &str =
    "http://schemas.microsoft.com/office/2017/10/relationships/person";
const COMMENTS_CT: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
const VML_CT: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";
const THREADED_CT: &str = "application/vnd.ms-excel.threadedcomments+xml";
const PERSON_CT: &str = "application/vnd.ms-excel.person+xml";
const THREADED_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";

/// The first line of Excel's legacy placeholder for a threaded comment.
const PLACEHOLDER: &str = "[Threaded comment]";
const PLACEHOLDER_BODY: &str = "Your version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924";

// --- geometry ------------------------------------------------------------------

/// Pixel width of a column (Excel's rounding of character units at the
/// default font: 8.43 → 64 px).
fn col_px(wb: &Workbook, s: SheetId, col: u32) -> f64 {
    let info = wb.col_info(s, col);
    if info.hidden {
        return 0.0;
    }
    let w = info.width.unwrap_or(wb.sheet_format(s).default_col_width);
    if w <= 0.0 {
        0.0
    } else {
        (w * 7.0 + 5.0).round()
    }
}

fn row_px(wb: &Workbook, s: SheetId, row: u32) -> f64 {
    let info = wb.row_info(s, row);
    if info.hidden {
        return 0.0;
    }
    (info.height.unwrap_or(wb.sheet_format(s).default_row_height) * 4.0 / 3.0).round()
}

/// Left edge of column `col` in px.
fn col_start(wb: &Workbook, s: SheetId, col: u32) -> f64 {
    let fmt = wb.sheet_format(s);
    let default = (fmt.default_col_width * 7.0 + 5.0).round();
    let extra: f64 = wb
        .cols(s)
        .take_while(|(c, _)| *c < col)
        .map(|(c, _)| col_px(wb, s, c) - default)
        .sum();
    default * f64::from(col) + extra
}

/// Top edge of row `row` in px.
fn row_start(wb: &Workbook, s: SheetId, row: u32) -> f64 {
    let default = (wb.sheet_format(s).default_row_height * 4.0 / 3.0).round();
    let extra: f64 = wb
        .rows(s)
        .take_while(|(r, _)| *r < row)
        .map(|(r, _)| row_px(wb, s, r) - default)
        .sum();
    default * f64::from(row) + extra
}

/// The index and offset of pixel position `x`, walking from index `i`
/// whose start is `pos`.
fn locate(x: f64, mut i: u32, mut pos: f64, size: impl Fn(u32) -> f64, max: u32) -> (u32, u32) {
    let x = x.max(0.0);
    while x < pos && i > 0 {
        i -= 1;
        pos -= size(i);
    }
    while i < max && x >= pos + size(i) {
        pos += size(i);
        i += 1;
    }
    (i, (x - pos).max(0.0).round() as u32)
}

/// `x:Anchor`: left column, offset, top row, offset, right column,
/// offset, bottom row, offset (px).
type Anchor = [u32; 8];

fn anchor_of(wb: &Workbook, s: SheetId, row: u32, col: u32, b: &NoteBounds) -> Anchor {
    let cx = col_start(wb, s, col) + col_px(wb, s, col);
    let cy = row_start(wb, s, row);
    let left = (cx + b.x / 0.75).round().max(0.0);
    let top = (cy + b.y / 0.75).round().max(0.0);
    let right = left + (b.w / 0.75).round();
    let bottom = top + (b.h / 0.75).round();
    let cols = |x: f64| locate(x, col, col_start(wb, s, col), |c| col_px(wb, s, c), MAX_COL);
    let rows = |y: f64| locate(y, row, cy, |r| row_px(wb, s, r), MAX_ROW);
    let (lc, lo) = cols(left);
    let (tr, to) = rows(top);
    let (rc, ro) = cols(right);
    let (br, bo) = rows(bottom);
    [lc, lo, tr, to, rc, ro, br, bo]
}

fn bounds_of(wb: &Workbook, s: SheetId, row: u32, col: u32, a: &Anchor) -> NoteBounds {
    let cx = col_start(wb, s, col) + col_px(wb, s, col);
    let cy = row_start(wb, s, row);
    let left = col_start(wb, s, a[0]) + f64::from(a[1]);
    let top = row_start(wb, s, a[2]) + f64::from(a[3]);
    let right = col_start(wb, s, a[4]) + f64::from(a[5]);
    let bottom = row_start(wb, s, a[6]) + f64::from(a[7]);
    NoteBounds {
        x: (left - cx) * 0.75,
        y: (top - cy) * 0.75,
        w: ((right - left).max(1.0)) * 0.75,
        h: ((bottom - top).max(1.0)) * 0.75,
    }
}

// --- rich text -------------------------------------------------------------------

fn run_props(rpr: &El) -> RunProperties {
    let mut p = RunProperties::default();
    let on = |e: &El| e.val().and_then(fmt_ooxml::xml::parse_bool).unwrap_or(true);
    for e in rpr.elements() {
        match e.name.as_str() {
            "b" => p.bold = Some(on(e)),
            "i" => p.italic = Some(on(e)),
            "strike" => p.strike = Some(on(e)),
            "u" => {
                p.underline = Some(match e.val() {
                    Some("double") | Some("doubleAccounting") => Underline::Double,
                    Some("none") => Underline::None,
                    _ => Underline::Single,
                })
            }
            "vertAlign" => {
                p.vertical_align = match e.val() {
                    Some("superscript") => Some(VerticalAlign::Superscript),
                    Some("subscript") => Some(VerticalAlign::Subscript),
                    _ => None,
                }
            }
            "sz" => {
                p.size = e
                    .val()
                    .and_then(|v| v.parse::<f64>().ok())
                    .map(FontSize::from_pt)
            }
            "color" => p.color = color_of_dom(e),
            "rFont" => p.font = e.val().map(|v| FontFace::Named(v.to_owned())),
            _ => {}
        }
    }
    p
}

fn t_text(t: &El) -> String {
    decode_x_escapes(&t.text()).into_owned()
}

/// The runs of a `CT_Rst` (`<text>`): a plain `<t>` or `<r>` runs
/// (phonetic runs skipped).
fn read_runs(text: &El) -> Vec<NoteRun> {
    let mut runs = Vec::new();
    for e in text.elements() {
        match e.name.as_str() {
            "t" => runs.push(NoteRun::plain(t_text(e))),
            "r" => runs.push(NoteRun {
                text: e.child("t").map(t_text).unwrap_or_default(),
                font: e.child("rPr").map(run_props).unwrap_or_default(),
            }),
            _ => {}
        }
    }
    runs
}

fn write_t(x: &mut XmlOut, text: &str) {
    let attrs: &[(&str, &str)] = if needs_preserve(text) {
        &[("xml:space", "preserve")]
    } else {
        &[]
    };
    x.text_el("t", attrs, &encode_x_escapes(text));
}

fn write_runs(x: &mut XmlOut, runs: &[NoteRun]) {
    x.start("text", &[]);
    match runs {
        [] => write_t(x, ""),
        [one] if one.font.is_empty() => write_t(x, &one.text),
        _ => {
            for r in runs {
                x.start("r", &[]);
                let f = &r.font;
                if !f.is_empty() {
                    x.start("rPr", &[]);
                    if let Some(b) = f.bold {
                        x.empty("b", if b { &[] } else { &[("val", "0")] });
                    }
                    if let Some(i) = f.italic {
                        x.empty("i", if i { &[] } else { &[("val", "0")] });
                    }
                    if f.strike == Some(true) {
                        x.empty("strike", &[]);
                    }
                    match f.underline {
                        None | Some(Underline::None) => {}
                        Some(Underline::Double) => x.empty("u", &[("val", "double")]),
                        Some(_) => x.empty("u", &[]),
                    }
                    match f.vertical_align {
                        Some(VerticalAlign::Superscript) => {
                            x.empty("vertAlign", &[("val", "superscript")])
                        }
                        Some(VerticalAlign::Subscript) => {
                            x.empty("vertAlign", &[("val", "subscript")])
                        }
                        _ => {}
                    }
                    if let Some(sz) = f.size {
                        x.empty("sz", &[("val", &format!("{}", sz.pt()))]);
                    }
                    if let Some(c) = f.color {
                        color_el(x, "color", c);
                    }
                    if let Some(FontFace::Named(n)) = &f.font {
                        x.empty("rFont", &[("val", n)]);
                    }
                    x.end("rPr");
                }
                write_t(x, &r.text);
                x.end("r");
            }
        }
    }
    x.end("text");
}

// --- reading -----------------------------------------------------------------------

/// Reads `xl/persons/person.xml` (the workbook's `personList`).
pub(crate) fn load_persons(
    pkg: &Package,
    main: &PartName,
    consumed: &mut BTreeSet<PartName>,
) -> Result<Vec<Person>> {
    let Some(part) = pkg.related_part(main, PERSON_REL) else {
        return Ok(Vec::new());
    };
    let Some(data) = pkg.part(&part) else {
        return Ok(Vec::new());
    };
    consumed.insert(part.clone());
    let root = parse(&data.data, part.as_str()).map_err(xml_error)?;
    Ok(root
        .elements()
        .filter(|e| e.name == "person")
        .map(|e| {
            let name = e.attr("displayName").unwrap_or_default().to_owned();
            // `userId` = the name and `providerId` = None are what Rusuite writes without them.
            let user_id = e
                .attr("userId")
                .filter(|u| *u != name)
                .unwrap_or_default()
                .to_owned();
            let provider_id = e
                .attr("providerId")
                .filter(|p| *p != "None")
                .unwrap_or_default()
                .to_owned();
            Person {
                id: e.attr("id").unwrap_or_default().to_owned(),
                name,
                initials: String::new(),
                user_id,
                provider_id,
            }
        })
        .collect())
}

/// One shape of a VML drawing: the comment's cell, anchor, size from
/// the shape style (when there is no anchor) and visibility.
struct VmlShape {
    row: u32,
    col: u32,
    anchor: Option<Anchor>,
    /// `width`/`height` of the shape's style in points.
    size: Option<(f64, f64)>,
    visible: bool,
}

/// `text` with the namespace prefixes of element names removed
/// (`<v:shape` → `<shape`, `</ns0:shape>` → `</shape>`).
fn strip_prefixes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..=i]);
        rest = &rest[i + 1..];
        let slash = rest.starts_with('/');
        if slash {
            out.push('/');
            rest = &rest[1..];
        }
        let name_end = rest
            .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .unwrap_or(rest.len());
        if let Some(colon) = rest[..name_end].find(':') {
            rest = &rest[colon + 1..];
        }
    }
    out.push_str(rest);
    out
}

/// A CSS length (`12pt`, `16px`, `1.5in`) in points.
fn css_pt(v: &str) -> Option<f64> {
    let v = v.trim();
    let num = |s: &str| s.trim().parse::<f64>().ok();
    if let Some(n) = v.strip_suffix("pt") {
        num(n)
    } else if let Some(n) = v.strip_suffix("px") {
        num(n).map(|n| n * 0.75)
    } else if let Some(n) = v.strip_suffix("in") {
        num(n).map(|n| n * 72.0)
    } else {
        num(v).map(|n| n * 0.75)
    }
}

/// Scans a VML drawing for comment shapes. VML from older Excel versions
/// is not always well-formed XML and prefixes vary, so this is a
/// tolerant text scan.
fn scan_vml(data: &[u8]) -> Vec<VmlShape> {
    let text = strip_prefixes(&String::from_utf8_lossy(data));
    let tag = |block: &str, name: &str| -> Option<String> {
        let open = format!("<{name}>");
        let i = block.find(&open)? + open.len();
        let j = block[i..].find("</")? + i;
        Some(block[i..j].trim().to_owned())
    };
    let mut out = Vec::new();
    for block in text.split("<shape ").skip(1) {
        let block = block.split("</shape>").next().unwrap_or(block);
        if !block.contains("ObjectType=\"Note\"") {
            continue;
        }
        let (Some(row), Some(col)) = (
            tag(block, "Row").and_then(|v| v.parse().ok()),
            tag(block, "Column").and_then(|v| v.parse().ok()),
        ) else {
            continue;
        };
        let anchor = tag(block, "Anchor").and_then(|a| {
            let v: Vec<u32> = a.split(',').filter_map(|n| n.trim().parse().ok()).collect();
            <[u32; 8]>::try_from(v).ok()
        });
        let head = block.split('>').next().unwrap_or("");
        let style = head
            .split("style=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
            .unwrap_or("");
        let prop = |name: &str| {
            style.split(';').find_map(|kv| {
                let (k, v) = kv.split_once(':')?;
                (k.trim() == name).then(|| css_pt(v)).flatten()
            })
        };
        let size = prop("width").zip(prop("height"));
        out.push(VmlShape {
            row,
            col,
            anchor,
            size,
            visible: block.contains("<Visible/>") || block.contains("<Visible>"),
        });
    }
    out
}

/// Reads the notes and threads of `sheet` (whose part is `part`).
/// Returns warnings.
pub(crate) fn load(
    pkg: &Package,
    wb: &mut Workbook,
    sheet: SheetId,
    part: &PartName,
    persons: &[Person],
    consumed: &mut BTreeSet<PartName>,
) -> Result<Vec<Warn>> {
    let mut warnings = Vec::new();
    let Some(rels) = pkg.relationships(part) else {
        return Ok(warnings);
    };
    let target = |rel_type: &str| {
        rels.first_by_type(rel_type)
            .filter(|r| r.target_mode == TargetMode::Internal)
            .and_then(|r| part.resolve(&r.target).ok())
            .filter(|p| pkg.part(p).is_some())
    };
    let mut threads: Vec<Thread> = Vec::new();
    let threaded = target(THREADED_REL);
    if let Some(p) = &threaded {
        consumed.insert(p.clone());
        let root = parse(&pkg.part(p).expect("checked").data, p.as_str()).map_err(xml_error)?;
        let person = |id: Option<&str>| {
            let id = id.unwrap_or_default();
            persons
                .iter()
                .find(|q| q.id == id)
                .cloned()
                .unwrap_or_else(|| Person {
                    id: id.to_owned(),
                    ..Person::default()
                })
        };
        for e in root.elements().filter(|e| e.name == "threadedComment") {
            let Some((row, col)) = e.attr("ref").and_then(parse_cell) else {
                continue;
            };
            let id = e.attr("id").unwrap_or_default().to_owned();
            let author = person(e.attr("personId"));
            let date = e.attr("dT").unwrap_or_default().to_owned();
            let text = e.child("text").map(t_text).unwrap_or_default();
            // `<mentions><mention mentionpersonId mentionId startIndex length/>`.
            let mentions: Vec<model_sheet::Mention> = e
                .child("mentions")
                .map(|m| {
                    m.elements()
                        .filter(|x| x.name == "mention")
                        .filter_map(|x| {
                            Some(model_sheet::Mention {
                                person_id: x.attr("mentionpersonId")?.to_owned(),
                                id: x.attr("mentionId").unwrap_or_default().to_owned(),
                                start: x.attr("startIndex")?.parse().ok()?,
                                length: x.attr("length")?.parse().ok()?,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            match e.attr("parentId") {
                Some(parent) => match threads.iter_mut().find(|t| t.id == parent) {
                    Some(t) => t.replies.push(Reply {
                        id,
                        author,
                        date,
                        text,
                        mentions,
                    }),
                    None => warnings.push(note!("xlsx.comment.orphanReply", id = id)),
                },
                None => {
                    if threads.iter().any(|t| (t.row, t.col) == (row, col)) {
                        warnings.push(note!(
                            "xlsx.comment.secondThread",
                            cell = cell_name(row, col)
                        ));
                        continue;
                    }
                    threads.push(Thread {
                        id,
                        row,
                        col,
                        author,
                        date,
                        text,
                        resolved: e
                            .attr("done")
                            .and_then(fmt_ooxml::xml::parse_bool)
                            .unwrap_or(false),
                        replies: Vec::new(),
                        mentions,
                    });
                }
            }
        }
        // Ids must be unique in the workbook.
        let mut used = wb.comment_ids();
        for t in &mut threads {
            if t.id.is_empty() || used.contains(&t.id) {
                t.id = wb.fresh_comment_id(&format!("{}:{}:{}", sheet.0, t.row, t.col));
            }
            used.insert(t.id.clone());
            for r in &mut t.replies {
                if r.id.is_empty() || used.contains(&r.id) {
                    r.id = model_sheet::guid(&format!("reply:{}:{}", t.id, used.len()));
                }
                used.insert(r.id.clone());
            }
        }
    }
    let mut notes: Vec<Note> = Vec::new();
    if let Some(p) = target(COMMENTS_REL) {
        consumed.insert(p.clone());
        let root = parse(&pkg.part(&p).expect("checked").data, p.as_str()).map_err(xml_error)?;
        let authors: Vec<String> = root
            .child("authors")
            .map(|a| {
                a.elements()
                    .filter(|e| e.name == "author")
                    .map(|e| decode_x_escapes(&e.text()).into_owned())
                    .collect()
            })
            .unwrap_or_default();
        let list = root.child("commentList");
        for c in list.iter().flat_map(|l| l.elements()) {
            if c.name != "comment" {
                continue;
            }
            let Some((row, col)) = c.attr("ref").and_then(parse_cell) else {
                continue;
            };
            let author = c
                .attr("authorId")
                .and_then(|i| i.parse::<usize>().ok())
                .and_then(|i| authors.get(i))
                .cloned()
                .unwrap_or_default();
            let text = c.child("text").map(read_runs).unwrap_or_default();
            let plain: String = text.iter().map(|r| r.text.as_str()).collect();
            let placeholder = author.starts_with("tc=") || plain.starts_with(PLACEHOLDER);
            if placeholder
                && (threaded.is_some() || threads.iter().any(|t| (t.row, t.col) == (row, col)))
            {
                continue;
            }
            if notes.iter().any(|n| (n.row, n.col) == (row, col)) {
                continue;
            }
            notes.push(Note {
                row,
                col,
                author,
                text,
                visible: false,
                bounds: None,
            });
        }
        match target(VML_REL) {
            Some(v) => {
                consumed.insert(v.clone());
                for shape in scan_vml(&pkg.part(&v).expect("checked").data) {
                    let Some(n) = notes
                        .iter_mut()
                        .find(|n| (n.row, n.col) == (shape.row, shape.col))
                    else {
                        continue;
                    };
                    n.visible = shape.visible;
                    let default = anchor_of(wb, sheet, n.row, n.col, &NoteBounds::DEFAULT);
                    let anchor = shape.anchor.or_else(|| {
                        // No anchor (openpyxl): the default position with
                        // the style's size.
                        let (w, h) = shape.size?;
                        let b = NoteBounds {
                            w,
                            h,
                            ..NoteBounds::DEFAULT
                        };
                        b.w.is_finite()
                            .then(|| anchor_of(wb, sheet, n.row, n.col, &b))
                    });
                    if let Some(a) = anchor.filter(|a| *a != default) {
                        n.bounds = Some(bounds_of(wb, sheet, n.row, n.col, &a));
                    }
                }
            }
            None if !notes.is_empty() => {
                warnings.push(note!("xlsx.note.noVml"));
            }
            None => {}
        }
    } else if let Some(v) = target(VML_REL) {
        // A VML drawing without comments (form controls): not modelled.
        consumed.insert(v);
        warnings.push(note!("xlsx.note.orphanVml"));
    }
    if let Err(e) = wb.set_notes(sheet, notes) {
        warnings.push(note!("xlsx.note.dropped", error = e));
    }
    if let Err(e) = wb.set_threads(sheet, threads) {
        warnings.push(note!("xlsx.comment.dropped", error = e));
    }
    Ok(warnings)
}

// --- writing -----------------------------------------------------------------------

/// Counters of the comment parts written so far.
#[derive(Default)]
pub(crate) struct CommentParts {
    sheets: usize,
}

/// The persons to write: the workbook's list plus every thread author
/// not in it (by name), with their GUIDs.
pub(crate) fn persons_of(wb: &Workbook) -> Vec<Person> {
    let mut out: Vec<Person> = wb.persons().to_vec();
    for (s, _) in wb.sheets() {
        for t in wb.threads(s) {
            for p in std::iter::once(&t.author).chain(t.replies.iter().map(|r| &r.author)) {
                let known = out.iter().any(|q| {
                    (!p.id.is_empty() && q.id == p.id) || (p.id.is_empty() && q.name == p.name)
                });
                if !known {
                    out.push(p.clone());
                }
            }
        }
    }
    out
}

/// The GUID of `p` in the written person list.
fn person_id(persons: &[Person], p: &Person) -> String {
    persons
        .iter()
        .find(|q| (!p.id.is_empty() && q.id == p.id) || q.name == p.name)
        .unwrap_or(p)
        .guid()
}

/// Writes `xl/persons/person.xml` and adds its workbook relationship.
pub(crate) fn write_persons(
    pkg: &mut Package,
    rels: &mut Relationships,
    persons: &[Person],
) -> Result<()> {
    let mut x = XmlOut::new();
    x.start(
        "personList",
        &[("xmlns", THREADED_NS), ("xmlns:x", MAIN_NS)],
    );
    for p in persons {
        let id = p.guid();
        let user = if p.user_id.is_empty() {
            &p.name
        } else {
            &p.user_id
        };
        let provider = if p.provider_id.is_empty() {
            "None"
        } else {
            p.provider_id.as_str()
        };
        x.empty(
            "person",
            &[
                ("displayName", &p.name),
                ("id", &id),
                ("userId", user),
                ("providerId", provider),
            ],
        );
    }
    x.end("personList");
    pkg.insert_part(
        PartName::new("/xl/persons/person.xml")?,
        PERSON_CT,
        x.finish(),
    );
    rels.add(PERSON_REL, "persons/person.xml");
    Ok(())
}

/// The legacy text of a thread (Excel's placeholder).
fn placeholder_text(t: &Thread) -> String {
    let mut s = format!(
        "{PLACEHOLDER}\n\n{PLACEHOLDER_BODY}\n\nComment:\n    {}",
        t.text
    );
    for r in &t.replies {
        s.push_str(&format!("\nReply:\n    {}", r.text));
    }
    s
}

impl CommentParts {
    /// Writes the comment parts of `sheet` (which has notes or threads)
    /// and adds their relationships to `rels`; returns the `r:id` of the
    /// VML drawing for `<legacyDrawing>`.
    pub(crate) fn write(
        &mut self,
        pkg: &mut Package,
        rels: &mut Relationships,
        wb: &Workbook,
        sheet: SheetId,
        persons: &[Person],
    ) -> Result<String> {
        self.sheets += 1;
        let n = self.sheets;
        let notes = wb.notes(sheet);
        let threads = wb.threads(sheet);
        // Legacy entries: notes, plus placeholders for threads on cells
        // without a note; by cell.
        enum Legacy<'a> {
            Note(&'a Note),
            Thread(&'a Thread),
        }
        let mut legacy: Vec<(u32, u32, Legacy)> = notes
            .iter()
            .map(|n| (n.row, n.col, Legacy::Note(n)))
            .collect();
        for t in threads {
            if !notes.iter().any(|n| (n.row, n.col) == (t.row, t.col)) {
                legacy.push((t.row, t.col, Legacy::Thread(t)));
            }
        }
        legacy.sort_by_key(|(r, c, _)| (*r, *c));
        let mut authors: Vec<String> = Vec::new();
        let mut author_index = |a: String| match authors.iter().position(|x| *x == a) {
            Some(i) => i,
            None => {
                authors.push(a);
                authors.len() - 1
            }
        };
        let mut body = XmlOut::fragment();
        body.start("commentList", &[]);
        for (row, col, item) in &legacy {
            let r = cell_name(*row, *col);
            match item {
                Legacy::Note(note) => {
                    let a = author_index(note.author.clone()).to_string();
                    body.start(
                        "comment",
                        &[("ref", &r), ("authorId", &a), ("shapeId", "0")],
                    );
                    write_runs(&mut body, &note.text);
                }
                Legacy::Thread(t) => {
                    let a = author_index(format!("tc={}", t.id)).to_string();
                    body.start(
                        "comment",
                        &[
                            ("ref", &r),
                            ("authorId", &a),
                            ("shapeId", "0"),
                            ("xr:uid", &t.id),
                        ],
                    );
                    write_runs(&mut body, &[NoteRun::plain(placeholder_text(t))]);
                }
            }
            body.end("comment");
        }
        body.end("commentList");
        let mut x = XmlOut::new();
        x.start(
            "comments",
            &[
                ("xmlns", MAIN_NS),
                (
                    "xmlns:mc",
                    "http://schemas.openxmlformats.org/markup-compatibility/2006",
                ),
                ("mc:Ignorable", "xr"),
                (
                    "xmlns:xr",
                    "http://schemas.microsoft.com/office/spreadsheetml/2014/revision",
                ),
            ],
        );
        x.start("authors", &[]);
        for a in &authors {
            x.text_el("author", &[], &encode_x_escapes(a));
        }
        x.end("authors");
        x.raw(&body.finish());
        x.end("comments");

        // The VML drawing: one shape per legacy comment.
        let mut v = XmlOut::fragment();
        v.start(
            "xml",
            &[
                ("xmlns:v", "urn:schemas-microsoft-com:vml"),
                ("xmlns:o", "urn:schemas-microsoft-com:office:office"),
                ("xmlns:x", "urn:schemas-microsoft-com:office:excel"),
            ],
        );
        v.start("o:shapelayout", &[("v:ext", "edit")]);
        v.empty("o:idmap", &[("v:ext", "edit"), ("data", &n.to_string())]);
        v.end("o:shapelayout");
        v.start(
            "v:shapetype",
            &[
                ("id", "_x0000_t202"),
                ("coordsize", "21600,21600"),
                ("o:spt", "202"),
                ("path", "m,l,21600r21600,l21600,xe"),
            ],
        );
        v.empty("v:stroke", &[("joinstyle", "miter")]);
        v.empty(
            "v:path",
            &[("gradientshapeok", "t"), ("o:connecttype", "rect")],
        );
        v.end("v:shapetype");
        for (k, (row, col, item)) in legacy.iter().enumerate() {
            let (bounds, visible) = match item {
                Legacy::Note(note) => (note.bounds.unwrap_or(NoteBounds::DEFAULT), note.visible),
                Legacy::Thread(_) => (NoteBounds::DEFAULT, false),
            };
            let a = anchor_of(wb, sheet, *row, *col, &bounds);
            let left = (col_start(wb, sheet, a[0]) + f64::from(a[1])) * 0.75;
            let top = (row_start(wb, sheet, a[2]) + f64::from(a[3])) * 0.75;
            let style = format!(
                "position:absolute;margin-left:{left}pt;margin-top:{top}pt;width:{}pt;height:{}pt;z-index:{};visibility:{}",
                bounds.w,
                bounds.h,
                k + 1,
                if visible { "visible" } else { "hidden" }
            );
            let id = format!("_x0000_s{}", 1024 * n + k + 1);
            v.start(
                "v:shape",
                &[
                    ("id", &id),
                    ("type", "#_x0000_t202"),
                    ("style", &style),
                    ("fillcolor", "#ffffe1"),
                    ("o:insetmode", "auto"),
                ],
            );
            v.empty("v:fill", &[("color2", "#ffffe1")]);
            v.empty(
                "v:shadow",
                &[("on", "t"), ("color", "black"), ("obscured", "t")],
            );
            v.empty("v:path", &[("o:connecttype", "none")]);
            v.start("v:textbox", &[("style", "mso-direction-alt:auto")]);
            v.text_el("div", &[("style", "text-align:left")], "");
            v.end("v:textbox");
            v.start("x:ClientData", &[("ObjectType", "Note")]);
            v.empty("x:MoveWithCells", &[]);
            v.empty("x:SizeWithCells", &[]);
            let anchor = a.iter().map(u32::to_string).collect::<Vec<_>>().join(", ");
            v.text_el("x:Anchor", &[], &anchor);
            v.text_el("x:AutoFill", &[], "False");
            v.text_el("x:Row", &[], &row.to_string());
            v.text_el("x:Column", &[], &col.to_string());
            if visible {
                v.empty("x:Visible", &[]);
            }
            v.end("x:ClientData");
            v.end("v:shape");
        }
        v.end("xml");

        let comments = format!("comments{n}.xml");
        pkg.insert_part(
            PartName::new(format!("/xl/{comments}"))?,
            COMMENTS_CT,
            x.finish(),
        );
        let vml = format!("drawings/vmlDrawing{n}.vml");
        pkg.insert_part(PartName::new(format!("/xl/{vml}"))?, VML_CT, v.finish());
        let vml_id = rels.add(VML_REL, format!("../{vml}")).id.clone();
        rels.add(COMMENTS_REL, format!("../{comments}"));

        if !threads.is_empty() {
            let mut t = XmlOut::new();
            t.start(
                "ThreadedComments",
                &[("xmlns", THREADED_NS), ("xmlns:x", MAIN_NS)],
            );
            let item = |x: &mut XmlOut,
                        r: &str,
                        date: &str,
                        author: &Person,
                        id: &str,
                        parent: Option<&str>,
                        done: bool,
                        text: &str,
                        mentions: &[model_sheet::Mention]| {
                let pid = person_id(persons, author);
                let mut a: Vec<(&str, &str)> = vec![("ref", r)];
                if !date.is_empty() {
                    a.push(("dT", date));
                }
                a.push(("personId", &pid));
                a.push(("id", id));
                if let Some(p) = parent {
                    a.push(("parentId", p));
                }
                if done {
                    a.push(("done", "1"));
                }
                x.start("threadedComment", &a);
                x.text_el("text", &[], &encode_x_escapes(text));
                if !mentions.is_empty() {
                    x.start("mentions", &[]);
                    for m in mentions {
                        let (start, length) = (m.start.to_string(), m.length.to_string());
                        x.empty(
                            "mention",
                            &[
                                ("mentionpersonId", m.person_id.as_str()),
                                ("mentionId", m.id.as_str()),
                                ("startIndex", &start),
                                ("length", &length),
                            ],
                        );
                    }
                    x.end("mentions");
                }
                x.end("threadedComment");
            };
            for th in threads {
                let r = cell_name(th.row, th.col);
                item(
                    &mut t,
                    &r,
                    &th.date,
                    &th.author,
                    &th.id,
                    None,
                    th.resolved,
                    &th.text,
                    &th.mentions,
                );
                for rep in &th.replies {
                    item(
                        &mut t,
                        &r,
                        &rep.date,
                        &rep.author,
                        &rep.id,
                        Some(&th.id),
                        false,
                        &rep.text,
                        &rep.mentions,
                    );
                }
            }
            t.end("ThreadedComments");
            let part = format!("threadedComments/threadedComment{n}.xml");
            pkg.insert_part(
                PartName::new(format!("/xl/{part}"))?,
                THREADED_CT,
                t.finish(),
            );
            rels.add(THREADED_REL, format!("../{part}"));
        }
        Ok(vml_id)
    }
}

/// Whether `wb` has any thread (the person list is written then).
pub(crate) fn has_threads(wb: &Workbook) -> bool {
    wb.sheets().iter().any(|(s, _)| !wb.threads(*s).is_empty())
}

/// Used by the tests: the anchor Excel would write for a default note.
#[cfg(test)]
pub(crate) fn default_anchor(wb: &Workbook, s: SheetId, row: u32, col: u32) -> Anchor {
    anchor_of(wb, s, row, col, &NoteBounds::DEFAULT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_anchor_matches_excel() {
        let wb = Workbook::new();
        let s = SheetId(0);
        // Excel's anchor of a new note on B3 (64 px columns, 20 px rows).
        assert_eq!(default_anchor(&wb, s, 2, 1), [2, 15, 1, 10, 4, 15, 5, 4]);
        let b = NoteBounds {
            x: 30.0,
            y: 7.5,
            w: 150.0,
            h: 75.0,
        };
        let a = anchor_of(&wb, s, 4, 2, &b);
        assert_eq!(bounds_of(&wb, s, 4, 2, &a), b);
    }

    #[test]
    fn vml_scan_is_tolerant() {
        let vml = br##"<xml><v:shape id="a" type="#t"><x:ClientData ObjectType="Note"><x:Anchor>
 1, 15, 0, 2, 3, 15, 4, 16</x:Anchor><x:Row>0</x:Row><x:Column>0</x:Column><x:Visible/><br></x:ClientData></v:shape>
<v:shape id="b"><x:ClientData ObjectType="Button"><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>"##;
        let shapes = scan_vml(vml);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].anchor, Some([1, 15, 0, 2, 3, 15, 4, 16]));
        assert!(shapes[0].visible);
        let openpyxl = br#"<xml><ns0:shape xmlns:ns0="urn:schemas-microsoft-com:vml" style="position:absolute; width:200px;height:100px;visibility:hidden"><ns2:ClientData ObjectType="Note"><ns2:Row>2</ns2:Row><ns2:Column>1</ns2:Column></ns2:ClientData></ns0:shape></xml>"#;
        let shapes = scan_vml(openpyxl);
        assert_eq!((shapes[0].row, shapes[0].col), (2, 1));
        assert_eq!(shapes[0].size, Some((150.0, 75.0)));
        assert!(!shapes[0].visible);
    }
}
