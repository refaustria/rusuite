//! P8-23: name commands (undo identity), Create from Selection, the
//! `names` / `nameAt` / `precedents` / `dependents` requests and the
//! number format fields of cell views.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost, NameDef, NameEdges};
use model_sheet::WorkbookSnapshot;
use serde_json::{json, Value as Json};

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn snap(h: &CalcHost) -> WorkbookSnapshot {
    h.doc().workbook().to_snapshot()
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn err(h: &mut CalcHost, cmd: &C) -> String {
    let reply: Json = serde_json::from_str(&dispatch(
        h,
        &json!({"type":"apply","command":cmd}).to_string(),
    ))
    .unwrap();
    reply["err"]["code"].as_str().unwrap_or("").to_string()
}

fn def(name: &str, sheet: Option<u32>, refers_to: &str) -> NameDef {
    NameDef {
        name: name.into(),
        sheet,
        refers_to: refers_to.into(),
        comment: None,
        hidden: false,
        builtin: None,
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

/// Sheet1 A1:B4: a header row and two number columns.
fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    let rows = [["Qty", "Price"], ["2", "10"], ["3", "20"], ["5", "30"]];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(0, r as u32, c as u32, v)).unwrap();
        }
    }
    h
}

#[test]
fn name_commands_have_undo_identity() {
    let mut h = book();
    h.apply(set(0, 0, 3, "=SUM(Qty)*Rate")).unwrap();
    assert_eq!(display(&h, 0, 0, 3), "#NAME?");
    let empty = snap(&h);
    let env = h
        .apply(C::DefineName {
            def: def("Qty", None, "=Sheet1!$A$2:$A$4"),
        })
        .unwrap();
    let names = env.patch.names.expect("names in the patch");
    assert_eq!(names[0].def.name, "Qty");
    let r = names[0].range.unwrap();
    assert_eq!((r.sheet, r.r0, r.c0, r.r1, r.c1), (0, 1, 0, 3, 0));
    h.apply(C::DefineName {
        def: NameDef {
            comment: Some("VAT".into()),
            ..def("Rate", None, "1.2")
        },
    })
    .unwrap();
    assert_eq!(display(&h, 0, 0, 3), "12");
    let two = snap(&h);
    let steps = [
        C::UpdateName {
            name: "rate".into(),
            sheet: None,
            def: def("Rate", Some(0), "2"),
        },
        C::DeleteName {
            name: "Qty".into(),
            sheet: None,
        },
        C::CreateNamesFromSelection {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 1,
            edges: NameEdges {
                top: true,
                ..NameEdges::default()
            },
        },
    ];
    let mut states = vec![two.clone()];
    for cmd in steps {
        h.apply(cmd).unwrap();
        states.push(snap(&h));
    }
    // Create from Selection made Qty and Price.
    let last = states.last().unwrap();
    let made: Vec<(&str, &str)> = last
        .names
        .iter()
        .map(|n| (n.name.as_str(), n.refers_to.as_str()))
        .collect();
    assert_eq!(
        made,
        [
            ("Rate", "2"),
            ("Qty", "Sheet1!$A$2:$A$4"),
            ("Price", "Sheet1!$B$2:$B$4")
        ]
    );
    assert_eq!(display(&h, 0, 0, 3), "20");
    for i in (0..states.len() - 1).rev() {
        h.undo().unwrap();
        assert_eq!(snap(&h), states[i], "undo to state {i}");
    }
    h.undo().unwrap();
    h.undo().unwrap();
    assert_eq!(snap(&h), empty);
    assert_eq!(display(&h, 0, 0, 3), "#NAME?");
    // Redo all the way.
    for _ in 0..5 {
        h.redo().unwrap();
    }
    assert_eq!(snap(&h), *states.last().unwrap());
}

#[test]
fn name_errors() {
    let mut h = book();
    h.apply(C::DefineName {
        def: def("Tax", None, "0.2"),
    })
    .unwrap();
    assert_eq!(
        err(
            &mut h,
            &C::DefineName {
                def: def("tax", None, "1")
            }
        ),
        "duplicate_name"
    );
    assert_eq!(
        err(
            &mut h,
            &C::DefineName {
                def: def("A1", None, "1")
            }
        ),
        "invalid_name"
    );
    assert_eq!(
        err(
            &mut h,
            &C::DefineName {
                def: def("X", None, "=1+")
            }
        ),
        "invalid_formula"
    );
    assert_eq!(
        err(
            &mut h,
            &C::DefineName {
                def: def("X", Some(9), "1")
            }
        ),
        "unknown_sheet"
    );
    assert_eq!(
        err(
            &mut h,
            &C::DeleteName {
                name: "Nope".into(),
                sheet: None
            }
        ),
        "unknown_name"
    );
    let empty_rows = C::CreateNamesFromSelection {
        sheet: 0,
        r0: 5,
        c0: 0,
        r1: 6,
        c1: 1,
        edges: NameEdges {
            top: true,
            ..NameEdges::default()
        },
    };
    assert_eq!(err(&mut h, &empty_rows), "no_names");
}

#[test]
fn structural_edits_restore_names_on_undo() {
    let mut h = book();
    h.apply(C::DefineName {
        def: def("Prices", None, "Sheet1!$B$2:$B$4"),
    })
    .unwrap();
    let other = h
        .apply(C::AddSheet {
            name: "Other".into(),
            index: None,
        })
        .unwrap();
    assert!(other.patch.names.is_none());
    h.apply(C::DefineName {
        def: def("Local", Some(1), "Other!$A$1"),
    })
    .unwrap();
    h.apply(set(1, 0, 0, "7")).unwrap();
    h.apply(set(0, 5, 0, "=SUM(Prices)+Other!Local")).unwrap();
    assert_eq!(display(&h, 0, 5, 0), "67");
    let before = snap(&h);
    let env = h
        .apply(C::DeleteRows {
            sheet: 0,
            at: 1,
            count: 3,
        })
        .unwrap();
    assert_eq!(env.patch.names.unwrap()[0].def.refers_to, "#REF!");
    h.undo().unwrap();
    assert_eq!(snap(&h), before);
    h.apply(C::RenameSheet {
        sheet: 1,
        name: "Facts".into(),
    })
    .unwrap();
    assert_eq!(h.doc().workbook().names()[1].refers_to, "Facts!$A$1");
    h.undo().unwrap();
    h.apply(C::DeleteSheet { sheet: 1 }).unwrap();
    assert_eq!(h.doc().workbook().names().len(), 1);
    h.undo().unwrap();
    assert_eq!(snap(&h), before);
    assert_eq!(display(&h, 0, 5, 0), "67");
}

#[test]
fn requests_names_name_at_and_trace() {
    let mut h = book();
    h.apply(C::DefineName {
        def: def("Qty", None, "Sheet1!$A$2:$A$4"),
    })
    .unwrap();
    h.apply(C::DefineName {
        def: def("Rate", None, "0.5"),
    })
    .unwrap();
    h.apply(set(0, 0, 4, "=SUM(Qty)*Rate+B2")).unwrap();
    let rows = ok(&mut h, json!({"type":"names","sheet":0}));
    assert_eq!(rows["names"][0]["value"], "{2;3;5}");
    assert_eq!(rows["names"][1]["value"], "0.5");
    assert_eq!(rows["names"][0]["refersTo"], "Sheet1!$A$2:$A$4");
    let at = ok(
        &mut h,
        json!({"type":"nameAt","sheet":0,"rect":{"r0":1,"c0":0,"r1":3,"c1":0}}),
    );
    assert_eq!(at["name"], "Qty");
    let none = ok(
        &mut h,
        json!({"type":"nameAt","sheet":0,"rect":{"r0":1,"c0":0,"r1":2,"c1":0}}),
    );
    assert!(none["name"].is_null());
    let p = ok(
        &mut h,
        json!({"type":"precedents","sheet":0,"row":0,"col":4}),
    );
    assert_eq!(
        p["refs"],
        json!([{"sheet":0,"r0":1,"c0":0,"r1":3,"c1":0},{"sheet":0,"r0":1,"c0":1,"r1":1,"c1":1}])
    );
    let d = ok(
        &mut h,
        json!({"type":"dependents","sheet":0,"row":2,"col":0}),
    );
    assert_eq!(d["refs"], json!([{"sheet":0,"r0":0,"c0":4,"r1":0,"c1":4}]));
    let info = ok(&mut h, json!({"type":"info"}));
    assert_eq!(info["info"]["names"].as_array().unwrap().len(), 2);
}

#[test]
fn number_format_fields_of_cells() {
    let mut h = book();
    let fmt = |code: &str| C::ApplyStyle {
        sheet: 0,
        r0: 1,
        c0: 0,
        r1: 1,
        c1: 0,
        patch: model_sheet::CellStyle {
            number_format: Some(code.into()),
            ..Default::default()
        },
    };
    h.apply(set(0, 1, 0, "-5")).unwrap();
    let env = h.apply(fmt("[Red][<0]-0.0;0.0")).unwrap();
    let cell = &env.patch.cells[0].cells[0];
    assert_eq!(cell.display, "-5.0");
    assert_eq!(cell.color.as_deref(), Some("#FF0000"));
    let env = h.apply(fmt("_(* #,##0.00_)")).unwrap();
    let cell = &env.patch.cells[0].cells[0];
    // `-` + the `_(` space, then the fill.
    assert_eq!(
        (cell.fill_at, cell.fill_char.as_deref()),
        (Some(2), Some(" "))
    );
    h.apply(set(0, 1, 0, "123456789")).unwrap();
    let env = h.apply(fmt("0")).unwrap();
    assert!(env.patch.cells[0].cells[0].narrow);
    // A wider column fits: the patch re-sends the column's numbers.
    let env = h
        .apply(C::SetColWidth {
            sheet: 0,
            col: 0,
            width: Some(14.0),
        })
        .unwrap();
    let cells = &env.patch.cells[0].cells;
    assert!(cells.iter().any(|c| c.row == 1 && !c.narrow));
    let preview = ok(
        &mut h,
        json!({"type":"formatPreview","value":-2,"code":"0;[Blue]0"}),
    );
    assert_eq!(preview["text"], "2");
    assert_eq!(preview["color"], "#0000FF");
}
