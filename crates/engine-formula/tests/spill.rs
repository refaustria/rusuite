//! Dynamic arrays in the `Engine`: spilling, `#SPILL!`, `A1#`, `@` and
//! structural edits.

use engine_formula::ast::{CellRef, MAX_ROW};
use engine_formula::{CellContent, CellCoord, Engine, ErrorKind, SheetId, Spill, Value};

const S1: SheetId = SheetId(0);

fn c(a1: &str) -> CellCoord {
    let r = CellRef::parse(a1).unwrap();
    CellCoord::new(S1, r.row, r.col)
}

fn cells(list: &[&str]) -> Vec<CellCoord> {
    let mut v: Vec<CellCoord> = list.iter().map(|s| c(s)).collect();
    v.sort_unstable();
    v
}

fn set(e: &mut Engine, a1: &str, input: &str) -> Vec<CellCoord> {
    e.set_input(c(a1), input).unwrap().changed
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn v(e: &Engine, a1: &str) -> Value {
    e.value(c(a1))
}

fn spilled(anchor: &str) -> CellContent {
    CellContent::Spilled { anchor: c(anchor) }
}

const SPILL: Value = Value::Error(ErrorKind::Spill);

#[test]
fn array_results_spill_and_readers_follow() {
    let mut e = Engine::new();
    set(&mut e, "C1", "3");
    set(&mut e, "B2", "=A2*10");
    let changed = set(&mut e, "A1", "=SEQUENCE(C1)");
    assert_eq!(changed, cells(&["A1", "A2", "A3", "B2"]));
    assert_eq!(
        (v(&e, "A1"), v(&e, "A2"), v(&e, "A3")),
        (n(1.0), n(2.0), n(3.0))
    );
    assert_eq!(e.content(c("A2")), &spilled("A1"));
    assert_eq!(e.spill_anchor(c("A3")), Some(c("A1")));
    assert_eq!(e.spill_anchor(c("A1")), None);
    assert_eq!(
        e.spill(c("A1")),
        Some(Spill {
            rows: 3,
            cols: 1,
            blocked: false
        })
    );
    assert_eq!(e.spill_range(c("A1")).map(|r| (r.r1, r.c1)), Some((2, 0)));
    assert_eq!(v(&e, "B2"), n(20.0));
    assert_eq!(e.used_range(S1), Some((2, 2)));
    // cells() lists the spilled cells.
    assert_eq!(
        e.cells(S1)
            .filter(|(_, x)| matches!(x, CellContent::Spilled { .. }))
            .count(),
        2
    );

    // The spill grows and shrinks with its input; freed cells are reported.
    let changed = set(&mut e, "C1", "4");
    assert_eq!(changed, cells(&["A4"]));
    assert_eq!(v(&e, "A4"), n(4.0));
    let changed = set(&mut e, "C1", "1");
    assert_eq!(changed, cells(&["A2", "A3", "A4", "B2"]));
    assert_eq!(e.content(c("A2")), &CellContent::Empty);
    assert_eq!(v(&e, "B2"), n(0.0));
    assert_eq!(e.spill(c("A1")), None);
    assert_eq!(e.used_range(S1), Some((1, 2)));
}

#[test]
fn obstacles_block_and_release_the_spill() {
    let mut e = Engine::new();
    set(&mut e, "A3", "x");
    set(&mut e, "B1", "=SUM(A1:A3)");
    let changed = set(&mut e, "A1", "={1;2;3}");
    assert_eq!(changed, cells(&["A1", "B1"]));
    assert_eq!(v(&e, "A1"), SPILL);
    assert_eq!(e.content(c("A2")), &CellContent::Empty);
    assert!(e.spill(c("A1")).unwrap().blocked);
    assert_eq!(e.spill_range(c("A1")), None);
    // Removing the obstacle lets it spill.
    let changed = e.clear(c("A3")).unwrap().changed;
    assert_eq!(changed, cells(&["A1", "A2", "A3", "B1"]));
    assert_eq!(v(&e, "A3"), n(3.0));
    assert_eq!(v(&e, "B1"), n(6.0));

    // Typing into a spilled cell blocks the spill; clearing it again
    // restores it. Clearing a spilled cell is a no-op.
    assert!(e.clear(c("A2")).unwrap().changed.is_empty());
    assert_eq!(e.content(c("A2")), &spilled("A1"));
    let changed = set(&mut e, "A2", "7");
    assert_eq!(changed, cells(&["A1", "A3", "B1"]));
    assert_eq!(
        (v(&e, "A1"), v(&e, "A2"), v(&e, "A3")),
        (SPILL, n(7.0), Value::Empty)
    );
    let changed = e.clear(c("A2")).unwrap().changed;
    assert_eq!(changed, cells(&["A1", "A2", "A3", "B1"]));
    assert_eq!(v(&e, "A2"), n(2.0));

    // Replacing the anchor by a constant removes the spill.
    let changed = set(&mut e, "A1", "5");
    assert_eq!(changed, cells(&["A2", "A3", "B1"]));
    assert_eq!(e.content(c("A3")), &CellContent::Empty);
    assert_eq!(v(&e, "B1"), n(5.0));
}

#[test]
fn spills_compete_and_leave_the_sheet() {
    let mut e = Engine::new();
    set(&mut e, "B1", "=SEQUENCE(3)");
    // A2:C2 would cross B2 (spilled from B1).
    set(&mut e, "A2", "=SEQUENCE(1,3)");
    assert_eq!(v(&e, "A2"), SPILL);
    // B1's spill shrinks: A2 fits now.
    let changed = set(&mut e, "B1", "=SEQUENCE(1)");
    assert!(changed.contains(&c("A2")) && changed.contains(&c("C2")));
    assert_eq!(
        (v(&e, "A2"), v(&e, "B2"), v(&e, "C2")),
        (n(1.0), n(2.0), n(3.0))
    );
    // Off the sheet.
    let last = format!("A{}", MAX_ROW + 1);
    e.set_input(c(&last), "=SEQUENCE(2)").unwrap();
    assert_eq!(e.value(c(&last)), SPILL);
}

#[test]
fn spill_range_operator_and_implicit_intersection() {
    let mut e = Engine::new();
    set(&mut e, "D1", "3");
    set(&mut e, "A1", "=SEQUENCE(D1)");
    set(&mut e, "B1", "=SUM(A1#)");
    set(&mut e, "B2", "=ROWS(A1#)");
    set(&mut e, "C1", "=A1#*10");
    assert_eq!((v(&e, "B1"), v(&e, "B2")), (n(6.0), n(3.0)));
    assert_eq!(v(&e, "C3"), n(30.0));
    // Growing the spill updates the readers of `A1#` and their spills.
    let changed = set(&mut e, "D1", "4");
    assert!(changed.contains(&c("C4")));
    assert_eq!((v(&e, "B1"), v(&e, "C4")), (n(10.0), n(40.0)));
    // A formula without an array result is a one-cell spill; a constant
    // or a blocked array gives #REF!.
    set(&mut e, "E1", "=1+1");
    set(&mut e, "E2", "=E1#");
    assert_eq!(v(&e, "E2"), n(2.0));
    set(&mut e, "E3", "=D1#");
    assert_eq!(v(&e, "E3"), Value::Error(ErrorKind::Ref));
    set(&mut e, "A3", "x");
    assert_eq!(v(&e, "A1"), SPILL);
    assert_eq!(v(&e, "B1"), Value::Error(ErrorKind::Ref));
    e.clear(c("A3")).unwrap();
    assert_eq!(v(&e, "B1"), n(10.0));

    // `@` intersects a range with the formula row / reduces an array.
    set(&mut e, "F1", "=@A1:A4*2");
    set(&mut e, "F2", "=@A1:A4*2");
    assert_eq!((v(&e, "F1"), v(&e, "F2")), (n(2.0), n(4.0)));
    assert_eq!(e.spill(c("F1")), None);
    set(&mut e, "F5", "=@SEQUENCE(3)+1");
    assert_eq!(v(&e, "F5"), n(2.0));
    assert_eq!(e.formula_text(c("F5")), Some("=@SEQUENCE(3)+1"));
}

#[test]
fn ranges_in_formulas_spill() {
    let mut e = Engine::new();
    for (i, x) in ["1", "2", "3"].iter().enumerate() {
        set(&mut e, &format!("A{}", i + 1), x);
    }
    set(&mut e, "C5", "=A1:A3*2");
    assert_eq!((v(&e, "C5"), v(&e, "C7")), (n(2.0), n(6.0)));
    set(&mut e, "D1", "=A1:A3");
    assert_eq!(v(&e, "D3"), n(3.0));
    // Editing a source updates the spilled cell.
    let changed = set(&mut e, "A3", "10");
    assert_eq!(changed, cells(&["C7", "D3"]));
    assert_eq!(v(&e, "C7"), n(20.0));
    // A one-cell range stays a scalar.
    set(&mut e, "E1", "=A1:A1");
    assert_eq!(e.spill(c("E1")), None);
}

#[test]
fn structural_edits_move_spills() {
    let mut e = Engine::new();
    set(&mut e, "A1", "=SEQUENCE(3)");
    set(&mut e, "C1", "=SUM(A1#)");
    e.insert_rows(S1, 0, 1).unwrap();
    assert_eq!(e.formula_text(c("C2")), Some("=SUM(A2#)"));
    assert_eq!(e.content(c("A1")), &CellContent::Empty);
    assert_eq!((v(&e, "A2"), v(&e, "A4")), (n(1.0), n(3.0)));
    assert_eq!(e.content(c("A4")), &spilled("A2"));
    assert_eq!(v(&e, "C2"), n(6.0));
    // Inserting a row inside the spill range: the spill is rebuilt.
    let r = e.insert_rows(S1, 2, 2).unwrap();
    assert!(r.changed.contains(&c("A3")) && r.changed.contains(&c("A4")));
    assert_eq!(
        (v(&e, "A2"), v(&e, "A3"), v(&e, "A4"), v(&e, "A5")),
        (n(1.0), n(2.0), n(3.0), Value::Empty)
    );
    // Deleting rows below and the anchor's own row.
    e.delete_rows(S1, 2, 3).unwrap();
    assert_eq!(v(&e, "A4"), n(3.0));
    set(&mut e, "E1", "=SUM(A2#)");
    assert_eq!(v(&e, "E1"), n(6.0));
    e.delete_rows(S1, 1, 1).unwrap();
    assert_eq!(e.content(c("A2")), &CellContent::Empty);
    assert_eq!(e.formula_text(c("E1")), Some("=SUM(#REF!#)"));
    assert_eq!(v(&e, "E1"), Value::Error(ErrorKind::Ref));
    // Columns.
    set(&mut e, "A1", "=SEQUENCE(1,3)");
    e.insert_cols(S1, 0, 2).unwrap();
    assert_eq!((v(&e, "C1"), v(&e, "E1")), (n(1.0), n(3.0)));
    assert_eq!(e.content(c("A1")), &CellContent::Empty);
}

#[test]
fn batches_sheets_and_cycles() {
    let mut e = Engine::new();
    e.begin_batch();
    e.set_input(c("A1"), "=SEQUENCE(2,2)").unwrap();
    e.set_input(c("D1"), "=B2*2").unwrap();
    let r = e.end_batch();
    assert_eq!(r.changed, cells(&["A1", "A2", "B1", "B2", "D1"]));
    assert_eq!(v(&e, "D1"), n(8.0));
    // A copied sheet spills on its own.
    let (copy, _) = e.duplicate_sheet(S1, "Copy").unwrap();
    assert_eq!(e.value(CellCoord::new(copy, 1, 1)), n(4.0));
    assert_eq!(
        e.spill_anchor(CellCoord::new(copy, 1, 1)),
        Some(CellCoord::new(copy, 0, 0))
    );
    // A spill read by its own anchor is a circular reference.
    let r = e.set_input(c("F1"), "=SEQUENCE(2)+F2").unwrap();
    assert!(r.cycle.is_some());
    assert_eq!(v(&e, "F1"), Value::Error(ErrorKind::Num));
    assert_eq!(e.content(c("F2")), &CellContent::Empty);
    // Setting `Spilled` content is the same as clearing.
    e.set_content(c("G1"), CellContent::Value(n(1.0))).unwrap();
    e.set_content(c("G1"), spilled("A1")).unwrap();
    assert_eq!(e.content(c("G1")), &CellContent::Empty);
    // recalc_all keeps spills.
    e.recalc_all();
    assert_eq!(v(&e, "B2"), n(4.0));
}
