//! P8-44: circular references (C-05) and number formats inherited by
//! formulas (C-19).

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost};
use model_sheet::{CellCoord, SheetId};

fn set(h: &mut CalcHost, row: u32, col: u32, input: &str) -> Option<String> {
    h.apply(C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    })
    .unwrap()
    .patch
    .cycle
}

fn display(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(0), row, col))
        .display
}

#[test]
fn circular_reference_shows_zero_and_keeps_the_warning() {
    let mut h = Host::new(CalcDocument::new());
    set(&mut h, 6, 1, "5");
    assert_eq!(set(&mut h, 7, 1, "=B8+1").as_deref(), Some("B8"));
    assert_eq!(display(&h, 7, 1), "0");
    // A dependent of the cycle sees the 0.
    set(&mut h, 8, 1, "=B8*2+1");
    assert_eq!(display(&h, 8, 1), "1");
    // Other edits keep reporting the cycle while it exists.
    assert_eq!(set(&mut h, 0, 0, "x").as_deref(), Some("B8"));
    // Fixing it ends the warning.
    assert_eq!(set(&mut h, 7, 1, "=B7+1"), None);
    assert_eq!(display(&h, 7, 1), "6");
    assert_eq!(set(&mut h, 0, 0, "y"), None);
    // Undo brings the cycle (and the warning) back.
    let env = h.undo().unwrap().unwrap();
    assert_eq!(env.patch.cycle, None, "undoing `y` keeps the fixed formula");
    let env = h.undo().unwrap().unwrap();
    assert_eq!(env.patch.cycle.as_deref(), Some("B8"));
}

#[test]
fn circular_reference_on_another_sheet_is_prefixed() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::AddSheet {
        name: "Data 2".into(),
        index: None,
    })
    .unwrap();
    let cycle = h
        .apply(C::SetInput {
            sheet: 1,
            row: 0,
            col: 0,
            input: "=A1".into(),
        })
        .unwrap()
        .patch
        .cycle;
    assert_eq!(cycle.as_deref(), Some("'Data 2'!A1"));
}
