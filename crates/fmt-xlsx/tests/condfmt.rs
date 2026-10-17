//! Conditional formatting and data validation ↔ `.xlsx`.

use std::io::Cursor;

use core_model::{Color, Rgb, ThemeColorSlot};
use engine_formula::{CellCoord, CellRect, RangeRef};
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    BorderSide, BorderStyle, Borders, CfKind, CfRule, CfValue, ColorPoint, CompareOp, DataBarAxis,
    DataBarDirection, DataValidation, DxfStyle, ErrorStyle, IconSetKind, ListSource, TimePeriod,
    ValidationKind, Workbook,
};

fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
    CellRect { r0, c0, r1, c1 }
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

fn red() -> Color {
    Color::Rgb(Rgb::new(0x9C, 0, 0x06))
}

fn build() -> Workbook {
    let mut wb = Workbook::new();
    let s = wb.sheet_id("Sheet1").unwrap();
    let other = wb.add_sheet("Lists").unwrap();
    for (r, v) in ["Red", "Green", "Blue"].iter().enumerate() {
        wb.set_input(CellCoord::new(other, r as u32, 0), v).unwrap();
    }
    for r in 0..10 {
        wb.set_input(CellCoord::new(s, r, 0), &(r * 7 % 10).to_string())
            .unwrap();
    }
    let hl = DxfStyle {
        font_color: Some(red()),
        bold: Some(true),
        italic: Some(false),
        underline: Some(true),
        strike: Some(true),
        fill: Some(Color::Rgb(Rgb::new(0xFF, 0xC7, 0xCE))),
        borders: Borders {
            bottom: Some(BorderSide {
                style: BorderStyle::Thin,
                color: Color::theme(ThemeColorSlot::Accent1),
            }),
            ..Default::default()
        },
        number_format: Some("0.0%".into()),
    };
    let plain = DxfStyle {
        fill: Some(Color::Theme {
            slot: ThemeColorSlot::Accent2,
            tint: 0.5,
        }),
        ..Default::default()
    };
    let r = vec![rect(0, 0, 9, 0), rect(0, 2, 4, 3)];
    let pct = |p: &str| CfValue::Percent(p.into());
    let kinds = vec![
        CfKind::CellIs {
            op: CompareOp::Between,
            formulas: vec!["2".into(), "$B$1+4".into()],
        },
        CfKind::CellIs {
            op: CompareOp::NotEqual,
            formulas: vec!["\"x\"".into()],
        },
        CfKind::Expression {
            formula: "AND(A1>3,MOD(ROW(),2)=0)".into(),
        },
        CfKind::ContainsText {
            text: "a\"b".into(),
        },
        CfKind::NotContainsText { text: "z".into() },
        CfKind::BeginsWith { text: "x".into() },
        CfKind::EndsWith { text: "y".into() },
        CfKind::ContainsBlanks,
        CfKind::NotContainsBlanks,
        CfKind::ContainsErrors,
        CfKind::NotContainsErrors,
        CfKind::Top10 {
            rank: 10,
            percent: true,
            bottom: true,
        },
        CfKind::AboveAverage {
            above: false,
            equal: true,
            std_dev: None,
        },
        CfKind::AboveAverage {
            above: true,
            equal: false,
            std_dev: Some(2),
        },
        CfKind::TimePeriod {
            period: TimePeriod::LastWeek,
        },
        CfKind::TimePeriod {
            period: TimePeriod::NextMonth,
        },
        CfKind::DuplicateValues,
        CfKind::UniqueValues,
        CfKind::data_bar(
            Color::Rgb(Rgb::new(0x63, 0x8E, 0xC6)),
            CfValue::Num("1".into()),
            CfValue::Formula("$B$2".into()),
            false,
        ),
        CfKind::DataBar {
            color: Color::Rgb(Rgb::new(0x63, 0xBE, 0x7B)),
            min: CfValue::AutoMin,
            max: CfValue::AutoMax,
            show_value: true,
            gradient: false,
            border: Some(Color::Rgb(Rgb::new(0x10, 0x20, 0x30))),
            negative_color: Some(Color::Rgb(Rgb::new(0, 0, 0xFF))),
            negative_border: Some(Color::Rgb(Rgb::new(0, 0x80, 0))),
            axis_color: Some(Color::Rgb(Rgb::new(0x80, 0x80, 0x80))),
            axis: DataBarAxis::Midpoint,
            direction: DataBarDirection::RightToLeft,
            min_length: 0,
            max_length: 100,
        },
        CfKind::ColorScale {
            points: vec![
                ColorPoint {
                    value: CfValue::Min,
                    color: Color::Rgb(Rgb::new(0xF8, 0x69, 0x6B)),
                },
                ColorPoint {
                    value: CfValue::Percentile("50".into()),
                    color: Color::Rgb(Rgb::new(0xFF, 0xEB, 0x84)),
                },
                ColorPoint {
                    value: CfValue::Max,
                    color: Color::theme(ThemeColorSlot::Accent6),
                },
            ],
        },
        CfKind::IconSet {
            set: IconSetKind::Rating4,
            thresholds: vec![pct("0"), pct("25"), pct("50"), pct("75")],
            reverse: true,
            show_value: false,
            greater: vec![false, true, false, true],
        },
    ];
    let rules: Vec<CfRule> = kinds
        .into_iter()
        .enumerate()
        .map(|(i, kind)| {
            let highlight = kind.is_highlight();
            CfRule {
                ranges: r.clone(),
                stop_if_true: i == 1,
                dxf: highlight.then(|| {
                    if i % 2 == 0 {
                        hl.clone()
                    } else {
                        plain.clone()
                    }
                }),
                ..CfRule::new(kind)
            }
        })
        .collect();
    wb.set_cf_rules(s, rules).unwrap();

    let mut list = DataValidation::new(
        vec![rect(0, 5, 9, 5)],
        ValidationKind::List {
            source: ListSource::Formula {
                formula: "Lists!$A$1:$A$3".into(),
            },
        },
    );
    list.input_title = Some("Colour".into());
    list.input_message = Some("Pick a colour".into());
    let mut literal = DataValidation::new(
        vec![rect(0, 6, 0, 6), rect(3, 6, 4, 7)],
        ValidationKind::List {
            source: ListSource::Literal {
                values: vec!["yes".into(), "no".into(), "say \"maybe\"".into()],
            },
        },
    );
    literal.show_dropdown = false;
    literal.allow_blank = false;
    let mut whole = DataValidation::new(
        vec![rect(10, 0, 20, 0)],
        ValidationKind::Whole {
            op: CompareOp::NotBetween,
            f1: "1".into(),
            f2: Some("$B$1".into()),
        },
    );
    whole.error_style = ErrorStyle::Warning;
    whole.error_title = Some("Careful".into());
    whole.error_message = Some("Outside".into());
    let mut decimal = DataValidation::new(
        vec![rect(10, 1, 10, 1)],
        ValidationKind::Decimal {
            op: CompareOp::GreaterThanOrEqual,
            f1: "0.5".into(),
            f2: None,
        },
    );
    decimal.error_style = ErrorStyle::Information;
    decimal.show_input = false;
    let mut any = DataValidation::new(vec![rect(11, 1, 11, 1)], ValidationKind::Any);
    any.input_message = Some("Anything".into());
    let mut no_alert = DataValidation::new(
        vec![rect(12, 1, 12, 1)],
        ValidationKind::Custom {
            formula: "ISNUMBER(B13)".into(),
        },
    );
    no_alert.show_error = false;
    let dvs = vec![
        list,
        literal,
        whole,
        decimal,
        any,
        no_alert,
        DataValidation::new(
            vec![rect(13, 1, 13, 1)],
            ValidationKind::Date {
                op: CompareOp::LessThan,
                f1: "DATE(2030,1,1)".into(),
                f2: None,
            },
        ),
        DataValidation::new(
            vec![rect(14, 1, 14, 1)],
            ValidationKind::Time {
                op: CompareOp::Equal,
                f1: "0.5".into(),
                f2: None,
            },
        ),
        DataValidation::new(
            vec![rect(15, 1, 15, 1)],
            ValidationKind::TextLength {
                op: CompareOp::LessThanOrEqual,
                f1: "5".into(),
                f2: None,
            },
        ),
    ];
    wb.set_validations(s, dvs).unwrap();
    wb
}

#[test]
fn rules_and_validations_roundtrip() {
    let wb = build();
    let s = wb.sheet_id("Sheet1").unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.cf_rules(s), wb.cf_rules(s));
    // Cross-sheet lists are written (and read) as x14, after the others.
    let sorted = |w: &Workbook| {
        let mut v = w.validations(s).to_vec();
        v.sort_by_key(|dv| (dv.ranges[0].r0, dv.ranges[0].c0));
        v
    };
    assert_eq!(sorted(&back), sorted(&wb));
    let xml = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(xml.contains("<x14:formula1><xm:f>Lists!"), "{xml}");
    assert!(xml.contains("<x14:dataBar"), "{xml}");
    // Evaluation agrees too.
    let all = RangeRef::new(s, 0, 0, 30, 10);
    assert_eq!(back.effective_cf(all), wb.effective_cf(all));
    assert_eq!(
        back.list_values(CellCoord::new(s, 2, 5)),
        ["Red", "Green", "Blue"]
    );

    let styles = part(&bytes, "/xl/styles.xml");
    assert!(
        styles.contains(concat!(
            r#"<dxfs count="2"><dxf><font><b/><i val="0"/><strike/><u/><color rgb="FF9C0006"/></font>"#,
            r#"<numFmt numFmtId="1000" formatCode="0.0%"/><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill>"#,
            r#"<border><bottom style="thin"><color theme="4"/></bottom></border></dxf>"#
        )),
        "{styles}"
    );
    let sheet = part(&bytes, "/xl/worksheets/sheet1.xml");
    for needle in [
        r#"<conditionalFormatting sqref="A1:A10 C1:D5"><cfRule type="cellIs" dxfId="0" priority="1" operator="between"><formula>2</formula><formula>$B$1+4</formula></cfRule></conditionalFormatting>"#,
        r#"<cfRule type="cellIs" dxfId="1" priority="2" stopIfTrue="1" operator="notEqual"><formula>"x"</formula></cfRule>"#,
        r#"<cfRule type="containsText" dxfId="1" priority="4" operator="containsText" text="a&quot;b"><formula>NOT(ISERROR(SEARCH("a""b",A1)))</formula></cfRule>"#,
        r#"<cfRule type="top10" dxfId="1" priority="12" percent="1" bottom="1" rank="10"/></conditionalFormatting>"#,
        r#"<dataBar showValue="0"><cfvo type="num" val="1"/><cfvo type="formula" val="$B$2"/><color rgb="FF638EC6"/></dataBar>"#,
        r#"<iconSet iconSet="4Rating" reverse="1" showValue="0"><cfvo type="percent" val="0"/>"#,
        r#"<dataValidations count="8"><dataValidation type="list" showDropDown="1""#,
        r#"<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" promptTitle="Colour" prompt="Pick a colour"><x14:formula1><xm:f>Lists!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>F1:F10</xm:sqref></x14:dataValidation>"#,
        r#"<dataValidation type="list" showDropDown="1" showInputMessage="1" showErrorMessage="1" sqref="G1 G4:H5"><formula1>"yes,no,say ""maybe"""</formula1></dataValidation>"#,
        r#"<dataValidation type="whole" errorStyle="warning" operator="notBetween" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Careful" error="Outside" sqref="A11:A21"><formula1>1</formula1><formula2>$B$1</formula2></dataValidation>"#,
        r#"<dataValidation allowBlank="1" showInputMessage="1" showErrorMessage="1" prompt="Anything" sqref="B12"/>"#,
        r#"</dataValidations><pageMargins"#,
    ] {
        assert!(sheet.contains(needle), "{needle}\n{sheet}");
    }
}

#[test]
fn excel_style_rules_are_read() {
    let styles_dxfs = concat!(
        r#"<dxfs count="2"><dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>"#,
        r#"<dxf><font><b/><color indexed="10"/></font><fill><patternFill patternType="solid"><fgColor theme="5"/></patternFill></fill></dxf></dxfs>"#
    );
    let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetData>
<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>12</v></c></row>
</sheetData>
<conditionalFormatting sqref="A1:A5"><cfRule type="cellIs" dxfId="1" priority="3" operator="greaterThan"><formula>10</formula></cfRule><cfRule type="timePeriod" dxfId="0" priority="4" timePeriod="today"><formula>FLOOR(A1,1)=TODAY()</formula></cfRule></conditionalFormatting>
<conditionalFormatting sqref="A1:A5"><cfRule type="dataBar" priority="2"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}"><x14:id>{1}</x14:id></ext></extLst></cfRule></conditionalFormatting>
<conditionalFormatting sqref="B1:B9"><cfRule type="expression" dxfId="0" priority="1" stopIfTrue="1"><formula>_xlfn.IFS(B1&gt;1,TRUE)</formula></cfRule><cfRule type="aboveAverage" dxfId="0" priority="5" stdDev="1"/><cfRule type="iconSet" priority="6"><iconSet><cfvo type="percent" val="0"/><cfvo type="percent" val="33" gte="0"/><cfvo type="percent" val="67"/></iconSet></cfRule><cfRule type="cellIs" dxfId="7" priority="7" operator="equal"><formula>1</formula></cfRule><cfRule type="expression" dxfId="0" priority="8"><formula>SUM(</formula></cfRule></conditionalFormatting>
<dataValidations count="2"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="C1:C4"><formula1>"a,b"</formula1></dataValidation><dataValidation type="whole" operator="equal" sqref="D1"><formula1>5</formula1></dataValidation></dataValidations>
<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{1}"><x14:dataBar minLength="0" maxLength="100"/></x14:cfRule><xm:sqref>A1:A5</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext>
<ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"><x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"><x14:formula1><xm:f>Sheet2!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>E1:E9</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst></worksheet>"#;
    let mut base = Workbook::new();
    base.add_sheet("Sheet2").unwrap();
    let base = fmt_xlsx::write(&base).unwrap();
    let mut pkg = Package::open(Cursor::new(base.as_slice())).unwrap();
    pkg.part_mut(&PartName::new("/xl/worksheets/sheet1.xml").unwrap())
        .unwrap()
        .data = sheet.as_bytes().to_vec();
    let st = PartName::new("/xl/styles.xml").unwrap();
    let p = pkg.part_mut(&st).unwrap();
    p.data = String::from_utf8(p.data.clone())
        .unwrap()
        .replace(r#"<dxfs count="0"/>"#, styles_dxfs)
        .into_bytes();
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();

    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    let s = wb.sheet_id("Sheet1").unwrap();
    let all = warnings.join("\n");
    for w in [
        "conditional formatting rule dropped (unknown dxfId)",
        "conditional formatting rule dropped (invalid rule: formula",
    ] {
        assert!(all.contains(w), "{w}\n{all}");
    }
    assert!(!all.contains("x14"), "{all}");
    let rules = wb.cf_rules(s);
    // Ordered by priority across <conditionalFormatting> elements.
    let types: Vec<&str> = rules
        .iter()
        .map(|r| match r.kind {
            CfKind::Expression { .. } => "expression",
            CfKind::DataBar { .. } => "dataBar",
            CfKind::CellIs { .. } => "cellIs",
            CfKind::AboveAverage { .. } => "aboveAverage",
            CfKind::IconSet { .. } => "iconSet",
            CfKind::TimePeriod { .. } => "timePeriod",
            _ => "other",
        })
        .collect();
    assert_eq!(
        types,
        [
            "expression",
            "dataBar",
            "cellIs",
            "timePeriod",
            "aboveAverage",
            "iconSet"
        ]
    );
    assert_eq!(
        rules[3].kind,
        CfKind::TimePeriod {
            period: TimePeriod::Today
        }
    );
    assert!(matches!(
        rules[4].kind,
        CfKind::AboveAverage {
            std_dev: Some(1),
            ..
        }
    ));
    // The x14 extension's lengths are merged into the data bar.
    assert!(matches!(
        rules[1].kind,
        CfKind::DataBar {
            min_length: 0,
            max_length: 100,
            ..
        }
    ));
    let CfKind::IconSet { greater, .. } = &rules[5].kind else {
        panic!("icon set")
    };
    assert_eq!(greater, &[false, true, false]);
    assert!(rules[0].stop_if_true);
    assert_eq!(
        rules[0].kind,
        CfKind::Expression {
            formula: "IFS(B1>1,TRUE)".into()
        }
    );
    let dxf = rules[2].dxf.as_ref().unwrap();
    assert_eq!(dxf.bold, Some(true));
    assert_eq!(dxf.font_color, Some(Color::Rgb(Rgb::new(0xFF, 0, 0))));
    assert_eq!(dxf.fill, Some(Color::theme(ThemeColorSlot::Accent2)));
    assert_eq!(
        rules[0].dxf.as_ref().unwrap().fill,
        Some(Color::Rgb(Rgb::new(0xFF, 0xC7, 0xCE)))
    );
    assert!(matches!(
        rules[5].kind,
        CfKind::IconSet {
            set: IconSetKind::TrafficLights3,
            ..
        }
    ));
    // A2 = 12 > 10: bold red; both cells get a data bar.
    let cf = wb.effective_cf(RangeRef::new(s, 0, 0, 4, 0));
    assert_eq!(cf.len(), 2);
    assert_eq!(cf[1].1.dxf.as_ref().unwrap().bold, Some(true));
    let bar = cf[1].1.bar.as_ref().unwrap();
    assert_eq!((bar.from, bar.to), (0.0, 1.0));

    let dvs = wb.validations(s);
    assert_eq!(dvs.len(), 3);
    assert_eq!(
        dvs[0].kind,
        ValidationKind::List {
            source: ListSource::Literal {
                values: vec!["a".into(), "b".into()]
            }
        }
    );
    // Absent flags are false (only Excel's dialog defaults them on).
    assert!(!dvs[1].allow_blank && !dvs[1].show_error && dvs[1].show_dropdown);
    assert_eq!(
        dvs[2].kind,
        ValidationKind::List {
            source: ListSource::Formula {
                formula: "Sheet2!$A$1:$A$3".into()
            }
        }
    );
    assert_eq!(dvs[2].ranges, vec![rect(0, 4, 8, 4)]);
    // Written back: the cross-sheet list as x14, the others standard.
    let out = fmt_xlsx::write(&wb).unwrap();
    let xml = part(&out, "/xl/worksheets/sheet1.xml");
    assert!(
        xml.contains(r#"<x14:formula1><xm:f>Sheet2!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>E1:E9</xm:sqref>"#),
        "{xml}"
    );
    assert!(xml.contains(r#"<dataValidations count="2">"#), "{xml}");
    assert!(
        xml.contains(r#"<x14:dataBar minLength="0" maxLength="100">"#),
        "{xml}"
    );
    assert!(xml.contains(r#"timePeriod="today""#), "{xml}");
    assert!(
        xml.contains(r#"<cfvo type="percent" val="33" gte="0"/>"#),
        "{xml}"
    );
    let back = fmt_xlsx::read(&out).unwrap();
    assert_eq!(back.cf_rules(s), wb.cf_rules(s));
    assert_eq!(back.validations(s), wb.validations(s));
}
