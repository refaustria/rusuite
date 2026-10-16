use core_model::{Color, FontSize, Rgb, RunProperties};
use engine_formula::{CellCoord, RangeRef, SheetId, Value};
use model_sheet::{
    CellContent, CellStyle, ColInfo, Error, Fill, RowInfo, SheetFormat, StyleId, Workbook,
    WorkbookSnapshot,
};

fn bold() -> CellStyle {
    CellStyle {
        font: RunProperties {
            bold: Some(true),
            ..Default::default()
        },
        ..Default::default()
    }
}

fn fill() -> CellStyle {
    CellStyle {
        fill: Some(Fill::Solid(Color::Rgb(Rgb::new(255, 255, 0)))),
        ..Default::default()
    }
}

#[test]
fn input_and_style_on_a1() {
    let mut wb = Workbook::new();
    let s = wb.sheet_id("sheet1").unwrap();
    let a1 = CellCoord::new(s, 0, 0);
    wb.set_input(a1, "12").unwrap();
    let id = wb.intern_style(&bold());
    assert_eq!(id, StyleId(1));
    wb.set_style(a1, id).unwrap();
    assert_eq!(wb.value(a1), Value::Number(12.0));
    assert_eq!(wb.style_id(a1), id);
    assert_eq!(wb.style(a1), &bold());
    assert_eq!(wb.style_id(CellCoord::new(s, 0, 1)), StyleId::DEFAULT);
    // Clearing keeps the style.
    wb.clear(a1).unwrap();
    assert_eq!(wb.content(a1), &CellContent::Empty);
    assert_eq!(wb.style_id(a1), id);
    assert_eq!(wb.used_range(s), Some((0, 0)));
    assert_eq!(
        wb.set_style(a1, StyleId(42)),
        Err(Error::UnknownStyle(StyleId(42)))
    );
    assert_eq!(
        wb.set_style(CellCoord::new(SheetId(7), 0, 0), id),
        Err(Error::UnknownSheet(SheetId(7)))
    );
}

#[test]
fn apply_style_patch_merges_per_cell() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let a1 = CellCoord::new(s, 0, 0);
    let id = wb.intern_style(&bold());
    wb.set_style(a1, id).unwrap();
    let changed = wb
        .apply_style_patch(RangeRef::new(s, 0, 0, 1, 1), &fill())
        .unwrap();
    assert_eq!(changed.len(), 4);
    assert_eq!(wb.style(a1).font.bold, Some(true));
    assert_eq!(wb.style(a1).fill, fill().fill);
    let b2 = CellCoord::new(s, 1, 1);
    assert_eq!(wb.style(b2), &fill());
    // Same patch again changes nothing; styles are shared.
    assert!(wb
        .apply_style_patch(RangeRef::new(s, 0, 0, 1, 1), &fill())
        .unwrap()
        .is_empty());
    assert_eq!(wb.styles().len(), 4); // default, bold, bold+fill, fill
    assert_eq!(
        wb.apply_style_patch(
            RangeRef {
                sheet: s,
                r0: 2,
                c0: 0,
                r1: 1,
                c1: 0
            },
            &fill()
        ),
        Err(Error::InvalidRange)
    );
    assert_eq!(
        wb.apply_style_patch(RangeRef::new(s, 0, 0, 1_048_575, 16_383), &fill()),
        Err(Error::RangeTooLarge)
    );
}

#[test]
fn row_and_column_styles_are_fallbacks() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let b = wb.intern_style(&bold());
    let f = wb.intern_style(&fill());
    wb.set_col_info(
        s,
        2,
        ColInfo {
            style: Some(b),
            ..Default::default()
        },
    )
    .unwrap();
    wb.set_row_info(
        s,
        5,
        RowInfo {
            style: Some(f),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(wb.style_id(CellCoord::new(s, 0, 2)), b);
    assert_eq!(wb.style_id(CellCoord::new(s, 5, 2)), f);
    assert_eq!(wb.cell_style_id(CellCoord::new(s, 5, 2)), StyleId::DEFAULT);
    // A patch on a column-styled cell keeps the column's font.
    wb.apply_style_patch(RangeRef::new(s, 1, 2, 1, 2), &fill())
        .unwrap();
    assert_eq!(
        wb.style(CellCoord::new(s, 1, 2)),
        &bold().merged_with(&fill())
    );
}

#[test]
fn dimensions() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    assert_eq!(wb.col_info(s, 3), ColInfo::default());
    wb.set_col_width(s, 3, Some(20.5)).unwrap();
    wb.set_col_hidden(s, 3, true).unwrap();
    assert_eq!(
        wb.col_info(s, 3),
        ColInfo {
            width: Some(20.5),
            hidden: true,
            style: None,
            ..Default::default()
        }
    );
    wb.set_row_height(s, 0, Some(30.0)).unwrap();
    wb.set_row_hidden(s, 9, true).unwrap();
    assert_eq!(wb.row_info(s, 0).height, Some(30.0));
    assert!(wb.row_info(s, 9).hidden);
    // Resetting to defaults removes the entry.
    wb.set_row_hidden(s, 9, false).unwrap();
    assert_eq!(wb.rows(s).count(), 1);
    assert_eq!(
        wb.set_col_width(s, 0, Some(-1.0)),
        Err(Error::InvalidDimension(-1.0))
    );
    assert_eq!(wb.sheet_format(s), SheetFormat::default());
    assert_eq!(SheetFormat::default().default_col_width, 8.43);
    let fmt = SheetFormat {
        default_col_width: 10.0,
        default_row_height: 12.75,
    };
    wb.set_sheet_format(s, fmt).unwrap();
    assert_eq!(wb.sheet_format(s), fmt);
    // Dimension entries do not extend the used range.
    assert_eq!(wb.used_range(s), None);
}

#[test]
fn sheets() {
    let mut wb = Workbook::new();
    let s2 = wb.add_sheet("Data").unwrap();
    assert!(matches!(wb.add_sheet("data"), Err(Error::Engine(_))));
    wb.rename_sheet(s2, "Facts").unwrap();
    assert_eq!(
        wb.sheets(),
        vec![
            (SheetId(0), "Sheet1".to_string()),
            (s2, "Facts".to_string())
        ]
    );
    assert_eq!(wb.sheet_id("FACTS"), Some(s2));
    // Sheets added behind the workbook's back still get style storage.
    let s3 = wb.engine_mut().add_sheet("Raw").unwrap();
    wb.set_col_width(s3, 0, Some(3.0)).unwrap();
    assert_eq!(wb.col_info(s3, 0).width, Some(3.0));
}

#[test]
fn cells_in_skips_empty_and_default_cells() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    wb.set_input(CellCoord::new(s, 0, 0), "1").unwrap();
    wb.set_input(CellCoord::new(s, 3, 3), "x").unwrap();
    let f = wb.intern_style(&fill());
    wb.set_style(CellCoord::new(s, 1, 1), f).unwrap();
    // Explicit default style is not stored.
    wb.set_style(CellCoord::new(s, 2, 2), StyleId::DEFAULT)
        .unwrap();
    let got: Vec<_> = wb
        .cells_in(RangeRef::new(s, 0, 0, 1_048_575, 16_383))
        .map(|(c, content, style)| (c.row, c.col, content.clone(), style))
        .collect();
    assert_eq!(
        got,
        vec![
            (0, 0, CellContent::Value(Value::Number(1.0)), StyleId(0)),
            (1, 1, CellContent::Empty, f),
            (
                3,
                3,
                CellContent::Value(Value::Text("x".into())),
                StyleId(0)
            ),
        ]
    );
    assert_eq!(wb.cells_in(RangeRef::new(s, 1, 0, 2, 0)).count(), 0);
    assert_eq!(
        wb.cells_in(RangeRef::new(SheetId(5), 0, 0, 9, 9)).count(),
        0
    );
}

fn sample() -> Workbook {
    let mut wb = Workbook::new();
    let s1 = SheetId(0);
    let s2 = wb.add_sheet("Data").unwrap();
    wb.set_input(CellCoord::new(s2, 0, 0), "20").unwrap();
    wb.set_input(CellCoord::new(s2, 1, 0), "'007").unwrap();
    wb.set_input(CellCoord::new(s1, 0, 0), "=Data!A1*2+1")
        .unwrap();
    wb.set_input(CellCoord::new(s1, 0, 1), "TRUE").unwrap();
    let style = CellStyle {
        font: RunProperties {
            bold: Some(true),
            size: Some(FontSize::from_pt(14.0)),
            ..Default::default()
        },
        number_format: Some("0.00".into()),
        ..fill()
    };
    let id = wb.intern_style(&style);
    wb.set_style(CellCoord::new(s1, 0, 0), id).unwrap();
    wb.set_col_width(s1, 0, Some(18.0)).unwrap();
    wb.set_row_hidden(s2, 4, true).unwrap();
    wb
}

#[test]
fn snapshot_roundtrip() {
    let wb = sample();
    let a1 = CellCoord::new(SheetId(0), 0, 0);
    assert_eq!(wb.value(a1), Value::Number(41.0));
    let json = serde_json::to_value(&wb).unwrap();
    insta::assert_json_snapshot!(json);

    let back: Workbook = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(back.value(a1), wb.value(a1));
    assert_eq!(back.formula_text(a1), Some("=Data!A1*2+1"));
    assert_eq!(
        back.value(CellCoord::new(SheetId(1), 1, 0)),
        Value::Text("007".into())
    );
    assert_eq!(back.style(a1), wb.style(a1));
    assert_eq!(back.col_info(SheetId(0), 0).width, Some(18.0));
    assert_eq!(serde_json::to_value(&back).unwrap(), json);
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
}

#[test]
fn from_snapshot_remaps_and_validates() {
    let mut snap: WorkbookSnapshot = sample().to_snapshot();
    // A duplicate style entry gets merged; its users are remapped.
    let dup = snap.styles[1].clone();
    snap.styles.push(dup);
    snap.sheets[1].cells[0].style = StyleId(2);
    let wb = Workbook::from_snapshot(&snap).unwrap();
    assert_eq!(wb.styles().len(), 2);
    assert_eq!(wb.style_id(CellCoord::new(SheetId(1), 0, 0)), StyleId(1));

    snap.sheets[1].cells[0].style = StyleId(9);
    assert_eq!(
        Workbook::from_snapshot(&snap).err(),
        Some(Error::UnknownStyle(StyleId(9)))
    );
    snap.sheets.clear();
    assert!(matches!(
        Workbook::from_snapshot(&snap),
        Err(Error::InvalidSnapshot(_))
    ));
    let bad = serde_json::json!({"sheets": [{"name": "S", "cells": [{"row": 0, "col": 0, "input": "=1+"}]}], "styles": [{}]});
    assert!(serde_json::from_value::<Workbook>(bad).is_err());
}
