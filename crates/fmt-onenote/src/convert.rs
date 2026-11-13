//! Walks `onenote_parser`'s object model and builds the intermediate tree.
//! The rules themselves live in `map.rs`; this file only reads the parser's
//! accessors and reports what is dropped.

use std::io::Read;

use onenote_parser::contents::{
    Content, EmbeddedFile, EmbeddedObject, FileDataStatus, Image, Ink, NoteTag, Outline,
    OutlineElement, OutlineItem, ParagraphStyling, RichText, Table,
};
use onenote_parser::notebook::Notebook;
use onenote_parser::page::{Page, PageContent};
use onenote_parser::property::common::Color;
use onenote_parser::property::note_tag::NoteTagShape;
use onenote_parser::section::{Section, SectionEntry};
use onenote_parser::warn::Report;

use crate::map::{self, LinkRange, RawStroke, RunStyle};
use crate::model::{
    Block, NotebookItem, OneNotebook, OnePage, OneSection, PageItem, Rect, Rgb, Tag,
};
use crate::warn::Warnings;

/// Guard against hostile nesting (outline children, ink groups).
const MAX_DEPTH: usize = 64;

pub(crate) fn notebook(nb: &Notebook, name: String, w: &mut Warnings) -> OneNotebook {
    report(nb.report(), w);
    OneNotebook {
        name,
        color: nb.color().map(rgb),
        items: entries(nb.entries(), w),
    }
}

fn entries(list: &[SectionEntry], w: &mut Warnings) -> Vec<NotebookItem> {
    list.iter()
        .map(|e| match e {
            SectionEntry::Section(s) => NotebookItem::Section(section(s, w)),
            SectionEntry::SectionGroup(g) => NotebookItem::Group {
                name: g.display_name().to_owned(),
                items: entries(g.entries(), w),
            },
        })
        .collect()
}

pub(crate) fn section(s: &Section, w: &mut Warnings) -> OneSection {
    report(s.report(), w);
    let pages = s
        .page_series()
        .iter()
        .flat_map(|series| series.pages())
        .map(|p| page(p, w))
        .collect();
    OneSection {
        name: s.display_name().to_owned(),
        color: s.color().map(rgb),
        pages,
    }
}

fn report(r: &Report, w: &mut Warnings) {
    for warning in r.warnings() {
        match warning.page() {
            Some((_, title)) => w.warn(
                "onenote.parser.pageWarning",
                "Page \"{page}\": {message}",
                &[("page", &title), ("message", &warning.message())],
            ),
            None => w.warn(
                "onenote.parser.warning",
                "{message}",
                &[("message", &warning.message())],
            ),
        }
    }
}

fn rgb(c: Color) -> Rgb {
    Rgb {
        r: c.r(),
        g: c.g(),
        b: c.b(),
    }
}

/// Per-page state: warnings plus ink lifted out of outlines.
struct Ctx<'w> {
    w: &'w mut Warnings,
    lifted: Vec<PageItem>,
}

fn page(p: &Page, w: &mut Warnings) -> OnePage {
    let title = if p.title().is_some() {
        p.title_text().unwrap_or_default().trim().to_owned()
    } else {
        String::new()
    };
    let mut cx = Ctx {
        w,
        lifted: Vec::new(),
    };
    let mut contents = Vec::new();
    for item in p.contents() {
        match item {
            PageContent::Outline(o) => contents.push(outline(o, &mut cx)),
            PageContent::Image(img) => {
                if let Some((data, mime)) = image_data(img, &mut cx) {
                    contents.push(PageItem::Image {
                        pos: pos(
                            img.offset_horizontal(),
                            img.offset_vertical(),
                            img.picture_width().or(img.layout_max_width()),
                            img.picture_height().or(img.layout_max_height()),
                        ),
                        data,
                        mime,
                        alt: alt(img),
                    });
                }
            }
            PageContent::EmbeddedFile(f) => {
                if let Some(data) = file_data(f, &mut cx) {
                    contents.push(PageItem::Attachment {
                        pos: pos(
                            f.offset_horizontal(),
                            f.offset_vertical(),
                            f.layout_max_width(),
                            f.layout_max_height(),
                        ),
                        file_name: f.filename().to_owned(),
                        data,
                    });
                }
            }
            PageContent::Ink(ink) => {
                if let Some(item) = ink_item(ink, true) {
                    contents.push(item);
                }
            }
            PageContent::Unknown => cx.w.warn(
                "onenote.page.unknownObject",
                "An unsupported object on a page was dropped",
                &[],
            ),
        }
    }
    contents.append(&mut cx.lifted);
    OnePage {
        title,
        level: map::page_level(p.level()),
        created: map::unix_time(p.created_time().unix_timestamp()),
        modified: map::unix_time(p.updated_time().unix_timestamp()),
        contents,
    }
}

/// A position from offsets and size in half inches; `None` without offsets.
fn pos(x: Option<f32>, y: Option<f32>, width: Option<f32>, height: Option<f32>) -> Option<Rect> {
    if x.is_none() && y.is_none() {
        return None;
    }
    let pt = |v: Option<f32>| v.filter(|v| v.is_finite()).map(map::half_inch_to_pt);
    Some(Rect {
        x: pt(x).unwrap_or(0.0),
        y: pt(y).unwrap_or(0.0),
        width: pt(width),
        height: pt(height),
    })
}

fn outline(o: &Outline, cx: &mut Ctx) -> PageItem {
    let mut blocks = Vec::new();
    items(o.items(), 0, &mut blocks, cx);
    PageItem::Outline {
        pos: pos(
            o.offset_horizontal(),
            o.offset_vertical(),
            o.layout_max_width(),
            o.layout_max_height(),
        ),
        blocks,
    }
}

fn items(list: &[OutlineItem], level: usize, out: &mut Vec<Block>, cx: &mut Ctx) {
    if level > MAX_DEPTH {
        cx.w.warn(
            "onenote.outline.tooDeep",
            "Text nested deeper than {max} levels was dropped",
            &[("max", &MAX_DEPTH)],
        );
        return;
    }
    for item in list {
        match item {
            OutlineItem::Group(g) => items(g.outlines(), level, out, cx),
            OutlineItem::Element(e) => {
                element(e, level, out, cx);
                items(e.children(), level + 1, out, cx);
            }
        }
    }
}

fn element(e: &OutlineElement, level: usize, out: &mut Vec<Block>, cx: &mut Ctx) {
    let list = e
        .list_contents()
        .first()
        .map(|l| map::list_info(l.list_format(), l.list_restart()));
    for content in e.contents() {
        match content {
            Content::RichText(rt) => out.push(paragraph(rt, list.clone(), level, cx)),
            Content::Table(t) => out.push(table(t, level, cx)),
            Content::Image(img) => {
                if let Some((data, mime)) = image_data(img, cx) {
                    let pt = |v: Option<f32>| v.map(map::half_inch_to_pt);
                    out.push(Block::Image {
                        data,
                        mime,
                        alt: alt(img),
                        width: pt(img.picture_width().or(img.layout_max_width())),
                        height: pt(img.picture_height().or(img.layout_max_height())),
                    });
                }
            }
            Content::EmbeddedFile(f) => {
                if let Some(data) = file_data(f, cx) {
                    out.push(Block::Attachment {
                        file_name: f.filename().to_owned(),
                        data,
                    });
                }
            }
            Content::Ink(ink) => {
                if let Some(item) = ink_item(ink, false) {
                    cx.lifted.push(item);
                    cx.w.warn(
                        "onenote.ink.inOutline",
                        "A drawing inside a text box was imported as a separate drawing",
                        &[],
                    );
                }
            }
            Content::Unknown => cx.w.warn(
                "onenote.outline.unknownObject",
                "An unsupported object in a text box was dropped",
                &[],
            ),
        }
    }
}

fn style(s: &ParagraphStyling) -> RunStyle {
    RunStyle {
        bold: s.bold(),
        italic: s.italic(),
        underline: s.underline(),
        strike: s.strikethrough(),
        sup: s.superscript(),
        sub: s.subscript(),
        font: s.font().map(str::to_owned),
        size_half_pt: s.font_size(),
        color: map::color_ref(s.font_color()),
        highlight: map::color_ref(s.highlight()),
        hidden: s.hidden(),
    }
}

fn paragraph(
    rt: &RichText,
    list: Option<crate::model::ListInfo>,
    level: usize,
    cx: &mut Ctx,
) -> Block {
    let base = style(rt.paragraph_style());
    let styles: Vec<RunStyle> = rt.text_run_formatting().iter().map(style).collect();
    let links: Vec<LinkRange> = rt
        .hyperlinks()
        .into_iter()
        .map(|l| LinkRange {
            start: l.start(),
            end: l.end(),
            target: l.target().to_owned(),
        })
        .collect();
    let runs = map::build_runs(rt.text(), rt.text_run_indices(), &styles, &base, &links);
    for obj in rt.embedded_objects() {
        if let EmbeddedObject::Ink(c) = obj {
            if let Some(item) = ink_item(c.ink(), false) {
                cx.lifted.push(item);
                cx.w.warn(
                    "onenote.ink.inText",
                    "Handwriting inside text was imported as a separate drawing",
                    &[],
                );
            }
        }
    }
    if !rt.math_inline_objects().is_empty() {
        cx.w.warn(
            "onenote.math",
            "An equation was imported as plain text",
            &[],
        );
    }
    Block::Paragraph {
        runs,
        list,
        tags: rt.note_tags().iter().map(tag).collect(),
        level: level.min(u8::MAX as usize) as u8,
        style: map::style_name(rt.paragraph_style().style_id()),
    }
}

fn tag(t: &NoteTag) -> Tag {
    let label = t.definition().map(|d| d.label()).unwrap_or_default();
    let shape = t.definition().map_or(NoteTagShape::NoIcon, |d| d.shape());
    let status = t.item_status();
    let checked = (map::is_check_box(shape) || status.task_tag()).then_some(status.completed());
    Tag {
        kind: map::tag_kind(label, shape),
        label: label.trim().to_owned(),
        checked,
    }
}

fn table(t: &Table, level: usize, cx: &mut Ctx) -> Block {
    if !t.note_tags().is_empty() {
        cx.w.warn("onenote.table.tags", "Tags on a table were dropped", &[]);
    }
    let rows = t
        .contents()
        .iter()
        .map(|row| {
            row.contents()
                .iter()
                .map(|cell| {
                    let mut blocks = Vec::new();
                    for e in cell.contents() {
                        element(e, 0, &mut blocks, cx);
                        items(e.children(), level + 1, &mut blocks, cx);
                    }
                    blocks
                })
                .collect()
        })
        .collect();
    Block::Table { rows }
}

fn alt(img: &Image) -> Option<String> {
    img.alt_text()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn image_data(img: &Image, cx: &mut Ctx) -> Option<(Vec<u8>, String)> {
    if img.hyperlink_url().is_some() {
        cx.w.warn("onenote.image.link", "A link on a picture was dropped", &[]);
    }
    if !img.note_tags().is_empty() {
        cx.w.warn("onenote.image.tags", "Tags on a picture were dropped", &[]);
    }
    let data = match (img.data_status(), img.read()) {
        (FileDataStatus::Available, Some(mut r)) => read_all(&mut r),
        _ => None,
    };
    let Some(data) = data else {
        cx.w.warn(
            "onenote.image.missing",
            "A picture without image data was dropped",
            &[],
        );
        return None;
    };
    let mime = map::image_mime(img.extension(), &data);
    Some((data, mime))
}

fn file_data(f: &EmbeddedFile, cx: &mut Ctx) -> Option<Vec<u8>> {
    if !f.note_tags().is_empty() {
        cx.w.warn(
            "onenote.attachment.tags",
            "Tags on an attached file were dropped",
            &[],
        );
    }
    let data = match f.data_status() {
        FileDataStatus::Available => read_all(&mut f.read()),
        _ => None,
    };
    if data.is_none() {
        cx.w.warn(
            "onenote.attachment.missing",
            "The attached file \"{name}\" has no data and was dropped",
            &[("name", &f.filename())],
        );
    }
    data
}

fn read_all(r: &mut dyn Read) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    r.read_to_end(&mut buf).ok().map(|_| buf)
}

/// A drawing as a page item. Stroke coordinates are in page ink space; the
/// item's corner is the strokes' top-left extent (plus the stored offset when
/// `placed`), so stored bounding boxes are not needed.
fn ink_item(ink: &Ink, placed: bool) -> Option<PageItem> {
    let mut raw = Vec::new();
    collect_strokes(ink, 0, &mut raw);
    let (min, max) = map::ink_extent(&raw)?;
    let strokes = map::ink_strokes(&raw, min);
    let pos = if placed {
        let at = |v: Option<f32>| {
            v.filter(|v| v.is_finite())
                .map_or(0.0, map::half_inch_to_pt)
        };
        Some(Rect {
            x: at(ink.offset_horizontal()) + map::ink_to_pt(min.0),
            y: at(ink.offset_vertical()) + map::ink_to_pt(min.1),
            width: Some(map::ink_to_pt(max.0 - min.0)),
            height: Some(map::ink_to_pt(max.1 - min.1)),
        })
    } else {
        None
    };
    Some(PageItem::Ink { pos, strokes })
}

fn collect_strokes(ink: &Ink, depth: usize, out: &mut Vec<RawStroke>) {
    if depth > MAX_DEPTH {
        return;
    }
    for s in ink.ink_strokes() {
        out.push(RawStroke {
            points: s.absolute_path().iter().map(|p| (p.x(), p.y())).collect(),
            width: s.width(),
            color: s.color(),
            pen_tip: s.pen_tip(),
            transparency: s.transparency(),
        });
    }
    for child in ink.child_groups() {
        collect_strokes(child, depth + 1, out);
    }
}
