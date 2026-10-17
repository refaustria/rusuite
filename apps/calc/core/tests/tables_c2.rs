//! P9-C2: structured references follow table column deletes, renames
//! and resizes (formulas, names, rules), with undo.

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost, NameDef};
use engine_formula::{CellCoord, CellRect, ErrorKind, SheetId, Value};
use model_sheet::{CfKind, CfRule, DxfStyle, Table, WorkbookSnapshot};

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

const DATA: [[&str; 4]; 4] = [
    ["Item", "Qty", "Price", "Tax"],
    ["Pen", "4", "1.5", "1"],
    ["Ink", "2", "8", "2"],
    ["Pad", "10", "0.5", "3"],
];

fn book() -> (CalcHost, u32) {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in DATA.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(r as u32, c as u32, v)).unwrap();
        }
    }
    h.apply(C::CreateTable {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 3,
        c1: 3,
        has_headers: true,
        style: None,
    })
    .unwrap();
    let id = table(&h).id;
    (h, id)
}

fn table(h: &CalcHost) -> Table {
    h.doc().workbook().tables(SheetId(0))[0].clone()
}

fn snap(h: &CalcHost) -> WorkbookSnapshot {
    WorkbookSnapshot {
        styles: Vec::new(),
        ..h.doc().workbook().to_snapshot()
    }
}

fn text(h: &CalcHost, row: u32, col: u32) -> String {
    model_sheet::content_to_input(
        h.doc()
            .workbook()
            .content(CellCoord::new(SheetId(0), row, col)),
    )
}

fn value(h: &CalcHost, row: u32, col: u32) -> Value {
    h.doc()
        .workbook()
        .value(CellCoord::new(SheetId(0), row, col))
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

fn rule(formula: &str) -> CfRule {
    CfRule {
        ranges: vec![CellRect {
            r0: 1,
            c0: 0,
            r1: 3,
            c1: 0,
        }],
        dxf: Some(DxfStyle {
            bold: Some(true),
            ..Default::default()
        }),
        ..CfRule::new(CfKind::Expression {
            formula: formula.into(),
        })
    }
}

#[test]
fn deleting_a_table_column_rewrites_dependents() {
    let (mut h, id) = book();
    h.apply(set(8, 0, "=SUM(Table1[Qty])")).unwrap();
    h.apply(set(9, 0, "=SUM(Table1[Price])")).unwrap();
    h.apply(set(10, 0, "=SUM(Table1[[Qty]:[Tax]])")).unwrap();
    h.apply(C::DefineName {
        def: NameDef {
            name: "Q".into(),
            sheet: None,
            refers_to: "Table1[Qty]".into(),
            comment: None,
            hidden: false,
            builtin: None,
        },
    })
    .unwrap();
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: rule("[@Qty]>3"),
    })
    .unwrap();
    undo_identity(
        &mut h,
        C::DeleteTableCols {
            id,
            at: 1,
            count: 1,
        },
    );
    assert_eq!(text(&h, 8, 0), "=SUM(#REF!)");
    assert_eq!(value(&h, 8, 0), Value::Error(ErrorKind::Ref));
    // The neighbour column is untouched, the range shrinks.
    assert_eq!(text(&h, 9, 0), "=SUM(Table1[Price])");
    assert_eq!(value(&h, 9, 0), Value::Number(10.0));
    assert_eq!(text(&h, 10, 0), "=SUM(Table1[[Price]:[Tax]])");
    assert_eq!(value(&h, 10, 0), Value::Number(16.0));
    let wb = h.doc().workbook();
    assert_eq!(
        wb.engine()
            .name("Q", model_sheet::NameScope::Workbook)
            .unwrap()
            .formula,
        "#REF!"
    );
    match &wb.cf_rules(SheetId(0))[0].kind {
        CfKind::Expression { formula } => assert_eq!(formula, "#REF!>3"),
        k => panic!("{k:?}"),
    }
}

#[test]
fn deleting_sheet_columns_through_a_table_rewrites_references() {
    let (mut h, _) = book();
    h.apply(set(8, 5, "=SUM(Table1[Price])+SUM(Table1[Qty])"))
        .unwrap();
    undo_identity(
        &mut h,
        C::DeleteCols {
            sheet: 0,
            at: 2,
            count: 1,
        },
    );
    assert_eq!(text(&h, 8, 4), "=SUM(#REF!)+SUM(Table1[Qty])");
    assert_eq!(table(&h).columns.len(), 3);
}

#[test]
fn calculated_columns_follow_a_delete() {
    let (mut h, _) = book();
    // A calculated column E = [@Qty]*[@Price] (typed in the first data row).
    h.apply(C::InsertTableCols {
        id: table(&h).id,
        at: 4,
        count: 1,
    })
    .unwrap();
    h.apply(set(1, 4, "=[@Qty]*[@Price]")).unwrap();
    assert_eq!(value(&h, 3, 4), Value::Number(5.0));
    let id = table(&h).id;
    h.apply(C::DeleteTableCols {
        id,
        at: 2,
        count: 1,
    })
    .unwrap();
    assert_eq!(text(&h, 1, 3), "=[@Qty]*#REF!");
    let t = table(&h);
    assert_eq!(
        t.columns[3].calculated_formula.as_deref(),
        Some("[@Qty]*#REF!")
    );
}

#[test]
fn renaming_a_column_rewrites_rules_and_inserting_keeps_references() {
    let (mut h, id) = book();
    h.apply(set(8, 0, "=SUM(Table1[Qty])")).unwrap();
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: rule("[@Qty]>3"),
    })
    .unwrap();
    // Typing a new header renames the column.
    undo_identity(&mut h, set(0, 1, "Units"));
    assert_eq!(text(&h, 8, 0), "=SUM(Table1[Units])");
    match &h.doc().workbook().cf_rules(SheetId(0))[0].kind {
        CfKind::Expression { formula } => assert_eq!(formula, "[@Units]>3"),
        k => panic!("{k:?}"),
    }
    undo_identity(
        &mut h,
        C::InsertTableCols {
            id,
            at: 1,
            count: 2,
        },
    );
    assert_eq!(text(&h, 8, 0), "=SUM(Table1[Units])");
    assert_eq!(value(&h, 8, 0), Value::Number(16.0));
}

#[test]
fn resizing_a_table_smaller_rewrites_dropped_columns() {
    let (mut h, id) = book();
    h.apply(set(8, 0, "=SUM(Table1[Tax])")).unwrap();
    h.apply(set(9, 0, "=SUM(Table1[Qty])")).unwrap();
    undo_identity(
        &mut h,
        C::ResizeTable {
            id,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 2,
        },
    );
    assert_eq!(text(&h, 8, 0), "=SUM(#REF!)");
    assert_eq!(text(&h, 9, 0), "=SUM(Table1[Qty])");
    // Growing keeps the references valid.
    h.apply(C::ResizeTable {
        id,
        r0: 0,
        c0: 0,
        r1: 5,
        c1: 2,
    })
    .unwrap();
    h.apply(set(4, 1, "5")).unwrap();
    assert_eq!(value(&h, 9, 0), Value::Number(21.0));
}

fn styles(names: &[&str], default: Option<&str>) -> model_sheet::TableStyles {
    model_sheet::TableStyles {
        custom: names
            .iter()
            .map(|n| model_sheet::CustomTableStyle {
                name: n.to_string(),
                elements: vec![model_sheet::TableStyleElement {
                    kind: model_sheet::TableStyleElementType::HeaderRow,
                    size: 1,
                    dxf: DxfStyle {
                        bold: Some(true),
                        ..Default::default()
                    },
                }],
            })
            .collect(),
        default_style: default.map(String::from),
    }
}

#[test]
fn custom_table_styles_new_default_rename_delete() {
    let (mut h, id) = book();
    undo_identity(
        &mut h,
        C::SetTableStyles {
            styles: styles(&["Mine"], Some("Mine")),
            renamed: Vec::new(),
        },
    );
    let env = h
        .apply(C::SetTableStyle {
            id,
            style: Some("Mine".into()),
            look: None,
        })
        .unwrap();
    assert!(env.patch.sheets.is_some());
    // A new table gets the default style.
    h.apply(set(10, 0, "X")).unwrap();
    h.apply(set(11, 0, "1")).unwrap();
    h.apply(C::CreateTable {
        sheet: 0,
        r0: 10,
        c0: 0,
        r1: 11,
        c1: 0,
        has_headers: true,
        style: None,
    })
    .unwrap();
    let all = h.doc().workbook().tables(SheetId(0)).to_vec();
    assert_eq!(all[1].style, "Mine");
    // Renamed: both tables follow; the default too.
    undo_identity(
        &mut h,
        C::SetTableStyles {
            styles: styles(&["Ours"], Some("Ours")),
            renamed: vec![calc_core::StyleRename {
                from: "Mine".into(),
                to: "Ours".into(),
            }],
        },
    );
    let all = h.doc().workbook().tables(SheetId(0)).to_vec();
    assert_eq!(
        (all[0].style.as_str(), all[1].style.as_str()),
        ("Ours", "Ours")
    );
    // Deleted: the tables get the default style.
    let env = h
        .apply(C::SetTableStyles {
            styles: styles(&[], None),
            renamed: Vec::new(),
        })
        .unwrap();
    assert!(env.patch.table_styles.is_some());
    let all = h.doc().workbook().tables(SheetId(0)).to_vec();
    assert_eq!(all[0].style, "TableStyleMedium2");
    h.undo().unwrap();
    assert_eq!(table(&h).style, "Ours");
    // Invalid lists are refused.
    assert!(h
        .apply(C::SetTableStyles {
            styles: styles(&["TableStyleLight1"], None),
            renamed: Vec::new(),
        })
        .is_err());
}

#[test]
fn deleting_a_table_column_beside_dependents_in_the_table_rows() {
    let (mut h, id) = book();
    h.apply(set(0, 5, "=SUM(Table1[Qty])")).unwrap();
    h.apply(set(1, 5, "=SUM(Table1[Price])")).unwrap();
    undo_identity(
        &mut h,
        C::DeleteTableCols {
            id,
            at: 1,
            count: 1,
        },
    );
    assert_eq!(text(&h, 0, 4), "=SUM(#REF!)");
    assert_eq!(text(&h, 1, 4), "=SUM(Table1[Price])");
    h.undo().unwrap();
    assert_eq!(text(&h, 0, 5), "=SUM(Table1[Qty])");
}
