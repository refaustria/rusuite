//! Defined names in the workbook model: metadata, built-in print names
//! and the snapshot.

use engine_formula::{CellCoord, Value};
use model_sheet::{BuiltinName, DefinedName, NameScope, Workbook};

fn book() -> Workbook {
    let mut wb = Workbook::new();
    let s = wb.sheet_id("Sheet1").unwrap();
    for r in 0..4 {
        wb.set_input(CellCoord::new(s, r, 0), &format!("{}", r + 1))
            .unwrap();
    }
    wb.add_sheet("Data").unwrap();
    wb
}

#[test]
fn define_update_delete_with_metadata() {
    let mut wb = book();
    let s = wb.sheet_id("Sheet1").unwrap();
    let def = DefinedName {
        comment: Some("VAT".into()),
        ..DefinedName::new("Rate", NameScope::Workbook, "=0.2")
    };
    wb.define_name(&def).unwrap();
    wb.set_input(CellCoord::new(s, 0, 1), "=A1*Rate").unwrap();
    assert_eq!(wb.value(CellCoord::new(s, 0, 1)), Value::Number(0.2));
    let names = wb.names();
    assert_eq!(names.len(), 1);
    assert_eq!(names[0].refers_to, "0.2");
    assert_eq!(names[0].comment.as_deref(), Some("VAT"));
    assert!(wb.define_name(&def).is_err());
    let edited = DefinedName {
        name: "VatRate".into(),
        refers_to: "0.1".into(),
        hidden: true,
        ..def.clone()
    };
    wb.update_name("rate", NameScope::Workbook, &edited)
        .unwrap();
    assert_eq!(wb.value(CellCoord::new(s, 0, 1)).to_string(), "#NAME?");
    let n = wb.name("VATRATE", NameScope::Workbook).unwrap();
    assert!(n.hidden);
    assert_eq!(n.comment.as_deref(), Some("VAT"));
    let (index, old, _) = wb.delete_name("VatRate", NameScope::Workbook).unwrap();
    assert_eq!((index, old.name.as_str()), (0, "VatRate"));
    assert!(wb.names().is_empty());
    wb.insert_name(0, &old).unwrap();
    assert_eq!(wb.names(), vec![old]);
}

#[test]
fn print_area_and_titles_are_builtin_names() {
    let mut wb = book();
    let s = wb.sheet_id("Sheet1").unwrap();
    wb.set_print_area(s, Some((0, 0, 9, 3))).unwrap();
    wb.set_print_titles(s, Some((0, 0)), Some((0, 1))).unwrap();
    let pa = wb.builtin_name(s, BuiltinName::PrintArea).unwrap();
    assert_eq!(pa.name, "Print_Area");
    assert_eq!(pa.refers_to, "Sheet1!$A$1:$D$10");
    assert_eq!(pa.scope, NameScope::Sheet(s));
    let pt = wb.builtin_name(s, BuiltinName::PrintTitles).unwrap();
    assert_eq!(pt.refers_to, "Sheet1!$A:$B,Sheet1!$1:$1");
    assert_eq!(wb.print_titles(s), (Some((0, 0)), Some((0, 1))));
    // They follow structural edits.
    wb.insert_rows(s, 0, 2).unwrap();
    let area = wb.print_area(s);
    assert_eq!((area[0].r0, area[0].r1, area[0].c1), (2, 11, 3));
    assert_eq!(wb.print_titles(s), (Some((2, 2)), Some((0, 1))));
    wb.set_print_area(s, None).unwrap();
    assert!(wb.print_area(s).is_empty());
    wb.set_print_titles(s, None, None).unwrap();
    assert_eq!(wb.print_titles(s), (None, None));
    assert_eq!(
        BuiltinName::from_file_name("_XLNM.print_titles"),
        Some(BuiltinName::PrintTitles)
    );
    assert_eq!(BuiltinName::from_file_name("_xlnm._FilterDatabase"), None);
    assert_eq!(BuiltinName::PrintArea.file_name(), "_xlnm.Print_Area");
}

#[test]
fn snapshot_keeps_names_and_scopes() {
    let mut wb = book();
    let data = wb.sheet_id("Data").unwrap();
    wb.move_sheet(data, 0).unwrap();
    wb.define_name(&DefinedName::new(
        "Local",
        NameScope::Sheet(data),
        "Data!$A$1",
    ))
    .unwrap();
    wb.define_name(&DefinedName {
        hidden: true,
        comment: Some("c".into()),
        ..DefinedName::new("All", NameScope::Workbook, "Sheet1!$A$1:$A$4")
    })
    .unwrap();
    let s = wb.sheet_id("Sheet1").unwrap();
    wb.set_input(CellCoord::new(s, 5, 0), "=SUM(All)").unwrap();
    let snap = wb.to_snapshot();
    assert_eq!(snap.names[0].local_sheet, Some(0));
    assert_eq!(snap.names[1].local_sheet, None);
    let back = Workbook::from_snapshot(&snap).unwrap();
    assert_eq!(back.to_snapshot(), snap);
    let s2 = back.sheet_id("Sheet1").unwrap();
    assert_eq!(back.value(CellCoord::new(s2, 5, 0)), Value::Number(10.0));
    // JSON stays camelCase.
    let json = serde_json::to_string(&snap.names[0]).unwrap();
    assert!(
        json.contains("\"localSheet\":0") && json.contains("\"refersTo\""),
        "{json}"
    );
}

#[test]
fn sheet_removal_and_copy_keep_metadata_in_step() {
    let mut wb = book();
    let data = wb.sheet_id("Data").unwrap();
    wb.define_name(&DefinedName {
        comment: Some("local".into()),
        ..DefinedName::new("Here", NameScope::Sheet(data), "Data!$B$2")
    })
    .unwrap();
    let (copy, _) = wb.duplicate_sheet(data, "Data2").unwrap();
    let copied = wb.name("Here", NameScope::Sheet(copy)).unwrap();
    assert_eq!(copied.refers_to, "Data2!$B$2");
    assert_eq!(copied.comment.as_deref(), Some("local"));
    wb.remove_sheet(data).unwrap();
    assert_eq!(wb.names().len(), 1);
    wb.set_names(&[DefinedName::new("X", NameScope::Workbook, "1")])
        .unwrap();
    assert_eq!(wb.names().len(), 1);
    assert_eq!(wb.names()[0].name, "X");
}
