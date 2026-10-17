//! P9-C6: chart sheets, `#REF!` series after deleting the source sheet,
//! sparkline commands, requests and their undo.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost};
use model_sheet::{ChartAnchor, SheetSnapshot, Sparkline, SparklineGroup, SparklineKind};
use serde_json::{json, Value as Json};

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn state(h: &CalcHost) -> Vec<SheetSnapshot> {
    h.doc().workbook().to_snapshot().sheets
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn apply(h: &mut CalcHost, cmd: C) -> Json {
    ok(h, json!({"type":"apply","command":cmd}))
}

/// Sheet1 A1:C4 (months, two number columns) and an empty Sheet2.
fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    let rows = [
        ["Month", "Sales", "Cost"],
        ["Jan", "10", "4"],
        ["Feb", "-12", "5"],
        ["Mar", "9", "7"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(0, r as u32, c as u32, v)).unwrap();
        }
    }
    h.apply(C::AddSheet {
        name: "Sheet2".into(),
        index: None,
    })
    .unwrap();
    h
}

fn groups() -> Vec<SparklineGroup> {
    vec![SparklineGroup::new(
        SparklineKind::Line,
        vec![
            Sparkline {
                row: 1,
                col: 4,
                data: "Sheet1!B2:C2".into(),
            },
            Sparkline {
                row: 2,
                col: 4,
                data: "Sheet1!B3:C3".into(),
            },
        ],
    )]
}

#[test]
fn sparkline_command_request_and_undo() {
    let mut h = book();
    let before = state(&h);
    let reply = apply(
        &mut h,
        C::SetSparklineGroups {
            sheet: 0,
            groups: groups(),
        },
    );
    assert_eq!(
        reply["envelope"]["patch"]["sparklineSheets"],
        json!([0]),
        "{reply}"
    );
    let list = ok(&mut h, json!({"type":"sheetSparklines","sheet":0}));
    assert_eq!(list["type"], "sparklines");
    assert_eq!(list["groups"][0]["data"][1]["values"], json!([-12.0, 5.0]));
    // A data cell change reports the sheet.
    let reply = apply(&mut h, set(0, 1, 1, "3"));
    assert_eq!(reply["envelope"]["patch"]["sparklineSheets"], json!([0]));
    let reply = apply(&mut h, set(0, 8, 8, "3"));
    assert!(reply["envelope"]["patch"].get("sparklineSheets").is_none());
    // Inserting a row moves them; undo puts them back.
    let moved = state(&h);
    apply(
        &mut h,
        C::InsertRows {
            sheet: 0,
            at: 0,
            count: 1,
        },
    );
    let g = &h.doc().workbook().sparkline_groups(model_sheet::SheetId(0))[0];
    assert_eq!(
        (g.sparklines[0].row, g.sparklines[0].data.as_str()),
        (2, "Sheet1!B3:C3")
    );
    h.undo().unwrap();
    assert_eq!(state(&h), moved);
    h.undo().unwrap();
    h.undo().unwrap();
    h.undo().unwrap();
    assert_eq!(state(&h), before);
    // Invalid groups are refused.
    let reply: Json = serde_json::from_str(&dispatch(
        &mut h,
        &json!({"type":"apply","command":{"type":"setSparklineGroups","sheet":0,"groups":[{"sparklines":[]}]}}).to_string(),
    ))
    .unwrap();
    assert!(reply.get("err").is_some(), "{reply}");
}

#[test]
fn chart_sheet_flag_and_deleting_the_source_sheet() {
    let mut h = book();
    let chart = ok(
        &mut h,
        json!({"type":"recommendedChart","sheet":0,"r0":1,"c0":1,"r1":1,"c1":1}),
    )["chart"]
        .clone();
    let anchor = ChartAnchor::Absolute {
        x: 0,
        y: 0,
        width: model_sheet::CHART_SHEET_SIZE.0,
        height: model_sheet::CHART_SHEET_SIZE.1,
    };
    // Move Chart › New sheet, as the UI sends it.
    let reply = ok(
        &mut h,
        json!({"type":"apply","command":{"type":"compound","commands":[
            {"type":"setChartSheet","sheet":1,"chartSheet":true},
            {"type":"addChart","sheet":1,"anchor":anchor,"chart":chart}
        ]}}),
    );
    let sheets = &reply["envelope"]["patch"]["sheets"];
    assert_eq!(sheets[1]["chartSheet"], true, "{reply}");
    assert!(sheets[0].get("chartSheet").is_none());
    let before = state(&h);
    // Deleting the data sheet: the chart survives with #REF! references
    // and the cached values; undo restores the references.
    let reply = apply(&mut h, C::DeleteSheet { sheet: 0 });
    assert_eq!(
        reply["envelope"]["patch"]["chartSheets"],
        json!([1]),
        "{reply}"
    );
    let charts = ok(&mut h, json!({"type":"sheetCharts","sheet":1}));
    let series = &charts["charts"][0]["chart"]["series"];
    assert_eq!(series.as_array().unwrap().len(), 2);
    assert_eq!(series[0]["values"]["formula"], "#REF!");
    let data = ok(&mut h, json!({"type":"chartData","sheet":1,"id":1}));
    assert_eq!(
        data["data"]["series"][0]["values"],
        json!([10.0, -12.0, 9.0])
    );
    h.undo().unwrap();
    assert_eq!(state(&h), before);
    // Deleting the chart sheet and undoing keeps the flag.
    apply(&mut h, C::DeleteSheet { sheet: 1 });
    h.undo().unwrap();
    assert_eq!(state(&h), before);
    assert!(h.doc().workbook().is_chart_sheet(model_sheet::SheetId(1)));
}

#[test]
fn deleting_a_sheet_with_sparklines_restores_them_on_undo() {
    let mut h = book();
    let mut g = groups();
    for s in &mut g[0].sparklines {
        s.data = s.data.replace("Sheet1", "Sheet2");
    }
    apply(
        &mut h,
        C::SetSparklineGroups {
            sheet: 0,
            groups: g,
        },
    );
    apply(
        &mut h,
        C::SetSparklineGroups {
            sheet: 1,
            groups: groups(),
        },
    );
    let before = state(&h);
    let reply = apply(&mut h, C::DeleteSheet { sheet: 1 });
    assert_eq!(
        reply["envelope"]["patch"]["sparklineSheets"],
        json!([0]),
        "{reply}"
    );
    let wb = h.doc().workbook();
    assert!(wb.sparkline_groups(model_sheet::SheetId(0))[0]
        .sparklines
        .iter()
        .all(|s| s.data == "#REF!"));
    h.undo().unwrap();
    assert_eq!(state(&h), before);
}
