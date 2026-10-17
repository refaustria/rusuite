//! P9-C4: the intersection and union operators, 3-D references, per-end
//! `$` flags on whole rows/columns and the R1C1 reference style.

use engine_formula::{parse, CellCoord, Engine, ErrorKind, SheetId, Value};

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn c(s: SheetId, row: u32, col: u32) -> CellCoord {
    CellCoord::new(s, row, col)
}

/// Sheet1..Sheet3 with A1 = 1, 10, 100 and B1:C3 = 1..9 on Sheet1.
fn book() -> (Engine, [SheetId; 3]) {
    let mut e = Engine::new();
    let s1 = SheetId(0);
    let s2 = e.add_sheet("Sheet2").unwrap();
    let s3 = e.add_sheet("Sheet3").unwrap();
    for (s, v) in [(s1, "1"), (s2, "10"), (s3, "100")] {
        e.set_input(c(s, 0, 0), v).unwrap();
    }
    let mut k = 1;
    for r in 0..3 {
        for col in 1..3 {
            e.set_input(c(s1, r, col), &k.to_string()).unwrap();
            k += 1;
        }
    }
    (e, [s1, s2, s3])
}

#[test]
fn intersection_operator() {
    let (mut e, [s1, ..]) = book();
    // B1:C3 = 1 2 / 3 4 / 5 6; B2:C2 ∩ C1:C3 = C2 = 4.
    e.set_input(c(s1, 5, 5), "=B2:C2 C1:C3").unwrap();
    assert_eq!(e.value(c(s1, 5, 5)), n(4.0));
    e.set_input(c(s1, 6, 5), "=SUM(B1:C2 B2:C3)").unwrap();
    assert_eq!(e.value(c(s1, 6, 5)), n(7.0));
    e.set_input(c(s1, 7, 5), "=B1 C3").unwrap();
    assert_eq!(e.value(c(s1, 7, 5)), Value::Error(ErrorKind::Null));
    // The text is kept and reprinted with one space.
    assert_eq!(
        parse("=SUM(B1:C2   B2:C3)").unwrap().to_string(),
        "SUM(B1:C2 B2:C3)"
    );
    // It needs references.
    assert!(parse("=A1 1").is_err());
    // Recalculates when a cell of the intersection changes.
    e.set_input(c(s1, 1, 2), "40").unwrap();
    assert_eq!(e.value(c(s1, 5, 5)), n(40.0));
}

#[test]
fn union_operator() {
    let (mut e, [s1, ..]) = book();
    e.set_input(c(s1, 5, 5), "=SUM((B1,C3))").unwrap();
    assert_eq!(e.value(c(s1, 5, 5)), n(7.0));
    e.set_input(c(s1, 6, 5), "=COUNT((B1:B3,C1),A1)").unwrap();
    assert_eq!(e.value(c(s1, 6, 5)), n(5.0));
    e.set_input(c(s1, 7, 5), "=AREAS((B1:B3,C1,A1))").unwrap();
    assert_eq!(e.value(c(s1, 7, 5)), n(3.0));
    e.set_input(c(s1, 8, 5), "=MAX((B1,C3,A1))").unwrap();
    assert_eq!(e.value(c(s1, 8, 5)), n(6.0));
    // Outside the functions that accept several areas: #VALUE!.
    e.set_input(c(s1, 9, 5), "=(B1,C1)").unwrap();
    assert_eq!(e.value(c(s1, 9, 5)), Value::Error(ErrorKind::Value));
    assert_eq!(
        parse("=SUM((A1,B2,C3))").unwrap().to_string(),
        "SUM((A1,B2,C3))"
    );
    assert!(parse("=SUM((1,2))").is_err());
    e.set_input(c(s1, 2, 2), "60").unwrap();
    assert_eq!(e.value(c(s1, 5, 5)), n(61.0));
}

#[test]
fn three_d_references() {
    let (mut e, [s1, s2, s3]) = book();
    e.set_input(c(s1, 9, 0), "=SUM(Sheet1:Sheet3!A1)").unwrap();
    assert_eq!(e.value(c(s1, 9, 0)), n(111.0));
    e.set_input(c(s1, 10, 0), "=AVERAGE(Sheet2:Sheet3!A1)")
        .unwrap();
    assert_eq!(e.value(c(s1, 10, 0)), n(55.0));
    e.set_input(c(s1, 11, 0), "=AREAS(Sheet1:Sheet3!A1:B2)")
        .unwrap();
    assert_eq!(e.value(c(s1, 11, 0)), n(3.0));
    // Not in a scalar position.
    e.set_input(c(s1, 12, 0), "=Sheet1:Sheet3!A1").unwrap();
    assert_eq!(e.value(c(s1, 12, 0)), Value::Error(ErrorKind::Value));
    // A cell of a sheet inside the span recalculates the formula.
    e.set_input(c(s2, 0, 0), "20").unwrap();
    assert_eq!(e.value(c(s1, 9, 0)), n(121.0));
    // A new sheet moved into the span counts.
    let s4 = e.add_sheet("Extra").unwrap();
    e.set_input(c(s4, 0, 0), "1000").unwrap();
    assert_eq!(e.value(c(s1, 9, 0)), n(121.0));
    e.move_sheet(s4, 1).unwrap();
    assert_eq!(e.value(c(s1, 9, 0)), n(1121.0));
    e.set_input(c(s4, 0, 0), "2000").unwrap();
    assert_eq!(e.value(c(s1, 9, 0)), n(2121.0));
    // Renaming an end sheet rewrites the text.
    e.rename_sheet(s3, "Last Sheet").unwrap();
    assert_eq!(
        e.formula_text(c(s1, 9, 0)),
        Some("=SUM('Sheet1:Last Sheet'!A1)")
    );
    assert_eq!(e.value(c(s1, 9, 0)), n(2121.0));
    // Deleting the last sheet of the span moves the end inwards.
    e.remove_sheet(s3).unwrap();
    assert_eq!(e.formula_text(c(s1, 9, 0)), Some("=SUM(Sheet1:Sheet2!A1)"));
    assert_eq!(e.value(c(s1, 9, 0)), n(2021.0));
    // Deleting a middle sheet drops it from the span.
    e.remove_sheet(s4).unwrap();
    assert_eq!(e.value(c(s1, 9, 0)), n(21.0));
    // Parsing and printing.
    assert_eq!(
        parse("='My Sheet:Other'!$A$1:B2").unwrap().to_string(),
        "'My Sheet:Other'!$A$1:B2"
    );
    assert_eq!(parse("=sheet1:Sheet1!A1").unwrap().to_string(), "sheet1!A1");
}

#[test]
fn whole_rows_and_columns_keep_each_dollar() {
    for f in [
        "=SUM($A:C)",
        "=SUM(A:$C)",
        "=SUM($2:4)",
        "=SUM(2:$4)",
        "=SUM($C:A)",
    ] {
        let printed = parse(f).unwrap().to_string();
        assert_eq!(
            parse(&format!("={printed}")).unwrap(),
            parse(f).unwrap(),
            "{f}"
        );
    }
    assert_eq!(parse("=SUM($C:A)").unwrap().to_string(), "SUM(A:$C)");
    // Copying moves only the relative end.
    let moved = engine_formula::offset_relative(&parse("=SUM($A:B)").unwrap(), 0, 2);
    assert_eq!(moved.to_string(), "SUM($A:D)");
}

#[test]
fn r1c1_display_and_entry() {
    use engine_formula::r1c1::parse_r1c1;
    let ast = parse("=SUM(A1:A3)*$B$2+C:C").unwrap();
    // As seen from D4 (row 3, col 3).
    assert_eq!(ast.to_r1c1(3, 3), "SUM(R[-3]C[-3]:R[-1]C[-3])*R2C2+C[-1]");
    assert_eq!(
        parse_r1c1("=SUM(R[-3]C[-3]:R[-1]C[-3])*R2C2+C[-1]", 3, 3).unwrap(),
        ast
    );
}
