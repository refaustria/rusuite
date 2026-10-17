//! P9-W6: comment people and mentions, note conversion and separators,
//! TOC switches.

use model_text::{
    mention_run, Block, Comment, CommentId, Document, Inline, NoteKind, NoteRef, NoteSeparator,
    Paragraph, Person, RunProperties, Toc, TocStyleLevel, TocSwitches,
};

fn para(doc: &mut Document, text: &str, style: Option<&str>) -> Block {
    let mut p = Paragraph::with_text(doc.alloc_id(), text);
    p.props.style = style.map(str::to_owned);
    Block::Paragraph(p)
}

#[test]
fn people_follow_the_comment_authors() {
    let mut doc = Document::new();
    let mut c = Comment::new(&mut doc, CommentId(1), "Ann Lee", "Hi", None);
    if let Block::Paragraph(p) = &mut c.content[0] {
        p.inlines
            .push(Inline::Run(mention_run("Bo", "bo@example.com")));
        p.inlines
            .push(Inline::Run(mention_run("Bo", "BO@example.com")));
    }
    doc.comments.push(c);
    let c2 = Comment::new(&mut doc, CommentId(2), "Bo", "ok", None);
    doc.comments.push(c2);
    doc.people.push(Person {
        author: "Bo".into(),
        provider_id: Some("AD".into()),
        user_id: Some("bo@example.com".into()),
    });
    doc.people.push(Person::local("Gone"));
    let people = doc.comment_people();
    assert_eq!(people.len(), 2);
    assert_eq!(people[0], Person::local("Ann Lee"));
    assert_eq!(people[1].provider_id.as_deref(), Some("AD"));
    assert_eq!(people[1].email(), Some("bo@example.com"));
    assert_eq!(doc.comments[0].mentions(), ["bo@example.com"]);
    assert_eq!(doc.comments[0].text(), "Hi@Bo@Bo");
    let json = serde_json::to_value(&doc).unwrap();
    assert_eq!(json["people"][0]["providerId"], "AD");
    let back = Document::from_json(&json.to_string()).unwrap();
    assert_eq!(back.people, doc.people);
}

#[test]
fn notes_convert_both_ways() {
    let mut doc = Document::new();
    let body_id = doc.body[0].id();
    for (id, kind) in [(1, NoteKind::Foot), (2, NoteKind::Foot), (3, NoteKind::End)] {
        let b = para(&mut doc, "n", Some("FootnoteText"));
        doc.notes.push(model_text::Note {
            id,
            kind,
            blocks: vec![b],
        });
        if let Some(Block::Paragraph(p)) = doc.find_block_mut(body_id) {
            p.inlines.push(Inline::NoteRef(NoteRef {
                id,
                kind,
                props: RunProperties::default(),
            }));
        }
    }
    // All footnotes → endnotes.
    assert_eq!(doc.convert_notes(None, NoteKind::End), [1, 2]);
    assert!(doc.notes.iter().all(|n| n.kind == NoteKind::End));
    let kinds: Vec<NoteKind> = doc.body[0]
        .as_paragraph()
        .unwrap()
        .inlines
        .iter()
        .filter_map(|i| match i {
            Inline::NoteRef(r) => Some(r.kind),
            _ => None,
        })
        .collect();
    assert_eq!(kinds, [NoteKind::End; 3]);
    // Selected back; the text style follows when the document has it.
    assert_eq!(doc.convert_notes(Some(&[3]), NoteKind::Foot), [3]);
    assert_eq!(doc.notes[2].kind, NoteKind::Foot);
    assert!(doc.convert_notes(Some(&[3]), NoteKind::Foot).is_empty());
    // Numbering: footnote 3 is now footnote 1.
    assert_eq!(doc.note_numbers()[&3], "1");
}

#[test]
fn separators_default_to_lines() {
    let mut doc = Document::new();
    assert!(doc.separators.is_default());
    *doc.separators.get_mut(NoteKind::Foot, true) = NoteSeparator::Text {
        text: "continued".into(),
    };
    assert!(doc.separators.get(NoteKind::Foot, false).is_line());
    let json = serde_json::to_value(&doc).unwrap();
    assert_eq!(
        json["separators"]["footnoteContinuation"]["value"]["text"],
        "continued"
    );
    assert!(json["separators"].get("footnote").is_none());
    let back = Document::from_json(&json.to_string()).unwrap();
    assert_eq!(back.separators, doc.separators);
}

#[test]
fn toc_switches_parse_write_and_build() {
    let s = TocSwitches::parse(r#" TOC \o "1-3" \h \z \u "#);
    assert!(s.is_default());
    let s = TocSwitches::parse(r#"TOC \t "Title,1,Quote,2" \n "2-3" \h"#);
    assert!(s.no_headings && s.no_hide_web && s.no_outline_levels && !s.no_links);
    assert_eq!(s.omit_pages, Some([2, 3]));
    assert_eq!(
        s.styles,
        [
            TocStyleLevel {
                style: "Title".into(),
                level: 1
            },
            TocStyleLevel {
                style: "Quote".into(),
                level: 2
            }
        ]
    );
    assert!(s.shows_page(1) && !s.shows_page(2));
    assert_eq!(TocSwitches::parse(&format!("TOC{}", s.instruction())), s);
    assert_eq!(TocSwitches::parse(r"TOC \o \n").omit_pages, Some([1, 9]));

    let mut doc = Document::new();
    doc.body.clear();
    let blocks = vec![
        para(&mut doc, "Cover", Some("Title")),
        para(&mut doc, "One", Some("Heading1")),
        para(&mut doc, "Note", None),
    ];
    doc.body = blocks;
    if let Block::Paragraph(p) = &mut doc.body[2] {
        p.props.outline_level = Some(1);
    }
    let mut t = Toc::new(doc.alloc_id());
    let texts = |doc: &Document, t: &Toc| -> Vec<(String, u8)> {
        doc.toc_entries(t)
            .into_iter()
            .map(|e| (e.text, e.level))
            .collect()
    };
    // Word's default: headings and outline levels.
    assert_eq!(
        texts(&doc, &t),
        [("One".to_owned(), 1), ("Note".to_owned(), 2)]
    );
    // \t Title,1 and no \u.
    t.switches.styles.push(TocStyleLevel {
        style: "Title".into(),
        level: 1,
    });
    t.switches.no_outline_levels = true;
    assert_eq!(
        texts(&doc, &t),
        [("Cover".to_owned(), 1), ("One".to_owned(), 1)]
    );
    // Only \t (no \o).
    t.switches.no_headings = true;
    assert_eq!(texts(&doc, &t), [("Cover".to_owned(), 1)]);
}
