use app_common::Host;
use calc_core::{
    dispatch, CalcCommand as C, CalcDocument, CalcHost, CalcPatch, CellKind, ColView, Rect,
    SheetViewPatch,
};
use core_model::{Color, Rgb};
use model_sheet::{CellStyle, Fill, SheetSnapshot};
use serde_json::{json, Value as Json};

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn fill(r: u8) -> CellStyle {
    CellStyle {
        fill: Some(Fill::Solid(Color::Rgb(Rgb::new(r, 0, 0)))),
        ..Default::default()
    }
}

fn sheets(host: &CalcHost) -> Vec<SheetSnapshot> {
    host.doc().workbook().to_snapshot().sheets
}

/// Every command kind, with formulas that structural edits rewrite
/// irreversibly (`#REF!`, ranges ending at the deleted row).
fn script() -> Vec<C> {
    let nf = CellStyle {
        number_format: Some("0.00".into()),
        ..Default::default()
    };
    vec![
        set(0, 0, 0, "1"),
        set(0, 1, 0, "2"),
        set(0, 2, 0, "3"),
        set(0, 0, 1, "=SUM(A1:A3)"),
        set(0, 1, 1, "=A3*10"),
        set(1, 0, 0, "=Sheet1!A2+Sheet1!B2"),
        set(0, 0, 0, "100"),
        set(0, 3, 3, "'0123"),
        C::SetFreeze {
            sheet: 0,
            rows: 2,
            cols: 1,
            top_row: None,
            left_col: None,
        },
        C::SetSheetView {
            sheet: 0,
            patch: SheetViewPatch {
                zoom: Some(150),
                show_gridlines: Some(false),
                ..Default::default()
            },
        },
        // A1:B2 clears A2, B1 and B2; A3:A4 is clipped away by the row
        // delete below; the inserts grow A1:B2 and the frozen panes.
        C::MergeCells {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 1,
            c1: 1,
        },
        C::MergeCells {
            sheet: 0,
            r0: 2,
            c0: 0,
            r1: 3,
            c1: 0,
        },
        C::ApplyStyle {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 1,
            patch: fill(200),
        },
        C::ApplyStyle {
            sheet: 0,
            r0: 1,
            c0: 1,
            r1: 1,
            c1: 1,
            patch: nf,
        },
        C::SetColWidth {
            sheet: 0,
            col: 1,
            width: Some(20.5),
        },
        C::SetRowHeight {
            sheet: 0,
            row: 2,
            height: Some(30.0),
        },
        C::SetColHidden {
            sheet: 0,
            col: 4,
            hidden: true,
        },
        C::SetRowHidden {
            sheet: 0,
            row: 1,
            hidden: true,
        },
        C::DeleteRows {
            sheet: 0,
            at: 2,
            count: 1,
        },
        C::InsertRows {
            sheet: 0,
            at: 1,
            count: 2,
        },
        C::InsertCols {
            sheet: 0,
            at: 0,
            count: 1,
        },
        C::DeleteCols {
            sheet: 0,
            at: 1,
            count: 1,
        },
        C::ClearRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 10,
            c1: 10,
        },
        set(0, 5, 5, "=Sheet2!A1"),
        C::RenameSheet {
            sheet: 1,
            name: "Data".into(),
        },
        C::SetSheetHidden {
            sheet: 1,
            hidden: true,
            very_hidden: None,
        },
        C::SetColWidth {
            sheet: 0,
            col: 1,
            width: None,
        },
        // Sheet operations (sheet 1 is "Data").
        set(0, 6, 6, "=Later!A1+Data!A1"),
        C::AddSheet {
            name: "Later".into(),
            index: Some(0),
        },
        set(2, 0, 0, "=Data!A1*2"),
        set(2, 1, 0, "=SUM(Sheet1!A1:B9)"),
        C::SetSheetTabColor {
            sheet: 2,
            color: Some(Color::Rgb(Rgb::new(1, 2, 3))),
        },
        C::SetSheetHidden {
            sheet: 2,
            hidden: true,
            very_hidden: Some(true),
        },
        C::SetSheetHidden {
            sheet: 2,
            hidden: false,
            very_hidden: None,
        },
        C::DuplicateSheet {
            sheet: 0,
            name: "Sheet1 (2)".into(),
            index: None,
        },
        C::UnmergeCells {
            sheet: 3,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 5,
        },
        C::MoveSheet { sheet: 3, index: 0 },
        C::SetSheetTabColor {
            sheet: 2,
            color: None,
        },
        C::DeleteSheet { sheet: 1 },
        C::DeleteSheet { sheet: 0 },
        C::RenameSheet {
            sheet: 2,
            name: "Data".into(),
        },
        C::DeleteSheet { sheet: 3 },
    ]
}

#[test]
fn every_command_undoes_and_redoes_exactly() {
    let mut host = Host::new(CalcDocument::new());
    host.apply(C::AddSheet {
        name: "Sheet2".into(),
        index: None,
    })
    .unwrap();
    host.mark_saved();
    // Sheet ids, order and tab colours, plus every sheet's contents.
    let sheets = |host: &CalcHost| (host.doc().info().sheets, sheets(host));
    let mut states = vec![sheets(&host)];
    for cmd in script() {
        host.apply(cmd.clone())
            .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
        states.push(sheets(&host));
    }
    // The script really produces irreversible reference rewrites.
    assert!(states.iter().any(|s| format!("{s:?}").contains("#REF!")));
    // ... and merges, frozen panes and (very) hidden sheets.
    for needle in [
        "MergeRect {",
        "frozen_rows: 4",
        "very_hidden: true",
        "hidden: true",
    ] {
        assert!(
            states.iter().any(|s| format!("{s:?}").contains(needle)),
            "{needle}"
        );
    }
    let n = states.len() - 1;
    for k in (0..n).rev() {
        host.undo().unwrap().unwrap();
        assert_eq!(sheets(&host), states[k], "after undoing to step {k}");
    }
    // Only the initial AddSheet is left (and undoing it removes Sheet2).
    assert!(!host.is_dirty());
    host.undo().unwrap().unwrap();
    assert!(!host.can_undo());
    assert_eq!(host.doc().info().sheets.len(), 1);
    host.redo().unwrap().unwrap();
    assert_eq!(sheets(&host), states[0]);
    for (k, state) in states.iter().enumerate().skip(1) {
        host.redo().unwrap().unwrap();
        assert_eq!(&sheets(&host), state, "after redoing step {k}");
    }
    assert!(!host.can_redo());
    // And once more down, through the redo-produced inverses.
    for k in (0..n).rev() {
        host.undo().unwrap().unwrap();
        assert_eq!(sheets(&host), states[k], "second undo to step {k}");
    }
}

fn patch_cells(p: &CalcPatch, sheet: u32) -> Vec<(u32, u32, String)> {
    p.cells
        .iter()
        .filter(|g| g.sheet == sheet)
        .flat_map(|g| g.cells.iter().map(|c| (c.row, c.col, c.display.clone())))
        .collect()
}

#[test]
fn patch_lists_exactly_the_changed_cells() {
    let mut host = Host::new(CalcDocument::new());
    for cmd in [
        set(0, 0, 0, "1"),
        set(0, 1, 0, "=A1*2"),
        set(0, 2, 0, "=A2+1"),
        set(0, 0, 1, "=5"),
        set(0, 1, 1, "=A1>100"),
    ] {
        host.apply(cmd).unwrap();
    }
    let env = host.apply(set(0, 0, 0, "10")).unwrap();
    assert_eq!(
        patch_cells(&env.patch, 0),
        [
            (0, 0, "10".to_string()),
            (1, 0, "20".to_string()),
            (2, 0, "21".to_string())
        ]
    );
    assert!(env.patch.cycle.is_none() && env.patch.styles.is_none());

    // A1>100 flips: now B2 is listed too.
    let env = host.apply(set(0, 0, 0, "1000")).unwrap();
    assert_eq!(patch_cells(&env.patch, 0).len(), 4);

    // A cycle is reported.
    let env = host.apply(set(0, 0, 0, "=A3")).unwrap();
    let cycle = env.patch.cycle.unwrap();
    // The first cell of the cycle (one sheet: no prefix).
    assert_eq!(cycle, "A1");
    let view = &env.patch.cells[0].cells[0];
    // Excel: a circular reference shows 0 (P8-44, C-05).
    assert_eq!((view.kind, view.display.as_str()), (CellKind::Number, "0"));
}

#[test]
fn style_and_dimension_patches() {
    let mut host = Host::new(CalcDocument::new());
    host.apply(set(0, 0, 0, "45306")).unwrap();
    let date = CellStyle {
        number_format: Some("yyyy-mm-dd".into()),
        ..Default::default()
    };
    let env = host
        .apply(C::ApplyStyle {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 1,
            patch: date.clone(),
        })
        .unwrap();
    let styles = env.patch.styles.as_ref().unwrap();
    assert_eq!(styles.len(), 2);
    assert_eq!(styles[1], date);
    let cells = &env.patch.cells[0].cells;
    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].display, "2024-01-15");
    assert_eq!(cells[0].kind, CellKind::Number);
    // The formula bar shows a date as Excel does (P8-39).
    assert_eq!(cells[0].input, "1/15/2024");
    assert_eq!(cells[1].style, 1);
    // Same style again: nothing changes, no table.
    let env = host
        .apply(C::ApplyStyle {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
            patch: date,
        })
        .unwrap();
    assert!(env.patch.cells.is_empty() && env.patch.styles.is_none());

    let env = host
        .apply(C::SetColWidth {
            sheet: 0,
            col: 3,
            width: Some(12.0),
        })
        .unwrap();
    assert_eq!(
        env.patch.cols[0].cols,
        [ColView {
            col: 3,
            width: Some(12.0),
            hidden: false,
            style: None,
            outline_level: 0,
            collapsed: false,
        }]
    );
    let env = host
        .apply(C::InsertRows {
            sheet: 0,
            at: 0,
            count: 1,
        })
        .unwrap();
    assert_eq!(env.patch.structural.len(), 1);
    assert!(env.patch.cells.is_empty());
}

#[test]
fn errors_leave_the_document_unchanged() {
    let mut host = Host::new(CalcDocument::new());
    host.apply(set(0, 0, 0, "1")).unwrap();
    host.apply(C::MergeCells {
        sheet: 0,
        r0: 0,
        c0: 2,
        r1: 1,
        c1: 3,
    })
    .unwrap();
    let before = sheets(&host);
    let rev = host.revision();
    for (cmd, code) in [
        (
            C::SetSheetHidden {
                sheet: 0,
                hidden: true,
                very_hidden: None,
            },
            "last_visible_sheet",
        ),
        (
            C::MergeCells {
                sheet: 0,
                r0: 4,
                c0: 4,
                r1: 4,
                c1: 4,
            },
            "invalid_merge",
        ),
        (
            C::MergeCells {
                sheet: 0,
                r0: 0,
                c0: 0,
                r1: 2,
                c1: 2,
            },
            "merge_overlap",
        ),
        (
            C::SetSheetView {
                sheet: 0,
                patch: SheetViewPatch {
                    zoom: Some(5),
                    ..Default::default()
                },
            },
            "invalid_view",
        ),
        (
            C::RestoreMerges {
                sheet: 0,
                merges: vec![
                    Rect {
                        r0: 0,
                        c0: 0,
                        r1: 1,
                        c1: 1,
                    },
                    Rect {
                        r0: 1,
                        c0: 1,
                        r1: 2,
                        c1: 2,
                    },
                ],
            },
            "merge_overlap",
        ),
        (set(0, 0, 0, "=1+"), "invalid_formula"),
        (set(5, 0, 0, "1"), "unknown_sheet"),
        (
            C::ClearRange {
                sheet: 0,
                r0: 2,
                c0: 0,
                r1: 1,
                c1: 0,
            },
            "invalid_range",
        ),
        (
            C::SetColWidth {
                sheet: 0,
                col: 0,
                width: Some(-1.0),
            },
            "invalid_dimension",
        ),
        (
            C::AddSheet {
                name: "sheet1".into(),
                index: None,
            },
            "duplicate_sheet",
        ),
        (
            C::AddSheet {
                name: "Other".into(),
                index: Some(2),
            },
            "invalid_sheet_index",
        ),
        (C::DeleteSheet { sheet: 0 }, "last_sheet"),
        (C::DeleteSheet { sheet: 3 }, "unknown_sheet"),
        (C::MoveSheet { sheet: 0, index: 1 }, "invalid_sheet_index"),
        (
            C::DuplicateSheet {
                sheet: 0,
                name: "SHEET1".into(),
                index: None,
            },
            "duplicate_sheet",
        ),
        (
            C::RestoreCells {
                sheet: 0,
                cells: vec![(0, 0, "7".into(), 0), (1, 0, "=(".into(), 0)],
            },
            "invalid_formula",
        ),
        (
            C::Compound {
                commands: vec![set(0, 0, 0, "9"), set(0, 0, 1, "=)")],
            },
            "invalid_formula",
        ),
    ] {
        let e = host.apply(cmd).unwrap_err();
        assert_eq!(e.code(), code, "{e}");
        assert_eq!(sheets(&host), before, "{code}");
    }
    assert_eq!(host.revision(), rev);
}

#[test]
fn region_snapshot_of_a_sparse_sheet() {
    let mut host = Host::new(CalcDocument::new());
    for cmd in [
        set(0, 0, 0, "a"),
        set(0, 500, 20, "=1/0"),
        set(0, 10, 2, "TRUE"),
        C::ApplyStyle {
            sheet: 0,
            r0: 7,
            c0: 7,
            r1: 7,
            c1: 7,
            patch: fill(1),
        },
        C::SetRowHeight {
            sheet: 0,
            row: 9,
            height: Some(40.0),
        },
        C::SetColHidden {
            sheet: 0,
            col: 30,
            hidden: true,
        },
    ] {
        host.apply(cmd).unwrap();
    }
    let snap = host.doc().snapshot(0, 5, 0, 99, 25).unwrap();
    let cells: Vec<_> = snap
        .cells
        .iter()
        .map(|c| (c.row, c.col, c.kind, c.display.as_str(), c.style))
        .collect();
    assert_eq!(
        cells,
        [
            (7, 7, CellKind::Empty, "", 1),
            (10, 2, CellKind::Bool, "TRUE", 0)
        ]
    );
    assert_eq!(snap.rows.len(), 1);
    assert_eq!(snap.rows[0].height, Some(40.0));
    assert!(snap.cols.is_empty());
    assert_eq!(snap.format.default_col_width, 8.43);

    let all = host.doc().snapshot(0, 0, 0, 1000, 40).unwrap();
    assert_eq!(all.cells.len(), 4);
    assert_eq!(all.cells[3].display, "#DIV/0!");
    assert_eq!(all.cols.len(), 1);

    assert_eq!(
        host.doc()
            .snapshot(0, 0, 0, 1_048_575, 16_383)
            .unwrap_err()
            .code(),
        "range_too_large"
    );
    assert_eq!(
        host.doc().snapshot(3, 0, 0, 1, 1).unwrap_err().code(),
        "unknown_sheet"
    );
}

fn call(host: &mut CalcHost, request: Json) -> Json {
    serde_json::from_str(&dispatch(host, &request.to_string())).unwrap()
}

#[test]
fn dispatch_roundtrip_for_every_request() {
    let mut host = CalcHost::new(CalcDocument::new());

    let r = call(&mut host, json!({"type": "info"}));
    assert_eq!(r["ok"]["type"], "info");
    assert_eq!(
        r["ok"]["info"]["sheets"],
        json!([{"id": 0, "name": "Sheet1"}])
    );
    assert_eq!(r["ok"]["info"]["styles"], json!([{}]));
    assert_eq!(r["ok"]["info"]["revision"], 0);

    let r = call(
        &mut host,
        json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": 1, "col": 2, "input": "=6*7"}}),
    );
    let env = &r["ok"]["envelope"];
    assert_eq!(r["ok"]["type"], "patch");
    assert_eq!(env["revision"], 1);
    assert_eq!(
        (env["canUndo"].as_bool(), env["dirty"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(
        env["patch"]["cells"],
        json!([{"sheet": 0, "cells": [{"row": 1, "col": 2, "input": "=6*7", "display": "42", "kind": "number", "style": 0}]}])
    );
    assert_eq!(env["patch"]["sheets"], Json::Null);
    assert_eq!(env["patch"]["structural"], json!([]));

    let r = call(
        &mut host,
        json!({"type": "apply", "command": {"type": "applyStyle", "sheet": 0, "r0": 0, "c0": 0, "r1": 0, "c1": 0,
            "patch": {"fill": {"kind": "solid", "color": {"kind": "rgb", "value": "FF0000"}}, "font": {"bold": true}}}}),
    );
    assert_eq!(
        r["ok"]["envelope"]["patch"]["styles"][1],
        json!({"font": {"bold": true}, "fill": {"kind": "solid", "color": {"kind": "rgb", "value": "FF0000"}}})
    );

    let r = call(
        &mut host,
        json!({"type": "snapshot", "sheet": 0, "r0": 0, "c0": 0, "r1": 9, "c1": 9}),
    );
    assert_eq!(r["ok"]["type"], "snapshot");
    assert_eq!(r["ok"]["snapshot"]["cells"].as_array().unwrap().len(), 2);
    assert_eq!(
        r["ok"]["snapshot"]["format"],
        json!({"defaultColWidth": 8.43, "defaultRowHeight": 15.0})
    );

    let r = call(&mut host, json!({"type": "undo"}));
    assert_eq!(r["ok"]["envelope"]["revision"], 3);
    assert_eq!(r["ok"]["envelope"]["canRedo"], true);
    let r = call(&mut host, json!({"type": "redo"}));
    assert_eq!(r["ok"]["envelope"]["revision"], 4);
    assert_eq!(
        r["ok"]["envelope"]["patch"]["cells"][0]["cells"][0]["style"],
        1
    );

    let r = call(&mut host, json!({"type": "saveSnapshotJson"}));
    assert_eq!(r["ok"]["type"], "snapshotJson");
    let saved = r["ok"]["json"].as_str().unwrap().to_string();
    assert!(saved.contains("=6*7"));

    let r = call(&mut host, json!({"type": "newDocument"}));
    assert_eq!(r["ok"]["info"]["revision"], 5);
    assert_eq!(r["ok"]["info"]["styles"], json!([{}]));
    let r = call(&mut host, json!({"type": "undo"}));
    assert_eq!(r["ok"]["envelope"]["canUndo"], false);
    assert_eq!(r["ok"]["envelope"]["revision"], 5);
    assert_eq!(r["ok"]["envelope"]["patch"]["cells"], json!([]));
    let r = call(&mut host, json!({"type": "redo"}));
    assert_eq!(r["ok"]["envelope"]["revision"], 5);

    let r = call(
        &mut host,
        json!({"type": "loadSnapshotJson", "json": saved}),
    );
    assert_eq!(r["ok"]["info"]["revision"], 6);
    assert_eq!(r["ok"]["info"]["styles"].as_array().unwrap().len(), 2);
    assert!(!host.is_dirty() && !host.can_undo());
    let r = call(
        &mut host,
        json!({"type": "snapshot", "sheet": 0, "r0": 1, "c0": 2, "r1": 1, "c1": 2}),
    );
    assert_eq!(r["ok"]["snapshot"]["cells"][0]["display"], "42");
}

#[test]
fn sheet_command_patches() {
    let mut host = Host::new(CalcDocument::new());
    let ids =
        |p: &CalcPatch| -> Vec<u32> { p.sheets.as_ref().unwrap().iter().map(|s| s.id).collect() };
    host.apply(C::AddSheet {
        name: "Sheet2".into(),
        index: None,
    })
    .unwrap();
    host.apply(set(1, 0, 0, "5")).unwrap();
    host.apply(set(0, 0, 0, "=Sheet2!A1")).unwrap();
    let p = host
        .apply(C::MoveSheet { sheet: 1, index: 0 })
        .unwrap()
        .patch;
    assert_eq!(ids(&p), [1, 0]);
    let red = Color::Rgb(Rgb::new(255, 0, 0));
    let p = host
        .apply(C::SetSheetTabColor {
            sheet: 1,
            color: Some(red),
        })
        .unwrap()
        .patch;
    assert_eq!(p.sheets.as_ref().unwrap()[0].tab_color, Some(red));
    assert_eq!(
        serde_json::to_value(&p.sheets.as_ref().unwrap()[0]).unwrap(),
        json!({"id": 1, "name": "Sheet2", "tabColor": {"kind": "rgb", "value": "FF0000"}})
    );

    let p = host.apply(C::DeleteSheet { sheet: 1 }).unwrap().patch;
    assert_eq!(ids(&p), [0]);
    assert_eq!(patch_cells(&p, 0), [(0, 0, "#REF!".to_string())]);
    assert!(patch_cells(&p, 1).is_empty());
    assert_eq!(p.cells[0].cells[0].input, "=#REF!");
    let p = host.undo().unwrap().unwrap().patch;
    assert_eq!(ids(&p), [1, 0]);
    assert_eq!(p.sheets.as_ref().unwrap()[0].tab_color, Some(red));
    assert!(patch_cells(&p, 0).contains(&(0, 0, "5".to_string())));
    assert!(patch_cells(&p, 1).contains(&(0, 0, "5".to_string())));

    let p = host
        .apply(C::DuplicateSheet {
            sheet: 1,
            name: "Sheet2 (2)".into(),
            index: None,
        })
        .unwrap()
        .patch;
    assert_eq!(ids(&p), [1, 2, 0]);
    let r = call(&mut host, json!({"type": "usedRange", "sheet": 2}));
    assert_eq!(r["ok"], json!({"type": "usedRange", "last": [0, 0]}));
    call(
        &mut host,
        json!({"type": "apply", "command": {"type": "addSheet", "name": "E", "index": 1}}),
    );
    let r = call(&mut host, json!({"type": "info"}));
    assert_eq!(r["ok"]["info"]["sheets"][1]["name"], "E");
    let r = call(&mut host, json!({"type": "usedRange", "sheet": 3}));
    assert_eq!(r["ok"], json!({"type": "usedRange", "last": null}));
}

#[test]
fn dispatch_errors() {
    let mut host = CalcHost::new(CalcDocument::new());
    let raw = dispatch(&mut host, "{not json");
    let r: Json = serde_json::from_str(&raw).unwrap();
    assert_eq!(r["err"]["code"], "bad_request");
    assert!(r["err"]["message"].as_str().unwrap().len() > 3);

    for (req, code) in [
        (json!({"type": "frobnicate"}), "bad_request"),
        (
            json!({"type": "apply", "command": {"type": "setInput", "sheet": 0}}),
            "bad_request",
        ),
        (
            json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": 0, "col": 0, "input": "=SUM("}}),
            "invalid_formula",
        ),
        (
            json!({"type": "snapshot", "sheet": 4, "r0": 0, "c0": 0, "r1": 0, "c1": 0}),
            "unknown_sheet",
        ),
        (
            json!({"type": "loadSnapshotJson", "json": "[]"}),
            "invalid_snapshot",
        ),
        (
            json!({"type": "loadSnapshotJson", "json": "{\"sheets\":[],\"styles\":[]}"}),
            "invalid_snapshot",
        ),
    ] {
        let r = call(&mut host, req.clone());
        assert_eq!(r["err"]["code"], code, "{req}");
        assert!(r.get("ok").is_none());
    }
    assert_eq!(host.revision().0, 0);
}

#[test]
fn commands_roundtrip_through_json() {
    for cmd in script() {
        let json = serde_json::to_string(&cmd).unwrap();
        assert_eq!(serde_json::from_str::<C>(&json).unwrap(), cmd, "{json}");
    }
    assert_eq!(
        serde_json::to_value(C::InsertRows {
            sheet: 1,
            at: 2,
            count: 3
        })
        .unwrap(),
        json!({"type": "insertRows", "sheet": 1, "at": 2, "count": 3})
    );
    let restore = C::Compound {
        commands: vec![C::RestoreCells {
            sheet: 0,
            cells: vec![(1, 2, "x".into(), 0)],
        }],
    };
    assert_eq!(
        serde_json::to_value(&restore).unwrap(),
        json!({"type": "compound", "commands": [{"type": "restoreCells", "sheet": 0, "cells": [[1, 2, "x", 0]]}]})
    );
}

#[test]
fn panes_hidden_sheets_and_merges() {
    let mut host = Host::new(CalcDocument::new());
    for name in ["B", "C"] {
        host.apply(C::AddSheet {
            name: name.into(),
            index: None,
        })
        .unwrap();
    }
    let rect = |r0, c0, r1, c1| Rect { r0, c0, r1, c1 };

    // Freeze: the sheet list carries the view.
    let p = host
        .apply(C::SetFreeze {
            sheet: 1,
            rows: 1,
            cols: 2,
            top_row: None,
            left_col: None,
        })
        .unwrap()
        .patch;
    let view = p.sheets.as_ref().unwrap()[1].view;
    assert_eq!((view.frozen_rows, view.frozen_cols, view.zoom), (1, 2, 100));
    let p = host
        .apply(C::SetSheetView {
            sheet: 1,
            patch: SheetViewPatch {
                zoom: Some(75),
                show_headings: Some(false),
                ..Default::default()
            },
        })
        .unwrap()
        .patch;
    let view = p.sheets.as_ref().unwrap()[1].view;
    assert_eq!(
        (view.frozen_rows, view.zoom, view.show_headings),
        (1, 75, false)
    );

    // Hiding switches to the next visible sheet, unhiding to the sheet.
    let p = host
        .apply(C::SetSheetHidden {
            sheet: 2,
            hidden: true,
            very_hidden: None,
        })
        .unwrap()
        .patch;
    assert_eq!(p.activate_sheet, Some(1));
    assert!(p.sheets.as_ref().unwrap()[2].hidden);
    let p = host
        .apply(C::SetSheetHidden {
            sheet: 0,
            hidden: true,
            very_hidden: None,
        })
        .unwrap()
        .patch;
    assert_eq!(p.activate_sheet, Some(1));
    let e = host
        .apply(C::SetSheetHidden {
            sheet: 1,
            hidden: true,
            very_hidden: None,
        })
        .unwrap_err();
    assert_eq!(e.code(), "last_visible_sheet");
    let e = host.apply(C::DeleteSheet { sheet: 1 }).unwrap_err();
    assert_eq!(e.code(), "last_visible_sheet");
    let p = host.undo().unwrap().unwrap().patch;
    assert_eq!(p.activate_sheet, Some(0));
    assert!(!p.sheets.as_ref().unwrap()[0].hidden);

    // Merging clears all but the top-left cell; undo brings them back.
    host.apply(set(1, 0, 0, "1")).unwrap();
    host.apply(set(1, 0, 1, "2")).unwrap();
    host.apply(set(1, 5, 0, "=A1+B1")).unwrap();
    let p = host
        .apply(C::MergeCells {
            sheet: 1,
            r0: 0,
            c0: 0,
            r1: 1,
            c1: 2,
        })
        .unwrap()
        .patch;
    assert_eq!(p.merges.len(), 1);
    assert_eq!(p.merges[0].sheet, 1);
    assert_eq!(p.merges[0].merges, [rect(0, 0, 1, 2)]);
    assert_eq!(
        patch_cells(&p, 1),
        [(0, 1, String::new()), (5, 0, "1".to_string())]
    );
    let snap = host.doc().snapshot(1, 1, 1, 9, 9).unwrap();
    assert_eq!(snap.merges, [rect(0, 0, 1, 2)]);
    assert!(host
        .doc()
        .snapshot(1, 2, 0, 9, 9)
        .unwrap()
        .merges
        .is_empty());
    let p = host.undo().unwrap().unwrap().patch;
    assert!(p.merges[0].merges.is_empty());
    assert!(patch_cells(&p, 1).contains(&(5, 0, "3".to_string())));
    host.redo().unwrap().unwrap();

    // Deleting the merged rows drops the merge and unfreezes; undo restores both.
    let p = host
        .apply(C::DeleteRows {
            sheet: 1,
            at: 0,
            count: 2,
        })
        .unwrap()
        .patch;
    assert!(p.merges[0].merges.is_empty());
    assert_eq!(p.sheets.as_ref().unwrap()[1].view.frozen_rows, 0);
    let p = host.undo().unwrap().unwrap().patch;
    assert_eq!(p.merges[0].merges, [rect(0, 0, 1, 2)]);
    assert_eq!(p.sheets.as_ref().unwrap()[1].view.frozen_rows, 1);

    let p = host
        .apply(C::UnmergeCells {
            sheet: 1,
            r0: 1,
            c0: 1,
            r1: 1,
            c1: 1,
        })
        .unwrap()
        .patch;
    assert!(p.merges[0].merges.is_empty());
    host.undo().unwrap().unwrap();
    assert_eq!(
        host.doc().workbook().merges(model_sheet::SheetId(1)).len(),
        1
    );

    // The JSON shapes the UI sends.
    let mut host = CalcHost::new(CalcDocument::new());
    for command in [
        json!({"type": "setFreeze", "sheet": 0, "rows": 1, "cols": 0}),
        json!({"type": "setSheetView", "sheet": 0, "patch": {"zoom": 120, "showGridlines": false}}),
        json!({"type": "mergeCells", "sheet": 0, "r0": 0, "c0": 0, "r1": 0, "c1": 3}),
        json!({"type": "addSheet", "name": "X"}),
        json!({"type": "setSheetHidden", "sheet": 1, "hidden": true}),
    ] {
        let r = call(&mut host, json!({"type": "apply", "command": command}));
        assert_eq!(r["ok"]["type"], "patch", "{r}");
    }
    let r = call(&mut host, json!({"type": "info"}));
    assert_eq!(
        r["ok"]["info"]["sheets"][0]["view"],
        // The scrolling pane starts after the frozen row (`pane/@topLeftCell`, P9-C7).
        json!({"frozenRows": 1, "frozenCols": 0, "paneRow": 1, "zoom": 120, "showGridlines": false, "showHeadings": true})
    );
    assert_eq!(r["ok"]["info"]["sheets"][1]["hidden"], true);
    let r = call(
        &mut host,
        json!({"type": "snapshot", "sheet": 0, "r0": 0, "c0": 2, "r1": 5, "c1": 5}),
    );
    assert_eq!(
        r["ok"]["snapshot"]["merges"],
        json!([{"r0": 0, "c0": 0, "r1": 0, "c1": 3}])
    );
}

/// P8-39 (C-02): typed percentages, currencies, dates and times become
/// numbers with Excel's format; the formula bar shows the edit form; a
/// Text cell keeps a typed number as text; undo restores the format.
#[test]
fn typed_entries_get_excel_formats() {
    let mut host = Host::new(CalcDocument::new());
    let cell = |host: &CalcHost, env: &app_common::Envelope<CalcPatch>| {
        let c = env.patch.cells[0].cells[0].clone();
        let format = host
            .doc()
            .workbook()
            .styles()
            .get(model_sheet::StyleId(c.style))
            .number_format
            .clone();
        (c.input, c.display, c.kind, format)
    };
    let cases = [
        ("12%", "12%", "12%", Some("0%")),
        (
            "$1,234.50",
            "1234.5",
            "$1,234.50 ",
            Some("\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)"),
        ),
        ("3/4/2024", "3/4/2024", "3/4/2024", Some("m/d/yyyy")),
        ("13:45", "1:45:00 PM", "13:45", Some("h:mm")),
        ("1 1/2", "1.5", "1 1/2", Some("# ?/?")),
    ];
    for (row, (typed, input, display, format)) in cases.into_iter().enumerate() {
        let env = host.apply(set(0, row as u32, 0, typed)).unwrap();
        let (i, d, kind, f) = cell(&host, &env);
        assert_eq!(
            (i.as_str(), d.as_str(), kind, f.as_deref()),
            (input, display, CellKind::Number, format),
            "{typed}"
        );
    }
    // Undo removes value and format in one step.
    host.undo().unwrap().unwrap();
    let wb = host.doc().workbook();
    let s = wb.sheet_id("Sheet1").unwrap();
    let c = model_sheet::CellCoord::new(s, 4, 0);
    assert!(wb.style(c).number_format.is_none());
    // A Text cell keeps "0123".
    host.apply(C::ApplyStyle {
        sheet: 0,
        r0: 9,
        c0: 0,
        r1: 9,
        c1: 0,
        patch: CellStyle {
            number_format: Some("@".into()),
            ..Default::default()
        },
    })
    .unwrap();
    let env = host.apply(set(0, 9, 0, "0123")).unwrap();
    let (i, d, kind, _) = cell(&host, &env);
    assert_eq!(
        (i.as_str(), d.as_str(), kind),
        ("'0123", "0123", CellKind::Text)
    );
    // A formatted cell keeps its format.
    host.apply(C::ApplyStyle {
        sheet: 0,
        r0: 10,
        c0: 0,
        r1: 10,
        c1: 0,
        patch: CellStyle {
            number_format: Some("0.000".into()),
            ..Default::default()
        },
    })
    .unwrap();
    let env = host.apply(set(0, 10, 0, "12%")).unwrap();
    assert_eq!(cell(&host, &env).1, "0.120");
}
