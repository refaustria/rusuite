//! P9-C5: the reference workbook `provisional-condfmt-c5.xlsx` (openpyxl
//! plus the Excel 2010 parts as Excel writes them): new rule types, x14
//! data bar options, a cross-sheet list validation, a date-group and a
//! colour filter, a colour sort condition and a row hidden by hand.

use std::path::PathBuf;

use core_model::{Color, Rgb};
use engine_formula::{CellCoord, RangeRef};
use model_sheet::{
    CfKind, DataBarAxis, Filter, ListSource, SortOn, TimePeriod, ValidationKind, Workbook,
};

fn reference() -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx/provisional-condfmt-c5.xlsx");
    std::fs::read(p).unwrap()
}

fn check(wb: &Workbook) {
    let s = wb.sheet_id("Rules").unwrap();
    let kinds: Vec<&CfKind> = wb.cf_rules(s).iter().map(|r| &r.kind).collect();
    assert_eq!(
        kinds[0],
        &CfKind::TimePeriod {
            period: TimePeriod::LastMonth
        }
    );
    assert!(matches!(
        kinds[1],
        CfKind::AboveAverage {
            std_dev: Some(1),
            ..
        }
    ));
    let CfKind::DataBar {
        gradient,
        border,
        negative_color,
        negative_border,
        axis,
        axis_color,
        min_length,
        max_length,
        ..
    } = kinds[2]
    else {
        panic!("data bar")
    };
    assert!(!gradient);
    assert_eq!(*border, Some(Color::Rgb(Rgb::new(0x63, 0x8E, 0xC6))));
    assert_eq!(*negative_color, Some(Color::Rgb(Rgb::new(0, 0x70, 0xC0))));
    assert_eq!(*negative_border, Some(Color::Rgb(Rgb::new(0, 0x20, 0x60))));
    assert_eq!(*axis, DataBarAxis::Midpoint);
    assert_eq!(*axis_color, Some(Color::Rgb(Rgb::new(0x7F, 0x7F, 0x7F))));
    assert_eq!((*min_length, *max_length), (0, 100));
    let CfKind::IconSet {
        greater, reverse, ..
    } = kinds[3]
    else {
        panic!("icon set")
    };
    assert!(*reverse && greater == &[false, true, false]);
    // The number format of the last rule shows in E5 (120 > 100).
    let cf = wb.effective_cf(RangeRef::new(s, 4, 4, 4, 4));
    assert_eq!(cf[0].1.display.as_deref(), Some("120.0 pts"));
    // The data bar of C2 (-30, the lowest) grows left of the midpoint axis.
    let bars = wb.effective_cf(RangeRef::new(s, 1, 2, 1, 2));
    let bar = bars[0].1.bar.as_ref().unwrap();
    assert!(bar.negative && bar.axis == Some(0.5) && bar.to == 0.5);
    // Validations: the cross-sheet list and the circled G2 = 12.
    let list = wb
        .validations(s)
        .iter()
        .find(|v| matches!(v.kind, ValidationKind::List { .. }))
        .unwrap();
    assert_eq!(
        list.kind,
        ValidationKind::List {
            source: ListSource::Formula {
                formula: "Lists!$A$1:$A$3".into()
            }
        }
    );
    assert_eq!(
        wb.list_values(CellCoord::new(s, 3, 5)),
        ["Apple", "Pear", "Plum"]
    );
    assert_eq!(wb.invalid_cells(s, 255), [CellCoord::new(s, 1, 6)]);
    // Sort sheet: date groups, colour filter and sort, hidden by hand.
    let t = wb.sheet_id("Sort").unwrap();
    let af = wb.auto_filter(t).unwrap();
    assert!(matches!(af.columns[0].filter, Filter::DateGroups { .. }));
    let yellow = Some(Color::Rgb(Rgb::new(255, 255, 0)));
    assert_eq!(
        af.columns[1].filter,
        Filter::Color {
            color: yellow,
            font: false
        }
    );
    let st = wb.sort_state(t).unwrap();
    assert_eq!(st.keys[0].sort_on, SortOn::CellColor { color: yellow });
    let info = |r| wb.row_info(t, r);
    assert!(info(3).filtered && info(4).filtered);
    assert!(info(5).hidden && !info(5).filtered);
    assert!(!info(1).hidden && !info(2).hidden);
}

#[test]
fn reference_workbook_is_read() {
    let (wb, warnings) = fmt_xlsx::read_with_warnings(&reference()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    check(&wb);
}

#[test]
fn reference_workbook_roundtrips() {
    let wb = fmt_xlsx::read(&reference()).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&fmt_xlsx::write(&wb).unwrap()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    check(&back);
    for (s, _) in wb.sheets() {
        assert_eq!(back.cf_rules(s), wb.cf_rules(s));
        assert_eq!(back.auto_filter(s), wb.auto_filter(s));
        assert_eq!(back.sort_state(s), wb.sort_state(s));
    }
}
