//! P8-35: pivot follow-ups: Change Data Source, Show Details, subtotals
//! at the bottom, banded columns, tables as sources and the style table
//! in pivot patches.

use app_common::Host;
use calc_core::{
    CalcCommand as C, CalcDocument, CalcHost, PivotPatch, PivotSourceSpec, PivotTarget,
};
use model_sheet::pivot::{AxisField, DataField, PivotCache, PivotFields, PivotLayout};
use model_sheet::{CellCoord, SheetId, SheetSnapshot};

const SALES: [[&str; 4]; 6] = [
    ["Region", "Product", "Sales", "Units"],
    ["East", "Apple", "10", "1"],
    ["East", "Pear", "20", "2"],
    ["West", "Apple", "40", "4"],
    ["West", "Pear", "50", "5"],
    ["North", "Pear", "60", "6"],
];

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn book() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in SALES.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            h.apply(set(0, r as u32, c as u32, v)).unwrap();
        }
    }
    h
}

fn state(h: &CalcHost) -> (Vec<SheetSnapshot>, Vec<PivotCache>) {
    let snap = h.doc().workbook().to_snapshot();
    let caches = snap
        .pivot_caches
        .into_iter()
        .map(|c| PivotCache { stale: false, ..c })
        .collect();
    (snap.sheets, caches)
}

fn display(h: &CalcHost, sheet: u32, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(sheet), row, col))
        .display
}

fn pivot_at(h: &mut CalcHost, source: PivotSourceSpec, fields: PivotFields) {
    h.apply(C::CreatePivot {
        source,
        target: PivotTarget::Cell {
            sheet: 0,
            row: 0,
            col: 8,
        },
        fields,
    })
    .unwrap();
}

fn range(r1: u32) -> PivotSourceSpec {
    PivotSourceSpec::Range {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1,
        c1: 3,
    }
}

fn by_region() -> PivotFields {
    PivotFields {
        rows: vec![0.into()],
        values: vec![DataField::sum(2)],
        ..Default::default()
    }
}

fn undo_identity(h: &mut CalcHost, cmd: C) {
    let before = state(h);
    h.apply(cmd.clone())
        .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
    let after = state(h);
    h.undo().unwrap();
    assert!(state(h) == before, "undo of {cmd:?}");
    h.redo().unwrap();
    assert!(state(h) == after, "redo of {cmd:?}");
}

#[test]
fn change_data_source() {
    let mut h = book();
    // The first three data rows only.
    pivot_at(&mut h, range(3), by_region());
    assert_eq!(display(&h, 0, 3, 9), "70");
    undo_identity(
        &mut h,
        C::ChangePivotSource {
            id: 1,
            source: range(5),
        },
    );
    // East, North, West, Grand Total.
    assert_eq!(display(&h, 0, 4, 9), "180");
    let caches = h.doc().workbook().pivot_caches().len();
    assert_eq!(caches, 1, "the old cache went");
    // A source without the field: it leaves the table.
    h.apply(set(0, 0, 6, "Other")).unwrap();
    h.apply(set(0, 1, 6, "1")).unwrap();
    h.apply(C::ChangePivotSource {
        id: 1,
        source: PivotSourceSpec::Range {
            sheet: 0,
            r0: 0,
            c0: 2,
            r1: 5,
            c1: 3,
        },
    })
    .unwrap();
    let (_, t) = h.doc().workbook().pivot(1).unwrap();
    assert!(t.rows.is_empty());
    assert_eq!(t.values.len(), 1, "Sales is still there");
}

#[test]
fn tables_as_sources() {
    let mut h = book();
    h.apply(C::CreateTable {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 5,
        c1: 3,
        has_headers: true,
        style: None,
    })
    .unwrap();
    // A cell of the table: the table is the source.
    pivot_at(
        &mut h,
        PivotSourceSpec::Range {
            sheet: 0,
            r0: 2,
            c0: 1,
            r1: 2,
            c1: 1,
        },
        by_region(),
    );
    let cache = &h.doc().workbook().pivot_caches()[0];
    assert_eq!(
        cache.source,
        model_sheet::pivot::PivotSource::Table {
            name: "Table1".into()
        }
    );
    // The table grows; a refresh sees the new row.
    h.apply(set(0, 6, 0, "East")).unwrap();
    h.apply(set(0, 6, 2, "5")).unwrap();
    h.apply(C::RefreshPivot { id: Some(1) }).unwrap();
    assert_eq!(display(&h, 0, 1, 9), "35");
}

#[test]
fn show_details() {
    let mut h = book();
    pivot_at(&mut h, range(5), by_region());
    // East's value cell (J2).
    assert_eq!(display(&h, 0, 1, 8), "East");
    let before = state(&h);
    let env = h
        .apply(C::ShowPivotDetails {
            id: 1,
            row: 1,
            col: 9,
        })
        .unwrap();
    let s = env.patch.activate_sheet.expect("a new sheet");
    let wb = h.doc().workbook();
    let sheet = SheetId(s);
    assert_eq!(wb.sheets()[0].1, "Sheet2", "before the pivot's sheet");
    let v = |r, c| wb.display_text(CellCoord::new(sheet, r, c));
    assert_eq!((v(0, 0), v(0, 2)), ("Region".into(), "Sales".into()));
    assert_eq!(
        (v(1, 1), v(2, 1), v(1, 2)),
        ("Apple".into(), "Pear".into(), "10".into())
    );
    assert_eq!(v(3, 0), "");
    let t = &wb.tables(sheet)[0];
    assert_eq!((t.r0, t.r1, t.c1), (0, 2, 3));
    // The grand total: every record.
    let env = h
        .apply(C::ShowPivotDetails {
            id: 1,
            row: 4,
            col: 9,
        })
        .unwrap();
    let s2 = SheetId(env.patch.activate_sheet.unwrap());
    assert_eq!(h.doc().workbook().tables(s2)[0].r1, 5);
    h.undo().unwrap();
    h.undo().unwrap();
    assert!(state(&h) == before);
    assert!(h
        .apply(C::ShowPivotDetails {
            id: 1,
            row: 0,
            col: 8
        })
        .is_err());
}

#[test]
fn subtotals_at_the_bottom_and_banded_columns() {
    let mut h = book();
    pivot_at(
        &mut h,
        range(5),
        PivotFields {
            rows: vec![0.into(), 1.into()],
            values: vec![DataField::sum(2)],
            ..Default::default()
        },
    );
    // Compact, subtotals on the item's row: East 30 on row 2.
    assert_eq!(display(&h, 0, 1, 8), "East");
    assert_eq!(display(&h, 0, 1, 9), "30");
    let (_, t) = h.doc().workbook().pivot(1).unwrap();
    let mut rows = t.rows.clone();
    rows[0] = AxisField {
        subtotal_bottom: true,
        layout: PivotLayout::Outline,
        ..rows[0].clone()
    };
    let mut options = t.options.clone();
    options.banded_cols = true;
    undo_identity(
        &mut h,
        C::UpdatePivot {
            id: 1,
            patch: PivotPatch {
                rows: Some(rows),
                options: Some(options),
                ..Default::default()
            },
        },
    );
    // Outline form: East's row is blank; `East Total` below its items.
    assert_eq!(display(&h, 0, 1, 8), "East");
    assert_eq!(display(&h, 0, 1, 10), "");
    assert_eq!(display(&h, 0, 2, 9), "Apple");
    assert_eq!(display(&h, 0, 4, 8), "East Total");
    assert_eq!(display(&h, 0, 4, 10), "30");
    // Both survive the file.
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, _) = CalcDocument::open_xlsx(&bytes, "p.xlsx").unwrap();
    let (_, back) = doc.workbook().pivot(1).unwrap();
    assert!(back.rows[0].subtotal_bottom && back.options.banded_cols);
}

#[test]
fn patches_carry_the_grown_style_table() {
    let mut h = book();
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 1,
        c0: 2,
        r1: 5,
        c1: 2,
        patch: model_sheet::CellStyle {
            number_format: Some("#,##0.0".into()),
            ..Default::default()
        },
    })
    .unwrap();
    let before = h.doc().workbook().styles().len();
    let env = h
        .apply(C::CreatePivot {
            source: range(5),
            target: PivotTarget::Cell {
                sheet: 0,
                row: 0,
                col: 8,
            },
            fields: PivotFields {
                rows: vec![0.into(), 1.into()],
                values: vec![DataField::sum(2)],
                ..Default::default()
            },
        })
        .unwrap();
    let after = h.doc().workbook().styles().len();
    assert!(after > before, "indents and formats were interned");
    assert_eq!(env.patch.styles.map(|s| s.len()), Some(after));
}
