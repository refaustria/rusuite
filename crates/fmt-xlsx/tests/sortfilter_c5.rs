//! P9-C5: colour, icon and date-group filters, colour/icon/custom-list
//! sort conditions, left-to-right sort state and rows hidden by hand
//! ↔ `.xlsx`.

use std::io::Cursor;

use core_model::{Color, Rgb};
use engine_formula::{CellCoord, SheetId};
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    AutoFilter, CellRange, CellStyle, DateGroup, Fill, Filter, FilterColumn, IconSetKind, RowInfo,
    SortKey, SortOn, SortSpec, SortState, Workbook,
};

const S: SheetId = SheetId(0);

fn sheet_xml(bytes: &[u8]) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    String::from_utf8(
        pkg.part(&PartName::new("/xl/worksheets/sheet1.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap()
}

fn red() -> Color {
    Color::Rgb(Rgb::new(255, 0, 0))
}

#[test]
fn colour_icon_and_date_filters_roundtrip() {
    let mut wb = Workbook::new();
    for r in 0..6 {
        for c in 0..4 {
            wb.set_input(CellCoord::new(S, r, c), &(r * 10 + c).to_string())
                .unwrap();
        }
    }
    let mut af = AutoFilter::new(0, 0, 5, 3);
    af.columns = vec![
        FilterColumn {
            col: 0,
            filter: Filter::Color {
                color: Some(red()),
                font: false,
            },
        },
        FilterColumn {
            col: 1,
            filter: Filter::Color {
                color: Some(Color::Rgb(Rgb::new(0, 0, 255))),
                font: true,
            },
        },
        FilterColumn {
            col: 2,
            filter: Filter::Icon {
                set: IconSetKind::Arrows3,
                icon: 1,
            },
        },
        FilterColumn {
            col: 3,
            filter: Filter::DateGroups {
                groups: vec![
                    DateGroup {
                        year: 2024,
                        month: None,
                        day: None,
                    },
                    DateGroup {
                        year: 2025,
                        month: Some(3),
                        day: None,
                    },
                    DateGroup {
                        year: 2025,
                        month: Some(4),
                        day: Some(9),
                    },
                ],
                values: vec!["x".into(), String::new()],
            },
        },
    ];
    wb.set_auto_filter(S, Some(af.clone())).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = sheet_xml(&bytes);
    for needle in [
        r#"<colorFilter dxfId="0"/>"#,
        r#"<colorFilter dxfId="1" cellColor="0"/>"#,
        r#"<iconFilter iconSet="3Arrows" iconId="1"/>"#,
        r#"<filters blank="1"><filter val="x"/><dateGroupItem year="2024" dateTimeGrouping="year"/><dateGroupItem year="2025" month="3" dateTimeGrouping="month"/><dateGroupItem year="2025" month="4" day="9" dateTimeGrouping="day"/></filters>"#,
    ] {
        assert!(xml.contains(needle), "{needle}\n{xml}");
    }
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.auto_filter(S), Some(&af));
}

#[test]
fn colour_icon_list_and_column_sort_conditions_roundtrip() {
    let mut wb = Workbook::new();
    for r in 0..4 {
        for c in 0..3 {
            wb.set_input(CellCoord::new(S, r, c), &((3 - r) * 10 + c).to_string())
                .unwrap();
        }
    }
    let st = SortState {
        r0: 1,
        c0: 0,
        r1: 3,
        c1: 2,
        keys: vec![
            SortKey {
                sort_on: SortOn::CellColor { color: Some(red()) },
                ..SortKey::new(0, true)
            },
            SortKey {
                sort_on: SortOn::FontColor { color: None },
                ..SortKey::new(1, false)
            },
            SortKey {
                sort_on: SortOn::Icon {
                    set: IconSetKind::Flags3,
                    icon: 2,
                },
                ..SortKey::new(2, true)
            },
            SortKey {
                custom_list: Some(vec!["Mon".into(), "Tue".into()]),
                ..SortKey::new(2, true)
            },
        ],
        case_sensitive: true,
        column_sort: false,
    };
    wb.set_sort_state(S, Some(st.clone())).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = sheet_xml(&bytes);
    for needle in [
        r#"<sortCondition sortBy="cellColor" ref="A2:A4" dxfId="0"/>"#,
        r#"<sortCondition descending="1" sortBy="fontColor" ref="B2:B4" dxfId="1"/>"#,
        r#"<sortCondition sortBy="icon" ref="C2:C4" iconSet="3Flags" iconId="2"/>"#,
        r#"<sortCondition ref="C2:C4" customList="Mon,Tue"/>"#,
    ] {
        assert!(xml.contains(needle), "{needle}\n{xml}");
    }
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.sort_state(S), Some(&st));
    // Left to right: the keys are rows.
    let spec = SortSpec {
        keys: vec![SortKey::new(1, true)],
        columns: true,
        ..Default::default()
    };
    wb.sort_range(CellRange::new(S, 0, 0, 3, 2), &spec).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = sheet_xml(&bytes);
    assert!(
        xml.contains(r#"<sortState ref="A1:C4" columnSort="1">"#),
        "{xml}"
    );
    assert!(xml.contains(r#"<sortCondition ref="A2:C2"/>"#), "{xml}");
    assert_eq!(
        fmt_xlsx::read(&bytes).unwrap().sort_state(S),
        wb.sort_state(S)
    );
}

#[test]
fn rows_hidden_by_hand_inside_a_filtered_range_stay_hidden_but_not_filtered() {
    let mut wb = Workbook::new();
    for (r, v) in ["H", "a", "b", "a", "c"].iter().enumerate() {
        wb.set_input(CellCoord::new(S, r as u32, 0), v).unwrap();
    }
    let red_fill = wb.intern_style(&CellStyle {
        fill: Some(Fill::Solid(red())),
        ..Default::default()
    });
    wb.set_style(CellCoord::new(S, 2, 0), red_fill).unwrap();
    wb.set_auto_filter(S, Some(AutoFilter::new(0, 0, 4, 0)))
        .unwrap();
    wb.set_filter_column(
        S,
        0,
        Some(Filter::Values {
            values: vec!["a".into(), "b".into()],
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    // Row 2 ("b") hidden by hand.
    wb.set_row_info(
        S,
        2,
        RowInfo {
            hidden: true,
            ..Default::default()
        },
    )
    .unwrap();
    let back = fmt_xlsx::read(&fmt_xlsx::write(&wb).unwrap()).unwrap();
    let info = |w: &Workbook, r| w.row_info(S, r);
    assert!(info(&back, 2).hidden && !info(&back, 2).filtered);
    assert!(info(&back, 4).hidden && info(&back, 4).filtered);
    assert!(!info(&back, 1).hidden);
}
