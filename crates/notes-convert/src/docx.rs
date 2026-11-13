//! `.docx` ↔ page content, through `model-text` (the Write model) and `fmt-docx`.
//!
//! Import keeps headings (outline levels 1–6; `Title` → heading 1), paragraphs, bullet/numbered lists (nesting by
//! list level, start numbers), check-box paragraphs (`☐`/`☑`, as our export writes them) as task lists, `Quote`
//! paragraphs as block quotes, code-styled paragraphs as code blocks, tables (cells with their blocks,
//! `colspan`), inline images (as image blocks), hyperlinks, line breaks and run formatting (bold, italic,
//! underline, strike, sub/superscript, colour, highlight). Drawings (shapes, text boxes, charts), footnote
//! references and tables of contents are dropped with warnings; fields keep their displayed text (warning).
//!
//! Export writes one document: a page is a Heading 1 title plus its blocks; a section is all its pages, each
//! title starting on a new page. Lists use Word's default bullet/number definitions, task items `☐`/`☑`, code
//! blocks Courier New, block quotes an indent, rules a bottom border, tags plain-text markers.
use core_model::{Color, FontFace, FontSize, Rgb, Underline, VerticalAlign};
use model_text::{
    Block, BorderSide, BorderStyle, BreakKind, Document, Emu, Hyperlink, Indent, Inline,
    InlineImage, LevelKind, LinkTarget, NodeId, NumberingDef, NumberingRef, Paragraph,
    ParagraphBorders, Run, RunProperties, Spacing, Style, StyleKind, Table, TableBorders,
    TableCell, TableProperties, TableRow, Twips,
};
use serde_json::{json, Value};

use crate::pm::{self, attr, attr_str, content, marks, type_of, Flat, ListKind};
use crate::{
    Blob, BlobSource, ConvertError, Converted, ExportContext, ExportPage, ImportContext, Warnings,
};

// ==== import =============================================================================================

struct Imp<'c, 'a> {
    doc: &'c Document,
    ctx: &'c ImportContext<'a>,
    blobs: Vec<Blob>,
    w: Warnings,
}

fn is_code_style(style: &str) -> bool {
    let s = style.to_ascii_lowercase();
    s.contains("code") || s.contains("preformatted")
}

fn is_quote_style(style: &str) -> bool {
    let s = style.to_ascii_lowercase();
    s == "quote" || s == "intensequote" || s.contains("blockquote")
}

impl Imp<'_, '_> {
    fn run_marks(&self, r: &Run) -> Vec<Value> {
        let p = &r.props;
        let mut ms = Vec::new();
        let style = r.style.as_deref().unwrap_or_default();
        if p.bold == Some(true) || style == "Strong" {
            ms.push(pm::mark("bold"));
        }
        if p.italic == Some(true) || style == "Emphasis" {
            ms.push(pm::mark("italic"));
        }
        if p.underline.is_some_and(|u| u != Underline::None) && r.link.is_none() {
            ms.push(pm::mark("underline"));
        }
        if p.strike == Some(true) || p.double_strike == Some(true) {
            ms.push(pm::mark("strike"));
        }
        match p.vertical_align {
            Some(VerticalAlign::Superscript) => ms.push(pm::mark("superscript")),
            Some(VerticalAlign::Subscript) => ms.push(pm::mark("subscript")),
            _ => {}
        }
        if let (Some(Color::Rgb(c)), None) = (p.color, &r.link) {
            ms.push(pm::mark_with(
                "textStyle",
                json!({ "color": pm::hex(c.r, c.g, c.b) }),
            ));
        }
        if let Some(Color::Rgb(c)) = p.highlight {
            ms.push(pm::mark_with(
                "highlight",
                json!({ "color": pm::hex(c.r, c.g, c.b) }),
            ));
        }
        if let Some(FontFace::Named(f)) = &p.font {
            let f = f.to_ascii_lowercase();
            if f.contains("courier") || f.contains("consolas") || f.contains("mono") {
                ms.push(pm::mark("code"));
            }
        }
        if let Some(link) = &r.link {
            if !matches!(link.target, LinkTarget::Bookmark(_)) {
                if let Some(h) = pm::safe_href(&link.target.href()) {
                    ms.push(pm::mark_with("link", json!({ "href": h })));
                }
            }
        }
        ms
    }

    /// The inline content of a paragraph; images become `image` nodes (split out by `text_blocks`).
    fn inlines(&mut self, p: &Paragraph) -> Vec<Value> {
        let mut out = Vec::new();
        for i in &p.inlines {
            match i {
                Inline::Run(r) => {
                    let ms = self.run_marks(r);
                    let t: String = r
                        .text
                        .chars()
                        .map(|c| if c == '\t' { ' ' } else { c })
                        .filter(|c| !c.is_control())
                        .collect();
                    out.push(pm::text(&t, &ms));
                }
                Inline::Image(img) => match self.doc.media.get(img.media) {
                    Some(m) => {
                        let size = (img.width.0 > 0 && img.height.0 > 0)
                            .then(|| (img.width.0 as f64 / 12700.0, img.height.0 as f64 / 12700.0));
                        out.push(pm::image_block(
                            m.data.clone(),
                            Some(&m.content_type),
                            img.alt.as_deref(),
                            size,
                            &mut self.blobs,
                        ));
                    }
                    None => self.w.warn(
                        "docx.image.missing",
                        "An image without data was left out",
                        &[],
                    ),
                },
                Inline::Drawing(_) => self.w.warn(
                    "docx.drawing",
                    "Shapes, text boxes and charts were left out",
                    &[],
                ),
                Inline::Break(BreakKind::Line) => {
                    out.push(pm::node("hardBreak", None, Vec::new()));
                }
                Inline::Break(_) => {}
                Inline::Field(f) => {
                    self.w.warn(
                        "docx.field",
                        "Fields (page numbers, dates, references) were replaced by their text",
                        &[],
                    );
                    out.push(pm::text(&f.cached, &[]));
                }
                Inline::NoteRef(_) => {
                    self.w
                        .warn("docx.note", "Footnotes and endnotes were left out", &[])
                }
                Inline::CommentStart { .. }
                | Inline::CommentEnd { .. }
                | Inline::BookmarkStart { .. }
                | Inline::BookmarkEnd { .. } => {}
            }
        }
        out
    }

    /// The list of a paragraph; numberings without a visible label (Word/LibreOffice outline numbering of
    /// headings) are none.
    fn list_of(&self, p: &Paragraph) -> Option<(ListKind, u8)> {
        let n = self.doc.numbering_of(p)?;
        let lvl = self.doc.numbering.level(n)?;
        let kind = match lvl.kind {
            LevelKind::None => return None,
            LevelKind::Bullet => ListKind::Bullet,
            _ => ListKind::Ordered { start: lvl.start },
        };
        Some((kind, n.level))
    }

    fn blocks(&mut self, blocks: &[Block]) -> Vec<Value> {
        let mut flat: Vec<Flat> = Vec::new();
        // Consecutive quote / code paragraphs are merged into one block.
        let mut quote: Vec<Value> = Vec::new();
        let mut code: Vec<String> = Vec::new();
        for b in blocks {
            match b {
                Block::Paragraph(p) => {
                    let style = p.props.style.clone().unwrap_or_default();
                    if is_code_style(&style) {
                        flush_quote(&mut quote, &mut flat);
                        code.push(p.text().replace(['\u{b}', '\u{c}'], "\n"));
                        continue;
                    }
                    flush_code(&mut code, &mut flat);
                    let level = if style == "Title" {
                        Some(1)
                    } else {
                        self.doc.outline_level(p).map(|l| l.min(6))
                    };
                    let (inline, task) = strip_checkbox(self.inlines(p));
                    // A heading stays a heading even when its style is numbered.
                    let numbered = if level.is_some() {
                        None
                    } else {
                        self.list_of(p)
                    };
                    let list = match (task, numbered) {
                        (Some(c), l) => Some((ListKind::Task { checked: c }, l.map_or(0, |l| l.1))),
                        (None, l) => l,
                    };
                    let produced: Vec<Value> =
                        pm::text_blocks(inline, level.filter(|_| list.is_none()), self.ctx)
                            .into_iter()
                            .filter(|b| type_of(b) != "paragraph" || !content(b).is_empty())
                            .collect();
                    if is_quote_style(&style) && list.is_none() {
                        quote.extend(produced);
                        continue;
                    }
                    flush_quote(&mut quote, &mut flat);
                    for (k, blk) in produced.into_iter().enumerate() {
                        let in_list = k == 0 && type_of(&blk) == "paragraph";
                        flat.push(Flat {
                            block: blk,
                            list: if in_list { list } else { None },
                        });
                    }
                }
                Block::Table(t) => {
                    flush_quote(&mut quote, &mut flat);
                    flush_code(&mut code, &mut flat);
                    let block = self.table(t);
                    flat.push(Flat { block, list: None });
                }
                Block::Toc(_) => {
                    self.w
                        .warn("docx.toc", "A table of contents was left out", &[]);
                }
            }
        }
        flush_quote(&mut quote, &mut flat);
        flush_code(&mut code, &mut flat);
        pm::nest_lists(flat)
    }

    fn table(&mut self, t: &Table) -> Value {
        let mut merged = false;
        let mut rows = Vec::new();
        for (ri, r) in t.rows.iter().enumerate() {
            let header = ri == 0 && r.props.header;
            let mut cells = Vec::new();
            for c in &r.cells {
                merged |= c.v_merge.is_some();
                let mut blocks = self.blocks(&c.blocks);
                if blocks.is_empty() {
                    blocks.push(pm::paragraph(Vec::new()));
                }
                let attrs = (c.grid_span > 1).then(|| json!({ "colspan": c.grid_span }));
                cells.push(pm::node(
                    if header { "tableHeader" } else { "tableCell" },
                    attrs,
                    blocks,
                ));
            }
            rows.push(pm::node("tableRow", None, cells));
        }
        if merged {
            self.w.warn(
                "docx.table.vmerge",
                "Vertically merged table cells were split",
                &[],
            );
        }
        pm::node("table", None, rows)
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

fn flush_code(code: &mut Vec<String>, flat: &mut Vec<Flat>) {
    if !code.is_empty() {
        let t = std::mem::take(code).join("\n");
        let content = if t.is_empty() {
            Vec::new()
        } else {
            vec![pm::text(&t, &[])]
        };
        flat.push(Flat {
            block: pm::node("codeBlock", None, content),
            list: None,
        });
    }
}

/// A leading `☐ ` / `☑ ` / `☒ ` makes a paragraph a task item.
fn strip_checkbox(mut inline: Vec<Value>) -> (Vec<Value>, Option<bool>) {
    let Some(first) = inline.first_mut().filter(|n| pm::is_text(n)) else {
        return (inline, None);
    };
    let t = first["text"].as_str().unwrap_or_default().to_string();
    for (box_char, checked) in [('☐', false), ('☑', true), ('☒', true)] {
        if let Some(rest) = t.strip_prefix(box_char) {
            first["text"] = rest.trim_start().into();
            return (inline, Some(checked));
        }
    }
    (inline, None)
}

/// A `.docx` file → top-level blocks.
pub fn import(
    bytes: &[u8],
    ctx: &ImportContext<'_>,
) -> Result<Converted<Vec<Value>>, ConvertError> {
    let out = fmt_docx::read_with_context(bytes)?;
    let mut imp = Imp {
        doc: &out.document,
        ctx,
        blobs: Vec::new(),
        w: Warnings::default(),
    };
    for d in out.details {
        imp.w.push(d.into());
    }
    let value = imp.blocks(&out.document.body);
    Ok(Converted {
        value,
        blobs: imp.blobs,
        warnings: imp.w.into_vec(),
    })
}

// ==== export =============================================================================================

struct Exp<'a> {
    doc: Document,
    blobs: &'a dyn BlobSource,
    ctx: &'a ExportContext<'a>,
    /// Content width in points (images are scaled down to it).
    max_width_pt: f64,
}

#[derive(Clone, Copy)]
struct Para {
    style: Option<&'static str>,
    list: Option<NumberingRef>,
    indent: u32,
    code: bool,
    quote: bool,
}

impl Para {
    fn plain() -> Self {
        Para {
            style: None,
            list: None,
            indent: 0,
            code: false,
            quote: false,
        }
    }
}

/// The paragraph style of exported code blocks (Courier New 10 pt).
const CODE_STYLE: &str = "SourceCode";

fn rgb_of(v: &Value) -> Option<Rgb> {
    v.get("color")
        .and_then(Value::as_str)
        .and_then(pm::parse_color)
        .and_then(|h| Rgb::from_hex(&h).ok())
}

const LINK_BLUE: Rgb = Rgb {
    r: 0x05,
    g: 0x63,
    b: 0xC1,
};
const YELLOW: Rgb = Rgb {
    r: 0xFF,
    g: 0xFF,
    b: 0x00,
};

const HEADINGS: [&str; 6] = [
    "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6",
];

fn is_list(n: &Value) -> bool {
    matches!(type_of(n), "bulletList" | "orderedList" | "taskList")
}

impl Exp<'_> {
    fn id(&mut self) -> NodeId {
        self.doc.alloc_id()
    }

    fn paragraph(&mut self, opts: Para, inlines: Vec<Inline>) -> Block {
        let mut p = Paragraph::new(self.id());
        p.props.style = opts
            .style
            .or_else(|| (opts.code).then_some(CODE_STYLE))
            .or_else(|| (opts.quote && opts.list.is_none()).then_some("Quote"))
            .map(str::to_string);
        p.props.numbering = opts.list;
        if opts.indent > 0 && opts.list.is_none() {
            p.props.indent = Some(Indent {
                left: Some(Twips(i32::try_from(opts.indent).unwrap_or(0) * 720)),
                ..Default::default()
            });
        }
        p.inlines = inlines;
        Block::Paragraph(p)
    }

    fn run_props(n: &Value, code: bool) -> (RunProperties, Option<Hyperlink>) {
        let mut props = RunProperties::default();
        let mut link = None;
        for (m, a) in marks(n) {
            match m.as_str() {
                "bold" => props.bold = Some(true),
                "italic" => props.italic = Some(true),
                "underline" => props.underline = Some(Underline::Single),
                "strike" => props.strike = Some(true),
                "superscript" => props.vertical_align = Some(VerticalAlign::Superscript),
                "subscript" => props.vertical_align = Some(VerticalAlign::Subscript),
                "code" => props.font = Some(FontFace::from("Courier New")),
                "textStyle" => {
                    if let Some(c) = rgb_of(&a) {
                        props.color = Some(Color::Rgb(c));
                    }
                }
                "highlight" => props.highlight = Some(Color::Rgb(rgb_of(&a).unwrap_or(YELLOW))),
                "link" => {
                    link = a
                        .get("href")
                        .and_then(Value::as_str)
                        .and_then(pm::safe_href)
                        .filter(|h| !h.starts_with('#') && !h.starts_with("onenote:"))
                        .map(|h| Hyperlink::new(LinkTarget::from_url(&h)));
                }
                _ => {}
            }
        }
        if link.is_some() {
            props.color = Some(Color::Rgb(LINK_BLUE));
            props.underline = Some(Underline::Single);
        }
        if code {
            props.font = Some(FontFace::from("Courier New"));
        }
        (props, link)
    }

    fn runs(&mut self, nodes: &[Value], code: bool) -> Vec<Inline> {
        let mut out = Vec::new();
        for n in nodes {
            match type_of(n) {
                "text" => {
                    let (props, link) = Self::run_props(n, code);
                    let text = n.get("text").and_then(Value::as_str).unwrap_or_default();
                    for (i, line) in text.split('\n').enumerate() {
                        if i > 0 {
                            out.push(Inline::Break(BreakKind::Line));
                        }
                        if !line.is_empty() {
                            let mut r = Run::with_props(line, props.clone());
                            r.link.clone_from(&link);
                            out.push(Inline::Run(r));
                        }
                    }
                }
                "hardBreak" => out.push(Inline::Break(BreakKind::Line)),
                "pageLink" => {
                    let id = attr_str(n, "pageId").unwrap_or_default();
                    let title = attr_str(n, "title")
                        .map(str::to_string)
                        .or_else(|| self.ctx.title_of(id))
                        .unwrap_or_default();
                    out.push(Inline::Run(Run::new(title)));
                }
                "image" => out.extend(self.image(n)),
                _ => {
                    let t = pm::inline_text(n);
                    if !t.is_empty() {
                        out.push(Inline::Run(Run::new(t)));
                    }
                }
            }
        }
        out
    }

    fn image(&mut self, n: &Value) -> Option<Inline> {
        let alt = attr_str(n, "alt").map(str::to_string);
        let Some(bytes) = attr_str(n, "blob").and_then(|id| self.blobs.blob(id)) else {
            return alt.map(|a| Inline::Run(Run::new(a)));
        };
        let mime = pm::sniff_mime(bytes);
        if !matches!(mime, "image/png" | "image/jpeg" | "image/gif" | "image/bmp") {
            return alt.map(|a| Inline::Run(Run::new(a)));
        }
        let (mut w, mut h) = match (
            attr(n, "width").and_then(Value::as_f64),
            attr(n, "height").and_then(Value::as_f64),
        ) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => (w, h),
            // Pixels at 96 dpi → points.
            _ => pm::image_size(bytes).map_or((200.0, 150.0), |(w, h)| {
                (f64::from(w) * 0.75, f64::from(h) * 0.75)
            }),
        };
        if w > self.max_width_pt {
            h *= self.max_width_pt / w;
            w = self.max_width_pt;
        }
        let media = self.doc.media.insert(mime, bytes.to_vec());
        let mut img = InlineImage::new(media, Emu::from_pt(w), Emu::from_pt(h));
        img.alt = alt;
        Some(Inline::Image(img))
    }

    fn marker(&self, n: &Value) -> Vec<Inline> {
        let (tags, checked) = pm::block_tags(n);
        if tags.is_empty() {
            return Vec::new();
        }
        vec![Inline::Run(Run::new(self.ctx.tags.marker(&tags, checked)))]
    }

    fn list_def(&mut self, ordered: bool, start: u32) -> u32 {
        let id = self
            .doc
            .numbering
            .defs
            .iter()
            .map(|d| d.id)
            .max()
            .unwrap_or(0)
            + 1;
        let mut def = if ordered {
            NumberingDef::decimal_default(id)
        } else {
            NumberingDef::bullet_default(id)
        };
        if ordered && start != 1 {
            if let Some(l) = def.levels.first_mut() {
                l.start = start;
            }
        }
        self.doc.numbering.defs.push(def);
        id
    }

    fn blocks(&mut self, nodes: &[Value], opts: Para, out: &mut Vec<Block>) {
        for n in nodes {
            self.block(n, opts, out);
        }
    }

    fn block(&mut self, n: &Value, opts: Para, out: &mut Vec<Block>) {
        let c = content(n);
        match type_of(n) {
            "paragraph" => {
                let mut runs = self.runs(c, opts.code);
                runs.extend(self.marker(n));
                out.push(self.paragraph(opts, runs));
            }
            "heading" => {
                let l = attr(n, "level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 6);
                let mut runs = self.runs(c, false);
                runs.extend(self.marker(n));
                let style = Some(HEADINGS[(l - 1) as usize]);
                out.push(self.paragraph(Para { style, ..opts }, runs));
            }
            "codeBlock" => {
                let t = pm::inline_text(n);
                for line in t.split('\n') {
                    let runs = if line.is_empty() {
                        Vec::new()
                    } else {
                        vec![Inline::Run(Run::new(line))]
                    };
                    out.push(self.paragraph(Para { code: true, ..opts }, runs));
                }
            }
            "blockquote" => {
                // Paragraphs take the Quote style; lists and other blocks inside are indented.
                let inner = Para {
                    indent: opts.indent + u32::from(opts.quote),
                    quote: true,
                    ..opts
                };
                self.blocks(c, inner, out);
            }
            "bulletList" | "orderedList" | "taskList" => self.list(n, opts, out),
            "horizontalRule" => {
                let mut p = Paragraph::new(self.id());
                p.props.borders = Some(ParagraphBorders {
                    bottom: Some(BorderSide {
                        style: BorderStyle::Single,
                        width: BorderSide::width_from_eighths(6),
                        color: Color::Auto,
                        space: Some(1),
                    }),
                    ..Default::default()
                });
                out.push(Block::Paragraph(p));
            }
            "image" => {
                let img = self.image(n).into_iter().collect();
                out.push(self.paragraph(opts, img));
            }
            "attachment" => {
                let name = attr_str(n, "name").unwrap_or("attachment");
                let runs = vec![Inline::Run(Run::new(format!("📎 {name}")))];
                out.push(self.paragraph(opts, runs));
            }
            "table" => {
                let t = self.table(n);
                out.push(t);
            }
            _ if !c.is_empty() => self.blocks(c, opts, out),
            _ => {}
        }
    }

    fn list(&mut self, n: &Value, opts: Para, out: &mut Vec<Block>) {
        let level = opts.list.map_or(0, |l| (l.level + 1).min(8));
        let num = match type_of(n) {
            "orderedList" => {
                let start = attr(n, "start")
                    .and_then(Value::as_u64)
                    .and_then(|s| u32::try_from(s).ok())
                    .unwrap_or(1);
                Some(self.list_def(true, start))
            }
            "bulletList" => Some(self.list_def(false, 1)),
            _ => None,
        };
        // Task lists are unnumbered paragraphs with a check box character, indented by depth.
        let list = num.map(|num_id| NumberingRef { num_id, level });
        let item_opts = Para {
            list,
            indent: if list.is_none() {
                opts.indent + u32::from(level)
            } else {
                opts.indent
            },
            style: None,
            ..opts
        };
        for item in content(n) {
            let checked = attr(item, "checked").and_then(Value::as_bool);
            for (k, child) in content(item).iter().enumerate() {
                if k == 0 {
                    let start = out.len();
                    self.block(child, item_opts, out);
                    let tag = self.marker(item);
                    if let Some(Block::Paragraph(p)) = out.get_mut(start) {
                        if type_of(n) == "taskList" {
                            let mark = if checked == Some(true) {
                                "☑ "
                            } else {
                                "☐ "
                            };
                            p.inlines.insert(0, Inline::Run(Run::new(mark)));
                        }
                        p.inlines.extend(tag);
                    }
                } else if is_list(child) {
                    // Nested lists continue one level deeper (task lists nest by indent).
                    let nested = Para {
                        list: Some(list.unwrap_or(NumberingRef { num_id: 0, level })),
                        indent: item_opts.indent,
                        ..opts
                    };
                    if nested.list.is_some_and(|l| l.num_id == 0) {
                        let deeper = Para {
                            list: None,
                            indent: item_opts.indent + 1,
                            ..opts
                        };
                        self.list(child, deeper, out);
                    } else {
                        self.list(child, nested, out);
                    }
                } else {
                    // Continuation paragraphs of an item: indented, unnumbered.
                    let cont = Para {
                        list: None,
                        indent: item_opts.indent + u32::from(level) + 1,
                        ..opts
                    };
                    self.block(child, cont, out);
                }
            }
        }
    }

    fn table(&mut self, n: &Value) -> Block {
        let span = |c: &Value| {
            attr(c, "colspan")
                .and_then(Value::as_u64)
                .and_then(|s| u16::try_from(s).ok())
                .unwrap_or(1)
                .max(1)
        };
        let cols = content(n)
            .iter()
            .map(|r| {
                content(r)
                    .iter()
                    .map(|c| usize::from(span(c)))
                    .sum::<usize>()
            })
            .max()
            .unwrap_or(1)
            .max(1);
        let width = self.doc.page.content_width().0;
        let col_w = width / i32::try_from(cols).unwrap_or(1);
        let side = BorderSide {
            style: BorderStyle::Single,
            width: BorderSide::width_from_eighths(4),
            color: Color::Auto,
            space: None,
        };
        let mut rows = Vec::new();
        for (ri, r) in content(n).iter().enumerate() {
            let mut cells = Vec::new();
            let mut header = false;
            for c in content(r) {
                header |= type_of(c) == "tableHeader";
                let mut blocks = Vec::new();
                self.blocks(content(c), Para::plain(), &mut blocks);
                if blocks.is_empty() {
                    blocks.push(self.paragraph(Para::plain(), Vec::new()));
                }
                let id = self.id();
                let mut cell = TableCell::new(id, Default::default(), blocks);
                cell.grid_span = span(c);
                cells.push(cell);
            }
            let id = self.id();
            let mut row = TableRow {
                id,
                props: Default::default(),
                cells,
            };
            if ri == 0 && header {
                row.props.header = true;
            }
            rows.push(row);
        }
        let id = self.id();
        Block::Table(Table {
            id,
            props: TableProperties {
                col_widths: vec![Twips(col_w); cols],
                borders: Some(TableBorders::all(side)),
                ..Default::default()
            },
            rows,
        })
    }

    fn page(&mut self, p: &ExportPage, page_break: bool, out: &mut Vec<Block>) {
        let mut title = Paragraph::new(self.id());
        title.props.style = Some("Heading1".into());
        if page_break {
            title.props.page_break_before = Some(true);
        }
        if !p.title.is_empty() {
            title.inlines.push(Inline::Run(Run::new(p.title.clone())));
        }
        out.push(Block::Paragraph(title));
        self.blocks(content(&p.doc), Para::plain(), out);
    }
}

/// Pages (one, or a whole section) as one `.docx` document: each page a Heading 1 title, pages after the first
/// starting on a new page.
pub fn export(
    pages: &[ExportPage],
    blobs: &dyn BlobSource,
    ctx: &ExportContext<'_>,
) -> Result<Vec<u8>, ConvertError> {
    let mut doc = Document::new();
    doc.body.clear();
    let mut code = Style::new(CODE_STYLE, "Source Code", StyleKind::Paragraph);
    code.based_on = Some("Normal".into());
    code.run.font = Some(FontFace::from("Courier New"));
    code.run.size = Some(FontSize::from_pt(10.0));
    code.paragraph.spacing = Some(Spacing {
        before: Some(Twips(0)),
        after: Some(Twips(0)),
        ..Default::default()
    });
    doc.styles.insert(code);
    let max_width_pt = f64::from(doc.page.content_width().0) / 20.0;
    let mut e = Exp {
        doc,
        blobs,
        ctx,
        max_width_pt,
    };
    let mut body = Vec::new();
    for (i, p) in pages.iter().enumerate() {
        e.page(p, i > 0, &mut body);
    }
    if body.is_empty() {
        let empty = e.paragraph(Para::plain(), Vec::new());
        body.push(empty);
    }
    if let Some(first) = pages.first().filter(|p| !p.title.is_empty()) {
        e.doc.properties.title = Some(first.title.clone());
    }
    e.doc.body = body;
    e.doc.normalize();
    Ok(fmt_docx::write(&e.doc)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkbox_prefix() {
        let (i, c) = strip_checkbox(vec![pm::text("☑ done", &[])]);
        assert_eq!(c, Some(true));
        assert_eq!(i[0]["text"], "done");
        assert_eq!(strip_checkbox(vec![pm::text("x", &[])]).1, None);
    }
}
