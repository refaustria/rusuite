//! Building and reading ProseMirror JSON in the Notes schema (`docs/notes-format.md` §4.4 and §7).
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::{Blob, ImportContext};

/// The blob id of `bytes`: SHA-256, lowercase hex (as `notes_core::blob_id`).
#[must_use]
pub fn blob_id(bytes: &[u8]) -> String {
    let d = Sha256::digest(bytes);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// The media type of image bytes by their signature (`application/octet-stream` when unknown).
#[must_use]
pub fn sniff_mime(b: &[u8]) -> &'static str {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        "image/gif"
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        "image/webp"
    } else if b.starts_with(b"BM") {
        "image/bmp"
    } else {
        let head = String::from_utf8_lossy(&b[..b.len().min(256)]).to_ascii_lowercase();
        if head.contains("<svg") {
            "image/svg+xml"
        } else {
            "application/octet-stream"
        }
    }
}

/// File extension for a media type.
pub(crate) fn ext_of(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

/// Pixel size of a PNG, JPEG or GIF image.
pub(crate) fn image_size(b: &[u8]) -> Option<(u32, u32)> {
    if b.starts_with(b"\x89PNG") && b.len() >= 24 {
        let w = u32::from_be_bytes(b[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(b[20..24].try_into().ok()?);
        return Some((w, h));
    }
    if (b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a")) && b.len() >= 10 {
        return Some((
            u32::from(u16::from_le_bytes([b[6], b[7]])),
            u32::from(u16::from_le_bytes([b[8], b[9]])),
        ));
    }
    if b.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 9 < b.len() {
            if b[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = b[i + 1];
            let len = usize::from(u16::from_be_bytes([b[i + 2], b[i + 3]]));
            if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
                let h = u32::from(u16::from_be_bytes([b[i + 5], b[i + 6]]));
                let w = u32::from(u16::from_be_bytes([b[i + 7], b[i + 8]]));
                return Some((w, h));
            }
            i += 2 + len;
        }
    }
    None
}

// ---- building -------------------------------------------------------------------------------------------

pub(crate) fn mark(name: &str) -> Value {
    json!({ "type": name })
}

pub(crate) fn mark_with(name: &str, attrs: Value) -> Value {
    json!({ "type": name, "attrs": attrs })
}

pub(crate) fn text(s: &str, marks: &[Value]) -> Value {
    let mut o = Map::new();
    o.insert("type".into(), "text".into());
    o.insert("text".into(), s.into());
    if !marks.is_empty() {
        o.insert("marks".into(), Value::Array(marks.to_vec()));
    }
    Value::Object(o)
}

pub(crate) fn node(name: &str, attrs: Option<Value>, content: Vec<Value>) -> Value {
    let mut o = Map::new();
    o.insert("type".into(), name.into());
    if let Some(a) = attrs.filter(|a| a.as_object().is_some_and(|o| !o.is_empty())) {
        o.insert("attrs".into(), a);
    }
    if !content.is_empty() {
        o.insert("content".into(), Value::Array(content));
    }
    Value::Object(o)
}

pub(crate) fn paragraph(content: Vec<Value>) -> Value {
    node("paragraph", None, content)
}

pub(crate) fn heading(level: u8, content: Vec<Value>) -> Value {
    node(
        "heading",
        Some(json!({ "level": level.clamp(1, 6) })),
        content,
    )
}

/// Sets attribute `key` of a node.
pub(crate) fn set_attr(n: &mut Value, key: &str, v: Value) {
    if let Some(o) = n.as_object_mut() {
        let attrs = o
            .entry("attrs")
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(a) = attrs.as_object_mut() {
            a.insert(key.into(), v);
        }
    }
}

/// An image block for `bytes`, registering the blob.
pub(crate) fn image_block(
    bytes: Vec<u8>,
    mime: Option<&str>,
    alt: Option<&str>,
    size: Option<(f64, f64)>,
    blobs: &mut Vec<Blob>,
) -> Value {
    let id = add_blob(bytes, mime, blobs);
    let mut attrs = Map::new();
    attrs.insert("blob".into(), id.into());
    if let Some(a) = alt.filter(|a| !a.is_empty()) {
        attrs.insert("alt".into(), a.into());
    }
    if let Some((w, h)) = size {
        if w > 0.0 && h > 0.0 {
            attrs.insert("width".into(), json!(w.round()));
            attrs.insert("height".into(), json!(h.round()));
        }
    }
    node("image", Some(Value::Object(attrs)), Vec::new())
}

/// An attachment block for `bytes`, registering the blob.
pub(crate) fn attachment_block(bytes: Vec<u8>, name: &str, blobs: &mut Vec<Blob>) -> Value {
    let size = bytes.len();
    let id = add_blob(bytes, Some("application/octet-stream"), blobs);
    node(
        "attachment",
        Some(json!({ "blob": id, "name": name, "size": size })),
        Vec::new(),
    )
}

pub(crate) fn add_blob(bytes: Vec<u8>, mime: Option<&str>, blobs: &mut Vec<Blob>) -> String {
    let id = blob_id(&bytes);
    if !blobs.iter().any(|b| b.id == id) {
        let mime = mime
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| sniff_mime(&bytes))
            .to_string();
        blobs.push(Blob {
            id: id.clone(),
            mime,
            bytes,
        });
    }
    id
}

/// A paragraph (or heading) from inline content, with `image` nodes split out as blocks, `[[links]]` resolved
/// and trailing tag markers applied. Empty paragraphs are dropped.
pub(crate) fn text_blocks(
    inline: Vec<Value>,
    level: Option<u8>,
    ctx: &ImportContext<'_>,
) -> Vec<Value> {
    let mut out = Vec::new();
    let mut run = Vec::new();
    let flush = |run: &mut Vec<Value>, out: &mut Vec<Value>| {
        let items = trim_inline(link_pages(normalize_inline(std::mem::take(run)), ctx));
        if items.is_empty() && level.is_none() {
            return;
        }
        let mut b = match level {
            Some(l) => heading(l, items),
            None => paragraph(items),
        };
        apply_tag_markers(&mut b, ctx);
        out.push(b);
    };
    for n in inline {
        if matches!(type_of(&n), "image" | "attachment") {
            flush(&mut run, &mut out);
            out.push(n);
        } else {
            run.push(n);
        }
    }
    if !run.is_empty() || out.is_empty() {
        flush(&mut run, &mut out);
    }
    out
}

/// Merges adjacent text nodes with equal marks and drops empty ones.
pub(crate) fn normalize_inline(nodes: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(nodes.len());
    for n in nodes {
        if is_text(&n) {
            let s = n.get("text").and_then(Value::as_str).unwrap_or_default();
            if s.is_empty() {
                continue;
            }
            if let Some(last) = out.last_mut() {
                if is_text(last) && last.get("marks") == n.get("marks") {
                    let joined = format!(
                        "{}{s}",
                        last.get("text").and_then(Value::as_str).unwrap_or_default()
                    );
                    last["text"] = joined.into();
                    continue;
                }
            }
        }
        out.push(n);
    }
    out
}

/// Trims whitespace at the start and end of an inline sequence.
pub(crate) fn trim_inline(mut nodes: Vec<Value>) -> Vec<Value> {
    if let Some(first) = nodes.first_mut().filter(|n| is_text(n)) {
        let t = first["text"]
            .as_str()
            .unwrap_or_default()
            .trim_start()
            .to_string();
        first["text"] = t.into();
    }
    if let Some(last) = nodes.last_mut().filter(|n| is_text(n)) {
        let t = last["text"]
            .as_str()
            .unwrap_or_default()
            .trim_end()
            .to_string();
        last["text"] = t.into();
    }
    normalize_inline(nodes)
}

pub(crate) fn is_text(n: &Value) -> bool {
    n.get("type").and_then(Value::as_str) == Some("text")
}

pub(crate) fn type_of(n: &Value) -> &str {
    n.get("type").and_then(Value::as_str).unwrap_or_default()
}

pub(crate) fn content(n: &Value) -> &[Value] {
    n.get("content")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

pub(crate) fn attr<'a>(n: &'a Value, key: &str) -> Option<&'a Value> {
    n.get("attrs")
        .and_then(|a| a.get(key))
        .filter(|v| !v.is_null())
}

pub(crate) fn attr_str<'a>(n: &'a Value, key: &str) -> Option<&'a str> {
    attr(n, key).and_then(Value::as_str)
}

/// Marks of a text node as (name, attrs).
pub(crate) fn marks(n: &Value) -> Vec<(String, Value)> {
    n.get("marks")
        .and_then(Value::as_array)
        .map(|ms| {
            ms.iter()
                .map(|m| {
                    (
                        type_of(m).to_string(),
                        m.get("attrs").cloned().unwrap_or(Value::Null),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The plain inline text of a node (text, hard breaks as `\n`, page links as their title).
pub(crate) fn inline_text(n: &Value) -> String {
    let mut s = String::new();
    fn walk(n: &Value, s: &mut String) {
        match type_of(n) {
            "text" => s.push_str(n.get("text").and_then(Value::as_str).unwrap_or_default()),
            "hardBreak" => s.push('\n'),
            "pageLink" => s.push_str(attr_str(n, "title").unwrap_or_default()),
            _ => {
                for c in content(n) {
                    walk(c, s);
                }
            }
        }
    }
    walk(n, &mut s);
    s
}

/// Tags of a block (`attrs.tags`) and its checked state.
pub(crate) fn block_tags(n: &Value) -> (Vec<String>, Option<bool>) {
    let tags = attr(n, "tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    (tags, attr(n, "checked").and_then(Value::as_bool))
}

/// Applies trailing tag markers of a text block: strips them from its last text node and sets `tags`/`checked`.
pub(crate) fn apply_tag_markers(block: &mut Value, ctx: &ImportContext<'_>) {
    let Some(items) = block.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    let Some(last) = items.last_mut().filter(|n| is_text(n)) else {
        return;
    };
    let t = last["text"].as_str().unwrap_or_default().to_string();
    let (rest, tags, checked) = ctx.tags.strip_markers(&t);
    if tags.is_empty() {
        return;
    }
    last["text"] = rest.into();
    if rest_is_empty(last) {
        items.pop();
    }
    set_attr(block, "tags", json!(tags));
    if let Some(c) = checked {
        set_attr(block, "checked", c.into());
    }
}

fn rest_is_empty(n: &Value) -> bool {
    n.get("text").and_then(Value::as_str) == Some("")
}

/// Turns `[[Title]]` in plain text nodes into `pageLink` nodes when the title resolves to a page.
pub(crate) fn link_pages(nodes: Vec<Value>, ctx: &ImportContext<'_>) -> Vec<Value> {
    if ctx.resolve_page.is_none() {
        return nodes;
    }
    let mut out = Vec::with_capacity(nodes.len());
    for n in nodes {
        let has_link_mark = marks(&n).iter().any(|(m, _)| m == "link" || m == "code");
        let Some(s) = n
            .get("text")
            .and_then(Value::as_str)
            .filter(|_| !has_link_mark)
        else {
            out.push(n);
            continue;
        };
        let mut rest = s;
        let mut changed = false;
        let mut parts = Vec::new();
        while let Some(open) = rest.find("[[") {
            let Some(close) = rest[open + 2..].find("]]") else {
                break;
            };
            let title = &rest[open + 2..open + 2 + close];
            match ctx.page_id(title.trim()).filter(|_| !title.contains('\n')) {
                Some(id) => {
                    if open > 0 {
                        parts.push((rest[..open].to_string(), None));
                    }
                    parts.push((title.trim().to_string(), Some(id)));
                    changed = true;
                }
                None => parts.push((rest[..open + 4 + close].to_string(), None)),
            }
            rest = &rest[open + 4 + close..];
        }
        if !changed {
            out.push(n);
            continue;
        }
        if !rest.is_empty() {
            parts.push((rest.to_string(), None));
        }
        let ms: Vec<Value> = n
            .get("marks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (t, id) in parts {
            match id {
                Some(id) => out.push(node(
                    "pageLink",
                    Some(json!({ "pageId": id, "title": t })),
                    Vec::new(),
                )),
                None => out.push(text(&t, &ms)),
            }
        }
    }
    normalize_inline(out)
}

// ---- lists ----------------------------------------------------------------------------------------------

/// The list a flat paragraph belongs to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ListKind {
    Bullet,
    Ordered { start: u32 },
    Task { checked: bool },
}

impl ListKind {
    fn same_list(self, other: ListKind) -> bool {
        matches!(
            (self, other),
            (ListKind::Bullet, ListKind::Bullet)
                | (ListKind::Ordered { .. }, ListKind::Ordered { .. })
                | (ListKind::Task { .. }, ListKind::Task { .. })
        )
    }
}

/// A block in a flat sequence (OneNote, docx): list paragraphs carry their list kind and level.
pub(crate) struct Flat {
    pub block: Value,
    pub list: Option<(ListKind, u8)>,
}

/// Nests flat list paragraphs into `bulletList`/`orderedList`/`taskList` trees.
pub(crate) fn nest_lists(items: Vec<Flat>) -> Vec<Value> {
    let mut out = Vec::new();
    let mut it = items.into_iter().peekable();
    while let Some(f) = it.next() {
        match f.list {
            None => out.push(f.block),
            Some((kind, level)) => out.push(build_list(f.block, kind, level, &mut it)),
        }
    }
    out
}

fn list_item(block: Value, kind: ListKind) -> Value {
    match kind {
        ListKind::Task { checked } => {
            node("taskItem", Some(json!({ "checked": checked })), vec![block])
        }
        _ => node("listItem", None, vec![block]),
    }
}

fn build_list(
    first: Value,
    kind: ListKind,
    level: u8,
    it: &mut std::iter::Peekable<std::vec::IntoIter<Flat>>,
) -> Value {
    let mut items = vec![list_item(first, kind)];
    while let Some(next) = it.peek() {
        let Some((k, l)) = next.list else { break };
        if l > level {
            let f = it.next().expect("peeked");
            let nested = build_list(f.block, k, l, it);
            if let Some(Value::Array(c)) = items.last_mut().and_then(|i| i.get_mut("content")) {
                c.push(nested);
            }
        } else if l == level && k.same_list(kind) {
            let f = it.next().expect("peeked");
            items.push(list_item(f.block, k));
        } else {
            break;
        }
    }
    match kind {
        ListKind::Bullet => node("bulletList", None, items),
        ListKind::Ordered { start } => node(
            "orderedList",
            (start != 1).then(|| json!({ "start": start })),
            items,
        ),
        ListKind::Task { .. } => node("taskList", None, items),
    }
}

/// `#RRGGBB` (uppercase) of an RGB triple.
pub(crate) fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Parses `#RGB`, `#RRGGBB` or `rgb(r, g, b)` into `#RRGGBB`.
pub(crate) fn parse_color(s: &str) -> Option<String> {
    let s = s.trim();
    if let Some(h) = s.strip_prefix('#') {
        let h = h.trim();
        if h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(format!("#{}", h.to_ascii_uppercase()));
        }
        if h.len() == 3 && h.chars().all(|c| c.is_ascii_hexdigit()) {
            let d: String = h.chars().flat_map(|c| [c, c]).collect();
            return Some(format!("#{}", d.to_ascii_uppercase()));
        }
        return None;
    }
    let inner = s
        .strip_prefix("rgb(")
        .or_else(|| s.strip_prefix("rgba("))?
        .strip_suffix(')')?;
    let parts: Vec<u8> = inner
        .split(',')
        .take(3)
        .map(|p| p.trim().parse::<u8>())
        .collect::<Result<_, _>>()
        .ok()?;
    (parts.len() == 3).then(|| hex(parts[0], parts[1], parts[2]))
}

/// Allowed link targets: `http(s):`, `mailto:`, `tel:`, in-page `#…` and `onenote:` (kept as text by exporters).
pub(crate) fn safe_href(href: &str) -> Option<String> {
    let h = href.trim();
    let lower: String = h
        .chars()
        .filter(|c| !c.is_control() && !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    let ok = ["http://", "https://", "mailto:", "tel:", "onenote:"]
        .iter()
        .any(|p| lower.starts_with(p))
        || lower.starts_with('#');
    ok.then(|| h.to_string())
}

/// Decodes a `data:` URI: (media type, bytes).
pub(crate) fn decode_data_uri(uri: &str) -> Option<(String, Vec<u8>)> {
    let rest = uri.trim().strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let mime = meta
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let bytes = if meta.ends_with(";base64") {
        let clean: String = data.chars().filter(|c| !c.is_whitespace()).collect();
        core_model::media::base64_decode(&clean).ok()?
    } else {
        percent_decode(data).into_bytes()
    };
    Some((mime, bytes))
}

pub(crate) fn data_uri(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        core_model::media::base64_encode(bytes)
    )
}

pub(crate) fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nests_flat_lists() {
        let p = |t: &str| paragraph(vec![text(t, &[])]);
        let blocks = nest_lists(vec![
            Flat {
                block: p("a"),
                list: Some((ListKind::Bullet, 0)),
            },
            Flat {
                block: p("a1"),
                list: Some((ListKind::Ordered { start: 3 }, 1)),
            },
            Flat {
                block: p("b"),
                list: Some((ListKind::Bullet, 0)),
            },
            Flat {
                block: p("x"),
                list: None,
            },
            Flat {
                block: p("t"),
                list: Some((ListKind::Task { checked: true }, 0)),
            },
        ]);
        assert_eq!(blocks.len(), 3);
        assert_eq!(type_of(&blocks[0]), "bulletList");
        let items = content(&blocks[0]);
        assert_eq!(items.len(), 2);
        let nested = &content(&items[0])[1];
        assert_eq!(type_of(nested), "orderedList");
        assert_eq!(attr(nested, "start"), Some(&json!(3)));
        assert_eq!(type_of(&blocks[2]), "taskList");
        assert_eq!(attr(&content(&blocks[2])[0], "checked"), Some(&json!(true)));
    }

    #[test]
    fn colors_hrefs_and_data_uris() {
        assert_eq!(parse_color("#abc").as_deref(), Some("#AABBCC"));
        assert_eq!(parse_color("rgb(255, 0, 16)").as_deref(), Some("#FF0010"));
        assert_eq!(parse_color("red"), None);
        assert!(safe_href("javascript:alert(1)").is_none());
        assert!(safe_href(" JaVa\tScript:alert(1)").is_none());
        assert!(safe_href("https://example.com").is_some());
        let (m, b) = decode_data_uri("data:image/png;base64,iVBORw0KGgo=").unwrap();
        assert_eq!(m, "image/png");
        assert!(b.starts_with(b"\x89PNG"));
        assert_eq!(decode_data_uri("data:text/plain,a%20b").unwrap().1, b"a b");
    }

    #[test]
    fn page_links_resolve() {
        let f = |t: &str| (t == "Home").then(|| "pg-1".to_string());
        let ctx = ImportContext {
            resolve_page: Some(&f),
            ..Default::default()
        };
        let out = link_pages(vec![text("see [[Home]] and [[Nope]]", &[])], &ctx);
        assert_eq!(out.len(), 3);
        assert_eq!(attr_str(&out[1], "pageId"), Some("pg-1"));
        assert_eq!(out[2]["text"], " and [[Nope]]");
    }
}
