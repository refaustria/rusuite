//! P8-30: pivot table commands (undo identity), requests, read-only
//! cells, stale caches and the wire shapes.

use app_common::Host;
use calc_core::{
    dispatch, CalcCommand as C, CalcDocument, CalcHost, PivotPatch, PivotSourceSpec, PivotTarget,
};
use model_sheet::pivot::{AxisField, DataField, PageField, PivotCache, PivotFields, PivotLayout};
use model_sheet::SheetSnapshot;
use serde_json::{json, Value as Json};

const SALES: [[&str; 5]; 7] = [
    ["Region", "Product", "Qtr", "Sales", "Units"],
    ["East", "Apple", "Q1", "10", "1"],
    ["East", "Pear", "Q1", "20", "2"],
    ["East", "Apple", "Q2", "30", "3"],
    ["West", "Apple", "Q1", "40", "4"],
    ["West", "Pear", "Q2", "50", "5"],
    ["North", "Pear", "Q2", "60", "6"],
];

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in SALES.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(0, r as u32, c as u32, v)).unwrap();
        }
    }
    h
}

/// Cells, tables and caches (stale flags are not undone, as in Excel).
fn state(h: &CalcHost) -> (Vec<SheetSnapshot>, Vec<PivotCache>) {
    let snap = h.doc().workbook().to_snapshot();
    let caches = snap
        .pivot_caches
        .into_iter()
        .map(|c| PivotCache { stale: false, ..c })
        .collect();
    (snap.sheets, caches)
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn err(h: &mut CalcHost, req: Json) -> String {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    reply["err"]["code"].as_str().unwrap_or_default().to_owned()
}

fn create(target: PivotTarget, fields: PivotFields) -> C {
    C::CreatePivot {
        // A single cell: its current region A1:E7.
        source: PivotSourceSpec::Range {
            sheet: 0,
            r0: 2,
            c0: 1,
            r1: 2,
            c1: 1,
        },
        target,
        fields,
    }
}

fn by_region() -> PivotFields {
    PivotFields {
        rows: vec![0.into()],
        values: vec![DataField::sum(3)],
        ..Default::default()
    }
}

fn display(h: &CalcHost, sheet: u32, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(model_sheet::CellCoord::new(
            model_sheet::SheetId(sheet),
            row,
            col,
        ))
        .display
}

#[test]
fn pivot_commands_with_undo_identity() {
    let mut h = book();
    let start = state(&h);
    let cell = |row, col| PivotTarget::Cell { sheet: 0, row, col };
    let env = h.apply(create(cell(0, 7), by_region())).unwrap();
    assert_eq!(env.patch.pivot_sheets, [0]);
    assert_eq!(display(&h, 0, 4, 8), "210");
    let id = 1;
    let steps = vec![
        C::UpdatePivot {
            id,
            patch: PivotPatch {
                cols: Some(vec![2.into()]),
                ..Default::default()
            },
        },
        C::UpdatePivot {
            id,
            patch: PivotPatch {
                rows: Some(vec![0.into(), 1.into()]),
                layout: Some(PivotLayout::Tabular),
                name: Some("Sales pivot".into()),
                ..Default::default()
            },
        },
        C::ExpandCollapse {
            id,
            field: 0,
            item: Some(0),
            collapsed: true,
        },
        C::ExpandCollapse {
            id,
            field: 0,
            item: None,
            collapsed: false,
        },
        C::UpdatePivot {
            id,
            patch: PivotPatch {
                cols: Some(vec![]),
                filters: Some(vec![PageField {
                    field: 2,
                    selected: Default::default(),
                }]),
                ..Default::default()
            },
        },
        C::SetPageFilter {
            id,
            field: 2,
            selected: Some(vec![1]),
        },
        set(0, 6, 3, "100"),
        C::RefreshPivot { id: Some(id) },
        C::MovePivot {
            id,
            target: cell(20, 7),
        },
        C::MovePivot {
            id,
            target: PivotTarget::NewSheet,
        },
        create(PivotTarget::NewSheet, by_region()),
        set(0, 1, 3, "11"),
        C::RefreshPivot { id: None },
        C::DeletePivot { id },
        C::InsertRows {
            sheet: 0,
            at: 0,
            count: 2,
        },
        C::DeleteSheet { sheet: 2 },
    ];
    let mut states = vec![state(&h)];
    for cmd in steps {
        let label = format!("{cmd:?}");
        h.apply(cmd).unwrap_or_else(|e| panic!("{label}: {e}"));
        states.push(state(&h));
    }
    for (i, expected) in states.iter().enumerate().rev().skip(1) {
        h.undo().unwrap();
        assert!(&state(&h) == expected, "undo to state {i}");
    }
    h.undo().unwrap();
    assert!(state(&h) == start, "undo to start");
    for (i, expected) in states.iter().enumerate() {
        h.redo().unwrap();
        assert!(&state(&h) == expected, "redo to state {i}");
    }
}

#[test]
fn pivot_cells_are_read_only_and_errors_change_nothing() {
    let mut h = book();
    h.apply(create(
        PivotTarget::Cell {
            sheet: 0,
            row: 0,
            col: 7,
        },
        by_region(),
    ))
    .unwrap();
    let before = state(&h);
    let apply = |cmd: C| json!({"type":"apply","command":cmd});
    assert_eq!(err(&mut h, apply(set(0, 2, 8, "5"))), "pivot_cell");
    assert_eq!(
        err(
            &mut h,
            apply(C::ClearRange {
                sheet: 0,
                r0: 0,
                c0: 6,
                r1: 9,
                c1: 7
            })
        ),
        "pivot_cell"
    );
    assert_eq!(
        err(
            &mut h,
            apply(C::InsertRows {
                sheet: 0,
                at: 2,
                count: 1
            })
        ),
        "pivot_cell"
    );
    h.apply(set(0, 0, 10, "x")).unwrap();
    let before_x = state(&h);
    assert_eq!(
        err(
            &mut h,
            apply(C::UpdatePivot {
                id: 1,
                patch: PivotPatch {
                    cols: Some(vec![2.into()]),
                    ..Default::default()
                },
            })
        ),
        "pivot_overlap"
    );
    assert_eq!(
        err(&mut h, apply(C::DeletePivot { id: 9 })),
        "unknown_pivot"
    );
    assert_eq!(
        err(
            &mut h,
            apply(C::UpdatePivot {
                id: 1,
                patch: PivotPatch {
                    rows: Some(vec![AxisField::from(17)]),
                    ..Default::default()
                },
            })
        ),
        "invalid_pivot"
    );
    assert_eq!(
        err(
            &mut h,
            apply(create(
                PivotTarget::Cell {
                    sheet: 0,
                    row: 3,
                    col: 2
                },
                by_region()
            ))
        ),
        "pivot_overlap"
    );
    assert!(state(&h) == before_x);
    // Formats may change.
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 1,
        c0: 7,
        r1: 1,
        c1: 7,
        patch: model_sheet::CellStyle {
            fill: Some(model_sheet::Fill::Solid(core_model::Color::Rgb(
                core_model::Rgb::new(255, 255, 0),
            ))),
            ..Default::default()
        },
    })
    .unwrap();
    h.undo().unwrap();
    h.undo().unwrap();
    assert!(state(&h) == before);
}

#[test]
fn requests_views_and_stale_tables() {
    let mut h = book();
    let created = ok(
        &mut h,
        json!({"type":"apply","command":{
            "type":"createPivot",
            "source":{"kind":"range","sheet":0,"r0":0,"c0":0,"r1":6,"c1":4},
            "target":{"kind":"cell","sheet":0,"row":0,"col":7},
            "fields":{"rows":[{"field":0},{"field":1}],"cols":[{"field":2}],
                      "values":[{"field":3},{"field":4,"func":"count"}]}
        }}),
    );
    assert_eq!(created["envelope"]["patch"]["pivotSheets"], json!([0]));
    let info = ok(&mut h, json!({"type":"pivotInfo","id":1}));
    let info = &info["info"];
    assert_eq!(info["sheet"], 0);
    assert_eq!(info["table"]["name"], "PivotTable1");
    assert_eq!(info["captions"], json!(["Sum of Sales", "Count of Units"]));
    assert_eq!(info["fields"][0]["name"], "Region");
    assert_eq!(info["fields"][0]["area"], "rows");
    assert_eq!(info["fields"][2]["area"], "columns");
    assert_eq!(info["fields"][3]["value"], true);
    assert_eq!(info["fields"][3]["kind"], "number");
    assert_eq!(info["fields"][0]["items"], 3);
    assert_eq!(info["source"]["sheet"], "Sheet1");
    let at = ok(&mut h, json!({"type":"pivotAt","sheet":0,"row":3,"col":7}));
    assert_eq!(at["pivot"]["id"], 1);
    assert_eq!(at["pivot"]["cell"]["kind"], "rowLabel");
    assert_eq!(at["pivot"]["cell"]["level"], 0);
    assert_eq!(at["pivot"]["cell"]["collapsed"], false);
    assert_eq!(at["pivot"]["cell"]["field"], 0);
    let none = ok(&mut h, json!({"type":"pivotAt","sheet":0,"row":3,"col":0}));
    assert_eq!(none["pivot"], Json::Null);
    let items = ok(&mut h, json!({"type":"pivotItems","id":1,"field":0}));
    let labels: Vec<&str> = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["East", "North", "West"]);
    assert_eq!(items["items"][1]["index"], 2);
    assert_eq!(items["items"][1]["value"], json!({"t":"text","v":"North"}));
    assert_eq!(items["items"][1]["checked"], true);
    // Region snapshot: pivot summaries and cell roles (blank cells too).
    let snap = ok(
        &mut h,
        json!({"type":"snapshot","sheet":0,"r0":0,"c0":0,"r1":40,"c1":20}),
    );
    let snap = &snap["snapshot"];
    assert_eq!(snap["pivots"][0]["id"], 1);
    assert_eq!(snap["pivots"][0]["style"], "PivotStyleLight16");
    assert_eq!(snap["pivots"][0]["table"]["r0"], 0);
    let cells = snap["cells"].as_array().unwrap();
    let cell = |r: u32, c: u32| {
        cells
            .iter()
            .find(|x| x["row"] == r && x["col"] == c)
            .unwrap_or_else(|| panic!("no cell {r},{c}"))
    };
    assert_eq!(cell(0, 7)["pivot"]["kind"], "blank");
    assert_eq!(cell(0, 7)["display"], "");
    assert_eq!(cell(0, 8)["display"], "Column Labels");
    assert_eq!(cell(3, 7)["pivot"]["kind"], "rowLabel");
    assert_eq!(cell(3, 8)["pivot"]["kind"], "subtotal");
    // A source edit makes the table stale (not refreshed).
    let env = ok(
        &mut h,
        json!({"type":"apply","command":{"type":"setInput","sheet":0,"row":1,"col":3,"input":"15"}}),
    );
    assert_eq!(env["envelope"]["patch"]["stalePivots"], json!([1]));
    let info = ok(&mut h, json!({"type":"info"}));
    assert_eq!(info["info"]["stalePivots"], json!([1]));
    assert_eq!(display(&h, 0, 3, 8), "30");
    let env = ok(
        &mut h,
        json!({"type":"apply","command":{"type":"refreshPivot","id":1}}),
    );
    assert_eq!(env["envelope"]["patch"]["stalePivots"], json!([]));
    assert_eq!(display(&h, 0, 3, 8), "35");
    // Collapse by request shapes, page filters.
    ok(
        &mut h,
        json!({"type":"apply","command":{"type":"expandCollapse","id":1,"field":0,"item":0,"collapsed":true}}),
    );
    let items = ok(&mut h, json!({"type":"pivotItems","id":1,"field":0}));
    assert_eq!(items["items"][0]["collapsed"], true);
    ok(
        &mut h,
        json!({"type":"apply","command":{"type":"updatePivot","id":1,"patch":{"cols":[],"filters":[{"field":2}]}}}),
    );
    ok(
        &mut h,
        json!({"type":"apply","command":{"type":"setPageFilter","id":1,"field":2,"selected":[0]}}),
    );
    let items = ok(&mut h, json!({"type":"pivotItems","id":1,"field":2}));
    assert_eq!(items["items"][0]["checked"], true);
    assert_eq!(items["items"][1]["checked"], false);
    assert_eq!(display(&h, 0, 0, 8), "Q1");
    assert_eq!(
        err(
            &mut h,
            json!({"type":"apply","command":{"type":"setPageFilter","id":1,"field":0,"selected":null}})
        ),
        "invalid_pivot"
    );
}

#[test]
fn create_on_a_new_sheet_and_save() {
    let mut h = book();
    let env = h.apply(create(PivotTarget::NewSheet, by_region())).unwrap();
    let new = env.patch.activate_sheet.expect("new sheet");
    let sheets = env.patch.sheets.expect("sheet list");
    assert_eq!(sheets[0].name, "Sheet2");
    assert_eq!(sheets[0].id, new);
    assert_eq!(display(&h, new, 2, 0), "Row Labels");
    assert_eq!(display(&h, new, 6, 1), "210");
    // Saved and opened again: the table is there.
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "p.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = doc.workbook().sheet_id("Sheet2").unwrap();
    assert_eq!(doc.workbook().pivots(s).len(), 1);
    // Undo removes the sheet.
    h.undo().unwrap();
    assert_eq!(h.doc().workbook().sheets().len(), 1);
    assert!(h.doc().workbook().pivot_caches().is_empty());
    h.redo().unwrap();
    assert_eq!(display(&h, new, 6, 1), "210");
}
