//! Sheet and workbook protection: the openpyxl reference file (legacy
//! and SHA-512 password forms) and a built workbook round-trip.

use std::path::PathBuf;

use engine_formula::CellCoord;
use model_sheet::{Password, SheetProtection, Workbook, WorkbookProtection};

fn reference() -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx/provisional-protection.xlsx");
    std::fs::read(p).unwrap()
}

#[test]
fn openpyxl_protection_is_read() {
    let (wb, warnings) = fmt_xlsx::read_with_warnings(&reference()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let locked = wb.sheet_id("Locked").unwrap();
    let p = wb.active_protection(locked).unwrap();
    assert!(!p.sort && !p.format_cells && p.format_rows && p.insert_rows);
    assert!(p.password.legacy.is_some() && p.password.hashed.is_none());
    assert!(p.password.verify("test") && !p.password.verify("Test"));
    assert!(!wb.is_locked(CellCoord::new(locked, 1, 1)));
    assert!(wb.is_locked(CellCoord::new(locked, 0, 0)));
    assert!(wb.is_formula_hidden(CellCoord::new(locked, 2, 2)));

    let sha = wb.sheet_id("Sha").unwrap();
    let p = wb.active_protection(sha).unwrap();
    let h = p.password.hashed.as_ref().unwrap();
    assert_eq!(
        (h.algorithm_name.as_str(), h.spin_count),
        ("SHA-512", 100_000)
    );
    assert!(p.password.verify("test") && !p.password.verify("tset"));

    let book = wb.workbook_protection().unwrap();
    assert!(book.lock_structure && !book.lock_windows);
    assert!(book.password.verify("wb") && !book.password.verify("test"));
    assert!(wb.structure_locked());
    assert_eq!(wb.active_sheet(), sha);
    assert!(wb.is_sheet_hidden(wb.sheet_id("Hidden").unwrap()));
    assert!(wb.is_sheet_very_hidden(wb.sheet_id("Deep").unwrap()));

    // Saved and read again: the same protection, active sheet and states.
    let back = fmt_xlsx::read(&fmt_xlsx::write(&wb).unwrap()).unwrap();
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert_eq!(back.workbook_protection(), wb.workbook_protection());
    assert_eq!(back.active_sheet(), sha);
}

#[test]
fn built_protection_roundtrips() {
    let mut wb = Workbook::new();
    let s = wb.sheet_id("Sheet1").unwrap();
    let second = wb.add_sheet("Two").unwrap();
    let p = SheetProtection {
        objects: false,
        select_locked_cells: true,
        auto_filter: false,
        password: Password::new("geheim", &[5; 16]),
        ..SheetProtection::default()
    };
    wb.set_sheet_protection(s, Some(p.clone())).unwrap();
    wb.set_workbook_protection(Some(WorkbookProtection {
        lock_structure: true,
        lock_windows: true,
        password: Password::default(),
    }));
    wb.set_active_sheet(Some(second));
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.sheet_protection(s), Some(&p));
    assert!(back.sheet_protection(second).is_none());
    assert!(back.active_protection(s).unwrap().password.verify("geheim"));
    let book = back.workbook_protection().unwrap();
    assert!(book.lock_structure && book.lock_windows && book.password.is_none());
    assert_eq!(back.active_sheet(), second);
    // `tabSelected` goes with the active sheet.
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(&bytes)).unwrap();
    let sheet2 = &pkg
        .part(&fmt_ooxml::PartName::new("/xl/worksheets/sheet2.xml").unwrap())
        .unwrap()
        .data;
    assert!(String::from_utf8_lossy(sheet2).contains("tabSelected=\"1\""));
}
