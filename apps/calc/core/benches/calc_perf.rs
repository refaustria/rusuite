//! The Calc performance scenario (P5-4): a 1000×1000 sheet (1M cells: 70 %
//! numbers, 20 % text, 10 % formulas) plus a 10k-cell dependency chain on
//! a second sheet, loaded through `set_input` inside one batch, then
//! recalculated, edited, snapshotted, saved and reopened.

#![allow(dead_code)]

use calc_core::{dispatch, CalcCommand, CalcDocument, CalcHost};
use model_sheet::{CellCoord, SheetId};

#[path = "support.rs"]
pub mod support;
use support::{proc_status_mb, Report};

pub const ROWS: u32 = 1000;
pub const COLS: u32 = 1000;
pub const CHAIN: u32 = 10_000;

/// `A`, `B`, …, `AA`, … for a 0-based column.
pub fn col_letters(mut col: u32) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (col % 26) as u8);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

fn a1(row: u32, col: u32) -> String {
    format!("{}{}", col_letters(col), row + 1)
}

/// Deterministic pseudo-random 0..100 per cell.
fn bucket(row: u32, col: u32) -> u64 {
    let x = (u64::from(row) << 32 | u64::from(col)).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    (x >> 32) % 100
}

/// The input of cell `(row, col)` of the big sheet. Formulas only
/// reference cells before them in row-major order (acyclic).
pub fn input(row: u32, col: u32) -> String {
    let b = bucket(row, col);
    if b < 70 {
        let n = (row * 31 + col * 17) % 10_000;
        if b % 2 == 0 {
            format!("{n}")
        } else {
            format!("{n}.25")
        }
    } else if b < 90 {
        format!("Item {row}-{col}")
    } else if b < 95 {
        // `=A1*2` on the left neighbour (or the cell above in column A).
        match (row, col) {
            (0, 0) => "1".to_owned(),
            (r, 0) => format!("={}*2", a1(r - 1, 0)),
            (r, c) => format!("={}*2", a1(r, c - 1)),
        }
    } else if row >= 3 {
        // SUM over a small block above.
        let c1 = (col + 1).min(COLS - 1);
        format!("=SUM({}:{})", a1(row - 3, col), a1(row - 1, c1))
    } else {
        "7".to_owned()
    }
}

/// Builds the workbook inside `host` (big sheet = 0, chain sheet = 1)
/// and returns the time of the `set_input` phase and of `end_batch` (ms).
pub fn load(host: &mut CalcHost) -> (f64, f64) {
    let wb = host.doc_mut().workbook_mut();
    let chain = wb.add_sheet("Chain").expect("add sheet");
    let ((), set_ms) = support::time(|| {
        wb.begin_batch();
        for row in 0..ROWS {
            for col in 0..COLS {
                wb.set_input(CellCoord::new(SheetId(0), row, col), &input(row, col))
                    .expect("set input");
            }
        }
        wb.set_input(CellCoord::new(chain, 0, 0), "1")
            .expect("head");
        for row in 1..CHAIN {
            wb.set_input(CellCoord::new(chain, row, 0), &format!("=A{row}+1"))
                .expect("chain");
        }
    });
    let (recalc, end_ms) = support::time(|| wb.end_batch());
    assert!(recalc.cycle.is_none());
    (set_ms, end_ms)
}

fn set_input(sheet: u32, row: u32, col: u32, input: String) -> CalcCommand {
    CalcCommand::SetInput {
        sheet,
        row,
        col,
        input,
    }
}

/// Runs the scenario; `quick` skips the slow file round trip repetitions.
pub fn run() -> (Report, Vec<u8>) {
    let mut r = Report::default();
    let mut host = CalcHost::new(CalcDocument::new());
    let (set_ms, end_ms) = load(&mut host);
    r.add(
        "load 1M cells + 10k chain (set_input in one batch, incl. end_batch)",
        set_ms + end_ms,
        "ms",
        Some(10_000.0),
    );
    r.add("… of which set_input ×1.01M", set_ms, "ms", None);
    r.add("… of which end_batch (recalculation)", end_ms, "ms", None);
    r.add(
        "peak RSS after load (VmHWM)",
        proc_status_mb("VmHWM"),
        "MB",
        Some(1536.0),
    );
    r.median("recalc_all (100k formulas + chain)", 3, None, || {
        host.doc_mut().workbook_mut().recalc_all();
    });

    let mut n = 1;
    let mut edit = |host: &mut CalcHost, sheet, row, col| {
        n += 1;
        host.apply(set_input(sheet, row, col, n.to_string()))
            .expect("edit")
    };
    r.median(
        "edit at the head of the 10k chain (Host::apply, patch of 10k cells)",
        5,
        Some(100.0),
        || {
            let env = edit(&mut host, 1, 0, 0);
            assert_eq!(
                env.patch.cells.iter().map(|s| s.cells.len()).sum::<usize>(),
                CHAIN as usize
            );
        },
    );
    r.median("edit at the head of the 10k chain (dispatch JSON)", 5, Some(100.0), || {
        n += 1;
        let req = format!(r#"{{"type":"apply","command":{{"type":"setInput","sheet":1,"row":0,"col":0,"input":"{n}"}}}}"#);
        let out = dispatch(&mut host, &req);
        assert!(out.starts_with(r#"{"ok""#), "{}", &out[..200.min(out.len())]);
    });
    r.median("edit one cell of the 1M sheet (dispatch JSON)", 5, Some(100.0), || {
        n += 1;
        let req = format!(r#"{{"type":"apply","command":{{"type":"setInput","sheet":0,"row":500,"col":500,"input":"{n}"}}}}"#);
        let out = dispatch(&mut host, &req);
        assert!(out.starts_with(r#"{"ok""#));
    });

    let doc = host.doc();
    r.median(
        "RegionSnapshot 64×32 at A1 (CalcDocument::snapshot)",
        21,
        Some(5.0),
        || {
            let s = doc.snapshot(0, 0, 0, 63, 31).expect("snapshot");
            assert_eq!(s.cells.len(), 64 * 32);
        },
    );
    r.median(
        "RegionSnapshot 64×32 at row 512, col 512",
        21,
        Some(5.0),
        || {
            let s = doc.snapshot(0, 512, 512, 575, 543).expect("snapshot");
            assert_eq!(s.cells.len(), 64 * 32);
        },
    );
    r.median(
        "RegionSnapshot 64×32 (dispatch JSON)",
        21,
        Some(5.0),
        || {
            let out = dispatch(
                &mut host,
                r#"{"type":"snapshot","sheet":0,"r0":512,"c0":512,"r1":575,"c1":543}"#,
            );
            assert!(out.starts_with(r#"{"ok""#));
        },
    );

    // Styled variant: a number format on every cell of the big sheet
    // (per-cell styles, as an xlsx with formatted columns stores them).
    let fmt = model_sheet::CellStyle {
        number_format: Some("#,##0.00".to_owned()),
        ..Default::default()
    };
    r.time(
        "ApplyStyle number format to all 1M cells (Host::apply)",
        None,
        || {
            host.apply(CalcCommand::ApplyStyle {
                sheet: 0,
                r0: 0,
                c0: 0,
                r1: ROWS - 1,
                c1: COLS - 1,
                patch: fmt,
            })
            .expect("style")
        },
    );
    let doc = host.doc();
    r.median(
        "styled: RegionSnapshot 64×32 at row 512, col 512",
        21,
        Some(5.0),
        || {
            let s = doc.snapshot(0, 512, 512, 575, 543).expect("snapshot");
            assert_eq!(s.cells.len(), 64 * 32);
        },
    );
    r.median("styled: edit at the head of the 10k chain (dispatch JSON)", 5, Some(100.0), || {
        n += 1;
        let req = format!(r#"{{"type":"apply","command":{{"type":"setInput","sheet":1,"row":0,"col":0,"input":"{n}"}}}}"#);
        let out = dispatch(&mut host, &req);
        assert!(out.starts_with(r#"{"ok""#));
    });

    let bytes = r.time("save_xlsx (styled)", None, || {
        host.doc().save_xlsx().expect("save")
    });
    r.add("xlsx size (styled)", bytes.len() as f64 / 1e6, "MB", None);
    drop(host);
    let (doc, _) = r.time(
        "open_xlsx (styled; incl. recalculation)",
        Some(10_000.0),
        || CalcDocument::open_xlsx(&bytes, "perf.xlsx").expect("open"),
    );
    assert_eq!(
        doc.workbook().engine().used_range(SheetId(0)),
        Some((ROWS - 1, COLS - 1))
    );
    drop(doc);
    r.add(
        "peak RSS overall (VmHWM)",
        proc_status_mb("VmHWM"),
        "MB",
        Some(1536.0),
    );
    (r, bytes)
}
