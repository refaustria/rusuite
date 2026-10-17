//! P9-C2: Auto Outline, Consolidate and Flash Fill as document commands
//! (undo identity, errors, the Consolidate_Area name).

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost, FlashCell, SheetRect};
use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::{ConsolidateFunction, WorkbookSnapshot};

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn snap(h: &CalcHost) -> WorkbookSnapshot {
    WorkbookSnapshot {
        styles: Vec::new(),
        ..h.doc().workbook().to_snapshot()
    }
}

fn undo_identity(h: &mut CalcHost, cmd: C) {
    let before = snap(h);
    h.apply(cmd.clone())
        .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
    let after = snap(h);
    h.undo().unwrap();
    assert_eq!(snap(h), before, "undo of {cmd:?}");
    h.redo().unwrap();
    assert_eq!(snap(h), after, "redo of {cmd:?}");
}

fn level(h: &CalcHost, row: u32) -> u8 {
    h.doc().workbook().row_info(SheetId(0), row).outline_level
}

#[test]
fn auto_outline_groups_detail_rows_and_needs_summaries() {
    let mut h = Host::new(CalcDocument::new());
    for (r, v) in [
        "1",
        "2",
        "3",
        "=SUM(A1:A3)",
        "4",
        "5",
        "=SUM(A5:A6)",
        "=A4+A7",
    ]
    .iter()
    .enumerate()
    {
        h.apply(set(0, r as u32, 0, v)).unwrap();
    }
    undo_identity(
        &mut h,
        C::AutoOutline {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
        },
    );
    let levels: Vec<u8> = (0..8).map(|r| level(&h, r)).collect();
    // The grand total A8 = A4+A7 sums the two subtotals: it groups
    // everything above it, the subtotals' detail one level deeper.
    assert_eq!(levels, [2, 2, 2, 1, 2, 2, 1, 0]);
    let mut h = Host::new(CalcDocument::new());
    h.apply(set(0, 0, 0, "x")).unwrap();
    assert!(h
        .apply(C::AutoOutline {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
        })
        .is_err());
}

#[test]
fn consolidate_by_labels_with_undo_and_area_name() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::AddSheet {
        name: "Q2".into(),
        index: None,
    })
    .unwrap();
    h.apply(C::AddSheet {
        name: "Total".into(),
        index: None,
    })
    .unwrap();
    let rows = [["", "Units"], ["Pen", "4"], ["Ink", "2"]];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            if !v.is_empty() {
                h.apply(set(0, r as u32, c as u32, v)).unwrap();
            }
        }
    }
    for (r, row) in [["", "Units"], ["Ink", "1"], ["Pad", "5"]]
        .iter()
        .enumerate()
    {
        for (c, v) in row.iter().enumerate() {
            if !v.is_empty() {
                h.apply(set(1, r as u32, c as u32, v)).unwrap();
            }
        }
    }
    let src = |sheet| SheetRect {
        sheet,
        r0: 0,
        c0: 0,
        r1: 2,
        c1: 1,
    };
    undo_identity(
        &mut h,
        C::Consolidate {
            sheet: 2,
            row: 0,
            col: 0,
            function: ConsolidateFunction::Sum,
            sources: vec![src(0), src(1)],
            top_row: true,
            left_col: true,
            links: false,
        },
    );
    let v = |r, c| h.doc().workbook().value(CellCoord::new(SheetId(2), r, c));
    assert_eq!(v(0, 1), Value::Text("Units".into()));
    assert_eq!(v(2, 0), Value::Text("Ink".into()));
    assert_eq!(v(2, 1), Value::Number(3.0));
    assert_eq!(v(3, 1), Value::Number(5.0));
    let area = h
        .doc()
        .workbook()
        .builtin_name(SheetId(2), model_sheet::BuiltinName::ConsolidateArea)
        .unwrap();
    assert_eq!(area.refers_to, "Total!$A$1:$B$4");
    // Links: formulas; not on a source's own sheet.
    h.apply(C::Consolidate {
        sheet: 2,
        row: 0,
        col: 4,
        function: ConsolidateFunction::Sum,
        sources: vec![src(0), src(1)],
        top_row: true,
        left_col: true,
        links: true,
    })
    .unwrap();
    assert_eq!(
        h.doc()
            .workbook()
            .formula_text(CellCoord::new(SheetId(2), 2, 5)),
        Some("=SUM(Sheet1!$B$3,'Q2'!$B$2)")
    );
    assert!(h
        .apply(C::Consolidate {
            sheet: 0,
            row: 10,
            col: 0,
            function: ConsolidateFunction::Sum,
            sources: vec![src(0)],
            top_row: false,
            left_col: false,
            links: true,
        })
        .is_err());
}

#[test]
fn flash_fill_writes_values_in_one_step() {
    let mut h = Host::new(CalcDocument::new());
    for (r, v) in ["Ada Lovelace", "Alan Turing", "Grace Hopper"]
        .iter()
        .enumerate()
    {
        h.apply(set(0, r as u32, 0, v)).unwrap();
    }
    h.apply(set(0, 0, 1, "Ada")).unwrap();
    undo_identity(
        &mut h,
        C::FlashFill {
            sheet: 0,
            col: 1,
            cells: vec![
                FlashCell {
                    row: 1,
                    input: "Alan".into(),
                },
                FlashCell {
                    row: 2,
                    input: "Grace".into(),
                },
            ],
        },
    );
    assert_eq!(
        h.doc().workbook().value(CellCoord::new(SheetId(0), 2, 1)),
        Value::Text("Grace".into())
    );
}
