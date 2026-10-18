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

// --- slicers ----------------------------------------------------------------

fn content_type(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"))
        .content_type
        .clone()
}

/// `type → target` of the relationships of part `name`.
fn rels(xlsx: &[u8], name: &str) -> Vec<(String, String)> {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.relationships(&PartName::new(name).unwrap())
        .map(|r| {
            r.iter()
                .map(|r| (r.rel_type.clone(), r.target.clone()))
                .collect()
        })
        .unwrap_or_default()
}

fn slicer_anchor(row: u32) -> model_sheet::ChartAnchor {
    model_sheet::ChartAnchor::OneCell {
        from: model_sheet::CellOffset {
            col: 6,
            row,
            col_offset: 0,
            row_offset: 0,
        },
        width: 1_828_800,
        height: 2_524_125,
    }
}

/// Region | Product | Sales as Table1 (A1:C6) and a pivot table at K1.
fn slicer_book() -> (Workbook, u32) {
    use model_sheet::pivot::{DataField, PivotFields, PivotSource};
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let rows = [
        ["Region", "Product", "Sales"],
        ["East", "Apple", "10"],
        ["East", "Pear", "20"],
        ["West", "Apple", "30"],
        ["North", "Pear", "40"],
        ["West", "Pear", "50"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(engine_formula::CellCoord::new(s, r as u32, c as u32), v)
                .unwrap();
        }
    }
    let t = Table::new(
        1,
        "Table1",
        0,
        0,
        5,
        2,
        &["Region".into(), "Product".into(), "Sales".into()],
    );
    wb.set_tables(s, vec![t]).unwrap();
    let (p, _) = wb
        .create_pivot(
            PivotSource::range("Sheet1", 0, 0, 5, 2),
            s,
            0,
            10,
            PivotFields {
                rows: vec![1.into()],
                values: vec![DataField::sum(2)],
                ..Default::default()
            },
        )
        .unwrap();
    (wb, p)
}

#[test]
fn table_and_pivot_slicers_round_trip() {
    let (mut wb, p) = slicer_book();
    let s = SheetId(0);
    let cache = wb.pivot(p).unwrap().1.cache_id;
    wb.insert_slicer(
        s,
        model_sheet::SlicerSource::Table {
            table: 1,
            column: 1,
        },
        slicer_anchor(8),
    )
    .unwrap();
    wb.insert_slicer(
        s,
        model_sheet::SlicerSource::Pivot {
            cache,
            field: 0,
            pivots: vec![p],
        },
        slicer_anchor(20),
    )
    .unwrap();
    wb.set_slicer_selection("Slicer_Region", Some(&["West".into()]))
        .unwrap();
    wb.set_slicer_selection("Slicer_Region1", Some(&["East".into(), "North".into()]))
        .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    // For checking the file in Excel by hand (scripts/office-check-pack.sh).
    if let Some(dir) = std::env::var_os("RUSUITE_SLICER_OUT") {
        std::fs::write(
            std::path::PathBuf::from(dir).join("rusuite-slicers.xlsx"),
            &bytes,
        )
        .unwrap();
    }

    assert_eq!(
        content_type(&bytes, "/xl/slicerCaches/slicerCache1.xml"),
        "application/vnd.ms-excel.slicerCache+xml"
    );
    assert_eq!(
        content_type(&bytes, "/xl/slicers/slicer1.xml"),
        "application/vnd.ms-excel.slicer+xml"
    );
    let book = part(&bytes, "/xl/workbook.xml");
    assert!(
        book.contains(r#"<definedName name="Slicer_Region">#N/A</definedName>"#),
        "{book}"
    );
    assert!(book.contains(r#"<ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerCaches><x14:slicerCache r:id="#), "{book}");
    assert!(book.contains(r#"<ext uri="{46BE6895-7355-4a93-B00E-2C351335B9C9}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:slicerCaches xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerCache r:id="#), "{book}");
    let book_rels = rels(&bytes, "/xl/workbook.xml");
    assert!(
        book_rels.contains(&(
            "http://schemas.microsoft.com/office/2007/relationships/slicerCache".into(),
            "slicerCaches/slicerCache1.xml".into()
        )),
        "{book_rels:?}"
    );
    let table_cache = part(&bytes, "/xl/slicerCaches/slicerCache1.xml");
    assert!(table_cache.contains(r#"name="Slicer_Region" sourceName="Region"><extLst><x:ext uri="{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:tableSlicerCache tableId="1" column="1"/></x:ext></extLst>"#), "{table_cache}");
    let pivot_cache = part(&bytes, "/xl/slicerCaches/slicerCache2.xml");
    assert!(pivot_cache.contains(r#"<pivotTables><pivotTable tabId="1" name="PivotTable1"/></pivotTables><data><tabular pivotCacheId="#), "{pivot_cache}");
    assert!(
        pivot_cache
            .contains(r#"<items count="3"><i x="0" s="1"/><i x="2" s="1"/><i x="1"/></items>"#),
        "{pivot_cache}"
    );
    let def = part(&bytes, "/xl/pivotCache/pivotCacheDefinition1.xml");
    assert!(
        def.contains(r#"<x14:pivotCacheDefinition pivotCacheId="#),
        "{def}"
    );
    let sheet = part(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains(r#"<x14:slicerList><x14:slicer r:id="#),
        "{sheet}"
    );
    assert!(sheet.contains(r#"<x15:slicerList xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x14:slicer r:id="#), "{sheet}");
    let sheet_rels = rels(&bytes, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet_rels.contains(&(
            "http://schemas.microsoft.com/office/2007/relationships/slicer".into(),
            "../slicers/slicer1.xml".into()
        )),
        "{sheet_rels:?}"
    );
    let drawing = part(&bytes, "/xl/drawings/drawing1.xml");
    assert!(drawing.contains(r#"<mc:Choice xmlns:sle15="http://schemas.microsoft.com/office/drawing/2012/slicer" Requires="sle15">"#), "{drawing}");
    assert!(drawing.contains(r#"<sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="Region"/>"#), "{drawing}");
    assert!(drawing.contains(r#"<mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">"#), "{drawing}");
    let slicers = part(&bytes, "/xl/slicers/slicer2.xml");
    assert!(
        slicers.contains(
            r#"<slicer name="Region" cache="Slicer_Region" caption="Region" rowHeight="241300"/>"#
        ),
        "{slicers}"
    );

    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.slicer_caches(), wb.slicer_caches());
    assert_eq!(back.slicers(s), wb.slicers(s));
    // The defined names stay the user's.
    assert!(back.engine().names().is_empty());
    // The filters are still applied.
    assert_eq!(
        back.slicer_items("Slicer_Region")
            .iter()
            .filter(|i| i.selected)
            .count(),
        1
    );
    let pt = &back.pivot(1).unwrap().1;
    assert_eq!(pt.field_filters, wb.pivot(p).unwrap().1.field_filters);
    // Written again: the same parts.
    let again = fmt_xlsx::write(&back).unwrap();
    assert_eq!(
        part(&again, "/xl/slicerCaches/slicerCache2.xml"),
        pivot_cache
    );
    assert_eq!(part(&again, "/xl/drawings/drawing1.xml"), drawing);
}

#[test]
fn slicers_without_a_position_or_source_are_dropped_with_warnings() {
    let (mut wb, _) = slicer_book();
    let s = SheetId(0);
    wb.insert_slicer(
        s,
        model_sheet::SlicerSource::Table {
            table: 1,
            column: 2,
        },
        slicer_anchor(8),
    )
    .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    // A cache naming a missing table.
    let xml = part(&bytes, "/xl/slicerCaches/slicerCache1.xml")
        .replace(r#"tableId="1""#, r#"tableId="9""#);
    let mut pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let name = PartName::new("/xl/slicerCaches/slicerCache1.xml").unwrap();
    pkg.insert_part(
        name,
        "application/vnd.ms-excel.slicerCache+xml",
        xml.into_bytes(),
    );
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(back.slicer_caches().is_empty());
    assert!(back.slicers(s).is_empty());
    assert!(!warnings.is_empty(), "{warnings:?}");
}
