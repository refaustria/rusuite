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

fn format_cell(h: &mut CalcHost, row: u32, col: u32, code: &str) {
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: row,
        c0: col,
        r1: row,
        c1: col,
        patch: model_sheet::CellStyle {
            number_format: Some(code.into()),
            ..Default::default()
        },
    })
    .unwrap();
}

fn format_of(h: &CalcHost, row: u32, col: u32) -> Option<String> {
    h.doc()
        .workbook()
        .style(CellCoord::new(SheetId(0), row, col))
        .number_format
        .clone()
}

#[test]
fn formulas_inherit_the_referenced_cells_format() {
    let mut h = Host::new(CalcDocument::new());
    set(&mut h, 0, 0, "12%");
    assert_eq!(format_of(&h, 0, 0).as_deref(), Some("0%"));
    // QA C-19: =A1*2 → 24 %.
    set(&mut h, 0, 1, "=A1*2");
    assert_eq!(format_of(&h, 0, 1).as_deref(), Some("0%"));
    assert_eq!(display(&h, 0, 1), "24%");
    // A plain reference, with a sign and parentheses.
    set(&mut h, 1, 0, "3/4/2024");
    set(&mut h, 1, 1, "=-(A2)+1");
    assert_eq!(format_of(&h, 1, 1), format_of(&h, 1, 0));
    // The first formatted reference wins.
    set(&mut h, 2, 0, "7");
    format_cell(&mut h, 2, 2, "#,##0.00");
    set(&mut h, 2, 3, "=A3+C3");
    assert_eq!(format_of(&h, 2, 3).as_deref(), Some("#,##0.00"));
    // Undo removes the format with the formula.
    h.undo().unwrap();
    assert_eq!(format_of(&h, 2, 3), None);
}

#[test]
fn formulas_that_do_not_inherit() {
    let mut h = Host::new(CalcDocument::new());
    set(&mut h, 0, 0, "12%");
    // Functions, comparisons, text and ranges.
    for (col, f) in [
        (1, "=SUM(A1)"),
        (2, "=A1>0"),
        (3, "=A1&\"x\""),
        (4, "=A1:A2"),
    ] {
        set(&mut h, 0, col, f);
        assert_eq!(format_of(&h, 0, col), None, "{f}");
    }
    // A cell with its own format keeps it.
    format_cell(&mut h, 1, 1, "0.000");
    set(&mut h, 1, 1, "=A1");
    assert_eq!(format_of(&h, 1, 1).as_deref(), Some("0.000"));
    // A General reference gives nothing.
    set(&mut h, 2, 0, "5");
    set(&mut h, 2, 1, "=A3*2");
    assert_eq!(format_of(&h, 2, 1), None);
}
