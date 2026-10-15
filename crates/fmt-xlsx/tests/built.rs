//! A workbook built in code survives write → read unchanged.

use std::io::Cursor;

use core_model::{
    Color, FontFace, FontSize, Rgb, RunProperties, ThemeColorSlot, Underline, VerticalAlign,
};
use engine_formula::{CellCoord, ErrorKind, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    Alignment, BorderSide, BorderStyle, Borders, CellContent, CellStyle, ColInfo, Fill, HAlign,
    RowInfo, SheetFormat, VAlign, Workbook,
};

fn side(style: BorderStyle, color: Color) -> Option<BorderSide> {
    Some(BorderSide { style, color })
}

fn styles() -> Vec<CellStyle> {
    let red = Color::Rgb(Rgb::new(0xC0, 0, 0));
    let accent = Color::Theme {
        slot: ThemeColorSlot::Accent1,
        tint: -0.249977111117893,
    };
    vec![
        CellStyle {
            font: RunProperties {
                font: Some(FontFace::Named("Arial".into())),
                size: Some(FontSize::from_pt(14.5)),
                bold: Some(true),
                italic: Some(true),
                underline: Some(Underline::Double),
                strike: Some(true),
                color: Some(red),
                ..Default::default()
            },
            ..Default::default()
        },
        CellStyle {
            font: RunProperties {
                underline: Some(Underline::Single),
                vertical_align: Some(VerticalAlign::Superscript),
                color: Some(accent),
                ..Default::default()
            },
            fill: Some(Fill::Solid(Color::Theme {
                slot: ThemeColorSlot::Light2,
                tint: 0.5,
            })),
            ..Default::default()
        },
        CellStyle {
            fill: Some(Fill::Solid(Color::Rgb(Rgb::new(255, 255, 0)))),
            borders: Borders {
                left: side(BorderStyle::Thin, Color::Auto),
                right: side(BorderStyle::Medium, red),
                top: side(BorderStyle::Thick, accent),
                bottom: side(BorderStyle::Double, Color::theme(ThemeColorSlot::Dark1)),
            },
            number_format: Some("0.00".into()),
            ..Default::default()
        },
        CellStyle {
            borders: Borders {
                left: side(BorderStyle::Dashed, Color::Auto),
                right: side(BorderStyle::Dotted, Color::Auto),
                top: side(BorderStyle::Hair, Color::Auto),
                bottom: None,
            },
            alignment: Alignment {
                horizontal: Some(HAlign::Right),
                vertical: Some(VAlign::Top),
                wrap_text: Some(true),
                indent: Some(2),
            },
            number_format: Some("yyyy-mm-dd".into()),
            ..Default::default()
        },
        CellStyle {
            alignment: Alignment {
                horizontal: Some(HAlign::Center),
                vertical: Some(VAlign::Center),
                ..Default::default()
            },
            number_format: Some("#,##0.000 \"EUR\"".into()),
            ..Default::default()
        },
        CellStyle {
            fill: Some(Fill::Solid(Color::Auto)),
            number_format: Some("@".into()),
            ..Default::default()
        },
    ]
}

fn build() -> Workbook {
    let mut wb = Workbook::new();
    let main = wb.sheet_id("Sheet1").unwrap();
    wb.rename_sheet(main, "My Data").unwrap();
    let other = wb.add_sheet("Other").unwrap();
    let ids: Vec<_> = styles().iter().map(|s| wb.intern_style(s)).collect();
    let c = |s, r, col| CellCoord::new(s, r, col);

    for (i, input) in [
        "1",
        "2.5",
        "-3e-7",
        "1e15",
        "TRUE",
        "#N/A",
        "45731",
        "hello",
        "'0123",
        "'true",
        " padded ",
        "'=not a formula",
    ]
    .iter()
    .enumerate()
    {
        wb.set_input(c(main, i as u32, 0), input).unwrap();
    }
    wb.set_content(
        c(main, 12, 0),
        CellContent::Value(Value::Text("line\nbreak a\u{1}b _x0041_".into())),
    )
    .unwrap();
    for (i, f) in [
        "=SUM(A1:A3)",
        "=CONCAT(A8,\"-\",A2)",
        "=DAYS(A7,A1)",
        "=Other!A1*2",
        "=1/0",
        "=IF(A1>0,\"yes\",\"no\")",
        "=A1>1",
        "=A1+'My Data'!A2",
    ]
    .iter()
    .enumerate()
    {
        wb.set_input(c(main, i as u32, 1), f).unwrap();
    }
    for (i, id) in ids.iter().enumerate() {
        wb.set_style(c(main, i as u32, 2), *id).unwrap();
        wb.set_input(c(main, i as u32, 2), &format!("{}", i * 10))
            .unwrap();
    }
    // Style-only cells.
    wb.set_style(c(main, 20, 5), ids[2]).unwrap();
    wb.set_style(c(other, 3, 3), ids[0]).unwrap();

    wb.set_col_width(main, 0, Some(20.5)).unwrap();
    wb.set_col_hidden(main, 3, true).unwrap();
    for col in 6..=8 {
        wb.set_col_info(
            main,
            col,
            ColInfo {
                width: Some(4.0),
                hidden: false,
                style: Some(ids[1]),
            },
        )
        .unwrap();
    }
    wb.set_row_height(main, 1, Some(30.0)).unwrap();
    wb.set_row_hidden(main, 4, true).unwrap();
    wb.set_row_info(
        main,
        30,
        RowInfo {
            height: Some(22.25),
            hidden: false,
            style: Some(ids[3]),
        },
    )
    .unwrap();
    wb.set_sheet_format(
        other,
        SheetFormat {
            default_col_width: 10.5,
            default_row_height: 18.0,
        },
    )
    .unwrap();
    wb.set_input(c(other, 0, 0), "21").unwrap();
    wb.set_input(c(other, 0, 1), "=A1&\"!\"").unwrap();
    wb
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

#[test]
fn built_workbook_roundtrips() {
    let wb = build();
    let main = wb.sheet_id("My Data").unwrap();
    assert_eq!(
        wb.value(CellCoord::new(main, 1, 1)),
        Value::Text("hello-2.5".into())
    );
    assert_eq!(
        wb.value(CellCoord::new(main, 4, 1)),
        Value::Error(ErrorKind::Div0)
    );

    let bytes = fmt_xlsx::write(&wb).unwrap();
    assert_eq!(bytes, fmt_xlsx::write(&wb).unwrap(), "deterministic");
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    for row in 0..8 {
        let c = CellCoord::new(main, row, 1);
        assert_eq!(back.value(c), wb.value(c), "B{}", row + 1);
    }

    let sheet = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains("<f>_xlfn.CONCAT(A8,\"-\",A2)</f>"),
        "{sheet}"
    );
    assert!(sheet.contains("<f>_xlfn.DAYS(A7,A1)</f>"), "{sheet}");
    assert!(
        sheet.contains(r#"<c r="B5" t="e"><f>1/0</f><v>#DIV/0!</v></c>"#),
        "{sheet}"
    );
    assert!(
        sheet.contains(r#"<c r="B6" t="str"><f>IF(A1&gt;0,"yes","no")</f><v>yes</v></c>"#),
        "{sheet}"
    );
    assert!(
        sheet.contains(r#"<col min="7" max="9" width="4" style="2" customWidth="1"/>"#),
        "{sheet}"
    );
    assert!(
        sheet.contains(r#"<col min="4" max="4" width="8.43" hidden="1"/>"#),
        "{sheet}"
    );
    assert!(
        sheet.contains(r#"<row r="31" s="4" customFormat="1" ht="22.25" customHeight="1"/>"#),
        "{sheet}"
    );
    assert!(sheet.contains(r#"<c r="F21" s="3"/>"#), "{sheet}");
    let other = part(&bytes, "/xl/worksheets/sheet2.xml");
    assert!(other.contains(
        r#"<sheetFormatPr defaultColWidth="10.5" defaultRowHeight="18" customHeight="1"/>"#
    ));
    let workbook = part(&bytes, "/xl/workbook.xml");
    assert!(workbook.contains(r#"<sheet name="My Data" sheetId="1" r:id="rId1"/>"#));
    assert!(workbook.contains(r#"<calcPr fullCalcOnLoad="1"/>"#));
}

#[test]
fn sheet_order_and_tab_colours_roundtrip() {
    let mut wb = Workbook::new();
    let first = wb.sheet_id("Sheet1").unwrap();
    let b = wb.add_sheet("B").unwrap();
    let c = wb.add_sheet("C").unwrap();
    wb.set_input(CellCoord::new(first, 0, 0), "=C!A1+B!A1")
        .unwrap();
    wb.set_input(CellCoord::new(c, 0, 0), "2").unwrap();
    wb.set_tab_color(c, Some(Color::Rgb(Rgb::new(0x12, 0x34, 0x56))))
        .unwrap();
    let accent = Color::Theme {
        slot: ThemeColorSlot::Accent2,
        tint: 0.5,
    };
    wb.set_tab_color(first, Some(accent)).unwrap();
    wb.move_sheet(c, 0).unwrap();
    wb.remove_sheet(b).unwrap();

    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    let names: Vec<String> = back.sheets().into_iter().map(|(_, n)| n).collect();
    assert_eq!(names, ["C", "Sheet1"]);
    let sheet1 = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet1.contains(r#"<sheetPr><tabColor rgb="FF123456"/></sheetPr><dimension"#),
        "{sheet1}"
    );
    let sheet2 = part(&bytes, "/xl/worksheets/sheet2.xml");
    assert!(sheet2.contains(r#"<f>C!A1+#REF!</f>"#), "{sheet2}");
}

#[test]
fn date1904_is_rejected() {
    let bytes = fmt_xlsx::write(&Workbook::new()).unwrap();
    let mut pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let wb_part = PartName::new("/xl/workbook.xml").unwrap();
    let p = pkg.part_mut(&wb_part).unwrap();
    p.data = String::from_utf8(p.data.clone())
        .unwrap()
        .replace("<workbookPr/>", r#"<workbookPr date1904="1"/>"#)
        .into_bytes();
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    assert!(
        matches!(fmt_xlsx::read(&bytes), Err(fmt_xlsx::Error::Unsupported(s)) if s == "date1904")
    );
}

#[test]
fn shared_formulas_and_dropped_features() {
    // Excel-style sheet: shared formulas, an inline string, _xlfn, a merged range.
    let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2+$A$1</f><v>3</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row>
<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>5</v></c><c r="C2" t="str"><f>_xlfn.CONCAT("a",C1)</f><v>ainline</v></c></row>
<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>7</v></c><c r="C3"><f>FOO.BAR(</f><v>9</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="D1:E2"/></mergeCells><conditionalFormatting sqref="A1"/></worksheet>"#;
    let base = fmt_xlsx::write(&Workbook::new()).unwrap();
    let mut pkg = Package::open(Cursor::new(base.as_slice())).unwrap();
    pkg.part_mut(&PartName::new("/xl/worksheets/sheet1.xml").unwrap())
        .unwrap()
        .data = sheet.as_bytes().to_vec();
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();

    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    let s = wb.sheet_id("Sheet1").unwrap();
    let c = |r, col| CellCoord::new(s, r, col);
    assert_eq!(wb.formula_text(c(0, 1)), Some("=A1*2+$A$1"));
    assert_eq!(wb.formula_text(c(1, 1)), Some("=A2*2+$A$1"));
    assert_eq!(wb.formula_text(c(2, 1)), Some("=A3*2+$A$1"));
    assert_eq!(wb.value(c(2, 1)), Value::Number(7.0));
    assert_eq!(wb.value(c(0, 2)), Value::Text("inline".into()));
    assert_eq!(wb.formula_text(c(1, 2)), Some("=CONCAT(\"a\",C1)"));
    assert_eq!(wb.value(c(1, 2)), Value::Text("ainline".into()));
    // Unparseable formula: the cached value is kept.
    assert_eq!(wb.content(c(2, 2)), &CellContent::Value(Value::Number(9.0)));
    let all = warnings.join("\n");
    assert!(all.contains("merged cells dropped: D1:E2"), "{all}");
    assert!(all.contains("conditional formatting dropped"), "{all}");
    assert!(all.contains("C3: formula"), "{all}");
}
