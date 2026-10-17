//! P9-C4: manual calculation (Formulas › Calculation Options › Manual,
//! Calculate Now / Calculate Sheet).

use engine_formula::{CellCoord, Engine, SheetId, Value};

fn n(x: f64) -> Value {
    Value::Number(x)
}

#[test]
fn manual_mode_defers_dependents() {
    let mut e = Engine::new();
    let s1 = SheetId(0);
    let s2 = e.add_sheet("Two").unwrap();
    let c = |s, r, col| CellCoord::new(s, r, col);
    e.set_input(c(s1, 0, 0), "1").unwrap();
    e.set_input(c(s1, 0, 1), "=A1*2").unwrap();
    e.set_input(c(s2, 0, 0), "=Sheet1!A1+1").unwrap();
    assert!(!e.needs_calc());
    e.set_manual(true);
    assert!(e.is_manual());
    e.set_input(c(s1, 0, 0), "5").unwrap();
    // Dependents keep their old values.
    assert_eq!(e.value(c(s1, 0, 1)), n(2.0));
    assert_eq!(e.value(c(s2, 0, 0)), n(2.0));
    assert!(e.needs_calc());
    // A newly entered formula is calculated itself.
    e.set_input(c(s1, 1, 1), "=A1+100").unwrap();
    assert_eq!(e.value(c(s1, 1, 1)), n(105.0));
    // Calculate Sheet: only Sheet1.
    e.calculate_sheet(s1);
    assert_eq!(e.value(c(s1, 0, 1)), n(10.0));
    assert_eq!(e.value(c(s2, 0, 0)), n(2.0));
    assert!(e.needs_calc());
    // Calculate Now: everything.
    let r = e.calculate_now();
    assert!(r.changed.contains(&c(s2, 0, 0)));
    assert_eq!(e.value(c(s2, 0, 0)), n(6.0));
    assert!(!e.needs_calc());
    // Back to automatic recalculates what is pending.
    e.set_input(c(s1, 0, 0), "7").unwrap();
    assert_eq!(e.value(c(s1, 0, 1)), n(10.0));
    e.set_manual(false);
    assert_eq!(e.value(c(s1, 0, 1)), n(14.0));
    assert_eq!(e.value(c(s2, 0, 0)), n(8.0));
    assert!(!e.needs_calc());
    e.set_input(c(s1, 0, 0), "1").unwrap();
    assert_eq!(e.value(c(s1, 0, 1)), n(2.0));
}
