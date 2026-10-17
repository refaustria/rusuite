//! P9-W6: formatted comment content with @mentions and `people.xml`,
//! threads/resolve (`commentsExtended`), comments inside notes and
//! headers, custom note separators, locked fields and the new field
//! switches, TOC switches — written and read back.

use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_text::{
    mention_run, Block, Comment, CommentId, Document, Field, FieldKind, HeaderSlot, Inline, Note,
    NoteKind, NoteRef, NoteSeparator, Paragraph, Person, Run, RunProperties, Toc, TocStyleLevel,
};

fn reread(doc: &Document) -> Document {
    let bytes = fmt_docx::write(doc).unwrap();
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    out.document
}

fn part(bytes: &[u8], name: &str) -> Option<String> {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let name = PartName::new(name).unwrap();
    pkg.part(&name)
        .map(|p| String::from_utf8(p.data.clone()).unwrap())
}

fn bold(text: &str) -> Inline {
    let mut r = Run::new(text);
    r.props.bold = Some(true);
    Inline::Run(r)
}

/// A body paragraph "commented" with comment 1 by Ann holding bold text
/// and an @mention of Bo, plus a reply by Bo, resolved.
fn commented() -> Document {
    let mut doc = Document::new();
    let pid = doc.body[0].id();
    if let Some(Block::Paragraph(p)) = doc.find_block_mut(pid) {
        p.inlines = vec![
            Inline::CommentStart { id: CommentId(1) },
            Inline::Run(Run::new("commented")),
            Inline::CommentEnd { id: CommentId(1) },
        ];
    }
    let mut c = Comment::new(&mut doc, CommentId(1), "Ann Lee", "", None);
    c.initials = "AL".into();
    c.date = Some("2026-10-17T08:00:00Z".into());
    if let Block::Paragraph(p) = &mut c.content[0] {
        p.inlines = vec![
            bold("Check"),
            Inline::Run(Run::new(" this, ")),
            Inline::Run(mention_run("Bo", "bo@example.com")),
        ];
    }
    c.resolved = true;
    doc.comments.push(c);
    let mut r = Comment::new(&mut doc, CommentId(2), "Bo", "Done", None);
    r.parent = Some(CommentId(1));
    r.resolved = true;
    doc.comments.push(r);
    doc.people.push(Person {
        author: "Bo".into(),
        provider_id: Some("AD".into()),
        user_id: Some("bo@example.com".into()),
    });
    doc
}

#[test]
fn formatted_comments_mentions_and_people_round_trip() {
    let doc = commented();
    let bytes = fmt_docx::write(&doc).unwrap();
    let people = part(&bytes, "/word/people.xml").expect("people.xml");
    assert!(people.contains(r#"w15:author="Ann Lee""#), "{people}");
    assert!(people.contains(r#"w15:providerId="None" w15:userId="Ann Lee""#));
    assert!(people.contains(r#"w15:providerId="AD" w15:userId="bo@example.com""#));
    let comments = part(&bytes, "/word/comments.xml").unwrap();
    assert!(comments.contains("<w:b/>"), "{comments}");
    assert!(comments.contains("<w:hyperlink r:id="), "{comments}");
    assert!(comments.contains("@Bo"));
    let ext = part(&bytes, "/word/commentsExtended.xml").unwrap();
    assert!(ext.contains("w15:paraIdParent="), "{ext}");
    assert!(ext.contains(r#"w15:done="1""#));

    let back = reread(&doc);
    assert_eq!(back.people, doc.comment_people());
    let c = back.comment(CommentId(1)).unwrap();
    let p = c.content[0].as_paragraph().unwrap();
    assert_eq!(p.inlines[0].as_run().unwrap().props.bold, Some(true));
    assert_eq!(c.mentions(), ["bo@example.com"]);
    let reply = back.comment(CommentId(2)).unwrap();
    assert_eq!(reply.parent, Some(CommentId(1)));
    assert!(c.resolved && reply.resolved);
    assert_eq!((c.author.as_str(), c.initials.as_str()), ("Ann Lee", "AL"));
    assert_eq!(c.date.as_deref(), Some("2026-10-17T08:00:00Z"));
}

#[test]
fn comments_inside_notes_and_headers_survive() {
    let mut doc = Document::new();
    let body = doc.body[0].id();
    let mut np = Paragraph::new(doc.alloc_id());
    np.inlines = vec![
        Inline::Run(Run::new("A ")),
        Inline::CommentStart { id: CommentId(5) },
        Inline::Run(Run::new("note")),
        Inline::CommentEnd { id: CommentId(5) },
    ];
    doc.notes.push(Note {
        id: 1,
        kind: NoteKind::Foot,
        blocks: vec![Block::Paragraph(np)],
    });
    if let Some(Block::Paragraph(p)) = doc.find_block_mut(body) {
        p.inlines = vec![
            Inline::Run(Run::new("Body")),
            Inline::NoteRef(NoteRef {
                id: 1,
                kind: NoteKind::Foot,
                props: RunProperties::default(),
            }),
        ];
    }
    let mut hp = Paragraph::new(doc.alloc_id());
    hp.inlines = vec![
        Inline::CommentStart { id: CommentId(6) },
        Inline::Run(Run::new("Header")),
        Inline::CommentEnd { id: CommentId(6) },
    ];
    *doc.sections[0].headers.get_mut(HeaderSlot::Default) = Some(vec![Block::Paragraph(hp)]);
    for id in [5, 6] {
        let c = Comment::new(&mut doc, CommentId(id), "Ann", "here", None);
        doc.comments.push(c);
    }
    // In a note the range is written without `w:commentReference` (LibreOffice
    // cannot load one there); the header keeps Word's reference.
    let bytes = fmt_docx::write(&doc).unwrap();
    let notes = part(&bytes, "/word/footnotes.xml").unwrap();
    assert!(notes.contains(r#"<w:commentRangeStart w:id="5"/>"#));
    assert!(notes.contains(r#"<w:commentRangeEnd w:id="5"/>"#));
    assert!(!notes.contains("w:commentReference"), "{notes}");
    let header = part(&bytes, "/word/header1.xml").unwrap();
    assert!(header.contains(r#"<w:commentReference w:id="6"/>"#));
    let back = reread(&doc);
    assert_eq!(back.comments.len(), 2);
    let ranges = back.comment_ranges();
    assert_eq!(ranges.len(), 2);
    let note_para = back.notes[0].blocks[0].id();
    assert!(ranges
        .iter()
        .any(|r| r.id == CommentId(5) && r.start_block == note_para && r.start == 2));
    assert!(ranges.iter().any(|r| r.id == CommentId(6)));
}

#[test]
fn custom_separators_round_trip() {
    let mut doc = Document::new();
    let body = doc.body[0].id();
    let np = Paragraph::with_text(doc.alloc_id(), "n");
    doc.notes.push(Note {
        id: 1,
        kind: NoteKind::Foot,
        blocks: vec![Block::Paragraph(np)],
    });
    if let Some(Block::Paragraph(p)) = doc.find_block_mut(body) {
        p.inlines.push(Inline::NoteRef(NoteRef {
            id: 1,
            kind: NoteKind::Foot,
            props: RunProperties::default(),
        }));
    }
    *doc.separators.get_mut(NoteKind::Foot, true) = NoteSeparator::Text {
        text: "continued from the previous page".into(),
    };
    *doc.separators.get_mut(NoteKind::Foot, false) = NoteSeparator::Text {
        text: String::new(),
    };
    let bytes = fmt_docx::write(&doc).unwrap();
    let notes = part(&bytes, "/word/footnotes.xml").unwrap();
    assert!(notes.contains("continued from the previous page"));
    assert!(!notes.contains("<w:continuationSeparator/>"));
    assert!(!notes.contains("<w:separator/>"));
    let back = reread(&doc);
    assert_eq!(back.separators, doc.separators);
    // Default lines stay default.
    let mut plain = doc.clone();
    plain.separators = Default::default();
    assert!(reread(&plain).separators.is_default());
}

#[test]
fn locked_fields_and_new_switches_round_trip() {
    let mut doc = Document::new();
    let body = doc.body[0].id();
    let mut seq = Field::new(FieldKind::Seq {
        identifier: "Figure".into(),
        format: None,
        reset: None,
        current: true,
        hidden: false,
        heading_reset: Some(1),
    });
    seq.locked = true;
    seq.cached = "4".into();
    let fields = vec![
        Inline::Field(seq),
        Inline::Field(Field::new(FieldKind::SectionPages)),
        Inline::Field(Field::new(FieldKind::StyleRef {
            style: "Heading 1".into(),
            last: true,
            number: false,
        })),
        Inline::Field(Field::new(FieldKind::Ref {
            bookmark: "x".into(),
            hyperlink: true,
            number: false,
            relative: true,
            full: false,
            position: true,
        })),
    ];
    if let Some(Block::Paragraph(p)) = doc.find_block_mut(body) {
        p.inlines = fields.clone();
    }
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = part(&bytes, "/word/document.xml").unwrap();
    assert!(xml.contains(r#"w:fldLock="1""#), "{xml}");
    assert!(
        xml.contains(r#"STYLEREF &quot;Heading 1&quot; \l"#),
        "{xml}"
    );
    let back = fmt_docx::read(&bytes).unwrap();
    let got = &back.body[0].as_paragraph().unwrap().inlines;
    assert_eq!(got, &fields);
    // Complex fields with fldLock on `begin` are read as locked too.
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
}

#[test]
fn toc_switches_round_trip() {
    let mut doc = Document::new();
    doc.body.clear();
    let mut h = Paragraph::with_text(doc.alloc_id(), "Intro");
    h.props.style = Some("Heading1".into());
    let mut toc = Toc::new(doc.alloc_id());
    toc.switches.no_links = true;
    toc.switches.omit_pages = Some([1, 1]);
    toc.switches.styles.push(TocStyleLevel {
        style: "Title".into(),
        level: 1,
    });
    doc.body.push(Block::Toc(toc.clone()));
    doc.body.push(Block::Paragraph(h));
    let entries = doc.toc_entries(&toc);
    if let Block::Toc(t) = &mut doc.body[0] {
        t.entries = entries;
    }
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = part(&bytes, "/word/document.xml").unwrap();
    assert!(xml.contains(r#"\t "Title,1" \z \u \n "1-1""#), "{xml}");
    assert!(!xml.contains("w:anchor=\"_Toc"), "no links: {xml}");
    let back = fmt_docx::read(&bytes).unwrap();
    let Block::Toc(t) = &back.body[0] else {
        panic!("toc expected")
    };
    assert_eq!(t.switches, toc.switches);
    assert_eq!(t.entries.len(), 1);
}
