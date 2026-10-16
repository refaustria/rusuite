//! P8-25 comments: add / reply / edit / resolve / delete, the range
//! invariants under edits, find across markers, `.docx` round trips and
//! undo/redo identity of every command.

use app_common::Host;
use model_text::{Block, CommentId, Document, Inline, NodeId, Paragraph, Run};
use serde_json::Value as Json;
use write_core::{
    dispatch_with, CommentPoint, FindQuery, NewBlock, NewParagraph, WriteCommand as C,
    WriteDocument, WriteHost, WritePatch,
};

fn host(texts: &[&str]) -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    for (i, t) in texts.iter().enumerate() {
        let id = NodeId(i as u64 + 1);
        doc.reserve_id(id);
        doc.body.push(Block::Paragraph(Paragraph::with_text(id, t)));
    }
    Host::new(WriteDocument::from_document(doc).unwrap())
}

fn json_of(h: &WriteHost) -> Json {
    serde_json::to_value(h.doc().document()).unwrap()
}

fn doc(h: &WriteHost) -> &Document {
    h.doc().document()
}

/// Applies `cmd`, checks undo → before and redo → after.
fn apply(h: &mut WriteHost, cmd: C) -> WritePatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn pt(block: u64, offset: u32) -> CommentPoint {
    CommentPoint {
        block: NodeId(block),
        offset,
    }
}

fn add(h: &mut WriteHost, start: CommentPoint, end: CommentPoint, text: &str) -> CommentId {
    let patch = apply(
        h,
        C::AddComment {
            start,
            end,
            text: text.into(),
            author: None,
            initials: None,
            date: Some("2026-10-16T09:30:00Z".into()),
        },
    );
    patch
        .comments
        .expect("comments in the patch")
        .last()
        .unwrap()
        .id
}

fn text(h: &WriteHost, block: u64) -> String {
    doc(h).find_paragraph(NodeId(block)).unwrap().text()
}

const M: char = '\u{FEFF}';

fn marked(s: &str) -> String {
    s.replace('|', &M.to_string())
}

#[test]
fn add_comment_marks_the_range_and_uses_the_user() {
    let mut h = host(&["Hello brave world"]);
    let reply = dispatch_with(&mut h, r#"{"type":"setUser","name":"Anna Berg"}"#);
    assert!(reply.contains(r#""type":"documentState""#), "{reply}");
    assert!(!h.is_dirty());
    let patch = apply(
        &mut h,
        C::AddComment {
            start: pt(1, 6),
            end: pt(1, 11),
            text: "Too bold?\nSecond line".into(),
            author: None,
            initials: None,
            date: Some("2026-10-16T09:30:00Z".into()),
        },
    );
    assert_eq!(text(&h, 1), marked("Hello |brave| world"));
    let c = &doc(&h).comments[0];
    assert_eq!(
        (c.author.as_str(), c.initials.as_str()),
        ("Anna Berg", "AB")
    );
    assert_eq!(c.date.as_deref(), Some("2026-10-16T09:30:00Z"));
    assert_eq!(c.text(), "Too bold?\nSecond line");
    assert_eq!(c.content.len(), 2);
    assert!(patch.styles.is_some(), "comment styles added");
    assert!(doc(&h).styles.get("CommentText").is_some());
    assert_eq!(patch.replaced.len(), 1);
    let r = doc(&h).comment_ranges();
    assert_eq!((r[0].start, r[0].end), (6, 12));
    // Without a user: "Author".
    let mut h2 = host(&["x"]);
    add(&mut h2, pt(1, 0), pt(1, 1), "n");
    assert_eq!(doc(&h2).comments[0].author, "Author");
}

#[test]
fn ranges_across_paragraphs_and_errors() {
    let mut h = host(&["one", "two", "three"]);
    let id = add(&mut h, pt(1, 1), pt(3, 2), "span");
    assert_eq!(text(&h, 1), marked("o|ne"));
    assert_eq!(text(&h, 3), marked("th|ree"));
    let r = doc(&h).comment_ranges();
    assert_eq!(r[0].id, id);
    assert_eq!((r[0].start_block, r[0].end_block), (NodeId(1), NodeId(3)));
    let before = json_of(&h);
    let bad = [
        C::AddComment {
            start: pt(3, 0),
            end: pt(1, 0),
            text: "x".into(),
            author: None,
            initials: None,
            date: None,
        },
        C::AddComment {
            start: pt(1, 0),
            end: pt(1, 99),
            text: "x".into(),
            author: None,
            initials: None,
            date: None,
        },
        C::ReplyComment {
            parent: CommentId(77),
            text: "x".into(),
            author: None,
            initials: None,
            date: None,
        },
        C::ResolveComment { id: CommentId(77) },
        C::DeleteComment { id: CommentId(77) },
    ];
    for cmd in bad {
        assert!(h.apply(cmd).is_err());
    }
    assert_eq!(json_of(&h), before);
}

#[test]
fn replies_edit_resolve_reopen() {
    let mut h = host(&["Text here"]);
    let root = add(&mut h, pt(1, 0), pt(1, 4), "Root");
    let patch = apply(
        &mut h,
        C::ReplyComment {
            parent: root,
            text: "A reply".into(),
            author: Some("Ben Cole".into()),
            initials: None,
            date: Some("2026-10-16T10:00:00Z".into()),
        },
    );
    let comments = patch.comments.unwrap();
    let reply = comments.last().unwrap();
    assert_eq!(reply.parent, Some(root));
    assert_eq!(reply.initials, "BC");
    let reply = reply.id;
    // A reply to a reply goes to the thread.
    apply(
        &mut h,
        C::ReplyComment {
            parent: reply,
            text: "Third".into(),
            author: None,
            initials: None,
            date: None,
        },
    );
    assert_eq!(doc(&h).thread(root).len(), 3);
    assert!(doc(&h)
        .comments
        .iter()
        .all(|c| c.id == root || c.parent == Some(root)));
    apply(
        &mut h,
        C::EditComment {
            id: reply,
            text: "Edited".into(),
        },
    );
    assert_eq!(doc(&h).comment(reply).unwrap().text(), "Edited");
    apply(&mut h, C::ResolveComment { id: reply });
    assert!(doc(&h).comments.iter().all(|c| c.resolved));
    apply(&mut h, C::ReopenComment { id: root });
    assert!(doc(&h).comments.iter().all(|c| !c.resolved));
    // Deleting a reply keeps the thread and the markers.
    apply(&mut h, C::DeleteComment { id: reply });
    assert_eq!(doc(&h).thread(root).len(), 2);
    assert_eq!(text(&h, 1), marked("|Text| here"));
    // Deleting the root deletes the thread and its markers.
    let patch = apply(&mut h, C::DeleteComment { id: root });
    assert!(doc(&h).comments.is_empty());
    assert_eq!(patch.comments, Some(vec![]));
    assert_eq!(text(&h, 1), "Text here");
}

#[test]
fn delete_all_and_delete_all_resolved() {
    let mut h = host(&["aaa bbb ccc"]);
    let a = add(&mut h, pt(1, 0), pt(1, 3), "A");
    let b = add(&mut h, pt(1, 5), pt(1, 8), "B");
    apply(&mut h, C::ResolveComment { id: b });
    apply(
        &mut h,
        C::DeleteAllComments {
            resolved_only: true,
        },
    );
    assert_eq!(doc(&h).comments.len(), 1);
    assert_eq!(doc(&h).comments[0].id, a);
    assert_eq!(text(&h, 1), marked("|aaa| bbb ccc"));
    apply(
        &mut h,
        C::DeleteAllComments {
            resolved_only: false,
        },
    );
    assert!(doc(&h).comments.is_empty());
    assert_eq!(text(&h, 1), "aaa bbb ccc");
}

#[test]
fn deleting_the_whole_range_deletes_the_comment() {
    let mut h = host(&["keep gone keep"]);
    add(&mut h, pt(1, 5), pt(1, 10), "bye");
    // "gone " with both markers: offsets 5..12.
    assert_eq!(text(&h, 1), marked("keep |gone |keep"));
    let patch = apply(
        &mut h,
        C::DeleteText {
            block: NodeId(1),
            from: 5,
            to: 12,
        },
    );
    assert_eq!(text(&h, 1), "keep keep");
    assert!(doc(&h).comments.is_empty());
    assert_eq!(patch.comments, Some(vec![]));
}

#[test]
fn partial_deletes_shrink_the_range() {
    let mut h = host(&["abc defgh ijk"]);
    // Range "defgh": start at 4, end after it (positions 4..10 with markers).
    add(&mut h, pt(1, 4), pt(1, 9), "c");
    assert_eq!(text(&h, 1), marked("abc |defgh| ijk"));
    // Delete "c de" (offsets 2..7 = "c", " ", start, "d", "e").
    apply(
        &mut h,
        C::DeleteText {
            block: NodeId(1),
            from: 2,
            to: 7,
        },
    );
    assert_eq!(text(&h, 1), marked("ab|fgh| ijk"));
    assert_eq!(doc(&h).comments.len(), 1);
    // Replace "h| i" (end inside) with "X": the end comes before the new text.
    apply(
        &mut h,
        C::ReplaceText {
            block: NodeId(1),
            from: 5,
            to: 9,
            text: "X".into(),
        },
    );
    assert_eq!(text(&h, 1), marked("ab|fg|Xjk"));
    let r = doc(&h).comment_ranges();
    assert_eq!((r[0].start, r[0].end), (2, 5));
    // Typing inside the range extends it, typing after the end does not.
    apply(
        &mut h,
        C::InsertText {
            block: NodeId(1),
            offset: 4,
            text: "+".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    assert_eq!(text(&h, 1), marked("ab|f+g|Xjk"));
}

#[test]
fn deleting_a_paragraph_moves_the_lone_marker() {
    let mut h = host(&["one", "two", "three"]);
    add(&mut h, pt(1, 1), pt(3, 2), "span");
    apply(
        &mut h,
        C::DeleteBlocks {
            ids: vec![NodeId(1)],
        },
    );
    assert_eq!(text(&h, 3), marked("|th|ree"));
    assert_eq!(doc(&h).comments.len(), 1);
    // Paste of commented text (markers duplicated): the copy loses them.
    let dup = doc(&h).find_paragraph(NodeId(3)).unwrap().inlines.clone();
    apply(
        &mut h,
        C::InsertBlocks {
            after: Some(NodeId(3)),
            parent: None,
            blocks: vec![NewBlock::Paragraph(NewParagraph {
                id: -1,
                props: Default::default(),
                inlines: dup,
            })],
        },
    );
    let last = doc(&h).body.last().unwrap().as_paragraph().unwrap();
    assert_eq!(last.text(), "three");
    assert_eq!(text(&h, 3), marked("|th|ree"));
}

#[test]
fn replace_blocks_without_the_markers_deletes_the_comment() {
    let mut h = host(&["alpha"]);
    add(&mut h, pt(1, 0), pt(1, 5), "c");
    apply(
        &mut h,
        C::ReplaceBlocks {
            ids: vec![NodeId(1)],
            blocks: vec![NewBlock::Paragraph(NewParagraph {
                id: 1,
                props: Default::default(),
                inlines: vec![Inline::Run(Run::new("beta"))],
            })],
        },
    );
    assert!(doc(&h).comments.is_empty());
}

#[test]
fn find_and_replace_see_through_markers() {
    let mut h = host(&["the quick fox"]);
    add(&mut h, pt(1, 4), pt(1, 9), "q");
    let q = FindQuery {
        text: "the quick fox".into(),
        match_case: false,
        whole_word: false,
        wildcards: false,
        format: None,
    };
    let m = h.doc().find(&q).unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!((m[0].from, m[0].to), (0, 15));
    apply(
        &mut h,
        C::FindReplace {
            find: "quick".into(),
            replace: "slow".into(),
            match_case: false,
            whole_word: false,
            all: true,
            wildcards: false,
            format: None,
            replace_format: None,
        },
    );
    assert_eq!(text(&h, 1), marked("the |slow| fox"));
    assert_eq!(doc(&h).comments.len(), 1);
    assert_eq!(doc(&h).word_count(), 3);
}

#[test]
fn docx_round_trip_keeps_threads() {
    let mut h = host(&["First paragraph", "Second one"]);
    let dispatch = dispatch_with(
        &mut h,
        r#"{"type":"setUser","name":"Anna Berg","initials":"AnB"}"#,
    );
    assert!(dispatch.contains("documentState"));
    let root = add(&mut h, pt(1, 6), pt(2, 6), "Spans two");
    apply(
        &mut h,
        C::ReplyComment {
            parent: root,
            text: "Agreed".into(),
            author: Some("Ben".into()),
            initials: Some("B".into()),
            date: Some("2026-10-16T11:00:00Z".into()),
        },
    );
    let point = add(&mut h, pt(1, 0), pt(1, 0), "At the start");
    apply(&mut h, C::ResolveComment { id: point });
    let bytes = h.doc().save_docx().unwrap();
    let (back, warnings) = WriteDocument::open_docx(&bytes, "c.docx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let back = back.into_document();
    type Row = (
        u32,
        String,
        String,
        Option<String>,
        String,
        Option<u32>,
        bool,
    );
    let summary = |d: &Document| -> Vec<Row> {
        d.comments
            .iter()
            .map(|c| {
                (
                    c.id.0,
                    c.author.clone(),
                    c.initials.clone(),
                    c.date.clone(),
                    c.text(),
                    c.parent.map(|p| p.0),
                    c.resolved,
                )
            })
            .collect()
    };
    assert_eq!(summary(&back), summary(doc(&h)));
    let ranges = |d: &Document| {
        d.comment_ranges()
            .iter()
            .map(|r| (r.id, r.start, r.end))
            .collect::<Vec<_>>()
    };
    assert_eq!(ranges(&back), ranges(doc(&h)));
    assert_eq!(back.plain_text(), doc(&h).plain_text());
}

#[test]
fn set_user_survives_open_and_new() {
    let mut h = host(&["x"]);
    dispatch_with(&mut h, r#"{"type":"setUser","name":"Zoe Q"}"#);
    dispatch_with(&mut h, r#"{"type":"newDocument"}"#);
    let user = h.doc().user.clone().unwrap();
    assert_eq!(
        (user.name.as_str(), user.initials.as_str()),
        ("Zoe Q", "ZQ")
    );
    dispatch_with(&mut h, r#"{"type":"setUser","name":""}"#);
    assert!(h.doc().user.is_none());
}
