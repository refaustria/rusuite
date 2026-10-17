//! P9-C1: Move or Copy (a copy at any position, one undo step), hidden /
//! very hidden sheets and the active sheet in the file.

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost};
use model_sheet::SheetId;

fn names(h: &CalcHost) -> Vec<String> {
    h.doc()
        .workbook()
        .sheets()
        .into_iter()
        .map(|(_, n)| n)
        .collect()
}

fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for name in ["Sheet2", "Sheet3"] {
        h.apply(C::AddSheet {
            name: name.into(),
            index: None,
        })
        .unwrap();
    }
    h.apply(C::SetInput {
        sheet: 0,
        row: 0,
        col: 0,
        input: "=Sheet1!B1+1".into(),
    })
    .unwrap();
    h
}

#[test]
fn copy_lands_at_the_chosen_position_and_undo_removes_it() {
    let mut h = book();
    h.apply(C::DuplicateSheet {
        sheet: 0,
        name: "Sheet1 (2)".into(),
        index: Some(3),
    })
    .unwrap();
    assert_eq!(names(&h), ["Sheet1", "Sheet2", "Sheet3", "Sheet1 (2)"]);
    let copy = h.doc().workbook().sheet_id("Sheet1 (2)").unwrap();
    let input = h
        .doc()
        .cell_view(model_sheet::CellCoord::new(copy, 0, 0))
        .input;
    assert_eq!(input, "='Sheet1 (2)'!B1+1");
    h.undo().unwrap();
    assert_eq!(names(&h), ["Sheet1", "Sheet2", "Sheet3"]);
    h.redo().unwrap();
    assert_eq!(names(&h), ["Sheet1", "Sheet2", "Sheet3", "Sheet1 (2)"]);
    // Before the first sheet.
    h.apply(C::DuplicateSheet {
        sheet: 2,
        name: "Sheet3 (2)".into(),
        index: Some(0),
    })
    .unwrap();
    assert_eq!(names(&h)[0], "Sheet3 (2)");
    let e = h
        .apply(C::DuplicateSheet {
            sheet: 0,
            name: "X".into(),
            index: Some(9),
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_sheet_index");
}

#[test]
fn hidden_states_and_the_active_sheet_roundtrip() {
    let mut h = book();
    h.apply(C::SetSheetHidden {
        sheet: 1,
        hidden: true,
        very_hidden: None,
    })
    .unwrap();
    h.apply(C::SetSheetHidden {
        sheet: 2,
        hidden: true,
        very_hidden: Some(true),
    })
    .unwrap();
    h.doc_mut()
        .workbook_mut()
        .set_active_sheet(Some(SheetId(0)));
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, _) = CalcDocument::open_xlsx(&bytes, "h.xlsx").unwrap();
    let wb = doc.workbook();
    assert!(wb.is_sheet_hidden(SheetId(1)) && !wb.is_sheet_very_hidden(SheetId(1)));
    assert!(wb.is_sheet_very_hidden(SheetId(2)));
    assert_eq!(doc.info().active_sheet, 0);
    // A hidden active sheet falls back to the first visible one.
    let mut h = book();
    h.doc_mut()
        .workbook_mut()
        .set_active_sheet(Some(SheetId(2)));
    h.apply(C::SetSheetHidden {
        sheet: 2,
        hidden: true,
        very_hidden: None,
    })
    .unwrap();
    assert_eq!(h.doc().info().active_sheet, 0);
    h.doc_mut()
        .workbook_mut()
        .set_active_sheet(Some(SheetId(1)));
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, _) = CalcDocument::open_xlsx(&bytes, "a.xlsx").unwrap();
    assert_eq!(doc.info().active_sheet, 1);
}
