//! P9-C1: conditional formatting, data validation and pivot sources
//! follow Insert / Delete (rows, columns and cells) like Excel: ranges
//! inside the edit move, ranges overlapping its start or end grow or
//! shrink, ranges sticking out of an Insert / Delete Cells band are
//! split.

use app_common::Host;
use calc_core::{
    CalcCommand as C, CalcDocument, CalcHost, DeleteShift, InsertShift, PivotSourceSpec,
    PivotTarget,
};
use engine_formula::CellRect;
use model_sheet::pivot::{DataField, PivotFields, PivotSource};
use model_sheet::{CfKind, CfRule, CompareOp, DataValidation, SheetId, ValidationKind};

fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
    CellRect { r0, c0, r1, c1 }
}

fn with_rule(ranges: Vec<CellRect>) -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    let rule = CfRule {
        ranges: ranges.clone(),
        ..CfRule::new(CfKind::CellIs {
            op: CompareOp::GreaterThan,
            formulas: vec!["5".into()],
        })
    };
    h.apply(C::AddCfRule { sheet: 0, rule }).unwrap();
    let dv = DataValidation::new(
        ranges,
        ValidationKind::Whole {
            op: CompareOp::LessThan,
            f1: "100".into(),
            f2: None,
        },
    );
    h.apply(C::SetValidation {
        sheet: 0,
        validation: dv,
    })
    .unwrap();
    h
}

fn cf(h: &CalcHost) -> Vec<CellRect> {
    h.doc().workbook().cf_rules(SheetId(0))[0].ranges.clone()
}

fn dv(h: &CalcHost) -> Vec<CellRect> {
    h.doc().workbook().validations(SheetId(0))[0].ranges.clone()
}

fn both(h: &CalcHost) -> Vec<CellRect> {
    let c = cf(h);
    assert_eq!(c, dv(h), "validation and rule ranges differ");
    c
}

fn insert_cells(r0: u32, c0: u32, r1: u32, c1: u32, shift: InsertShift) -> C {
    C::InsertCells {
        sheet: 0,
        r0,
        c0,
        r1,
        c1,
        shift,
    }
}

fn delete_cells(r0: u32, c0: u32, r1: u32, c1: u32, shift: DeleteShift) -> C {
    C::DeleteCells {
        sheet: 0,
        r0,
        c0,
        r1,
        c1,
        shift,
    }
}

#[test]
fn insert_cells_inside_a_range_splits_it_and_keeps_the_moved_cells() {
    // A1:C10, Insert Cells B2:B3 shift down: column B grows to B12.
    let mut h = with_rule(vec![rect(0, 0, 9, 2)]);
    h.apply(insert_cells(1, 1, 2, 1, InsertShift::Down))
        .unwrap();
    assert_eq!(
        both(&h),
        vec![rect(0, 0, 9, 0), rect(0, 1, 11, 1), rect(0, 2, 9, 2)]
    );
    // Undo restores the single range.
    h.undo().unwrap();
    assert_eq!(both(&h), vec![rect(0, 0, 9, 2)]);
}

#[test]
fn insert_cells_overlapping_start_and_end_of_the_band() {
    // B1:D5; Insert Cells A3:B3 shift right (band = row 3, columns from A).
    let mut h = with_rule(vec![rect(0, 1, 4, 3)]);
    h.apply(insert_cells(2, 0, 2, 1, InsertShift::Right))
        .unwrap();
    assert_eq!(
        both(&h),
        vec![rect(0, 1, 1, 3), rect(2, 3, 2, 5), rect(3, 1, 4, 3)]
    );
    // B1:D5; Insert Cells C1:C2 shift down: band = column C, top rows.
    let mut h = with_rule(vec![rect(0, 1, 4, 3)]);
    h.apply(insert_cells(0, 2, 1, 2, InsertShift::Down))
        .unwrap();
    assert_eq!(
        both(&h),
        vec![rect(0, 1, 4, 1), rect(2, 2, 6, 2), rect(0, 3, 4, 3)]
    );
}

#[test]
fn delete_cells_shrink_and_split() {
    // A1:C10, Delete Cells B2:B3 shift up: column B shrinks to B8.
    let mut h = with_rule(vec![rect(0, 0, 9, 2)]);
    h.apply(delete_cells(1, 1, 2, 1, DeleteShift::Up)).unwrap();
    assert_eq!(
        both(&h),
        vec![rect(0, 0, 9, 0), rect(0, 1, 7, 1), rect(0, 2, 9, 2)]
    );
    // A range enclosed by the deleted cells disappears.
    let mut h = with_rule(vec![rect(3, 3, 4, 3)]);
    h.apply(delete_cells(2, 3, 6, 3, DeleteShift::Up)).unwrap();
    assert!(h.doc().workbook().cf_rules(SheetId(0)).is_empty());
    assert!(h.doc().workbook().validations(SheetId(0)).is_empty());
    h.undo().unwrap();
    assert_eq!(both(&h), vec![rect(3, 3, 4, 3)]);
}

#[test]
fn whole_rows_and_columns_inside_overlapping_and_enclosing() {
    // Inside: inserting a row in A2:A10 grows it.
    let mut h = with_rule(vec![rect(1, 0, 9, 0)]);
    h.apply(C::InsertRows {
        sheet: 0,
        at: 4,
        count: 2,
    })
    .unwrap();
    assert_eq!(both(&h), vec![rect(1, 0, 11, 0)]);
    // Overlapping the start: deleting rows 1..3 clips the top.
    let mut h = with_rule(vec![rect(1, 0, 9, 0)]);
    h.apply(C::DeleteRows {
        sheet: 0,
        at: 0,
        count: 3,
    })
    .unwrap();
    assert_eq!(both(&h), vec![rect(0, 0, 6, 0)]);
    // Overlapping the end: deleting columns C:E of A1:D1.
    let mut h = with_rule(vec![rect(0, 0, 0, 3)]);
    h.apply(C::DeleteCols {
        sheet: 0,
        at: 2,
        count: 3,
    })
    .unwrap();
    assert_eq!(both(&h), vec![rect(0, 0, 0, 1)]);
    // Enclosing: deleting rows around the whole range removes the rule.
    let mut h = with_rule(vec![rect(3, 0, 4, 0)]);
    h.apply(C::DeleteRows {
        sheet: 0,
        at: 2,
        count: 5,
    })
    .unwrap();
    assert!(h.doc().workbook().cf_rules(SheetId(0)).is_empty());
}

fn pivot_book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    let data = [
        ["Region", "Sales"],
        ["East", "10"],
        ["West", "20"],
        ["East", "30"],
    ];
    for (r, row) in data.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(C::SetInput {
                sheet: 0,
                row: r as u32,
                col: c as u32 + 1,
                input: (*v).into(),
            })
            .unwrap();
        }
    }
    h.apply(C::CreatePivot {
        source: PivotSourceSpec::Range {
            sheet: 0,
            r0: 0,
            c0: 1,
            r1: 3,
            c1: 2,
        },
        target: PivotTarget::Cell {
            sheet: 0,
            row: 0,
            col: 6,
        },
        fields: PivotFields {
            rows: vec![0.into()],
            values: vec![DataField::sum(1)],
            ..Default::default()
        },
    })
    .unwrap();
    h
}

fn source(h: &CalcHost) -> (u32, u32, u32, u32) {
    match &h.doc().workbook().pivot_caches()[0].source {
        PivotSource::Range { r0, c0, r1, c1, .. } => (*r0, *c0, *r1, *c1),
        other => panic!("{other:?}"),
    }
}

fn grand_total(h: &CalcHost) -> String {
    // G1 header, rows East/West, Grand Total in row 4 (col H).
    h.doc()
        .cell_view(model_sheet::CellCoord::new(SheetId(0), 3, 7))
        .display
}

#[test]
fn pivot_sources_follow_rows_columns_and_cells() {
    let mut h = pivot_book();
    assert_eq!(source(&h), (0, 1, 3, 2));
    assert_eq!(grand_total(&h), "60");
    // A column before the source moves it right (the pivot table too).
    h.apply(C::InsertCols {
        sheet: 0,
        at: 0,
        count: 1,
    })
    .unwrap();
    assert_eq!(source(&h), (0, 2, 3, 3));
    // Insert Cells inside the source (shift down in its columns): it grows.
    h.apply(insert_cells(2, 2, 2, 3, InsertShift::Down))
        .unwrap();
    assert_eq!(source(&h), (0, 2, 4, 3));
    h.apply(C::SetInput {
        sheet: 0,
        row: 2,
        col: 2,
        input: "West".into(),
    })
    .unwrap();
    h.apply(C::SetInput {
        sheet: 0,
        row: 2,
        col: 3,
        input: "5".into(),
    })
    .unwrap();
    // Refresh reads the moved and grown source: 10 + 5 + 20 + 30.
    h.apply(C::RefreshPivot { id: None }).unwrap();
    let total = h
        .doc()
        .cell_view(model_sheet::CellCoord::new(SheetId(0), 3, 8))
        .display;
    assert_eq!(total, "65");
    // Delete Cells of the source's top data row (shift up): it shrinks.
    h.apply(delete_cells(1, 2, 1, 3, DeleteShift::Up)).unwrap();
    assert_eq!(source(&h), (0, 2, 3, 3));
    h.apply(C::RefreshPivot { id: None }).unwrap();
    let total = h
        .doc()
        .cell_view(model_sheet::CellCoord::new(SheetId(0), 3, 8))
        .display;
    assert_eq!(total, "55");
}
