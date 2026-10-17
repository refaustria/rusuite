//! P9-C2: slicers in the document – insert, clicks on table and pivot
//! slicers, settings, Report Connections, delete, pruning with their
//! sources, undo identity and the xlsx round trip through `dispatch`.

use app_common::Host;
use calc_core::{
    dispatch, CalcCommand as C, CalcDocument, CalcHost, PivotSourceSpec, PivotTarget, SlicerPatch,
};
use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::pivot::{DataField, PivotFields};
use model_sheet::{CellOffset, ChartAnchor, SlicerSort, SlicerSource, WorkbookSnapshot};
use serde_json::{json, Value as Json};

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

const DATA: [[&str; 3]; 6] = [
    ["Region", "Product", "Sales"],
    ["East", "Apple", "10"],
    ["East", "Pear", "20"],
    ["West", "Apple", "30"],
    ["North", "Pear", "40"],
    ["West", "Pear", "50"],
];

fn anchor() -> ChartAnchor {
    ChartAnchor::OneCell {
        from: CellOffset {
            col: 5,
            row: 1,
            col_offset: 0,
            row_offset: 0,
        },
        width: 1_828_800,
        height: 2_524_125,
    }
}

/// The data as Table1 (A1:C6).
fn book() -> CalcHost {
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
        r1: 5,
        c1: 2,
        has_headers: true,
        style: None,
    })
    .unwrap();
    h
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

fn hidden_rows(h: &CalcHost) -> Vec<u32> {
    (1..=5)
        .filter(|r| h.doc().workbook().row_info(SheetId(0), *r).hidden)
        .collect()
}

fn insert_region(h: &mut CalcHost) {
    let t = h.doc().workbook().tables(SheetId(0))[0].clone();
    h.apply(C::InsertSlicers {
        sheet: 0,
        sources: vec![SlicerSource::Table {
            table: t.id,
            column: t.columns[0].id,
        }],
        anchor: anchor(),
    })
    .unwrap();
}

#[test]
fn insert_two_slicers_cascades_and_lists_buttons() {
    let mut h = book();
    let t = h.doc().workbook().tables(SheetId(0))[0].clone();
    let sources = t
        .columns
        .iter()
        .take(2)
        .map(|c| SlicerSource::Table {
            table: t.id,
            column: c.id,
        })
        .collect();
    let env = {
        undo_identity(
            &mut h,
            C::InsertSlicers {
                sheet: 0,
                sources,
                anchor: anchor(),
            },
        );
        h.apply(set(20, 0, "x")).unwrap()
    };
    // Edits refresh the sheet list (buttons).
    let info = env.patch.sheets.unwrap();
    let views = &info[0].slicers;
    assert_eq!(views.len(), 2);
    assert_eq!(views[1].slicer.name, "Product");
    let names: Vec<&str> = views[0].items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["East", "North", "West"]);
    match (views[0].slicer.anchor, views[1].slicer.anchor) {
        (ChartAnchor::OneCell { from: a, .. }, ChartAnchor::OneCell { from: b, .. }) => {
            assert_eq!((b.row - a.row, b.col - a.col), (2, 1));
        }
        x => panic!("{x:?}"),
    }
}

#[test]
fn clicking_a_table_slicer_filters_rows_with_undo() {
    let mut h = book();
    insert_region(&mut h);
    undo_identity(
        &mut h,
        C::SetSlicerSelection {
            cache: "Slicer_Region".into(),
            selected: Some(vec!["West".into()]),
        },
    );
    assert_eq!(hidden_rows(&h), [1, 2, 4]);
    let views = h.doc().info().sheets[0].slicers.clone();
    let sel: Vec<bool> = views[0].items.iter().map(|i| i.selected).collect();
    assert_eq!(sel, [false, false, true]);
    // Multi-select, then Clear Filter.
    h.apply(C::SetSlicerSelection {
        cache: "Slicer_Region".into(),
        selected: Some(vec!["West".into(), "East".into()]),
    })
    .unwrap();
    assert_eq!(hidden_rows(&h), [4]);
    undo_identity(
        &mut h,
        C::SetSlicerSelection {
            cache: "Slicer_Region".into(),
            selected: None,
        },
    );
    assert!(hidden_rows(&h).is_empty());
}

#[test]
fn settings_and_delete_clear_the_filter() {
    let mut h = book();
    insert_region(&mut h);
    let id = h.doc().workbook().slicers(SheetId(0))[0].id;
    undo_identity(
        &mut h,
        C::UpdateSlicer {
            id,
            patch: SlicerPatch {
                caption: Some("Gebiet".into()),
                columns: Some(3),
                style: Some("SlicerStyleDark3".into()),
                sort: Some(SlicerSort::Descending),
                ..Default::default()
            },
        },
    );
    let views = h.doc().info().sheets[0].slicers.clone();
    assert_eq!(views[0].slicer.caption, "Gebiet");
    assert_eq!(views[0].slicer.columns, 3);
    let names: Vec<&str> = views[0].items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, ["West", "North", "East"]);
    assert!(h
        .apply(C::UpdateSlicer {
            id,
            patch: SlicerPatch {
                style: Some("Fancy".into()),
                ..Default::default()
            },
        })
        .is_err());
    h.apply(C::SetSlicerSelection {
        cache: "Slicer_Region".into(),
        selected: Some(vec!["North".into()]),
    })
    .unwrap();
    assert_eq!(hidden_rows(&h), [1, 2, 3, 5]);
    undo_identity(&mut h, C::DeleteSlicer { id });
    assert!(h.doc().workbook().slicer_caches().is_empty());
    assert!(hidden_rows(&h).is_empty());
}

#[test]
fn deleting_the_column_removes_the_slicer_and_undo_brings_it_back() {
    let mut h = book();
    insert_region(&mut h);
    let id = h.doc().workbook().tables(SheetId(0))[0].id;
    let before = snap(&h);
    let env = h
        .apply(C::DeleteTableCols {
            id,
            at: 0,
            count: 1,
        })
        .unwrap();
    assert!(env.patch.sheets.unwrap()[0].slicers.is_empty());
    assert!(h.doc().workbook().slicer_caches().is_empty());
    h.undo().unwrap();
    assert_eq!(snap(&h), before);
    assert_eq!(h.doc().workbook().slicers(SheetId(0)).len(), 1);
}

fn pivot_book() -> (CalcHost, u32, u32) {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in DATA.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(r as u32, c as u32, v)).unwrap();
        }
    }
    let mut ids = Vec::new();
    for (col, rows) in [(6, 0), (10, 1)] {
        h.apply(C::CreatePivot {
            source: PivotSourceSpec::Range {
                sheet: 0,
                r0: 0,
                c0: 0,
                r1: 5,
                c1: 2,
            },
            target: PivotTarget::Cell {
                sheet: 0,
                row: 0,
                col,
            },
            fields: PivotFields {
                rows: vec![rows.into()],
                values: vec![DataField::sum(2)],
                ..Default::default()
            },
        })
        .unwrap();
        let wb = h.doc().workbook();
        ids.push(wb.pivots(SheetId(0)).last().unwrap().id);
    }
    (h, ids[0], ids[1])
}

fn grand_total(h: &CalcHost, id: u32) -> Value {
    let wb = h.doc().workbook();
    let e = wb.pivot_output(id).unwrap().extent;
    wb.value(CellCoord::new(SheetId(0), e.r1, e.c1))
}

#[test]
fn pivot_slicer_filters_connected_tables_with_undo() {
    let (mut h, a, b) = pivot_book();
    let cache = h.doc().workbook().pivot(a).unwrap().1.cache_id;
    h.apply(C::InsertSlicers {
        sheet: 0,
        sources: vec![SlicerSource::Pivot {
            cache,
            field: 0,
            pivots: vec![a],
        }],
        anchor: anchor(),
    })
    .unwrap();
    undo_identity(
        &mut h,
        C::SetSlicerSelection {
            cache: "Slicer_Region".into(),
            selected: Some(vec!["East".into()]),
        },
    );
    assert_eq!(grand_total(&h, a), Value::Number(30.0));
    assert_eq!(grand_total(&h, b), Value::Number(150.0));
    // Report Connections: B gets the filter too.
    undo_identity(
        &mut h,
        C::SetSlicerConnections {
            cache: "Slicer_Region".into(),
            pivots: vec![a, b],
        },
    );
    assert_eq!(grand_total(&h, b), Value::Number(30.0));
    // Deleting a pivot table drops it from the connections.
    h.apply(C::DeletePivot { id: b }).unwrap();
    match &h.doc().workbook().slicer_caches()[0].source {
        SlicerSource::Pivot { pivots, .. } => assert_eq!(pivots, &vec![a]),
        s => panic!("{s:?}"),
    }
    h.undo().unwrap();
    match &h.doc().workbook().slicer_caches()[0].source {
        SlicerSource::Pivot { pivots, .. } => assert_eq!(pivots, &vec![a, b]),
        s => panic!("{s:?}"),
    }
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

#[test]
fn slicers_survive_save_and_reopen() {
    let mut h = book();
    insert_region(&mut h);
    h.apply(C::SetSlicerSelection {
        cache: "Slicer_Region".into(),
        selected: Some(vec!["East".into()]),
    })
    .unwrap();
    let saved = ok(&mut h, json!({"type": "saveXlsx"}));
    let bytes = saved["bytesBase64"].as_str().unwrap().to_string();
    let mut h2 = Host::new(CalcDocument::new());
    let opened = ok(
        &mut h2,
        json!({"type": "openXlsx", "bytesBase64": bytes, "name": "s.xlsx"}),
    );
    assert!(
        opened["warnings"].as_array().unwrap().is_empty(),
        "{opened}"
    );
    let info = &opened["info"]["sheets"][0]["slicers"];
    assert_eq!(info[0]["slicer"]["name"], "Region", "{info}");
    assert_eq!(info[0]["items"][0]["selected"], true);
    assert_eq!(info[0]["items"][1]["selected"], false);
    assert_eq!(hidden_rows(&h2), [3, 4, 5]);
}

#[test]
fn a_slicer_on_a_deleted_sheet_goes_with_its_cache() {
    let mut h = book();
    h.apply(C::AddSheet {
        name: "Board".into(),
        index: None,
    })
    .unwrap();
    let board = h.doc().workbook().sheet_id("Board").unwrap();
    let t = h.doc().workbook().tables(SheetId(0))[0].clone();
    h.apply(C::InsertSlicers {
        sheet: board.0,
        sources: vec![SlicerSource::Table {
            table: t.id,
            column: t.columns[0].id,
        }],
        anchor: anchor(),
    })
    .unwrap();
    // A duplicate of the board has no slicers.
    h.apply(C::DuplicateSheet {
        sheet: board.0,
        name: "Board (2)".into(),
        index: None,
    })
    .unwrap();
    let copy = h.doc().workbook().sheet_id("Board (2)").unwrap();
    assert!(h.doc().workbook().slicers(copy).is_empty());
    let before = snap(&h);
    h.apply(C::DeleteSheet { sheet: board.0 }).unwrap();
    assert!(h.doc().workbook().slicer_caches().is_empty());
    h.undo().unwrap();
    assert_eq!(snap(&h), before);
}
