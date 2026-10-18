//! P9-C7: pane top-left cells, split panes, threaded comment persons and
//! mentions, note anchors, page breaks and picture anchors / crop.

use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_sheet::{SheetId, SheetView, Workbook};

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    String::from_utf8(
        pkg.part(&PartName::new(name).unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap()
}

#[test]
fn frozen_at_a_scroll_position_roundtrips_with_both_top_left_cells() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    wb.set_frozen_at(s, 5, 1, 19, 2).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        xml.contains(r#"<sheetView tabSelected="1" topLeftCell="C20" workbookViewId="0"><pane xSplit="1" ySplit="5" topLeftCell="D25" activePane="bottomRight" state="frozen"/>"#),
        "{xml}"
    );
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.sheet_view(s), wb.sheet_view(s));
}

#[test]
fn split_panes_and_the_scroll_position_roundtrip() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let view = SheetView {
        top_row: 3,
        left_col: 1,
        split_x: 2400,
        split_y: 1800,
        pane_row: 40,
        pane_col: 6,
        ..SheetView::default()
    };
    wb.set_sheet_view(s, view).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        xml.contains(
            r#"<pane xSplit="2400" ySplit="1800" topLeftCell="G41" activePane="bottomRight"/>"#
        ),
        "{xml}"
    );
    assert!(xml.contains(r#"topLeftCell="B4""#), "{xml}");
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.sheet_view(s), wb.sheet_view(s));
    // Only scrolled: the sheet view's topLeftCell alone.
    let mut wb = Workbook::new();
    wb.set_sheet_view(
        s,
        SheetView {
            top_row: 99,
            ..SheetView::default()
        },
    )
    .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        xml.contains(r#"<sheetView tabSelected="1" topLeftCell="A100" workbookViewId="0"/>"#),
        "{xml}"
    );
    assert_eq!(fmt_xlsx::read(&bytes).unwrap().sheet_view(s).top_row, 99);
}

#[test]
fn threaded_comment_mentions_and_person_ids_roundtrip() {
    use model_sheet::{Mention, Person, Reply, Thread};
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let ann = Person {
        id: "{11111111-1111-4111-8111-111111111111}".into(),
        name: "Ann Lee".into(),
        initials: String::new(),
        user_id: "ann@example.com".into(),
        provider_id: "AD".into(),
    };
    wb.set_persons(vec![ann.clone()]);
    let mention = Mention {
        person_id: ann.id.clone(),
        id: "{22222222-2222-4222-8222-222222222222}".into(),
        start: 0,
        length: 8,
    };
    wb.set_thread(
        s,
        Thread {
            id: "{33333333-3333-4333-8333-333333333333}".into(),
            row: 1,
            col: 1,
            author: ann.clone(),
            date: "2026-10-18T10:00:00.00".into(),
            text: "@Ann Lee please check".into(),
            resolved: true,
            replies: vec![Reply {
                id: "{44444444-4444-4444-8444-444444444444}".into(),
                author: Person::new("Bob", ""),
                date: "2026-10-18T11:00:00.00".into(),
                text: "done @Ann Lee".into(),
                mentions: vec![Mention {
                    start: 5,
                    ..mention.clone()
                }],
            }],
            mentions: vec![mention],
        },
    )
    .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let people = part(&bytes, "/xl/persons/person.xml");
    assert!(people.contains(r#"displayName="Ann Lee" id="{11111111-1111-4111-8111-111111111111}" userId="ann@example.com" providerId="AD""#), "{people}");
    let threads = part(&bytes, "/xl/threadedComments/threadedComment1.xml");
    assert!(
        threads.contains(r#"<mentions><mention mentionpersonId="{11111111-1111-4111-8111-111111111111}" mentionId="{22222222-2222-4222-8222-222222222222}" startIndex="0" length="8"/></mentions>"#),
        "{threads}"
    );
    assert!(threads.contains(r#"done="1""#), "{threads}");
    let back = fmt_xlsx::read(&bytes).unwrap();
    let (a, b) = (&back.threads(s)[0], &wb.threads(s)[0]);
    assert_eq!(
        (&a.text, &a.mentions, a.resolved, &a.author),
        (&b.text, &b.mentions, b.resolved, &b.author)
    );
    // Bob gets the GUID derived from his name in the person list.
    assert_eq!(
        (
            &a.replies[0].text,
            &a.replies[0].mentions,
            &a.replies[0].author.name
        ),
        (
            &b.replies[0].text,
            &b.replies[0].mentions,
            &b.replies[0].author.name
        )
    );
    assert_eq!(back.persons()[0].user_id, "ann@example.com");
    assert_eq!(back.persons()[0].provider_id, "AD");
}
