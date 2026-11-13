//! OneNote (`fmt-onenote`'s intermediate tree) → Notes pages.
//!
//! Per page, outlines are read in reading order (top to bottom, then left to right by position) and become blocks:
//! paragraph styles → heading / block quote / code block, runs → marks (bold, italic, underline, strike,
//! sub/superscript, `textStyle.color`, `highlight.color`; fonts and sizes are not kept), list paragraphs → nested
//! lists (by outline level), tables, note tags (built-in kinds → built-in tag ids, custom tags → the notebook's
//! tag definitions, given by the caller), pictures and attached files → blobs. `onenote:` links to pages of the
//! same import become page links; other `onenote:` links keep their text.
//!
//! **Canvas rule**: a page with ink, or with two or more outlines whose horizontal ranges do not overlap
//! (side-by-side layout), becomes a canvas page (`meta.canvas`): every outline is a positioned text item whose
//! blocks carry `canvasItem: <item id>`, pictures are image items, attached files text items with an attachment
//! block, strokes go to `"ink"` (1/10 pt, absolute page coordinates). All other pages flow.
use std::collections::HashMap;

use fmt_onenote::{Block, OnePage, PageItem, Rect, Rgb, Run, TagKind};
use model_notes::{CanvasItem, InkStroke};
use serde_json::{json, Value};

use crate::pm::{self, Flat, ListKind};
use crate::{Blob, Converted, PageContent, Warnings};

pub use fmt_onenote::{read_package, read_section, NotebookItem, OneNotebook, OneSection};

/// What the page conversion needs from the target notebook.
#[derive(Default)]
pub struct OneNoteContext<'a> {
    /// Custom tag label → tag id in the target notebook (create them first, see [`custom_tags`]).
    pub custom_tags: HashMap<String, String>,
    /// Page title → page doc id, for `onenote:` links between imported pages.
    pub resolve_page: Option<&'a crate::Lookup<'a>>,
}

/// The built-in tag id of a OneNote tag kind (`None` for custom tags).
#[must_use]
pub fn builtin_tag(kind: &TagKind) -> Option<&'static str> {
    Some(match kind {
        TagKind::ToDo => "todo",
        TagKind::Important => "important",
        TagKind::Question => "question",
        TagKind::Idea => "idea",
        TagKind::Critical => "critical",
        TagKind::Contact => "contact",
        TagKind::Address => "address",
        TagKind::Phone => "phone",
        TagKind::Remember => "remember",
        TagKind::Definition => "definition",
        TagKind::Highlight => "highlight",
        TagKind::Custom(_) => return None,
    })
}

fn custom_label(t: &fmt_onenote::Tag) -> Option<String> {
    match &t.kind {
        TagKind::Custom(l) if !l.trim().is_empty() => Some(l.trim().to_string()),
        TagKind::Custom(_) => Some(t.label.trim().to_string()).filter(|l| !l.is_empty()),
        _ => None,
    }
}

/// The custom tags used on `pages`: (label, has a check box), first use first, deduplicated by label.
#[must_use]
pub fn custom_tags<'p>(pages: impl IntoIterator<Item = &'p OnePage>) -> Vec<(String, bool)> {
    fn walk(b: &Block, out: &mut Vec<(String, bool)>) {
        match b {
            Block::Paragraph { tags, .. } => {
                for t in tags {
                    if let Some(label) = custom_label(t) {
                        if !out.iter().any(|(l, _)| *l == label) {
                            out.push((label, t.checked.is_some()));
                        }
                    }
                }
            }
            Block::Table { rows } => {
                for b in rows.iter().flatten().flatten() {
                    walk(b, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    for p in pages {
        for item in &p.contents {
            if let PageItem::Outline { blocks, .. } = item {
                for b in blocks {
                    walk(b, &mut out);
                }
            }
        }
    }
    out
}

fn hex(c: Rgb) -> String {
    pm::hex(c.r, c.g, c.b)
}

/// The page title an `onenote:` link points at (`onenote:…#Page%20Title&section-id=…`).
fn link_page_title(link: &str) -> Option<String> {
    let rest = link.strip_prefix("onenote:")?;
    let (_, frag) = rest.split_once('#')?;
    let title = frag.split('&').next()?;
    let t = pm::percent_decode(title);
    (!t.trim().is_empty()).then(|| t.trim().to_string())
}

struct Conv<'c, 'a> {
    ctx: &'c OneNoteContext<'a>,
    blobs: Vec<Blob>,
    w: Warnings,
}

impl Conv<'_, '_> {
    fn run_marks(&mut self, r: &Run) -> Vec<Value> {
        let mut ms = Vec::new();
        if r.bold {
            ms.push(pm::mark("bold"));
        }
        if r.italic {
            ms.push(pm::mark("italic"));
        }
        if r.underline && r.link.is_none() {
            ms.push(pm::mark("underline"));
        }
        if r.strike {
            ms.push(pm::mark("strike"));
        }
        if r.sup {
            ms.push(pm::mark("superscript"));
        }
        if r.sub {
            ms.push(pm::mark("subscript"));
        }
        if let Some(c) = r.color.filter(|c| (c.r, c.g, c.b) != (0, 0, 0)) {
            if r.link.is_none() {
                ms.push(pm::mark_with("textStyle", json!({ "color": hex(c) })));
            }
        }
        if let Some(c) = r.highlight {
            ms.push(pm::mark_with("highlight", json!({ "color": hex(c) })));
        }
        if let Some(link) = &r.link {
            if link.starts_with("onenote:") {
                let target =
                    link_page_title(link).and_then(|t| self.ctx.resolve_page.and_then(|f| f(&t)));
                match target {
                    Some(id) => ms.push(pm::mark_with("pageLink", json!({ "pageId": id }))),
                    None => self.w.warn(
                        "notes.onenote.link",
                        "Links to OneNote pages outside the import were kept as text",
                        &[],
                    ),
                }
            } else if let Some(h) = pm::safe_href(link) {
                ms.push(pm::mark_with("link", json!({ "href": h })));
            }
        }
        ms
    }

    fn runs(&mut self, runs: &[Run]) -> Vec<Value> {
        let mut out = Vec::new();
        for r in runs {
            let ms = self.run_marks(r);
            for (i, line) in r.text.split(['\n', '\u{b}']).enumerate() {
                if i > 0 {
                    out.push(pm::node("hardBreak", None, Vec::new()));
                }
                out.push(pm::text(line, &ms));
            }
        }
        pm::normalize_inline(out)
    }

    fn tag_attrs(&self, block: &mut Value, tags: &[fmt_onenote::Tag]) {
        let mut ids = Vec::new();
        let mut checked = None;
        for t in tags {
            let id = match custom_label(t) {
                Some(label) => self.ctx.custom_tags.get(&label).cloned(),
                None => builtin_tag(&t.kind).map(str::to_string),
            };
            if let Some(id) = id {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            if let Some(c) = t.checked {
                checked = Some(checked.unwrap_or(false) || c);
            }
        }
        if !ids.is_empty() {
            pm::set_attr(block, "tags", json!(ids));
            if let Some(c) = checked {
                pm::set_attr(block, "checked", c.into());
            }
        }
    }

    fn table(&mut self, rows: &[Vec<Vec<Block>>]) -> Option<Value> {
        let rows: Vec<Value> = rows
            .iter()
            .map(|r| {
                let cells = r
                    .iter()
                    .map(|cell| {
                        let mut c = self.blocks(cell);
                        if c.is_empty() {
                            c.push(pm::paragraph(Vec::new()));
                        }
                        pm::node("tableCell", None, c)
                    })
                    .collect();
                pm::node("tableRow", None, cells)
            })
            .collect();
        (!rows.is_empty()).then(|| pm::node("table", None, rows))
    }

    /// The blocks of an outline (or a table cell).
    fn blocks(&mut self, blocks: &[Block]) -> Vec<Value> {
        let mut flat: Vec<Flat> = Vec::new();
        let mut code: Vec<String> = Vec::new();
        let mut quote: Vec<Value> = Vec::new();
        for b in blocks {
            let style = match b {
                Block::Paragraph {
                    style, list: None, ..
                } => style.as_deref().unwrap_or_default(),
                _ => "",
            };
            if style != "code" {
                flush_code(&mut code, &mut flat);
            }
            if style != "quote" {
                flush_quote(&mut quote, &mut flat);
            }
            match b {
                Block::Paragraph {
                    runs,
                    list,
                    tags,
                    level,
                    style,
                } => {
                    if style.as_deref() == Some("code") && list.is_none() {
                        code.push(runs.iter().map(|r| r.text.as_str()).collect());
                        continue;
                    }
                    let inline = self.runs(runs);
                    let heading = match style.as_deref().unwrap_or_default() {
                        "title" => Some(1),
                        s => s
                            .strip_prefix("heading")
                            .and_then(|n| n.parse::<u8>().ok())
                            .map(|n| n.clamp(1, 6)),
                    };
                    let mut block = match heading.filter(|_| list.is_none()) {
                        Some(l) => pm::heading(l, inline),
                        None => pm::paragraph(inline),
                    };
                    self.tag_attrs(&mut block, tags);
                    if style.as_deref() == Some("quote") && list.is_none() {
                        quote.push(block);
                        continue;
                    }
                    let list = list.as_ref().map(|l| {
                        let kind = if l.ordered {
                            ListKind::Ordered {
                                start: l.restart.and_then(|r| u32::try_from(r).ok()).unwrap_or(1),
                            }
                        } else {
                            ListKind::Bullet
                        };
                        (kind, *level)
                    });
                    flat.push(Flat { block, list });
                }
                Block::Table { rows } => {
                    if let Some(t) = self.table(rows) {
                        flat.push(Flat {
                            block: t,
                            list: None,
                        });
                    }
                }
                Block::Image {
                    data,
                    mime,
                    alt,
                    width,
                    height,
                } => {
                    let size = width
                        .zip(*height)
                        .map(|(w, h)| (f64::from(w), f64::from(h)));
                    let block = pm::image_block(
                        data.clone(),
                        Some(mime),
                        alt.as_deref(),
                        size,
                        &mut self.blobs,
                    );
                    flat.push(Flat { block, list: None });
                }
                Block::Attachment { file_name, data } => {
                    let block = pm::attachment_block(data.clone(), file_name, &mut self.blobs);
                    flat.push(Flat { block, list: None });
                }
            }
        }
        flush_code(&mut code, &mut flat);
        flush_quote(&mut quote, &mut flat);
        pm::nest_lists(flat)
    }
}

fn flush_code(code: &mut Vec<String>, flat: &mut Vec<Flat>) {
    if !code.is_empty() {
        let t = std::mem::take(code).join("\n");
        let c = if t.is_empty() {
            Vec::new()
        } else {
            vec![pm::text(&t, &[])]
        };
        flat.push(Flat {
            block: pm::node("codeBlock", None, c),
            list: None,
        });
    }
}

fn flush_quote(quote: &mut Vec<Value>, flat: &mut Vec<Flat>) {
    if !quote.is_empty() {
        flat.push(Flat {
            block: pm::node("blockquote", None, std::mem::take(quote)),
            list: None,
        });
    }
}

/// Whether a page imports as a canvas page: ink, or ≥ 2 outlines side by side (horizontal ranges that do not
/// overlap; outlines without a stored width count as overlapping).
#[must_use]
pub fn is_canvas(page: &OnePage) -> bool {
    if page
        .contents
        .iter()
        .any(|i| matches!(i, PageItem::Ink { .. }))
    {
        return true;
    }
    let ranges: Vec<(f32, f32)> = page
        .contents
        .iter()
        .filter_map(|i| match i {
            PageItem::Outline {
                pos: Some(Rect {
                    x, width: Some(w), ..
                }),
                ..
            } => Some((*x, x + w)),
            _ => None,
        })
        .collect();
    ranges
        .iter()
        .enumerate()
        .any(|(i, a)| ranges[i + 1..].iter().any(|b| a.1 <= b.0 || b.1 <= a.0))
}

fn pos_of(item: &PageItem) -> Option<Rect> {
    match item {
        PageItem::Outline { pos, .. }
        | PageItem::Image { pos, .. }
        | PageItem::Attachment { pos, .. }
        | PageItem::Ink { pos, .. } => *pos,
    }
}

/// The items in reading order: top to bottom, then left to right. Items without a position stay after the item
/// before them.
fn reading_order(items: &[PageItem]) -> Vec<&PageItem> {
    let mut last = (f32::NEG_INFINITY, f32::NEG_INFINITY);
    let mut keyed: Vec<((f32, f32), &PageItem)> = items
        .iter()
        .map(|i| {
            if let Some(p) = pos_of(i) {
                last = (p.y, p.x);
            }
            (last, i)
        })
        .collect();
    keyed.sort_by(|a, b| {
        a.0 .0
            .total_cmp(&b.0 .0)
            .then_with(|| a.0 .1.total_cmp(&b.0 .1))
    });
    keyed.into_iter().map(|(_, i)| i).collect()
}

/// Points → integer tenths of a point.
fn tenth(v: f32) -> i32 {
    (f64::from(v) * 10.0).round().clamp(-2e9, 2e9) as i32
}

fn place(id: String, kind: &str, pos: Option<Rect>, blob: Option<String>) -> CanvasItem {
    let r = pos.unwrap_or(Rect {
        x: 0.0,
        y: 0.0,
        width: None,
        height: None,
    });
    CanvasItem {
        id,
        kind: kind.into(),
        x: f64::from(r.x),
        y: f64::from(r.y),
        w: f64::from(r.width.unwrap_or(0.0)),
        // Text boxes grow with their content.
        h: if kind == "text" {
            0.0
        } else {
            f64::from(r.height.unwrap_or(0.0))
        },
        blob,
    }
}

/// Converts one page.
#[must_use]
pub fn page(p: &OnePage, ctx: &OneNoteContext<'_>) -> Converted<PageContent> {
    let mut c = Conv {
        ctx,
        blobs: Vec::new(),
        w: Warnings::default(),
    };
    let canvas = is_canvas(p);
    let mut out = PageContent {
        title: p.title.trim().to_string(),
        level: p.level,
        created: p.created.map(|s| s.saturating_mul(1000)),
        modified: p.modified.map(|s| s.saturating_mul(1000)),
        canvas,
        ..PageContent::default()
    };
    let mut n_item = 0usize;
    let mut next_id = |prefix: &str| {
        n_item += 1;
        format!("{prefix}{n_item}")
    };
    for item in reading_order(&p.contents) {
        let pos = pos_of(item);
        match item {
            PageItem::Outline { blocks, .. } => {
                let mut bs = c.blocks(blocks);
                if canvas {
                    let id = next_id("c");
                    for b in &mut bs {
                        pm::set_attr(b, "canvasItem", id.clone().into());
                    }
                    out.items.push(place(id, "text", pos, None));
                }
                out.blocks.extend(bs);
            }
            PageItem::Image {
                data, mime, alt, ..
            } => {
                let size = pos
                    .and_then(|r| r.width.zip(r.height))
                    .map(|(w, h)| (f64::from(w), f64::from(h)));
                let img =
                    pm::image_block(data.clone(), Some(mime), alt.as_deref(), size, &mut c.blobs);
                if canvas {
                    let blob = pm::attr_str(&img, "blob").map(str::to_string);
                    out.items.push(place(next_id("c"), "image", pos, blob));
                } else {
                    out.blocks.push(img);
                }
            }
            PageItem::Attachment {
                file_name, data, ..
            } => {
                let mut a = pm::attachment_block(data.clone(), file_name, &mut c.blobs);
                if canvas {
                    let id = next_id("c");
                    pm::set_attr(&mut a, "canvasItem", id.clone().into());
                    out.items.push(place(id, "text", pos, None));
                }
                out.blocks.push(a);
            }
            PageItem::Ink { strokes, .. } => {
                let (ox, oy) = pos.map_or((0.0, 0.0), |r| (r.x, r.y));
                if pos.is_none() {
                    c.w.warn(
                        "notes.onenote.inkPosition",
                        "Drawings from inside text were placed at the top left of the page",
                        &[],
                    );
                }
                for s in strokes {
                    let mut points = Vec::with_capacity(s.points.len() * 3);
                    for &(x, y, pressure) in &s.points {
                        points.push(tenth(ox + x));
                        points.push(tenth(oy + y));
                        points.push(pressure.map_or(128, |p| {
                            (f64::from(p).clamp(0.0, 1.0) * 255.0).round() as i32
                        }));
                    }
                    out.strokes.push(InkStroke {
                        id: next_id("s"),
                        tool: if s.highlighter { "highlighter" } else { "pen" }.into(),
                        color: hex(s.color),
                        width: u32::try_from(tenth(s.width_pt).max(1)).unwrap_or(1),
                        points,
                    });
                }
            }
        }
    }
    Converted {
        value: out,
        blobs: c.blobs,
        warnings: c.w.into_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fmt_onenote::{InkStroke as OneInk, ListInfo, Tag};

    fn run(text: &str) -> Run {
        Run {
            text: text.into(),
            ..Run::default()
        }
    }

    fn para(text: &str) -> Block {
        Block::Paragraph {
            runs: vec![run(text)],
            list: None,
            tags: vec![],
            level: 0,
            style: None,
        }
    }

    fn outline(x: f32, y: f32, w: Option<f32>, blocks: Vec<Block>) -> PageItem {
        PageItem::Outline {
            pos: Some(Rect {
                x,
                y,
                width: w,
                height: None,
            }),
            blocks,
        }
    }

    fn one_page(contents: Vec<PageItem>) -> OnePage {
        OnePage {
            title: "P".into(),
            level: 0,
            created: Some(10),
            modified: Some(20),
            contents,
        }
    }

    #[test]
    fn stacked_outlines_flow_in_reading_order() {
        let p = one_page(vec![
            outline(36.0, 300.0, Some(400.0), vec![para("second")]),
            outline(40.0, 80.0, Some(400.0), vec![para("first")]),
        ]);
        assert!(!is_canvas(&p));
        let r = page(&p, &OneNoteContext::default());
        let t: Vec<String> = r.value.blocks.iter().map(pm::inline_text).collect();
        assert_eq!(t, ["first", "second"]);
        assert!(!r.value.canvas);
        assert_eq!(
            (r.value.created, r.value.modified),
            (Some(10_000), Some(20_000))
        );
    }

    #[test]
    fn side_by_side_outlines_make_a_canvas_page() {
        let p = one_page(vec![
            outline(300.0, 80.0, Some(200.0), vec![para("right")]),
            outline(36.0, 80.0, Some(200.0), vec![para("left")]),
        ]);
        assert!(is_canvas(&p));
        let r = page(&p, &OneNoteContext::default()).value;
        assert!(r.canvas);
        assert_eq!(r.items.len(), 2);
        assert_eq!((r.items[0].x, r.items[1].x), (36.0, 300.0));
        assert_eq!(pm::inline_text(&r.blocks[0]), "left");
        assert_eq!(
            pm::attr_str(&r.blocks[1], "canvasItem"),
            Some(r.items[1].id.as_str())
        );
        // Unknown widths count as overlapping.
        let q = one_page(vec![
            outline(36.0, 80.0, None, vec![para("a")]),
            outline(300.0, 80.0, None, vec![para("b")]),
        ]);
        assert!(!is_canvas(&q));
    }

    #[test]
    fn ink_makes_a_canvas_page_with_absolute_strokes() {
        let p = one_page(vec![
            outline(36.0, 80.0, Some(200.0), vec![para("text")]),
            PageItem::Ink {
                pos: Some(Rect {
                    x: 100.0,
                    y: 50.0,
                    width: Some(10.0),
                    height: Some(10.0),
                }),
                strokes: vec![OneInk {
                    points: vec![(1.0, 2.0, None), (3.5, 4.0, Some(1.0))],
                    color: Rgb { r: 255, g: 0, b: 0 },
                    width_pt: 1.5,
                    highlighter: true,
                }],
            },
        ]);
        let r = page(&p, &OneNoteContext::default()).value;
        assert!(r.canvas);
        let s = &r.strokes[0];
        assert_eq!(s.points, [1010, 520, 128, 1035, 540, 255]);
        assert_eq!(
            (s.tool.as_str(), s.color.as_str(), s.width),
            ("highlighter", "#FF0000", 15)
        );
    }

    #[test]
    fn styles_lists_tags_and_links() {
        let tagged = |kind: TagKind, checked: Option<bool>| Tag {
            kind,
            label: String::new(),
            checked,
        };
        let mut blocks = vec![
            Block::Paragraph {
                runs: vec![run("Head")],
                list: None,
                tags: vec![],
                level: 0,
                style: Some("heading2".into()),
            },
            Block::Paragraph {
                runs: vec![Run {
                    link: Some("onenote:#Other%20Page&section-id={x}&end".into()),
                    ..run("go")
                }],
                list: None,
                tags: vec![
                    tagged(TagKind::ToDo, Some(true)),
                    tagged(TagKind::Custom("Follow".into()), None),
                ],
                level: 0,
                style: None,
            },
        ];
        for (t, lvl) in [("a", 0), ("a1", 1), ("b", 0)] {
            blocks.push(Block::Paragraph {
                runs: vec![run(t)],
                list: Some(ListInfo {
                    ordered: lvl == 1,
                    bullet: None,
                    number_format: None,
                    restart: None,
                }),
                tags: vec![],
                level: lvl,
                style: None,
            });
        }
        let f = |t: &str| (t == "Other Page").then(|| "pg-2".to_string());
        let ctx = OneNoteContext {
            custom_tags: HashMap::from([("Follow".to_string(), "t-1".to_string())]),
            resolve_page: Some(&f),
        };
        let p = one_page(vec![outline(0.0, 0.0, None, blocks)]);
        assert_eq!(custom_tags([&p]), [("Follow".to_string(), false)]);
        let r = page(&p, &ctx).value;
        let kinds: Vec<&str> = r.blocks.iter().map(pm::type_of).collect();
        assert_eq!(kinds, ["heading", "paragraph", "bulletList"]);
        assert_eq!(
            pm::attr(&r.blocks[1], "tags"),
            Some(&json!(["todo", "t-1"]))
        );
        assert_eq!(pm::attr(&r.blocks[1], "checked"), Some(&json!(true)));
        let link = &pm::content(&r.blocks[1])[0];
        assert_eq!(pm::marks(link)[0].1["pageId"], "pg-2");
        let nested = &pm::content(&pm::content(&r.blocks[2])[0])[1];
        assert_eq!(pm::type_of(nested), "orderedList");
    }
}
