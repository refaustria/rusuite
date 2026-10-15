//! P8-18: chart commands and requests.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost};
use core_model::chart::{
    Chart, ChartKind, ChartTitle, DataRef, Grouping, ScatterStyle, Series, TextSource,
};
use model_sheet::{CellOffset, ChartAnchor, SheetSnapshot};
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

fn anchor() -> ChartAnchor {
    ChartAnchor::TwoCell {
        from: CellOffset {
            col: 4,
            row: 0,
            ..CellOffset::default()
        },
        to: CellOffset {
            col: 10,
            row: 14,
            ..CellOffset::default()
        },
    }
}

/// Sheet1 A1:C4: header row, months, two number columns.
fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    let rows = [
        ["Month", "Sales", "Cost"],
        ["Jan", "10", "4"],
        ["Feb", "12", "5"],
        ["Mar", "9", "7"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(0, r as u32, c as u32, v)).unwrap();
        }
    }
    h
}

fn recommended(h: &mut CalcHost) -> Chart {
    let reply = ok(
        h,
        json!({"type":"recommendedChart","sheet":0,"r0":1,"c0":1,"r1":1,"c1":1}),
    );
    serde_json::from_value(reply["chart"].clone()).unwrap()
}

fn add(h: &mut CalcHost, chart: Chart) -> Json {
    let cmd = C::AddChart {
        sheet: 0,
        anchor: anchor(),
        chart,
        id: None,
        name: None,
    };
    ok(h, json!({"type":"apply","command":cmd}))
}

#[test]
fn recommended_chart_and_data() {
    let mut h = book();
    let chart = recommended(&mut h);
    assert_eq!(chart.kind, ChartKind::column());
    assert_eq!(chart.series.len(), 2);
    assert_eq!(
        chart.categories,
        Some(DataRef::reference("Sheet1!$A$2:$A$4"))
    );
    let reply = add(&mut h, chart.clone());
    assert_eq!(reply["envelope"]["patch"]["chartSheets"], json!([0]));
    let charts = ok(&mut h, json!({"type":"sheetCharts","sheet":0}));
    assert_eq!(charts["charts"][0]["id"], 1);
    assert_eq!(charts["charts"][0]["name"], "Chart 1");
    let snap = ok(
        &mut h,
        json!({"type":"snapshot","sheet":0,"r0":0,"c0":0,"r1":5,"c1":5}),
    );
    assert_eq!(snap["snapshot"]["charts"], charts["charts"]);
    let data = ok(&mut h, json!({"type":"chartData","sheet":0,"id":1}));
    assert_eq!(data["type"], "chartData");
    assert_eq!(data["data"]["series"][0]["name"], "Sales");
    assert_eq!(data["data"]["series"][1]["values"], json!([4.0, 5.0, 7.0]));
    assert_eq!(
        data["data"]["series"][0]["categories"],
        json!(["Jan", "Feb", "Mar"])
    );
    // Preview of a chart that is not on the sheet.
    let mut scatter = chart;
    scatter.kind = ChartKind::Scatter {
        style: ScatterStyle::Marker,
    };
    scatter.categories = None;
    let data = ok(
        &mut h,
        json!({"type":"previewChartData","sheet":0,"chart":scatter}),
    );
    assert_eq!(data["data"]["series"][0]["xValues"], json!([1.0, 2.0, 3.0]));
    // No numbers: no chart; unknown chart: error code.
    let none = ok(
        &mut h,
        json!({"type":"recommendedChart","sheet":0,"r0":0,"c0":0,"r1":0,"c1":2}),
    );
    assert_eq!(none["chart"], Json::Null);
    let reply: Json = serde_json::from_str(&dispatch(
        &mut h,
        r#"{"type":"chartData","sheet":0,"id":9}"#,
    ))
    .unwrap();
    assert_eq!(reply["err"]["code"], "unknown_chart");
}

#[test]
fn chart_commands_with_undo_identity() {
    let mut h = book();
    let empty = state(&h);
    let chart = recommended(&mut h);
    add(&mut h, chart.clone());
    let one = state(&h);
    assert_eq!(one[0].charts.len(), 1);

    let mut line = chart.clone();
    line.kind = ChartKind::Line {
        grouping: Grouping::Standard,
        markers: true,
    };
    line.title = Some(ChartTitle::literal("Trend"));
    let steps = vec![
        C::UpdateChart {
            sheet: 0,
            id: 1,
            chart: line,
        },
        C::SetChartAnchor {
            sheet: 0,
            id: 1,
            anchor: ChartAnchor::Absolute {
                x: 0,
                y: 0,
                width: 100,
                height: 50,
            },
        },
        C::SetChartSeries {
            sheet: 0,
            id: 1,
            series: vec![Series {
                name: Some(TextSource::literal("Only")),
                ..Series::new(DataRef::reference("Sheet1!$C$2:$C$4"))
            }],
            categories: None,
        },
        C::RemoveChart { sheet: 0, id: 1 },
    ];
    let mut states = vec![one.clone()];
    for cmd in steps {
        let env = h.apply(cmd).unwrap();
        assert_eq!(env.patch.chart_sheets, [0]);
        states.push(state(&h));
    }
    assert!(states.last().unwrap()[0].charts.is_empty());
    for expected in states.iter().rev().skip(1) {
        h.undo().unwrap();
        assert_eq!(&state(&h), expected);
    }
    h.undo().unwrap();
    assert_eq!(state(&h), empty);
    for expected in &states {
        h.redo().unwrap();
        assert_eq!(&state(&h), expected);
    }
    // Errors leave everything unchanged.
    let mut bad = chart;
    bad.style = 0;
    let before = state(&h);
    assert!(h
        .apply(C::AddChart {
            sheet: 0,
            anchor: anchor(),
            chart: bad,
            id: None,
            name: None
        })
        .is_err());
    assert!(h.apply(C::RemoveChart { sheet: 0, id: 7 }).is_err());
    let unsupported = Chart::new(ChartKind::Unsupported {
        kind: "radarChart".into(),
        xml: "<x/>".into(),
    });
    let err = h
        .apply(C::AddChart {
            sheet: 0,
            anchor: anchor(),
            chart: unsupported,
            id: None,
            name: None,
        })
        .unwrap_err();
    assert_eq!(err.code(), "invalid_chart");
    assert_eq!(state(&h), before);
}

#[test]
fn edits_mark_chart_sheets_and_structure_is_undone() {
    let mut h = book();
    h.apply(C::AddSheet {
        name: "Other".into(),
        index: None,
    })
    .unwrap();
    let chart = recommended(&mut h);
    // The chart lives on sheet 1 and shows Sheet1 data.
    h.apply(C::AddChart {
        sheet: 1,
        anchor: anchor(),
        chart,
        id: None,
        name: None,
    })
    .unwrap();
    let env = h.apply(set(0, 2, 1, "20")).unwrap();
    assert_eq!(env.patch.chart_sheets, [1]);
    let env = h.apply(set(0, 9, 9, "x")).unwrap();
    assert!(env.patch.chart_sheets.is_empty());
    let env = h.apply(set(1, 0, 0, "x")).unwrap();
    assert!(env.patch.chart_sheets.is_empty());

    let before = state(&h);
    let env = h
        .apply(C::InsertRows {
            sheet: 0,
            at: 0,
            count: 3,
        })
        .unwrap();
    assert_eq!(env.patch.chart_sheets, [1]);
    let moved = h.doc().workbook().to_snapshot().sheets[1].charts[0]
        .chart
        .categories
        .clone();
    assert_eq!(moved, Some(DataRef::reference("Sheet1!$A$5:$A$7")));
    h.apply(C::DeleteCols {
        sheet: 0,
        at: 0,
        count: 2,
    })
    .unwrap();
    h.undo().unwrap();
    h.undo().unwrap();
    assert_eq!(state(&h), before);

    // Rename follows, delete + undo restores the chart.
    h.apply(C::RenameSheet {
        sheet: 0,
        name: "Data sheet".into(),
    })
    .unwrap();
    let f = state(&h)[1].charts[0].chart.categories.clone();
    assert_eq!(f, Some(DataRef::reference("'Data sheet'!$A$2:$A$4")));
    let before = state(&h);
    let env = h.apply(C::DeleteSheet { sheet: 1 }).unwrap();
    assert!(env.patch.chart_sheets.is_empty() || env.patch.chart_sheets == [0]);
    h.undo().unwrap();
    assert_eq!(state(&h), before);
}

#[test]
fn charts_survive_save_and_open() {
    let mut h = book();
    let chart = recommended(&mut h);
    add(&mut h, chart);
    let saved = ok(&mut h, json!({"type":"saveXlsx"}));
    let bytes = saved["bytesBase64"].as_str().unwrap().to_owned();
    let mut other = Host::new(CalcDocument::new());
    let opened = ok(
        &mut other,
        json!({"type":"openXlsx","bytesBase64":bytes,"name":"c.xlsx"}),
    );
    assert_eq!(opened["warnings"], json!([]));
    assert_eq!(state(&other), state(&h));
}
