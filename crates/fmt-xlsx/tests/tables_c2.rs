//! P9-C2: custom table styles (`dxfs` + `tableStyles` in `styles.xml`)
//! written and read back.

use std::io::Cursor;

use core_model::{Color, Rgb};
use engine_formula::SheetId;
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    BorderSide, BorderStyle, Borders, CfKind, CfRule, CustomTableStyle, DxfStyle, Table,
    TableStyleElement, TableStyleElementType as E, TableStyles, Workbook,
};

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let p = pkg
        .part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"));
    String::from_utf8_lossy(&p.data).into_owned()
}

fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color::Rgb(Rgb::new(r, g, b))
}

fn custom() -> CustomTableStyle {
    CustomTableStyle {
        name: "Firma Blau".into(),
        elements: vec![
            TableStyleElement {
                kind: E::WholeTable,
                size: 1,
                dxf: DxfStyle {
                    borders: Borders {
                        top: Some(BorderSide {
                            style: BorderStyle::Thin,
                            color: rgb(0, 0, 128),
                        }),
                        bottom: Some(BorderSide {
                            style: BorderStyle::Thin,
                            color: rgb(0, 0, 128),
                        }),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            },
            TableStyleElement {
                kind: E::HeaderRow,
                size: 1,
                dxf: DxfStyle {
                    bold: Some(true),
                    font_color: Some(rgb(255, 255, 255)),
                    fill: Some(rgb(0, 0, 128)),
                    ..Default::default()
                },
            },
            TableStyleElement {
                kind: E::FirstRowStripe,
                size: 2,
                dxf: DxfStyle {
                    fill: Some(rgb(221, 235, 247)),
                    ..Default::default()
                },
            },
            TableStyleElement {
                kind: E::TotalRow,
                size: 1,
                dxf: DxfStyle {
                    italic: Some(true),
                    ..Default::default()
                },
            },
        ],
    }
}

fn book() -> Workbook {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    for (r, row) in [["A", "B"], ["1", "2"], ["3", "4"]].iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(engine_formula::CellCoord::new(s, r as u32, c as u32), v)
                .unwrap();
        }
    }
    wb.set_table_styles(TableStyles {
        custom: vec![custom()],
        default_style: Some("Firma Blau".into()),
    })
    .unwrap();
    let mut t = Table::new(1, "Table1", 0, 0, 2, 1, &["A".into(), "B".into()]);
    t.style = "Firma Blau".into();
    wb.set_tables(s, vec![t]).unwrap();
    wb
}

#[test]
fn custom_table_style_round_trips() {
    let wb = book();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let styles = part(&bytes, "/xl/styles.xml");
    assert!(
        styles.contains(r#"<tableStyles count="1" defaultTableStyle="Firma Blau" defaultPivotStyle="PivotStyleLight16"><tableStyle name="Firma Blau" pivot="0" count="4">"#),
        "{styles}"
    );
    assert!(
        styles.contains(r#"<tableStyleElement type="firstRowStripe" size="2" dxfId="2"/>"#),
        "{styles}"
    );
    assert!(styles.contains(r#"<dxfs count="4">"#), "{styles}");
    let table = part(&bytes, "/xl/tables/table1.xml");
    assert!(
        table.contains(r#"<tableStyleInfo name="Firma Blau""#),
        "{table}"
    );
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.table_styles(), wb.table_styles());
    assert_eq!(back.tables(SheetId(0))[0].style, "Firma Blau");
    // Written again: byte-identical styles part.
    let again = fmt_xlsx::write(&back).unwrap();
    assert_eq!(part(&again, "/xl/styles.xml"), styles);
}

#[test]
fn table_style_dxfs_share_conditional_formats() {
    let mut wb = book();
    let s = SheetId(0);
    // A rule with the same format as the header element.
    let mut rule = CfRule::new(CfKind::Expression {
        formula: "TRUE".into(),
    });
    rule.ranges = vec![engine_formula::CellRect {
        r0: 5,
        c0: 0,
        r1: 6,
        c1: 0,
    }];
    rule.dxf = Some(custom().elements[1].dxf.clone());
    wb.add_cf_rule(s, rule).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let styles = part(&bytes, "/xl/styles.xml");
    assert!(styles.contains(r#"<dxfs count="4">"#), "{styles}");
    assert!(
        styles.contains(r#"<tableStyleElement type="headerRow" dxfId="0"/>"#),
        "{styles}"
    );
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.table_styles(), wb.table_styles());
    assert_eq!(back.cf_rules(s)[0].dxf, rule_dxf());
}

fn rule_dxf() -> Option<DxfStyle> {
    Some(custom().elements[1].dxf.clone())
}

#[test]
fn pivot_and_unknown_styles_are_dropped_with_warnings() {
    let wb = book();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let styles = part(&bytes, "/xl/styles.xml").replace(
        "</tableStyles>",
        r#"<tableStyle name="PivotMine" table="0" count="0"/><tableStyle name="TableStyleLight1" count="0"/></tableStyles>"#,
    );
    let mut pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let name = PartName::new("/xl/styles.xml").unwrap();
    let ct = pkg.part(&name).unwrap().content_type.clone();
    pkg.insert_part(name, &ct, styles.into_bytes());
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert_eq!(back.table_styles().custom.len(), 1);
    assert_eq!(warnings.len(), 2, "{warnings:?}");
}
