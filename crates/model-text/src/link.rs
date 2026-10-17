//! Hyperlinks (Word's Insert › Link) and bookmarks (Insert › Bookmark).
//!
//! A hyperlink is an attribute of the text runs it covers
//! ([`crate::Run::link`]): consecutive runs with an equal [`Hyperlink`]
//! form one link (docx: one `w:hyperlink` around them). Keeping it on the
//! runs keeps every char offset of ADR 0007 unchanged.
//!
//! A bookmark is a named range marked in the inline stream by an
//! [`Inline::BookmarkStart`] (with the name) and an [`Inline::BookmarkEnd`]
//! with the same [`BookmarkId`], zero-width atoms like the comment
//! markers. Names starting with `_` are hidden (Word's `_Ref…` targets of
//! cross-references, `_Toc…`); `_GoBack` is never read.
//!
//! Invariants (restored by [`Document::fix_bookmarks`], which
//! [`Document::normalize`] runs): every id has exactly one start and,
//! after it in document order, one end; names are unique
//! (case-insensitive, as in Word: a later duplicate is removed); a lone
//! start gets its end at the end of its paragraph, a lone end its start
//! at the start of its paragraph; markers live in the text containers
//! (body, notes, headers, footers), never in comment content.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::block::{Block, NodeId, Paragraph};
use crate::document::{paragraphs_in, Document};
use crate::inline::Inline;

/// Where a hyperlink leads.
///
/// Serializes as `{"kind":"url","value":"https://…"}`,
/// `{"kind":"bookmark","value":"intro"}` or
/// `{"kind":"email","value":{"address":"a@b.c","subject":"Hi"}}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind",
    content = "value"
)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum LinkTarget {
    /// A web page or file (docx: an external relationship, `r:id`).
    Url(String),
    /// A place in this document: a bookmark name (docx `w:anchor`).
    Bookmark(String),
    /// An e-mail address (docx: an external `mailto:` relationship).
    Email {
        address: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts", ts(optional))]
        subject: Option<String>,
    },
}

impl LinkTarget {
    /// The target as a URL: the URL, `#bookmark`, or `mailto:address`
    /// (with `?subject=` percent-encoded).
    pub fn href(&self) -> String {
        match self {
            LinkTarget::Url(u) => u.clone(),
            LinkTarget::Bookmark(b) => format!("#{b}"),
            LinkTarget::Email { address, subject } => match subject.as_deref() {
                Some(s) if !s.is_empty() => format!("mailto:{address}?subject={}", encode(s)),
                _ => format!("mailto:{address}"),
            },
        }
    }

    /// The target of an external relationship (`mailto:` becomes
    /// [`LinkTarget::Email`]).
    pub fn from_url(url: &str) -> Self {
        let lower = url.get(..7).map(str::to_ascii_lowercase);
        if lower.as_deref() == Some("mailto:") {
            let rest = &url[7..];
            let (address, query) = rest.split_once('?').unwrap_or((rest, ""));
            let subject = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("subject="))
                .map(decode)
                .filter(|s| !s.is_empty());
            return LinkTarget::Email {
                address: decode(address),
                subject,
            };
        }
        LinkTarget::Url(url.to_owned())
    }
}

fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A hyperlink on a run of text.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Hyperlink {
    /// Where it leads.
    pub target: LinkTarget,
    /// The ScreenTip (docx `w:tooltip`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub tooltip: Option<String>,
    /// Written as a HYPERLINK field (`HYPERLINK "url" \o "tip"`, the
    /// field's result being the linked runs) instead of `w:hyperlink`:
    /// links read from such fields stay fields.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub field: bool,
}

impl Hyperlink {
    /// A link to `target` without tooltip.
    pub fn new(target: LinkTarget) -> Self {
        Self {
            target,
            tooltip: None,
            field: false,
        }
    }

    /// The link of a HYPERLINK field instruction (`HYPERLINK "url"`,
    /// `\l "bookmark"` for a place in the document (after a URL: its
    /// `#fragment`), `\o "tip"` for the ScreenTip; `\m`, `\n`, `\t`
    /// ignored), or `None` for other instructions.
    pub fn parse_field(instr: &str) -> Option<Hyperlink> {
        let instr = instr.trim();
        let (name, rest) = instr.split_once(char::is_whitespace).unwrap_or((instr, ""));
        if !name.eq_ignore_ascii_case("HYPERLINK") {
            return None;
        }
        let args = field_args(rest);
        let mut url: Option<String> = None;
        let mut location: Option<String> = None;
        let mut tooltip: Option<String> = None;
        let mut i = 0;
        while i < args.len() {
            let a = &args[i];
            match a.as_str() {
                "\\l" | "\\L" => {
                    location = args.get(i + 1).cloned();
                    i += 1;
                }
                "\\o" | "\\O" => {
                    tooltip = args.get(i + 1).cloned();
                    i += 1;
                }
                "\\t" | "\\T" => i += 1,
                s if s.starts_with('\\') => {}
                s if url.is_none() => url = Some(s.to_owned()),
                _ => {}
            }
            i += 1;
        }
        let target = match (
            url.filter(|u| !u.is_empty()),
            location.filter(|l| !l.is_empty()),
        ) {
            (Some(u), Some(l)) => LinkTarget::Url(format!("{u}#{l}")),
            (Some(u), None) => LinkTarget::from_url(&u),
            (None, Some(l)) => LinkTarget::Bookmark(l),
            (None, None) => return None,
        };
        Some(Hyperlink {
            target,
            tooltip: tooltip.filter(|t| !t.is_empty()),
            field: true,
        })
    }

    /// The HYPERLINK field instruction of this link (see
    /// [`parse_field`](Self::parse_field)).
    pub fn field_instruction(&self) -> String {
        let q = |s: &str| format!("\"{}\"", s.replace('"', "\\\""));
        let mut out = match &self.target {
            LinkTarget::Bookmark(b) => format!("HYPERLINK \\l {}", q(b)),
            t => format!("HYPERLINK {}", q(&t.href())),
        };
        if let Some(tip) = &self.tooltip {
            out.push_str(&format!(" \\o {}", q(tip)));
        }
        out
    }
}

/// The arguments of a field instruction: quoted strings (with `\"`
/// escapes) and bare words.
fn field_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        let mut cur = String::new();
        if c == '"' {
            chars.next();
            while let Some(c) = chars.next() {
                match c {
                    '\\' if chars.peek() == Some(&'"') => {
                        cur.push('"');
                        chars.next();
                    }
                    '"' => break,
                    c => cur.push(c),
                }
            }
        } else {
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                cur.push(c);
                chars.next();
            }
        }
        out.push(cur);
    }
    out
}

/// Document-unique id of a bookmark (docx `w:id`). Serializes as a number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct BookmarkId(#[cfg_attr(feature = "ts", ts(type = "number"))] pub u32);

/// A bookmark and where it lies (char offsets of its markers).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct BookmarkRange {
    /// Id.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub id: BookmarkId,
    /// Name.
    pub name: String,
    /// Paragraph holding the start marker.
    pub start_block: NodeId,
    /// Offset of the start marker.
    pub start: usize,
    /// Paragraph holding the end marker.
    pub end_block: NodeId,
    /// Offset of the end marker.
    pub end: usize,
}

impl BookmarkRange {
    /// Hidden bookmarks (names starting with `_`).
    pub fn hidden(&self) -> bool {
        self.name.starts_with('_')
    }
}

/// The bookmark id of a marker: `(id, is_start)`.
pub fn bookmark_marker_of(inline: &Inline) -> Option<(BookmarkId, bool)> {
    match inline {
        Inline::BookmarkStart { id, .. } => Some((*id, true)),
        Inline::BookmarkEnd { id } => Some((*id, false)),
        _ => None,
    }
}

/// Whether `name` is a valid bookmark name (Word: starts with a letter, or
/// `_` for hidden ones; letters, digits and `_`; at most 40 characters).
pub fn valid_bookmark_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    name.chars().count() <= 40
        && (first.is_alphabetic() || first == '_')
        && chars.all(|c| c.is_alphanumeric() || c == '_')
}

impl Document {
    /// Every bookmark with its range, in the order of the start markers
    /// (body, notes, headers and footers).
    pub fn bookmarks(&self) -> Vec<BookmarkRange> {
        let mut starts: Vec<(BookmarkId, String, NodeId, usize)> = Vec::new();
        let mut ends: HashMap<BookmarkId, (NodeId, usize)> = HashMap::new();
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                let mut pos = 0;
                for inline in &p.inlines {
                    match inline {
                        Inline::BookmarkStart { id, name } => {
                            starts.push((*id, name.clone(), p.id, pos));
                        }
                        Inline::BookmarkEnd { id } => {
                            ends.entry(*id).or_insert((p.id, pos));
                        }
                        _ => {}
                    }
                    pos += match inline {
                        Inline::Run(r) => r.text.chars().count(),
                        _ => 1,
                    };
                }
            }
        }
        starts
            .into_iter()
            .filter_map(|(id, name, sb, s)| {
                let (eb, e) = ends.get(&id).copied()?;
                Some(BookmarkRange {
                    id,
                    name,
                    start_block: sb,
                    start: s,
                    end_block: eb,
                    end: e,
                })
            })
            .collect()
    }

    /// The bookmark named `name` (case-insensitive, as Word compares).
    pub fn bookmark(&self, name: &str) -> Option<BookmarkRange> {
        self.bookmarks()
            .into_iter()
            .find(|b| b.name.eq_ignore_ascii_case(name))
    }

    /// An unused bookmark id (at least 1).
    pub fn next_bookmark_id(&self) -> BookmarkId {
        let mut max = 0;
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                for i in &p.inlines {
                    if let Some((id, _)) = bookmark_marker_of(i) {
                        max = max.max(id.0);
                    }
                }
            }
        }
        BookmarkId(max + 1)
    }

    /// A fresh hidden bookmark name `_Ref` + nine digits (Word's names for
    /// cross-reference targets).
    pub fn next_ref_name(&self) -> String {
        let used: HashSet<String> = self
            .bookmarks()
            .into_iter()
            .map(|b| b.name.to_ascii_lowercase())
            .collect();
        let mut n = 100_000_000u64 + u64::from(self.next_bookmark_id().0);
        loop {
            let name = format!("_Ref{n:09}");
            if !used.contains(&name.to_ascii_lowercase()) {
                return name;
            }
            n += 1;
        }
    }

    /// Restores the bookmark invariants (see [`crate::link`]); returns the
    /// paragraphs whose markers changed with their inlines before.
    pub fn fix_bookmarks(&mut self) -> Vec<(NodeId, Vec<Inline>)> {
        // Every marker, in document order: (paragraph, index, id, start, name).
        let mut found: Vec<(NodeId, usize, BookmarkId, bool, Option<String>)> = Vec::new();
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                for (i, inline) in p.inlines.iter().enumerate() {
                    match inline {
                        Inline::BookmarkStart { id, name } => {
                            found.push((p.id, i, *id, true, Some(name.clone())));
                        }
                        Inline::BookmarkEnd { id } => found.push((p.id, i, *id, false, None)),
                        _ => {}
                    }
                }
            }
        }
        let mut changed = Vec::new();
        // Markers in comment content are dropped (comment content is not a
        // text container: nothing to report, the comments are unchanged
        // for the UI).
        for c in &mut self.comments {
            for b in &mut c.content {
                strip(b);
            }
        }
        if found.is_empty() {
            return changed;
        }
        let mut remove: HashSet<(NodeId, usize)> = HashSet::new();
        let mut back: HashMap<NodeId, Vec<Inline>> = HashMap::new();
        let mut by_id: HashMap<BookmarkId, Vec<usize>> = HashMap::new();
        let mut order: Vec<BookmarkId> = Vec::new();
        for (seq, f) in found.iter().enumerate() {
            let e = by_id.entry(f.2).or_default();
            if e.is_empty() {
                order.push(f.2);
            }
            e.push(seq);
        }
        let mut names: HashSet<String> = HashSet::new();
        for id in order {
            let list = &by_id[&id];
            let start = list.iter().copied().find(|&s| found[s].3);
            // An end without a start cannot be restored (no name): dropped.
            let end = start.and_then(|s| list.iter().copied().find(|&e| !found[e].3 && e > s));
            let name = start.and_then(|s| found[s].4.clone());
            let duplicate = name.as_ref().is_some_and(|n| {
                n.is_empty() || n.eq_ignore_ascii_case("_GoBack") || !names.insert(n.to_lowercase())
            });
            for &seq in list {
                let keep = !duplicate && (Some(seq) == start || Some(seq) == end);
                if !keep {
                    remove.insert((found[seq].0, found[seq].1));
                }
            }
            if duplicate {
                continue;
            }
            match (start, end) {
                (Some(_), Some(_)) => {}
                (Some(s), None) => back
                    .entry(found[s].0)
                    .or_default()
                    .push(Inline::BookmarkEnd { id }),
                (None, _) => {}
            }
        }
        let mut touched: Vec<NodeId> = Vec::new();
        for f in &found {
            if !touched.contains(&f.0) {
                touched.push(f.0);
            }
        }
        for pid in touched {
            let has_change = remove.iter().any(|(p, _)| *p == pid) || back.contains_key(&pid);
            if !has_change {
                continue;
            }
            let Some(Block::Paragraph(p)) = self.find_block_mut(pid) else {
                continue;
            };
            let old = p.inlines.clone();
            let mut new: Vec<Inline> = Vec::new();
            new.extend(
                old.iter()
                    .enumerate()
                    .filter(|(i, _)| !remove.contains(&(pid, *i)))
                    .map(|(_, x)| x.clone()),
            );
            new.extend(back.remove(&pid).unwrap_or_default());
            p.inlines = new;
            changed.push((pid, old));
        }
        changed
    }

    /// The paragraph ids of the bookmark's text in document order with the
    /// char range inside each (the bookmark's content).
    pub fn bookmark_text(&self, b: &BookmarkRange) -> String {
        let mut out = String::new();
        let mut inside = false;
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                if !inside && p.id != b.start_block {
                    continue;
                }
                let from = if p.id == b.start_block { b.start } else { 0 };
                let to = if p.id == b.end_block { b.end } else { p.len() };
                if inside {
                    out.push(' ');
                }
                inside = true;
                out.push_str(&display_text_of(p, from, to));
                if p.id == b.end_block {
                    return out.trim().to_owned();
                }
            }
        }
        out.trim().to_owned()
    }
}

/// The text a reader sees of positions `from..to` of `p` (runs, field
/// results, breaks as spaces; markers, images and note references
/// omitted).
pub fn display_text_of(p: &Paragraph, from: usize, to: usize) -> String {
    let mut out = String::new();
    let mut pos = 0;
    for inline in &p.inlines {
        let len = match inline {
            Inline::Run(r) => r.text.chars().count(),
            _ => 1,
        };
        let (s, e) = (pos.max(from), (pos + len).min(to));
        if s < e || (len == 0 && pos >= from && pos < to) {
            match inline {
                Inline::Run(r) => out.extend(r.text.chars().skip(s - pos).take(e - s)),
                Inline::Field(f) => out.push_str(&f.cached),
                Inline::Break(_) => out.push(' '),
                _ => {}
            }
        }
        pos += len;
    }
    out
}

fn strip(b: &mut Block) {
    match b {
        Block::Paragraph(p) => p.inlines.retain(|i| !i.is_bookmark_marker()),
        Block::Table(t) => {
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                for b in &mut cell.blocks {
                    strip(b);
                }
            }
        }
        Block::Toc(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inline::Run;

    fn start(id: u32, name: &str) -> Inline {
        Inline::BookmarkStart {
            id: BookmarkId(id),
            name: name.into(),
        }
    }
    fn end(id: u32) -> Inline {
        Inline::BookmarkEnd { id: BookmarkId(id) }
    }
    fn run(t: &str) -> Inline {
        Inline::Run(Run::new(t))
    }

    fn doc_with(paras: Vec<Vec<Inline>>) -> Document {
        let mut doc = Document::new();
        doc.body.clear();
        for inl in paras {
            let mut p = Paragraph::new(doc.alloc_id());
            p.inlines = inl;
            doc.body.push(Block::Paragraph(p));
        }
        doc
    }

    fn inlines(doc: &Document, i: usize) -> Vec<Inline> {
        doc.body[i].as_paragraph().unwrap().inlines.clone()
    }

    #[test]
    fn ranges_and_text() {
        let doc = doc_with(vec![
            vec![run("ab"), start(1, "intro"), run("cd")],
            vec![run("ef"), end(1), run("g")],
        ]);
        let b = doc.bookmark("INTRO").unwrap();
        assert_eq!((b.start, b.end), (2, 2));
        assert_eq!(b.end_block, doc.body[1].id());
        assert_eq!(doc.bookmark_text(&b), "cd ef");
        assert!(!b.hidden());
        assert_eq!(doc.next_bookmark_id(), BookmarkId(2));
        assert!(doc.next_ref_name().starts_with("_Ref"));
        assert_eq!(doc.next_ref_name().len(), 13);
    }

    #[test]
    fn fix_restores_invariants() {
        let mut doc = doc_with(vec![
            vec![start(1, "a"), run("x"), end(1)],
            vec![
                start(2, "A"),
                run("dup"),
                end(2),
                start(3, "lone"),
                run("y"),
            ],
            vec![end(9), start(4, "_GoBack"), end(4), run("z")],
        ]);
        let before = doc.clone();
        let changed = doc.fix_bookmarks();
        assert_eq!(changed.len(), 2);
        assert_eq!(inlines(&doc, 0), inlines(&before, 0));
        assert_eq!(
            inlines(&doc, 1),
            vec![run("dup"), start(3, "lone"), run("y"), end(3)]
        );
        assert_eq!(inlines(&doc, 2), vec![run("z")]);
        assert!(doc.fix_bookmarks().is_empty());
    }

    #[test]
    fn names_and_targets() {
        assert!(valid_bookmark_name("Intro_2"));
        assert!(valid_bookmark_name("_Ref123"));
        assert!(!valid_bookmark_name("2nd"));
        assert!(!valid_bookmark_name("a b"));
        assert!(!valid_bookmark_name(""));
        let t = LinkTarget::Email {
            address: "a@b.at".into(),
            subject: Some("Hi there".into()),
        };
        assert_eq!(t.href(), "mailto:a@b.at?subject=Hi%20there");
        assert_eq!(LinkTarget::from_url(&t.href()), t);
        assert_eq!(
            LinkTarget::from_url("https://x.at/?q=1"),
            LinkTarget::Url("https://x.at/?q=1".into())
        );
        assert_eq!(LinkTarget::Bookmark("b".into()).href(), "#b");
        let json = serde_json::to_string(&start(3, "x")).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"bookmarkStart","value":{"id":3,"name":"x"}}"#
        );
        let h = Hyperlink::new(LinkTarget::Url("https://a.at".into()));
        assert_eq!(
            serde_json::to_string(&h).unwrap(),
            r#"{"target":{"kind":"url","value":"https://a.at"}}"#
        );
    }

    #[test]
    fn hyperlink_fields_parse_and_write() {
        let h = Hyperlink::parse_field(r#" HYPERLINK "https://example.com/a b" \o "A \"tip\"" "#)
            .unwrap();
        assert_eq!(h.target, LinkTarget::Url("https://example.com/a b".into()));
        assert_eq!(h.tooltip.as_deref(), Some("A \"tip\""));
        assert!(h.field);
        assert_eq!(
            h.field_instruction(),
            r#"HYPERLINK "https://example.com/a b" \o "A \"tip\"""#
        );
        assert_eq!(Hyperlink::parse_field(&h.field_instruction()), Some(h));
        let b = Hyperlink::parse_field(r#"HYPERLINK \l "_Toc12" \h"#).unwrap();
        assert_eq!(b.target, LinkTarget::Bookmark("_Toc12".into()));
        assert_eq!(b.field_instruction(), r#"HYPERLINK \l "_Toc12""#);
        let both =
            Hyperlink::parse_field(r#"HYPERLINK "doc.docx" \l "intro" \t "_blank""#).unwrap();
        assert_eq!(both.target, LinkTarget::Url("doc.docx#intro".into()));
        let mail = Hyperlink::parse_field("HYPERLINK mailto:a@b.c").unwrap();
        assert!(matches!(mail.target, LinkTarget::Email { .. }));
        assert_eq!(Hyperlink::parse_field("PAGE"), None);
        assert_eq!(Hyperlink::parse_field("HYPERLINK"), None);
        let json = serde_json::to_value(Hyperlink::new(LinkTarget::Url("u".into()))).unwrap();
        assert!(json.get("field").is_none());
    }
}
