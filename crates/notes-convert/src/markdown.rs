//! Markdown ↔ page content. Import: CommonMark + GFM tables, task lists and strikethrough (`pulldown-cmark`);
//! inline `<u>`, `<sub>`, `<sup>`, `<mark>`, `<br>` become marks / hard breaks, other raw HTML is dropped with a
//! warning; images only from `data:` URIs (others stay links); `[[Title]]` → `pageLink` when the title resolves.
//! Export: our own writer (the same subset; underline/sub/sup/highlight as inline HTML, page links as
//! `[[Title]]`, tags as plain-text markers ` [Important]`).
use std::collections::BTreeMap;
use std::io::{Cursor, Write};

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde_json::{json, Value};

use crate::pm::{self, attr, attr_str, content, marks, type_of};
use crate::{
    Blob, BlobSource, ConvertError, Converted, ExportContext, ExportPage, ImportContext, Warnings,
};

// ==== import =============================================================================================

#[derive(Debug)]
enum Kind {
    Doc,
    Paragraph,
    Heading(u8),
    Quote,
    Code(Option<String>),
    List(Option<u64>),
    Item,
    Table,
    Row { header: bool },
    Cell { header: bool },
    Image { src: String },
    Skip,
}

struct Frame {
    kind: Kind,
    blocks: Vec<Value>,
    inline: Vec<Value>,
    text: String,
    task: Option<bool>,
}

impl Frame {
    fn new(kind: Kind) -> Self {
        Frame {
            kind,
            blocks: Vec::new(),
            inline: Vec::new(),
            text: String::new(),
            task: None,
        }
    }
}

struct Builder<'c, 'a> {
    stack: Vec<Frame>,
    marks: Vec<Value>,
    ctx: &'c ImportContext<'a>,
    blobs: Vec<Blob>,
    w: Warnings,
}

impl Builder<'_, '_> {
    fn top(&mut self) -> &mut Frame {
        self.stack.last_mut().expect("doc frame")
    }

    /// Inline content waiting in a container (tight list items, cells) becomes a paragraph before a block.
    fn flush_inline(&mut self) {
        let f = self.top();
        if matches!(
            f.kind,
            Kind::Paragraph | Kind::Heading(_) | Kind::Cell { .. }
        ) {
            return;
        }
        if f.inline.is_empty() {
            return;
        }
        let inline = std::mem::take(&mut f.inline);
        let blocks = self.inline_blocks(inline, None);
        self.top().blocks.extend(blocks);
    }

    fn inline_blocks(&mut self, inline: Vec<Value>, level: Option<u8>) -> Vec<Value> {
        pm::text_blocks(inline, level, self.ctx)
    }

    fn push_inline(&mut self, n: Value) {
        let f = self.top();
        if let Kind::Image { .. } = f.kind {
            f.text
                .push_str(n.get("text").and_then(Value::as_str).unwrap_or_default());
            return;
        }
        if let Kind::Code(_) = f.kind {
            f.text
                .push_str(n.get("text").and_then(Value::as_str).unwrap_or_default());
            return;
        }
        f.inline.push(n);
    }

    fn active_marks(&self) -> Vec<Value> {
        self.marks
            .iter()
            .filter(|m| !m.is_null())
            .cloned()
            .collect()
    }

    fn text(&mut self, s: &str) {
        let marks = self.active_marks();
        self.push_inline(pm::text(s, &marks));
    }

    fn start(&mut self, tag: Tag<'_>) {
        let block = |k: Kind| Some(Frame::new(k));
        let frame = match tag {
            Tag::Paragraph => block(Kind::Paragraph),
            Tag::Heading { level, .. } => block(Kind::Heading(heading_level(level))),
            Tag::BlockQuote(_) => block(Kind::Quote),
            Tag::CodeBlock(k) => block(Kind::Code(match k {
                CodeBlockKind::Fenced(l) if !l.trim().is_empty() => {
                    Some(l.split_whitespace().next().unwrap_or_default().to_string())
                }
                _ => None,
            })),
            Tag::List(start) => block(Kind::List(start)),
            Tag::Item => block(Kind::Item),
            Tag::Table(_) => block(Kind::Table),
            Tag::TableHead => block(Kind::Row { header: true }),
            Tag::TableRow => block(Kind::Row { header: false }),
            Tag::TableCell => {
                let header = matches!(self.top().kind, Kind::Row { header: true });
                block(Kind::Cell { header })
            }
            Tag::HtmlBlock | Tag::MetadataBlock(_) | Tag::FootnoteDefinition(_) => {
                block(Kind::Skip)
            }
            Tag::Emphasis => {
                self.marks.push(pm::mark("italic"));
                None
            }
            Tag::Strong => {
                self.marks.push(pm::mark("bold"));
                None
            }
            Tag::Strikethrough => {
                self.marks.push(pm::mark("strike"));
                None
            }
            Tag::Superscript => {
                self.marks.push(pm::mark("superscript"));
                None
            }
            Tag::Subscript => {
                self.marks.push(pm::mark("subscript"));
                None
            }
            Tag::Link { dest_url, .. } => {
                match pm::safe_href(&dest_url) {
                    Some(h) => self.marks.push(pm::mark_with("link", json!({ "href": h }))),
                    None => {
                        self.w.warn(
                            "notes.link.unsafe",
                            "A link to \"{href}\" was removed (only web, e-mail and phone links are kept)",
                            &[("href", &dest_url)],
                        );
                        self.marks.push(Value::Null);
                    }
                }
                None
            }
            Tag::Image { dest_url, .. } => block(Kind::Image {
                src: dest_url.to_string(),
            }),
            _ => None,
        };
        if let Some(f) = frame {
            let is_inline = matches!(f.kind, Kind::Image { .. });
            if !is_inline && !matches!(f.kind, Kind::Cell { .. } | Kind::Row { .. }) {
                self.flush_inline();
            }
            self.stack.push(f);
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Emphasis
            | TagEnd::Strong
            | TagEnd::Strikethrough
            | TagEnd::Superscript
            | TagEnd::Subscript
            | TagEnd::Link => {
                self.marks.pop();
                return;
            }
            TagEnd::Paragraph
            | TagEnd::Heading(_)
            | TagEnd::BlockQuote(_)
            | TagEnd::CodeBlock
            | TagEnd::List(_)
            | TagEnd::Item
            | TagEnd::Table
            | TagEnd::TableHead
            | TagEnd::TableRow
            | TagEnd::TableCell
            | TagEnd::Image
            | TagEnd::HtmlBlock
            | TagEnd::MetadataBlock(_)
            | TagEnd::FootnoteDefinition => {}
            _ => return,
        }
        self.flush_inline();
        let Some(f) = self.stack.pop() else { return };
        let out: Vec<Value> = match f.kind {
            Kind::Doc => Vec::new(),
            Kind::Skip => Vec::new(),
            Kind::Paragraph => self.inline_blocks(f.inline, None),
            Kind::Heading(l) => self.inline_blocks(f.inline, Some(l)),
            Kind::Quote => vec![pm::node("blockquote", None, non_empty(f.blocks))],
            Kind::Code(lang) => {
                let t = f.text.strip_suffix('\n').unwrap_or(&f.text).to_string();
                vec![pm::node(
                    "codeBlock",
                    lang.map(|l| json!({ "language": l })),
                    if t.is_empty() {
                        Vec::new()
                    } else {
                        vec![pm::text(&t, &[])]
                    },
                )]
            }
            Kind::Item => {
                let item = match f.task {
                    Some(checked) => pm::node(
                        "taskItem",
                        Some(json!({ "checked": checked })),
                        non_empty(f.blocks),
                    ),
                    None => pm::node("listItem", None, non_empty(f.blocks)),
                };
                vec![item]
            }
            Kind::List(start) => {
                let task = f.blocks.first().is_some_and(|i| type_of(i) == "taskItem");
                if task {
                    let items = f
                        .blocks
                        .into_iter()
                        .map(|mut i| {
                            if type_of(&i) != "taskItem" {
                                i["type"] = "taskItem".into();
                                pm::set_attr(&mut i, "checked", false.into());
                            }
                            i
                        })
                        .collect();
                    vec![pm::node("taskList", None, items)]
                } else {
                    let items = f
                        .blocks
                        .into_iter()
                        .map(|mut i| {
                            if type_of(&i) == "taskItem" {
                                i["type"] = "listItem".into();
                                if let Some(a) = i.get_mut("attrs").and_then(Value::as_object_mut) {
                                    a.remove("checked");
                                }
                            }
                            i
                        })
                        .collect();
                    match start {
                        Some(s) => vec![pm::node(
                            "orderedList",
                            (s != 1).then(|| json!({ "start": s })),
                            items,
                        )],
                        None => vec![pm::node("bulletList", None, items)],
                    }
                }
            }
            Kind::Table => vec![pm::node("table", None, f.blocks)],
            Kind::Row { .. } => vec![pm::node("tableRow", None, f.blocks)],
            Kind::Cell { header } => {
                let p = self.inline_blocks(f.inline, None);
                vec![pm::node(
                    if header { "tableHeader" } else { "tableCell" },
                    None,
                    non_empty(p),
                )]
            }
            Kind::Image { src } => {
                let alt = f.text;
                match pm::decode_data_uri(&src).filter(|(m, _)| m.starts_with("image/")) {
                    Some((mime, bytes)) => {
                        let img =
                            pm::image_block(bytes, Some(&mime), Some(&alt), None, &mut self.blobs);
                        self.push_inline(img);
                    }
                    None => {
                        let label = if alt.is_empty() { src.clone() } else { alt };
                        if let Some(h) = pm::safe_href(&src) {
                            self.w.warn(
                                "notes.image.remote",
                                "Images from the web are not downloaded; kept as links",
                                &[],
                            );
                            let mut ms = self.active_marks();
                            ms.push(pm::mark_with("link", json!({ "href": h })));
                            self.push_inline(pm::text(&label, &ms));
                        } else {
                            self.w.warn(
                                "notes.image.missing",
                                "Image \"{src}\" is not embedded in the file and was left out",
                                &[("src", &src)],
                            );
                            self.text(&label);
                        }
                    }
                }
                return;
            }
        };
        self.top().blocks.extend(out);
    }

    fn html(&mut self, h: &str, block: bool) {
        let tag = h.trim().to_ascii_lowercase();
        let toggles = [
            ("u", "underline"),
            ("sub", "subscript"),
            ("sup", "superscript"),
            ("mark", "highlight"),
            ("s", "strike"),
            ("del", "strike"),
            ("b", "bold"),
            ("strong", "bold"),
            ("i", "italic"),
            ("em", "italic"),
        ];
        if !block {
            if matches!(tag.as_str(), "<br>" | "<br/>" | "<br />") {
                self.push_inline(pm::node("hardBreak", None, Vec::new()));
                return;
            }
            for (t, m) in toggles {
                if tag == format!("<{t}>") {
                    self.marks.push(pm::mark(m));
                    return;
                }
                if tag == format!("</{t}>") {
                    if let Some(i) = self.marks.iter().rposition(|x| type_of(x) == m) {
                        self.marks.remove(i);
                    }
                    return;
                }
            }
            if tag.starts_with("<!--") {
                return;
            }
        }
        self.w.warn(
            "notes.md.html",
            "Raw HTML in the Markdown file was left out",
            &[],
        );
    }
}

fn non_empty(blocks: Vec<Value>) -> Vec<Value> {
    if blocks.is_empty() {
        vec![pm::paragraph(Vec::new())]
    } else {
        blocks
    }
}

fn heading_level(l: HeadingLevel) -> u8 {
    match l {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// Markdown text → top-level blocks.
#[must_use]
pub fn import(text: &str, ctx: &ImportContext<'_>) -> Converted<Vec<Value>> {
    let opts = Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH;
    let mut b = Builder {
        stack: vec![Frame::new(Kind::Doc)],
        marks: Vec::new(),
        ctx,
        blobs: Vec::new(),
        w: Warnings::default(),
    };
    for ev in Parser::new_ext(text, opts) {
        if matches!(b.top().kind, Kind::Skip) && !matches!(ev, Event::End(_)) {
            continue;
        }
        match ev {
            Event::Start(t) => b.start(t),
            Event::End(t) => b.end(t),
            Event::Text(t) => b.text(&t),
            Event::Code(t) => {
                let mut ms = b.active_marks();
                ms.push(pm::mark("code"));
                b.push_inline(pm::text(&t, &ms));
            }
            Event::SoftBreak => b.text(" "),
            Event::HardBreak => b.push_inline(pm::node("hardBreak", None, Vec::new())),
            Event::Rule => {
                b.flush_inline();
                b.top()
                    .blocks
                    .push(pm::node("horizontalRule", None, Vec::new()));
            }
            Event::TaskListMarker(checked) => {
                if let Some(f) = b
                    .stack
                    .iter_mut()
                    .rev()
                    .find(|f| matches!(f.kind, Kind::Item))
                {
                    f.task = Some(checked);
                }
            }
            Event::Html(h) => b.html(&h, true),
            Event::InlineHtml(h) => b.html(&h, false),
            Event::InlineMath(t) | Event::DisplayMath(t) => b.text(&t),
            Event::FootnoteReference(_) => {}
        }
    }
    while b.stack.len() > 1 {
        b.end(TagEnd::Paragraph);
    }
    let doc = b.stack.pop().expect("doc");
    Converted {
        value: doc.blocks,
        blobs: b.blobs,
        warnings: b.w.into_vec(),
    }
}

/// Imports Markdown bytes (UTF-8; a BOM is skipped).
pub fn import_bytes(
    bytes: &[u8],
    ctx: &ImportContext<'_>,
) -> Result<Converted<Vec<Value>>, ConvertError> {
    let s = std::str::from_utf8(bytes).map_err(|_| ConvertError::NotText)?;
    Ok(import(s.strip_prefix('\u{feff}').unwrap_or(s), ctx))
}

// ==== export =============================================================================================

/// Where exported images and attachments go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assets {
    /// Images as `data:` URIs; attachments as their name only (a single `.md` file).
    Inline,
    /// Files under `assets/` (collected for a zip).
    Files,
}

pub(crate) struct Writer<'a> {
    pub assets: Assets,
    pub blobs: &'a dyn BlobSource,
    pub ctx: &'a ExportContext<'a>,
    /// Files for [`Assets::Files`]: path → bytes.
    pub files: BTreeMap<String, Vec<u8>>,
}

const MARK_ORDER: &[&str] = &[
    "link",
    "pageLink",
    "bold",
    "italic",
    "strike",
    "underline",
    "highlight",
    "subscript",
    "superscript",
];

fn open_mark(name: &str, attrs: &Value) -> String {
    let _ = attrs;
    match name {
        "link" | "pageLink" => "[".into(),
        "bold" => "**".into(),
        "italic" => "*".into(),
        "strike" => "~~".into(),
        "underline" => "<u>".into(),
        "highlight" => "<mark>".into(),
        "subscript" => "<sub>".into(),
        "superscript" => "<sup>".into(),
        _ => String::new(),
    }
}

fn close_mark(name: &str, attrs: &Value, text: &str) -> String {
    match name {
        "link" => format!(
            "]({})",
            attrs
                .get("href")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .replace(' ', "%20")
                .replace(')', "%29")
        ),
        "pageLink" => {
            let _ = text;
            "]".into()
        }
        "bold" => "**".into(),
        "italic" => "*".into(),
        "strike" => "~~".into(),
        "underline" => "</u>".into(),
        "highlight" => "</mark>".into(),
        "subscript" => "</sub>".into(),
        "superscript" => "</sup>".into(),
        _ => String::new(),
    }
}

/// Escapes Markdown punctuation in plain text.
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if "\\`*_[]<>~|".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Escapes what would start a block at the beginning of a line.
fn escape_line_start(line: &str) -> String {
    let t = line.trim_start();
    let lead = &line[..line.len() - t.len()];
    let needs = t.starts_with('#')
        || t.starts_with("- ")
        || t.starts_with("+ ")
        || t.starts_with('>')
        || t == "-"
        || t.starts_with("---")
        || t.starts_with("===");
    if needs {
        return format!("{lead}\\{t}");
    }
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && (t[digits..].starts_with(". ") || t[digits..].starts_with(") ")) {
        return format!("{lead}{}\\{}", &t[..digits], &t[digits..]);
    }
    line.to_string()
}

fn code_span(s: &str) -> String {
    let mut n = 1;
    while s.contains(&"`".repeat(n)) {
        n += 1;
    }
    let fence = "`".repeat(n);
    if s.starts_with('`') || s.ends_with('`') {
        format!("{fence} {s} {fence}")
    } else {
        format!("{fence}{s}{fence}")
    }
}

impl Writer<'_> {
    /// Inline content of a text block.
    fn inline(&mut self, nodes: &[Value]) -> String {
        let mut out = String::new();
        let mut stack: Vec<(String, Value)> = Vec::new();
        let mut pending_ws = String::new();
        let close_all = |stack: &mut Vec<(String, Value)>, keep: usize, out: &mut String| {
            while stack.len() > keep {
                let (n, a) = stack.pop().expect("len");
                out.push_str(&close_mark(&n, &a, ""));
            }
        };
        for n in nodes {
            let ms: Vec<(String, Value)> = {
                let mut v: Vec<(String, Value)> = marks(n)
                    .into_iter()
                    .filter(|(m, _)| MARK_ORDER.contains(&m.as_str()))
                    .collect();
                v.sort_by_key(|(m, _)| MARK_ORDER.iter().position(|x| x == m));
                v
            };
            match type_of(n) {
                "text" => {
                    let raw = n.get("text").and_then(Value::as_str).unwrap_or_default();
                    let core = raw.trim();
                    if core.is_empty() {
                        pending_ws.push_str(raw);
                        continue;
                    }
                    let lead = &raw[..raw.len() - raw.trim_start().len()];
                    let trail = &raw[raw.trim_end().len()..];
                    let keep = stack.iter().zip(&ms).take_while(|(a, b)| a == b).count();
                    close_all(&mut stack, keep, &mut out);
                    out.push_str(&pending_ws);
                    pending_ws.clear();
                    out.push_str(lead);
                    for m in &ms[keep..] {
                        out.push_str(&open_mark(&m.0, &m.1));
                        stack.push(m.clone());
                    }
                    let is_code = marks(n).iter().any(|(m, _)| m == "code");
                    if is_code {
                        out.push_str(&code_span(core));
                    } else if ms.iter().any(|(m, _)| m == "pageLink") {
                        out.push_str(&format!("[{}]", core.replace(']', "")));
                    } else {
                        out.push_str(&escape(core).replace('\n', "\\\n"));
                    }
                    pending_ws.push_str(trail);
                }
                "hardBreak" => {
                    close_all(&mut stack, 0, &mut out);
                    pending_ws.clear();
                    out.push_str("\\\n");
                }
                "pageLink" => {
                    close_all(&mut stack, 0, &mut out);
                    out.push_str(&pending_ws);
                    pending_ws.clear();
                    let title = attr_str(n, "title")
                        .map(str::to_string)
                        .or_else(|| attr_str(n, "pageId").and_then(|id| self.ctx.title_of(id)))
                        .unwrap_or_default();
                    out.push_str(&format!("[[{}]]", title.replace(']', "")));
                }
                "image" => {
                    close_all(&mut stack, 0, &mut out);
                    out.push_str(&pending_ws);
                    pending_ws.clear();
                    out.push_str(&self.image(n));
                }
                _ => {
                    let t = pm::inline_text(n);
                    out.push_str(&escape(&t));
                }
            }
        }
        close_all(&mut stack, 0, &mut out);
        out
    }

    fn image(&mut self, n: &Value) -> String {
        let alt = attr_str(n, "alt").unwrap_or_default().replace(']', "");
        let Some(id) = attr_str(n, "blob") else {
            return escape(&alt);
        };
        let Some(bytes) = self.blobs.blob(id) else {
            return escape(&alt);
        };
        let mime = pm::sniff_mime(bytes);
        match self.assets {
            Assets::Inline => format!("![{alt}]({})", pm::data_uri(mime, bytes)),
            Assets::Files => {
                let path = format!("assets/{id}.{}", pm::ext_of(mime));
                self.files.insert(path.clone(), bytes.to_vec());
                format!("![{alt}]({path})")
            }
        }
    }

    fn attachment(&mut self, n: &Value) -> String {
        let name = attr_str(n, "name").unwrap_or("attachment");
        let data = attr_str(n, "blob").and_then(|id| self.blobs.blob(id).map(|b| (id, b)));
        match (self.assets, data) {
            (Assets::Files, Some((id, bytes))) => {
                let path = format!(
                    "assets/{}-{}",
                    &id[..id.len().min(12)],
                    safe_file_name(name)
                );
                self.files.insert(path.clone(), bytes.to_vec());
                format!("[{}]({})", escape(name), path.replace(' ', "%20"))
            }
            _ => format!("📎 {}", escape(name)),
        }
    }

    fn marker(&self, n: &Value) -> String {
        let (tags, checked) = pm::block_tags(n);
        if tags.is_empty() {
            String::new()
        } else {
            self.ctx.tags.marker(&tags, checked)
        }
    }

    /// The lines of one block.
    pub(crate) fn block(&mut self, n: &Value) -> Vec<String> {
        match type_of(n) {
            "paragraph" => {
                let s = format!("{}{}", self.inline(content(n)), self.marker(n));
                if s.is_empty() {
                    return Vec::new();
                }
                s.split('\n').map(escape_line_start).collect()
            }
            "heading" => {
                let level = attr(n, "level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 6);
                let s = format!("{}{}", self.inline(content(n)), self.marker(n));
                vec![format!(
                    "{} {}",
                    "#".repeat(level as usize),
                    s.replace("\\\n", " ")
                )]
            }
            "codeBlock" => {
                let t = pm::inline_text(n);
                let mut fence = "```".to_string();
                while t.contains(&fence) {
                    fence.push('`');
                }
                let mut lines = vec![format!("{fence}{}", attr_str(n, "language").unwrap_or(""))];
                lines.extend(t.split('\n').map(str::to_string));
                lines.push(fence);
                lines
            }
            "blockquote" => self
                .blocks(content(n))
                .into_iter()
                .map(|l| {
                    if l.is_empty() {
                        ">".into()
                    } else {
                        format!("> {l}")
                    }
                })
                .collect(),
            "bulletList" | "orderedList" | "taskList" => {
                let start = attr(n, "start").and_then(Value::as_u64).unwrap_or(1);
                let mut lines = Vec::new();
                for (i, item) in content(n).iter().enumerate() {
                    let marker = match type_of(n) {
                        "orderedList" => format!("{}. ", start + i as u64),
                        "taskList" => {
                            let c = attr(item, "checked").and_then(Value::as_bool) == Some(true);
                            format!("- [{}] ", if c { "x" } else { " " })
                        }
                        _ => "- ".into(),
                    };
                    let indent = " ".repeat(if type_of(n) == "taskList" {
                        2
                    } else {
                        marker.len()
                    });
                    let mut body = Vec::new();
                    for (k, c) in content(item).iter().enumerate() {
                        let ls = self.block(c);
                        if k > 0 && !ls.is_empty() && !is_list(c) {
                            body.push(String::new());
                        }
                        body.extend(ls);
                    }
                    let tag = self.marker(item);
                    if body.is_empty() {
                        body.push(String::new());
                    }
                    body[0].push_str(&tag);
                    for (k, l) in body.into_iter().enumerate() {
                        if k == 0 {
                            lines.push(format!("{marker}{l}").trim_end().to_string());
                        } else if l.is_empty() {
                            lines.push(String::new());
                        } else {
                            lines.push(format!("{indent}{l}"));
                        }
                    }
                }
                lines
            }
            "horizontalRule" => vec!["---".into()],
            "image" => vec![self.image(n)],
            "attachment" => vec![self.attachment(n)],
            "table" => self.table(n),
            _ if !content(n).is_empty() => self.blocks(content(n)),
            _ => Vec::new(),
        }
    }

    fn table(&mut self, n: &Value) -> Vec<String> {
        let rows: Vec<Vec<String>> = content(n)
            .iter()
            .map(|r| {
                content(r)
                    .iter()
                    .map(|c| {
                        content(c)
                            .iter()
                            .map(|b| self.block(b).join("<br>"))
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join("<br>")
                            .replace('|', "\\|")
                    })
                    .collect()
            })
            .collect();
        let cols = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
        let line = |cells: &[String]| {
            let mut v: Vec<String> = cells.to_vec();
            v.resize(cols, String::new());
            format!("| {} |", v.join(" | "))
        };
        let mut out = Vec::new();
        let head = rows.first().cloned().unwrap_or_default();
        out.push(line(&head));
        out.push(format!("|{}", " --- |".repeat(cols)));
        for r in rows.iter().skip(1) {
            out.push(line(r));
        }
        out
    }

    /// Blocks separated by blank lines.
    pub(crate) fn blocks(&mut self, nodes: &[Value]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for n in nodes {
            let ls = self.block(n);
            if ls.is_empty() {
                continue;
            }
            if !out.is_empty() {
                out.push(String::new());
            }
            out.extend(ls);
        }
        out
    }
}

fn is_list(n: &Value) -> bool {
    matches!(type_of(n), "bulletList" | "orderedList" | "taskList")
}

/// A file-name-safe version of a title.
pub(crate) fn safe_file_name(title: &str) -> String {
    let s: String = title
        .chars()
        .map(|c| {
            if "/\\:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        "Untitled".into()
    } else {
        s.chars().take(100).collect()
    }
}

fn page_md(w: &mut Writer<'_>, page: &ExportPage) -> String {
    let mut lines = Vec::new();
    if !page.title.trim().is_empty() {
        lines.push(format!("# {}", escape(page.title.trim())));
        lines.push(String::new());
    }
    lines.extend(w.blocks(content(&page.doc)));
    let mut s = lines.join("\n");
    s.push('\n');
    s
}

/// One page as Markdown (title as `# Title`; images embedded as `data:` URIs).
#[must_use]
pub fn export_page(page: &ExportPage, blobs: &dyn BlobSource, ctx: &ExportContext<'_>) -> String {
    let mut w = Writer {
        assets: Assets::Inline,
        blobs,
        ctx,
        files: BTreeMap::new(),
    };
    page_md(&mut w, page)
}

/// A section as a zip: `NN Title.md` per page (in order) plus `assets/` with the images and attachments.
pub fn export_section(
    pages: &[ExportPage],
    blobs: &dyn BlobSource,
    ctx: &ExportContext<'_>,
) -> Result<Vec<u8>, ConvertError> {
    let mut w = Writer {
        assets: Assets::Files,
        blobs,
        ctx,
        files: BTreeMap::new(),
    };
    let mut entries = Vec::new();
    let width = pages.len().to_string().len().max(2);
    for (i, p) in pages.iter().enumerate() {
        let md = page_md(&mut w, p);
        let name = format!("{:0width$} {}.md", i + 1, safe_file_name(&p.title));
        entries.push((name, md.into_bytes()));
    }
    entries.extend(w.files);
    zip_files(entries)
}

pub(crate) fn zip_files(entries: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, ConvertError> {
    use zip::write::SimpleFileOptions;
    let zerr = |e: zip::result::ZipError| ConvertError::Zip(e.to_string());
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::DEFAULT);
    for (name, bytes) in entries {
        zip.start_file(name, opts).map_err(zerr)?;
        zip.write_all(&bytes)
            .map_err(|e| ConvertError::Zip(e.to_string()))?;
    }
    Ok(zip.finish().map_err(zerr)?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn md(s: &str) -> Vec<Value> {
        import(s, &ImportContext::default()).value
    }

    #[test]
    fn imports_blocks() {
        let b = md("# Title\n\nSome **bold** and *it* `code` ~~gone~~.\n\n- a\n- b\n  1. x\n\n* [x] done\n* [ ] open\n\n> quote\n\n```rust\nfn main() {}\n```\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
        let kinds: Vec<&str> = b.iter().map(type_of).collect();
        assert_eq!(
            kinds,
            [
                "heading",
                "paragraph",
                "bulletList",
                "taskList",
                "blockquote",
                "codeBlock",
                "horizontalRule",
                "table"
            ]
        );
        assert_eq!(attr_str(&b[5], "language"), Some("rust"));
        let nested = &content(&content(&b[2])[1])[1];
        assert_eq!(type_of(nested), "orderedList");
        assert_eq!(attr(&content(&b[3])[0], "checked"), Some(&json!(true)));
        let p = content(&b[1]);
        assert!(p.iter().any(|t| marks(t).iter().any(|(m, _)| m == "bold")));
        assert!(p.iter().any(|t| marks(t).iter().any(|(m, _)| m == "code")));
        assert_eq!(type_of(&content(&content(&b[7])[0])[0]), "tableHeader");
    }

    #[test]
    fn inline_html_marks_and_unsafe_links() {
        let r = import(
            "<u>under</u> H<sub>2</sub>O [x](javascript:alert(1)) <script>bad</script>\n",
            &ImportContext::default(),
        );
        let p = content(&r.value[0]);
        assert!(p
            .iter()
            .any(|t| marks(t).iter().any(|(m, _)| m == "underline")));
        assert!(p
            .iter()
            .any(|t| marks(t).iter().any(|(m, _)| m == "subscript")));
        assert!(!p.iter().any(|t| marks(t).iter().any(|(m, _)| m == "link")));
        assert!(r.warnings.iter().any(|w| w.code == "notes.link.unsafe"));
        assert!(r.warnings.iter().any(|w| w.code == "notes.md.html"));
    }

    #[test]
    fn data_images_become_blobs_remote_stay_links() {
        let r = import(
            "![dot](data:image/png;base64,iVBORw0KGgo=) and ![web](https://example.com/a.png)\n",
            &ImportContext::default(),
        );
        assert_eq!(type_of(&r.value[0]), "image");
        assert_eq!(r.blobs.len(), 1);
        let link = &content(&r.value[1])
            .iter()
            .find(|t| marks(t).iter().any(|(m, _)| m == "link"))
            .cloned()
            .unwrap();
        assert_eq!(link["text"], "web");
        assert!(r.warnings.iter().any(|w| w.code == "notes.image.remote"));
    }

    #[test]
    fn escapes_and_marks_export() {
        let ctx = ExportContext::default();
        let mut w = Writer {
            assets: Assets::Inline,
            blobs: &crate::NoBlobs,
            ctx: &ctx,
            files: BTreeMap::new(),
        };
        let p = pm::paragraph(vec![
            pm::text("1. not a list *star* ", &[]),
            pm::text("bold ", &[pm::mark("bold")]),
            pm::text("both", &[pm::mark("bold"), pm::mark("italic")]),
        ]);
        let s = w.block(&p).join("\n");
        assert_eq!(s, "1\\. not a list \\*star\\* **bold *both***");
        let back = md(&s);
        assert_eq!(pm::inline_text(&back[0]), "1. not a list *star* bold both");
    }
}
