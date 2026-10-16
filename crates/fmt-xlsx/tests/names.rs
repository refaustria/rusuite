//! `definedNames` (workbook/sheet scope, built-ins, comments, hidden) and
//! number formats, against the openpyxl reference workbook and built
//! workbooks.

use std::io::Cursor;

use engine_formula::{CellCoord, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::numfmt::format_cell;
use model_sheet::{BuiltinName, DefinedName, NameScope, Workbook};

fn load(name: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
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

fn defined_names_xml(xlsx: &[u8]) -> String {
    let wb = part(xlsx, "/xl/workbook.xml");
    let start = wb.find("<definedNames>").expect("definedNames");
    let end = wb.find("</definedNames>").unwrap() + "</definedNames>".len();
    wb[start..end].replace("><", ">\n<")
}

#[test]
fn reference_workbook_names_and_formats() {
    let bytes = load("provisional-names.xlsx");
    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let sales = wb.sheet_id("Sales").unwrap();
    let rates = wb.sheet_id("Rates").unwrap();
    let names: Vec<(String, NameScope)> =
        wb.names().into_iter().map(|n| (n.name, n.scope)).collect();
    assert_eq!(
        names,
        [
            ("Qty".to_string(), NameScope::Workbook),
            ("Price".into(), NameScope::Workbook),
            ("VAT".into(), NameScope::Workbook),
            ("Discount".into(), NameScope::Workbook),
            ("Local".into(), NameScope::Sheet(sales)),
            ("Print_Titles".into(), NameScope::Sheet(sales)),
            ("Print_Area".into(), NameScope::Sheet(sales)),
            ("Local".into(), NameScope::Sheet(rates)),
        ]
    );
    let vat = wb.name("vat", NameScope::Workbook).unwrap();
    assert_eq!(vat.comment.as_deref(), Some("Austrian VAT"));
    assert!(wb.name("Discount", NameScope::Workbook).unwrap().hidden);
    assert_eq!(wb.print_titles(sales), (Some((0, 0)), Some((0, 0))));
    let area = wb.print_area(sales);
    assert_eq!(
        (area[0].r0, area[0].c0, area[0].r1, area[0].c1),
        (0, 0, 4, 4)
    );
    assert_eq!(
        wb.builtin_name(sales, BuiltinName::PrintArea)
            .unwrap()
            .refers_to,
        "Sales!$A$1:$E$5"
    );
    // Names used in formulas (the file has no cached values).
    let v = |r, c| wb.value(CellCoord::new(sales, r, c));
    assert_eq!(v(1, 4), Value::Number(15.0 + 13.0 + 56.0 + 1.0));
    assert_eq!(v(2, 4), Value::Number(85.0 * 1.2));
    assert_eq!(v(3, 4), Value::Number(4.0));
    assert_eq!(v(4, 4), Value::Number(20.0));
    assert_eq!(v(5, 4), Value::Number(5.0));
    assert_eq!(
        wb.formula_text(CellCoord::new(sales, 1, 4)),
        Some("=SUMPRODUCT(Qty,Price)")
    );
    // Every number format family displays.
    let formats = wb.sheet_id("Formats").unwrap();
    let shown = |r: u32| {
        let c = CellCoord::new(formats, r, 1);
        format_cell(&wb.value(c), wb.style(c).number_format.as_deref()).text
    };
    let expected = [
        "1234.568",
        "1,234,567.89",
        "12.2M",
        "25.6%",
        "1.23E+04",
        "12.3E+3",
        "5 1/4",
        "3 14/99",
        "6/8",
        "-5.0",
        "big",
        "(1,234.00)",
        " $1,234.50 ",
        "7.00 €",
        "Montag, 15. Januar 2024",
        "2024-01-15 18:00:00",
        "6:00 PM",
        "26:05:08",
        "00:01.230",
        "123-45-6789",
        "Text: text",
        "",
        "3",
    ];
    for (r, want) in expected.iter().enumerate() {
        assert_eq!(shown(r as u32), *want, "row {}", r + 1);
    }
}

#[test]
fn reference_workbook_rewrites_byte_identically() {
    let first = fmt_xlsx::read_with_context(&load("provisional-names.xlsx")).unwrap();
    let written = fmt_xlsx::write_with_context(&first.workbook, &first.context).unwrap();
    let second = fmt_xlsx::read_with_context(&written).unwrap();
    assert_eq!(second.workbook.to_snapshot(), first.workbook.to_snapshot());
    assert!(second.warnings.is_empty(), "{:?}", second.warnings);
    let again = fmt_xlsx::write_with_context(&second.workbook, &second.context).unwrap();
    assert_eq!(written, again, "second generation differs");
    insta::assert_snapshot!("names_defined_names_xml", defined_names_xml(&written));
}

#[test]
fn built_names_roundtrip_with_filter_database() {
    let mut wb = Workbook::new();
    let s = wb.sheet_id("Sheet1").unwrap();
    let other = wb.add_sheet("It's").unwrap();
    for r in 0..3 {
        wb.set_input(CellCoord::new(s, r, 0), &(r + 1).to_string())
            .unwrap();
    }
    wb.define_name(&DefinedName::new(
        "Nums",
        NameScope::Workbook,
        "Sheet1!$A$1:$A$3",
    ))
    .unwrap();
    wb.define_name(&DefinedName {
        comment: Some("a & \"b\"".into()),
        ..DefinedName::new("Here", NameScope::Sheet(other), "'It''s'!$C$3")
    })
    .unwrap();
    wb.define_name(&DefinedName::new(
        "Twice",
        NameScope::Workbook,
        "=IFS(TRUE,2)",
    ))
    .unwrap();
    wb.set_print_area(other, Some((0, 0, 1, 1))).unwrap();
    wb.set_auto_filter(
        s,
        Some(model_sheet::AutoFilter {
            r0: 0,
            c0: 0,
            r1: 2,
            c1: 0,
            columns: Vec::new(),
        }),
    )
    .unwrap();
    wb.set_input(CellCoord::new(s, 0, 2), "=SUM(Nums)*Twice")
        .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let xml = defined_names_xml(&bytes);
    assert!(
        xml.contains(r#"<definedName name="Twice">_xlfn.IFS(TRUE,2)</definedName>"#),
        "{xml}"
    );
    assert!(
        xml.contains(r#"name="_xlnm._FilterDatabase" localSheetId="0" hidden="1""#),
        "{xml}"
    );
    assert!(xml.contains(r#"<definedName name="_xlnm.Print_Area" localSheetId="1">'It''s'!$A$1:$B$2</definedName>"#), "{xml}");
    assert!(
        xml.contains(r#"comment="a &amp; &quot;b&quot;" localSheetId="1""#),
        "{xml}"
    );
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert_eq!(back.value(CellCoord::new(s, 0, 2)), Value::Number(12.0));
}

#[test]
fn excel_artifacts_are_read() {
    // `Sheet!#REF!`, `_xlfn.` placeholder names, an unknown sheet index
    // and a name the grammar cannot read.
    let mut wb = Workbook::new();
    wb.set_input(CellCoord::new(engine_formula::SheetId(0), 0, 0), "1")
        .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let main = PartName::new("/xl/workbook.xml").unwrap();
    let xml = String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap();
    let names = r#"<definedNames><definedName name="_xlfn.IFS" hidden="1">#NAME?</definedName><definedName name="Gone">Sheet1!#REF!</definedName><definedName name="Lost" localSheetId="7">Sheet1!$A$1</definedName><definedName name="Ext">[1]Sheet1!$A$1</definedName></definedNames><calcPr"#;
    let patched = xml.replacen("<calcPr", names, 1);
    let mut pkg = pkg;
    pkg.insert_part(main, fmt_ooxml::ct::WORKBOOK, patched.into_bytes());
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    let names: Vec<String> = back
        .names()
        .into_iter()
        .map(|n| format!("{}={}", n.name, n.refers_to))
        .collect();
    assert_eq!(names, ["Gone=#REF!"]);
    assert_eq!(warnings.len(), 2, "{warnings:?}");
}
