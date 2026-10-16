//! P8-44 (C-13): Insert / Delete Cells with a shift.

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost, DeleteShift, InsertShift};
use model_sheet::{CellCoord, CellStyle, SheetId};

fn host() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::AddSheet {
        name: "Sheet2".into(),
        index: None,
    })
    .unwrap();
    h
}

fn set(h: &mut CalcHost, row: u32, col: u32, input: &str) {
    h.apply(C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    })
    .unwrap();
}

fn at(sheet: u32, row: u32, col: u32) -> CellCoord {
    CellCoord::new(SheetId(sheet), row, col)
}

fn input(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc().cell_view(at(0, row, col)).input
}

fn display(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc().cell_view(at(0, row, col)).display
}

fn insert(r0: u32, c0: u32, r1: u32, c1: u32, shift: InsertShift) -> C {
    C::InsertCells {
        sheet: 0,
        r0,
        c0,
        r1,
        c1,
        shift,
    }
}

fn delete(r0: u32, c0: u32, r1: u32, c1: u32, shift: DeleteShift) -> C {
    C::DeleteCells {
        sheet: 0,
        r0,
        c0,
        r1,
        c1,
        shift,
    }
}

/// A1=5, B1=`=A1*2`, A2=7, C3=`=SUM(A1:A4)`, D3=`=SUM(A1:B4)`.
fn sample() -> CalcHost {
    let mut h = host();
    set(&mut h, 0, 0, "5");
    set(&mut h, 0, 1, "=A1*2");
    set(&mut h, 1, 0, "7");
    set(&mut h, 2, 2, "=SUM(A1:A4)");
    set(&mut h, 2, 3, "=SUM(A1:B4)");
    h
}

#[test]
fn insert_right_moves_the_row_and_its_references() {
    let mut h = sample();
    h.apply(insert(0, 0, 0, 0, InsertShift::Right)).unwrap();
    assert_eq!(input(&h, 0, 0), "");
    assert_eq!(input(&h, 0, 1), "5");
    assert_eq!(input(&h, 0, 2), "=B1*2");
    assert_eq!(display(&h, 0, 2), "10");
    // Row 2 did not move.
    assert_eq!(input(&h, 1, 0), "7");
    // A1:A4 is not inside the band (row 1 only): unchanged.
    assert_eq!(input(&h, 2, 2), "=SUM(A1:A4)");
    assert_eq!(display(&h, 2, 2), "7");
}

#[test]
fn insert_down_grows_a_column_range_inside_the_band() {
    let mut h = sample();
    h.apply(insert(1, 0, 1, 0, InsertShift::Down)).unwrap();
    assert_eq!(input(&h, 1, 0), "");
    assert_eq!(input(&h, 2, 0), "7");
    // Column A only: SUM(A1:A4) grows, SUM(A1:B4) sticks out of the band.
    assert_eq!(input(&h, 2, 2), "=SUM(A1:A5)");
    assert_eq!(input(&h, 2, 3), "=SUM(A1:B4)");
    assert_eq!(display(&h, 2, 2), "12");
    // B1's formula is outside the band and its reference A1 stays.
    assert_eq!(input(&h, 0, 1), "=A1*2");
}

#[test]
fn delete_left_gives_ref_errors_and_shrinks() {
    let mut h = sample();
    h.apply(delete(0, 0, 0, 0, DeleteShift::Left)).unwrap();
    assert_eq!(input(&h, 0, 0), "=#REF!*2");
    assert_eq!(display(&h, 0, 0), "#REF!");
    assert_eq!(input(&h, 1, 0), "7");
}

#[test]
fn delete_up_shrinks_a_range_inside_the_band() {
    let mut h = sample();
    h.apply(delete(1, 0, 1, 0, DeleteShift::Up)).unwrap();
    assert_eq!(input(&h, 1, 0), "");
    assert_eq!(input(&h, 2, 2), "=SUM(A1:A3)");
    assert_eq!(display(&h, 2, 2), "5");
}

#[test]
fn undo_and_redo_restore_the_exact_state() {
    for cmd in [
        insert(0, 0, 1, 0, InsertShift::Right),
        insert(0, 0, 0, 1, InsertShift::Down),
        delete(0, 0, 1, 0, DeleteShift::Left),
        delete(0, 0, 0, 1, DeleteShift::Up),
    ] {
        let mut h = sample();
        let before: Vec<String> = (0..4)
            .flat_map(|r| (0..6).map(move |c| (r, c)))
            .map(|(r, c)| input(&h, r, c))
            .collect();
        h.apply(cmd.clone()).unwrap();
        let after: Vec<String> = (0..4)
            .flat_map(|r| (0..6).map(move |c| (r, c)))
            .map(|(r, c)| input(&h, r, c))
            .collect();
        h.undo().unwrap();
        let undone: Vec<String> = (0..4)
            .flat_map(|r| (0..6).map(move |c| (r, c)))
            .map(|(r, c)| input(&h, r, c))
            .collect();
        assert_eq!(undone, before, "{cmd:?}");
        h.redo().unwrap();
        let redone: Vec<String> = (0..4)
            .flat_map(|r| (0..6).map(move |c| (r, c)))
            .map(|(r, c)| input(&h, r, c))
            .collect();
        assert_eq!(redone, after, "{cmd:?}");
    }
}

#[test]
fn styles_move_with_the_cells() {
    let mut h = sample();
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        patch: CellStyle {
            number_format: Some("0.00".into()),
            ..Default::default()
        },
    })
    .unwrap();
    h.apply(insert(0, 0, 0, 0, InsertShift::Right)).unwrap();
    assert_eq!(display(&h, 0, 1), "5.00");
    assert_eq!(h.doc().workbook().cell_style_id(at(0, 0, 0)).0, 0);
    h.undo().unwrap();
    assert_eq!(display(&h, 0, 0), "5.00");
}

#[test]
fn references_from_other_sheets_follow() {
    let mut h = sample();
    h.apply(C::SetInput {
        sheet: 1,
        row: 0,
        col: 0,
        input: "=Sheet1!A2+1".into(),
    })
    .unwrap();
    h.apply(insert(1, 0, 1, 0, InsertShift::Right)).unwrap();
    assert_eq!(h.doc().cell_view(at(1, 0, 0)).input, "=Sheet1!B2+1");
    assert_eq!(h.doc().cell_view(at(1, 0, 0)).display, "8");
    h.undo().unwrap();
    assert_eq!(h.doc().cell_view(at(1, 0, 0)).input, "=Sheet1!A2+1");
}

#[test]
fn names_follow_the_cells() {
    let mut h = sample();
    h.apply(C::DefineName {
        def: serde_json::from_value(serde_json::json!({
            "name": "Second",
            "refersTo": "Sheet1!$A$2",
        }))
        .unwrap(),
    })
    .unwrap();
    h.apply(insert(1, 0, 1, 0, InsertShift::Down)).unwrap();
    let names = h.doc().workbook().names();
    let n = names.iter().find(|n| n.name == "Second").unwrap();
    assert_eq!(n.refers_to, "Sheet1!$A$3");
    h.undo().unwrap();
    let names = h.doc().workbook().names();
    let n = names.iter().find(|n| n.name == "Second").unwrap();
    assert_eq!(n.refers_to, "Sheet1!$A$2");
}

#[test]
fn merged_cells_in_the_way_are_refused() {
    let mut h = sample();
    h.apply(C::MergeCells {
        sheet: 0,
        r0: 0,
        c0: 3,
        r1: 1,
        c1: 4,
    })
    .unwrap();
    // The merge spans rows 1-2; shifting row 1 only would cut it.
    let err = h.apply(insert(0, 0, 0, 0, InsertShift::Right)).unwrap_err();
    assert_eq!(err.code(), "shift_merged");
    // Shifting both rows moves the merge along.
    h.apply(insert(0, 0, 1, 0, InsertShift::Right)).unwrap();
    let merges = h.doc().workbook().merges(SheetId(0)).to_vec();
    assert_eq!((merges[0].c0, merges[0].c1), (4, 5));
    // A merge elsewhere does not matter.
    h.apply(insert(5, 0, 5, 0, InsertShift::Right)).unwrap();
}

#[test]
fn tables_and_filters_in_the_way_are_refused() {
    let mut h = sample();
    h.apply(C::SetAutoFilter {
        sheet: 0,
        range: Some(calc_core::Rect {
            r0: 5,
            c0: 0,
            r1: 8,
            c1: 1,
        }),
    })
    .unwrap();
    let err = h.apply(insert(6, 0, 6, 0, InsertShift::Down)).unwrap_err();
    assert_eq!(err.code(), "shift_table");
    // Rows above the filter shifting right do not touch it.
    h.apply(insert(0, 0, 0, 0, InsertShift::Right)).unwrap();
}

#[test]
fn whole_columns_selected_insert_columns() {
    let mut h = sample();
    h.apply(insert(
        0,
        0,
        engine_formula::ast::MAX_ROW,
        0,
        InsertShift::Right,
    ))
    .unwrap();
    assert_eq!(input(&h, 1, 1), "7");
    assert_eq!(input(&h, 2, 3), "=SUM(B1:B4)");
}

#[test]
fn notes_and_rules_follow() {
    let mut h = sample();
    h.apply(C::SetNote {
        sheet: 0,
        row: 1,
        col: 0,
        text: vec![model_sheet::NoteRun {
            text: "hi".into(),
            font: Default::default(),
        }],
        author: None,
        visible: None,
        bounds: None,
    })
    .unwrap();
    h.apply(insert(1, 0, 1, 0, InsertShift::Right)).unwrap();
    let notes = h.doc().workbook().notes(SheetId(0)).to_vec();
    assert_eq!((notes[0].row, notes[0].col), (1, 1));
    h.undo().unwrap();
    let notes = h.doc().workbook().notes(SheetId(0)).to_vec();
    assert_eq!((notes[0].row, notes[0].col), (1, 0));
}

#[test]
fn pushing_cells_off_the_sheet_is_refused() {
    let mut h = sample();
    set(&mut h, 0, engine_formula::ast::MAX_COL, "edge");
    let err = h.apply(insert(0, 0, 0, 0, InsertShift::Right)).unwrap_err();
    assert_eq!(err.code(), "invalid_coord");
    assert_eq!(input(&h, 0, 0), "5");
}

#[test]
fn validation_ranges_and_formulas_follow() {
    use engine_formula::CellRect;
    use model_sheet::{DataValidation, ListSource, ValidationKind};
    let mut h = sample();
    let list = DataValidation::new(
        vec![CellRect {
            r0: 0,
            c0: 4,
            r1: 3,
            c1: 4,
        }],
        ValidationKind::List {
            source: ListSource::Formula {
                formula: "$A$1:$A$3".into(),
            },
        },
    );
    h.apply(C::SetValidation {
        sheet: 0,
        validation: list,
    })
    .unwrap();
    // Column A only, from row 2: the list source grows.
    h.apply(insert(1, 0, 1, 0, InsertShift::Down)).unwrap();
    let dv = h.doc().workbook().validations(SheetId(0)).to_vec();
    let ValidationKind::List {
        source: ListSource::Formula { formula },
    } = &dv[0].kind
    else {
        panic!("list")
    };
    assert_eq!(formula, "$A$1:$A$4");
    // Column E, rows 1-4: the validated cells move down with E2:E4.
    h.apply(insert(0, 4, 0, 4, InsertShift::Down)).unwrap();
    let dv = h.doc().workbook().validations(SheetId(0)).to_vec();
    assert_eq!((dv[0].ranges[0].r0, dv[0].ranges[0].r1), (1, 4));
    h.undo().unwrap();
    h.undo().unwrap();
    let dv = h.doc().workbook().validations(SheetId(0)).to_vec();
    assert_eq!((dv[0].ranges[0].r0, dv[0].ranges[0].r1), (0, 3));
}
