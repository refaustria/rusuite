//! P9-C4: LET/LAMBDA, the array shaping functions and lifting in the
//! engine (spilling, recalculation, named lambdas).

use engine_formula::{CellCoord, Engine, ErrorKind, NameScope, SheetId, Value};

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn c(row: u32, col: u32) -> CellCoord {
    CellCoord::new(SheetId(0), row, col)
}

fn engine() -> Engine {
    let mut e = Engine::new();
    for (r, v) in ["1", "2", "3"].iter().enumerate() {
        e.set_input(c(r as u32, 0), v).unwrap();
    }
    e.set_input(c(0, 1), "10").unwrap();
    e.set_input(c(1, 1), "20").unwrap();
    e
}

#[test]
fn let_spills_and_recalculates() {
    let mut e = engine();
    e.set_input(c(0, 4), "=LET(x,A1:A3,SUM(x*2))").unwrap();
    assert_eq!(e.value(c(0, 4)), n(12.0));
    e.set_input(c(0, 5), "=LET(x,A1:A3,x*2)").unwrap();
    assert_eq!(e.value(c(2, 5)), n(6.0));
    e.set_input(c(2, 0), "30").unwrap();
    assert_eq!(e.value(c(0, 4)), n(66.0));
    assert_eq!(e.value(c(2, 5)), n(60.0));
}

#[test]
fn vstack_spills_and_is_blocked() {
    let mut e = engine();
    e.set_input(c(0, 3), "=VSTACK(A1:A2,B1:B2)").unwrap();
    let spill = e.spill(c(0, 3)).unwrap();
    assert_eq!((spill.rows, spill.cols, spill.blocked), (4, 1, false));
    assert_eq!(e.value(c(3, 3)), n(20.0));
    e.set_input(c(2, 3), "x").unwrap();
    assert_eq!(e.value(c(0, 3)), Value::Error(ErrorKind::Spill));
    e.clear(c(2, 3)).unwrap();
    assert_eq!(e.value(c(2, 3)), n(10.0));
}

#[test]
fn lifted_functions_spill() {
    let mut e = engine();
    e.set_input(c(0, 6), "=LEN(A1:A3*100)").unwrap();
    assert_eq!(e.spill(c(0, 6)).map(|s| s.rows), Some(3));
    assert_eq!(e.value(c(1, 6)), n(3.0));
    // Whole columns spill the used rows.
    e.set_input(c(0, 7), "=A:A*1").unwrap();
    assert_eq!(e.spill(c(0, 7)).map(|s| s.rows), Some(3));
    e.set_input(c(0, 8), "=ISNUMBER(A:A)").unwrap();
    assert_eq!(e.spill(c(0, 8)).map(|s| s.rows), Some(3));
}

#[test]
fn named_lambdas_including_recursion() {
    let mut e = engine();
    e.set_input(c(5, 0), "=Twice(A2)").unwrap();
    assert_eq!(e.value(c(5, 0)), Value::Error(ErrorKind::Name));
    e.set_name("Twice", NameScope::Workbook, "=LAMBDA(v,v*2)")
        .unwrap();
    assert_eq!(e.value(c(5, 0)), n(4.0));
    e.set_name(
        "Fact",
        NameScope::Workbook,
        "=LAMBDA(k,IF(k<=1,1,k*Fact(k-1)))",
    )
    .unwrap();
    e.set_input(c(6, 0), "=Fact(10)").unwrap();
    assert_eq!(e.value(c(6, 0)), n(3_628_800.0));
    // Too deep: #NUM!.
    e.set_input(c(7, 0), "=Fact(500)").unwrap();
    assert_eq!(e.value(c(7, 0)), Value::Error(ErrorKind::Num));
    e.set_input(c(8, 0), "=MAP(A1:A3,Twice)").unwrap();
    assert_eq!(e.value(c(10, 0)), n(6.0));
}
