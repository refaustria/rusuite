//! P8-27: hyperlinks, bookmarks, cross-references, captions, columns,
//! document properties and settings, paragraph flow options — commands,
//! field computations, invariants under edits, `.docx` round trips and
//! undo/redo identity.

use app_common::Host;
use model_text::{
    Block, Columns, CoreProperties, Document, DocumentSettings, FieldKind, Hyperlink, Inline,
    LinkTarget, NodeId, Paragraph, ParagraphProperties, Run, REF_ERROR,
};
use serde_json::Value as Json;
use write_core::{
    dispatch_with, CommentPoint, FieldRefresh, RefShow, RefTarget, SectionPatch, WriteCommand as C,
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

fn err_code(h: &mut WriteHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before, "a failed command changes nothing");
    e.code()
}

fn pt(block: u64, offset: u32) -> CommentPoint {
    CommentPoint {
        block: NodeId(block),
        offset,
    }
}

fn para(h: &WriteHost, block: u64) -> &Paragraph {
    doc(h).find_paragraph(NodeId(block)).unwrap()
}

fn url(u: &str) -> Hyperlink {
    Hyperlink::new(LinkTarget::Url(u.into()))
}

fn reopen(h: &WriteHost) -> Document {
    let bytes = h.doc().save_docx().unwrap();
    WriteDocument::open_docx(&bytes, "x.docx")
        .unwrap()
        .0
        .into_document()
}

fn document_xml(h: &WriteHost) -> (String, String) {
    let bytes = h.doc().save_docx().unwrap();
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes)).unwrap();
    let part = |n: &str| {
        String::from_utf8(
            pkg.part(&fmt_ooxml::PartName::new(n).unwrap())
                .map(|p| p.data.clone())
                .unwrap_or_default(),
        )
        .unwrap()
    };
    let main = fmt_ooxml::PartName::new("/word/document.xml").unwrap();
    let rels: Vec<String> = pkg
        .relationships(&main)
        .unwrap()
        .iter()
        .map(|r| format!("Target=\"{}\" TargetMode=\"{:?}\"", r.target, r.target_mode))
        .collect();
    (part("/word/document.xml"), rels.join("\n"))
}

fn fields(p: &Paragraph) -> Vec<(FieldKind, String)> {
    p.inlines
        .iter()
        .filter_map(|i| match i {
            Inline::Field(f) => Some((f.kind.clone(), f.cached.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn hyperlinks_set_type_inside_remove_and_roundtrip() {
    let mut h = host(&["Visit our site today"]);
    let mut link = url("https://rusuite.example/");
    link.tooltip = Some("Home".into());
    let patch = apply(
        &mut h,
        C::SetHyperlink {
            block: NodeId(1),
            from: 10,
            to: 14,
            link: link.clone(),
            text: None,
        },
    );
    assert_eq!(patch.replaced.len(), 1);
    let runs: Vec<&Run> = para(&h, 1)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .collect();
    assert_eq!(runs.len(), 3);
    assert_eq!(runs[1].text, "site");
    assert_eq!(runs[1].link.as_ref(), Some(&link));
    assert_eq!(runs[1].style.as_deref(), Some("Hyperlink"));
    // Typing inside the link extends it, at its end it does not (Word).
    apply(
        &mut h,
        C::InsertText {
            block: NodeId(1),
            offset: 12,
            text: "X".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    apply(
        &mut h,
        C::InsertText {
            block: NodeId(1),
            offset: 15,
            text: "Y".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    let linked: String = para(&h, 1)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .filter(|r| r.link.is_some())
        .map(|r| r.text.as_str())
        .collect();
    assert_eq!(linked, "siXte");
    // Saved as w:hyperlink with an external relationship, read back.
    let (xml, rels) = document_xml(&h);
    assert!(xml.contains(r#"<w:hyperlink r:id="rId"#), "{xml}");
    assert!(xml.contains(r#"w:tooltip="Home""#));
    assert!(
        rels.contains(r#"Target="https://rusuite.example/" TargetMode="External""#),
        "{rels}"
    );
    let back = reopen(&h);
    let p = back.body[0].as_paragraph().unwrap();
    let r = p
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .find(|r| r.link.is_some())
        .unwrap();
    assert_eq!((r.text.as_str(), r.link.as_ref()), ("siXte", Some(&link)));
    assert_eq!(r.style.as_deref(), Some("Hyperlink"));
    // Remove Link.
    apply(
        &mut h,
        C::RemoveHyperlink {
            block: NodeId(1),
            from: 10,
            to: 15,
        },
    );
    assert!(para(&h, 1)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .all(|r| r.link.is_none() && r.style.is_none()));
    // With display text, an internal and an e-mail link.
    apply(
        &mut h,
        C::SetHyperlink {
            block: NodeId(1),
            from: 0,
            to: 0,
            link: Hyperlink::new(LinkTarget::Bookmark("top".into())),
            text: Some("Top ".into()),
        },
    );
    assert!(para(&h, 1).text().starts_with("Top Visit"));
    apply(
        &mut h,
        C::SetHyperlink {
            block: NodeId(1),
            from: 4,
            to: 9,
            link: Hyperlink::new(LinkTarget::Email {
                address: "info@rusuite.example".into(),
                subject: Some("Hello".into()),
            }),
            text: None,
        },
    );
    let (xml, rels) = document_xml(&h);
    assert!(
        xml.contains(r#"<w:hyperlink w:anchor="top" w:history="1">"#),
        "{xml}"
    );
    assert!(
        rels.contains("mailto:info@rusuite.example?subject=Hello"),
        "{rels}"
    );
    let back = reopen(&h);
    let targets: Vec<LinkTarget> = back.body[0]
        .as_paragraph()
        .unwrap()
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .filter_map(|r| r.link.as_ref().map(|l| l.target.clone()))
        .collect();
    assert_eq!(targets[0], LinkTarget::Bookmark("top".into()));
    assert!(
        matches!(&targets[1], LinkTarget::Email { address, subject } if address == "info@rusuite.example" && subject.as_deref() == Some("Hello"))
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetHyperlink {
                block: NodeId(1),
                from: 2,
                to: 2,
                link: url("https://x.at"),
                text: None,
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetHyperlink {
                block: NodeId(1),
                from: 0,
                to: 2,
                link: url(" "),
                text: None,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn bookmarks_add_move_delete_and_survive_edits() {
    let mut h = host(&["Alpha beta gamma", "Delta epsilon"]);
    apply(
        &mut h,
        C::AddBookmark {
            name: "intro".into(),
            start: pt(1, 6),
            end: pt(2, 5),
        },
    );
    let b = doc(&h).bookmark("Intro").unwrap();
    assert_eq!(
        (b.start_block, b.start, b.end_block, b.end),
        (NodeId(1), 6, NodeId(2), 5)
    );
    assert_eq!(doc(&h).bookmark_text(&b), "beta gamma Delta");
    // Typing inside, deleting across the start: the range shrinks, the
    // bookmark stays.
    apply(
        &mut h,
        C::DeleteText {
            block: NodeId(1),
            from: 3,
            to: 9,
        },
    );
    let b = doc(&h).bookmark("intro").unwrap();
    assert_eq!(doc(&h).bookmark_text(&b), "ta gamma Delta");
    // Moving it (Add with an existing name).
    apply(
        &mut h,
        C::AddBookmark {
            name: "INTRO".into(),
            start: pt(2, 0),
            end: pt(2, 2),
        },
    );
    assert_eq!(doc(&h).bookmarks().len(), 1);
    let b = doc(&h).bookmark("intro").unwrap();
    assert_eq!(doc(&h).bookmark_text(&b), "De");
    // Round trip.
    let back = reopen(&h);
    assert_eq!(back.bookmarks().len(), 1);
    assert_eq!(back.bookmarks()[0].name, "INTRO");
    // Deleting the bookmarked text as a whole removes the bookmark.
    let mut h2 = host(&["one two"]);
    apply(
        &mut h2,
        C::AddBookmark {
            name: "two".into(),
            start: pt(1, 4),
            end: pt(1, 7),
        },
    );
    apply(
        &mut h2,
        C::DeleteText {
            block: NodeId(1),
            from: 3,
            to: 9,
        },
    );
    assert!(doc(&h2).bookmarks().is_empty());
    assert_eq!(para(&h2, 1).text(), "one");
    // Delete Bookmark; invalid names and reversed ranges are rejected.
    apply(
        &mut h,
        C::DeleteBookmark {
            name: "intro".into(),
        },
    );
    assert!(doc(&h).bookmarks().is_empty());
    for name in ["2nd", "a b", ""] {
        assert_eq!(
            err_code(
                &mut h,
                C::AddBookmark {
                    name: name.into(),
                    start: pt(1, 0),
                    end: pt(1, 1),
                }
            ),
            "invalid_command"
        );
    }
    assert_eq!(
        err_code(
            &mut h,
            C::AddBookmark {
                name: "x".into(),
                start: pt(2, 1),
                end: pt(1, 1),
            }
        ),
        "invalid_command"
    );
}

#[test]
fn cross_references_page_text_and_refresh() {
    let mut h = host(&["Results", "Some text", "See page "]);
    apply(
        &mut h,
        C::AddBookmark {
            name: "results".into(),
            start: pt(1, 0),
            end: pt(1, 7),
        },
    );
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(3),
            offset: 9,
            target: RefTarget::Bookmark("results".into()),
            show: RefShow::Page,
            hyperlink: true,
            page: Some(1),
        },
    );
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(3),
            offset: 0,
            target: RefTarget::Bookmark("results".into()),
            show: RefShow::Text,
            hyperlink: false,
            page: None,
        },
    );
    let f = fields(para(&h, 3));
    assert_eq!(f[0].1, "Results");
    assert_eq!(
        f[1],
        (
            FieldKind::PageRef {
                bookmark: "results".into(),
                hyperlink: true
            },
            "1".into()
        )
    );
    // The bookmarked paragraph moved to page 2: Update Fields recomputes.
    let start = doc(&h).bookmark("results").unwrap().start_block;
    apply(
        &mut h,
        C::UpdateFields {
            values: vec![],
            refresh: Some(FieldRefresh {
                pages: vec![(start, 2)],
                blocks: None,
            }),
        },
    );
    assert_eq!(fields(para(&h, 3))[1].1, "2");
    // Scoped to other blocks: nothing changes.
    let patch = h
        .apply(C::UpdateFields {
            values: vec![],
            refresh: Some(FieldRefresh {
                pages: vec![(start, 5)],
                blocks: Some(vec![NodeId(2)]),
            }),
        })
        .unwrap()
        .patch;
    assert!(patch.replaced.is_empty());
    // Saved as PAGEREF / REF fields, read back.
    let (xml, _) = document_xml(&h);
    assert!(xml.contains(r#"w:instr=" PAGEREF results \h ""#), "{xml}");
    assert!(xml.contains(r#"w:instr=" REF results ""#));
    let back = reopen(&h);
    assert_eq!(fields(back.body[2].as_paragraph().unwrap()).len(), 2);
    // Deleting the bookmark: the reference shows Word's error on update.
    apply(
        &mut h,
        C::DeleteBookmark {
            name: "results".into(),
        },
    );
    apply(
        &mut h,
        C::UpdateFields {
            values: vec![],
            refresh: Some(FieldRefresh::default()),
        },
    );
    assert_eq!(fields(para(&h, 3))[0].1, REF_ERROR);
}

#[test]
fn cross_references_to_headings_notes_and_captions_create_hidden_bookmarks() {
    let mut h = host(&["Intro", "Body", "x"]);
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(2),
            offset: 4,
            target: RefTarget::Paragraph(NodeId(1)),
            show: RefShow::Text,
            hyperlink: true,
            page: None,
        },
    );
    let marks = doc(&h).bookmarks();
    assert_eq!(marks.len(), 1);
    assert!(marks[0].hidden() && marks[0].name.starts_with("_Ref"));
    assert_eq!(fields(para(&h, 2))[0].1, "Intro");
    // A second reference reuses the bookmark.
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(2),
            offset: 0,
            target: RefTarget::Paragraph(NodeId(1)),
            show: RefShow::Page,
            hyperlink: true,
            page: Some(4),
        },
    );
    assert_eq!(doc(&h).bookmarks().len(), 1);
    assert_eq!(fields(para(&h, 2))[0].1, "4");
    // A reference in the target paragraph itself keeps its position.
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(3),
            offset: 1,
            target: RefTarget::Paragraph(NodeId(3)),
            show: RefShow::Text,
            hyperlink: false,
            page: None,
        },
    );
    let p = para(&h, 3);
    assert!(matches!(p.inlines[0], Inline::BookmarkStart { .. }));
    assert!(matches!(p.inlines[2], Inline::BookmarkEnd { .. }));
    assert!(matches!(p.inlines[3], Inline::Field(_)));
    // A footnote reference: NOTEREF to a bookmark around the mark.
    apply(
        &mut h,
        C::InsertFootnote {
            block: NodeId(1),
            offset: 5,
            text: "A note".into(),
            kind: model_text::NoteKind::Foot,
        },
    );
    let note = doc(&h).notes[0].id;
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(2),
            offset: 0,
            target: RefTarget::Note(note),
            show: RefShow::NoteFormatted,
            hyperlink: true,
            page: None,
        },
    );
    let f = fields(para(&h, 2));
    assert!(matches!(
        &f[0].0,
        FieldKind::NoteRef {
            formatted: true,
            ..
        }
    ));
    assert_eq!(f[0].1, "1");
    let (xml, _) = document_xml(&h);
    assert!(
        xml.contains(r#"NOTEREF _Ref"#) && xml.contains(r#"\f \h"#),
        "{xml}"
    );
}

#[test]
fn captions_number_in_document_order() {
    let mut h = host(&["Picture one", "Picture two"]);
    let p1 = apply(
        &mut h,
        C::InsertCaption {
            anchor: NodeId(2),
            below: true,
            label: "Figure".into(),
            text: ": the second".into(),
            new_id: Some(-1),
        },
    );
    let second = p1.id_map[0].1;
    assert_eq!(
        doc(&h).find_paragraph(second).unwrap().display_text(),
        "Figure 1: the second"
    );
    // A caption before it: numbered 1, the later one becomes 2.
    let p2 = apply(
        &mut h,
        C::InsertCaption {
            anchor: NodeId(1),
            below: true,
            label: "Figure".into(),
            text: ": the first".into(),
            new_id: Some(-1),
        },
    );
    let first = p2.id_map[0].1;
    assert!(p2.replaced.iter().any(|b| b.id() == second));
    let shown = |id| doc(&h).find_paragraph(id).unwrap().display_text();
    assert_eq!(shown(first), "Figure 1: the first");
    assert_eq!(shown(second), "Figure 2: the second");
    assert_eq!(
        doc(&h)
            .find_paragraph(first)
            .unwrap()
            .props
            .style
            .as_deref(),
        Some("Caption")
    );
    // Other labels count separately; a caption above.
    apply(
        &mut h,
        C::InsertCaption {
            anchor: NodeId(1),
            below: false,
            label: "Table".into(),
            text: String::new(),
            new_id: None,
        },
    );
    assert_eq!(
        doc(&h).body[0].as_paragraph().unwrap().display_text(),
        "Table 1"
    );
    // A cross-reference to the label and number only.
    apply(
        &mut h,
        C::InsertCrossReference {
            block: NodeId(2),
            offset: 0,
            target: RefTarget::CaptionLabel(second),
            show: RefShow::Text,
            hyperlink: true,
            page: None,
        },
    );
    assert_eq!(fields(para(&h, 2))[0].1, "Figure 2");
    // Table of figures.
    let p = apply(
        &mut h,
        C::InsertToc {
            after: None,
            from_level: None,
            to_level: None,
            title: None,
            new_id: Some(-3),
            caption: Some("Figure".into()),
        },
    );
    let toc = doc(&h).find_block(p.id_map[0].1).unwrap().as_toc().unwrap();
    let texts: Vec<&str> = toc.entries.iter().map(|e| e.text.as_str()).collect();
    assert_eq!(texts, ["Figure 1: the first", "Figure 2: the second"]);
    assert!(doc(&h).styles.get("TableofFigures").is_some());
    // Round trip: SEQ fields, the caption style, the table of figures.
    let (xml, _) = document_xml(&h);
    assert!(xml.contains(r#"w:instr=" SEQ Figure \* ARABIC ""#), "{xml}");
    assert!(xml.contains(r#"TOC \h \z \c "Figure""#));
    let back = reopen(&h);
    let toc = back.body.iter().find_map(Block::as_toc).unwrap();
    assert_eq!(toc.caption.as_deref(), Some("Figure"));
    assert_eq!(toc.entries.len(), 2);
    assert_eq!(back.captions("Figure").len(), 2);
}

#[test]
fn columns_and_column_breaks_roundtrip() {
    let mut h = host(&["Left", "Right"]);
    let section = doc(&h).sections[0].id;
    let cols = Columns {
        count: 3,
        spacing: Some(model_text::Twips(567)),
        equal: true,
        widths: vec![],
        separator: true,
    };
    apply(
        &mut h,
        C::SetSection {
            section,
            patch: SectionPatch {
                columns: Some(cols.clone()),
                ..Default::default()
            },
        },
    );
    apply(
        &mut h,
        C::RestoreInlines {
            block: NodeId(1),
            from: 4,
            to: 4,
            inlines: vec![Inline::Break(model_text::BreakKind::Column)],
        },
    );
    let (xml, _) = document_xml(&h);
    assert!(
        xml.contains(r#"<w:cols w:space="567" w:num="3" w:sep="1"/>"#),
        "{xml}"
    );
    assert!(xml.contains(r#"<w:br w:type="column"/>"#));
    let back = reopen(&h);
    assert_eq!(back.sections.last().unwrap().columns, cols);
    assert_eq!(
        back.body[0].as_paragraph().unwrap().inlines.last(),
        Some(&Inline::Break(model_text::BreakKind::Column))
    );
    // Unequal widths.
    let unequal = Columns {
        count: 2,
        spacing: None,
        equal: false,
        widths: vec![
            model_text::ColumnWidth {
                width: model_text::Twips(3000),
                space: model_text::Twips(500),
            },
            model_text::ColumnWidth {
                width: model_text::Twips(5526),
                space: model_text::Twips(0),
            },
        ],
        separator: false,
    };
    apply(
        &mut h,
        C::SetSection {
            section,
            patch: SectionPatch {
                columns: Some(unequal.clone()),
                ..Default::default()
            },
        },
    );
    assert_eq!(reopen(&h).sections.last().unwrap().columns, unequal);
    let layout = unequal.layout(model_text::Twips(9026));
    assert_eq!(
        layout[0].width.0 + layout[0].space.0 + layout[1].width.0,
        9026
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetSection {
                section,
                patch: SectionPatch {
                    columns: Some(Columns {
                        equal: false,
                        ..Columns::equal(3)
                    }),
                    ..Default::default()
                },
            }
        ),
        "invalid_command"
    );
    // Equal-column math: what is left after the spacing, shared.
    let l = Columns::equal(2).layout(model_text::Twips(9026));
    assert_eq!((l[0].width.0, l[0].space.0, l[1].space.0), (4153, 720, 0));
}

#[test]
fn properties_settings_and_flow_options_roundtrip() {
    let mut h = host(&["Text"]);
    let patch = apply(
        &mut h,
        C::SetProperties {
            patch: CoreProperties {
                title: Some("Quarterly report".into()),
                subject: Some("Q3".into()),
                keywords: Some("finance; q3".into()),
                description: Some("Draft".into()),
                category: Some("Reports".into()),
                ..Default::default()
            },
        },
    );
    assert_eq!(
        patch.properties.unwrap().title.as_deref(),
        Some("Quarterly report")
    );
    apply(
        &mut h,
        C::SetSettings {
            settings: DocumentSettings {
                auto_hyphenation: true,
            },
        },
    );
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![NodeId(1)],
            patch: ParagraphProperties {
                keep_lines: Some(true),
                widow_control: Some(false),
                suppress_line_numbers: Some(true),
                suppress_auto_hyphens: Some(true),
                page_break_before: Some(true),
                keep_next: Some(true),
                ..Default::default()
            },
        },
    );
    // A TITLE field reads the property.
    apply(
        &mut h,
        C::InsertField {
            block: NodeId(1),
            offset: 0,
            field: FieldKind::Title,
            cached: None,
        },
    );
    apply(
        &mut h,
        C::UpdateFields {
            values: vec![],
            refresh: Some(FieldRefresh::default()),
        },
    );
    assert_eq!(fields(para(&h, 1))[0].1, "Quarterly report");
    // Saving stamps the dates, the user, the pages and the revision.
    let reply = dispatch_with(
        &mut h,
        r#"{"type":"saveDocx","modified":"2026-10-16T10:00:00Z","user":"Ann Lee","pages":3}"#,
    );
    assert!(reply.contains(r#""type":"saved""#), "{reply}");
    let p = &doc(&h).properties;
    assert_eq!(p.created.as_deref(), Some("2026-10-16T10:00:00Z"));
    assert_eq!(p.author.as_deref(), Some("Ann Lee"));
    assert_eq!(p.revision, Some(1));
    let bytes = h.doc().save_docx().unwrap();
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes.clone())).unwrap();
    let text = |n: &str| {
        String::from_utf8(
            pkg.part(&fmt_ooxml::PartName::new(n).unwrap())
                .unwrap()
                .data
                .clone(),
        )
        .unwrap()
    };
    let core = text("/docProps/core.xml");
    assert!(
        core.contains("<dc:title>Quarterly report</dc:title>"),
        "{core}"
    );
    assert!(core.contains(
        r#"<dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-16T10:00:00Z</dcterms:modified>"#
    ));
    let app = text("/docProps/app.xml");
    assert!(
        app.contains("<Application>Rusuite Write</Application>")
            && app.contains("<Pages>3</Pages>"),
        "{app}"
    );
    assert!(text("/word/settings.xml").contains("<w:autoHyphenation/>"));
    let (back, _) = WriteDocument::open_docx(&bytes, "r.docx").unwrap();
    let d = back.document();
    assert_eq!(d.properties.title.as_deref(), Some("Quarterly report"));
    assert_eq!(d.properties.category.as_deref(), Some("Reports"));
    assert_eq!(d.properties.pages, Some(3));
    assert!(d.settings.auto_hyphenation);
    let pp = &d.body[0].as_paragraph().unwrap().props;
    assert_eq!(
        (
            pp.keep_lines,
            pp.widow_control,
            pp.suppress_line_numbers,
            pp.suppress_auto_hyphens
        ),
        (Some(true), Some(false), Some(true), Some(true))
    );
    // Turning hyphenation off in a file that has the settings part.
    let mut h2 = Host::new(back);
    h2.apply(C::SetSettings {
        settings: DocumentSettings::default(),
    })
    .unwrap();
    let again = WriteDocument::open_docx(&h2.doc().save_docx().unwrap(), "r.docx")
        .unwrap()
        .0;
    assert!(!again.document().settings.auto_hyphenation);
}
