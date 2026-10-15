//! Reads the reference files under `testdata/xlsx/` and round-trips them.

use std::io::Cursor;
use std::path::PathBuf;

use core_model::{Color, Rgb};
use engine_formula::{CellCoord, ErrorKind, Value};
use fmt_ooxml::xml::attr_local;
use fmt_ooxml::{Package, PartName};
use model_sheet::{CellContent, Fill, Workbook};
use quick_xml::events::Event;
use quick_xml::Reader;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/xlsx")
}

fn load(name: &str) -> Vec<u8> {
    std::fs::read(dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn files() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "xlsx"))
        .collect();
    v.sort();
    assert!(!v.is_empty());
    v
}

fn at(wb: &Workbook, sheet: &str, a1: &str) -> CellCoord {
    let (row, col) = fmt_xlsx::a1::parse_cell(a1).unwrap();
    CellCoord::new(wb.sheet_id(sheet).unwrap(), row, col)
}

/// The cached `<v>` of `cell` in `part`, read straight from the file.
fn cached_value(bytes: &[u8], part: &str, cell: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let data = &pkg.part(&PartName::new(part).unwrap()).unwrap().data;
    let mut r = Reader::from_reader(data.as_slice());
    let (mut in_cell, mut in_v) = (false, false);
    loop {
        match r.read_event().unwrap() {
            Event::Start(e) if e.local_name().as_ref() == "c" => {
                in_cell = attr_local(&e, "r").as_deref() == Some(cell);
            }
            Event::Start(e) if e.local_name().as_ref() == "v" => in_v = in_cell,
            Event::Text(t) if in_v => return t.xml10_content().into_owned(),
            Event::Eof => panic!("{cell} has no cached value"),
            _ => {}
        }
    }
}

#[test]
fn reads_every_file() {
    for f in files() {
        let (wb, warnings) = fmt_xlsx::read_with_warnings(&std::fs::read(&f).unwrap())
            .unwrap_or_else(|e| panic!("{f:?}: {e}"));
        assert!(!wb.sheets().is_empty());
        assert!(warnings.is_empty(), "{f:?}: {warnings:?}");
    }
}

#[test]
fn provisional_basic() {
    let bytes = load("provisional-basic.xlsx");
    let wb = fmt_xlsx::read(&bytes).unwrap();
    let names: Vec<String> = wb.sheets().into_iter().map(|(_, n)| n).collect();
    assert_eq!(names, ["Data", "Summary"]);

    assert_eq!(wb.formula_text(at(&wb, "Data", "D2")), Some("=B2*C2"));
    // The cross-sheet formula lives in Summary!B1 (A1 is its label).
    assert_eq!(wb.formula_text(at(&wb, "Summary", "B1")), Some("=Data!D7"));
    assert_eq!(
        wb.value(at(&wb, "Summary", "A1")),
        Value::Text("Grand total".into())
    );

    let header = wb.style(at(&wb, "Data", "A1"));
    assert_eq!(header.font.bold, Some(true));
    let totals = wb.style(at(&wb, "Data", "A7"));
    assert_eq!(
        totals.fill,
        Some(Fill::Solid(Color::Rgb(Rgb::new(255, 255, 0))))
    );
    assert_eq!(
        wb.style(at(&wb, "Data", "C2")).number_format.as_deref(),
        Some("0.00")
    );
    assert_eq!(
        wb.style(at(&wb, "Data", "B2")).number_format.as_deref(),
        Some("#,##0")
    );
    let border = wb.style(at(&wb, "Data", "D7")).borders;
    assert!(border.left.is_some() && border.bottom.is_some());
    assert_eq!(wb.value(at(&wb, "Data", "F2")), Value::Bool(true));
    assert_eq!(wb.value(at(&wb, "Data", "E2")), Value::Number(45731.0));
    assert_eq!(wb.value(at(&wb, "Data", "E7")), Value::Text("big".into()));

    // The engine recomputes D7; it must agree with LibreOffice's cached value.
    let lo: f64 = cached_value(&bytes, "/xl/worksheets/sheet1.xml", "D7")
        .parse()
        .unwrap();
    let Value::Number(ours) = wb.value(at(&wb, "Data", "D7")) else {
        panic!("D7 is not a number");
    };
    assert!(
        (ours - lo).abs() <= 1e-9 * lo.abs(),
        "engine {ours} vs LibreOffice {lo}"
    );
    assert_eq!(wb.value(at(&wb, "Summary", "B1")), Value::Number(ours));
}

#[test]
fn provisional_types() {
    let wb = fmt_xlsx::read(&load("provisional-types.xlsx")).unwrap();
    let c = |a1| at(&wb, "Types", a1);
    assert_eq!(
        wb.content(c("B7")),
        &CellContent::Value(Value::Text("0123".into()))
    );
    assert_eq!(wb.value(c("B13")), Value::Error(ErrorKind::Div0));
    assert_eq!(wb.formula_text(c("B13")), Some("=1/0"));
    assert_eq!(wb.value(c("B5")), Value::Number(1e15));
    assert_eq!(wb.value(c("B2")), Value::Number(42.0));
    assert_eq!(wb.value(c("B3")), Value::Number(-17.0));
    assert_eq!(wb.value(c("B8")), Value::Bool(true));
    assert_eq!(wb.value(c("B9")), Value::Bool(false));
    assert_eq!(wb.content(c("B1")), &CellContent::Empty);
    assert_eq!(
        wb.style(c("B11")).number_format.as_deref(),
        Some("hh:mm:ss")
    );
    assert_eq!(wb.style(c("B12")).number_format.as_deref(), Some("0.0%"));
}

#[test]
fn roundtrip_snapshots_are_identical() {
    for f in files() {
        let bytes = std::fs::read(&f).unwrap();
        let first = fmt_xlsx::read_with_context(&bytes).unwrap();
        let written = fmt_xlsx::write_with_context(&first.workbook, &first.context).unwrap();
        let again = fmt_xlsx::write_with_context(&first.workbook, &first.context).unwrap();
        assert_eq!(written, again, "{f:?}: output is not deterministic");
        let second = fmt_xlsx::read_with_context(&written).unwrap();
        assert_eq!(
            second.workbook.to_snapshot(),
            first.workbook.to_snapshot(),
            "{f:?}"
        );
        assert_eq!(second.context, first.context, "{f:?}");
        assert!(second.warnings.is_empty(), "{f:?}: {:?}", second.warnings);
        // Without context the built-in theme/font are used; the model is unchanged.
        let plain = fmt_xlsx::read(&fmt_xlsx::write(&first.workbook).unwrap()).unwrap();
        assert_eq!(plain.to_snapshot(), first.workbook.to_snapshot(), "{f:?}");
    }
}

fn part_text(xlsx: &[u8], part: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let data = &pkg.part(&PartName::new(part).unwrap()).unwrap().data;
    // One element per line so that the snapshot is reviewable.
    String::from_utf8(data.clone())
        .unwrap()
        .replace("><", ">\n<")
}

#[test]
fn emitted_parts_snapshot() {
    let loaded = fmt_xlsx::read_with_context(&load("provisional-basic.xlsx")).unwrap();
    let out = fmt_xlsx::write_with_context(&loaded.workbook, &loaded.context).unwrap();
    insta::assert_snapshot!("basic_styles_xml", part_text(&out, "/xl/styles.xml"));
    insta::assert_snapshot!(
        "basic_sheet1_xml",
        part_text(&out, "/xl/worksheets/sheet1.xml")
    );
}
