//! The ProseMirror-shaped page content in `loro-prosemirror`'s container layout, and readers over it.
//!
//! Layout (`docs/notes-format.md` § Page content): a non-text node is a `LoroMap { nodeName: string,
//! attributes: LoroMap, children: LoroList }`; a run of adjacent text nodes is one `LoroText` in the parent's
//! `children`, each PM mark a text style whose key is the mark name and whose value is the mark's attrs map.
use std::collections::BTreeSet;

use loro::{Container, LoroList, LoroMap, LoroText, LoroValue, TextDelta, ValueOrContainer};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::util::{as_list, as_map, get_str, json_to_loro, loro_to_json};
use crate::NotesError;

/// Node and mark names the readers understand (N2 must use exactly these; `docs/notes-format.md`).
pub(crate) mod names {
    pub const PARAGRAPH: &str = "paragraph";
    pub const HEADING: &str = "heading";
    pub const CODE_BLOCK: &str = "codeBlock";
    pub const TASK_ITEM: &str = "taskItem";
    pub const HARD_BREAK: &str = "hardBreak";
    pub const PAGE_LINK: &str = "pageLink";
    pub const TEXTBLOCKS: &[&str] = &[PARAGRAPH, HEADING, CODE_BLOCK];
}

/// Mark names and their `expand` behaviour (inclusive marks expand after, links never), as `configLoroTextStyle`
/// derives it from the Tiptap schema.
pub(crate) const MARK_STYLES: &[(&str, bool)] = &[
    ("bold", true),
    ("italic", true),
    ("underline", true),
    ("strike", true),
    ("code", true),
    ("highlight", true),
    ("textStyle", true),
    ("subscript", true),
    ("superscript", true),
    ("link", false),
    ("pageLink", false),
];

/// An owned copy of the content tree.
#[derive(Debug, Clone, PartialEq)]
pub enum PmNode {
    Element {
        name: String,
        attrs: Map<String, Value>,
        children: Vec<PmNode>,
    },
    /// A text run with its marks (name, attrs), sorted by name.
    Text {
        text: String,
        marks: Vec<(String, Value)>,
    },
}

impl PmNode {
    /// Reads a node map (`nodeName` / `attributes` / `children`).
    pub(crate) fn read(map: &LoroMap) -> PmNode {
        let name = get_str(map, "nodeName").unwrap_or_default();
        let attrs = match as_map(map.get("attributes")).map(|m| loro_to_json(&m.get_deep_value())) {
            Some(Value::Object(o)) => o,
            _ => Map::new(),
        };
        let mut children = Vec::new();
        if let Some(list) = as_list(map.get("children")) {
            for i in 0..list.len() {
                match list.get(i) {
                    Some(ValueOrContainer::Container(Container::Map(m))) => {
                        children.push(PmNode::read(&m))
                    }
                    Some(ValueOrContainer::Container(Container::Text(t))) => {
                        read_text(&t, &mut children)
                    }
                    Some(ValueOrContainer::Value(LoroValue::String(s))) if !s.is_empty() => {
                        children.push(PmNode::Text {
                            text: s.to_string(),
                            marks: Vec::new(),
                        });
                    }
                    _ => {}
                }
            }
        }
        PmNode::Element {
            name,
            attrs,
            children,
        }
    }

    #[must_use]
    pub fn name(&self) -> &str {
        match self {
            PmNode::Element { name, .. } => name,
            PmNode::Text { .. } => "text",
        }
    }

    #[must_use]
    pub fn attr(&self, key: &str) -> Option<&Value> {
        match self {
            PmNode::Element { attrs, .. } => attrs.get(key),
            PmNode::Text { .. } => None,
        }
    }

    #[must_use]
    pub fn children(&self) -> &[PmNode] {
        match self {
            PmNode::Element { children, .. } => children,
            PmNode::Text { .. } => &[],
        }
    }

    /// ProseMirror JSON (`attrs`/`content`/`marks` omitted when empty).
    #[must_use]
    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        match self {
            PmNode::Element {
                name,
                attrs,
                children,
            } => {
                o.insert("type".into(), Value::String(name.clone()));
                if !attrs.is_empty() {
                    o.insert("attrs".into(), Value::Object(attrs.clone()));
                }
                if !children.is_empty() {
                    o.insert(
                        "content".into(),
                        Value::Array(children.iter().map(PmNode::to_json).collect()),
                    );
                }
            }
            PmNode::Text { text, marks } => {
                o.insert("type".into(), Value::String("text".into()));
                o.insert("text".into(), Value::String(text.clone()));
                if !marks.is_empty() {
                    let ms = marks
                        .iter()
                        .map(|(n, a)| {
                            let mut m = Map::new();
                            m.insert("type".into(), Value::String(n.clone()));
                            if a.as_object().is_some_and(|a| !a.is_empty()) {
                                m.insert("attrs".into(), a.clone());
                            }
                            Value::Object(m)
                        })
                        .collect();
                    o.insert("marks".into(), Value::Array(ms));
                }
            }
        }
        Value::Object(o)
    }

    /// The inline text of a node: text runs, `hardBreak` → `\n`, `pageLink` nodes → their `title` attr;
    /// nested blocks are separated by `\n`.
    #[must_use]
    pub fn text(&self) -> String {
        let mut lines = Vec::new();
        collect_lines(self, &mut lines);
        lines.join("\n")
    }

    fn is_textblock(&self) -> bool {
        match self {
            PmNode::Element { name, children, .. } => {
                names::TEXTBLOCKS.contains(&name.as_str())
                    || children.iter().any(|c| matches!(c, PmNode::Text { .. }))
            }
            PmNode::Text { .. } => false,
        }
    }

    fn inline_text(&self, out: &mut String) {
        match self {
            PmNode::Text { text, .. } => out.push_str(text),
            PmNode::Element {
                name,
                attrs,
                children,
            } => {
                if name == names::HARD_BREAK {
                    out.push('\n');
                } else if name == names::PAGE_LINK && children.is_empty() {
                    if let Some(Value::String(t)) = attrs.get("title") {
                        out.push_str(t);
                    }
                } else {
                    for c in children {
                        c.inline_text(out);
                    }
                }
            }
        }
    }
}

fn read_text(t: &LoroText, out: &mut Vec<PmNode>) {
    for d in t.to_delta() {
        if let TextDelta::Insert { insert, attributes } = d {
            if insert.is_empty() {
                continue;
            }
            let mut marks: Vec<(String, Value)> = attributes
                .unwrap_or_default()
                .into_iter()
                .filter(|(_, v)| !matches!(v, LoroValue::Null))
                .map(|(k, v)| (k, loro_to_json(&v)))
                .collect();
            marks.sort_by(|a, b| a.0.cmp(&b.0));
            out.push(PmNode::Text {
                text: insert,
                marks,
            });
        }
    }
}

fn collect_lines(node: &PmNode, lines: &mut Vec<String>) {
    if node.is_textblock() {
        let mut s = String::new();
        node.inline_text(&mut s);
        if !s.is_empty() {
            lines.push(s);
        }
    } else {
        for c in node.children() {
            collect_lines(c, lines);
        }
    }
}

/// Writes PM JSON nodes into a `children` list at `pos`, in the binding's shape (adjacent text nodes → one
/// `LoroText`; null attrs are left out like the binding does).
pub(crate) fn write_children(
    list: &LoroList,
    mut pos: usize,
    nodes: &[Value],
) -> Result<usize, NotesError> {
    let mut i = 0;
    while i < nodes.len() {
        if nodes[i].get("type").and_then(Value::as_str) == Some("text") {
            let start = i;
            while i < nodes.len() && nodes[i].get("type").and_then(Value::as_str) == Some("text") {
                i += 1;
            }
            let t = list.insert_container(pos, LoroText::new())?;
            write_text(&t, &nodes[start..i])?;
        } else {
            write_element(list, pos, &nodes[i])?;
            i += 1;
        }
        pos += 1;
    }
    Ok(pos)
}

fn write_text(t: &LoroText, runs: &[Value]) -> Result<(), NotesError> {
    let mut at = 0usize;
    for run in runs {
        let s = run.get("text").and_then(Value::as_str).unwrap_or_default();
        let n = s.chars().count();
        t.insert(at, s)?;
        if let Some(Value::Array(marks)) = run.get("marks") {
            for m in marks {
                let name = m
                    .get("type")
                    .and_then(Value::as_str)
                    .ok_or_else(|| NotesError::Content("mark without type".into()))?;
                let attrs = match m.get("attrs") {
                    Some(a @ Value::Object(_)) => json_to_loro(a),
                    _ => LoroValue::Map(Default::default()),
                };
                if n > 0 {
                    t.mark(at..at + n, name, attrs)?;
                }
            }
        }
        at += n;
    }
    Ok(())
}

fn write_element(list: &LoroList, pos: usize, node: &Value) -> Result<(), NotesError> {
    let name = node
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| NotesError::Content("node without type".into()))?;
    let m = list.insert_container(pos, LoroMap::new())?;
    m.insert("nodeName", name)?;
    let attrs = m.insert_container("attributes", LoroMap::new())?;
    if let Some(Value::Object(a)) = node.get("attrs") {
        for (k, v) in a {
            if !v.is_null() {
                attrs.insert(k, json_to_loro(v))?;
            }
        }
    }
    let children = m.insert_container("children", LoroList::new())?;
    if let Some(Value::Array(c)) = node.get("content") {
        write_children(&children, 0, c)?;
    }
    Ok(())
}

/// A heading of the page outline; `block` is the index of the top-level block containing it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub level: u8,
    pub text: String,
    pub block: u32,
}

/// A block carrying tags (attribute `tags: [tagId]`; to-do kinds also `checked: bool`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct BlockTag {
    pub tags: Vec<String>,
    pub checked: Option<bool>,
    pub text: String,
    pub block: u32,
}

/// A to-do: a `taskItem` (check list; `tags` empty) or a block tagged with a to-do kind tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub text: String,
    pub checked: bool,
    pub block: u32,
    pub tags: Vec<String>,
}

/// Everything the core's index needs from one page, read in one pass.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PageIndexData {
    pub text: String,
    pub outline: Vec<OutlineEntry>,
    pub links: Vec<String>,
    pub blobs: Vec<String>,
    pub block_tags: Vec<BlockTag>,
    /// `taskItem`s only (tagged to-dos are in `block_tags`; which tags are to-do kinds is notebook data).
    pub task_items: Vec<TaskItem>,
}

impl PageIndexData {
    /// To-dos: task items and blocks tagged with one of `todo_tags`, in document order.
    #[must_use]
    pub fn tasks(&self, todo_tags: &[String]) -> Vec<TaskItem> {
        let mut out: Vec<TaskItem> = self.task_items.clone();
        out.extend(
            self.block_tags
                .iter()
                .filter(|b| b.tags.iter().any(|t| todo_tags.contains(t)))
                .map(|b| TaskItem {
                    text: b.text.clone(),
                    checked: b.checked.unwrap_or(false),
                    block: b.block,
                    tags: b.tags.clone(),
                }),
        );
        out.sort_by_key(|t| t.block);
        out
    }
}

pub(crate) fn index(doc: &PmNode) -> PageIndexData {
    let mut d = PageIndexData {
        text: doc.text(),
        ..PageIndexData::default()
    };
    let mut links = Vec::new();
    let mut blobs = BTreeSet::new();
    for (i, block) in doc.children().iter().enumerate() {
        let block_ix = u32::try_from(i).unwrap_or(u32::MAX);
        visit(block, block_ix, &mut d, &mut links, &mut blobs);
    }
    let mut seen = BTreeSet::new();
    d.links = links
        .into_iter()
        .filter(|l| seen.insert(l.clone()))
        .collect();
    d.blobs = blobs.into_iter().collect();
    d
}

fn visit(
    n: &PmNode,
    block: u32,
    d: &mut PageIndexData,
    links: &mut Vec<String>,
    blobs: &mut BTreeSet<String>,
) {
    match n {
        PmNode::Text { marks, .. } => {
            for (name, attrs) in marks {
                if name == names::PAGE_LINK {
                    if let Some(Value::String(p)) = attrs.get("pageId") {
                        links.push(p.clone());
                    }
                }
            }
        }
        PmNode::Element {
            name,
            attrs,
            children,
        } => {
            if name == names::PAGE_LINK {
                if let Some(Value::String(p)) = attrs.get("pageId") {
                    links.push(p.clone());
                }
            }
            if let Some(Value::String(b)) = attrs.get("blob") {
                blobs.insert(b.clone());
            }
            if name == names::HEADING {
                let level = attrs.get("level").and_then(Value::as_u64).unwrap_or(1);
                d.outline.push(OutlineEntry {
                    level: u8::try_from(level).unwrap_or(6),
                    text: n.text(),
                    block,
                });
            }
            if name == names::TASK_ITEM {
                let mut s = Vec::new();
                for c in children.iter().filter(|c| c.is_textblock()) {
                    collect_lines(c, &mut s);
                }
                d.task_items.push(TaskItem {
                    text: s.join("\n"),
                    checked: attrs
                        .get("checked")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    block,
                    tags: Vec::new(),
                });
            }
            if let Some(Value::Array(tags)) = attrs.get("tags") {
                let tags: Vec<String> = tags
                    .iter()
                    .filter_map(|t| t.as_str().map(str::to_string))
                    .collect();
                if !tags.is_empty() {
                    d.block_tags.push(BlockTag {
                        tags,
                        checked: attrs.get("checked").and_then(Value::as_bool),
                        text: n.text(),
                        block,
                    });
                }
            }
            for c in children {
                visit(c, block, d, links, blobs);
            }
        }
    }
}
