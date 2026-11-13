//! HTML ↔ page content.
//!
//! **Import** (HTML files and the editor's paste path) is a sanitiser by construction: the document is parsed by
//! html5ever and *rebuilt* from an allow-list – nothing of the input is passed through. Kept: paragraphs,
//! headings, lists (incl. task lists: `data-type="taskList"`, `data-checked`, leading check boxes), block quotes,
//! `pre` code blocks, tables (`colspan`/`rowspan`), rules, line breaks, bold/italic/underline/strike/code/sub/sup,
//! `mark` and CSS `color`/`background-color` (as `textStyle`/`highlight` marks), links with `http(s)`/`mailto`/
//! `tel`/`#` targets, images **only from `data:` URIs** (stored as blobs; remote images stay links and are never
//! fetched), `a[download][href^=data:]` attachments. Dropped: scripts, styles, frames, objects, forms, every
//! attribute not listed (so all `on*` handlers), `javascript:`/`data:` links, remote resources.
//!
//! **Export**: a standalone `.html` (UTF-8, minimal CSS, images and attachments embedded as `data:` URIs).
use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::{Attribute, ExpandedName, QualName};
use serde_json::{json, Value};

use crate::pm::{self, attr, attr_str, content, marks, type_of};
use crate::{
    Blob, BlobSource, ConvertError, Converted, ExportContext, ExportPage, ImportContext, Warnings,
};

// ==== a minimal DOM for html5ever =========================================================================

enum Kind {
    Document,
    Element {
        name: QualName,
        attrs: RefCell<Vec<Attribute>>,
        template: Option<Handle>,
    },
    Text(RefCell<StrTendril>),
    Other,
}

struct Node {
    kind: Kind,
    parent: Cell<Option<Weak<Node>>>,
    children: RefCell<Vec<Handle>>,
}

type Handle = Rc<Node>;

/// Iterative drop: hostile, deeply nested documents must not overflow the stack.
impl Drop for Node {
    fn drop(&mut self) {
        let mut stack = std::mem::take(self.children.get_mut());
        while let Some(n) = stack.pop() {
            if let Ok(mut node) = Rc::try_unwrap(n) {
                stack.extend(std::mem::take(node.children.get_mut()));
            }
        }
    }
}

fn new_node(kind: Kind) -> Handle {
    Rc::new(Node {
        kind,
        parent: Cell::new(None),
        children: RefCell::new(Vec::new()),
    })
}

fn parent_of(n: &Handle) -> Option<Handle> {
    let w = n.parent.take();
    let p = w.as_ref().and_then(Weak::upgrade);
    n.parent.set(w);
    p
}

fn detach(n: &Handle) {
    if let Some(p) = parent_of(n) {
        p.children.borrow_mut().retain(|c| !Rc::ptr_eq(c, n));
    }
    n.parent.set(None);
}

struct Sink {
    doc: Handle,
}

impl Sink {
    fn insert(&self, parent: &Handle, at: Option<usize>, child: NodeOrText<Handle>) {
        match child {
            NodeOrText::AppendText(t) => {
                let mut kids = parent.children.borrow_mut();
                let pos = at.map_or(kids.len(), |p| p.min(kids.len()));
                if pos > 0 {
                    if let Kind::Text(prev) = &kids[pos - 1].kind {
                        prev.borrow_mut().push_tendril(&t);
                        return;
                    }
                }
                let n = new_node(Kind::Text(RefCell::new(t)));
                n.parent.set(Some(Rc::downgrade(parent)));
                kids.insert(pos, n);
            }
            NodeOrText::AppendNode(n) => {
                detach(&n);
                let mut kids = parent.children.borrow_mut();
                let pos = at.map_or(kids.len(), |p| p.min(kids.len()));
                n.parent.set(Some(Rc::downgrade(parent)));
                kids.insert(pos, n);
            }
        }
    }
}

impl TreeSink for Sink {
    type Handle = Handle;
    type Output = Handle;
    type ElemName<'a> = ExpandedName<'a>;

    fn finish(self) -> Handle {
        self.doc
    }

    fn parse_error(&self, _msg: Cow<'static, str>) {}

    fn get_document(&self) -> Handle {
        self.doc.clone()
    }

    fn elem_name<'a>(&'a self, target: &'a Handle) -> ExpandedName<'a> {
        match &target.kind {
            Kind::Element { name, .. } => name.expanded(),
            // html5ever only asks for names of elements it created.
            _ => unreachable!("elem_name of a non-element"),
        }
    }

    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, flags: ElementFlags) -> Handle {
        new_node(Kind::Element {
            name,
            attrs: RefCell::new(attrs),
            template: flags.template.then(|| new_node(Kind::Document)),
        })
    }

    fn create_comment(&self, _text: StrTendril) -> Handle {
        new_node(Kind::Other)
    }

    fn create_pi(&self, _target: StrTendril, _data: StrTendril) -> Handle {
        new_node(Kind::Other)
    }

    fn append(&self, parent: &Handle, child: NodeOrText<Handle>) {
        self.insert(parent, None, child);
    }

    fn append_based_on_parent_node(
        &self,
        element: &Handle,
        prev_element: &Handle,
        child: NodeOrText<Handle>,
    ) {
        if parent_of(element).is_some() {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev_element, child);
        }
    }

    fn append_doctype_to_document(&self, _: StrTendril, _: StrTendril, _: StrTendril) {}

    fn get_template_contents(&self, target: &Handle) -> Handle {
        match &target.kind {
            Kind::Element {
                template: Some(t), ..
            } => t.clone(),
            _ => new_node(Kind::Document),
        }
    }

    fn same_node(&self, x: &Handle, y: &Handle) -> bool {
        Rc::ptr_eq(x, y)
    }

    fn set_quirks_mode(&self, _mode: QuirksMode) {}

    fn append_before_sibling(&self, sibling: &Handle, new_node: NodeOrText<Handle>) {
        let Some(parent) = parent_of(sibling) else {
            return;
        };
        let pos = parent
            .children
            .borrow()
            .iter()
            .position(|c| Rc::ptr_eq(c, sibling));
        self.insert(&parent, pos, new_node);
    }

    fn add_attrs_if_missing(&self, target: &Handle, attrs: Vec<Attribute>) {
        if let Kind::Element { attrs: a, .. } = &target.kind {
            let mut a = a.borrow_mut();
            for at in attrs {
                if !a.iter().any(|x| x.name == at.name) {
                    a.push(at);
                }
            }
        }
    }

    fn remove_from_parent(&self, target: &Handle) {
        detach(target);
    }

    fn reparent_children(&self, node: &Handle, new_parent: &Handle) {
        let kids = std::mem::take(&mut *node.children.borrow_mut());
        for k in kids {
            k.parent.set(Some(Rc::downgrade(new_parent)));
            new_parent.children.borrow_mut().push(k);
        }
    }
}

fn parse(html: &str) -> Handle {
    let sink = Sink {
        doc: new_node(Kind::Document),
    };
    html5ever::parse_document(sink, Default::default()).one(html)
}

fn tag_name(n: &Node) -> Option<&str> {
    match &n.kind {
        Kind::Element { name, .. } => Some(&name.local),
        _ => None,
    }
}

fn get_attr(n: &Node, key: &str) -> Option<String> {
    match &n.kind {
        Kind::Element { attrs, .. } => attrs
            .borrow()
            .iter()
            .find(|a| &*a.name.local == key)
            .map(|a| a.value.to_string()),
        _ => None,
    }
}

fn kids(n: &Node) -> Vec<Handle> {
    n.children.borrow().clone()
}

// ==== import =============================================================================================

/// Elements whose whole subtree is dropped.
const DROP: &[&str] = &[
    "script", "style", "head", "title", "meta", "link", "iframe", "frame", "frameset", "object",
    "embed", "applet", "noscript", "template", "svg", "math", "canvas", "video", "audio", "source",
    "track", "form", "button", "select", "textarea", "option", "dialog", "base", "noembed",
    "noframes", "portal",
];

/// Silently dropped (document metadata).
const QUIET: &[&str] = &["head", "title", "meta", "link", "base"];

/// Elements that only group blocks (their children are imported in place).
const CONTAINERS: &[&str] = &[
    "html",
    "body",
    "div",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "nav",
    "aside",
    "figure",
    "figcaption",
    "center",
    "details",
    "summary",
    "dl",
    "dt",
    "dd",
    "address",
    "hgroup",
    "fieldset",
    "legend",
    "caption",
    "li",
    "picture",
];

struct Conv<'c, 'a> {
    ctx: &'c ImportContext<'a>,
    blobs: Vec<Blob>,
    w: Warnings,
    removed: bool,
    depth: usize,
}

/// Deeper nesting than this is flattened (hostile input).
const MAX_DEPTH: usize = 200;

/// An inline run being collected (whitespace collapsing across nodes).
struct Inline {
    nodes: Vec<Value>,
}

impl Inline {
    fn new() -> Self {
        Inline { nodes: Vec::new() }
    }

    fn push_text(&mut self, s: &str, marks: &[Value], pre: bool) {
        if s.is_empty() {
            return;
        }
        let mut t = if pre {
            s.to_string()
        } else {
            let mut out = String::with_capacity(s.len());
            let mut ws = false;
            for c in s.chars() {
                if c.is_whitespace() && c != '\u{a0}' {
                    if !ws {
                        out.push(' ');
                    }
                    ws = true;
                } else {
                    out.push(c);
                    ws = false;
                }
            }
            out
        };
        if !pre && t.starts_with(' ') && self.ends_with_space() {
            t.remove(0);
        }
        if !t.is_empty() {
            self.nodes.push(pm::text(&t, marks));
        }
    }

    fn ends_with_space(&self) -> bool {
        match self.nodes.last() {
            None => true,
            Some(n) if pm::is_text(n) => n
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|t| t.ends_with(' ')),
            Some(n) => type_of(n) == "hardBreak",
        }
    }
}

impl Conv<'_, '_> {
    fn removed(&mut self) {
        if !self.removed {
            self.removed = true;
            self.w.warn(
                "notes.html.removed",
                "Scripts, styles, frames and embedded objects were removed",
                &[],
            );
        }
    }

    /// Imports the children of a block container.
    fn flow(&mut self, n: &Node, out: &mut Vec<Value>) {
        let mut inline = Inline::new();
        self.depth += 1;
        for c in kids(n) {
            if self.depth > MAX_DEPTH {
                self.inline_node(&c, &[], &mut inline, false);
            } else {
                self.flow_node(&c, out, &mut inline);
            }
        }
        self.depth -= 1;
        self.flush(&mut inline, out);
    }

    fn flush(&mut self, inline: &mut Inline, out: &mut Vec<Value>) {
        if inline.nodes.is_empty() {
            return;
        }
        let nodes = std::mem::take(&mut inline.nodes);
        out.extend(pm::text_blocks(nodes, None, self.ctx));
    }

    fn flow_node(&mut self, c: &Handle, out: &mut Vec<Value>, inline: &mut Inline) {
        let Some(name) = tag_name(c) else {
            self.inline_node(c, &[], inline, false);
            return;
        };
        let name = name.to_string();
        if DROP.contains(&name.as_str()) {
            if !QUIET.contains(&name.as_str()) {
                self.removed();
            }
            return;
        }
        let block = match name.as_str() {
            "p" => {
                let mut il = Inline::new();
                self.inline_children(c, &[], &mut il, false);
                pm::text_blocks(il.nodes, None, self.ctx)
            }
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = name[1..].parse::<u8>().unwrap_or(1);
                let mut il = Inline::new();
                self.inline_children(c, &[], &mut il, false);
                pm::text_blocks(il.nodes, Some(level), self.ctx)
            }
            "pre" => {
                let lang = kids(c).iter().find_map(|k| {
                    (tag_name(k) == Some("code"))
                        .then(|| get_attr(k, "class"))
                        .flatten()
                        .and_then(|cl| {
                            cl.split_whitespace()
                                .find_map(|x| x.strip_prefix("language-").map(str::to_string))
                        })
                });
                let t = raw_text(c);
                let t = t.strip_suffix('\n').unwrap_or(&t).to_string();
                vec![pm::node(
                    "codeBlock",
                    lang.filter(|l| safe_token(l))
                        .map(|l| json!({ "language": l })),
                    if t.is_empty() {
                        Vec::new()
                    } else {
                        vec![pm::text(&t, &[])]
                    },
                )]
            }
            "blockquote" => {
                let mut inner = Vec::new();
                self.flow(c, &mut inner);
                vec![pm::node("blockquote", None, non_empty(inner))]
            }
            "ul" | "ol" | "menu" => vec![self.list(c, &name)],
            "table" => self.table(c),
            "hr" => vec![pm::node("horizontalRule", None, Vec::new())],
            _ if CONTAINERS.contains(&name.as_str()) => {
                self.flush(inline, out);
                self.flow(c, out);
                return;
            }
            _ => {
                self.inline_node(c, &[], inline, false);
                return;
            }
        };
        self.flush(inline, out);
        out.extend(block);
    }

    fn list(&mut self, n: &Node, name: &str) -> Value {
        let task_list = get_attr(n, "data-type").as_deref() == Some("taskList")
            || get_attr(n, "class")
                .is_some_and(|c| c.split_whitespace().any(|x| x.contains("task")));
        let mut items: Vec<Value> = Vec::new();
        let mut any_task = false;
        self.depth += 1;
        for li in kids(n) {
            match tag_name(&li) {
                Some("li") => {}
                Some(sub @ ("ul" | "ol")) => {
                    // A list directly inside a list: nest it into the previous item.
                    let sub = sub.to_string();
                    let nested = self.list(&li, &sub);
                    if let Some(Value::Array(c)) =
                        items.last_mut().and_then(|i| i.get_mut("content"))
                    {
                        c.push(nested);
                    } else {
                        items.push(pm::node("listItem", None, vec![nested]));
                    }
                    continue;
                }
                _ => continue,
            }
            let checked = get_attr(&li, "data-checked")
                .map(|v| v == "true")
                .or_else(|| find_checkbox(&li));
            let mut blocks = Vec::new();
            self.flow(&li, &mut blocks);
            let blocks = non_empty(blocks);
            match checked {
                Some(c) => {
                    any_task = true;
                    items.push(pm::node("taskItem", Some(json!({ "checked": c })), blocks));
                }
                None => items.push(pm::node("listItem", None, blocks)),
            }
        }
        self.depth -= 1;
        if items.is_empty() {
            items.push(pm::node("listItem", None, non_empty(Vec::new())));
        }
        if task_list || any_task {
            for i in &mut items {
                if type_of(i) == "listItem" {
                    i["type"] = "taskItem".into();
                    pm::set_attr(i, "checked", false.into());
                }
            }
            return pm::node("taskList", None, items);
        }
        if name == "ol" {
            let start = get_attr(n, "start")
                .and_then(|s| s.trim().parse::<u32>().ok())
                .unwrap_or(1);
            pm::node(
                "orderedList",
                (start != 1).then(|| json!({ "start": start })),
                items,
            )
        } else {
            pm::node("bulletList", None, items)
        }
    }

    fn table(&mut self, n: &Node) -> Vec<Value> {
        let mut trs = Vec::new();
        for c in kids(n) {
            match tag_name(&c) {
                Some("tr") => trs.push(c.clone()),
                Some("thead" | "tbody" | "tfoot") => {
                    trs.extend(kids(&c).into_iter().filter(|r| tag_name(r) == Some("tr")));
                }
                _ => {}
            }
        }
        let mut rows = Vec::new();
        for tr in trs {
            let mut cells = Vec::new();
            for td in kids(&tr) {
                let kind = match tag_name(&td) {
                    Some("td") => "tableCell",
                    Some("th") => "tableHeader",
                    _ => continue,
                };
                let mut blocks = Vec::new();
                self.flow(&td, &mut blocks);
                let mut attrs = serde_json::Map::new();
                for key in ["colspan", "rowspan"] {
                    if let Some(v) = get_attr(&td, key).and_then(|v| v.trim().parse::<u32>().ok()) {
                        if v > 1 && v < 1000 {
                            attrs.insert(key.into(), v.into());
                        }
                    }
                }
                cells.push(pm::node(
                    kind,
                    Some(Value::Object(attrs)),
                    non_empty(blocks),
                ));
            }
            if !cells.is_empty() {
                rows.push(pm::node("tableRow", None, cells));
            }
        }
        if rows.is_empty() {
            return Vec::new();
        }
        vec![pm::node("table", None, rows)]
    }

    fn inline_children(&mut self, n: &Node, marks: &[Value], il: &mut Inline, pre: bool) {
        self.depth += 1;
        for c in kids(n) {
            self.inline_node(&c, marks, il, pre);
        }
        self.depth -= 1;
    }

    /// Inline content (block elements met here are flattened into the run).
    fn inline_node(&mut self, n: &Handle, marks: &[Value], il: &mut Inline, pre: bool) {
        let name = match &n.kind {
            Kind::Text(t) => {
                il.push_text(&t.borrow(), marks, pre);
                return;
            }
            Kind::Element { name, .. } => name.local.to_string(),
            _ => return,
        };
        if DROP.contains(&name.as_str()) {
            if !QUIET.contains(&name.as_str()) {
                self.removed();
            }
            return;
        }
        if self.depth > MAX_DEPTH * 2 {
            il.push_text(&text_of(n), marks, false);
            return;
        }
        let mut ms = marks.to_vec();
        let add = |m: Value, ms: &mut Vec<Value>| {
            if !ms.iter().any(|x| type_of(x) == type_of(&m)) {
                ms.push(m);
            }
        };
        match name.as_str() {
            "br" => {
                il.nodes.push(pm::node("hardBreak", None, Vec::new()));
                return;
            }
            "img" => {
                self.image(n, marks, il);
                return;
            }
            "input" => return,
            "b" | "strong" => add(pm::mark("bold"), &mut ms),
            "i" | "em" | "cite" | "dfn" | "var" => add(pm::mark("italic"), &mut ms),
            "u" | "ins" => add(pm::mark("underline"), &mut ms),
            "s" | "strike" | "del" => add(pm::mark("strike"), &mut ms),
            "code" | "kbd" | "samp" | "tt" => add(pm::mark("code"), &mut ms),
            "sub" => add(pm::mark("subscript"), &mut ms),
            "sup" => add(pm::mark("superscript"), &mut ms),
            "mark" => {
                let color = get_attr(n, "style").and_then(|s| css(&s, "background-color"));
                add(
                    match color {
                        Some(c) => pm::mark_with("highlight", json!({ "color": c })),
                        None => pm::mark("highlight"),
                    },
                    &mut ms,
                );
            }
            "a" => {
                if let Some(id) = get_attr(n, "data-page-id").filter(|i| safe_id(i)) {
                    let title = text_of(n);
                    let title = title
                        .strip_prefix("[[")
                        .and_then(|t| t.strip_suffix("]]"))
                        .unwrap_or(&title)
                        .trim()
                        .to_string();
                    il.nodes.push(pm::node(
                        "pageLink",
                        Some(json!({ "pageId": id, "title": title })),
                        Vec::new(),
                    ));
                    return;
                }
                let href = get_attr(n, "href").unwrap_or_default();
                if let Some(download) = get_attr(n, "download") {
                    if let Some((_, bytes)) = pm::decode_data_uri(&href) {
                        let name = if download.trim().is_empty() {
                            text_of(n).trim_start_matches('📎').trim().to_string()
                        } else {
                            download.trim().to_string()
                        };
                        il.nodes
                            .push(pm::attachment_block(bytes, &name, &mut self.blobs));
                        return;
                    }
                }
                if !href.is_empty() {
                    match pm::safe_href(&href) {
                        Some(h) => add(pm::mark_with("link", json!({ "href": h })), &mut ms),
                        None => self.w.warn(
                            "notes.link.unsafe",
                            "A link to \"{href}\" was removed (only web, e-mail and phone links are kept)",
                            &[("href", &short(&href))],
                        ),
                    }
                }
            }
            _ => {}
        }
        if let Some(style) = get_attr(n, "style") {
            if name != "mark" {
                if let Some(c) = css(&style, "color") {
                    ms.retain(|m| type_of(m) != "textStyle");
                    ms.push(pm::mark_with("textStyle", json!({ "color": c })));
                }
                if let Some(c) =
                    css(&style, "background-color").or_else(|| css(&style, "background"))
                {
                    ms.retain(|m| type_of(m) != "highlight");
                    ms.push(pm::mark_with("highlight", json!({ "color": c })));
                }
            }
            let has = |k: &str, v: &[&str]| {
                css_raw(&style, k).is_some_and(|x| v.iter().any(|w| x.contains(w)))
            };
            if has("font-weight", &["bold", "600", "700", "800", "900"]) {
                add(pm::mark("bold"), &mut ms);
            }
            if has("font-style", &["italic", "oblique"]) {
                add(pm::mark("italic"), &mut ms);
            }
            if has("text-decoration", &["underline"]) {
                add(pm::mark("underline"), &mut ms);
            }
            if has("text-decoration", &["line-through"]) {
                add(pm::mark("strike"), &mut ms);
            }
        }
        let pre = pre || name == "pre";
        self.inline_children(n, &ms, il, pre);
    }

    fn image(&mut self, n: &Node, marks: &[Value], il: &mut Inline) {
        let src = get_attr(n, "src").unwrap_or_default();
        let alt = get_attr(n, "alt").unwrap_or_default();
        let size = match (
            get_attr(n, "width").and_then(|w| w.trim().parse::<f64>().ok()),
            get_attr(n, "height").and_then(|h| h.trim().parse::<f64>().ok()),
        ) {
            (Some(w), Some(h)) => Some((w, h)),
            _ => None,
        };
        if let Some((mime, bytes)) = pm::decode_data_uri(&src) {
            // SVG can carry scripts: only raster images are stored.
            if mime.starts_with("image/") && mime != "image/svg+xml" {
                il.nodes.push(pm::image_block(
                    bytes,
                    Some(&mime),
                    Some(&alt),
                    size,
                    &mut self.blobs,
                ));
                return;
            }
            self.w.warn(
                "notes.image.unsupported",
                "An embedded image of an unsupported type was left out",
                &[],
            );
            return;
        }
        match pm::safe_href(&src).filter(|h| h.starts_with("http")) {
            Some(h) => {
                self.w.warn(
                    "notes.image.remote",
                    "Images from the web are not downloaded; kept as links",
                    &[],
                );
                let mut ms = marks.to_vec();
                ms.retain(|m| type_of(m) != "link");
                ms.push(pm::mark_with("link", json!({ "href": h })));
                let label = if alt.trim().is_empty() {
                    h.clone()
                } else {
                    alt
                };
                il.push_text(&label, &ms, false);
            }
            None => {
                if !src.is_empty() {
                    self.w.warn(
                        "notes.image.missing",
                        "Image \"{src}\" is not embedded in the file and was left out",
                        &[("src", &short(&src))],
                    );
                }
                il.push_text(&alt, marks, false);
            }
        }
    }
}

fn short(s: &str) -> String {
    if s.chars().count() > 80 {
        format!("{}…", s.chars().take(80).collect::<String>())
    } else {
        s.to_string()
    }
}

fn safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn safe_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-_#.".contains(c))
}

fn find_checkbox(li: &Node) -> Option<bool> {
    for c in kids(li).iter().take(3) {
        match tag_name(c) {
            Some("input") => {
                return get_attr(c, "type")
                    .is_some_and(|t| t.eq_ignore_ascii_case("checkbox"))
                    .then(|| get_attr(c, "checked").is_some());
            }
            Some("label" | "span" | "p" | "div") => {
                if let Some(v) = find_checkbox(c) {
                    return Some(v);
                }
            }
            None => {
                if let Kind::Text(t) = &c.kind {
                    if !t.borrow().trim().is_empty() {
                        return None;
                    }
                }
            }
            _ => return None,
        }
    }
    None
}

/// The text below `n` (iterative: no depth limit), `br` as newlines, dropped elements left out.
fn raw_text(n: &Node) -> String {
    let mut s = String::new();
    let mut stack: Vec<Handle> = kids(n).into_iter().rev().collect();
    if let Kind::Text(t) = &n.kind {
        s.push_str(&t.borrow());
    }
    while let Some(c) = stack.pop() {
        match &c.kind {
            Kind::Text(t) => s.push_str(&t.borrow()),
            Kind::Element { name, .. } if &*name.local == "br" => s.push('\n'),
            Kind::Element { name, .. } if DROP.contains(&&*name.local) => {}
            _ => stack.extend(kids(&c).into_iter().rev()),
        }
    }
    s
}

fn text_of(n: &Node) -> String {
    raw_text(n).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn css_raw(style: &str, key: &str) -> Option<String> {
    style.split(';').find_map(|decl| {
        let (k, v) = decl.split_once(':')?;
        k.trim()
            .eq_ignore_ascii_case(key)
            .then(|| v.trim().to_ascii_lowercase())
    })
}

/// A colour declaration of an inline style (`#hex` or `rgb()` only; black text = automatic).
fn css(style: &str, key: &str) -> Option<String> {
    let v = css_raw(style, key)?;
    let v = v.trim_end_matches("!important").trim();
    pm::parse_color(v).filter(|c| !(key == "color" && c == "#000000"))
}

fn non_empty(blocks: Vec<Value>) -> Vec<Value> {
    if blocks.is_empty() {
        vec![pm::paragraph(Vec::new())]
    } else {
        blocks
    }
}

fn find(n: &Handle, tag: &str) -> Option<Handle> {
    if tag_name(n) == Some(tag) {
        return Some(n.clone());
    }
    kids(n).iter().find_map(|c| find(c, tag))
}

/// The document `<title>`, if any.
#[must_use]
pub fn title_of(html: &str) -> Option<String> {
    let doc = parse(html);
    find(&doc, "title")
        .map(|t| text_of(&t))
        .filter(|t| !t.is_empty())
}

/// Sanitised HTML → top-level blocks (files and the editor's paste path).
#[must_use]
pub fn import(html: &str, ctx: &ImportContext<'_>) -> Converted<Vec<Value>> {
    let doc = parse(html);
    let root = find(&doc, "body").unwrap_or(doc);
    let mut c = Conv {
        ctx,
        blobs: Vec::new(),
        w: Warnings::default(),
        removed: false,
        depth: 0,
    };
    let mut out = Vec::new();
    c.flow(&root, &mut out);
    Converted {
        value: out,
        blobs: c.blobs,
        warnings: c.w.into_vec(),
    }
}

/// Imports HTML bytes (UTF-8, invalid sequences replaced; a BOM is skipped). Also returns the `<title>`.
pub fn import_bytes(
    bytes: &[u8],
    ctx: &ImportContext<'_>,
) -> Result<(Converted<Vec<Value>>, Option<String>), ConvertError> {
    let s = String::from_utf8_lossy(bytes);
    let s = s.strip_prefix('\u{feff}').unwrap_or(&s);
    Ok((import(s, ctx), title_of(s)))
}

// ==== export =============================================================================================

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            c => o.push(c),
        }
    }
    o
}

const CSS: &str = "body{font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;line-height:1.5;\
max-width:50rem;margin:2rem auto;padding:0 1rem;color:#1f1f1f}\
article+article{border-top:1px solid #ccc;margin-top:2rem;padding-top:1rem}\
h1.page-title{font-size:1.8rem;margin-bottom:.2rem}\
pre{background:#f4f4f4;padding:.6rem;overflow-x:auto}code{font-family:ui-monospace,Consolas,monospace}\
blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1rem;color:#555}\
table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.25rem .5rem;vertical-align:top}\
ul.task-list{list-style:none;padding-left:1.2rem}img{max-width:100%}\
.tag{color:#666;font-size:.85em}.page-link{color:#3a5ccc}";

struct Html<'a> {
    blobs: &'a dyn BlobSource,
    ctx: &'a ExportContext<'a>,
}

impl Html<'_> {
    fn inline(&self, nodes: &[Value]) -> String {
        let mut out = String::new();
        for n in nodes {
            match type_of(n) {
                "text" => {
                    let mut s = esc(n.get("text").and_then(Value::as_str).unwrap_or_default());
                    for (m, a) in marks(n).into_iter().rev() {
                        s = wrap_mark(&m, &a, &s);
                    }
                    out.push_str(&s);
                }
                "hardBreak" => out.push_str("<br>"),
                "pageLink" => {
                    let id = attr_str(n, "pageId").unwrap_or_default();
                    let title = attr_str(n, "title")
                        .map(str::to_string)
                        .or_else(|| self.ctx.title_of(id))
                        .unwrap_or_default();
                    out.push_str(&format!(
                        "<a class=\"page-link\" data-page-id=\"{}\">{}</a>",
                        esc(id),
                        esc(&format!("[[{title}]]"))
                    ));
                }
                "image" => out.push_str(&self.image(n)),
                _ => out.push_str(&esc(&pm::inline_text(n))),
            }
        }
        out
    }

    fn image(&self, n: &Value) -> String {
        let alt = attr_str(n, "alt").unwrap_or_default();
        let Some(bytes) = attr_str(n, "blob").and_then(|id| self.blobs.blob(id)) else {
            return esc(alt);
        };
        let mut size = String::new();
        if let (Some(w), Some(h)) = (attr(n, "width"), attr(n, "height")) {
            size = format!(" width=\"{w}\" height=\"{h}\"");
        }
        format!(
            "<img src=\"{}\" alt=\"{}\"{size}>",
            pm::data_uri(pm::sniff_mime(bytes), bytes),
            esc(alt)
        )
    }

    fn marker(&self, n: &Value) -> String {
        let (tags, checked) = pm::block_tags(n);
        if tags.is_empty() {
            return String::new();
        }
        format!(
            "<span class=\"tag\">{}</span>",
            esc(&self.ctx.tags.marker(&tags, checked))
        )
    }

    fn blocks(&self, nodes: &[Value]) -> String {
        nodes
            .iter()
            .map(|n| self.block(n))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn block(&self, n: &Value) -> String {
        let c = content(n);
        match type_of(n) {
            "paragraph" => {
                let s = format!("{}{}", self.inline(c), self.marker(n));
                if s.is_empty() {
                    "<p><br></p>".into()
                } else {
                    format!("<p>{s}</p>")
                }
            }
            "heading" => {
                let l = attr(n, "level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 6);
                format!("<h{l}>{}{}</h{l}>", self.inline(c), self.marker(n))
            }
            "codeBlock" => {
                let lang = attr_str(n, "language")
                    .filter(|l| safe_token(l))
                    .map(|l| format!(" class=\"language-{l}\""))
                    .unwrap_or_default();
                format!("<pre><code{lang}>{}</code></pre>", esc(&pm::inline_text(n)))
            }
            "blockquote" => format!("<blockquote>\n{}\n</blockquote>", self.blocks(c)),
            "bulletList" => format!("<ul>\n{}\n</ul>", self.items(c)),
            "orderedList" => {
                let start = attr(n, "start").and_then(Value::as_u64).unwrap_or(1);
                let s = if start == 1 {
                    String::new()
                } else {
                    format!(" start=\"{start}\"")
                };
                format!("<ol{s}>\n{}\n</ol>", self.items(c))
            }
            "taskList" => format!(
                "<ul class=\"task-list\" data-type=\"taskList\">\n{}\n</ul>",
                self.items(c)
            ),
            "horizontalRule" => "<hr>".into(),
            "image" => format!("<p>{}</p>", self.image(n)),
            "attachment" => {
                let name = attr_str(n, "name").unwrap_or("attachment");
                match attr_str(n, "blob").and_then(|id| self.blobs.blob(id)) {
                    Some(b) => format!(
                        "<p><a class=\"attachment\" download=\"{}\" href=\"{}\">📎 {}</a></p>",
                        esc(name),
                        pm::data_uri("application/octet-stream", b),
                        esc(name)
                    ),
                    None => format!("<p>📎 {}</p>", esc(name)),
                }
            }
            "table" => {
                let rows: Vec<String> = c.iter().map(|r| self.row(r)).collect();
                format!("<table><tbody>\n{}\n</tbody></table>", rows.join("\n"))
            }
            _ if !c.is_empty() => self.blocks(c),
            _ => String::new(),
        }
    }

    fn row(&self, r: &Value) -> String {
        let cells: Vec<String> = content(r)
            .iter()
            .map(|cell| {
                let tag = if type_of(cell) == "tableHeader" {
                    "th"
                } else {
                    "td"
                };
                let mut a = String::new();
                for k in ["colspan", "rowspan"] {
                    if let Some(v) = attr(cell, k).and_then(Value::as_u64).filter(|v| *v > 1) {
                        a.push_str(&format!(" {k}=\"{v}\""));
                    }
                }
                format!("<{tag}{a}>{}</{tag}>", self.blocks(content(cell)))
            })
            .collect();
        format!("<tr>{}</tr>", cells.join(""))
    }

    fn items(&self, items: &[Value]) -> String {
        items
            .iter()
            .map(|i| {
                let tag = self.marker(i);
                if type_of(i) == "taskItem" {
                    let checked = attr(i, "checked").and_then(Value::as_bool) == Some(true);
                    format!(
                        "<li data-checked=\"{checked}\"><input type=\"checkbox\" disabled{}> {}{tag}</li>",
                        if checked { " checked" } else { "" },
                        self.blocks(content(i))
                    )
                } else {
                    format!("<li>{}{tag}</li>", self.blocks(content(i)))
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn article(&self, p: &ExportPage) -> String {
        format!(
            "<article>\n<h1 class=\"page-title\">{}</h1>\n{}\n</article>",
            esc(&p.title),
            self.blocks(content(&p.doc))
        )
    }
}

fn wrap_mark(m: &str, a: &Value, s: &str) -> String {
    let color = || {
        a.get("color")
            .and_then(Value::as_str)
            .and_then(pm::parse_color)
    };
    match m {
        "bold" => format!("<strong>{s}</strong>"),
        "italic" => format!("<em>{s}</em>"),
        "underline" => format!("<u>{s}</u>"),
        "strike" => format!("<s>{s}</s>"),
        "code" => format!("<code>{s}</code>"),
        "subscript" => format!("<sub>{s}</sub>"),
        "superscript" => format!("<sup>{s}</sup>"),
        "highlight" => match color() {
            Some(c) => format!("<mark style=\"background-color:{c}\">{s}</mark>"),
            None => format!("<mark>{s}</mark>"),
        },
        "textStyle" => match color() {
            Some(c) => format!("<span style=\"color:{c}\">{s}</span>"),
            None => s.to_string(),
        },
        "link" => match a
            .get("href")
            .and_then(Value::as_str)
            .and_then(pm::safe_href)
        {
            Some(h) => format!("<a href=\"{}\">{s}</a>", esc(&h)),
            None => s.to_string(),
        },
        "pageLink" => {
            let id = a.get("pageId").and_then(Value::as_str).unwrap_or_default();
            format!(
                "<a class=\"page-link\" data-page-id=\"{}\">{s}</a>",
                esc(id)
            )
        }
        _ => s.to_string(),
    }
}

fn document(title: &str, body: &str) -> String {
    format!(
        "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <meta name=\"generator\" content=\"Rusuite Notes\">\n<title>{}</title>\n<style>{CSS}</style>\n\
         </head>\n<body>\n{body}\n</body>\n</html>\n",
        esc(title)
    )
}

/// One page as a standalone HTML document.
#[must_use]
pub fn export_page(page: &ExportPage, blobs: &dyn BlobSource, ctx: &ExportContext<'_>) -> String {
    let h = Html { blobs, ctx };
    document(&page.title, &h.article(page))
}

/// A section as one HTML document: one `<article>` per page.
#[must_use]
pub fn export_section(
    title: &str,
    pages: &[ExportPage],
    blobs: &dyn BlobSource,
    ctx: &ExportContext<'_>,
) -> String {
    let h = Html { blobs, ctx };
    let body: Vec<String> = pages.iter().map(|p| h.article(p)).collect();
    document(title, &body.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html(s: &str) -> Converted<Vec<Value>> {
        import(s, &ImportContext::default())
    }

    #[test]
    fn sanitises_scripts_handlers_and_links() {
        let r = html(
            "<p onclick=\"evil()\">Hi <script>alert(1)</script><a href=\"javascript:alert(2)\">x</a> \
             <a href=\"https://ok.example/\" onmouseover=\"bad()\">ok</a></p><style>p{}</style>\
             <iframe src=\"https://evil\"></iframe><img src=\"https://example.com/t.png\" onerror=\"x()\" alt=\"pic\">",
        );
        let json = serde_json::to_string(&r.value).unwrap();
        assert!(!json.contains("alert"), "{json}");
        assert!(!json.contains("evil"), "{json}");
        assert!(!json.contains("onclick") && !json.contains("onerror") && !json.contains("bad()"));
        assert!(!json.contains("javascript"));
        assert!(json.contains("https://ok.example/"));
        // The remote image is a link, never an image node.
        assert!(!json.contains("\"image\""));
        assert!(json.contains("https://example.com/t.png"));
        assert!(r.blobs.is_empty());
        let codes: Vec<&str> = r.warnings.iter().map(|w| w.code.as_str()).collect();
        assert!(codes.contains(&"notes.html.removed"));
        assert!(codes.contains(&"notes.link.unsafe"));
        assert!(codes.contains(&"notes.image.remote"));
    }

    #[test]
    fn blocks_marks_and_tasks() {
        let r = html(
            "<h2>Head</h2><div>loose <b>bold</b><br>next</div><ul><li>a<ul><li>b</li></ul></li></ul>\
             <ol start=\"3\"><li>three</li></ol><ul data-type=\"taskList\"><li data-checked=\"true\">done</li></ul>\
             <ul><li><input type=\"checkbox\"> open</li></ul><pre><code class=\"language-js\">x  =  1\ny</code></pre>\
             <table><tr><th>A</th><th colspan=\"2\">B</th></tr><tr><td>1</td><td>2</td></tr></table>\
             <p><span style=\"color: rgb(255,0,0); font-weight:700\">red</span> <mark>hl</mark></p>",
        );
        let v = &r.value;
        let kinds: Vec<&str> = v.iter().map(type_of).collect();
        assert_eq!(
            kinds,
            [
                "heading",
                "paragraph",
                "bulletList",
                "orderedList",
                "taskList",
                "taskList",
                "codeBlock",
                "table",
                "paragraph"
            ]
        );
        assert_eq!(pm::inline_text(&v[0]), "Head");
        assert_eq!(pm::inline_text(&v[1]), "loose bold\nnext");
        assert_eq!(attr(&v[3], "start"), Some(&json!(3)));
        assert_eq!(attr(&content(&v[4])[0], "checked"), Some(&json!(true)));
        assert_eq!(attr(&content(&v[5])[0], "checked"), Some(&json!(false)));
        assert_eq!(pm::inline_text(&v[6]), "x  =  1\ny");
        assert_eq!(attr_str(&v[6], "language"), Some("js"));
        let head_b = &content(&content(&v[7])[0])[1];
        assert_eq!(attr(head_b, "colspan"), Some(&json!(2)));
        let red = &content(&v[8])[0];
        let ms = marks(red);
        assert!(ms
            .iter()
            .any(|(m, a)| m == "textStyle" && a["color"] == "#FF0000"));
        assert!(ms.iter().any(|(m, _)| m == "bold"));
    }

    #[test]
    fn data_images_are_blobs() {
        let r = html("<p>a<img src=\"data:image/png;base64,iVBORw0KGgo=\" alt=\"dot\">b</p>");
        let kinds: Vec<&str> = r.value.iter().map(type_of).collect();
        assert_eq!(kinds, ["paragraph", "image", "paragraph"]);
        assert_eq!(r.blobs.len(), 1);
        assert_eq!(attr_str(&r.value[1], "blob"), Some(r.blobs[0].id.as_str()));
        assert!(html("<img src=\"data:image/svg+xml;base64,PHN2Zz4=\">")
            .blobs
            .is_empty());
    }

    #[test]
    fn title_and_deep_nesting() {
        assert_eq!(
            title_of("<title> My  page </title><p>x"),
            Some("My page".into())
        );
        let deep = "<div>".repeat(1000) + "deep" + &"</div>".repeat(1000);
        let r = html(&deep);
        assert_eq!(pm::inline_text(&r.value[0]), "deep");
    }
}
