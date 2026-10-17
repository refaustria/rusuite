//! A workbook built in code survives write → read unchanged.

use std::io::Cursor;

use core_model::{
    Color, FontFace, FontSize, Rgb, RunProperties, ThemeColorSlot, Underline, VerticalAlign,
};
use engine_formula::{CellCoord, ErrorKind, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::CellRange;
use model_sheet::{
    Alignment, BorderSide, BorderStyle, Borders, CellContent, CellStyle, ColInfo, Fill, HAlign,
    MergeRect, RowInfo, SheetFormat, SheetView, VAlign, Workbook,
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
                // P8-44: diagonals (one line style in SpreadsheetML).
                diagonal_up: side(BorderStyle::Thin, red),
                diagonal_down: side(BorderStyle::Thin, red),
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
                diagonal_up: None,
                diagonal_down: side(BorderStyle::Dashed, Color::Auto),
            },
            alignment: Alignment {
                horizontal: Some(HAlign::Right),
                vertical: Some(VAlign::Top),
                wrap_text: Some(true),
                indent: Some(2),
                shrink_to_fit: None,
                text_rotation: Some(-45),
            },
            number_format: Some("yyyy-mm-dd".into()),
            protection: model_sheet::Protection {
                locked: Some(false),
                hidden: Some(true),
            },
            ..Default::default()
        },
        CellStyle {
            alignment: Alignment {
                horizontal: Some(HAlign::Center),
                vertical: Some(VAlign::Center),
                shrink_to_fit: Some(true),
                text_rotation: Some(30),
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
                ..Default::default()
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
            filtered: false,
            ..Default::default()
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
    // Excel-style sheet: shared formulas, an inline string, _xlfn, merged
    // ranges (one inverted, two invalid), a split (not frozen) pane.
    let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView zoomScale="85" workbookViewId="0"><pane xSplit="2000" ySplit="1000"/></sheetView><sheetView workbookViewId="1" zoomScale="200"/></sheetViews><sheetData>
<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2+$A$1</f><v>3</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row>
<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>5</v></c><c r="C2" t="str"><f>_xlfn.CONCAT("a",C1)</f><v>ainline</v></c></row>
<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>7</v></c><c r="C3"><f>FOO.BAR(</f><v>9</v></c></row>
</sheetData><mergeCells count="3"><mergeCell ref="E2:D1"/><mergeCell ref="F1"/><mergeCell ref="E2:F3"/></mergeCells><conditionalFormatting sqref="A1"/><hyperlinks><hyperlink ref="A1" r:id="rId1"/></hyperlinks></worksheet>"#;
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
    assert_eq!(wb.merges(s), &[MergeRect::new(0, 3, 1, 4)]);
    assert!(
        all.contains("invalid merged cells dropped: F1, E2:F3"),
        "{all}"
    );
    assert!(all.contains("split panes dropped"), "{all}");
    // Only the first sheet view counts.
    assert_eq!(wb.sheet_view(s).zoom, 85);
    assert_eq!(wb.sheet_view(s).frozen_rows, 0);
    assert!(
        all.contains("hyperlink on A1 without target dropped"),
        "{all}"
    );
    assert!(wb.cf_rules(s).is_empty());
    assert!(all.contains("C3: formula"), "{all}");
}

#[test]
fn frozen_panes_merges_and_hidden_sheets_roundtrip() {
    let mut wb = Workbook::new();
    let first = wb.sheet_id("Sheet1").unwrap();
    let data = wb.add_sheet("Data").unwrap();
    let secret = wb.add_sheet("Secret").unwrap();
    let rows_only = wb.add_sheet("Rows").unwrap();
    wb.set_input(CellCoord::new(data, 0, 0), "Title").unwrap();
    wb.set_input(CellCoord::new(data, 1, 2), "=Secret!A1")
        .unwrap();
    wb.set_input(CellCoord::new(secret, 0, 0), "42").unwrap();
    wb.set_sheet_view(
        data,
        SheetView {
            frozen_rows: 1,
            frozen_cols: 2,
            zoom: 125,
            show_gridlines: false,
            show_headings: false,
        },
    )
    .unwrap();
    wb.set_frozen(rows_only, 3, 0).unwrap();
    wb.add_merge(data, MergeRect::new(0, 0, 0, 3)).unwrap();
    wb.add_merge(data, MergeRect::new(4, 1, 6, 2)).unwrap();
    wb.set_sheet_hidden(first, true).unwrap();
    wb.set_sheet_visibility(secret, true, true).unwrap();

    let bytes = fmt_xlsx::write(&wb).unwrap();
    assert_eq!(bytes, fmt_xlsx::write(&wb).unwrap(), "deterministic");
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert!(back.is_sheet_hidden(first) && !back.is_sheet_very_hidden(first));
    assert!(back.is_sheet_very_hidden(secret));
    assert_eq!(back.value(CellCoord::new(data, 1, 2)), Value::Number(42.0));

    let book = part(&bytes, "/xl/workbook.xml");
    assert!(book.contains(r#"<workbookView activeTab="1"/>"#), "{book}");
    assert!(
        book.contains(r#"<sheet name="Sheet1" sheetId="1" state="hidden" r:id="rId1"/>"#),
        "{book}"
    );
    assert!(
        book.contains(r#"<sheet name="Secret" sheetId="3" state="veryHidden" r:id="rId3"/>"#),
        "{book}"
    );
    let sheet1 = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet1.contains(r#"<sheetViews><sheetView workbookViewId="0"/></sheetViews>"#),
        "{sheet1}"
    );
    let sheet2 = part(&bytes, "/xl/worksheets/sheet2.xml");
    assert!(
        sheet2.contains(concat!(
            r#"<sheetView showGridLines="0" showRowColHeaders="0" tabSelected="1" zoomScale="125" workbookViewId="0">"#,
            r#"<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>"#,
            r#"<selection pane="bottomRight"/></sheetView>"#
        )),
        "{sheet2}"
    );
    assert!(
        sheet2.contains(concat!(
            r#"</sheetData><mergeCells count="2"><mergeCell ref="A1:D1"/>"#,
            r#"<mergeCell ref="B5:C7"/></mergeCells><pageMargins"#
        )),
        "{sheet2}"
    );
    let sheet4 = part(&bytes, "/xl/worksheets/sheet4.xml");
    assert!(
        sheet4.contains(
            r#"<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>"#
        ),
        "{sheet4}"
    );
}

#[test]
fn auto_filter_sort_state_and_filtered_rows_roundtrip() {
    use model_sheet::{
        AutoFilter, Criterion, DynamicFilter, Filter, FilterColumn, FilterOp, SortKey, SortKind,
        SortSpec,
    };
    let mut wb = Workbook::new();
    let s = wb.sheet_id("Sheet1").unwrap();
    wb.rename_sheet(s, "Bob's data").unwrap();
    let other = wb.add_sheet("Plain").unwrap();
    let c = |r, col| CellCoord::new(s, r, col);
    let rows = [
        ["Name", "Qty", "Note", "When", "Rank"],
        ["pear", "3", "a*b", "45306", "1"],
        ["apple", "10", "x", "45307", "2"],
        ["fig", "7", "", "45308", "3"],
        ["Apple", "1", "y", "45309", "4"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (col, v) in row.iter().enumerate() {
            wb.set_input(c(r as u32, col as u32), v).unwrap();
        }
    }
    wb.set_input(c(6, 1), "=SUBTOTAL(9,B2:B5)").unwrap();
    let crit = |op, v: &str| Criterion {
        op,
        value: v.into(),
    };
    let mut af = AutoFilter::new(0, 0, 4, 4);
    af.columns = vec![
        FilterColumn {
            col: 0,
            filter: Filter::Values {
                values: vec!["apple".into(), "pear".into(), "fig".into(), String::new()],
            },
        },
        FilterColumn {
            col: 1,
            filter: Filter::Custom {
                criteria: vec![crit(FilterOp::Ge, "2"), crit(FilterOp::Lt, "50")],
                and: true,
            },
        },
        FilterColumn {
            col: 2,
            filter: Filter::Custom {
                criteria: vec![
                    crit(FilterOp::NotContains, "*"),
                    crit(FilterOp::EndsWith, "b"),
                ],
                and: false,
            },
        },
        FilterColumn {
            col: 3,
            filter: Filter::Dynamic {
                filter: DynamicFilter::BelowAverage,
            },
        },
        FilterColumn {
            col: 4,
            filter: Filter::Top10 {
                top: false,
                percent: true,
                value: 75.0,
            },
        },
    ];
    wb.set_auto_filter(s, Some(af)).unwrap();
    wb.apply_auto_filter(s).unwrap();
    wb.set_row_hidden(other, 2, true).unwrap();
    wb.sort_range(
        CellRange::new(s, 0, 0, 4, 4),
        &SortSpec {
            keys: vec![
                SortKey {
                    col: 1,
                    ascending: false,
                    kind: SortKind::Auto,
                    ..Default::default()
                },
                SortKey {
                    col: 0,
                    ascending: true,
                    kind: SortKind::Auto,
                    ..Default::default()
                },
            ],
            has_header: true,
            case_sensitive: true,
            ..Default::default()
        },
    )
    .unwrap();
    // pear and apple pass every column; fig fails the average, Apple the
    // quantity. The sort only swaps the two visible rows.
    let hidden: Vec<u32> = wb
        .rows(s)
        .filter(|(_, i)| i.filtered)
        .map(|(r, _)| r)
        .collect();
    assert_eq!(hidden, vec![3, 4]);
    assert_eq!(wb.value(c(1, 0)), Value::Text("apple".into()));
    assert_eq!(wb.value(c(6, 1)), Value::Number(13.0));

    let bytes = fmt_xlsx::write(&wb).unwrap();
    assert_eq!(bytes, fmt_xlsx::write(&wb).unwrap(), "deterministic");
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert_eq!(back.value(c(6, 1)), Value::Number(13.0));
    // A hand-hidden row outside any filter stays hand-hidden.
    assert!(!back.row_info(other, 2).filtered);

    let sheet = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(sheet.contains(r#"<sheetPr filterMode="1"/>"#), "{sheet}");
    assert!(sheet.contains(r#"<row r="4" hidden="1">"#), "{sheet}");
    assert!(
        sheet.contains(concat!(
            r#"</sheetData><autoFilter ref="A1:E5">"#,
            r#"<filterColumn colId="0"><filters blank="1"><filter val="apple"/><filter val="pear"/><filter val="fig"/></filters></filterColumn>"#,
            r#"<filterColumn colId="1"><customFilters and="1"><customFilter operator="greaterThanOrEqual" val="2"/><customFilter operator="lessThan" val="50"/></customFilters></filterColumn>"#,
            r#"<filterColumn colId="2"><customFilters><customFilter operator="notEqual" val="*~**"/><customFilter val="*b"/></customFilters></filterColumn>"#,
            r#"<filterColumn colId="3"><dynamicFilter type="belowAverage"/></filterColumn>"#,
            r#"<filterColumn colId="4"><top10 top="0" percent="1" val="75"/></filterColumn></autoFilter>"#,
            r#"<sortState ref="A2:E5" caseSensitive="1"><sortCondition descending="1" ref="B2:B5"/><sortCondition ref="A2:A5"/></sortState>"#,
            r#"<pageMargins"#
        )),
        "{sheet}"
    );
    let book = part(&bytes, "/xl/workbook.xml");
    assert!(
        book.contains(concat!(
            r#"</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">"#,
            r#"'Bob''s data'!$A$1:$E$5</definedName></definedNames><calcPr"#
        )),
        "{book}"
    );
}

#[test]
fn excel_style_auto_filter_is_read() {
    // As Excel writes it: sortState inside autoFilter, unsupported filter
    // kinds, the _FilterDatabase name and hidden rows of the filter.
    let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr filterMode="1"/><sheetData>
<row r="1"><c r="B1" t="inlineStr"><is><t>H</t></is></c></row>
<row r="2" hidden="1"><c r="B2"><v>1</v></c></row>
<row r="3"><c r="B3"><v>2</v></c></row>
<row r="9" hidden="1"><c r="B9"><v>3</v></c></row>
</sheetData><autoFilter ref="B1:E4"><filterColumn colId="0"><customFilters><customFilter operator="greaterThan" val="1"/></customFilters></filterColumn>
<filterColumn colId="1"><filters><dateGroupItem year="2024" dateTimeGrouping="year"/></filters></filterColumn>
<filterColumn colId="2"><colorFilter dxfId="0"/></filterColumn>
<filterColumn colId="3" hiddenButton="1"/>
<filterColumn colId="7"><filters><filter val="x"/></filters></filterColumn>
<sortState ref="B2:E4"><sortCondition descending="1" ref="B2:B4"/><sortCondition sortBy="cellColor" ref="C2:C4" dxfId="1"/></sortState></autoFilter></worksheet>"#;
    let base = fmt_xlsx::write(&Workbook::new()).unwrap();
    let mut pkg = Package::open(Cursor::new(base.as_slice())).unwrap();
    pkg.part_mut(&PartName::new("/xl/worksheets/sheet1.xml").unwrap())
        .unwrap()
        .data = sheet.as_bytes().to_vec();
    let book = PartName::new("/xl/workbook.xml").unwrap();
    let p = pkg.part_mut(&book).unwrap();
    p.data = String::from_utf8(p.data.clone())
        .unwrap()
        .replace(
            "</sheets>",
            r#"</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Sheet1!$B$1:$E$4</definedName></definedNames>"#,
        )
        .into_bytes();
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();

    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    let s = wb.sheet_id("Sheet1").unwrap();
    let af = wb.auto_filter(s).unwrap();
    assert_eq!((af.r0, af.c0, af.r1, af.c1), (0, 1, 3, 4));
    assert_eq!(af.columns.len(), 2);
    assert_eq!(af.columns[0].col, 1);
    // Date groups are read (P9-C5); the colour filter's dxf is missing.
    assert!(matches!(
        af.columns[1].filter,
        model_sheet::Filter::DateGroups { .. }
    ));
    // Hidden rows inside the filter range are the filter's.
    assert!(wb.row_info(s, 1).filtered);
    assert!(wb.row_info(s, 8).hidden && !wb.row_info(s, 8).filtered);
    let st = wb.sort_state(s).unwrap();
    assert_eq!((st.r0, st.r1, st.keys.len()), (1, 3, 1));
    assert!(!st.keys[0].ascending && st.keys[0].col == 1);
    let all = warnings.join("\n");
    assert!(!all.contains("defined name"), "{all}");
    assert!(
        all.contains("unsupported filter of column D dropped"),
        "{all}"
    );
    assert!(all.contains("unsupported sort condition dropped"), "{all}");
    assert!(
        all.contains("filter columns outside the AutoFilter range dropped"),
        "{all}"
    );
}
