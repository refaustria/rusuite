//! P9-C5: sort by colour, font colour and icon, custom lists, left-to-right
//! sorts; colour, icon and date-group filters; AutoFilter growth and rows
//! hidden by hand.

use core_model::{Color, Rgb, RunProperties};
use engine_formula::{CellCoord, SheetId};
use model_sheet::{
    AutoFilter, CellRange, CellStyle, CfKind, CfRule, CfValue, DateGroup, DxfStyle, Fill, Filter,
    IconSetKind, RowInfo, SortKey, SortOn, SortSpec, Workbook, BUILTIN_CUSTOM_LISTS,
};

const S: SheetId = SheetId(0);

fn at(r: u32, c: u32) -> CellCoord {
    CellCoord::new(S, r, c)
}

fn set_col(wb: &mut Workbook, col: u32, inputs: &[&str]) {
    for (r, input) in inputs.iter().enumerate() {
        wb.set_input(at(r as u32, col), input).unwrap();
    }
}

fn col(wb: &Workbook, c: u32, rows: u32) -> Vec<String> {
    (0..rows).map(|r| wb.display_text(at(r, c))).collect()
}

fn red() -> Color {
    Color::Rgb(Rgb::new(255, 0, 0))
}

fn fill(wb: &mut Workbook, r: u32, c: u32, color: Color) {
    let id = wb.intern_style(&CellStyle {
        fill: Some(Fill::Solid(color)),
        ..Default::default()
    });
    wb.set_style(at(r, c), id).unwrap();
}

fn sort(wb: &mut Workbook, range: CellRange, keys: Vec<SortKey>, columns: bool) {
    let spec = SortSpec {
        keys,
        columns,
        ..Default::default()
    };
    wb.sort_range(range, &spec).unwrap();
}

#[test]
fn sort_by_cell_colour_on_top_and_bottom_with_conditional_formats() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["a", "b", "c", "d", "e"]);
    fill(&mut wb, 1, 0, red());
    fill(&mut wb, 3, 0, red());
    let key = |ascending| SortKey {
        sort_on: SortOn::CellColor { color: Some(red()) },
        ..SortKey::new(0, ascending)
    };
    sort(
        &mut wb,
        CellRange::new(S, 0, 0, 4, 0),
        vec![key(true)],
        false,
    );
    assert_eq!(col(&wb, 0, 5), ["b", "d", "a", "c", "e"]);
    sort(
        &mut wb,
        CellRange::new(S, 0, 0, 4, 0),
        vec![key(false)],
        false,
    );
    assert_eq!(col(&wb, 0, 5), ["a", "c", "e", "b", "d"]);
    // A conditional format's fill counts as the cell's colour.
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["1", "9", "2", "8"]);
    wb.add_cf_rule(
        S,
        CfRule {
            ranges: vec![engine_formula::CellRect {
                r0: 0,
                c0: 0,
                r1: 3,
                c1: 0,
            }],
            dxf: Some(DxfStyle {
                fill: Some(red()),
                font_color: Some(Color::Rgb(Rgb::new(0, 0, 255))),
                ..Default::default()
            }),
            ..CfRule::new(CfKind::CellIs {
                op: model_sheet::CompareOp::GreaterThan,
                formulas: vec!["5".into()],
            })
        },
    )
    .unwrap();
    let colors = wb.line_colors(CellRange::new(S, 0, 0, 3, 0), 0, false);
    assert_eq!(colors.fills, [None, Some(red())]);
    assert_eq!(colors.fonts, [None, Some(Color::Rgb(Rgb::new(0, 0, 255)))]);
    sort(
        &mut wb,
        CellRange::new(S, 0, 0, 3, 0),
        vec![key(true)],
        false,
    );
    assert_eq!(col(&wb, 0, 4), ["9", "8", "1", "2"]);
    // Font colour, "automatic" on top.
    let auto = SortKey {
        sort_on: SortOn::FontColor { color: None },
        ..SortKey::new(0, true)
    };
    sort(&mut wb, CellRange::new(S, 0, 0, 3, 0), vec![auto], false);
    assert_eq!(col(&wb, 0, 4), ["1", "2", "9", "8"]);
}

#[test]
fn sort_by_font_colour_and_by_icon() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["10", "50", "90", "30"]);
    let blue = Color::Rgb(Rgb::new(0, 0, 255));
    let id = wb.intern_style(&CellStyle {
        font: RunProperties {
            color: Some(blue),
            ..Default::default()
        },
        ..Default::default()
    });
    wb.set_style(at(3, 0), id).unwrap();
    let key = SortKey {
        sort_on: SortOn::FontColor { color: Some(blue) },
        ..SortKey::new(0, true)
    };
    sort(&mut wb, CellRange::new(S, 0, 0, 3, 0), vec![key], false);
    assert_eq!(col(&wb, 0, 4), ["30", "10", "50", "90"]);
    // Icons of a 3-arrow set: 30 → 0 (down), 10 → 0, 50 → 1, 90 → 2.
    let pct = |p: &str| CfValue::Percent(p.into());
    wb.add_cf_rule(
        S,
        CfRule {
            ranges: vec![engine_formula::CellRect {
                r0: 0,
                c0: 0,
                r1: 3,
                c1: 0,
            }],
            ..CfRule::new(CfKind::IconSet {
                set: IconSetKind::Arrows3,
                thresholds: vec![pct("0"), pct("33"), pct("67")],
                reverse: false,
                show_value: true,
                greater: Vec::new(),
            })
        },
    )
    .unwrap();
    let up = SortKey {
        sort_on: SortOn::Icon {
            set: IconSetKind::Arrows3,
            icon: 2,
        },
        ..SortKey::new(0, true)
    };
    let mid = SortKey {
        sort_on: SortOn::Icon {
            set: IconSetKind::Arrows3,
            icon: 1,
        },
        ..SortKey::new(0, true)
    };
    sort(&mut wb, CellRange::new(S, 0, 0, 3, 0), vec![up, mid], false);
    assert_eq!(col(&wb, 0, 4), ["90", "50", "30", "10"]);
    let icons = wb
        .line_colors(CellRange::new(S, 0, 0, 3, 0), 0, false)
        .icons;
    assert_eq!(icons.len(), 3);
}

#[test]
fn custom_lists_and_left_to_right() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["Wed", "x", "mon", "Sun", "Fri"]);
    let days: Vec<String> = BUILTIN_CUSTOM_LISTS[0]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let key = SortKey {
        custom_list: Some(days),
        ..SortKey::new(0, true)
    };
    sort(&mut wb, CellRange::new(S, 0, 0, 4, 0), vec![key], false);
    assert_eq!(col(&wb, 0, 5), ["Sun", "mon", "Wed", "Fri", "x"]);
    // Left to right by row 1, formulas follow their column.
    let mut wb = Workbook::new();
    for (c, v) in ["3", "1", "2"].iter().enumerate() {
        wb.set_input(at(0, c as u32), v).unwrap();
        wb.set_input(at(1, c as u32), &format!("={}1*10", ["A", "B", "C"][c]))
            .unwrap();
    }
    sort(
        &mut wb,
        CellRange::new(S, 0, 0, 1, 2),
        vec![SortKey::new(0, true)],
        true,
    );
    let row = |r: u32| {
        (0..3)
            .map(|c| wb.display_text(at(r, c)))
            .collect::<Vec<_>>()
    };
    assert_eq!(row(0), ["1", "2", "3"]);
    assert_eq!(row(1), ["10", "20", "30"]);
    let st = wb.sort_state(S).unwrap();
    assert!(st.column_sort);
    // A key outside the rows is rejected.
    let bad = SortSpec {
        keys: vec![SortKey::new(5, true)],
        columns: true,
        ..Default::default()
    };
    assert!(wb.sort_range(CellRange::new(S, 0, 0, 1, 2), &bad).is_err());
}

fn filter_book() -> Workbook {
    let mut wb = Workbook::new();
    set_col(
        &mut wb,
        0,
        &["Day", "45296", "45311", "45325", "45717", "n/a", ""],
    );
    let date = wb.intern_style(&CellStyle {
        number_format: Some("yyyy-mm-dd".into()),
        ..Default::default()
    });
    for r in 1..=4 {
        wb.set_style(at(r, 0), date).unwrap();
    }
    set_col(&mut wb, 1, &["Amt", "1", "2", "3", "4", "5", "6"]);
    wb.set_auto_filter(S, Some(AutoFilter::new(0, 0, 6, 1)))
        .unwrap();
    wb
}

fn hidden(wb: &Workbook) -> Vec<u32> {
    (1..=6).filter(|&r| wb.row_info(S, r).hidden).collect()
}

#[test]
fn date_group_filters_and_the_date_tree() {
    let mut wb = filter_book();
    let values = wb.filter_values(S, 0).unwrap();
    let dates: Vec<Option<[u32; 3]>> = values.iter().map(|v| v.date).collect();
    assert_eq!(
        dates[..4],
        [
            Some([2024, 1, 5]),
            Some([2024, 1, 20]),
            Some([2024, 2, 3]),
            Some([2025, 3, 1])
        ]
    );
    assert_eq!(dates[4..], [None, None]);
    // January 2024 and the whole of 2025, plus the blanks.
    let groups = vec![
        DateGroup {
            year: 2024,
            month: Some(1),
            day: None,
        },
        DateGroup {
            year: 2025,
            month: None,
            day: None,
        },
    ];
    wb.set_filter_column(
        S,
        0,
        Some(Filter::DateGroups {
            groups,
            values: vec![String::new()],
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden(&wb), [3, 5]);
    // A single day.
    wb.set_filter_column(
        S,
        0,
        Some(Filter::DateGroups {
            groups: vec![DateGroup {
                year: 2024,
                month: Some(2),
                day: Some(3),
            }],
            values: vec!["n/a".into()],
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden(&wb), [1, 2, 4, 6]);
}

#[test]
fn colour_and_icon_filters() {
    let mut wb = filter_book();
    fill(&mut wb, 2, 1, red());
    fill(&mut wb, 4, 1, red());
    wb.set_filter_column(
        S,
        1,
        Some(Filter::Color {
            color: Some(red()),
            font: false,
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden(&wb), [1, 3, 5, 6]);
    // No fill.
    wb.set_filter_column(
        S,
        1,
        Some(Filter::Color {
            color: None,
            font: false,
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden(&wb), [2, 4]);
    // An icon set over B2:B7 (1..6): the top icon for 5 and 6.
    let pct = |p: &str| CfValue::Percent(p.into());
    wb.add_cf_rule(
        S,
        CfRule {
            ranges: vec![engine_formula::CellRect {
                r0: 1,
                c0: 1,
                r1: 6,
                c1: 1,
            }],
            ..CfRule::new(CfKind::IconSet {
                set: IconSetKind::Flags3,
                thresholds: vec![pct("0"), pct("50"), pct("75")],
                reverse: false,
                show_value: true,
                greater: Vec::new(),
            })
        },
    )
    .unwrap();
    wb.set_filter_column(
        S,
        1,
        Some(Filter::Icon {
            set: IconSetKind::Flags3,
            icon: 2,
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden(&wb), [1, 2, 3, 4]);
}

#[test]
fn typing_under_the_range_grows_it_and_hand_hidden_rows_settle() {
    let mut wb = filter_book();
    wb.set_input(at(7, 1), "7").unwrap();
    assert!(wb.grow_auto_filter(S, 7, 1).unwrap());
    assert_eq!(wb.auto_filter(S).unwrap().r1, 7);
    // Not below the range, outside its columns, or an empty cell: no growth.
    wb.set_input(at(9, 1), "x").unwrap();
    assert!(!wb.grow_auto_filter(S, 9, 1).unwrap());
    wb.set_input(at(8, 4), "x").unwrap();
    assert!(!wb.grow_auto_filter(S, 8, 4).unwrap());
    assert!(!wb.grow_auto_filter(S, 8, 1).unwrap());
    // As read from a file: every hidden row is marked filtered.
    wb.set_filter_column(
        S,
        1,
        Some(Filter::Values {
            values: vec!["1".into(), "2".into()],
        }),
    )
    .unwrap();
    for r in [2, 3] {
        wb.set_row_info(
            S,
            r,
            RowInfo {
                hidden: true,
                filtered: true,
                ..Default::default()
            },
        )
        .unwrap();
    }
    wb.settle_filtered_rows(S).unwrap();
    // Row 3 (2) passes: hidden by hand; row 4 (3) fails: filtered.
    assert!(wb.row_info(S, 2).hidden && !wb.row_info(S, 2).filtered);
    assert!(wb.row_info(S, 3).filtered);
}
