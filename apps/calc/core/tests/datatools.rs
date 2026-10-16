//! P8-35: the Data tab tools (Remove Duplicates, Text to Columns, Goal
//! Seek, Group/Ungroup/Subtotal), page breaks, pictures and CSV, with
//! undo identity.

use app_common::Host;
use base64::Engine as _;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost, SubtotalFunction};
use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::textio::{ColumnFormat, SplitKind, TextImportOptions};
use model_sheet::{Axis, CellOffset, ChartAnchor, OutlineProps, Picture, WorkbookSnapshot};
use serde_json::{json, Value as Json};

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

fn host_with(rows: &[&[&str]]) -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            if !v.is_empty() {
                h.apply(set(r as u32, c as u32, v)).unwrap();
            }
        }
    }
    h
}

fn snap(h: &CalcHost) -> WorkbookSnapshot {
    WorkbookSnapshot {
        styles: Vec::new(),
        ..h.doc().workbook().to_snapshot()
    }
}

fn undo_identity(h: &mut CalcHost, cmd: C) -> Json {
    let before = snap(h);
    let env = h
        .apply(cmd.clone())
        .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
    let after = snap(h);
    h.undo().unwrap();
    assert_eq!(snap(h), before, "undo of {cmd:?}");
    h.redo().unwrap();
    assert_eq!(snap(h), after, "redo of {cmd:?}");
    serde_json::to_value(env.patch).unwrap()
}

fn value(h: &CalcHost, row: u32, col: u32) -> Value {
    h.doc()
        .workbook()
        .value(CellCoord::new(SheetId(0), row, col))
}

fn text(h: &CalcHost, row: u32, col: u32) -> String {
    match value(h, row, col) {
        Value::Text(t) => t,
        Value::Empty => String::new(),
        v => format!("{v:?}"),
    }
}

fn input(h: &CalcHost, row: u32, col: u32) -> String {
    model_sheet::content_to_input(
        h.doc()
            .workbook()
            .content(CellCoord::new(SheetId(0), row, col)),
    )
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn err(h: &mut CalcHost, req: Json) -> String {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    reply["err"]["code"].as_str().unwrap_or_default().to_owned()
}

#[test]
fn remove_duplicates_in_a_range() {
    let mut h = host_with(&[
        &["Name", "City", "N"],
        &["Ann", "Graz", "1"],
        &["Bob", "Wien", "2"],
        &["ann", "Graz", "3"],
        &["Bob", "Wien", "2"],
        &["Cy", "Linz", "=C2*10"],
    ]);
    let patch = undo_identity(
        &mut h,
        C::RemoveDuplicates {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 5,
            c1: 2,
            columns: vec![0, 1],
            has_header: true,
        },
    );
    assert_eq!(patch["duplicates"], json!({"removed": 2, "remaining": 3}));
    assert_eq!(text(&h, 1, 0), "Ann");
    assert_eq!(text(&h, 2, 0), "Bob");
    assert_eq!(text(&h, 3, 0), "Cy");
    // The moved formula keeps its references (cells shifted up).
    assert_eq!(input(&h, 3, 2), "=C2*10");
    assert_eq!(value(&h, 3, 2), n(10.0));
    assert_eq!(text(&h, 4, 0), "");
    assert_eq!(text(&h, 5, 0), "");
    // All columns: nothing repeats.
    let env = h
        .apply(C::RemoveDuplicates {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 2,
            columns: vec![],
            has_header: true,
        })
        .unwrap();
    assert_eq!(
        serde_json::to_value(env.patch).unwrap()["duplicates"]["removed"],
        0
    );
}

#[test]
fn remove_duplicates_in_a_table() {
    let mut h = host_with(&[
        &["K", "V"],
        &["a", "1"],
        &["a", "1"],
        &["b", "2"],
        &["a", "1"],
    ]);
    h.apply(C::CreateTable {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 4,
        c1: 1,
        has_headers: true,
        style: None,
    })
    .unwrap();
    let patch = undo_identity(
        &mut h,
        C::RemoveDuplicates {
            sheet: 0,
            r0: 2,
            c0: 1,
            r1: 2,
            c1: 1,
            columns: vec![0, 1],
            has_header: false,
        },
    );
    assert_eq!(patch["duplicates"], json!({"removed": 2, "remaining": 2}));
    assert_eq!(h.doc().workbook().tables(SheetId(0))[0].r1, 2);
}

fn semi() -> TextImportOptions {
    TextImportOptions {
        split: SplitKind::by(';'),
        ..Default::default()
    }
}

#[test]
fn text_to_columns() {
    let mut h = host_with(&[&["a;b;c"], &["1;2,5;x"], &[""], &["single"]]);
    undo_identity(
        &mut h,
        C::TextToColumns {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            options: semi(),
            dest: None,
        },
    );
    assert_eq!(
        (text(&h, 0, 0), text(&h, 0, 1), text(&h, 0, 2)),
        ("a".into(), "b".into(), "c".into())
    );
    assert_eq!(value(&h, 1, 0), n(1.0));
    assert_eq!(text(&h, 1, 1), "2,5");
    assert_eq!(text(&h, 3, 0), "single");
    // A destination and column formats; decimal comma.
    let mut h = host_with(&[&["007;1,5;2024-01-31;skip"]]);
    let o = TextImportOptions {
        formats: vec![
            ColumnFormat::Text,
            ColumnFormat::General,
            ColumnFormat::Date {
                order: model_sheet::textio::DateOrder::Ymd,
            },
            ColumnFormat::Skip,
        ],
        decimal: ',',
        thousands: '.',
        ..semi()
    };
    undo_identity(
        &mut h,
        C::TextToColumns {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            options: o,
            dest: Some((2, 3)),
        },
    );
    assert_eq!(text(&h, 2, 3), "007");
    assert_eq!(value(&h, 2, 4), n(1.5));
    assert_eq!(value(&h, 2, 5), n(45322.0));
    assert_eq!(text(&h, 2, 6), "");
    assert_eq!(text(&h, 0, 0), "007;1,5;2024-01-31;skip");
    // Fixed width.
    let mut h = host_with(&[&["ABC12"]]);
    h.apply(C::TextToColumns {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        options: TextImportOptions {
            split: SplitKind::FixedWidth { breaks: vec![3] },
            ..Default::default()
        },
        dest: None,
    })
    .unwrap();
    assert_eq!((text(&h, 0, 0), value(&h, 0, 1)), ("ABC".into(), n(12.0)));
}

fn goal(h: &mut CalcHost, set_cell: (u32, u32), to: f64, changing: (u32, u32)) -> Json {
    ok(
        h,
        json!({"type": "goalSeek", "sheet": 0, "setRow": set_cell.0, "setCol": set_cell.1,
               "toValue": to, "changingRow": changing.0, "changingCol": changing.1}),
    )["result"]
        .clone()
}

#[test]
fn goal_seek() {
    // B3 = B1 * B2 + 4: B1 so that B3 = 100.
    let mut h = host_with(&[&["", "2"], &["", "8"], &["", "=B1*B2+4"]]);
    let before = snap(&h);
    let r = goal(&mut h, (2, 1), 100.0, (0, 1));
    assert_eq!(r["found"], true);
    assert!((r["value"].as_f64().unwrap() - 12.0).abs() < 1e-3, "{r}");
    assert!((r["result"].as_f64().unwrap() - 100.0).abs() < 1e-3);
    // Nothing changed.
    assert_eq!(snap(&h), before);
    // A square root: x^2 = 2 from 1.
    let mut h = host_with(&[&["1", "=A1^2"]]);
    let r = goal(&mut h, (0, 1), 2.0, (0, 0));
    assert_eq!(r["found"], true);
    assert!(
        (r["value"].as_f64().unwrap().abs() - 2f64.sqrt()).abs() < 1e-3,
        "{r}"
    );
    // From an empty cell; a step function needs the bisection.
    let mut h = host_with(&[&["", "=IF(A1>5,10,0)+A1/100"]]);
    let r = goal(&mut h, (0, 1), 10.06, (0, 0));
    assert_eq!(r["found"], true, "{r}");
    // No solution: x^2 = -1.
    let mut h = host_with(&[&["3", "=A1^2"]]);
    let r = goal(&mut h, (0, 1), -1.0, (0, 0));
    assert_eq!(r["found"], false);
    assert!(r["iterations"].as_u64().unwrap() <= 100);
    assert_eq!(value(&h, 0, 0), n(3.0));
    // Errors: the set cell needs a formula, the changing cell a value.
    let mut h = host_with(&[&["3", "=A1^2", "5"]]);
    let req = |s: u32, c: u32| json!({"type": "goalSeek", "sheet": 0, "setRow": 0, "setCol": s, "toValue": 1, "changingRow": 0, "changingCol": c});
    assert_eq!(err(&mut h, req(2, 0)), "goal_seek");
    assert_eq!(err(&mut h, req(1, 1)), "goal_seek");
    // Applying the value is one undo step.
    let mut h = host_with(&[&["", "2"], &["", "8"], &["", "=B1*B2+4"]]);
    let r = goal(&mut h, (2, 1), 100.0, (0, 1));
    undo_identity(&mut h, set(0, 1, &r["value"].as_f64().unwrap().to_string()));
    assert!((value(&h, 2, 1).as_number().unwrap() - 100.0).abs() < 1e-3);
}

trait AsNumber {
    fn as_number(&self) -> Option<f64>;
}

impl AsNumber for Value {
    fn as_number(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }
}

fn hidden_rows(h: &CalcHost) -> Vec<u32> {
    h.doc()
        .workbook()
        .rows(SheetId(0))
        .filter(|(_, r)| r.hidden)
        .map(|(i, _)| i)
        .collect()
}

#[test]
fn group_collapse_and_levels() {
    let mut h = host_with(&[&["a"], &["b"], &["c"], &["d"], &["e"], &["sum"]]);
    undo_identity(
        &mut h,
        C::GroupOutline {
            sheet: 0,
            axis: Axis::Rows,
            i0: 1,
            i1: 4,
            ungroup: false,
        },
    );
    undo_identity(
        &mut h,
        C::GroupOutline {
            sheet: 0,
            axis: Axis::Rows,
            i0: 2,
            i1: 3,
            ungroup: false,
        },
    );
    let info = ok(&mut h, json!({"type": "info"}));
    assert_eq!(info["info"]["sheets"][0]["maxOutline"], json!([2, 0]));
    undo_identity(
        &mut h,
        C::SetOutlineCollapsed {
            sheet: 0,
            axis: Axis::Rows,
            index: 5,
            collapsed: true,
        },
    );
    assert_eq!(hidden_rows(&h), vec![1, 2, 3, 4]);
    undo_identity(
        &mut h,
        C::ShowOutlineLevel {
            sheet: 0,
            axis: Axis::Rows,
            level: 3,
        },
    );
    assert!(hidden_rows(&h).is_empty());
    undo_identity(
        &mut h,
        C::ShowOutlineLevel {
            sheet: 0,
            axis: Axis::Rows,
            level: 2,
        },
    );
    assert_eq!(hidden_rows(&h), vec![2, 3]);
    undo_identity(
        &mut h,
        C::GroupOutline {
            sheet: 0,
            axis: Axis::Cols,
            i0: 2,
            i1: 3,
            ungroup: false,
        },
    );
    undo_identity(
        &mut h,
        C::ClearOutline {
            sheet: 0,
            axis: None,
        },
    );
    assert_eq!(
        h.doc().workbook().max_outline_level(SheetId(0), Axis::Rows),
        0
    );
    undo_identity(
        &mut h,
        C::SetOutlineProps {
            sheet: 0,
            props: OutlineProps {
                summary_below: false,
                summary_right: false,
            },
        },
    );
}

#[test]
fn subtotals() {
    let mut h = host_with(&[
        &["Region", "Sales", "Units"],
        &["East", "10", "1"],
        &["East", "20", "2"],
        &["West", "5", "3"],
        &["North", "1", "4"],
        &["North", "2", "5"],
    ]);
    h.apply(set(0, 5, "=SUM(B2:B6)")).unwrap();
    undo_identity(
        &mut h,
        C::Subtotal {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 5,
            c1: 2,
            group_by: 0,
            function: SubtotalFunction::Sum,
            columns: vec![1, 2],
            replace: false,
            summary_below: true,
        },
    );
    // East(2) East Total West West Total North(2) North Total Grand Total
    assert_eq!(text(&h, 3, 0), "East Total");
    assert_eq!(input(&h, 3, 1), "=SUBTOTAL(9,B2:B3)");
    assert_eq!(value(&h, 3, 1), n(30.0));
    assert_eq!(text(&h, 5, 0), "West Total");
    assert_eq!(text(&h, 8, 0), "North Total");
    assert_eq!(text(&h, 9, 0), "Grand Total");
    assert_eq!(input(&h, 9, 1), "=SUBTOTAL(9,B2:B9)");
    assert_eq!(value(&h, 9, 1), n(38.0));
    assert_eq!(value(&h, 9, 2), n(15.0));
    // Outside formulas followed the inserted rows (as row inserts do).
    assert_eq!(input(&h, 0, 5), "=SUM(B2:B8)");
    let wb = h.doc().workbook();
    assert_eq!(wb.row_info(SheetId(0), 1).outline_level, 2);
    assert_eq!(wb.row_info(SheetId(0), 3).outline_level, 1);
    assert_eq!(wb.row_info(SheetId(0), 9).outline_level, 0);
    assert_eq!(
        wb.style(CellCoord::new(SheetId(0), 3, 0)).font.bold,
        Some(true)
    );
    // Replace with averages.
    undo_identity(
        &mut h,
        C::Subtotal {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 9,
            c1: 2,
            group_by: 0,
            function: SubtotalFunction::Average,
            columns: vec![1],
            replace: true,
            summary_below: true,
        },
    );
    assert_eq!(input(&h, 3, 1), "=SUBTOTAL(1,B2:B3)");
    assert_eq!(value(&h, 3, 1), n(15.0));
    assert_eq!(text(&h, 9, 0), "Grand Total");
    // Remove All.
    undo_identity(
        &mut h,
        C::RemoveSubtotals {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 9,
            c1: 2,
        },
    );
    assert_eq!(text(&h, 3, 0), "West");
    assert_eq!(text(&h, 6, 0), "");
    assert_eq!(
        h.doc().workbook().max_outline_level(SheetId(0), Axis::Rows),
        0
    );
    assert_eq!(input(&h, 0, 5), "=SUM(B2:B6)");
}

#[test]
fn subtotals_above() {
    let mut h = host_with(&[&["K", "V"], &["a", "1"], &["b", "2"], &["b", "3"]]);
    undo_identity(
        &mut h,
        C::Subtotal {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 1,
            group_by: 0,
            function: SubtotalFunction::Count,
            columns: vec![1],
            replace: false,
            summary_below: false,
        },
    );
    assert_eq!(text(&h, 1, 0), "Grand Total");
    assert_eq!(text(&h, 2, 0), "a Total");
    assert_eq!(text(&h, 4, 0), "b Total");
    assert_eq!(value(&h, 4, 1), n(2.0));
    assert_eq!(value(&h, 1, 1), n(3.0));
    assert!(!h.doc().workbook().outline_props(SheetId(0)).summary_below);
}

#[test]
fn page_breaks_and_pictures() {
    let mut h = host_with(&[&["x"]]);
    undo_identity(
        &mut h,
        C::SetPageBreaks {
            sheet: 0,
            axis: Axis::Rows,
            breaks: vec![20, 10],
        },
    );
    let info = ok(&mut h, json!({"type": "info"}));
    assert_eq!(info["info"]["sheets"][0]["rowBreaks"], json!([10, 20]));
    let png = vec![0x89, b'P', b'N', b'G'];
    let pic = Picture {
        id: 0,
        name: String::new(),
        descr: String::new(),
        anchor: ChartAnchor::OneCell {
            from: CellOffset {
                col: 1,
                row: 1,
                col_offset: 0,
                row_offset: 0,
            },
            width: 100,
            height: 50,
        },
        media: core_model::Media {
            content_type: "image/png".into(),
            data: png.clone(),
        },
    };
    let patch = undo_identity(
        &mut h,
        C::AddPicture {
            sheet: 0,
            picture: pic,
        },
    );
    assert_eq!(patch["pictureSheets"], json!([0]));
    let pics = ok(&mut h, json!({"type": "sheetPictures", "sheet": 0}));
    assert_eq!(pics["pictures"][0]["name"], "Picture 1");
    assert_eq!(
        pics["pictures"][0]["media"]["data"],
        base64::engine::general_purpose::STANDARD.encode(&png)
    );
    let moved = ChartAnchor::OneCell {
        from: CellOffset {
            col: 4,
            row: 4,
            col_offset: 0,
            row_offset: 0,
        },
        width: 100,
        height: 50,
    };
    undo_identity(
        &mut h,
        C::SetPictureAnchor {
            sheet: 0,
            id: 1,
            anchor: moved,
        },
    );
    undo_identity(&mut h, C::RemovePicture { sheet: 0, id: 1 });
    let bad = Picture {
        id: 0,
        name: String::new(),
        descr: String::new(),
        anchor: moved,
        media: core_model::Media {
            content_type: "text/html".into(),
            data: vec![1],
        },
    };
    assert!(h
        .apply(C::AddPicture {
            sheet: 0,
            picture: bad
        })
        .is_err());
}

#[test]
fn csv_open_and_save() {
    let mut h = Host::new(CalcDocument::new());
    let bytes = "Name;Wert\r\nÄpfel;1,5\r\n\"a;b\";2\r\n".as_bytes();
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let d = ok(&mut h, json!({"type": "decodeText", "bytesBase64": b64}))["decoded"].clone();
    assert_eq!(d["encoding"], "utf8");
    assert_eq!(d["separator"], ";");
    assert_eq!(d["decimal"], ",");
    let options = json!({"split": {"kind": "delimited", "semicolon": true}, "decimal": ",", "thousands": "."});
    let p = ok(
        &mut h,
        json!({"type": "splitPreview", "text": d["text"], "options": options, "max": 2}),
    );
    assert_eq!(p["rows"], json!([["Name", "Wert"], ["Äpfel", "1,5"]]));
    let opened = ok(
        &mut h,
        json!({"type": "openText", "text": d["text"], "name": "daten.csv", "options": options}),
    );
    assert_eq!(opened["info"]["sheets"][0]["name"], "daten");
    assert_eq!(value(&h, 1, 1), n(1.5));
    assert_eq!(text(&h, 2, 0), "a;b");
    // Windows-1252 bytes.
    let cp = ok(&mut h, json!({"type": "decodeText", "bytesBase64": base64::engine::general_purpose::STANDARD.encode(b"\xC4pfel,1")}))["decoded"].clone();
    assert_eq!(
        (cp["text"].as_str(), cp["encoding"].as_str()),
        (Some("Äpfel,1"), Some("windows1252"))
    );
    // Save As CSV.
    let saved = ok(
        &mut h,
        json!({"type": "saveCsv", "sheet": 0, "options": {"separator": ",", "bom": false}}),
    );
    assert_eq!(saved["suggestedName"], "daten.csv");
    let out = base64::engine::general_purpose::STANDARD
        .decode(saved["bytesBase64"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        String::from_utf8(out).unwrap(),
        "Name,Wert\r\nÄpfel,1.5\r\na;b,2\r\n"
    );
}
