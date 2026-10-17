//! P9-C6: chart formats and elements, chart sheets and sparklines in
//! `.xlsx` files.

use std::io::Cursor;
use std::path::PathBuf;

use core_model::chart::{AreaFill, CellClass, Chart, ErrorAmount, ErrorBarType, ShapeFormat};
use core_model::{Color, Media, Rgb};
use engine_formula::{CellCoord, SheetId};
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    ChartAnchor, ChartObject, Sparkline, SparklineAxis, SparklineEmpty, SparklineGroup,
    SparklineKind, Workbook, CHART_SHEET_SIZE,
};

fn load(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/xlsx");
    std::fs::read(path.join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn parts(xlsx: &[u8]) -> Vec<String> {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.parts().map(|(n, _)| n.to_string()).collect()
}

/// The targets of `source`'s relationships.
fn targets(xlsx: &[u8], source: &str) -> Vec<String> {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.relationships(&PartName::new(source).unwrap())
        .map(|r| r.iter().map(|x| x.target.clone()).collect())
        .unwrap_or_default()
}

fn content_type(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.part(&PartName::new(name).unwrap())
        .unwrap()
        .content_type
        .clone()
}

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    String::from_utf8(
        pkg.part(&PartName::new(name).unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap()
}

fn data_book() -> (Workbook, SheetId) {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    wb.rename_sheet(s, "Data").unwrap();
    let rows = [
        ["", "A", "B"],
        ["x", "1", "4"],
        ["y", "-2", "5"],
        ["z", "3", "6"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                .unwrap();
        }
    }
    (wb, s)
}

fn chart() -> Chart {
    let t = CellClass::Text;
    let n = CellClass::Number;
    let cells = vec![
        vec![CellClass::Empty, t, t],
        vec![t, n, n],
        vec![t, n, n],
        vec![t, n, n],
    ];
    Chart::from_range("Data", 0, 0, &cells).unwrap()
}

fn absolute() -> ChartAnchor {
    ChartAnchor::Absolute {
        x: 0,
        y: 0,
        width: CHART_SHEET_SIZE.0,
        height: CHART_SHEET_SIZE.1,
    }
}

#[test]
fn reference_workbook_charts_chart_sheet_and_sparklines() {
    let bytes = load("provisional-charts-c6.xlsx");
    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(
        !warnings
            .iter()
            .any(|w| w.contains("chartsheet") || w.contains("sparkline")),
        "{warnings:?}"
    );
    let s = wb.sheet_id("Data").unwrap();
    let charts = wb.charts(s);
    assert_eq!(charts.len(), 2);
    let col = &charts[0].chart;
    let Some(ShapeFormat {
        fill: Some(AreaFill::Gradient { stops, angle, .. }),
        ..
    }) = &col.chart_area
    else {
        panic!("{:?}", col.chart_area)
    };
    assert_eq!((stops.len(), *angle), (2, 90.0));
    assert_eq!(
        col.plot_area.as_ref().and_then(|p| p.fill.clone()),
        Some(AreaFill::Solid {
            color: Color::Rgb(Rgb::new(0xF2, 0xF2, 0xF2))
        })
    );
    assert_eq!(
        col.axes.cat.text_format.as_ref().and_then(|t| t.rotation),
        Some(-45)
    );
    assert_eq!(
        col.series[0].error_bars[0].amount,
        ErrorAmount::Fixed { value: 2.0 }
    );
    assert_eq!(col.series[1].error_bars[0].bar_type, ErrorBarType::Plus);
    let dt = col.data_table.as_ref().unwrap();
    assert!(dt.keys && dt.horizontal && dt.outline);
    let line = &charts[1].chart;
    assert_eq!(line.up_down_bars.as_ref().unwrap().gap_width, Some(150));
    assert!(line.high_low_lines.is_some());

    // The chart sheet.
    let cs = wb.sheet_id("Chart1").unwrap();
    assert!(wb.is_chart_sheet(cs) && !wb.is_chart_sheet(s));
    assert_eq!(wb.charts(cs).len(), 1);
    assert_eq!(
        wb.chart_data(cs, wb.charts(cs)[0].id).unwrap().series[0].values[4],
        Some(21.0)
    );

    // Sparklines.
    let groups = wb.sparkline_groups(s);
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].kind, SparklineKind::Line);
    assert!(groups[0].high && groups[0].low && groups[0].markers);
    assert_eq!(groups[0].colors.high, Color::Rgb(Rgb::new(0, 0xB0, 0x50)));
    assert_eq!(groups[0].sparklines[1].data, "Data!C2:C6");
    assert_eq!(
        (groups[0].sparklines[1].row, groups[0].sparklines[1].col),
        (7, 2)
    );
    assert_eq!(groups[1].kind, SparklineKind::Column);
    assert!(groups[1].negative && groups[1].show_axis);
    assert_eq!(groups[1].sparklines.len(), 5);
    let d = wb.sparkline_data(s, &groups[1]);
    assert_eq!(d[0].values, [Some(5.0), Some(-2.0), Some(8.0), Some(3.0)]);

    // Everything survives a save.
    let out = fmt_xlsx::write(&wb).unwrap();
    let names = parts(&out);
    assert!(
        names.contains(&"/xl/chartsheets/sheet1.xml".to_owned()),
        "{names:?}"
    );
    let sheet = part(&out, "/xl/worksheets/sheet1.xml");
    assert!(sheet.contains("{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"));
    assert!(sheet.contains("<x14:sparklineGroup type=\"column\""));
    let back = fmt_xlsx::read(&out).unwrap();
    let bs = back.sheet_id("Data").unwrap();
    assert_eq!(back.sparkline_groups(bs), wb.sparkline_groups(s));
    assert_eq!(back.charts(bs), wb.charts(s));
    let bcs = back.sheet_id("Chart1").unwrap();
    assert!(back.is_chart_sheet(bcs));
    assert_eq!(back.charts(bcs), wb.charts(cs));
}

#[test]
fn chart_sheet_written_from_a_new_workbook() {
    let (mut wb, s) = data_book();
    let cs = wb.add_sheet("Chart1").unwrap();
    wb.set_chart_sheet(cs, true).unwrap();
    wb.add_chart(
        cs,
        ChartObject {
            id: 0,
            name: String::new(),
            anchor: absolute(),
            chart: chart(),
            pivot: None,
        },
    )
    .unwrap();
    wb.set_active_sheet(Some(cs));
    let out = fmt_xlsx::write(&wb).unwrap();
    let book = part(&out, "/xl/workbook.xml");
    assert!(
        book.contains(r#"<sheet name="Chart1" sheetId="2" r:id="rId2"/>"#),
        "{book}"
    );
    let rels = targets(&out, "/xl/workbook.xml");
    assert_eq!(rels[1], "chartsheets/sheet1.xml", "{rels:?}");
    let cs_xml = part(&out, "/xl/chartsheets/sheet1.xml");
    assert!(cs_xml.contains(r#"<sheetView tabSelected="1" zoomToFit="1" workbookViewId="0"/>"#));
    assert!(cs_xml.contains("<drawing r:id="));
    let ct = content_type(&out, "/xl/chartsheets/sheet1.xml");
    assert!(ct.ends_with("spreadsheetml.chartsheet+xml"), "{ct}");
    let back = fmt_xlsx::read(&out).unwrap();
    let bcs = back.sheet_id("Chart1").unwrap();
    assert!(back.is_chart_sheet(bcs));
    assert_eq!(back.charts(bcs)[0].anchor, absolute());
    assert_eq!(back.active_sheet(), bcs);
    let _ = s;
}

#[test]
fn picture_fills_are_written_as_image_parts() {
    let (mut wb, s) = data_book();
    let media = Media {
        content_type: "image/png".into(),
        data: vec![0x89, b'P', b'N', b'G', 1, 2, 3],
    };
    let mut c = chart();
    c.chart_area = Some(ShapeFormat {
        fill: Some(AreaFill::Picture {
            media: media.clone(),
            tile: false,
        }),
        ..ShapeFormat::default()
    });
    wb.add_chart(
        s,
        ChartObject {
            id: 0,
            name: String::new(),
            anchor: absolute(),
            chart: c.clone(),
            pivot: None,
        },
    )
    .unwrap();
    let out = fmt_xlsx::write(&wb).unwrap();
    assert!(parts(&out).contains(&"/xl/media/image1.png".to_owned()));
    let rels = targets(&out, "/xl/charts/chart1.xml");
    assert_eq!(rels, ["../media/image1.png"]);
    let (back, warnings) = fmt_xlsx::read_with_warnings(&out).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.charts(s)[0].chart.chart_area, c.chart_area);
}

#[test]
fn ref_error_series_survive_a_save() {
    let (mut wb, data) = data_book();
    let host = wb.add_sheet("Report").unwrap();
    wb.add_chart(
        host,
        ChartObject {
            id: 0,
            name: String::new(),
            anchor: absolute(),
            chart: chart(),
            pivot: None,
        },
    )
    .unwrap();
    wb.remove_sheet(data).unwrap();
    let out = fmt_xlsx::write(&wb).unwrap();
    let xml = part(&out, "/xl/charts/chart1.xml");
    assert!(xml.contains("<c:f>#REF!</c:f>"), "{xml}");
    assert!(
        xml.contains("<c:v>-2</c:v>"),
        "the cached values are written"
    );
    let back = fmt_xlsx::read(&out).unwrap();
    let h = back.sheet_id("Report").unwrap();
    let d = back.chart_data(h, 1).unwrap();
    assert_eq!(d.series.len(), 2);
    assert_eq!(d.series[0].values, [Some(1.0), Some(-2.0), Some(3.0)]);
    assert_eq!(d.series[1].name, "B");
}

#[test]
fn sparkline_options_roundtrip() {
    let (mut wb, s) = data_book();
    let mut g = SparklineGroup::new(
        SparklineKind::WinLoss,
        vec![Sparkline {
            row: 5,
            col: 1,
            data: "Data!B2:B4".into(),
        }],
    );
    g.min_axis = SparklineAxis::Custom { value: -1.5 };
    g.max_axis = SparklineAxis::Group;
    g.right_to_left = true;
    g.display_hidden = true;
    g.empty_cells = SparklineEmpty::Span;
    g.line_weight = 2.25;
    g.date_range = Some("Data!C2:C4".into());
    g.first = true;
    g.last = true;
    g.colors = model_sheet::sparkline_style(17);
    let mut line = SparklineGroup::new(
        SparklineKind::Line,
        vec![Sparkline {
            row: 6,
            col: 1,
            data: "Data!C2:C4".into(),
        }],
    );
    line.colors.series = Color::Rgb(Rgb::new(1, 2, 3));
    wb.set_sparkline_groups(s, vec![g, line]).unwrap();
    let out = fmt_xlsx::write(&wb).unwrap();
    let back = fmt_xlsx::read(&out).unwrap();
    assert_eq!(back.sparkline_groups(s), wb.sparkline_groups(s));
}
