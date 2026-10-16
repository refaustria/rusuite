//! Comments (Word's Review › New Comment): threads of remarks anchored to
//! a range of text.
//!
//! A thread is a root [`Comment`] (no `parent`) followed by its replies
//! (`parent` = the root). The root's range is marked in the inline stream
//! by an [`Inline::CommentStart`] and an [`Inline::CommentEnd`] with its id
//! (atoms of one position each, rendered with zero width); replies share
//! the root's range and have no markers of their own. The markers live in
//! the body, notes, headers and footers, never in a comment's content.
//!
//! Invariants (restored by [`Document::fix_comments`], which
//! [`Document::normalize`] runs): every root has exactly one start and,
//! after it in document order, one end marker; markers naming no root are
//! removed; a thread whose markers are both gone (the commented text was
//! deleted) is deleted; a lone start or end gets its partner at the end /
//! start of its paragraph (the range shrinks to what is left); replies
//! point at a root. Ranges may nest and overlap.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::block::{Block, NodeId, Paragraph};
use crate::document::{paragraphs_in, Document};
use crate::inline::Inline;

/// Document-unique id of a [`Comment`]. Serializes as a plain number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct CommentId(#[cfg_attr(feature = "ts", ts(type = "number"))] pub u32);

/// A comment or a reply (docx `w:comment` plus its `w15:commentEx`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Comment {
    /// Id (referenced by the markers and by replies).
    pub id: CommentId,
    /// Author name as written to the file.
    pub author: String,
    /// Author initials (empty = none).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<String>", optional))]
    pub initials: String,
    /// When it was written: an ISO 8601 date-time (`2026-10-16T09:30:00Z`)
    /// as stored in the file; the UI supplies it (the model has no clock).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub date: Option<String>,
    /// The text: paragraphs (with node ids, like note content).
    #[serde(default)]
    pub content: Vec<Block>,
    /// The thread's root for a reply; `None` for a root comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub parent: Option<CommentId>,
    /// Resolved ("done", docx `w15:done`); set on a whole thread.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub resolved: bool,
}

impl Comment {
    /// A root comment with plain-text content (one paragraph per line;
    /// ids allocated from `doc`, paragraph style `style` if given).
    pub fn new(
        doc: &mut Document,
        id: CommentId,
        author: impl Into<String>,
        text: &str,
        style: Option<&str>,
    ) -> Self {
        Self {
            id,
            author: author.into(),
            initials: String::new(),
            date: None,
            content: doc.comment_blocks(text, style),
            parent: None,
            resolved: false,
        }
    }

    /// The text a reader sees: paragraphs joined by `'\n'`.
    pub fn text(&self) -> String {
        paragraphs_in(&self.content)
            .map(Paragraph::display_text)
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Whether this is a reply.
    pub fn is_reply(&self) -> bool {
        self.parent.is_some()
    }
}

/// Where a thread's range lies: the paragraphs and char offsets of its
/// start and end markers (the commented text is between them).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentRange {
    /// The root comment.
    pub id: CommentId,
    /// Paragraph holding the start marker.
    pub start_block: NodeId,
    /// Offset of the start marker in it.
    pub start: usize,
    /// Paragraph holding the end marker.
    pub end_block: NodeId,
    /// Offset of the end marker in it.
    pub end: usize,
}

/// What [`Document::fix_comments`] changed (for undo).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CommentFix {
    /// Paragraphs whose markers changed, with their inlines before.
    pub paragraphs: Vec<(NodeId, Vec<Inline>)>,
    /// All comments before, if comments were deleted or re-parented.
    pub comments: Option<Vec<Comment>>,
}

impl CommentFix {
    /// Whether nothing changed.
    pub fn is_empty(&self) -> bool {
        self.paragraphs.is_empty() && self.comments.is_none()
    }
}

/// The comment id of a marker inline: `(id, is_start)`.
pub fn marker_of(inline: &Inline) -> Option<(CommentId, bool)> {
    match inline {
        Inline::CommentStart { id } => Some((*id, true)),
        Inline::CommentEnd { id } => Some((*id, false)),
        _ => None,
    }
}

/// One marker found in the text: (paragraph, inline index, id, is start).
type Found = (NodeId, usize, CommentId, bool);

impl Document {
    /// The comment with id `id`.
    pub fn comment(&self, id: CommentId) -> Option<&Comment> {
        self.comments.iter().find(|c| c.id == id)
    }

    /// An unused comment id (at least 1).
    pub fn next_comment_id(&self) -> CommentId {
        CommentId(
            self.comments
                .iter()
                .map(|c| c.id.0 + 1)
                .max()
                .unwrap_or(1)
                .max(1),
        )
    }

    /// The root of the thread `id` belongs to (`id` itself for a root).
    pub fn thread_root(&self, id: CommentId) -> CommentId {
        let mut cur = id;
        for _ in 0..64 {
            match self.comment(cur).and_then(|c| c.parent) {
                Some(p) if p != cur => cur = p,
                _ => break,
            }
        }
        cur
    }

    /// The comments of thread `root` in order: the root, then its replies.
    pub fn thread(&self, root: CommentId) -> Vec<&Comment> {
        self.comments
            .iter()
            .filter(|c| c.id == root || c.parent == Some(root))
            .collect()
    }

    /// Paragraphs of comment content for plain `text` (one per line).
    pub fn comment_blocks(&mut self, text: &str, style: Option<&str>) -> Vec<Block> {
        text.split('\n')
            .map(|line| {
                let mut p = Paragraph::with_text(self.alloc_id(), line.trim_end_matches('\r'));
                p.props.style = style.map(str::to_owned);
                Block::Paragraph(p)
            })
            .collect()
    }

    /// The containers that hold text (and comment markers): the body, the
    /// notes, the headers and footers — not the comments' content.
    pub(crate) fn text_containers(&self) -> impl Iterator<Item = &Vec<Block>> {
        std::iter::once(&self.body)
            .chain(self.notes.iter().map(|n| &n.blocks))
            .chain(
                self.sections
                    .iter()
                    .flat_map(|s| s.headers.slots().chain(s.footers.slots()).map(|(_, b)| b)),
            )
    }

    /// The range of every anchored thread, in the order of the start
    /// markers (body, notes, headers and footers). Offsets are char
    /// positions ([`Paragraph::len`]).
    pub fn comment_ranges(&self) -> Vec<CommentRange> {
        let mut starts: Vec<(CommentId, NodeId, usize)> = Vec::new();
        let mut ends: HashMap<CommentId, (NodeId, usize)> = HashMap::new();
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                let mut pos = 0;
                for inline in &p.inlines {
                    match marker_of(inline) {
                        Some((id, true)) => starts.push((id, p.id, pos)),
                        Some((id, false)) => {
                            ends.entry(id).or_insert((p.id, pos));
                        }
                        None => {}
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
            .filter_map(|(id, sb, s)| {
                let (eb, e) = ends.get(&id).copied()?;
                Some(CommentRange {
                    id,
                    start_block: sb,
                    start: s,
                    end_block: eb,
                    end: e,
                })
            })
            .collect()
    }

    /// Restores the comment invariants (see [`crate::comment`]) and
    /// reports what changed.
    pub fn fix_comments(&mut self) -> CommentFix {
        let mut fix = CommentFix::default();
        let before = self.comments.clone();
        let mut comments_changed = false;

        // Replies point at a root; a reply without one becomes a root.
        let ids: HashSet<CommentId> = self.comments.iter().map(|c| c.id).collect();
        let roots_of: Vec<Option<CommentId>> = self
            .comments
            .iter()
            .map(|c| {
                let p = c.parent?;
                if !ids.contains(&p) || p == c.id {
                    return None;
                }
                Some(self.thread_root(p))
            })
            .collect();
        for (c, root) in self.comments.iter_mut().zip(roots_of) {
            let root = root.filter(|r| *r != c.id);
            if c.parent != root {
                c.parent = root;
                comments_changed = true;
            }
        }
        let roots: HashSet<CommentId> = self
            .comments
            .iter()
            .filter(|c| c.parent.is_none())
            .map(|c| c.id)
            .collect();

        // Every marker of the text, in document order.
        let mut found: Vec<Found> = Vec::new();
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                for (i, inline) in p.inlines.iter().enumerate() {
                    if let Some((id, start)) = marker_of(inline) {
                        found.push((p.id, i, id, start));
                    }
                }
            }
        }
        let mut remove: HashSet<(NodeId, usize)> = HashSet::new();
        let mut front: HashMap<NodeId, Vec<Inline>> = HashMap::new();
        let mut back: HashMap<NodeId, Vec<Inline>> = HashMap::new();
        let mut unanchored: HashSet<CommentId> = roots.clone();
        let mut by_id: HashMap<CommentId, Vec<(usize, &Found)>> = HashMap::new();
        for (seq, f) in found.iter().enumerate() {
            if roots.contains(&f.2) {
                by_id.entry(f.2).or_default().push((seq, f));
            } else {
                remove.insert((f.0, f.1));
            }
        }
        for (id, list) in &by_id {
            let start = list.iter().find(|(_, f)| f.3);
            let end = match start {
                Some((s, _)) => list.iter().find(|(seq, f)| !f.3 && seq > s),
                None => list.iter().find(|(_, f)| !f.3),
            };
            for (seq, f) in list {
                let keep =
                    start.is_some_and(|(s, _)| s == seq) || end.is_some_and(|(e, _)| e == seq);
                if !keep {
                    remove.insert((f.0, f.1));
                }
            }
            match (start, end) {
                (Some(_), Some(_)) => {}
                (None, Some((_, f))) => front
                    .entry(f.0)
                    .or_default()
                    .push(Inline::CommentStart { id: *id }),
                (Some((_, f)), None) => back
                    .entry(f.0)
                    .or_default()
                    .push(Inline::CommentEnd { id: *id }),
                (None, None) => continue,
            }
            unanchored.remove(id);
        }

        // Apply the marker changes per paragraph.
        let mut touched: Vec<NodeId> = Vec::new();
        for (pid, _, _, _) in &found {
            if !touched.contains(pid) {
                touched.push(*pid);
            }
        }
        for pid in touched {
            let has_change = remove.iter().any(|(p, _)| *p == pid)
                || front.contains_key(&pid)
                || back.contains_key(&pid);
            if !has_change {
                continue;
            }
            let Some(Block::Paragraph(p)) = self.find_block_mut(pid) else {
                continue;
            };
            let old = p.inlines.clone();
            let mut new: Vec<Inline> = front.remove(&pid).unwrap_or_default();
            new.extend(
                old.iter()
                    .enumerate()
                    .filter(|(i, _)| !remove.contains(&(pid, *i)))
                    .map(|(_, x)| x.clone()),
            );
            new.extend(back.remove(&pid).unwrap_or_default());
            p.inlines = new;
            fix.paragraphs.push((pid, old));
        }

        // Markers inside comment content are dropped.
        for c in &mut self.comments {
            for b in &mut c.content {
                strip_markers(b, &mut comments_changed);
            }
        }

        // Threads without an anchor are deleted.
        if !unanchored.is_empty() {
            self.comments.retain(|c| {
                let root = c.parent.unwrap_or(c.id);
                !unanchored.contains(&root)
            });
            comments_changed = true;
        }
        if comments_changed && self.comments != before {
            fix.comments = Some(before);
        }
        fix
    }
}

fn strip_markers(b: &mut Block, changed: &mut bool) {
    match b {
        Block::Paragraph(p) => {
            let n = p.inlines.len();
            p.inlines.retain(|i| marker_of(i).is_none());
            *changed |= p.inlines.len() != n;
        }
        Block::Table(t) => {
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                for b in &mut cell.blocks {
                    strip_markers(b, changed);
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

    fn start(id: u32) -> Inline {
        Inline::CommentStart { id: CommentId(id) }
    }
    fn end(id: u32) -> Inline {
        Inline::CommentEnd { id: CommentId(id) }
    }
    fn run(t: &str) -> Inline {
        Inline::Run(Run::new(t))
    }

    fn doc_with(paras: Vec<Vec<Inline>>, ids: &[u32]) -> Document {
        let mut doc = Document::new();
        doc.body.clear();
        for inl in paras {
            let mut p = Paragraph::new(doc.alloc_id());
            p.inlines = inl;
            doc.body.push(Block::Paragraph(p));
        }
        for &i in ids {
            let c = Comment::new(&mut doc, CommentId(i), "Ann", "note", None);
            doc.comments.push(c);
        }
        doc
    }

    fn inlines(doc: &Document, i: usize) -> Vec<Inline> {
        doc.body[i].as_paragraph().unwrap().inlines.clone()
    }

    #[test]
    fn ranges_resolve_to_offsets() {
        let doc = doc_with(
            vec![
                vec![run("ab"), start(1), run("cd"), start(2), run("e")],
                vec![run("x"), end(2), end(1)],
            ],
            &[1, 2],
        );
        let r = doc.comment_ranges();
        assert_eq!(r.len(), 2);
        assert_eq!((r[0].id, r[0].start, r[0].end), (CommentId(1), 2, 2));
        assert_eq!((r[1].start, r[1].end), (5, 1));
        assert_eq!(r[0].end_block, doc.body[1].id());
        let p = doc.body[0].as_paragraph().unwrap();
        assert_eq!(p.len(), 7);
        assert_eq!(p.display_text(), "abcde");
    }

    #[test]
    fn fix_is_a_no_op_on_valid_documents() {
        let mut doc = doc_with(vec![vec![start(1), run("a"), end(1)]], &[1]);
        let mut reply = Comment::new(&mut doc, CommentId(2), "Bo", "yes", None);
        reply.parent = Some(CommentId(1));
        doc.comments.push(reply);
        assert!(doc.fix_comments().is_empty());
        assert_eq!(doc.thread(CommentId(1)).len(), 2);
        assert_eq!(doc.thread_root(CommentId(2)), CommentId(1));
    }

    #[test]
    fn unanchored_threads_and_stray_markers_go() {
        let mut doc = doc_with(vec![vec![run("a"), start(9), end(7)]], &[1]);
        let mut reply = Comment::new(&mut doc, CommentId(2), "Bo", "yes", None);
        reply.parent = Some(CommentId(1));
        doc.comments.push(reply);
        let fix = doc.fix_comments();
        assert!(doc.comments.is_empty());
        assert_eq!(fix.comments.as_ref().map(Vec::len), Some(2));
        assert_eq!(inlines(&doc, 0), vec![run("a")]);
        assert_eq!(fix.paragraphs.len(), 1);
    }

    #[test]
    fn lone_markers_get_a_partner_at_the_paragraph_boundary() {
        let mut doc = doc_with(
            vec![vec![run("a"), start(1), run("b")], vec![run("c"), end(2)]],
            &[1, 2],
        );
        doc.fix_comments();
        assert_eq!(inlines(&doc, 0), vec![run("a"), start(1), run("b"), end(1)]);
        assert_eq!(inlines(&doc, 1), vec![start(2), run("c"), end(2)]);
        assert_eq!(doc.comments.len(), 2);
    }

    #[test]
    fn duplicates_keep_the_first_start_and_the_next_end() {
        let mut doc = doc_with(
            vec![vec![
                end(1),
                start(1),
                run("a"),
                end(1),
                start(1),
                run("b"),
                end(1),
            ]],
            &[1],
        );
        doc.fix_comments();
        assert_eq!(inlines(&doc, 0), vec![start(1), run("a"), end(1), run("b")]);
    }

    #[test]
    fn replies_are_reparented_to_the_root() {
        let mut doc = doc_with(vec![vec![start(1), run("a"), end(1)]], &[1]);
        for (id, parent) in [(2, 1), (3, 2), (4, 99)] {
            let mut c = Comment::new(&mut doc, CommentId(id), "Bo", "r", None);
            c.parent = Some(CommentId(parent));
            doc.comments.push(c);
        }
        let fix = doc.fix_comments();
        assert!(fix.comments.is_some());
        let parent = |id| doc.comment(CommentId(id)).unwrap().parent;
        assert_eq!(parent(2), Some(CommentId(1)));
        assert_eq!(parent(3), Some(CommentId(1)));
        // 4 became a root without markers: deleted.
        assert!(doc.comment(CommentId(4)).is_none());
    }

    #[test]
    fn json_shape() {
        let json = serde_json::to_string(&start(3)).unwrap();
        assert_eq!(json, r#"{"kind":"commentStart","value":{"id":3}}"#);
        assert_eq!(serde_json::from_str::<Inline>(&json).unwrap(), start(3));
        let mut doc = Document::new();
        let mut c = Comment::new(&mut doc, CommentId(1), "Ann", "Hi", None);
        c.date = Some("2026-10-16T09:00:00Z".into());
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["author"], "Ann");
        assert!(v.get("resolved").is_none() && v.get("parent").is_none());
        assert_eq!(c.text(), "Hi");
    }
}
