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
