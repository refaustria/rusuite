//! P8-6: dynamic arrays in the document core – patches carry the spilled
//! cells with their anchor, edits and undo keep spills consistent.

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost, CalcPatch, CellView, Rect};
use model_sheet::{CellCoord, SheetId};

fn host() -> CalcHost {
    Host::new(CalcDocument::new())
}

fn set(h: &mut CalcHost, row: u32, col: u32, input: &str) -> CalcPatch {
    h.apply(C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    })
    .unwrap()
    .patch
}

fn view(h: &CalcHost, row: u32, col: u32) -> CellView {
    h.doc().cell_view(CellCoord::new(SheetId(0), row, col))
}

/// `(row, col, display)` of the patched cells of sheet 0.
fn patched(p: &CalcPatch) -> Vec<(u32, u32, String)> {
    p.cells
        .iter()
        .filter(|g| g.sheet == 0)
        .flat_map(|g| g.cells.iter())
        .map(|c| (c.row, c.col, c.display.clone()))
        .collect()
}

fn snapshot(h: &CalcHost) -> Vec<CellView> {
    h.doc().snapshot(0, 0, 0, 20, 10).unwrap().cells
}

#[test]
fn patches_carry_spilled_cells() {
    let mut h = host();
    let p = set(&mut h, 0, 0, "=SEQUENCE(3)");
    assert_eq!(
        patched(&p),
        [
            (0, 0, "1".to_string()),
            (1, 0, "2".to_string()),
            (2, 0, "3".to_string())
        ]
    );
    let anchor = view(&h, 0, 0);
    assert_eq!(
        anchor.spill,
        Some(Rect {
            r0: 0,
            c0: 0,
            r1: 2,
            c1: 0
        })
    );
    assert_eq!(anchor.spilled, None);
    let child = view(&h, 2, 0);
    assert_eq!((child.input.as_str(), child.spilled), ("", Some((0, 0))));
    assert_eq!(child.spill, None);
    // The region snapshot lists them too.
    assert_eq!(snapshot(&h).len(), 3);
    // JSON shape for the UI.
    let json = serde_json::to_value(&child).unwrap();
    assert_eq!(json["spilled"], serde_json::json!([0, 0]));
    assert!(serde_json::to_value(view(&h, 5, 5))
        .unwrap()
        .get("spilled")
        .is_none());

    // An obstacle: the anchor shows #SPILL!, keeps its intended range and
    // the freed cells are patched.
    let p = set(&mut h, 1, 0, "x");
    assert_eq!(
        patched(&p),
        [
            (0, 0, "#SPILL!".to_string()),
            (1, 0, "x".to_string()),
            (2, 0, String::new())
        ]
    );
    assert_eq!(view(&h, 0, 0).spill.map(|r| r.r1), Some(2));
    // Undo removes the obstacle and the spill comes back.
    let p = h.undo().unwrap().unwrap().patch;
    assert_eq!(
        patched(&p),
        [
            (0, 0, "1".to_string()),
            (1, 0, "2".to_string()),
            (2, 0, "3".to_string())
        ]
    );
    assert_eq!(view(&h, 1, 0).spilled, Some((0, 0)));
}

#[test]
fn clearing_and_undo_are_identities() {
    let mut h = host();
    set(&mut h, 0, 3, "4");
    set(&mut h, 0, 0, "=SEQUENCE(D1,2)");
    set(&mut h, 0, 4, "=SUM(A1#)");
    let before = snapshot(&h);
    assert_eq!(view(&h, 0, 4).display, "36");

    // Clearing the whole spill range clears the anchor only.
    let p = h
        .apply(C::ClearRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 1,
        })
        .unwrap()
        .patch;
    assert_eq!(patched(&p).len(), 9, "{:?}", patched(&p));
    assert_eq!(view(&h, 3, 1).display, "");
    h.undo().unwrap();
    assert_eq!(snapshot(&h), before);
    h.redo().unwrap();
    h.undo().unwrap();
    assert_eq!(snapshot(&h), before);

    // Clearing a spilled cell alone is a no-op.
    let p = h
        .apply(C::ClearRange {
            sheet: 0,
            r0: 2,
            c0: 1,
            r1: 2,
            c1: 1,
        })
        .unwrap()
        .patch;
    assert!(patched(&p).is_empty());
    assert_eq!(snapshot(&h), before);

    // Resizing through the input cell, then undo.
    let p = set(&mut h, 0, 3, "2");
    assert!(patched(&p).contains(&(3, 1, String::new())));
    assert_eq!(view(&h, 0, 4).display, "10");
    h.undo().unwrap();
    assert_eq!(snapshot(&h), before);

    // Structural edits move the spill; undo restores it.
    h.apply(C::InsertRows {
        sheet: 0,
        at: 1,
        count: 2,
    })
    .unwrap();
    // The anchor stays in row 1: the spill is rebuilt from it.
    assert_eq!(view(&h, 3, 1).display, "8");
    assert_eq!(view(&h, 3, 1).spilled, Some((0, 0)));
    h.undo().unwrap();
    assert_eq!(snapshot(&h), before);
}
