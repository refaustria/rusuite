//! Defined names: scoping, constants, formula names, dependency tracking,
//! structural edits and sheet rename/delete.

use engine_formula::{
    is_valid_name, CellCoord, Engine, EngineError, ErrorKind, NameScope, SheetId, Value,
};

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn setup() -> (Engine, SheetId, SheetId) {
    let mut e = Engine::new();
    let s1 = SheetId(0);
    let s2 = e.add_sheet("Other").unwrap();
    for r in 0..5 {
        e.set_input(CellCoord::new(s1, r, 0), &(r + 1).to_string())
            .unwrap();
    }
    (e, s1, s2)
}

fn c(s: SheetId, row: u32, col: u32) -> CellCoord {
    CellCoord::new(s, row, col)
}

#[test]
fn range_names_work_wherever_a_range_does() {
    let (mut e, s1, s2) = setup();
    e.set_name("Data", NameScope::Workbook, "=Sheet1!$A$1:$A$5")
        .unwrap();
    e.set_input(c(s1, 0, 2), "=SUM(Data)").unwrap();
    e.set_input(c(s2, 0, 0), "=AVERAGE(data)*2").unwrap();
    e.set_input(c(s1, 1, 2), "=INDEX(Data,3)").unwrap();
    e.set_input(c(s1, 2, 2), "=ROWS(Data)").unwrap();
    assert_eq!(e.value(c(s1, 0, 2)), n(15.0));
    assert_eq!(e.value(c(s2, 0, 0)), n(6.0));
    assert_eq!(e.value(c(s1, 1, 2)), n(3.0));
    assert_eq!(e.value(c(s1, 2, 2)), n(5.0));
    // The formula keeps the name text.
    assert_eq!(e.formula_text(c(s2, 0, 0)), Some("=AVERAGE(data)*2"));
    // Dependency tracking through the name.
    let r = e.set_input(c(s1, 4, 0), "105").unwrap();
    assert_eq!(r.changed, vec![c(s1, 0, 2), c(s2, 0, 0)]);
    assert_eq!(e.value(c(s1, 0, 2)), n(115.0));
    // A range name in a cell spills.
    e.set_input(c(s2, 2, 3), "=Data").unwrap();
    assert_eq!(e.value(c(s2, 6, 3)), n(105.0));
}

#[test]
fn constants_formulas_and_unknown_names() {
    let (mut e, s1, _) = setup();
    e.set_input(c(s1, 0, 1), "=Rate*100").unwrap();
    assert_eq!(e.value(c(s1, 0, 1)), Value::Error(ErrorKind::Name));
    // Defining the name revives the formula.
    let r = e.set_name("Rate", NameScope::Workbook, "0.19").unwrap();
    assert_eq!(r.changed, vec![c(s1, 0, 1)]);
    assert_eq!(e.value(c(s1, 0, 1)), n(19.0));
    // A formula name, evaluated lazily and tracked.
    e.set_name("Total", NameScope::Workbook, "=SUM(Sheet1!$A$1:$A$5)*Rate")
        .unwrap();
    e.set_input(c(s1, 1, 1), "=Total").unwrap();
    assert!((e.value(c(s1, 1, 1)) == n(15.0 * 0.19)));
    e.set_input(c(s1, 0, 0), "11").unwrap();
    assert_eq!(e.value(c(s1, 1, 1)), n(25.0 * 0.19));
    // Redefining a name used by another name recalculates both users.
    let r = e.set_name("Rate", NameScope::Workbook, "=0.1").unwrap();
    assert_eq!(r.changed, vec![c(s1, 0, 1), c(s1, 1, 1)]);
    assert_eq!(e.value(c(s1, 1, 1)), n(2.5));
    // Deleting it: `#NAME?`.
    e.remove_name("rate", NameScope::Workbook).unwrap();
    assert_eq!(e.value(c(s1, 0, 1)), Value::Error(ErrorKind::Name));
    assert_eq!(e.value(c(s1, 1, 1)), Value::Error(ErrorKind::Name));
    assert_eq!(
        e.remove_name("Rate", NameScope::Workbook),
        Err(EngineError::UnknownName("Rate".into()))
    );
}

#[test]
fn sheet_scope_wins_and_qualified_names() {
    let (mut e, s1, s2) = setup();
    e.set_name("Tax", NameScope::Workbook, "0.2").unwrap();
    e.set_name("Tax", NameScope::Sheet(s2), "0.1").unwrap();
    e.set_input(c(s1, 0, 1), "=Tax").unwrap();
    e.set_input(c(s2, 0, 1), "=Tax").unwrap();
    e.set_input(c(s1, 1, 1), "=Other!Tax").unwrap();
    e.set_input(c(s2, 1, 1), "=Sheet1!Tax").unwrap();
    assert_eq!(e.value(c(s1, 0, 1)), n(0.2));
    assert_eq!(e.value(c(s2, 0, 1)), n(0.1));
    assert_eq!(e.value(c(s1, 1, 1)), n(0.1));
    // `Sheet1!Tax`: Sheet1 has no own Tax, the workbook's applies.
    assert_eq!(e.value(c(s2, 1, 1)), n(0.2));
    assert_eq!(e.formula_text(c(s1, 1, 1)), Some("=Other!Tax"));
    assert_eq!(
        e.resolve_name("TAX", s2).unwrap().scope,
        NameScope::Sheet(s2)
    );
}

#[test]
fn names_adjust_on_structural_edits() {
    let (mut e, s1, s2) = setup();
    e.set_name("Data", NameScope::Workbook, "Sheet1!$A$1:$A$5")
        .unwrap();
    e.set_name("Cell", NameScope::Sheet(s1), "$A$3").unwrap();
    e.set_input(c(s2, 0, 0), "=SUM(Data)").unwrap();
    e.set_input(c(s1, 0, 3), "=Cell*10").unwrap();
    assert_eq!(e.value(c(s1, 0, 3)), n(30.0));
    e.insert_rows(s1, 1, 2).unwrap();
    assert_eq!(
        e.name("Data", NameScope::Workbook).unwrap().formula,
        "Sheet1!$A$1:$A$7"
    );
    assert_eq!(
        e.name("Cell", NameScope::Sheet(s1)).unwrap().formula,
        "$A$5"
    );
    assert_eq!(e.value(c(s1, 0, 3)), n(30.0));
    // Edges follow the adjusted name.
    e.set_input(c(s1, 6, 0), "50").unwrap();
    assert_eq!(e.value(c(s2, 0, 0)), n(1.0 + 2.0 + 3.0 + 4.0 + 50.0));
    e.delete_cols(s1, 0, 1).unwrap();
    assert_eq!(
        e.name("Data", NameScope::Workbook).unwrap().formula,
        "#REF!"
    );
    assert_eq!(e.value(c(s2, 0, 0)), Value::Error(ErrorKind::Ref));
}

#[test]
fn names_follow_sheet_rename_delete_and_copy() {
    let (mut e, s1, s2) = setup();
    e.set_name("Ext", NameScope::Workbook, "Other!$B$1")
        .unwrap();
    e.set_name("Local", NameScope::Sheet(s2), "Other!$B$2")
        .unwrap();
    e.set_input(c(s2, 0, 1), "7").unwrap();
    e.set_input(c(s1, 0, 5), "=Ext+Other!Local").unwrap();
    e.rename_sheet(s2, "Facts").unwrap();
    assert_eq!(
        e.name("Ext", NameScope::Workbook).unwrap().formula,
        "Facts!$B$1"
    );
    e.set_input(c(s2, 1, 1), "3").unwrap();
    assert_eq!(e.value(c(s1, 0, 5)), n(10.0));
    // Duplicating copies the sheet's own names, pointing at the copy.
    let (copy, _) = e.duplicate_sheet(s2, "Copy").unwrap();
    assert_eq!(
        e.name("Local", NameScope::Sheet(copy)).unwrap().formula,
        "Copy!$B$2"
    );
    // Deleting the sheet: its names go, references become #REF!.
    e.remove_sheet(s2).unwrap();
    assert!(e.name("Local", NameScope::Sheet(s2)).is_none());
    assert_eq!(e.name("Ext", NameScope::Workbook).unwrap().formula, "#REF!");
    assert_eq!(e.value(c(s1, 0, 5)), Value::Error(ErrorKind::Ref));
}

#[test]
fn relative_names_move_with_the_cell() {
    let (mut e, s1, _) = setup();
    // Stored relative to A1 (as Excel does): "the cell to the left".
    e.set_name("Left", NameScope::Workbook, "Sheet1!XFD1")
        .unwrap();
    e.set_input(c(s1, 2, 1), "=Left*2").unwrap();
    // B3 → A3.
    assert_eq!(e.value(c(s1, 2, 1)), n(6.0));
    e.set_input(c(s1, 2, 0), "4").unwrap();
    assert_eq!(e.value(c(s1, 2, 1)), n(8.0));
}

#[test]
fn volatile_and_recursive_names() {
    let (mut e, s1, _) = setup();
    e.set_name(
        "Dyn",
        NameScope::Workbook,
        "OFFSET(Sheet1!$A$1,0,0,COUNT(Sheet1!$A:$A),1)",
    )
    .unwrap();
    e.set_input(c(s1, 0, 4), "=SUM(Dyn)").unwrap();
    assert_eq!(e.value(c(s1, 0, 4)), n(15.0));
    e.set_input(c(s1, 5, 0), "6").unwrap();
    assert_eq!(e.value(c(s1, 0, 4)), n(21.0));
    e.set_name("Loop", NameScope::Workbook, "Loop+1").unwrap();
    e.set_input(c(s1, 1, 4), "=Loop").unwrap();
    assert_eq!(e.value(c(s1, 1, 4)), Value::Error(ErrorKind::Name));
}

#[test]
fn validation_update_and_order() {
    let (mut e, s1, s2) = setup();
    for bad in [
        "", "A1", "$A$1", "R1C1", "r", "C", "C12", "TRUE", "1abc", "a b", "x-y",
    ] {
        assert!(!is_valid_name(bad), "{bad}");
        assert!(matches!(
            e.set_name(bad, NameScope::Workbook, "1"),
            Err(EngineError::InvalidName(_))
        ));
    }
    for good in [
        "Tax",
        "_x",
        "\\back",
        "tax.rate",
        "ABCD1",
        "Rate2023x",
        "Übersicht",
        "a?b",
    ] {
        assert!(is_valid_name(good), "{good}");
    }
    assert!(!is_valid_name(&"a".repeat(256)));
    assert!(is_valid_name(&"a".repeat(255)));
    assert!(matches!(
        e.set_name("X", NameScope::Workbook, "=1+"),
        Err(EngineError::Parse(_))
    ));
    assert!(matches!(
        e.set_name("X", NameScope::Sheet(SheetId(9)), "1"),
        Err(EngineError::UnknownSheet(_))
    ));
    e.set_name("A_", NameScope::Workbook, "1").unwrap();
    e.set_name("B_", NameScope::Workbook, "2").unwrap();
    e.set_input(c(s1, 0, 6), "=B_").unwrap();
    // Rename + rescope in place.
    e.update_name("A_", NameScope::Workbook, "C_", NameScope::Sheet(s2), "3")
        .unwrap();
    let order: Vec<&str> = e.names().iter().map(|n| n.name.as_str()).collect();
    assert_eq!(order, ["C_", "B_"]);
    assert_eq!(
        e.update_name("C_", NameScope::Sheet(s2), "b_", NameScope::Workbook, "1"),
        Err(EngineError::DuplicateName("b_".into()))
    );
    assert_eq!(
        e.insert_name(0, "B_", NameScope::Workbook, "1"),
        Err(EngineError::DuplicateName("B_".into()))
    );
    e.update_name("B_", NameScope::Workbook, "B_", NameScope::Workbook, "20")
        .unwrap();
    assert_eq!(e.value(c(s1, 0, 6)), n(20.0));
    let entry = e.name("C_", NameScope::Sheet(s2)).unwrap().clone();
    assert_eq!(e.name_value(&entry, c(s2, 0, 0)), n(3.0));
    e.set_name("Rng", NameScope::Workbook, "Sheet1!$A$1:$A$2")
        .unwrap();
    let rng = e.name("Rng", NameScope::Workbook).unwrap().clone();
    assert_eq!(e.name_range(&rng, s2).map(|r| (r.r0, r.r1)), Some((0, 1)));
    // Batches defer the recalculation of name users.
    e.begin_batch();
    e.set_name("B_", NameScope::Workbook, "5").unwrap();
    assert_eq!(e.value(c(s1, 0, 6)), n(20.0));
    e.end_batch();
    assert_eq!(e.value(c(s1, 0, 6)), n(5.0));
}
