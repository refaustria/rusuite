//! P9-C3: pivot tables round 2 through calc-core – grouping, calculated
//! fields and items, Show Report Filter Pages, PivotCharts and Recommended
//! PivotTables as commands (undo / redo) and requests.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost, PivotSourceSpec, PivotTarget};
use core_model::chart::{BarDirection, Chart, ChartKind, Grouping};
use model_sheet::pivot::{
    DataField, DateGroupBy, GroupSpec, PageField, PageSelection, PivotCache, PivotFields,
};
use model_sheet::{CellCoord, CellOffset, ChartAnchor, SheetId, SheetSnapshot};
use serde_json::{json, Value as Json};

const DATA: [[&str; 4]; 7] = [
    ["Date", "Region", "Sales", "Units"],
    ["2024-01-15", "East", "10", "1"],
    ["2024-02-03", "East", "20", "2"],
    ["2024-02-20", "West", "30", "3"],
    ["2025-01-05", "North", "50", "5"],
    ["2025-03-09", "East", "60", "6"],
    ["2025-03-30", "North", "70", "7"],
];

fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in DATA.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(C::SetInput {
                sheet: 0,
                row: r as u32,
                col: c as u32,
                input: (*v).into(),
            })
            .unwrap();
        }
    }
    h
}

fn source() -> PivotSourceSpec {
    PivotSourceSpec::Range {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 6,
        c1: 3,
    }
}

/// A table at G1 with `fields`; returns its id.
fn pivot(h: &mut CalcHost, fields: PivotFields) -> u32 {
    h.apply(C::CreatePivot {
        source: source(),
        target: PivotTarget::Cell {
            sheet: 0,
            row: 0,
            col: 6,
        },
        fields,
    })
    .unwrap();
    h.doc().workbook().pivots(SheetId(0))[0].id
}

fn by(rows: &[u32]) -> PivotFields {
    PivotFields {
        rows: rows.iter().map(|&f| f.into()).collect(),
        values: vec![DataField::sum(2)],
        ..Default::default()
    }
}

fn display(h: &CalcHost, sheet: u32, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(sheet), row, col))
        .display
}

fn state(h: &CalcHost) -> (Vec<SheetSnapshot>, Vec<PivotCache>) {
    let snap = h.doc().workbook().to_snapshot();
    let caches = snap
        .pivot_caches
        .into_iter()
        .map(|c| PivotCache { stale: false, ..c })
        .collect();
    (snap.sheets, caches)
}

fn undo_identity(h: &mut CalcHost, cmd: C) {
    let before = state(h);
    h.apply(cmd.clone())
        .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
    let after = state(h);
    h.undo().unwrap();
    assert!(state(h) == before, "undo of {cmd:?}");
    h.redo().unwrap();
    assert!(state(h) == after, "redo of {cmd:?}");
}

fn request(h: &mut CalcHost, req: Json) -> Json {
    serde_json::from_str(&dispatch(h, &req.to_string())).unwrap()
}

#[test]
fn group_dates_and_ungroup_undo() {
    let mut h = book();
    let id = pivot(&mut h, by(&[0]));
    undo_identity(
        &mut h,
        C::GroupPivotField {
            id,
            field: 0,
            group: GroupSpec::Date {
                by: vec![DateGroupBy::Months, DateGroupBy::Years],
                start: None,
                end: None,
                days: None,
            },
        },
    );
    // G2 2024, G3 Jan, G4 Feb, G5 2025, G6 Jan, G7 Mar.
    assert_eq!(display(&h, 0, 1, 6), "2024");
    assert_eq!(display(&h, 0, 2, 6), "Jan");
    assert_eq!(display(&h, 0, 4, 6), "2025");
    assert_eq!(display(&h, 0, 4, 7), "180");
    // pivotInfo lists the level field with its grouping.
    let info = h.doc().pivot_info(id).unwrap();
    let years = info.fields.iter().find(|f| f.name == "Years").unwrap();
    assert!(years.group.is_some());
    assert_eq!(years.area, Some(calc_core::PivotArea::Rows));
    undo_identity(
        &mut h,
        C::UngroupPivotField {
            id,
            field: 0,
            items: None,
        },
    );
}

#[test]
fn manual_group_through_json() {
    let mut h = book();
    let id = pivot(&mut h, by(&[1]));
    let reply = request(
        &mut h,
        json!({"type": "apply", "command": {"type": "groupPivotField", "id": id, "field": 1,
            "group": {"kind": "items", "items": [0, 1]}}}),
    );
    assert!(reply.get("ok").is_some(), "{reply}");
    assert_eq!(display(&h, 0, 1, 6), "Group1");
    let reply = request(&mut h, json!({"type": "pivotItems", "id": id, "field": 4}));
    let items = &reply["ok"]["items"];
    assert_eq!(items[0]["label"], "Group1");
}

#[test]
fn calculated_field_and_item_commands() {
    let mut h = book();
    let id = pivot(&mut h, by(&[1]));
    undo_identity(
        &mut h,
        C::SetCalculatedField {
            id,
            field: None,
            name: "Price".into(),
            formula: Some("Sales/Units".into()),
        },
    );
    // Row Labels | Sum of Sales | Sum of Price; East = 90 / 9.
    assert_eq!(display(&h, 0, 0, 8), "Sum of Price");
    assert_eq!(display(&h, 0, 1, 8), "10");
    let info = h.doc().pivot_info(id).unwrap();
    assert_eq!(info.fields[4].formula.as_deref(), Some("Sales/Units"));
    undo_identity(
        &mut h,
        C::SetCalculatedItem {
            id,
            field: 1,
            item: None,
            name: "Both".into(),
            formula: Some("East+West".into()),
        },
    );
    let info = h.doc().pivot_info(id).unwrap();
    assert_eq!(info.calculated_items.len(), 1);
    assert_eq!(info.calculated_items[0].name, "Both");
    let items = h.doc().pivot_items(id, 1).unwrap();
    assert!(items.iter().any(|i| i.calculated && i.label == "Both"));
    // A bad formula is refused.
    assert!(h
        .apply(C::SetCalculatedField {
            id,
            field: None,
            name: "X".into(),
            formula: Some("Sales*".into()),
        })
        .is_err());
}

#[test]
fn report_filter_pages_make_sheets() {
    let mut h = book();
    let id = pivot(
        &mut h,
        PivotFields {
            filters: vec![PageField {
                field: 1,
                selected: PageSelection::All,
            }],
            ..by(&[0])
        },
    );
    let sheets = h.doc().workbook().sheets().len();
    let before = state(&h);
    let applied = h.apply(C::ShowReportFilterPages { id, field: 1 }).unwrap();
    let wb = h.doc().workbook();
    let names: Vec<String> = wb.sheets().into_iter().map(|(_, n)| n).collect();
    assert_eq!(names, ["East", "North", "West", "Sheet1"]);
    assert_eq!(wb.sheets().len(), sheets + 3);
    let east = wb.sheet_id("East").unwrap();
    assert_eq!(display(&h, east.0, 0, 7), "East");
    assert!(applied.patch.activate_sheet.is_some());
    h.undo().unwrap();
    assert!(state(&h) == before);
    // Only a filter field has pages.
    assert!(h.apply(C::ShowReportFilterPages { id, field: 0 }).is_err());
}

#[test]
fn pivot_chart_follows_the_table_and_undo() {
    let mut h = book();
    let id = pivot(&mut h, by(&[1]));
    let chart = Chart::new(ChartKind::Bar {
        direction: BarDirection::Column,
        grouping: Grouping::Clustered,
    });
    let anchor = ChartAnchor::TwoCell {
        from: CellOffset {
            col: 10,
            row: 0,
            ..Default::default()
        },
        to: CellOffset {
            col: 16,
            row: 14,
            ..Default::default()
        },
    };
    let applied = h
        .apply(C::InsertPivotChart {
            sheet: 0,
            pivot: id,
            anchor,
            chart,
        })
        .unwrap();
    assert_eq!(applied.patch.chart_sheets, [0]);
    let c = &h.doc().workbook().charts(SheetId(0))[0];
    assert_eq!(c.pivot, Some(id));
    assert_eq!(c.chart.series.len(), 1);
    let cid = c.id;
    // A hidden item: the series' values follow (and the patch says so).
    let mut t = h.doc().workbook().pivot(id).unwrap().1.clone();
    t.rows[0].hidden_items.insert(0);
    let applied = h
        .apply(C::UpdatePivot {
            id,
            patch: calc_core::PivotPatch {
                rows: Some(t.rows.clone()),
                ..Default::default()
            },
        })
        .unwrap();
    assert!(applied.patch.chart_sheets.contains(&0));
    let data = h.doc().workbook().chart_data(SheetId(0), cid).unwrap();
    assert_eq!(data.series[0].values.len(), 2);
    h.undo().unwrap();
    let data = h.doc().workbook().chart_data(SheetId(0), cid).unwrap();
    assert_eq!(data.series[0].values.len(), 3);
    h.undo().unwrap();
    assert!(h.doc().workbook().charts(SheetId(0)).is_empty());
    // An unknown table is refused.
    assert!(h
        .apply(C::InsertPivotChart {
            sheet: 0,
            pivot: 99,
            anchor,
            chart: Chart::new(ChartKind::Pie),
        })
        .is_err());
}

#[test]
fn recommended_pivots_request() {
    let mut h = book();
    let reply = request(
        &mut h,
        json!({"type": "recommendPivots", "source": {"kind": "range", "sheet": 0, "r0": 0, "c0": 0, "r1": 0, "c1": 0}}),
    );
    let items = reply["ok"]["items"]
        .as_array()
        .unwrap_or_else(|| panic!("{reply}"));
    assert!(!items.is_empty());
    assert_eq!(items[0]["title"], "Sum of Sales by Region");
    assert_eq!(items[0]["preview"][0][0], "Row Labels");
    assert_eq!(items[0]["fields"]["rows"][0]["field"], 1);
}
