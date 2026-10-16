//! P8-35: Excel tables in the document: commands, typing rules
//! (auto-expansion, calculated columns, header names), totals, filters
//! and undo identity.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost, RangeFormat};
use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::{
    CellStyle, Filter, Table, TableLook, TotalsCell, TotalsFunction, WorkbookSnapshot,
};
use serde_json::{json, Value as Json};

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

const DATA: [[&str; 3]; 5] = [
    ["Item", "Qty", "Price"],
    ["Pen", "4", "1.5"],
    ["Ink", "2", "8"],
    ["Pad", "10", "0.5"],
    ["Pen", "1", "1.5"],
];

fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in DATA.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(r as u32, c as u32, v)).unwrap();
        }
    }
    h
}

fn create(h: &mut CalcHost) -> u32 {
    h.apply(C::CreateTable {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        has_headers: true,
        style: None,
    })
    .unwrap();
    table(h).id
}

fn table(h: &CalcHost) -> Table {
    h.doc().workbook().tables(SheetId(0))[0].clone()
}

/// The workbook without its style table (interned styles stay after an
/// undo; cells keep their ids).
fn snap(h: &CalcHost) -> WorkbookSnapshot {
    WorkbookSnapshot {
        styles: Vec::new(),
        ..h.doc().workbook().to_snapshot()
    }
}

fn value(h: &CalcHost, row: u32, col: u32) -> Value {
    h.doc()
        .workbook()
        .value(CellCoord::new(SheetId(0), row, col))
}

fn input(h: &CalcHost, row: u32, col: u32) -> String {
    model_sheet::content_to_input(
        h.doc()
            .workbook()
            .content(CellCoord::new(SheetId(0), row, col)),
    )
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

/// Applies `cmd`, checks that undo restores the snapshot and redo the
/// result.
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

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

#[test]
fn create_table_from_a_cell() {
    let mut h = book();
    undo_identity(
        &mut h,
        C::CreateTable {
            sheet: 0,
            r0: 2,
            c0: 1,
            r1: 2,
            c1: 1,
            has_headers: true,
            style: None,
        },
    );
    let t = table(&h);
    assert_eq!(
        (t.name.as_str(), t.r0, t.c0, t.r1, t.c1),
        ("Table1", 0, 0, 4, 2)
    );
    assert_eq!(t.style, "TableStyleMedium2");
    assert!(t.header_row && t.look.banded_rows && t.auto_filter.is_some());
    let names: Vec<&str> = t.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Item", "Qty", "Price"]);
    // The sheet list carries the table.
    let info = ok(&mut h, json!({"type": "info"}));
    assert_eq!(info["info"]["sheets"][0]["tables"][0]["name"], "Table1");
    // A second table cannot overlap.
    let e = h
        .apply(C::CreateTable {
            sheet: 0,
            r0: 1,
            c0: 1,
            r1: 3,
            c1: 3,
            has_headers: true,
            style: None,
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_table");
}

#[test]
fn create_without_headers_inserts_a_header_row() {
    let mut h = book();
    undo_identity(
        &mut h,
        C::CreateTable {
            sheet: 0,
            r0: 1,
            c0: 0,
            r1: 4,
            c1: 1,
            has_headers: false,
            style: Some("TableStyleLight9".into()),
        },
    );
    let t = table(&h);
    assert_eq!((t.r0, t.r1, t.c1), (1, 5, 1));
    assert_eq!(value(&h, 1, 0), Value::Text("Column1".into()));
    assert_eq!(value(&h, 1, 1), Value::Text("Column2".into()));
    assert_eq!(value(&h, 2, 0), Value::Text("Pen".into()));
    assert_eq!(value(&h, 5, 1), n(1.0));
    // Column C (outside the selection) did not move.
    assert_eq!(value(&h, 1, 2), n(1.5));
    assert_eq!(t.style, "TableStyleLight9");
}

#[test]
fn duplicate_and_empty_headers_become_unique() {
    let mut h = book();
    h.apply(set(0, 1, "Item")).unwrap();
    h.apply(set(0, 2, "")).unwrap();
    create(&mut h);
    let t = table(&h);
    let names: Vec<&str> = t.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Item", "Item2", "Column3"]);
    assert_eq!(input(&h, 0, 1), "Item2");
    assert_eq!(input(&h, 0, 2), "Column3");
}

#[test]
fn structured_references_and_expansion_below() {
    let mut h = book();
    create(&mut h);
    h.apply(set(0, 5, "=SUM(Table1[Qty])")).unwrap();
    assert_eq!(value(&h, 0, 5), n(17.0));
    // Typing directly below the table adds a row; the SUM follows.
    undo_identity(&mut h, set(5, 1, "3"));
    assert_eq!(table(&h).r1, 5);
    assert_eq!(value(&h, 0, 5), n(20.0));
    // Right of the table: a new column named after the typed header.
    undo_identity(&mut h, set(0, 3, "Note"));
    let t = table(&h);
    assert_eq!((t.c1, t.columns[3].name.as_str()), (3, "Note"));
    // In a data row: a new column `Column5`.
    h.apply(set(2, 4, "x")).unwrap();
    let t = table(&h);
    assert_eq!((t.c1, t.columns[4].name.as_str()), (4, "Column5"));
    assert_eq!(input(&h, 0, 4), "Column5");
}

#[test]
fn calculated_columns_fill_and_inherit() {
    let mut h = book();
    create(&mut h);
    h.apply(set(0, 3, "Total")).unwrap();
    undo_identity(&mut h, set(1, 3, "=[@Qty]*[@Price]"));
    let t = table(&h);
    assert_eq!(
        t.columns[3].calculated_formula.as_deref(),
        Some("[@Qty]*[@Price]")
    );
    for (r, v) in [(1, 6.0), (2, 16.0), (3, 5.0), (4, 1.5)] {
        assert_eq!(value(&h, r, 3), n(v), "row {r}");
        assert_eq!(input(&h, r, 3), "=[@Qty]*[@Price]");
    }
    // A new row inherits the formula.
    h.apply(set(5, 0, "Cap")).unwrap();
    assert_eq!(input(&h, 5, 3), "=[@Qty]*[@Price]");
    h.apply(set(5, 1, "2")).unwrap();
    h.apply(set(5, 2, "3")).unwrap();
    assert_eq!(value(&h, 5, 3), n(6.0));
    // A relative A1 formula is shifted per row.
    h.apply(set(0, 4, "Twice")).unwrap();
    h.apply(set(3, 4, "=B4*2")).unwrap();
    assert_eq!(input(&h, 1, 4), "=B2*2");
    assert_eq!(input(&h, 5, 4), "=B6*2");
    assert_eq!(
        table(&h).columns[4].calculated_formula.as_deref(),
        Some("B2*2")
    );
    // A constant in a calculated column is an exception.
    h.apply(set(2, 3, "7")).unwrap();
    assert_eq!(value(&h, 2, 3), n(7.0));
    assert_eq!(input(&h, 3, 3), "=[@Qty]*[@Price]");
}

#[test]
fn header_edits_rename_columns_and_formulas_follow() {
    let mut h = book();
    create(&mut h);
    h.apply(set(0, 5, "=SUM(Table1[Qty])")).unwrap();
    undo_identity(&mut h, set(0, 1, "Units"));
    assert_eq!(table(&h).columns[1].name, "Units");
    assert_eq!(input(&h, 0, 5), "=SUM(Table1[Units])");
    assert_eq!(value(&h, 0, 5), n(17.0));
    // A duplicate header gets a suffix; clearing names it `Column<n>`.
    h.apply(set(0, 2, "units")).unwrap();
    assert_eq!(table(&h).columns[2].name, "units2");
    assert_eq!(input(&h, 0, 2), "units2");
    undo_identity(
        &mut h,
        C::ClearRange {
            sheet: 0,
            r0: 0,
            c0: 1,
            r1: 0,
            c1: 1,
        },
    );
    assert_eq!(table(&h).columns[1].name, "Column2");
    assert_eq!(input(&h, 0, 5), "=SUM(Table1[Column2])");
    assert_eq!(value(&h, 0, 5), n(17.0));
}

#[test]
fn rename_and_style() {
    let mut h = book();
    let id = create(&mut h);
    h.apply(set(0, 5, "=ROWS(Table1)+SUM(Table1[Qty])"))
        .unwrap();
    undo_identity(
        &mut h,
        C::RenameTable {
            id,
            name: "Orders".into(),
        },
    );
    assert_eq!(input(&h, 0, 5), "=ROWS(Orders)+SUM(Orders[Qty])");
    assert_eq!(value(&h, 0, 5), n(21.0));
    let e = h
        .apply(C::RenameTable {
            id,
            name: "A1".into(),
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_table");
    undo_identity(
        &mut h,
        C::SetTableStyle {
            id,
            style: Some("TableStyleDark4".into()),
            look: Some(TableLook {
                first_column: true,
                last_column: true,
                banded_rows: false,
                banded_columns: true,
            }),
        },
    );
    let t = table(&h);
    assert_eq!(t.style, "TableStyleDark4");
    assert!(t.look.banded_columns && !t.look.banded_rows);
}

#[test]
fn totals_row() {
    let mut h = book();
    let id = create(&mut h);
    h.apply(set(6, 0, "below")).unwrap();
    undo_identity(
        &mut h,
        C::SetTableOptions {
            id,
            header_row: None,
            totals_row: Some(true),
            filter_button: None,
        },
    );
    let t = table(&h);
    assert!(t.totals_row);
    assert_eq!(t.r1, 5);
    assert_eq!(input(&h, 5, 0), "Total");
    assert_eq!(input(&h, 5, 2), "=SUBTOTAL(109,[Price])");
    assert_eq!(value(&h, 5, 2), n(11.5));
    // The row below was empty: nothing moved.
    assert_eq!(value(&h, 6, 0), Value::Text("below".into()));
    // Average of Qty.
    undo_identity(
        &mut h,
        C::SetTotalsFunction {
            id,
            col: 1,
            totals: Some(TotalsCell::Function {
                function: TotalsFunction::Average,
            }),
        },
    );
    assert_eq!(input(&h, 5, 1), "=SUBTOTAL(101,[Qty])");
    assert_eq!(value(&h, 5, 1), n(17.0 / 4.0));
    // `[#Totals]` reads the row.
    h.apply(set(0, 6, "=Table1[[#Totals],[Qty]]")).unwrap();
    assert_eq!(value(&h, 0, 6), n(4.25));
    // Off: the row is cleared, the settings stay.
    undo_identity(
        &mut h,
        C::SetTableOptions {
            id,
            header_row: None,
            totals_row: Some(false),
            filter_button: None,
        },
    );
    assert_eq!(input(&h, 5, 1), "");
    assert!(table(&h).columns[1].totals.is_some());
    // On again: a non-empty row below shifts down (written without
    // typing, which would expand the table).
    h.apply(C::RestoreCells {
        sheet: 0,
        cells: vec![(5, 1, "occupied".into(), 0)],
    })
    .unwrap();
    h.apply(C::SetTableOptions {
        id,
        header_row: None,
        totals_row: Some(true),
        filter_button: None,
    })
    .unwrap();
    assert_eq!(value(&h, 6, 1), Value::Text("occupied".into()));
    assert_eq!(input(&h, 5, 1), "=SUBTOTAL(101,[Qty])");
}

#[test]
fn header_row_and_filter_button_options() {
    let mut h = book();
    let id = create(&mut h);
    undo_identity(
        &mut h,
        C::SetTableOptions {
            id,
            header_row: Some(false),
            totals_row: None,
            filter_button: None,
        },
    );
    let t = table(&h);
    assert!(!t.header_row && t.r0 == 1 && t.auto_filter.is_none());
    assert_eq!(input(&h, 0, 0), "");
    undo_identity(
        &mut h,
        C::SetTableOptions {
            id,
            header_row: Some(true),
            totals_row: None,
            filter_button: None,
        },
    );
    assert_eq!(table(&h).r0, 0);
    assert_eq!(input(&h, 0, 1), "Qty");
    undo_identity(
        &mut h,
        C::SetTableOptions {
            id,
            header_row: None,
            totals_row: None,
            filter_button: Some(true),
        },
    );
    undo_identity(
        &mut h,
        C::SetTableOptions {
            id,
            header_row: None,
            totals_row: None,
            filter_button: Some(false),
        },
    );
}

#[test]
fn table_filter() {
    let mut h = book();
    let id = create(&mut h);
    undo_identity(
        &mut h,
        C::SetTableFilter {
            id,
            col: 0,
            filter: Some(Filter::Values {
                values: vec!["Pen".into()],
            }),
        },
    );
    let wb = h.doc().workbook();
    assert!(wb.row_info(SheetId(0), 2).hidden && wb.row_info(SheetId(0), 3).hidden);
    assert!(!wb.row_info(SheetId(0), 1).hidden);
    let v = ok(
        &mut h,
        json!({"type": "tableFilterValues", "id": id, "col": 0}),
    );
    assert_eq!(v["values"][0]["display"], "Ink");
    h.apply(set(9, 0, "=SUBTOTAL(103,Table1[Item])")).unwrap();
    assert_eq!(value(&h, 9, 0), n(2.0));
}

#[test]
fn resize_insert_delete() {
    let mut h = book();
    let id = create(&mut h);
    h.apply(set(0, 3, "x")).unwrap(); // a new column D
    h.apply(set(0, 5, "=ROWS(Table1)&\"/\"&COLUMNS(Table1)"))
        .unwrap();
    h.apply(set(1, 3, "=[@Qty]+1")).unwrap();
    undo_identity(
        &mut h,
        C::ResizeTable {
            id,
            r0: 0,
            c0: 0,
            r1: 6,
            c1: 2,
        },
    );
    let t = table(&h);
    assert_eq!((t.r1, t.c1, t.columns.len()), (6, 2, 3));
    assert_eq!(value(&h, 0, 5), Value::Text("6/3".into()));
    assert!(h
        .apply(C::ResizeTable {
            id,
            r0: 1,
            c0: 0,
            r1: 6,
            c1: 2
        })
        .is_err());
    // Insert two rows above row 3: cells below move down, the table grows.
    h.apply(set(8, 1, "under")).unwrap();
    undo_identity(
        &mut h,
        C::InsertTableRows {
            id,
            at: 2,
            count: 2,
        },
    );
    assert_eq!(table(&h).r1, 8);
    assert_eq!(value(&h, 4, 0), Value::Text("Ink".into()));
    assert_eq!(value(&h, 10, 1), Value::Text("under".into()));
    undo_identity(
        &mut h,
        C::DeleteTableRows {
            id,
            at: 2,
            count: 2,
        },
    );
    assert_eq!(table(&h).r1, 6);
    assert_eq!(value(&h, 2, 0), Value::Text("Ink".into()));
    undo_identity(
        &mut h,
        C::InsertTableCols {
            id,
            at: 1,
            count: 1,
        },
    );
    let t = table(&h);
    assert_eq!((t.c1, t.columns[1].name.as_str()), (3, "Column2"));
    assert_eq!(value(&h, 1, 2), n(4.0));
    undo_identity(
        &mut h,
        C::DeleteTableCols {
            id,
            at: 1,
            count: 1,
        },
    );
    assert_eq!(table(&h).c1, 2);
    assert_eq!(value(&h, 1, 1), n(4.0));
}

#[test]
fn convert_to_range() {
    let mut h = book();
    let id = create(&mut h);
    h.apply(set(0, 5, "=SUM(Table1[Qty])")).unwrap();
    let bold = CellStyle {
        font: core_model::RunProperties {
            bold: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };
    undo_identity(
        &mut h,
        C::ConvertToRange {
            id,
            formats: vec![RangeFormat {
                r0: 0,
                c0: 0,
                r1: 0,
                c1: 2,
                patch: bold,
            }],
        },
    );
    assert!(h.doc().workbook().tables(SheetId(0)).is_empty());
    assert_eq!(input(&h, 0, 5), "=SUM($B$2:$B$5)");
    assert_eq!(value(&h, 0, 5), n(17.0));
    let st = h.doc().workbook().style(CellCoord::new(SheetId(0), 0, 1));
    assert_eq!(st.font.bold, Some(true));
}

#[test]
fn structural_edits_and_sheets_keep_tables() {
    let mut h = book();
    create(&mut h);
    h.apply(set(0, 5, "=SUM(Table1[Qty])")).unwrap();
    undo_identity(
        &mut h,
        C::InsertRows {
            sheet: 0,
            at: 2,
            count: 1,
        },
    );
    assert_eq!(table(&h).r1, 5);
    undo_identity(
        &mut h,
        C::DeleteCols {
            sheet: 0,
            at: 0,
            count: 1,
        },
    );
    undo_identity(
        &mut h,
        C::DuplicateSheet {
            sheet: 0,
            name: "Copy".into(),
        },
    );
    let s1 = h.doc().workbook().sheet_id("Copy").unwrap();
    assert_eq!(h.doc().workbook().tables(s1)[0].name, "Table2");
    let sheet = h.doc().workbook().sheet_id("Copy").unwrap().0;
    undo_identity(&mut h, C::DeleteSheet { sheet });
}

#[test]
fn snapshot_json_roundtrip_keeps_tables() {
    let mut h = book();
    let id = create(&mut h);
    h.apply(C::SetTableOptions {
        id,
        header_row: None,
        totals_row: Some(true),
        filter_button: None,
    })
    .unwrap();
    let json = ok(&mut h, json!({"type": "saveSnapshotJson"}))["json"].clone();
    let mut h2 = Host::new(CalcDocument::new());
    ok(&mut h2, json!({"type": "loadSnapshotJson", "json": json}));
    assert_eq!(snap(&h2), snap(&h));
    // .xlsx too.
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "t.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let back = WorkbookSnapshot {
        styles: Vec::new(),
        ..doc.workbook().to_snapshot()
    };
    assert_eq!(back, snap(&h));
}
