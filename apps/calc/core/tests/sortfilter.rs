//! P8-4: sort and AutoFilter commands.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost, Rect};
use model_sheet::{
    CellCoord, CellStyle, Criterion, Filter, FilterOp, SheetId, SheetSnapshot, SortKey, SortKind,
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

fn input(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(0), row, col))
        .input
}

fn display(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(0), row, col))
        .display
}

fn column(h: &CalcHost, col: u32, rows: u32) -> Vec<String> {
    (0..rows).map(|r| input(h, r, col)).collect()
}

fn hidden(h: &CalcHost) -> Vec<u32> {
    h.doc()
        .workbook()
        .rows(SheetId(0))
        .filter(|(_, i)| i.hidden)
        .map(|(r, _)| r)
        .collect()
}

fn state(h: &CalcHost) -> (Vec<calc_core::SheetInfo>, Vec<SheetSnapshot>) {
    (
        h.doc().info().sheets,
        h.doc().workbook().to_snapshot().sheets,
    )
}

fn key(col: u32, ascending: bool) -> SortKey {
    SortKey {
        col,
        ascending,
        kind: SortKind::Auto,
    }
}

/// A table with a header in row 1 (A1:C7) and SUBTOTALs in row 9.
fn table() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    let rows = [
        ["Fruit", "Qty", "Price"],
        ["pear", "3", "1.5"],
        ["Apple", "10", "0.5"],
        ["fig", "7", "2"],
        ["apple", "1", "0.4"],
        ["", "5", "9"],
        ["date", "x", "3"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(r as u32, c as u32, v)).unwrap();
        }
    }
    for r in 1..7 {
        h.apply(set(r, 3, &format!("=B{}*C{}", r + 1, r + 1)))
            .unwrap();
    }
    h.apply(set(8, 1, "=SUBTOTAL(9,B2:B7)")).unwrap();
    h.apply(set(8, 2, "=SUBTOTAL(109,B2:B7)")).unwrap();
    let bold = CellStyle {
        font: core_model::RunProperties {
            bold: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 2,
        patch: bold,
    })
    .unwrap();
    h
}

/// Every sort/filter command, mixed with edits.
fn script() -> Vec<C> {
    vec![
        C::SortRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 6,
            c1: 3,
            keys: vec![key(0, true), key(1, false)],
            has_header: true,
            case_sensitive: false,
        },
        C::SortSheetByColumn {
            sheet: 0,
            row: 3,
            col: 1,
            ascending: false,
        },
        C::SetAutoFilter {
            sheet: 0,
            range: Some(Rect {
                r0: 2,
                c0: 1,
                r1: 2,
                c1: 1,
            }),
        },
        C::SetFilterColumn {
            sheet: 0,
            col: 0,
            filter: Some(Filter::Values {
                values: vec!["apple".into(), "".into()],
            }),
        },
        C::SetRowHidden {
            sheet: 0,
            row: 1,
            hidden: true,
        },
        C::SetFilterColumn {
            sheet: 0,
            col: 1,
            filter: Some(Filter::Custom {
                criteria: vec![Criterion {
                    op: FilterOp::Gt,
                    value: "2".into(),
                }],
                and: true,
            }),
        },
        set(4, 1, "0"),
        C::ReapplyFilter { sheet: 0 },
        C::SortSheetByColumn {
            sheet: 0,
            row: 0,
            col: 2,
            ascending: true,
        },
        C::InsertRows {
            sheet: 0,
            at: 0,
            count: 1,
        },
        C::DeleteCols {
            sheet: 0,
            at: 0,
            count: 1,
        },
        C::ClearFilters { sheet: 0 },
        C::SetAutoFilter {
            sheet: 0,
            range: None,
        },
        C::DeleteRows {
            sheet: 0,
            at: 0,
            count: 3,
        },
    ]
}

#[test]
fn sort_and_filter_commands_undo_and_redo_exactly() {
    let mut h = table();
    h.apply(C::AddSheet {
        name: "Other".into(),
        index: None,
    })
    .unwrap();
    let mut states = vec![state(&h)];
    for cmd in script() {
        h.apply(cmd.clone())
            .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
        states.push(state(&h));
    }
    let text = format!("{states:?}");
    for needle in ["filtered: true", "auto_filter: Some", "sort_state: Some"] {
        assert!(text.contains(needle), "{needle}");
    }
    let n = states.len() - 1;
    for k in (0..n).rev() {
        h.undo().unwrap().unwrap();
        assert_eq!(state(&h), states[k], "after undoing to step {k}");
    }
    for (k, s) in states.iter().enumerate().skip(1) {
        h.redo().unwrap().unwrap();
        assert_eq!(&state(&h), s, "after redoing step {k}");
    }
    for k in (0..n).rev() {
        h.undo().unwrap().unwrap();
        assert_eq!(state(&h), states[k], "second undo to step {k}");
    }
    // Deleting a sheet with a filter and a sort state brings both back.
    h.apply(C::SetAutoFilter {
        sheet: 0,
        range: Some(Rect {
            r0: 0,
            c0: 0,
            r1: 6,
            c1: 2,
        }),
    })
    .unwrap();
    let before = state(&h);
    h.apply(C::DeleteSheet { sheet: 0 }).unwrap();
    h.undo().unwrap().unwrap();
    assert_eq!(state(&h), before);
}

#[test]
fn sort_moves_rows_formulas_and_reports_cells() {
    let mut h = table();
    let env = h
        .apply(C::SortRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 6,
            c1: 3,
            keys: vec![key(0, true)],
            has_header: true,
            case_sensitive: false,
        })
        .unwrap();
    assert_eq!(
        column(&h, 0, 7),
        ["Fruit", "Apple", "apple", "date", "fig", "pear", ""]
    );
    assert_eq!(column(&h, 1, 7)[1..], ["10", "1", "x", "7", "3", "5"]);
    // Formulas follow their row.
    assert_eq!(input(&h, 1, 3), "=B2*C2");
    assert_eq!(display(&h, 1, 3), "5");
    assert_eq!(input(&h, 6, 3), "=B7*C7");
    let cells: Vec<(u32, u32)> = env.patch.cells[0]
        .cells
        .iter()
        .map(|c| (c.row, c.col))
        .collect();
    assert!(cells.contains(&(1, 0)) && cells.contains(&(6, 2)));
    assert!(!cells.contains(&(0, 0)), "the header did not change");
    let sheets = env.patch.sheets.unwrap();
    let st = sheets[0].sort_state.as_ref().unwrap();
    assert_eq!((st.r0, st.r1, st.keys[0].col), (1, 6, 0));
}

#[test]
fn sort_sheet_by_column_guesses_the_region_and_header() {
    let mut h = table();
    // Row 1 is bold text above numbers: a header.
    h.apply(C::SortSheetByColumn {
        sheet: 0,
        row: 3,
        col: 1,
        ascending: true,
    })
    .unwrap();
    assert_eq!(column(&h, 1, 7), ["Qty", "1", "3", "5", "7", "10", "x"]);
    // The SUBTOTAL row (separated by a blank row) is not part of the region.
    assert_eq!(input(&h, 8, 1), "=SUBTOTAL(9,B2:B7)");

    // A list of plain words has no header.
    let mut h = Host::new(CalcDocument::new());
    for (r, w) in ["kiwi", "banana", "cherry"].iter().enumerate() {
        h.apply(set(r as u32, 0, w)).unwrap();
    }
    h.apply(C::SortSheetByColumn {
        sheet: 0,
        row: 0,
        col: 0,
        ascending: true,
    })
    .unwrap();
    assert_eq!(column(&h, 0, 3), ["banana", "cherry", "kiwi"]);
}

#[test]
fn filters_hide_rows_and_update_subtotals() {
    let mut h = table();
    assert_eq!(display(&h, 8, 1), "26");
    let env = h
        .apply(C::SetAutoFilter {
            sheet: 0,
            range: Some(Rect {
                r0: 1,
                c0: 1,
                r1: 1,
                c1: 1,
            }),
        })
        .unwrap();
    let af = env.patch.sheets.unwrap()[0].auto_filter.clone().unwrap();
    assert_eq!((af.r0, af.c0, af.r1, af.c1), (0, 0, 6, 3));

    let env = h
        .apply(C::SetFilterColumn {
            sheet: 0,
            col: 0,
            filter: Some(Filter::Values {
                values: vec!["APPLE".into(), "pear".into()],
            }),
        })
        .unwrap();
    assert_eq!(hidden(&h), vec![3, 5, 6]);
    let rows = &env.patch.rows[0].rows;
    assert_eq!(rows.iter().map(|r| r.row).collect::<Vec<_>>(), [3, 5, 6]);
    assert!(rows.iter().all(|r| r.hidden && r.filtered));
    let json = serde_json::to_value(&env.patch).unwrap();
    assert_eq!(json["rows"][0]["rows"][0]["filtered"], true);
    // 3 + 10 + 1.
    assert_eq!(display(&h, 8, 1), "14");
    assert!(env.patch.cells[0]
        .cells
        .iter()
        .any(|c| (c.row, c.col, c.display.as_str()) == (8, 1, "14")));

    // Edits do not re-filter; Reapply does.
    h.apply(set(1, 0, "fig")).unwrap();
    assert_eq!(hidden(&h), vec![3, 5, 6]);
    h.apply(C::ReapplyFilter { sheet: 0 }).unwrap();
    assert_eq!(hidden(&h), vec![1, 3, 5, 6]);
    assert_eq!(display(&h, 8, 1), "11");

    // A hand-hidden row survives clearing the filters.
    h.apply(C::SetRowHidden {
        sheet: 0,
        row: 2,
        hidden: true,
    })
    .unwrap();
    assert_eq!(display(&h, 8, 2), "1", "109 skips the hand-hidden row");
    h.apply(C::ClearFilters { sheet: 0 }).unwrap();
    assert_eq!(hidden(&h), vec![2]);
    assert!(h.doc().workbook().auto_filter(SheetId(0)).is_some());
    h.apply(C::SetAutoFilter {
        sheet: 0,
        range: None,
    })
    .unwrap();
    assert!(h.doc().workbook().auto_filter(SheetId(0)).is_none());
    assert_eq!(hidden(&h), vec![2]);
}

fn call(h: &mut CalcHost, request: Json) -> Json {
    serde_json::from_str(&dispatch(h, &request.to_string())).unwrap()
}

#[test]
fn dispatch_filter_values_and_errors() {
    let mut h = table();
    let r = call(
        &mut h,
        json!({"type": "filterValues", "sheet": 0, "col": 0}),
    );
    assert_eq!(r["err"]["code"], "no_auto_filter");
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setAutoFilter", "sheet": 0,
            "range": {"r0": 0, "c0": 0, "r1": 6, "c1": 3}}}),
    );
    assert!(r["ok"]["envelope"]["patch"]["sheets"][0]["autoFilter"].is_object());
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setFilterColumn", "sheet": 0, "col": 1,
            "filter": {"kind": "top10", "top": true, "percent": false, "value": 2}}}),
    );
    assert!(r.get("ok").is_some(), "{r}");
    let r = call(
        &mut h,
        json!({"type": "filterValues", "sheet": 0, "col": 0}),
    );
    assert_eq!(
        r["ok"],
        json!({"type": "filterValues", "values": [
            {"display": "Apple", "count": 1},
            {"display": "fig", "count": 1}
        ]})
    );
    let r = call(
        &mut h,
        json!({"type": "filterValues", "sheet": 0, "col": 1}),
    );
    let values: Vec<&str> = r["ok"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["display"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["1", "3", "5", "7", "10", "x"]);
    let r = call(
        &mut h,
        json!({"type": "filterValues", "sheet": 0, "col": 9}),
    );
    assert_eq!(r["err"]["code"], "invalid_range");

    h.apply(C::MergeCells {
        sheet: 0,
        r0: 10,
        c0: 0,
        r1: 11,
        c1: 0,
    })
    .unwrap();
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "sortRange", "sheet": 0, "r0": 0, "c0": 0,
            "r1": 12, "c1": 1, "keys": [{"col": 0, "ascending": true}], "hasHeader": true,
            "caseSensitive": false}}),
    );
    assert_eq!(r["err"]["code"], "cannot_sort_merged");
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "sortRange", "sheet": 0, "r0": 0, "c0": 0,
            "r1": 6, "c1": 1, "keys": [{"col": 5, "ascending": true}], "hasHeader": true,
            "caseSensitive": false}}),
    );
    assert_eq!(r["err"]["code"], "invalid_range");
    let revision = h.revision();
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setFilterColumn", "sheet": 0, "col": 7,
            "filter": null}}),
    );
    assert_eq!(r["err"]["code"], "invalid_range");
    assert_eq!(h.revision(), revision);
}

#[test]
fn xlsx_keeps_filter_sort_and_filtered_rows() {
    let mut h = table();
    for cmd in [
        C::SortRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 6,
            c1: 3,
            keys: vec![key(2, false)],
            has_header: true,
            case_sensitive: true,
        },
        C::SetAutoFilter {
            sheet: 0,
            range: Some(Rect {
                r0: 0,
                c0: 0,
                r1: 6,
                c1: 3,
            }),
        },
        C::SetFilterColumn {
            sheet: 0,
            col: 0,
            filter: Some(Filter::Custom {
                criteria: vec![Criterion {
                    op: FilterOp::BeginsWith,
                    value: "a".into(),
                }],
                and: false,
            }),
        },
    ] {
        h.apply(cmd).unwrap();
    }
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "t.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(
        doc.workbook().to_snapshot(),
        h.doc().workbook().to_snapshot()
    );
}
