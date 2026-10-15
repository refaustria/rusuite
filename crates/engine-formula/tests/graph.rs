//! Integration tests for the dependency graph (`engine_formula::graph`).

use std::time::Instant;

use engine_formula::ast::{CellRef, Expr, RangeKind, Reference};
use engine_formula::graph::{
    CellCoord, Cycle, DependencyGraph, Precedent, RangeRef, SheetId, SheetResolver,
};
use engine_formula::parse;

const S1: SheetId = SheetId(0);
const S2: SheetId = SheetId(1);

struct Book;
impl SheetResolver for Book {
    fn sheet_id(&self, name: &str) -> Option<SheetId> {
        match name.to_ascii_lowercase().as_str() {
            "sheet1" => Some(S1),
            "sheet2" => Some(S2),
            _ => None,
        }
    }
}

/// `"A1"` on sheet 1, `"Sheet2!A1"` on sheet 2.
fn c(a1: &str) -> CellCoord {
    let (sheet, a1) = match a1.split_once('!') {
        Some((s, rest)) => (Book.sheet_id(s).unwrap(), rest),
        None => (S1, a1),
    };
    let r = CellRef::parse(a1).unwrap();
    CellCoord::new(sheet, r.row, r.col)
}

fn cells(list: &[&str]) -> Vec<CellCoord> {
    list.iter().map(|s| c(s)).collect()
}

fn set(g: &mut DependencyGraph, cell: &str, formula: &str) {
    let cell = c(cell);
    g.set_formula(cell, &parse(formula).unwrap(), &Book, cell.sheet);
}

fn order(g: &DependencyGraph, changed: &[&str]) -> Vec<CellCoord> {
    g.recalc_order(&cells(changed)).unwrap()
}

#[test]
fn chain() {
    let mut g = DependencyGraph::new();
    set(&mut g, "A3", "=A2");
    set(&mut g, "A2", "=A1");
    assert_eq!(order(&g, &["A1"]), cells(&["A2", "A3"]));
    assert_eq!(order(&g, &["A3"]), cells(&["A3"]));
    assert_eq!(order(&g, &["B1"]), vec![]);
    assert_eq!(order(&g, &["A2"]), cells(&["A2", "A3"]));
    assert_eq!(g.direct_dependents(c("A1")), cells(&["A2"]));
    assert_eq!(g.formula_count(), 2);
    assert!(g.has_formula(c("A2")));
    assert!(!g.has_formula(c("A1")));
}

#[test]
fn diamond_is_ordered_and_deterministic() {
    let mut first = None;
    for _ in 0..10 {
        let mut g = DependencyGraph::new();
        set(&mut g, "D1", "=B1+C1");
        set(&mut g, "B1", "=A1");
        set(&mut g, "C1", "=A1");
        let o = order(&g, &["A1"]);
        assert_eq!(o.len(), 3);
        let pos = |x: &str| o.iter().position(|&y| y == c(x)).unwrap();
        assert!(pos("B1") < pos("D1"));
        assert!(pos("C1") < pos("D1"));
        assert_eq!(g.full_order().unwrap(), o);
        match &first {
            None => first = Some(o),
            Some(f) => assert_eq!(f, &o),
        }
    }
    assert_eq!(first.unwrap(), cells(&["B1", "C1", "D1"]));
}

#[test]
fn ranges_and_whole_columns() {
    let mut g = DependencyGraph::new();
    set(&mut g, "B1", "=SUM(A1:A100)");
    assert_eq!(order(&g, &["A50"]), cells(&["B1"]));
    assert_eq!(order(&g, &["A100"]), cells(&["B1"]));
    assert_eq!(order(&g, &["A101"]), vec![]);
    assert_eq!(order(&g, &["C50"]), vec![]);

    set(&mut g, "B2", "=SUM(A:A)");
    assert_eq!(order(&g, &["A1048575"]), cells(&["B2"]));
    assert_eq!(order(&g, &["A1048576"]), cells(&["B2"]));
    assert_eq!(
        g.precedents(c("B2")).collect::<Vec<_>>(),
        vec![&Precedent::Range(RangeRef::new(S1, 0, 0, 1_048_575, 0))]
    );

    set(&mut g, "C1", "=SUM(3:4)");
    assert_eq!(order(&g, &["XFD4"]), cells(&["C1"]));
    assert_eq!(order(&g, &["A3"]), cells(&["B1", "C1", "B2"]));
    assert_eq!(order(&g, &["A5"]), cells(&["B1", "B2"]));
}

#[test]
fn cross_sheet_and_unresolved() {
    let mut g = DependencyGraph::new();
    set(&mut g, "A1", "=Sheet2!A1*2");
    set(&mut g, "Sheet2!B1", "=Sheet1!A1+A1");
    assert_eq!(
        g.direct_dependents(c("Sheet2!A1")),
        cells(&["A1", "Sheet2!B1"])
    );
    assert_eq!(order(&g, &["Sheet2!A1"]), cells(&["A1", "Sheet2!B1"]));
    assert_eq!(order(&g, &["A1"]), cells(&["A1", "Sheet2!B1"]));

    set(&mut g, "C1", "=Missing!A1+B5");
    assert_eq!(
        g.precedents(c("C1")).collect::<Vec<_>>(),
        vec![
            &Precedent::Unresolved("Missing".into()),
            &Precedent::Cell(c("B5"))
        ]
    );
    // The unresolved reference does not create an edge to A1 on any sheet.
    assert_eq!(order(&g, &["Sheet2!A1"]), cells(&["A1", "Sheet2!B1"]));
    assert_eq!(order(&g, &["B5"]), cells(&["C1"]));
    assert_eq!(g.full_order().unwrap().len(), 3);
}

#[test]
fn replacing_formula_drops_old_edges() {
    let mut g = DependencyGraph::new();
    set(&mut g, "A1", "=B1");
    set(&mut g, "A1", "=C1");
    assert_eq!(order(&g, &["B1"]), vec![]);
    assert_eq!(order(&g, &["C1"]), cells(&["A1"]));
    assert_eq!(g.formula_count(), 1);

    set(&mut g, "A1", "=SUM(D1:D10)");
    set(&mut g, "A1", "=E1");
    assert_eq!(order(&g, &["D5"]), vec![]);
    assert_eq!(order(&g, &["C1"]), vec![]);
    assert_eq!(order(&g, &["E1"]), cells(&["A1"]));
}

#[test]
fn remove_formula() {
    let mut g = DependencyGraph::new();
    set(&mut g, "A1", "=B1+SUM(C:C)");
    set(&mut g, "A2", "=A1");
    g.remove_formula(c("A1"));
    assert!(!g.has_formula(c("A1")));
    assert_eq!(g.precedents(c("A1")).count(), 0);
    assert_eq!(order(&g, &["B1"]), vec![]);
    assert_eq!(order(&g, &["C7"]), vec![]);
    // A2 still depends on the (now constant) A1.
    assert_eq!(order(&g, &["A1"]), cells(&["A2"]));
    g.remove_formula(c("A2"));
    g.remove_formula(c("A2"));
    assert_eq!(order(&g, &["A1"]), vec![]);
    assert_eq!(g.formula_count(), 0);
    assert_eq!(g.full_order().unwrap(), vec![]);
}

#[test]
fn self_reference_cycle() {
    let mut g = DependencyGraph::new();
    set(&mut g, "A1", "=A1+1");
    let cycle = Cycle {
        cells: cells(&["A1"]),
    };
    assert_eq!(g.recalc_order(&cells(&["A1"])), Err(cycle.clone()));
    assert_eq!(g.full_order(), Err(cycle));
}

#[test]
fn two_cycle() {
    let mut g = DependencyGraph::new();
    set(&mut g, "B1", "=A1");
    set(&mut g, "A1", "=B1");
    set(&mut g, "C1", "=A1");
    let cycle = Cycle {
        cells: cells(&["A1", "B1"]),
    };
    assert_eq!(g.recalc_order(&cells(&["B1"])), Err(cycle.clone()));
    assert_eq!(g.full_order(), Err(cycle));
}

#[test]
fn longer_cycle_is_in_reference_order() {
    let mut g = DependencyGraph::new();
    // A1 -> C1 -> B1 -> A1 (each references the next).
    set(&mut g, "A1", "=C1");
    set(&mut g, "C1", "=B1");
    set(&mut g, "B1", "=A1");
    let err = g.full_order().unwrap_err();
    assert_eq!(err.cells, cells(&["A1", "C1", "B1"]));
    assert!(err.to_string().contains("3 cell(s)"));
}

#[test]
fn cycle_through_range() {
    let mut g = DependencyGraph::new();
    set(&mut g, "A1", "=SUM(A1:A3)");
    set(&mut g, "B1", "=1");
    assert_eq!(
        g.recalc_order(&cells(&["A2"])),
        Err(Cycle {
            cells: cells(&["A1"])
        })
    );
    // An unrelated change still recalculates.
    assert_eq!(order(&g, &["B1"]), cells(&["B1"]));
    assert_eq!(order(&g, &["Z9"]), vec![]);
    assert!(g.full_order().is_err());

    let mut g = DependencyGraph::new();
    set(&mut g, "A5", "=SUM(B1:B10)");
    set(&mut g, "B3", "=A5*2");
    assert_eq!(g.full_order().unwrap_err().cells, cells(&["B3", "A5"]));
}

#[test]
fn unrelated_cycle_does_not_block_recalc() {
    let mut g = DependencyGraph::new();
    set(&mut g, "X1", "=Y1");
    set(&mut g, "Y1", "=X1");
    set(&mut g, "B1", "=A1");
    set(&mut g, "C1", "=B1*2");
    assert_eq!(order(&g, &["A1"]), cells(&["B1", "C1"]));
    assert_eq!(g.full_order().unwrap_err().cells, cells(&["X1", "Y1"]));
    // Downstream of a cycle is affected by it.
    set(&mut g, "Z1", "=Y1");
    assert!(g.recalc_order(&cells(&["X1"])).is_err());
}

#[test]
fn scale_100k_chain() {
    const N: u32 = 100_000;
    let start = Instant::now();
    let mut g = DependencyGraph::new();
    let first = CellCoord::new(S1, 0, 0);
    g.set_formula(first, &Expr::Number(1.0), &Book, S1);
    for row in 1..N {
        let expr = Expr::Reference(Reference {
            sheet: None,
            kind: RangeKind::Cell(CellRef::new(0, row - 1)),
        });
        g.set_formula(CellCoord::new(S1, row, 0), &expr, &Book, S1);
    }
    let built = start.elapsed();
    let o = g.recalc_order(&[first]).unwrap();
    assert_eq!(o.len(), N as usize);
    assert!(o
        .iter()
        .enumerate()
        .all(|(i, c)| c.row == i as u32 && c.col == 0));
    let total = start.elapsed();
    eprintln!("scale_100k_chain: build {built:?}, total {total:?}");
    assert!(total.as_secs() < 10, "took {total:?}");
}
