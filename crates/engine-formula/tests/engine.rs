//! Integration tests for the `Engine` façade.

use std::time::Instant;

use engine_formula::ast::CellRef;
use engine_formula::{
    parse, CellContent, CellCoord, Engine, EngineError, ErrorKind, SheetId, Value,
};

const S1: SheetId = SheetId(0);

/// `"A1"` on `sheet`.
fn at(sheet: SheetId, a1: &str) -> CellCoord {
    let r = CellRef::parse(a1).unwrap();
    CellCoord::new(sheet, r.row, r.col)
}

/// `"A1"` on Sheet1.
fn c(a1: &str) -> CellCoord {
    at(S1, a1)
}

fn cells(list: &[&str]) -> Vec<CellCoord> {
    list.iter().map(|s| c(s)).collect()
}

fn set(e: &mut Engine, cell: CellCoord, input: &str) -> Vec<CellCoord> {
    e.set_input(cell, input).unwrap().changed
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn t(s: &str) -> Value {
    Value::Text(s.into())
}

#[test]
fn incremental_chain() {
    let mut e = Engine::new();
    set(&mut e, c("A1"), "1");
    set(&mut e, c("A2"), "=A1*2");
    set(&mut e, c("A3"), "=A2+A1");
    assert_eq!(e.value(c("A3")), n(3.0));
    assert_eq!(set(&mut e, c("A1"), "10"), cells(&["A2", "A3"]));
    assert_eq!(e.value(c("A3")), n(30.0));
    assert_eq!(e.formula_text(c("A2")), Some("=A1*2"));

    assert_eq!(set(&mut e, c("A2"), "5"), cells(&["A3"]));
    assert_eq!(e.value(c("A3")), n(15.0));
    assert_eq!(e.formula_text(c("A2")), None);
    assert_eq!(set(&mut e, c("A1"), "7"), cells(&["A3"]));
    assert_eq!(e.value(c("A2")), n(5.0));
    assert_eq!(e.value(c("A3")), n(12.0));

    // Re-setting an identical value reports no change.
    assert_eq!(set(&mut e, c("A1"), "7"), vec![]);
    // Clearing a precedent recalculates; clearing a formula removes it.
    assert_eq!(e.clear(c("A1")).unwrap().changed, cells(&["A3"]));
    assert_eq!(e.value(c("A3")), n(5.0));
    e.clear(c("A3")).unwrap();
    assert_eq!(e.value(c("A3")), Value::Empty);
    assert_eq!(e.content(c("A3")), &CellContent::Empty);
}

#[test]
fn input_typing_rules() {
    let mut e = Engine::new();
    let a1 = c("A1");
    set(&mut e, a1, "42");
    assert!(matches!(e.set_input(a1, "=1+"), Err(EngineError::Parse(_))));
    assert_eq!(e.content(a1), &CellContent::Value(n(42.0)));
    assert_eq!(e.value(a1), n(42.0));

    for (input, want) in [
        ("TRUE", Value::Bool(true)),
        ("true", Value::Bool(true)),
        ("False", Value::Bool(false)),
        ("  12 ", t("  12 ")),
        ("12", n(12.0)),
        ("1e3", n(1000.0)),
        ("#N/A", Value::Error(ErrorKind::NA)),
        ("'0123", t("0123")),
        ("abc", t("abc")),
        ("", Value::Empty),
    ] {
        set(&mut e, a1, input);
        assert_eq!(e.value(a1), want, "{input:?}");
    }
    assert_eq!(e.content(a1), &CellContent::Empty);

    set(&mut e, a1, "=1+1");
    assert_eq!(e.value(a1), n(2.0));
    assert!(matches!(e.content(a1), CellContent::Formula { text, .. } if text == "=1+1"));
}

#[test]
fn set_content_with_parsed_formula() {
    let mut e = Engine::new();
    e.set_content(c("A1"), CellContent::Value(n(4.0))).unwrap();
    let ast = parse("=A1^2").unwrap();
    let r = e
        .set_content(
            c("B1"),
            CellContent::Formula {
                text: "=A1^2".into(),
                ast,
            },
        )
        .unwrap();
    assert_eq!(r.changed, cells(&["B1"]));
    assert_eq!(e.value(c("B1")), n(16.0));
}

#[test]
fn cross_sheet_rename_and_late_sheets() {
    let mut e = Engine::new();
    let data = e.add_sheet("Data").unwrap();
    assert_eq!(
        e.add_sheet("DATA"),
        Err(EngineError::DuplicateSheet("DATA".into()))
    );
    set(&mut e, c("A1"), "=Data!A1*2");
    assert_eq!(set(&mut e, at(data, "A1"), "3"), cells(&["A1"]));
    assert_eq!(e.value(c("A1")), n(6.0));

    e.rename_sheet(data, "Facts").unwrap();
    assert_eq!(e.sheet_id("facts"), Some(data));
    assert_eq!(e.sheet_id("Data"), None);
    assert_eq!(e.sheet_name(data), Some("Facts"));
    assert_eq!(set(&mut e, at(data, "A1"), "4"), cells(&["A1"]));
    assert_eq!(e.value(c("A1")), n(8.0));
    // The stored text is not rewritten (yet).
    assert_eq!(e.formula_text(c("A1")), Some("=Data!A1*2"));
    assert_eq!(
        e.rename_sheet(data, "sheet1"),
        Err(EngineError::DuplicateSheet("sheet1".into()))
    );

    // A sheet that does not exist yet.
    set(&mut e, c("B1"), "=Later!A1+1");
    assert_eq!(e.value(c("B1")), Value::Error(ErrorKind::Ref));
    let later = e.add_sheet("Later").unwrap();
    assert_eq!(e.value(c("B1")), n(1.0));
    assert_eq!(set(&mut e, at(later, "A1"), "9"), cells(&["B1"]));
    assert_eq!(e.value(c("B1")), n(10.0));

    // Renaming a sheet to a name formulas were waiting for.
    set(&mut e, c("C1"), "=Renamed!A1&\"!\"");
    assert_eq!(e.value(c("C1")), Value::Error(ErrorKind::Ref));
    e.rename_sheet(later, "Renamed").unwrap();
    assert_eq!(e.value(c("C1")), t("9!"));
    assert_eq!(set(&mut e, at(later, "A1"), "x"), cells(&["B1", "C1"]));
    assert_eq!(e.value(c("C1")), t("x!"));

    let names: Vec<&str> = e.sheets().map(|(_, n)| n).collect();
    assert_eq!(names, ["Sheet1", "Facts", "Renamed"]);
}

#[test]
fn cycles() {
    let mut e = Engine::new();
    assert_eq!(e.set_input(c("A1"), "=B1").unwrap().cycle, None);
    let r = e.set_input(c("B1"), "=A1").unwrap();
    assert_eq!(r.cycle.unwrap().cells, cells(&["A1", "B1"]));
    assert_eq!(e.value(c("A1")), Value::Error(ErrorKind::Num));
    assert_eq!(e.value(c("B1")), Value::Error(ErrorKind::Num));

    let r = e.set_input(c("C1"), "=1+1").unwrap();
    assert_eq!(r.cycle, None);
    assert_eq!(e.value(c("C1")), n(2.0));

    // A dependent of the cycle is still computed and sees the error.
    let r = e.set_input(c("D1"), "=ISERROR(A1)").unwrap();
    assert_eq!(e.value(c("D1")), Value::Bool(true));
    assert_eq!(r.cycle, None);

    let r = e.set_input(c("B1"), "1").unwrap();
    assert_eq!(r.cycle, None);
    assert_eq!(e.value(c("A1")), n(1.0));
    assert_eq!(e.value(c("D1")), Value::Bool(false));
    assert_eq!(r.changed, cells(&["A1", "D1"]));

    let r = e.set_input(c("E1"), "=E1+1").unwrap();
    assert!(r.cycle.is_some());
    assert_eq!(e.value(c("E1")), Value::Error(ErrorKind::Num));
}

#[test]
fn range_dependency() {
    let mut e = Engine::new();
    set(&mut e, c("B1"), "=SUM(A1:A100)");
    assert_eq!(e.value(c("B1")), n(0.0));
    assert_eq!(set(&mut e, c("A50"), "5"), cells(&["B1"]));
    assert_eq!(e.value(c("B1")), n(5.0));
    assert_eq!(set(&mut e, c("A101"), "5"), vec![]);
    // Whole-column reference uses the engine's used range.
    set(&mut e, c("C1"), "=SUM(A:A)");
    assert_eq!(e.value(c("C1")), n(10.0));
    assert_eq!(set(&mut e, c("A5000"), "1"), cells(&["C1"]));
    assert_eq!(e.value(c("C1")), n(11.0));
}

#[test]
fn volatile_functions() {
    let mut e = Engine::new();
    e.set_now(|| 45306.75);
    set(&mut e, c("A1"), "=TODAY()");
    assert_eq!(e.value(c("A1")), n(45306.0));
    e.set_now(|| 45307.5);
    let r = e.set_input(c("Z99"), "unrelated").unwrap();
    assert_eq!(r.changed, cells(&["A1"]));
    assert_eq!(e.value(c("A1")), n(45307.0));
    // No change of the clock: nothing to report.
    assert_eq!(set(&mut e, c("Z99"), "again"), vec![]);
    // Once the formula no longer calls TODAY it is not volatile.
    set(&mut e, c("A1"), "=1");
    e.set_now(|| 50000.0);
    assert_eq!(set(&mut e, c("Z99"), "x"), vec![]);
}

/// A deterministic mix of constants and formulas on two sheets, written
/// in a scrambled order.
fn load(e: &mut Engine) {
    let other = e.add_sheet("Other").unwrap();
    for i in 0..200u32 {
        e.set_content(
            CellCoord::new(other, i, 0),
            CellContent::Value(n(f64::from(i % 17))),
        )
        .unwrap();
    }
    for k in 0..1000u32 {
        let i = (k * 389) % 1000; // permutation of 0..1000
        let formula = match i % 4 {
            0 => format!("=Other!A{}*2", i % 200 + 1),
            1 => format!("=B{}+1", i), // the previous row's formula
            2 => format!("=SUM(B{}:B{})", i.saturating_sub(5) + 1, i),
            _ => format!("=IF(B{}>10,\"big\",B{})", i, i),
        };
        let ast = parse(&formula).unwrap();
        e.set_content(
            CellCoord::new(S1, i, 1),
            CellContent::Formula { text: formula, ast },
        )
        .unwrap();
    }
}

#[test]
fn recalc_all_matches_incremental() {
    let mut incremental = Engine::new();
    load(&mut incremental);

    let mut batched = Engine::new();
    batched.begin_batch();
    load(&mut batched);
    assert_eq!(batched.value(c("B2")), Value::Empty); // not computed yet
    let r = batched.recalc_all();
    assert_eq!(r.changed.len(), 1000);
    assert_eq!(batched.end_batch().changed, vec![]);

    for row in 0..1000 {
        let cell = CellCoord::new(S1, row, 1);
        assert_eq!(batched.value(cell), incremental.value(cell), "row {row}");
    }
    assert_eq!(incremental.recalc_all().changed, vec![]);

    // end_batch alone also brings a batch-loaded engine up to date.
    let mut via_end = Engine::new();
    via_end.begin_batch();
    load(&mut via_end);
    assert_eq!(via_end.end_batch().changed.len(), 1000);
    for row in 0..1000 {
        let cell = CellCoord::new(S1, row, 1);
        assert_eq!(via_end.value(cell), incremental.value(cell), "row {row}");
    }
}

#[test]
fn long_chain_scales() {
    const N: u32 = 50_000;
    let mut e = Engine::new();
    let start = Instant::now();
    set(&mut e, c("A1"), "1");
    for row in 1..N {
        e.set_input(CellCoord::new(S1, row, 0), &format!("=A{}+1", row))
            .unwrap();
    }
    let built = start.elapsed();
    let t = Instant::now();
    let r = e.set_input(c("A1"), "2").unwrap();
    let changed = t.elapsed();
    eprintln!("50k chain: build {built:?}, head change {changed:?}");
    assert_eq!(r.changed.len(), (N - 1) as usize);
    assert_eq!(e.value(CellCoord::new(S1, N - 1, 0)), n(f64::from(N + 1)));
    assert!(start.elapsed().as_secs() < 10, "took {:?}", start.elapsed());
}

fn text(e: &Engine, cell: CellCoord) -> Option<&str> {
    e.formula_text(cell)
}

#[test]
fn insert_and_delete_rows() {
    let mut e = Engine::new();
    let s2 = e.add_sheet("Sheet2").unwrap();
    set(&mut e, c("A1"), "1");
    set(&mut e, c("A2"), "=A1*2");
    set(&mut e, c("A3"), "=SUM(A1:A2)");
    set(&mut e, at(s2, "B1"), "=Sheet1!A3+Sheet1!A1");
    set(&mut e, at(s2, "B2"), "=A3"); // Sheet2!A3: must not move
    assert_eq!(e.value(at(s2, "B1")), n(4.0));

    let r = e.insert_rows(S1, 1, 1).unwrap();
    assert_eq!(r.cycle, None);
    assert_eq!(e.value(c("A1")), n(1.0));
    assert_eq!(e.content(c("A2")), &CellContent::Empty);
    assert_eq!(text(&e, c("A3")), Some("=A1*2"));
    assert_eq!(e.value(c("A3")), n(2.0));
    assert_eq!(text(&e, c("A4")), Some("=SUM(A1:A3)"));
    assert_eq!(e.value(c("A4")), n(3.0));
    assert_eq!(text(&e, at(s2, "B1")), Some("=Sheet1!A4+Sheet1!A1"));
    assert_eq!(text(&e, at(s2, "B2")), Some("=A3"));
    assert_eq!(e.value(at(s2, "B1")), n(4.0));
    assert_eq!(e.used_range(S1), Some((3, 0)));
    // Vacated + new positions on Sheet1, the rewritten formula on Sheet2.
    let mut want = cells(&["A2", "A3", "A4"]);
    want.push(at(s2, "B1"));
    assert_eq!(r.changed, want);

    // cells() yields the moved contents.
    let mut listed: Vec<(CellCoord, String)> = e
        .cells(S1)
        .map(|(cell, content)| {
            let shown = match content {
                CellContent::Formula { text, .. } => text.clone(),
                CellContent::Value(v) => format!("{v:?}"),
                CellContent::Empty => unreachable!("cells() skips empty cells"),
            };
            (cell, shown)
        })
        .collect();
    listed.sort();
    assert_eq!(
        listed,
        vec![
            (c("A1"), format!("{:?}", n(1.0))),
            (c("A3"), "=A1*2".to_string()),
            (c("A4"), "=SUM(A1:A3)".to_string()),
        ]
    );
    assert_eq!(e.cells(SheetId(9)).count(), 0);

    // Graph consistency: the moved formulas follow their precedents.
    let mut want = cells(&["A3", "A4"]);
    want.push(at(s2, "B1"));
    assert_eq!(set(&mut e, c("A1"), "5"), want);
    assert_eq!(e.value(c("A4")), n(15.0));
    assert_eq!(e.value(at(s2, "B1")), n(20.0));
    // The new empty row is inside the SUM range.
    assert_eq!(set(&mut e, c("A2"), "100"), vec![c("A4"), at(s2, "B1")]);
    assert_eq!(e.value(at(s2, "B1")), n(120.0));
    e.clear(c("A2")).unwrap();

    // Deleting row 1 turns references to A1 into #REF!.
    let r = e.delete_rows(S1, 0, 1).unwrap();
    assert_eq!(e.content(c("A1")), &CellContent::Empty);
    assert_eq!(text(&e, c("A2")), Some("=#REF!*2"));
    assert_eq!(e.value(c("A2")), Value::Error(ErrorKind::Ref));
    // SUM(A1:A3) lost its first row.
    assert_eq!(text(&e, c("A3")), Some("=SUM(A1:A2)"));
    assert_eq!(e.value(c("A3")), Value::Error(ErrorKind::Ref));
    assert_eq!(e.content(c("A4")), &CellContent::Empty);
    assert_eq!(e.used_range(S1), Some((2, 0)));
    let mut want = cells(&["A1", "A2", "A3", "A4"]);
    want.push(at(s2, "B1"));
    assert_eq!(r.changed, want);
    assert_eq!(
        text(&e, at(s2, "B1")),
        Some("=Sheet1!A3+#REF!"),
        "the cross-sheet formula follows the move"
    );
    assert_eq!(e.value(at(s2, "B1")), Value::Error(ErrorKind::Ref));
}

#[test]
fn delete_rows_moves_sum_and_values() {
    let mut e = Engine::new();
    for (cell, input) in [
        ("A1", "1"),
        ("A2", "2"),
        ("A3", "3"),
        ("A4", "4"),
        ("A5", "=SUM(A1:A4)"),
        ("B5", "=A5*10"),
    ] {
        set(&mut e, c(cell), input);
    }
    assert_eq!(e.value(c("B5")), n(100.0));
    let r = e.delete_rows(S1, 1, 2).unwrap();
    assert_eq!(text(&e, c("A3")), Some("=SUM(A1:A2)"));
    assert_eq!(e.value(c("A3")), n(5.0));
    assert_eq!(text(&e, c("B3")), Some("=A3*10"));
    assert_eq!(e.value(c("B3")), n(50.0));
    assert_eq!(e.value(c("A2")), n(4.0));
    assert_eq!(e.content(c("A5")), &CellContent::Empty);
    assert_eq!(e.content(c("B5")), &CellContent::Empty);
    assert_eq!(
        r.changed,
        cells(&["A2", "A3", "B3", "A4", "A5", "B5"])
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
    );
    assert_eq!(set(&mut e, c("A1"), "11"), cells(&["A3", "B3"]));
    assert_eq!(e.value(c("B3")), n(150.0));
}

#[test]
fn insert_and_delete_cols() {
    let mut e = Engine::new();
    set(&mut e, c("A1"), "2");
    set(&mut e, c("B1"), "=A1+1");
    set(&mut e, c("C1"), "=$B$1*A1");
    e.insert_cols(S1, 1, 2).unwrap();
    assert_eq!(text(&e, c("D1")), Some("=A1+1"));
    assert_eq!(text(&e, c("E1")), Some("=$D$1*A1"));
    assert_eq!(e.value(c("E1")), n(6.0));
    assert_eq!(e.used_range(S1), Some((0, 4)));
    e.delete_cols(S1, 0, 1).unwrap();
    assert_eq!(text(&e, c("C1")), Some("=#REF!+1"));
    assert_eq!(text(&e, c("D1")), Some("=$C$1*#REF!"));
    assert_eq!(e.value(c("D1")), Value::Error(ErrorKind::Ref));
    assert_eq!(e.content(c("A1")), &CellContent::Empty);
}

#[test]
fn structural_errors_and_batches() {
    let mut e = Engine::new();
    assert_eq!(
        e.insert_rows(SheetId(5), 0, 1),
        Err(EngineError::UnknownSheet(SheetId(5)))
    );
    assert_eq!(
        e.insert_rows(S1, 1_048_576, 1),
        Err(EngineError::InvalidCoord)
    );
    assert_eq!(
        e.delete_rows(S1, 1_048_575, 2),
        Err(EngineError::InvalidCoord)
    );
    assert_eq!(e.delete_cols(S1, 16_383, 1), Ok(Default::default()));
    assert_eq!(e.insert_cols(S1, 16_384, 1), Err(EngineError::InvalidCoord));
    assert_eq!(e.insert_rows(S1, 0, 0), Ok(Default::default()));
    // Content would be pushed off the sheet.
    set(&mut e, at(S1, "A1048576"), "x");
    assert_eq!(e.insert_rows(S1, 5, 1), Err(EngineError::InvalidCoord));
    assert_eq!(e.value(at(S1, "A1048576")), t("x"));
    e.clear(at(S1, "A1048576")).unwrap();

    // Inside a batch the recalculation is deferred to end_batch.
    set(&mut e, c("A1"), "3");
    set(&mut e, c("B1"), "=A1");
    e.begin_batch();
    let r = e.insert_rows(S1, 0, 1).unwrap();
    assert_eq!(r.changed, cells(&["A1", "B1", "A2", "B2"]));
    set(&mut e, c("A2"), "4");
    assert_eq!(e.end_batch().changed, cells(&["B2"]));
    assert_eq!(e.value(c("B2")), n(4.0));
}
