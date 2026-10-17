//! P8-18: charts in `.xlsx` files (drawing + chart parts).

use std::io::Cursor;
use std::path::PathBuf;

use core_model::chart::{
    AxisGroup, BarDirection, CellClass, Chart, ChartKind, ChartTitle, ChartValue, DataLabels,
    DataRef, Grouping, Legend, LegendPosition, ScatterStyle, Series, TextSource,
};
use engine_formula::{CellCoord, SheetId};
use fmt_ooxml::xml::{parse, El};
use fmt_ooxml::{Package, PartName};
use model_sheet::{CellOffset, CellStyle, ChartAnchor, ChartObject, Workbook};

fn load(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/xlsx");
    std::fs::read(path.join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn part(xlsx: &[u8], name: &str) -> Vec<u8> {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"))
        .data
        .clone()
}

fn anchor() -> ChartAnchor {
    ChartAnchor::TwoCell {
        from: CellOffset {
            col: 4,
            row: 1,
            col_offset: 0,
            row_offset: 0,
        },
        to: CellOffset {
            col: 11,
            row: 16,
            col_offset: 304_800,
            row_offset: 76_200,
        },
    }
}

/// Sheet "Data": A1:C5 = header, months, two number columns (C formatted
/// `0.0`).
fn data_book() -> (Workbook, SheetId) {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    wb.rename_sheet(s, "Data").unwrap();
    let rows = [
        ["Month", "Sales", "Cost"],
        ["Jan", "10", "4.25"],
        ["Feb", "12", "=B3/2"],
        ["Mar", "", "7"],
        ["Apr", "15", "6"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                .unwrap();
        }
    }
    let one_decimal = wb.intern_style(&CellStyle {
        number_format: Some("0.0".into()),
        ..CellStyle::default()
    });
    for r in 1..5 {
        wb.set_style(CellCoord::new(s, r, 2), one_decimal).unwrap();
    }
    (wb, s)
}

fn recommended() -> Chart {
    let t = CellClass::Text;
    let n = CellClass::Number;
    let mut cells = vec![vec![t, t, t]];
    cells.extend((0..4).map(|_| vec![t, n, n]));
    Chart::from_range("Data", 0, 0, &cells).unwrap()
}

fn kinds() -> Vec<(&'static str, ChartKind)> {
    vec![
        ("column_clustered", ChartKind::column()),
        (
            "bar_stacked",
            ChartKind::Bar {
                direction: BarDirection::Bar,
                grouping: Grouping::Stacked,
            },
        ),
        (
            "column_percent",
            ChartKind::Bar {
                direction: BarDirection::Column,
                grouping: Grouping::PercentStacked,
            },
        ),
        (
            "line_markers",
            ChartKind::Line {
                grouping: Grouping::Standard,
                markers: true,
            },
        ),
        (
            "line_stacked",
            ChartKind::Line {
                grouping: Grouping::Stacked,
                markers: false,
            },
        ),
        (
            "area_percent",
            ChartKind::Area {
                grouping: Grouping::PercentStacked,
            },
        ),
        ("pie", ChartKind::Pie),
        ("doughnut", ChartKind::Doughnut),
        (
            "scatter_markers",
            ChartKind::Scatter {
                style: ScatterStyle::Marker,
            },
        ),
        (
            "scatter_smooth",
            ChartKind::Scatter {
                style: ScatterStyle::Smooth,
            },
        ),
        ("combo", ChartKind::Combo),
    ]
}

fn chart_of(kind: &ChartKind) -> Chart {
    let mut c = recommended();
    c.kind = kind.clone();
    // Gap width and overlap belong to bar groups only.
    if !matches!(kind, ChartKind::Bar { .. } | ChartKind::Combo) {
        c.gap_width = None;
        c.overlap = None;
    }
    match kind {
        ChartKind::Pie | ChartKind::Doughnut => {
            c.series.truncate(1);
            c.vary_colors = true;
            c.data_labels = DataLabels {
                show_percent: true,
                show_category: true,
                ..DataLabels::default()
            };
            c.legend = Some(Legend {
                position: LegendPosition::Right,
                overlay: false,
            });
        }
        ChartKind::Combo => {
            c.series[0].kind = Some(ChartKind::column());
            c.series[1].kind = Some(ChartKind::Line {
                grouping: Grouping::Standard,
                markers: true,
            });
            c.series[1].axis = AxisGroup::Secondary;
            c.axes.second_val = Some(core_model::chart::Axis {
                title: Some(ChartTitle::literal("Cost")),
                crosses: core_model::chart::Crosses::Max,
                ..core_model::chart::Axis::default()
            });
        }
        _ => {}
    }
    if kind.has_axes() {
        c.axes.val.title = Some(ChartTitle::literal("EUR"));
    }
    c
}

fn pretty(xml: &[u8]) -> String {
    String::from_utf8(xml.to_vec())
        .unwrap()
        .replace("><", ">\n<")
}

#[test]
fn every_kind_roundtrips_through_xlsx() {
    for (name, kind) in kinds() {
        let (mut wb, s) = data_book();
        let chart = chart_of(&kind);
        wb.add_chart(
            s,
            ChartObject {
                id: 0,
                name: String::new(),
                anchor: anchor(),
                chart: chart.clone(),
                pivot: None,
            },
        )
        .unwrap();
        let bytes = fmt_xlsx::write(&wb).unwrap();
        assert_eq!(
            bytes,
            fmt_xlsx::write(&wb).unwrap(),
            "{name}: deterministic"
        );
        // For checking the files in LibreOffice/Excel by hand.
        if let Some(dir) = std::env::var_os("RUSUITE_CHART_OUT") {
            let path = PathBuf::from(dir).join(format!("chart-{name}.xlsx"));
            std::fs::write(path, &bytes).unwrap();
        }
        let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
        assert!(warnings.is_empty(), "{name}: {warnings:?}");
        assert_eq!(back.charts(s).len(), 1, "{name}");
        assert_eq!(back.charts(s)[0].chart, chart, "{name}");
        assert_eq!(back.charts(s)[0].anchor, anchor(), "{name}");
        assert_eq!(back.charts(s)[0].name, "Chart 1");
        assert_eq!(back.to_snapshot(), wb.to_snapshot(), "{name}");
        insta::assert_snapshot!(
            format!("chart_{name}"),
            pretty(&part(&bytes, "/xl/charts/chart1.xml"))
        );
    }
}

#[test]
fn drawing_and_relationships() {
    let (mut wb, s) = data_book();
    let other = wb.add_sheet("Empty").unwrap();
    let third = wb.add_sheet("More").unwrap();
    let obj = ChartObject {
        id: 0,
        name: "Sales chart".into(),
        anchor: anchor(),
        chart: recommended(),
        pivot: None,
    };
    wb.add_chart(s, obj.clone()).unwrap();
    wb.add_chart(
        s,
        ChartObject {
            anchor: ChartAnchor::Absolute {
                x: 10,
                y: 20,
                width: 3_000_000,
                height: 2_000_000,
            },
            ..obj.clone()
        },
    )
    .unwrap();
    wb.add_chart(
        third,
        ChartObject {
            anchor: ChartAnchor::OneCell {
                from: CellOffset::default(),
                width: 4_000_000,
                height: 3_000_000,
            },
            ..obj
        },
    )
    .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let pn = |n: &str| PartName::new(n).unwrap();
    assert_eq!(
        pkg.content_type_of(&pn("/xl/charts/chart3.xml")),
        Some(fmt_ooxml::ct::CHART)
    );
    assert_eq!(
        pkg.content_type_of(&pn("/xl/drawings/drawing2.xml")),
        Some(fmt_ooxml::ct::DRAWING)
    );
    let sheet1 = String::from_utf8(part(&bytes, "/xl/worksheets/sheet1.xml")).unwrap();
    assert!(sheet1.ends_with("<drawing r:id=\"rId1\"/></worksheet>"));
    let sheet2 = String::from_utf8(part(&bytes, "/xl/worksheets/sheet2.xml")).unwrap();
    assert!(!sheet2.contains("<drawing"));
    let rels = pkg.relationships(&pn("/xl/worksheets/sheet3.xml")).unwrap();
    let r = rels.get("rId1").unwrap();
    assert_eq!(
        (r.rel_type.as_str(), r.target.as_str()),
        (fmt_ooxml::rel::DRAWING, "../drawings/drawing2.xml")
    );
    let drels = pkg.relationships(&pn("/xl/drawings/drawing1.xml")).unwrap();
    assert_eq!(drels.get("rId2").unwrap().target, "../charts/chart2.xml");
    assert!(pkg
        .relationships(&pn("/xl/worksheets/sheet2.xml"))
        .is_none());
    insta::assert_snapshot!(
        "drawing1_xml",
        pretty(&part(&bytes, "/xl/drawings/drawing1.xml"))
    );
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert!(back.charts(other).is_empty());
    assert_eq!(back.charts(s)[1].name, "Sales chart");
}

/// The values of a cache element (`c:numCache` / `c:strCache`).
fn cache(el: &El) -> Vec<Option<String>> {
    let count: usize = el.child("ptCount").unwrap().val().unwrap().parse().unwrap();
    let mut out = vec![None; count];
    for pt in el.elements().filter(|e| e.name == "pt") {
        let i: usize = pt.attr("idx").unwrap().parse().unwrap();
        out[i] = Some(pt.child("v").unwrap().text());
    }
    out
}

#[test]
fn cache_written_on_save_matches_resolved_data() {
    let (mut wb, s) = data_book();
    wb.add_chart(
        s,
        ChartObject {
            id: 0,
            name: String::new(),
            anchor: anchor(),
            chart: recommended(),
            pivot: None,
        },
    )
    .unwrap();
    let resolved = wb.chart_data(s, 1).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let root = parse(&part(&bytes, "/xl/charts/chart1.xml"), "chart").unwrap();
    let group = root.find("barChart").unwrap();
    let sers: Vec<&El> = group.elements().filter(|e| e.name == "ser").collect();
    assert_eq!(sers.len(), resolved.series.len());
    for (ser, data) in sers.iter().zip(&resolved.series) {
        let name = ser.find("strCache").unwrap();
        assert_eq!(cache(name), [Some(data.name.clone())]);
        let cats = ser.child("cat").unwrap().find("strCache").unwrap();
        let expect: Vec<Option<String>> = data.categories.iter().cloned().map(Some).collect();
        assert_eq!(cache(cats), expect);
        let nums = ser.child("val").unwrap().find("numCache").unwrap();
        let expect: Vec<Option<String>> = data
            .values
            .iter()
            .map(|v| v.map(|n| format!("{n}")))
            .collect();
        assert_eq!(cache(nums), expect);
        assert_eq!(
            nums.child("formatCode").map(El::text),
            Some(data.format_code.clone().unwrap_or_else(|| "General".into()))
        );
    }
    assert_eq!(resolved.series[1].values[1], Some(6.0));
    assert_eq!(resolved.series[0].values[2], None);
    assert_eq!(resolved.series[1].format_code.as_deref(), Some("0.0"));
}

#[test]
fn unresolvable_references_keep_their_cache_and_unsupported_charts_survive() {
    let (mut wb, s) = data_book();
    let mut chart = Chart::new(ChartKind::Line {
        grouping: Grouping::Standard,
        markers: false,
    });
    chart.series.push(Series {
        name: Some(TextSource::Ref {
            formula: "Gone!$A$1".into(),
            cache: Some("Old".into()),
        }),
        ..Series::new(DataRef::Ref {
            formula: "Gone!$A$2:$A$3".into(),
            cache: Some(vec![ChartValue::Number(1.0), ChartValue::Number(2.5)]),
        })
    });
    let radar = r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:radarChart><c:radarStyle val="marker"/></c:radarChart></c:plotArea></c:chart></c:chartSpace>"#;
    let unsupported = Chart::new(ChartKind::Unsupported {
        kind: "radarChart".into(),
        xml: radar.into(),
    });
    for chart in [chart, unsupported] {
        wb.add_chart(
            s,
            ChartObject {
                id: 0,
                name: String::new(),
                anchor: anchor(),
                chart,
                pivot: None,
            },
        )
        .unwrap();
    }
    let d = wb.chart_data(s, 1).unwrap();
    assert_eq!(d.series[0].values, [Some(1.0), Some(2.5)]);
    assert_eq!(d.series[0].name, "Old");
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert_eq!(part(&bytes, "/xl/charts/chart2.xml"), radar.as_bytes());
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("radarChart"), "{warnings:?}");
}

#[test]
fn reference_workbooks() {
    // Clustered column + line combo with titles, axis titles and legend.
    let wb = fmt_xlsx::read(&load("provisional-chart-combo.xlsx")).unwrap();
    let s = wb.sheet_id("Sales").unwrap();
    let c = &wb.charts(s)[0];
    assert!(matches!(c.anchor, ChartAnchor::OneCell { .. }));
    let chart = &c.chart;
    assert_eq!(chart.kind, ChartKind::Combo);
    assert_eq!(chart.title, Some(ChartTitle::literal("Revenue and profit")));
    assert_eq!(chart.axes.cat.title, Some(ChartTitle::literal("Month")));
    assert_eq!(chart.legend.unwrap().position, LegendPosition::Bottom);
    assert_eq!(chart.series[0].kind, Some(ChartKind::column()));
    assert!(matches!(chart.series[1].kind, Some(ChartKind::Line { .. })));
    let d = wb.chart_data(s, c.id).unwrap();
    assert_eq!(d.series[0].name, "Revenue");
    assert_eq!(d.series[1].values[5], Some(61.0));
    assert_eq!(d.series[0].categories[0], "Jan");

    // Pie with data labels + doughnut.
    let wb = fmt_xlsx::read(&load("provisional-chart-pie.xlsx")).unwrap();
    let s = wb.sheet_id("Share").unwrap();
    let charts = wb.charts(s);
    assert_eq!(charts.len(), 2);
    assert_eq!(charts[0].chart.kind, ChartKind::Pie);
    assert!(charts[0].chart.data_labels.show_percent);
    assert!(charts[0].chart.data_labels.show_category);
    assert!(charts[0].chart.vary_colors);
    assert_eq!(charts[1].chart.kind, ChartKind::Doughnut);
    assert_eq!(charts[1].chart.hole_size, Some(60));
    let d = wb.chart_data(s, charts[0].id).unwrap();
    assert_eq!(d.series[0].values.iter().flatten().sum::<f64>(), 100.0);

    // Scatter, stacked bar, stacked area and a secondary axis on one sheet.
    let wb = fmt_xlsx::read(&load("provisional-chart-mixed.xlsx")).unwrap();
    let s = wb.sheet_id("Data").unwrap();
    let charts = wb.charts(s);
    assert_eq!(charts.len(), 4);
    let ChartKind::Scatter { style } = charts[0].chart.kind else {
        panic!("{:?}", charts[0].chart.kind)
    };
    assert!(style.is_smooth());
    assert_eq!(charts[0].chart.style, 13);
    assert_eq!(charts[0].chart.axes.val.max, Some(8.0));
    assert_eq!(charts[0].chart.axes.val.major_unit, Some(2.0));
    let d = wb.chart_data(s, charts[0].id).unwrap();
    assert_eq!(
        d.series[0].x_values.as_deref(),
        Some(&[Some(1.0), Some(2.0), Some(3.0), Some(4.0), Some(5.0)][..])
    );
    assert_eq!(
        charts[1].chart.kind,
        ChartKind::Bar {
            direction: BarDirection::Bar,
            grouping: Grouping::Stacked
        }
    );
    assert_eq!(
        charts[2].chart.kind,
        ChartKind::Area {
            grouping: Grouping::Stacked
        }
    );
    let combo = &charts[3].chart;
    assert_eq!(combo.kind, ChartKind::Combo);
    assert_eq!(combo.series[1].axis, AxisGroup::Secondary);
    let second = combo.axes.second_val.as_ref().unwrap();
    assert_eq!(second.title, Some(ChartTitle::literal("Y1")));
}
