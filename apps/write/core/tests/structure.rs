//! P8-9 commands: fields, footnotes/endnotes, tables of contents, list
//! restart/continue and labels, sections with headers and footers. Every
//! command is checked for undo/redo identity.

use app_common::Host;
use model_text::{
    Block, Document, FieldKind, HeaderSlot, Inline, NodeId, NoteKind, Orientation, Paragraph,
    ParagraphProperties, Run, SectionId, SectionKind,
};
use serde_json::Value as Json;
use write_core::{
    dispatch_with, ListKind, NewBlock, NewParagraph, PageSetupPatch, SectionPatch,
    WriteCommand as C, WriteDocument, WriteHost, WritePatch,
};

/// A body of paragraphs with ids 1, 2, …; `#` starts a Heading 1, `##` a
/// Heading 2.
fn host(texts: &[&str]) -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    for (i, t) in texts.iter().enumerate() {
        let id = NodeId(i as u64 + 1);
        doc.reserve_id(id);
        let (style, t) = match (t.strip_prefix("## "), t.strip_prefix("# ")) {
            (Some(t), _) => (Some("Heading2"), t),
            (_, Some(t)) => (Some("Heading1"), t),
            _ => (None, *t),
        };
        let mut p = Paragraph::with_text(id, t);
        p.props.style = style.map(str::to_owned);
        doc.body.push(Block::Paragraph(p));
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

fn err_code(h: &mut WriteHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before, "failed command changed the document");
    e.code()
}

fn id(n: u64) -> NodeId {
    NodeId(n)
}

fn labels(h: &WriteHost) -> Vec<String> {
    doc(h).list_numbers().into_iter().map(|(_, l)| l).collect()
}

fn reopen(h: &WriteHost) -> Document {
    let bytes = h.doc().save_docx().unwrap();
    let (d, warnings) = WriteDocument::open_docx(&bytes, "x.docx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    d.into_document()
}

#[test]
fn insert_field() {
    let mut h = host(&["Page "]);
    let patch = apply(
        &mut h,
        C::InsertField {
            block: id(1),
            offset: 5,
            field: FieldKind::Page,
            cached: Some("1".into()),
        },
    );
    assert_eq!(patch.replaced.len(), 1);
    let p = doc(&h).find_paragraph(id(1)).unwrap();
    assert_eq!(p.len(), 6);
    assert!(
        matches!(&p.inlines[1], Inline::Field(f) if f.kind == FieldKind::Page && f.cached == "1")
    );
    apply(
        &mut h,
        C::InsertField {
            block: id(1),
            offset: 0,
            field: FieldKind::Date {
                format: Some("d MMMM yyyy".into()),
            },
            cached: None,
        },
    );
    // deleting a field is deleting its position
    apply(
        &mut h,
        C::DeleteText {
            block: id(1),
            from: 0,
            to: 1,
        },
    );
    let back = reopen(&h);
    assert_eq!(
        back.body[0].as_paragraph().unwrap().inlines,
        doc(&h).body[0].as_paragraph().unwrap().inlines
    );
}

#[test]
fn footnotes_insert_edit_delete() {
    let mut h = host(&["Claim", "Other"]);
    let patch = apply(
        &mut h,
        C::InsertFootnote {
            block: id(1),
            offset: 5,
            text: "Source.".into(),
            kind: NoteKind::Foot,
        },
    );
    let notes = patch.notes.expect("notes in the patch");
    assert_eq!(notes.len(), 1);
    let note_id = notes[0].id;
    let note_para = notes[0].blocks[0].id();
    assert!(patch.styles.is_some(), "footnote styles added");
    assert!(doc(&h).styles.get("FootnoteText").is_some());
    assert_eq!(doc(&h).find_paragraph(id(1)).unwrap().text(), "Claim\u{2}");
    assert_eq!(
        doc(&h).find_paragraph(note_para).unwrap().text(),
        " Source."
    );

    // The note text is edited with the ordinary text commands.
    let patch = apply(
        &mut h,
        C::InsertText {
            block: note_para,
            offset: 8,
            text: " Page 4.".into(),
            props: None,
        },
    );
    assert!(patch.replaced.is_empty());
    assert_eq!(
        patch.notes.unwrap()[0].blocks[0]
            .as_paragraph()
            .unwrap()
            .text(),
        " Source. Page 4."
    );

    // An endnote gets its own id; both survive a save.
    apply(
        &mut h,
        C::InsertFootnote {
            block: id(2),
            offset: 0,
            text: "End.".into(),
            kind: NoteKind::End,
        },
    );
    let back = reopen(&h);
    assert_eq!(back.notes.len(), 2);
    assert_eq!(back.notes[1].kind, NoteKind::End);
    assert_eq!(
        back.notes[0].blocks[0].as_paragraph().unwrap().text(),
        " Source. Page 4."
    );

    // Coarse replacement of the note content.
    apply(
        &mut h,
        C::ReplaceNote {
            id: note_id,
            blocks: vec![
                NewBlock::Paragraph(NewParagraph {
                    id: -1,
                    props: ParagraphProperties::default(),
                    inlines: vec![Inline::Run(Run::new("One"))],
                }),
                NewBlock::Paragraph(NewParagraph {
                    id: -2,
                    props: ParagraphProperties::default(),
                    inlines: vec![Inline::Run(Run::new("Two"))],
                }),
            ],
        },
    );
    assert_eq!(doc(&h).note(note_id).unwrap().blocks.len(), 2);

    let patch = apply(&mut h, C::DeleteFootnote { id: note_id });
    assert_eq!(patch.notes.unwrap().len(), 1);
    assert_eq!(doc(&h).find_paragraph(id(1)).unwrap().text(), "Claim");
    assert_eq!(
        err_code(&mut h, C::DeleteFootnote { id: note_id }),
        "invalid_command"
    );
}

#[test]
fn table_of_contents() {
    let mut h = host(&["# Intro", "text", "## Detail", "# End"]);
    let patch = apply(
        &mut h,
        C::InsertToc {
            after: None,
            from_level: None,
            to_level: Some(2),
            title: Some("Contents".into()),
            new_id: Some(-5),
        },
    );
    let real = patch.id_map[0].1;
    assert_eq!(patch.id_map, vec![(-5, real)]);
    assert!(patch.styles.is_some());
    let toc = doc(&h).body[0].as_toc().unwrap().clone();
    assert_eq!(toc.id, real);
    let entries: Vec<(&str, u8, NodeId)> = toc
        .entries
        .iter()
        .map(|e| (e.text.as_str(), e.level, e.target))
        .collect();
    assert_eq!(
        entries,
        [("Intro", 1, id(1)), ("Detail", 2, id(3)), ("End", 1, id(4))]
    );
    // The heading changes; the TOC follows on update, with pages.
    apply(
        &mut h,
        C::InsertText {
            block: id(3),
            offset: 6,
            text: "s".into(),
            props: None,
        },
    );
    let patch = apply(
        &mut h,
        C::UpdateToc {
            id: real,
            pages: vec![(id(1), 1), (id(3), 2)],
        },
    );
    let Block::Toc(t) = &patch.replaced[0] else {
        panic!("toc in the patch")
    };
    assert_eq!(t.entries[1].text, "Details");
    assert_eq!(
        t.entries.iter().map(|e| e.page).collect::<Vec<_>>(),
        [Some(1), Some(2), None]
    );
    let back = reopen(&h);
    let bt = back.body[0].as_toc().unwrap();
    assert_eq!(bt.title.as_deref(), Some("Contents"));
    assert_eq!(bt.entries.len(), 3);
    assert_eq!(bt.entries[1].page, Some(2));
    assert_eq!(
        err_code(
            &mut h,
            C::UpdateToc {
                id: id(1),
                pages: vec![]
            }
        ),
        "invalid_command"
    );
    // deleting it is deleting the block
    apply(&mut h, C::DeleteBlocks { ids: vec![real] });
}

#[test]
fn list_labels_restart_and_continue() {
    let mut h = host(&["a", "b", "c", "d"]);
    let all = vec![id(1), id(2), id(3), id(4)];
    let patch = apply(
        &mut h,
        C::ApplyList {
            blocks: all.clone(),
            kind: ListKind::Decimal,
        },
    );
    let reported: Vec<Option<String>> = patch
        .replaced
        .iter()
        .map(|b| b.as_paragraph().unwrap().list_label.clone())
        .collect();
    assert_eq!(
        reported,
        [
            Some("1.".into()),
            Some("2.".into()),
            Some("3.".into()),
            Some("4.".into())
        ]
    );
    // Indenting b relabels c and d (not in the command) too.
    let patch = apply(
        &mut h,
        C::IndentList {
            blocks: vec![id(2)],
            delta: 1,
        },
    );
    let mut got: Vec<(u64, String)> = patch
        .replaced
        .iter()
        .map(|b| {
            let p = b.as_paragraph().unwrap();
            (p.id.0, p.list_label.clone().unwrap())
        })
        .collect();
    got.sort();
    assert_eq!(got, [(2, "a.".into()), (3, "2.".into()), (4, "3.".into())]);
    apply(
        &mut h,
        C::IndentList {
            blocks: vec![id(2)],
            delta: -1,
        },
    );

    apply(
        &mut h,
        C::RestartList {
            block: id(3),
            start: None,
        },
    );
    assert_eq!(labels(&h), ["1.", "2.", "1.", "2."]);
    apply(
        &mut h,
        C::RestartList {
            block: id(4),
            start: Some(10),
        },
    );
    assert_eq!(labels(&h), ["1.", "2.", "1.", "10."]);
    // Restarted lists share the definition of the first one.
    let numbering = &doc(&h).numbering;
    let abstracts: Vec<Option<u32>> = numbering.defs.iter().map(|d| d.abstract_id).collect();
    assert!(abstracts.iter().all(|a| a.is_some() && *a == abstracts[0]));
    apply(&mut h, C::ContinueList { block: id(3) });
    // d keeps its own restart
    assert_eq!(labels(&h), ["1.", "2.", "3.", "10."]);
    apply(&mut h, C::ContinueList { block: id(4) });
    assert_eq!(labels(&h), ["1.", "2.", "3.", "4."]);
    // The labels survive saving: same definitions, same counting.
    let back = reopen(&h);
    let back_labels: Vec<String> = back.list_numbers().into_iter().map(|(_, l)| l).collect();
    assert_eq!(back_labels, labels(&h));

    // The document snapshot carries the labels.
    let reply = dispatch_with(&mut h, r#"{"type":"getDocument"}"#);
    assert!(reply.contains(r#""listLabel":"4.""#), "{reply}");
    let mut plain = host(&["x"]);
    assert_eq!(
        err_code(
            &mut plain,
            C::RestartList {
                block: id(1),
                start: None
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(&mut plain, C::ContinueList { block: id(1) }),
        "invalid_command"
    );
}

#[test]
fn sections_and_headers() {
    let mut h = host(&["one", "two", "three"]);
    apply(
        &mut h,
        C::SetPage {
            patch: PageSetupPatch {
                header_text: Some("Report {PAGE}".into()),
                ..Default::default()
            },
        },
    );
    let patch = apply(
        &mut h,
        C::InsertSectionBreak {
            block: id(1),
            kind: SectionKind::NextPage,
        },
    );
    let sections = patch.sections.unwrap();
    assert_eq!(sections.len(), 2);
    let (s1, s2) = (sections[0].id, sections[1].id);
    assert_eq!(
        doc(&h).find_paragraph(id(1)).unwrap().props.section_end,
        Some(s1)
    );
    // The header moved to the first section; the second inherits it.
    assert!(sections[0].headers.default.is_some() && sections[1].headers.default.is_none());
    assert_eq!(doc(&h).page.header_text.as_deref(), Some("Report {PAGE}"));

    // The second (last) section: landscape, two columns, a first-page header.
    apply(
        &mut h,
        C::SetSection {
            section: s2,
            patch: SectionPatch {
                kind: Some(SectionKind::OddPage),
                columns: Some(2),
                title_page: Some(true),
                page_number_start: Some(1),
                page: Some(PageSetupPatch {
                    orientation: Some(Orientation::Landscape),
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
    );
    assert_eq!(doc(&h).page.orientation, Orientation::Landscape);
    assert_eq!(doc(&h).sections[0].page.orientation, Orientation::Portrait);
    let patch = apply(
        &mut h,
        C::SetHeaderFooter {
            section: s2,
            footer: false,
            slot: HeaderSlot::First,
            blocks: Some(vec![NewBlock::Paragraph(NewParagraph {
                id: -1,
                props: ParagraphProperties::default(),
                inlines: vec![Inline::Run(Run::new("Appendix"))],
            })]),
        },
    );
    let hp = patch.id_map[0].1;
    // Editing header text reports the sections.
    let patch = apply(
        &mut h,
        C::InsertText {
            block: hp,
            offset: 8,
            text: " A".into(),
            props: None,
        },
    );
    assert!(patch.replaced.is_empty());
    let first = patch.sections.unwrap()[1].headers.first.clone().unwrap();
    assert_eq!(first[0].as_paragraph().unwrap().text(), "Appendix A");
    // Splitting the break paragraph keeps the break at its end.
    apply(
        &mut h,
        C::SplitParagraph {
            block: id(1),
            offset: 1,
            new_id: -7,
        },
    );
    let ends: Vec<Option<SectionId>> = doc(&h).paragraphs().map(|p| p.props.section_end).collect();
    assert_eq!(ends, [None, Some(s1), None, None]);

    // Save and reopen: two sections, headers and properties.
    let back = reopen(&h);
    assert_eq!(back.sections.len(), 2);
    let b2 = &back.sections[1];
    assert_eq!(
        (b2.kind, b2.columns, b2.title_page),
        (SectionKind::OddPage, 2, true)
    );
    assert_eq!(b2.page_number_start, Some(1));
    assert_eq!(back.page.header_text.as_deref(), Some("Report {PAGE}"));

    // Deleting the break paragraph merges the sections; undo restores.
    let marker = doc(&h)
        .paragraphs()
        .find(|p| p.props.section_end.is_some())
        .unwrap()
        .id;
    let patch = apply(&mut h, C::DeleteBlocks { ids: vec![marker] });
    assert_eq!(patch.sections.unwrap().len(), 1);
    h.undo().unwrap().unwrap();
    assert_eq!(doc(&h).sections.len(), 2);
    apply(&mut h, C::RemoveSectionBreak { section: s1 });
    assert_eq!(doc(&h).sections.len(), 1);
    // the merged section kept the header of the removed one
    assert_eq!(doc(&h).page.header_text.as_deref(), Some("Report {PAGE}"));
    assert_eq!(
        err_code(&mut h, C::RemoveSectionBreak { section: s2 }),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::InsertFootnote {
                block: hp,
                offset: 0,
                text: "x".into(),
                kind: NoteKind::Foot
            }
        ),
        "invalid_command"
    );
}
