//! Notes (legacy comments + VML), threaded comments, persons and
//! hyperlinks (P8-26), against the openpyxl reference workbook and built
//! workbooks.

use std::io::Cursor;

use core_model::{Color, FontSize, Rgb, RunProperties};
use engine_formula::CellCoord;
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    Hyperlink, LinkTarget, Note, NoteBounds, NoteRun, Person, Reply, Thread, Workbook,
};

fn load(name: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let p = pkg
        .part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"));
    String::from_utf8(p.data.clone()).unwrap()
}

fn rels(xlsx: &[u8], source: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let r = pkg
        .relationships(&PartName::new(source).unwrap())
        .unwrap_or_else(|| panic!("no rels of {source}"));
    String::from_utf8(r.to_xml()).unwrap()
}

fn pretty(xml: &str) -> String {
    xml.replace("><", ">\n<")
}

#[test]
fn reference_workbook_notes_threads_and_links() {
    let bytes = load("provisional-comments.xlsx");
    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = wb.sheet_id("Review").unwrap();
    let c = |r, col| CellCoord::new(s, r, col);
    // Notes: the placeholders of the threads are skipped.
    let notes = wb.notes(s);
    assert_eq!(notes.len(), 2, "{notes:?}");
    assert_eq!(notes[0].author, "Ann Lee");
    assert_eq!(notes[0].plain_text(), "Ann Lee:\nCheck the supplier price.");
    // openpyxl's 144 × 79 px default box (no anchor in its VML).
    let b = notes[0].bounds.expect("openpyxl size");
    assert_eq!((b.w, b.h), (108.0, 59.25));
    assert!(!notes[0].visible);
    let big = wb.note_at(c(2, 1)).unwrap();
    assert_eq!(big.author, "Bob");
    let b = big.bounds.expect("custom size");
    assert_eq!((b.w, b.h), (150.0, 75.0));
    // Threads with persons, reply and resolved state.
    let t = wb.thread_at(c(3, 0)).unwrap();
    assert_eq!(t.author.name, "Ann Lee");
    assert_eq!(t.date, "2026-10-01T09:30:00.00");
    assert_eq!(t.text, "Is this still current?");
    assert!(!t.resolved);
    assert_eq!(t.replies.len(), 1);
    assert_eq!(t.replies[0].author.name, "Bob");
    assert_eq!(t.replies[0].text, "Yes, until May.");
    let done = wb.thread_at(c(3, 1)).unwrap();
    assert!(done.resolved);
    assert_eq!(wb.persons().len(), 2);
    // Hyperlinks.
    assert_eq!(
        wb.hyperlink_at(c(1, 2)).unwrap().target,
        LinkTarget::Url {
            url: "https://example.com/rusuite".into()
        }
    );
    assert_eq!(
        wb.hyperlink_at(c(2, 2)).unwrap().target,
        LinkTarget::Email {
            address: "team@example.com".into(),
            subject: Some("Order".into())
        }
    );
    let loc = wb.hyperlink_at(c(3, 2)).unwrap();
    assert_eq!(
        loc.target,
        LinkTarget::Location {
            location: "Totals!A1".into()
        }
    );
    assert_eq!(loc.tooltip.as_deref(), Some("Go to the totals"));
}

#[test]
fn reference_workbook_rewrites_byte_identically() {
    let first = fmt_xlsx::read_with_context(&load("provisional-comments.xlsx")).unwrap();
    let written = fmt_xlsx::write_with_context(&first.workbook, &first.context).unwrap();
    let second = fmt_xlsx::read_with_context(&written).unwrap();
    assert!(second.warnings.is_empty(), "{:?}", second.warnings);
    assert_eq!(second.workbook.to_snapshot(), first.workbook.to_snapshot());
    let again = fmt_xlsx::write_with_context(&second.workbook, &second.context).unwrap();
    assert_eq!(written, again, "second generation differs");
}

fn built() -> Workbook {
    let mut wb = Workbook::new();
    let s = wb.sheet_id("Sheet1").unwrap();
    wb.set_input(CellCoord::new(s, 0, 0), "Price").unwrap();
    wb.set_col_width(s, 2, Some(20.0)).unwrap();
    wb.set_note(
        s,
        Note {
            row: 1,
            col: 1,
            author: "Ann Lee".into(),
            text: vec![
                NoteRun {
                    text: "Ann Lee:".into(),
                    font: RunProperties {
                        bold: Some(true),
                        size: Some(FontSize::from_pt(9.0)),
                        ..Default::default()
                    },
                },
                NoteRun {
                    text: "\nred & <italic>".into(),
                    font: RunProperties {
                        italic: Some(true),
                        color: Some(Color::Rgb(Rgb::new(255, 0, 0))),
                        ..Default::default()
                    },
                },
            ],
            visible: true,
            bounds: Some(NoteBounds {
                x: 30.0,
                y: 15.0,
                w: 150.0,
                h: 90.0,
            }),
        },
    )
    .unwrap();
    wb.set_note(s, Note::plain(5, 3, "", "plain note")).unwrap();
    let ann = Person::new("Ann Lee", "AL");
    wb.upsert_person(ann.clone());
    wb.set_thread(
        s,
        Thread {
            id: "{00000000-0000-4000-8000-000000000001}".into(),
            row: 0,
            col: 0,
            author: ann,
            date: "2026-10-16T09:30:00.00".into(),
            text: "Source?".into(),
            resolved: true,
            replies: vec![Reply {
                id: "{00000000-0000-4000-8000-000000000002}".into(),
                author: Person::new("Bob", ""),
                date: "2026-10-16T10:00:00.00".into(),
                text: "The 2026 list.".into(),
            }],
        },
    )
    .unwrap();
    wb.set_hyperlink(
        s,
        Hyperlink {
            r0: 0,
            c0: 4,
            r1: 0,
            c1: 4,
            target: LinkTarget::Url {
                url: "https://example.com/?a=1&b=2".into(),
            },
            display: Some("Example".into()),
            tooltip: Some("Open it".into()),
        },
    )
    .unwrap();
    wb.set_hyperlink(
        s,
        Hyperlink {
            r0: 2,
            c0: 4,
            r1: 3,
            c1: 5,
            target: LinkTarget::Location {
                location: "'Sheet1'!A1".into(),
            },
            display: None,
            tooltip: None,
        },
    )
    .unwrap();
    wb
}

#[test]
fn built_annotations_roundtrip_with_parts() {
    let wb = built();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let mut want = wb.to_snapshot();
    // The writer adds every thread author to the person list.
    want.persons.push(Person::new("Bob", ""));
    for p in &mut want.persons {
        p.id = p.guid();
        p.initials.clear();
    }
    for sh in &mut want.sheets {
        for t in &mut sh.threads {
            t.author.id = t.author.guid();
            t.author.initials.clear();
            for r in &mut t.replies {
                r.author.id = r.author.guid();
            }
        }
    }
    assert_eq!(back.to_snapshot(), want);
    assert_eq!(
        fmt_xlsx::write(&back).unwrap(),
        fmt_xlsx::write(&fmt_xlsx::read(&fmt_xlsx::write(&back).unwrap()).unwrap()).unwrap()
    );

    let sheet = part(&bytes, "/xl/worksheets/sheet1.xml");
    let links = &sheet[sheet.find("<hyperlinks>").unwrap()..sheet.find("</hyperlinks>").unwrap()];
    insta::assert_snapshot!("comments_hyperlinks_xml", pretty(links));
    assert!(sheet.contains(r#"<legacyDrawing r:id="rId2"/>"#), "{sheet}");
    insta::assert_snapshot!(
        "comments_sheet1_rels",
        pretty(&rels(&bytes, "/xl/worksheets/sheet1.xml"))
    );
    insta::assert_snapshot!(
        "comments_comments1_xml",
        pretty(&part(&bytes, "/xl/comments1.xml"))
    );
    insta::assert_snapshot!(
        "comments_vml_drawing1",
        pretty(&part(&bytes, "/xl/drawings/vmlDrawing1.vml"))
    );
    insta::assert_snapshot!(
        "comments_threaded_comment1_xml",
        pretty(&part(&bytes, "/xl/threadedComments/threadedComment1.xml"))
    );
    insta::assert_snapshot!(
        "comments_person_xml",
        pretty(&part(&bytes, "/xl/persons/person.xml"))
    );
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    for (name, want) in [
        (
            "/xl/comments1.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml",
        ),
        (
            "/xl/drawings/vmlDrawing1.vml",
            "application/vnd.openxmlformats-officedocument.vmlDrawing",
        ),
        (
            "/xl/threadedComments/threadedComment1.xml",
            "application/vnd.ms-excel.threadedcomments+xml",
        ),
        (
            "/xl/persons/person.xml",
            "application/vnd.ms-excel.person+xml",
        ),
    ] {
        assert_eq!(
            pkg.content_type_of(&PartName::new(name).unwrap()),
            Some(want)
        );
    }
    assert!(rels(&bytes, "/xl/workbook.xml").contains("persons/person.xml"));
}

#[test]
fn missing_vml_is_tolerated_and_placeholders_without_threads_stay_notes() {
    let wb = built();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let mut pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    pkg.remove_part(&PartName::new("/xl/drawings/vmlDrawing1.vml").unwrap());
    pkg.remove_part(&PartName::new("/xl/threadedComments/threadedComment1.xml").unwrap());
    let sheet = PartName::new("/xl/worksheets/sheet1.xml").unwrap();
    let r = pkg.relationships_mut(&sheet).unwrap();
    let ids: Vec<String> = r
        .iter()
        .filter(|x| x.target.contains("vml") || x.target.contains("threaded"))
        .map(|x| x.id.clone())
        .collect();
    for id in ids {
        r.remove(&id);
    }
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    let s = back.sheet_id("Sheet1").unwrap();
    assert!(
        warnings.iter().any(|w| w.contains("default boxes")),
        "{warnings:?}"
    );
    let n = back.note_at(CellCoord::new(s, 1, 1)).unwrap();
    assert_eq!((n.visible, n.bounds), (false, None));
    assert!(back.threads(s).is_empty());
    // Without the threaded part, an older app's view: the placeholder.
    let ph = back.note_at(CellCoord::new(s, 0, 0)).unwrap();
    assert!(ph.plain_text().starts_with("[Threaded comment]"));
    assert!(ph.plain_text().contains("Reply:\n    The 2026 list."));
}
