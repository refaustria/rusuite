//! P9-W6: formatted comments with @mentions, comments in notes and
//! headers, note run normalisation and split/join, Convert Notes,
//! separators, locked fields and the one-step field update (TOC, SEQ,
//! STYLEREF) — each with undo/redo identity.

use std::collections::HashMap;

use app_common::Host;
use model_text::{
    mention_run, Block, CommentId, Document, Field, FieldKind, HeaderSlot, Inline, NodeId, Note,
    NoteKind, NoteRef, NoteSeparator, NoteSeparators, Paragraph, Run, RunProperties, Toc,
    MENTION_STYLE,
};
use serde_json::Value as Json;
use write_core::{
    CommentPoint, FieldRefresh, NewBlock, NewParagraph, WriteCommand as C, WriteDocument,
    WriteHost, WritePatch,
};

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
    h.undo()
        .unwrap_or_else(|e| panic!("undo of {cmd:?}: {e:?}"))
        .unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn pt(block: NodeId, offset: u32) -> CommentPoint {
    CommentPoint { block, offset }
}

/// Body "Hello world" (id 1) with footnote 1 ("Note text", paragraph 10)
/// referenced at its end, and a default header "Head" (paragraph 20).
fn host() -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    for id in [1, 10, 20] {
        doc.reserve_id(NodeId(id));
    }
    let mut p = Paragraph::with_text(NodeId(1), "Hello world");
    p.inlines.push(Inline::NoteRef(NoteRef {
        id: 1,
        kind: NoteKind::Foot,
        props: RunProperties::default(),
    }));
    doc.body.push(Block::Paragraph(p));
    doc.notes.push(Note {
        id: 1,
        kind: NoteKind::Foot,
        blocks: vec![Block::Paragraph(Paragraph::with_text(
            NodeId(10),
            "Note text",
        ))],
    });
    doc.sync_sections();
    *doc.sections[0].headers.get_mut(HeaderSlot::Default) = Some(vec![Block::Paragraph(
        Paragraph::with_text(NodeId(20), "Head"),
    )]);
    Host::new(WriteDocument::from_document(doc).unwrap())
}

fn content(inlines: Vec<Inline>) -> Vec<NewBlock> {
    vec![NewBlock::Paragraph(NewParagraph {
        id: -1,
        props: Default::default(),
        inlines,
    })]
}

fn bold(t: &str) -> Inline {
    let mut r = Run::new(t);
    r.props.bold = Some(true);
    Inline::Run(r)
}

#[test]
fn formatted_comments_with_mentions() {
    let mut h = host();
    let patch = apply(
        &mut h,
        C::AddComment {
            start: pt(NodeId(1), 0),
            end: pt(NodeId(1), 5),
            text: String::new(),
            content: Some(content(vec![
                bold("Fix"),
                Inline::Run(Run::new(" it ")),
                Inline::Run(Run::new(" now")),
                Inline::Run(mention_run("Bo", "bo@example.com")),
            ])),
            author: Some("Ann".into()),
            initials: None,
            date: Some("2026-10-17T10:00:00Z".into()),
        },
    );
    let c = patch.comments.unwrap().last().cloned().unwrap();
    let p = c.content[0].as_paragraph().unwrap();
    // Runs of one format are merged; ids are real; CommentText applied.
    assert_eq!(p.inlines.len(), 3);
    assert!(p.id.0 > 0);
    assert_eq!(p.props.style.as_deref(), Some("CommentText"));
    assert_eq!(c.mentions(), ["bo@example.com"]);
    assert_eq!(c.initials, "A");
    assert!(doc(&h).styles.get(MENTION_STYLE).is_some());
    // Edit with new formatted content, then a formatted reply.
    apply(
        &mut h,
        C::EditComment {
            id: c.id,
            text: String::new(),
            content: Some(content(vec![bold("Bold only")])),
        },
    );
    assert_eq!(doc(&h).comment(c.id).unwrap().text(), "Bold only");
    let patch = apply(
        &mut h,
        C::ReplyComment {
            parent: c.id,
            text: String::new(),
            content: Some(content(vec![Inline::Run(mention_run(
                "Ann",
                "ann@example.com",
            ))])),
            author: Some("Bo".into()),
            initials: None,
            date: None,
        },
    );
    let reply = patch.comments.unwrap().last().cloned().unwrap();
    assert_eq!(reply.parent, Some(c.id));
    assert_eq!(reply.text(), "@Ann");
    // Resolve marks the thread.
    apply(&mut h, C::ResolveComment { id: reply.id });
    assert!(doc(&h).thread(c.id).iter().all(|c| c.resolved));
    // People follow the authors.
    let people = doc(&h).comment_people();
    assert_eq!(people.len(), 2);
    // Content must be paragraphs.
    let err = h.apply(C::EditComment {
        id: c.id,
        text: String::new(),
        content: Some(vec![NewBlock::Toc(write_core::NewToc::from(&Toc::new(
            NodeId(99),
        )))]),
    });
    assert!(err.is_err());
}

#[test]
fn comments_in_notes_and_headers() {
    let mut h = host();
    for (block, to) in [(NodeId(10), 4), (NodeId(20), 4)] {
        apply(
            &mut h,
            C::AddComment {
                start: pt(block, 0),
                end: pt(block, to),
                text: "here".into(),
                content: None,
                author: None,
                initials: None,
                date: None,
            },
        );
    }
    let ranges = doc(&h).comment_ranges();
    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[0].start_block, NodeId(10));
    assert_eq!(ranges[1].start_block, NodeId(20));
    // A range spanning two stories is refused.
    assert!(h
        .apply(C::AddComment {
            start: pt(NodeId(1), 0),
            end: pt(NodeId(10), 2),
            text: "x".into(),
            content: None,
            author: None,
            initials: None,
            date: None,
        })
        .is_err());
    // Survives a save and reopen.
    let bytes = fmt_docx::write(doc(&h)).unwrap();
    let back = fmt_docx::read(&bytes).unwrap();
    assert_eq!(back.comment_ranges().len(), 2);
    assert_eq!(back.comments.len(), 2);
    let _ = CommentId(1);
}

#[test]
fn note_paragraphs_are_normalised_split_and_joined() {
    let mut h = host();
    // Typing three characters: one run, not three.
    for (i, ch) in ["a", "b", "c"].iter().enumerate() {
        h.apply(C::InsertText {
            block: NodeId(10),
            offset: 9 + i as u32,
            text: (*ch).into(),
            props: None,
            style: None,
            link: None,
        })
        .unwrap();
    }
    let note = &doc(&h).notes[0];
    let p = note.blocks[0].as_paragraph().unwrap();
    assert_eq!(p.inlines.len(), 1, "{:?}", p.inlines);
    assert_eq!(p.display_text(), "Note textabc");
    // ReplaceNote with one run per character is merged.
    let chars: Vec<Inline> = "xyz".chars().map(|c| Inline::Run(Run::new(c))).collect();
    apply(
        &mut h,
        C::ReplaceNote {
            id: 1,
            blocks: content(chars),
        },
    );
    let p = doc(&h).notes[0].blocks[0].as_paragraph().unwrap();
    assert_eq!(p.inlines, vec![Inline::Run(Run::new("xyz"))]);
    let pid = p.id;
    // Split (Enter) and join (Backspace) inside the note.
    let patch = apply(
        &mut h,
        C::SplitParagraph {
            block: pid,
            offset: 1,
            new_id: -5,
        },
    );
    assert!(patch.notes.is_some());
    assert_eq!(doc(&h).notes[0].blocks.len(), 2);
    let second = doc(&h).notes[0].blocks[1].id();
    apply(&mut h, C::JoinWithPrevious { block: second });
    assert_eq!(doc(&h).notes[0].blocks.len(), 1);
    // The same in the header.
    apply(
        &mut h,
        C::SplitParagraph {
            block: NodeId(20),
            offset: 2,
            new_id: -6,
        },
    );
    let hf = doc(&h).sections[0]
        .headers
        .get(HeaderSlot::Default)
        .unwrap();
    assert_eq!(hf.len(), 2);
}

#[test]
fn convert_notes_all_and_selected() {
    let mut h = host();
    let patch = apply(
        &mut h,
        C::ConvertNotes {
            ids: None,
            to: NoteKind::End,
        },
    );
    assert!(patch.notes.is_some());
    assert_eq!(doc(&h).notes[0].kind, NoteKind::End);
    let refs: Vec<NoteKind> = doc(&h).body[0]
        .as_paragraph()
        .unwrap()
        .inlines
        .iter()
        .filter_map(|i| match i {
            Inline::NoteRef(r) => Some(r.kind),
            _ => None,
        })
        .collect();
    assert_eq!(refs, [NoteKind::End]);
    assert!(doc(&h).styles.get("EndnoteText").is_some());
    apply(
        &mut h,
        C::ConvertNotes {
            ids: Some(vec![1]),
            to: NoteKind::Foot,
        },
    );
    assert_eq!(doc(&h).notes[0].kind, NoteKind::Foot);
}

#[test]
fn separators_are_set_and_undone() {
    let mut h = host();
    let seps = NoteSeparators {
        footnote_continuation: NoteSeparator::Text {
            text: "(continued)".into(),
        },
        ..Default::default()
    };
    let patch = apply(
        &mut h,
        C::SetNoteSeparators {
            separators: seps.clone(),
        },
    );
    assert_eq!(patch.separators, Some(seps.clone()));
    assert_eq!(doc(&h).separators, seps);
}

fn field(kind: FieldKind) -> Inline {
    Inline::Field(Field::new(kind))
}

#[test]
fn locked_fields_and_one_step_update() {
    let mut doc0 = Document::new();
    doc0.body.clear();
    for id in 1..=6 {
        doc0.reserve_id(NodeId(id));
    }
    let mut h1 = Paragraph::with_text(NodeId(1), "Intro");
    h1.props.style = Some("Heading1".into());
    let seq = || {
        field(FieldKind::Seq {
            identifier: "Figure".into(),
            format: None,
            reset: None,
            current: false,
            hidden: false,
            heading_reset: None,
        })
    };
    let mut p2 = Paragraph::new(NodeId(2));
    p2.inlines = vec![seq(), seq()];
    let mut p3 = Paragraph::new(NodeId(3));
    p3.inlines = vec![field(FieldKind::StyleRef {
        style: "Heading 1".into(),
        last: false,
        number: false,
    })];
    doc0.body.push(Block::Toc(Toc::new(NodeId(4))));
    doc0.body.push(Block::Paragraph(h1));
    doc0.body.push(Block::Paragraph(p2));
    doc0.body.push(Block::Paragraph(p3));
    let mut h = Host::new(WriteDocument::from_document(doc0).unwrap());
    // Lock the second paragraph's fields.
    apply(
        &mut h,
        C::LockFields {
            blocks: Some(vec![NodeId(2)]),
            locked: true,
        },
    );
    let refresh = FieldRefresh {
        pages: vec![(NodeId(1), 2)],
        blocks: None,
    };
    apply(
        &mut h,
        C::UpdateFields {
            values: vec![],
            refresh: Some(refresh.clone()),
        },
    );
    let d = doc(&h);
    let cached = |id: u64| -> Vec<String> {
        d.find_paragraph(NodeId(id))
            .unwrap()
            .inlines
            .iter()
            .filter_map(|i| match i {
                Inline::Field(f) => Some(f.cached.clone()),
                _ => None,
            })
            .collect()
    };
    assert_eq!(cached(2), ["", ""], "locked fields keep their result");
    assert_eq!(cached(3), ["Intro"]);
    let Some(Block::Toc(t)) = d.find_block(NodeId(4)) else {
        panic!("toc")
    };
    assert_eq!(t.entries.len(), 1);
    assert_eq!(t.entries[0].page, Some(2));
    // One undo step restores fields and TOC together.
    h.undo().unwrap().unwrap();
    let Some(Block::Toc(t)) = doc(&h).find_block(NodeId(4)) else {
        panic!("toc")
    };
    assert!(t.entries.is_empty());
    assert_eq!(doc(&h).find_paragraph(NodeId(3)).unwrap().inlines.len(), 1);
    // Unlocked, the sequence counts.
    h.redo().unwrap().unwrap();
    apply(
        &mut h,
        C::LockFields {
            blocks: None,
            locked: false,
        },
    );
    apply(
        &mut h,
        C::UpdateFields {
            values: vec![],
            refresh: Some(refresh),
        },
    );
    let values: HashMap<usize, String> = doc(&h)
        .find_paragraph(NodeId(2))
        .unwrap()
        .inlines
        .iter()
        .enumerate()
        .filter_map(|(i, x)| match x {
            Inline::Field(f) => Some((i, f.cached.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(values[&0], "1");
    assert_eq!(values[&1], "2");
}
