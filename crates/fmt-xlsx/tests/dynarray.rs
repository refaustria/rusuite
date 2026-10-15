//! Dynamic array formulas: `t="array"` + `cm` + `xl/metadata.xml` on
//! write, spilling `t="array"` formulas (dynamic and legacy CSE) and
//! implicit intersection in plain formulas on read.

use std::io::Cursor;

use engine_formula::{CellContent, CellCoord, ErrorKind, SheetId, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::Workbook;

fn part(xlsx: &[u8], name: &str) -> Option<String> {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.part(&PartName::new(name).unwrap())
        .map(|p| String::from_utf8(p.data.clone()).unwrap())
}

fn c(r: u32, col: u32) -> CellCoord {
    CellCoord::new(SheetId(0), r, col)
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

#[test]
fn spilling_formulas_roundtrip() {
    let mut wb = Workbook::new();
    wb.set_input(c(0, 0), "=SEQUENCE(3)").unwrap();
    wb.set_input(c(0, 1), "=SUM(A1#)").unwrap();
    wb.set_input(c(0, 2), "=SORT({3,1,2},1,-1,TRUE)").unwrap();
    wb.set_input(c(4, 0), "=FILTER(A1:A3,A1:A3>1)").unwrap();
    wb.set_input(c(4, 1), "=@A1:A3+1").unwrap();
    // Blocked: written as an array formula of its own cell.
    wb.set_input(c(8, 0), "=SEQUENCE(2)").unwrap();
    wb.set_input(c(9, 0), "x").unwrap();
    // A single value that legacy Excel would read differently.
    wb.set_input(c(8, 3), "=SEQUENCE(1)").unwrap();
    assert_eq!(wb.value(c(8, 0)), Value::Error(ErrorKind::Spill));

    let bytes = fmt_xlsx::write(&wb).unwrap();
    let sheet = part(&bytes, "/xl/worksheets/sheet1.xml").unwrap();
    for want in [
        r#"<c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f><v>1</v></c>"#,
        r#"<c r="A2"><v>2</v></c>"#,
        r#"<c r="B1"><f>SUM(_xlfn.ANCHORARRAY(A1))</f><v>6</v></c>"#,
        r#"<f t="array" ref="C1:E1">_xlfn._xlws.SORT({3,1,2},1,-1,TRUE)</f>"#,
        r#"<f t="array" ref="A5:A6">_xlfn._xlws.FILTER(A1:A3,A1:A3&gt;1)</f>"#,
        // Row 5 is outside A1:A3: the intersection fails.
        r#"<c r="B5" t="e"><f>_xlfn.SINGLE(A1:A3)+1</f><v>#VALUE!</v></c>"#,
        r#"<c r="A9" t="e" cm="1"><f t="array" ref="A9">_xlfn.SEQUENCE(2)</f><v>#SPILL!</v></c>"#,
        r#"<c r="D9" cm="1"><f t="array" ref="D9">_xlfn.SEQUENCE(1)</f><v>1</v></c>"#,
    ] {
        assert!(sheet.contains(want), "{want} not in {sheet}");
    }
    let meta = part(&bytes, "/xl/metadata.xml").expect("metadata part");
    assert!(meta.contains("XLDAPR") && meta.contains("fDynamic=\"1\""));
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let main = PartName::new("/xl/workbook.xml").unwrap();
    let rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata";
    let meta_part = pkg.related_part(&main, rel).expect("relationship");
    assert!(pkg
        .part(&meta_part)
        .unwrap()
        .content_type
        .ends_with("sheetMetadata+xml"));

    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    for r in 0..10 {
        for col in 0..5 {
            assert_eq!(back.value(c(r, col)), wb.value(c(r, col)), "({r},{col})");
            assert_eq!(
                back.content(c(r, col)),
                wb.content(c(r, col)),
                "({r},{col})"
            );
        }
    }
    assert_eq!(back.formula_text(c(4, 1)), Some("=@A1:A3+1"));
    assert_eq!(
        back.content(c(2, 0)),
        &CellContent::Spilled { anchor: c(0, 0) }
    );

    // Without dynamic arrays there is no metadata part.
    let mut plain = Workbook::new();
    plain.set_input(c(0, 0), "=SUM(1,2)").unwrap();
    let bytes = fmt_xlsx::write(&plain).unwrap();
    assert!(part(&bytes, "/xl/metadata.xml").is_none());
}

#[test]
fn legacy_and_excel_files_are_read() {
    // Excel 365 output (dynamic array with cached spill values), a legacy
    // CSE array over C1:C2, and plain formulas that legacy Excel
    // intersected implicitly.
    let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1"><v>1</v></c><c r="B1" cm="1"><f t="array" ref="B1:B3">_xlfn._xlws.SORT(A1:A3,1,-1)</f><v>3</v></c><c r="C1"><f t="array" ref="C1:C2">A1:A2*10</f><v>10</v></c><c r="D1"><f>A1:A3</f><v>1</v></c></row>
<row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>2</v></c><c r="C2"><v>20</v></c><c r="D2"><f>A1:A3*2+SUM(A1:A3)</f><v>10</v></c><c r="E2"><f>_xlfn.SINGLE(A1:A3)</f><v>2</v></c></row>
<row r="3"><c r="A3"><v>3</v></c><c r="B3"><v>1</v></c><c r="D3"><f>SUM(_xlfn.ANCHORARRAY(B1))</f><v>6</v></c></row>
</sheetData></worksheet>"#;
    let base = fmt_xlsx::write(&Workbook::new()).unwrap();
    let mut pkg = Package::open(Cursor::new(base.as_slice())).unwrap();
    pkg.part_mut(&PartName::new("/xl/worksheets/sheet1.xml").unwrap())
        .unwrap()
        .data = sheet.as_bytes().to_vec();
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();

    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(wb.formula_text(c(0, 1)), Some("=SORT(A1:A3,1,-1)"));
    assert_eq!(
        (wb.value(c(0, 1)), wb.value(c(1, 1)), wb.value(c(2, 1))),
        (n(3.0), n(2.0), n(1.0))
    );
    assert_eq!(
        wb.content(c(1, 1)),
        &CellContent::Spilled { anchor: c(0, 1) }
    );
    assert_eq!((wb.value(c(0, 2)), wb.value(c(1, 2))), (n(10.0), n(20.0)));
    assert_eq!(wb.formula_text(c(0, 3)), Some("=@A1:A3"));
    assert_eq!(wb.value(c(0, 3)), n(1.0));
    assert_eq!(wb.formula_text(c(1, 3)), Some("=@A1:A3*2+SUM(A1:A3)"));
    assert_eq!(wb.value(c(1, 3)), n(10.0));
    assert_eq!(wb.formula_text(c(1, 4)), Some("=@A1:A3"));
    assert_eq!(wb.formula_text(c(2, 3)), Some("=SUM(B1#)"));
    assert_eq!(wb.value(c(2, 3)), n(6.0));
}
