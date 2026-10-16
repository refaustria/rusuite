//! Table-driven tests for reference adjustment (`adjust_references`) and
//! copy/paste offsets (`offset_relative`).

use engine_formula::{
    adjust_references, adjust_references_shift, offset_relative, parse, AdjustContext, CellShift,
    StructuralOp,
};

use StructuralOp::{DeleteCols, DeleteRows, InsertCols, InsertRows};

fn ir(at: u32, count: u32) -> StructuralOp {
    InsertRows { at, count }
}
fn dr(at: u32, count: u32) -> StructuralOp {
    DeleteRows { at, count }
}
fn ic(at: u32, count: u32) -> StructuralOp {
    InsertCols { at, count }
}
fn dc(at: u32, count: u32) -> StructuralOp {
    DeleteCols { at, count }
}

/// Adjusts `formula` (living on `host`) for `op` on `target`; returns the
/// printed result with a leading `=`.
fn adjust(formula: &str, host: &str, target: &str, op: StructuralOp) -> String {
    let ast = parse(formula).unwrap();
    let ctx = AdjustContext {
        host_sheet: host,
        target_sheet: target,
        op,
    };
    format!("={}", adjust_references(&ast, &ctx))
}

#[test]
fn adjust_on_same_sheet() {
    // (formula, op, expected); host and target are Sheet1.
    let cases: &[(&str, StructuralOp, &str)] = &[
        // Insert rows: single cells.
        ("=A5", ir(1, 2), "=A7"),
        ("=A5", ir(4, 2), "=A7"),
        ("=A5", ir(5, 2), "=A5"),
        ("=A5", ir(10, 2), "=A5"),
        ("=$A$5", ir(0, 1), "=$A$6"),
        ("=A1048576", ir(0, 1), "=#REF!"),
        // Insert rows: areas.
        ("=SUM(A2:A5)", ir(3, 2), "=SUM(A2:A7)"),
        ("=SUM(A2:A5)", ir(1, 2), "=SUM(A4:A7)"),
        ("=SUM(A2:A5)", ir(4, 2), "=SUM(A2:A7)"),
        ("=SUM(A2:A5)", ir(5, 2), "=SUM(A2:A5)"),
        ("=SUM($A$2:B$5)", ir(0, 1), "=SUM($A$3:B$6)"),
        ("=SUM(A1:A1048576)", ir(3, 1), "=SUM(A1:A1048576)"),
        // Insert rows: whole columns / rows.
        ("=SUM(A:A)", ir(0, 5), "=SUM(A:A)"),
        ("=SUM(1:1)", ir(0, 1), "=SUM(2:2)"),
        ("=SUM(2:4)", ir(2, 1), "=SUM(2:5)"),
        ("=SUM($2:$4)", ir(9, 1), "=SUM($2:$4)"),
        // Delete rows: single cells.
        ("=A3", dr(1, 3), "=#REF!"),
        ("=A10", dr(1, 3), "=A7"),
        ("=A1", dr(1, 3), "=A1"),
        ("=A5+A2", dr(1, 3), "=A2+#REF!"),
        // Delete rows: areas.
        ("=SUM(A2:A10)", dr(3, 3), "=SUM(A2:A7)"),
        ("=SUM(A2:A10)", dr(1, 10), "=SUM(#REF!)"),
        ("=SUM(A2:A10)", dr(0, 3), "=SUM(A1:A7)"),
        ("=SUM(A2:A10)", dr(8, 5), "=SUM(A2:A8)"),
        ("=SUM(A2:A10)", dr(10, 5), "=SUM(A2:A10)"),
        ("=SUM(A2:A10)", dr(0, 1), "=SUM(A1:A9)"),
        // Delete rows: whole rows / columns.
        ("=SUM(3:5)", dr(2, 3), "=SUM(#REF!)"),
        ("=SUM(3:5)", dr(0, 1), "=SUM(2:4)"),
        ("=SUM(3:5)", dr(3, 1), "=SUM(3:4)"),
        ("=SUM(B:B)", dr(0, 100), "=SUM(B:B)"),
        // Columns mirror rows.
        ("=C1", ic(1, 1), "=D1"),
        ("=$C$1", ic(1, 1), "=$D$1"),
        ("=C1", ic(3, 1), "=C1"),
        ("=SUM(B1:D1)", ic(2, 2), "=SUM(B1:F1)"),
        ("=SUM(B1:D1)", ic(0, 2), "=SUM(D1:F1)"),
        ("=SUM(B:D)", ic(2, 1), "=SUM(B:E)"),
        ("=SUM(1:1)", ic(0, 3), "=SUM(1:1)"),
        ("=XFD1", ic(0, 1), "=#REF!"),
        ("=C1", dc(2, 1), "=#REF!"),
        ("=E1", dc(1, 2), "=C1"),
        ("=SUM(B1:F9)", dc(2, 2), "=SUM(B1:D9)"),
        ("=SUM(B1:C9)", dc(1, 2), "=SUM(#REF!)"),
        ("=SUM(C:E)", dc(0, 1), "=SUM(B:D)"),
        ("=SUM(C:E)", dc(2, 3), "=SUM(#REF!)"),
        ("=SUM(5:5)", dc(0, 1), "=SUM(5:5)"),
        // Non-reference parts are untouched.
        ("=IF(A5>1,\"A5\",{1,2})", ir(0, 1), "=IF(A6>1,\"A5\",{1,2})"),
    ];
    for &(formula, op, want) in cases {
        assert_eq!(
            adjust(formula, "Sheet1", "Sheet1", op),
            want,
            "{formula} {op:?}"
        );
    }
}

#[test]
fn adjust_respects_sheets() {
    let cases: &[(&str, &str, &str, StructuralOp, &str)] = &[
        // (formula, host, target, op, expected)
        ("=Sheet2!A5", "Sheet1", "Sheet1", ir(0, 2), "=Sheet2!A5"),
        ("=Sheet2!A5", "Sheet1", "Sheet2", ir(0, 2), "=Sheet2!A7"),
        ("=sheet2!A5", "Sheet1", "SHEET2", ir(0, 2), "=sheet2!A7"),
        ("=A5", "Sheet2", "Sheet2", ir(0, 2), "=A7"),
        ("=A5", "Sheet2", "Sheet1", ir(0, 2), "=A5"),
        ("=A5+Sheet1!A5", "Sheet2", "Sheet1", dr(4, 1), "=A5+#REF!"),
        (
            "='My Data'!B2:C3",
            "Sheet1",
            "my data",
            ic(0, 1),
            "='My Data'!C2:D3",
        ),
    ];
    for &(formula, host, target, op, want) in cases {
        assert_eq!(
            adjust(formula, host, target, op),
            want,
            "{formula} on {host}, {op:?} on {target}"
        );
    }
}

#[test]
fn adjusted_formulas_reparse() {
    for (formula, op) in [
        ("=SUM(A2:A10)*B3", dr(1, 3)),
        ("=A1:INDEX(B1:B9,3)", ir(0, 2)),
        ("=-A3%", dc(0, 1)),
    ] {
        let out = adjust(formula, "S", "S", op);
        assert!(parse(&out).is_ok(), "{formula} → {out}");
    }
}

#[test]
fn offset_for_copy_paste() {
    let cases: &[(&str, i64, i64, &str)] = &[
        ("=A1+$B$2+C$3+$D4", 2, 1, "=B3+$B$2+D$3+$D6"),
        ("=SUM(A1:B2)", 1, 1, "=SUM(B2:C3)"),
        ("=SUM($A1:B$2)", 3, 3, "=SUM($A$2:E4)"),
        ("=SUM(A:B)", 5, 1, "=SUM(B:C)"),
        ("=SUM($A:$B)", 5, 1, "=SUM($A:$B)"),
        ("=SUM(1:2)", 5, 1, "=SUM(6:7)"),
        ("=Sheet2!C3", -1, -2, "=Sheet2!A2"),
        ("=A1", -1, 0, "=#REF!"),
        ("=A1", 0, -1, "=#REF!"),
        ("=$A$1", -1, -1, "=$A$1"),
        ("=A1048576", 1, 0, "=#REF!"),
        ("=SUM(XFD1:XFD2)", 0, 1, "=SUM(#REF!)"),
        ("=SUM(A:A)", 0, -1, "=SUM(#REF!)"),
    ];
    for &(formula, d_row, d_col, want) in cases {
        let ast = parse(formula).unwrap();
        assert_eq!(
            format!("={}", offset_relative(&ast, d_row, d_col)),
            want,
            "{formula} by ({d_row}, {d_col})"
        );
    }
}

/// Like [`adjust`], restricted to the band `lo..=hi` of the other axis
/// (Insert / Delete Cells).
fn adjust_band(formula: &str, op: StructuralOp, lo: u32, hi: u32) -> String {
    let ast = parse(formula).unwrap();
    let ctx = AdjustContext {
        host_sheet: "Sheet1",
        target_sheet: "Sheet1",
        op,
    };
    format!("={}", adjust_references_shift(&ast, &ctx, Some((lo, hi))))
}

#[test]
fn adjust_for_cell_shifts() {
    // (formula, op, band, expected)
    let cases: &[(&str, StructuralOp, (u32, u32), &str)] = &[
        // Shift right in row 1 (index 0) from column B.
        ("=B1", ic(1, 1), (0, 0), "=C1"),
        ("=B2", ic(1, 1), (0, 0), "=B2"),
        ("=A1", ic(1, 1), (0, 0), "=A1"),
        ("=SUM(A1:D1)", ic(1, 1), (0, 0), "=SUM(A1:E1)"),
        ("=SUM(A1:D2)", ic(1, 1), (0, 0), "=SUM(A1:D2)"),
        ("=SUM(A1:D2)", ic(1, 1), (0, 1), "=SUM(A1:E2)"),
        ("=SUM(1:1)", ic(1, 1), (0, 0), "=SUM(1:1)"),
        ("=SUM(B:B)", ic(1, 1), (0, 0), "=SUM(B:B)"),
        ("=$B$1", ic(1, 2), (0, 0), "=$D$1"),
        // Shift down in column A from row 3 (index 2).
        ("=A5", ir(2, 1), (0, 0), "=A6"),
        ("=B5", ir(2, 1), (0, 0), "=B5"),
        ("=SUM(A1:A10)", ir(2, 1), (0, 0), "=SUM(A1:A11)"),
        ("=SUM(A1:B10)", ir(2, 1), (0, 0), "=SUM(A1:B10)"),
        // Delete left / up.
        ("=B1", dc(1, 1), (0, 0), "=#REF!"),
        ("=C1", dc(1, 1), (0, 0), "=B1"),
        ("=C2", dc(1, 1), (0, 0), "=C2"),
        ("=SUM(A1:D1)", dc(1, 1), (0, 0), "=SUM(A1:C1)"),
        ("=A3", dr(2, 1), (0, 0), "=#REF!"),
        ("=A4+B4", dr(2, 1), (0, 0), "=A3+B4"),
        ("=SUM(A3:A3)", dr(2, 1), (0, 0), "=SUM(#REF!)"),
    ];
    for &(f, op, (lo, hi), want) in cases {
        assert_eq!(
            adjust_band(f, op, lo, hi),
            want,
            "{f} {op:?} band {lo}..={hi}"
        );
    }
}

#[test]
fn cell_shift_geometry() {
    let s = CellShift::new(ic(2, 1), 3, 5);
    assert_eq!(s.map_cell(4, 2), Some((4, 3)));
    assert_eq!(s.map_cell(4, 1), Some((4, 1)));
    assert_eq!(s.map_cell(6, 2), Some((6, 2)));
    // A rectangle inside the band moves; one sticking out stays.
    assert_eq!(s.map_rect((3, 2, 5, 4)), Some((3, 3, 5, 5)));
    assert_eq!(s.map_rect((2, 2, 5, 4)), Some((2, 2, 5, 4)));
    // Blocks cut by the edit.
    assert!(s.splits((4, 6, 6, 7)), "sticks out of the band");
    assert!(s.splits((3, 1, 3, 3)), "insert inside the block");
    assert!(!s.splits((3, 6, 5, 7)), "moves as a whole");
    assert!(!s.splits((7, 0, 9, 9)), "outside the band");
    assert!(!s.splits((3, 0, 5, 1)), "before the insert");
    let d = CellShift::new(dr(2, 2), 0, 1);
    assert!(d.splits((3, 0, 4, 1)), "partly deleted");
    assert!(!d.splits((2, 0, 3, 1)), "deleted as a whole");
    assert!(!d.splits((4, 0, 5, 1)), "moves up as a whole");
    assert!(d.touches((9, 0, 9, 0)));
    assert!(!d.touches((0, 0, 1, 1)));
    assert_eq!(d.map_rect((2, 0, 3, 1)), None);
    assert_eq!(CellShift::from(ir(0, 1)).map_cell(0, 9), Some((1, 9)));
}
