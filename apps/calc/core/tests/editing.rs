//! P6-3: clipboard (`PasteRange`), fill handle (`FillRange`), find and
//! number-format preview.

use app_common::Host;
use calc_core::{
    dispatch, CalcCommand as C, CalcDocument, CalcHost, ClipCell, FillMode, PasteMode, Rect,
    SheetRect,
};
use model_sheet::{CellCoord, CellStyle, SheetId};
use serde_json::{json, Value as Json};

fn host() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::AddSheet {
        name: "Sheet2".into(),
        index: None,
    })
    .unwrap();
    h
}

fn set(h: &mut CalcHost, sheet: u32, row: u32, col: u32, input: &str) {
    h.apply(C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    })
    .unwrap();
}

fn at(sheet: u32, row: u32, col: u32) -> CellCoord {
    CellCoord::new(SheetId(sheet), row, col)
}

fn input(h: &CalcHost, sheet: u32, row: u32, col: u32) -> String {
    h.doc().cell_view(at(sheet, row, col)).input
}

fn display(h: &CalcHost, sheet: u32, row: u32, col: u32) -> String {
    h.doc().cell_view(at(sheet, row, col)).display
}

fn own_style(h: &CalcHost, sheet: u32, row: u32, col: u32) -> u32 {
    h.doc().workbook().cell_style_id(at(sheet, row, col)).0
}

fn clip(dr: u32, dc: u32, input: &str, style: Option<u32>) -> ClipCell {
    ClipCell {
        dr,
        dc,
        input: input.into(),
        style,
    }
}

fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> Rect {
    Rect { r0, c0, r1, c1 }
}

fn src(sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> SheetRect {
    SheetRect {
        sheet,
        r0,
        c0,
        r1,
        c1,
    }
}

#[allow(clippy::too_many_arguments)]
fn paste(
    sheet: u32,
    r0: u32,
    c0: u32,
    from: SheetRect,
    cells: Vec<ClipCell>,
    mode: PasteMode,
    cut: bool,
    rep: (u32, u32),
) -> C {
    C::PasteRange {
        sheet,
        r0,
        c0,
        src: from,
        cells,
        mode,
        cut,
        repeat_rows: rep.0,
        repeat_cols: rep.1,
    }
}

fn bold_style(h: &mut CalcHost) -> u32 {
    let patch = CellStyle {
        number_format: Some("0.00".into()),
        ..Default::default()
    };
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 9,
        c0: 9,
        r1: 9,
        c1: 9,
        patch,
    })
    .unwrap();
    own_style(h, 0, 9, 9)
}

/// A1=1, A2=2, A3=3, B1 = A1*10.
fn numbers() -> CalcHost {
    let mut h = host();
    set(&mut h, 0, 0, 0, "1");
    set(&mut h, 0, 1, 0, "2");
    set(&mut h, 0, 2, 0, "3");
    set(&mut h, 0, 0, 1, "=A1*10");
    h
}

// --- paste --------------------------------------------------------------

#[test]
fn paste_shifts_relative_references() {
    let mut h = numbers();
    let cmd = paste(
        0,
        1,
        1,
        src(0, 0, 1, 0, 1),
        vec![clip(0, 0, "=A1*10", Some(0))],
        PasteMode::All,
        false,
        (1, 1),
    );
    h.apply(cmd).unwrap();
    assert_eq!(input(&h, 0, 1, 1), "=A2*10");
    assert_eq!(display(&h, 0, 1, 1), "20");
}

#[test]
fn paste_keeps_anchored_parts() {
    let mut h = numbers();
    let cells = vec![clip(0, 0, "=$A$1+A$1+$A1+A1", None)];
    h.apply(paste(
        0,
        2,
        3,
        src(0, 0, 1, 0, 1),
        cells,
        PasteMode::All,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 2, 3), "=$A$1+C$1+$A3+C3");
}

#[test]
fn paste_off_the_sheet_gives_ref_error() {
    let mut h = numbers();
    let cells = vec![clip(0, 0, "=A2", None)];
    h.apply(paste(
        0,
        0,
        3,
        src(0, 2, 3, 2, 3),
        cells,
        PasteMode::All,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 0, 3), "=#REF!");
    assert_eq!(display(&h, 0, 0, 3), "#REF!");
}

#[test]
fn paste_copies_styles() {
    let mut h = numbers();
    let st = bold_style(&mut h);
    let cells = vec![clip(0, 0, "2.5", Some(st))];
    h.apply(paste(
        0,
        4,
        0,
        src(0, 9, 9, 9, 9),
        cells,
        PasteMode::All,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(own_style(&h, 0, 4, 0), st);
    assert_eq!(display(&h, 0, 4, 0), "2.50");
}

#[test]
fn paste_without_style_keeps_the_destination_style() {
    let mut h = numbers();
    let st = bold_style(&mut h);
    let cells = vec![clip(0, 0, "7", None)];
    h.apply(paste(
        0,
        9,
        9,
        src(0, 9, 9, 9, 9),
        cells,
        PasteMode::All,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(own_style(&h, 0, 9, 9), st);
    assert_eq!(display(&h, 0, 9, 9), "7.00");
}

#[test]
fn paste_blank_positions_clear_the_destination() {
    let mut h = numbers();
    // Block A1:A2 where only A1 has content, pasted over C1:C2 (C2 filled).
    set(&mut h, 0, 1, 2, "old");
    let cells = vec![clip(0, 0, "x", Some(0))];
    h.apply(paste(
        0,
        0,
        2,
        src(0, 0, 0, 1, 0),
        cells,
        PasteMode::All,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 0, 2), "x");
    assert_eq!(input(&h, 0, 1, 2), "");
}

#[test]
fn paste_is_one_undo_step() {
    let mut h = numbers();
    set(&mut h, 0, 5, 1, "keep");
    let cells = vec![clip(0, 0, "=A1*10", Some(0)), clip(1, 0, "z", Some(0))];
    h.apply(paste(
        0,
        5,
        1,
        src(0, 0, 1, 1, 1),
        cells,
        PasteMode::All,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 5, 1), "=A6*10");
    assert_eq!(input(&h, 0, 6, 1), "z");
    h.undo().unwrap();
    assert_eq!(input(&h, 0, 5, 1), "keep");
    assert_eq!(input(&h, 0, 6, 1), "");
    h.redo().unwrap();
    assert_eq!(input(&h, 0, 6, 1), "z");
}

#[test]
fn paste_repeats_the_block_over_a_multiple() {
    let mut h = numbers();
    let cells = vec![clip(0, 0, "=A1*10", Some(0))];
    h.apply(paste(
        0,
        1,
        1,
        src(0, 0, 1, 0, 1),
        cells,
        PasteMode::All,
        false,
        (2, 2),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 1, 1), "=A2*10");
    assert_eq!(input(&h, 0, 2, 1), "=A3*10");
    assert_eq!(input(&h, 0, 1, 2), "=B2*10");
    assert_eq!(input(&h, 0, 2, 2), "=B3*10");
    assert_eq!(display(&h, 0, 2, 1), "30");
}

#[test]
fn paste_values_only_pastes_computed_values() {
    let mut h = numbers();
    let st = bold_style(&mut h);
    let cells = vec![clip(0, 0, "=A1*10", Some(0)), clip(0, 1, "'007", Some(0))];
    h.apply(paste(
        0,
        9,
        9,
        src(0, 0, 1, 0, 2),
        cells,
        PasteMode::ValuesOnly,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 9, 9), "10");
    assert_eq!(display(&h, 0, 9, 9), "10.00"); // destination format kept
    assert_eq!(own_style(&h, 0, 9, 9), st);
    assert_eq!(display(&h, 0, 9, 10), "007");
}

#[test]
fn paste_formats_only_keeps_contents() {
    let mut h = numbers();
    let st = bold_style(&mut h);
    let cells = vec![clip(0, 0, "ignored", Some(st))];
    h.apply(paste(
        0,
        1,
        0,
        src(0, 9, 9, 9, 9),
        cells,
        PasteMode::FormatsOnly,
        false,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 1, 0), "2");
    assert_eq!(display(&h, 0, 1, 0), "2.00");
}

#[test]
fn cut_moves_cells_and_keeps_formulas() {
    let mut h = numbers();
    let st = bold_style(&mut h);
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 1,
        r1: 0,
        c1: 1,
        patch: h
            .doc()
            .workbook()
            .styles()
            .get(model_sheet::StyleId(st))
            .clone(),
    })
    .unwrap();
    let st_b1 = own_style(&h, 0, 0, 1);
    let cells = vec![clip(0, 0, "=A1*10", Some(st_b1))];
    h.apply(paste(
        0,
        4,
        4,
        src(0, 0, 1, 0, 1),
        cells,
        PasteMode::All,
        true,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 4, 4), "=A1*10");
    assert_eq!(display(&h, 0, 4, 4), "10.00");
    assert_eq!(input(&h, 0, 0, 1), "");
    assert_eq!(own_style(&h, 0, 0, 1), 0);
    h.undo().unwrap();
    assert_eq!(input(&h, 0, 0, 1), "=A1*10");
    assert_eq!(own_style(&h, 0, 0, 1), st_b1);
    assert_eq!(input(&h, 0, 4, 4), "");
}

#[test]
fn cut_onto_an_overlapping_range() {
    let mut h = numbers();
    // Move A1:A3 down by one row: A1 empties, A2:A4 = 1, 2, 3.
    let cells = vec![
        clip(0, 0, "1", Some(0)),
        clip(1, 0, "2", Some(0)),
        clip(2, 0, "3", Some(0)),
    ];
    h.apply(paste(
        0,
        1,
        0,
        src(0, 0, 0, 2, 0),
        cells,
        PasteMode::All,
        true,
        (1, 1),
    ))
    .unwrap();
    let col: Vec<String> = (0..4).map(|r| input(&h, 0, r, 0)).collect();
    assert_eq!(col, ["", "1", "2", "3"]);
    assert_eq!(input(&h, 0, 0, 1), "=A2*10"); // B1 follows the moved A1
    assert_eq!(display(&h, 0, 0, 1), "10");
}

#[test]
fn cut_to_another_sheet_undoes_both_sheets() {
    let mut h = numbers();
    let cells = vec![clip(0, 0, "1", Some(0))];
    h.apply(paste(
        1,
        0,
        0,
        src(0, 0, 0, 0, 0),
        cells,
        PasteMode::All,
        true,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 1, 0, 0), "1");
    assert_eq!(input(&h, 0, 0, 0), "");
    h.undo().unwrap();
    assert_eq!(input(&h, 1, 0, 0), "");
    assert_eq!(input(&h, 0, 0, 0), "1");
}

#[test]
fn cut_moves_references_to_the_moved_cells() {
    let mut h = numbers();
    set(&mut h, 0, 0, 2, "=SUM(A1:A2)+A3"); // C1
    set(&mut h, 1, 0, 0, "=Sheet1!A2*2"); // Sheet2!A1
    set(&mut h, 0, 5, 0, "=A1"); // A6
                                 // Move A1:A2 to D10:D11.
    let cells = vec![clip(0, 0, "1", Some(0)), clip(1, 0, "2", Some(0))];
    h.apply(paste(
        0,
        9,
        3,
        src(0, 0, 0, 1, 0),
        cells,
        PasteMode::All,
        true,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 0, 0, 1), "=D10*10");
    assert_eq!(input(&h, 0, 0, 2), "=SUM(D10:D11)+A3");
    assert_eq!(display(&h, 0, 0, 2), "6");
    assert_eq!(input(&h, 1, 0, 0), "=Sheet1!D11*2");
    assert_eq!(display(&h, 1, 0, 0), "4");
    assert_eq!(input(&h, 0, 5, 0), "=D10");
    h.undo().unwrap();
    assert_eq!(input(&h, 0, 0, 1), "=A1*10");
    assert_eq!(input(&h, 0, 0, 2), "=SUM(A1:A2)+A3");
    assert_eq!(input(&h, 1, 0, 0), "=Sheet1!A2*2");
    assert_eq!(input(&h, 0, 5, 0), "=A1");
    assert_eq!(input(&h, 0, 0, 0), "1");
    h.redo().unwrap();
    assert_eq!(input(&h, 0, 0, 2), "=SUM(D10:D11)+A3");
}

#[test]
fn cut_formulas_to_another_sheet_keep_their_targets() {
    let mut h = numbers();
    // Move A1:B1 (1, =A1*10) to Sheet2!C3:D3; A2*1 elsewhere stays.
    let cells = vec![clip(0, 0, "1", Some(0)), clip(0, 1, "=A1*10+A2", Some(0))];
    h.apply(paste(
        1,
        2,
        2,
        src(0, 0, 0, 0, 1),
        cells,
        PasteMode::All,
        true,
        (1, 1),
    ))
    .unwrap();
    assert_eq!(input(&h, 1, 2, 3), "=C3*10+Sheet1!A2");
    assert_eq!(display(&h, 1, 2, 3), "12");
}

#[test]
fn paste_rejects_bad_requests() {
    let mut h = numbers();
    let ok = vec![clip(0, 0, "1", None)];
    let code = |h: &mut CalcHost, c: C| h.apply(c).unwrap_err().code();
    assert_eq!(
        code(
            &mut h,
            paste(
                0,
                0,
                0,
                src(0, 0, 0, 0, 0),
                ok.clone(),
                PasteMode::All,
                false,
                (0, 1)
            )
        ),
        "invalid_range"
    );
    assert_eq!(
        code(
            &mut h,
            paste(
                0,
                0,
                0,
                src(0, 0, 0, 0, 0),
                ok.clone(),
                PasteMode::All,
                true,
                (2, 1)
            )
        ),
        "invalid_range"
    );
    assert_eq!(
        code(
            &mut h,
            paste(
                0,
                1_048_575,
                0,
                src(0, 0, 0, 1, 0),
                ok.clone(),
                PasteMode::All,
                false,
                (1, 1)
            )
        ),
        "invalid_range"
    );
    assert_eq!(
        code(
            &mut h,
            paste(
                0,
                0,
                0,
                src(0, 0, 0, 0, 0),
                vec![clip(1, 0, "x", None)],
                PasteMode::All,
                false,
                (1, 1)
            )
        ),
        "invalid_range"
    );
    assert_eq!(
        code(
            &mut h,
            paste(
                0,
                0,
                0,
                src(0, 0, 0, 0, 0),
                vec![clip(0, 0, "x", Some(999))],
                PasteMode::All,
                false,
                (1, 1)
            )
        ),
        "unknown_style"
    );
    assert_eq!(
        code(
            &mut h,
            paste(
                7,
                0,
                0,
                src(0, 0, 0, 0, 0),
                ok,
                PasteMode::All,
                false,
                (1, 1)
            )
        ),
        "unknown_sheet"
    );
    assert_eq!(input(&h, 0, 0, 0), "1");
}

#[test]
fn paste_patch_lists_dependents() {
    let mut h = numbers();
    let env = h
        .apply(paste(
            0,
            0,
            0,
            src(0, 5, 5, 5, 5),
            vec![clip(0, 0, "4", None)],
            PasteMode::All,
            false,
            (1, 1),
        ))
        .unwrap();
    let b1 = env.patch.cells[0]
        .cells
        .iter()
        .find(|c| (c.row, c.col) == (0, 1))
        .unwrap();
    assert_eq!(b1.display, "40");
}

// --- fill ---------------------------------------------------------------

fn fill(h: &mut CalcHost, s: Rect, d: Rect, mode: FillMode) {
    h.apply(C::FillRange {
        sheet: 0,
        src: s,
        dst: d,
        mode,
    })
    .unwrap();
}

#[test]
fn fill_series_one_two_to_ten() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "1");
    set(&mut h, 0, 1, 0, "2");
    fill(&mut h, rect(0, 0, 1, 0), rect(2, 0, 9, 0), FillMode::Auto);
    let col: Vec<String> = (0..10).map(|r| display(&h, 0, r, 0)).collect();
    assert_eq!(col, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    h.undo().unwrap();
    assert_eq!(input(&h, 0, 2, 0), "");
    assert_eq!(input(&h, 0, 9, 0), "");
    assert_eq!(input(&h, 0, 1, 0), "2");
}

#[test]
fn fill_single_number_copies_and_ctrl_counts() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "5");
    fill(&mut h, rect(0, 0, 0, 0), rect(1, 0, 2, 0), FillMode::Auto);
    assert_eq!(
        (input(&h, 0, 1, 0), input(&h, 0, 2, 0)),
        ("5".into(), "5".into())
    );
    fill(
        &mut h,
        rect(0, 0, 0, 0),
        rect(0, 1, 0, 3),
        FillMode::Alternate,
    );
    assert_eq!(input(&h, 0, 0, 3), "8");
}

#[test]
fn fill_up_and_left_extend_backwards() {
    let mut h = host();
    set(&mut h, 0, 5, 5, "10");
    set(&mut h, 0, 6, 5, "20");
    fill(&mut h, rect(5, 5, 6, 5), rect(3, 5, 4, 5), FillMode::Auto);
    assert_eq!(
        (input(&h, 0, 3, 5), input(&h, 0, 4, 5)),
        ("-10".into(), "0".into())
    );
    set(&mut h, 0, 0, 4, "Item3");
    fill(&mut h, rect(0, 4, 0, 4), rect(0, 2, 0, 3), FillMode::Auto);
    assert_eq!(
        (input(&h, 0, 0, 2), input(&h, 0, 0, 3)),
        ("Item1".into(), "Item2".into())
    );
}

#[test]
fn fill_formulas_shift_by_distance() {
    let mut h = numbers();
    fill(&mut h, rect(0, 1, 0, 1), rect(1, 1, 2, 1), FillMode::Auto);
    assert_eq!(input(&h, 0, 2, 1), "=A3*10");
    assert_eq!(display(&h, 0, 2, 1), "30");
    // Horizontally with a pattern of two cells.
    set(&mut h, 0, 4, 0, "=A1");
    set(&mut h, 0, 4, 1, "x");
    fill(&mut h, rect(4, 0, 4, 1), rect(4, 2, 4, 4), FillMode::Auto);
    assert_eq!(input(&h, 0, 4, 2), "=C1");
    assert_eq!(input(&h, 0, 4, 3), "x");
    assert_eq!(input(&h, 0, 4, 4), "=E1");
}

#[test]
fn fill_dates_step_by_day() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "45306");
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        patch: CellStyle {
            number_format: Some("yyyy-mm-dd".into()),
            ..Default::default()
        },
    })
    .unwrap();
    fill(&mut h, rect(0, 0, 0, 0), rect(1, 0, 2, 0), FillMode::Auto);
    assert_eq!(display(&h, 0, 2, 0), "2024-01-17");
    // The format is filled along.
    assert_eq!(own_style(&h, 0, 2, 0), own_style(&h, 0, 0, 0));
}

#[test]
fn fill_text_numbers_and_plain_text() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "Week 1");
    set(&mut h, 0, 0, 1, "label");
    fill(&mut h, rect(0, 0, 0, 1), rect(1, 0, 3, 1), FillMode::Auto);
    assert_eq!(input(&h, 0, 3, 0), "Week 4");
    assert_eq!(input(&h, 0, 3, 1), "label");
}

#[test]
fn fill_lines_are_independent() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "1");
    set(&mut h, 0, 1, 0, "3");
    set(&mut h, 0, 0, 1, "TRUE");
    fill(&mut h, rect(0, 0, 1, 1), rect(2, 0, 3, 1), FillMode::Auto);
    assert_eq!(
        (input(&h, 0, 3, 0), input(&h, 0, 3, 1)),
        ("7".into(), "".into())
    );
    assert_eq!(input(&h, 0, 2, 1), "TRUE");
}

#[test]
fn fill_copy_mode_repeats_numbers() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "1");
    set(&mut h, 0, 1, 0, "2");
    fill(&mut h, rect(0, 0, 1, 0), rect(2, 0, 4, 0), FillMode::Copy);
    let col: Vec<String> = (2..5).map(|r| input(&h, 0, r, 0)).collect();
    assert_eq!(col, ["1", "2", "1"]);
}

#[test]
fn fill_rejects_non_adjacent_targets() {
    let mut h = host();
    set(&mut h, 0, 0, 0, "1");
    for d in [
        rect(2, 0, 3, 0),
        rect(1, 0, 2, 1),
        rect(1, 1, 1, 1),
        rect(0, 0, 0, 0),
    ] {
        let err = h
            .apply(C::FillRange {
                sheet: 0,
                src: rect(0, 0, 0, 0),
                dst: d,
                mode: FillMode::Auto,
            })
            .unwrap_err();
        assert_eq!(err.code(), "invalid_range", "{d:?}");
    }
}

// --- find and preview ------------------------------------------------------

fn find(h: &mut CalcHost, req: Json) -> Vec<(u32, u32, u32)> {
    let mut body = json!({"type": "findCells"});
    body.as_object_mut()
        .unwrap()
        .extend(req.as_object().unwrap().clone());
    let reply: Json = serde_json::from_str(&dispatch(h, &body.to_string())).unwrap();
    let cells = reply["ok"]["cells"]
        .as_array()
        .unwrap_or_else(|| panic!("{reply}"));
    cells
        .iter()
        .map(|c| {
            (
                c["sheet"].as_u64().unwrap() as u32,
                c["row"].as_u64().unwrap() as u32,
                c["col"].as_u64().unwrap() as u32,
            )
        })
        .collect()
}

fn find_doc() -> CalcHost {
    let mut h = host();
    set(&mut h, 0, 2, 0, "Apple pie");
    set(&mut h, 0, 0, 1, "apple");
    set(&mut h, 0, 0, 3, "=1/4");
    set(&mut h, 1, 0, 0, "APPLE");
    h
}

#[test]
fn find_is_case_insensitive_and_row_major() {
    let mut h = find_doc();
    let q = json!({"sheet": 0, "query": "apple", "matchCase": false, "wholeCell": false});
    assert_eq!(find(&mut h, q), vec![(0, 0, 1), (0, 2, 0)]);
}

#[test]
fn find_match_case_and_whole_cell() {
    let mut h = find_doc();
    let q = json!({"sheet": null, "query": "APPLE", "matchCase": true, "wholeCell": false});
    assert_eq!(find(&mut h, q), vec![(1, 0, 0)]);
    let q = json!({"sheet": null, "query": "apple", "matchCase": false, "wholeCell": true});
    assert_eq!(find(&mut h, q), vec![(0, 0, 1), (1, 0, 0)]);
}

#[test]
fn find_searches_inputs_and_displayed_values() {
    let mut h = find_doc();
    let q = json!({"sheet": 0, "query": "0.25", "matchCase": false, "wholeCell": true});
    assert_eq!(find(&mut h, q), vec![(0, 0, 3)]);
    let q = json!({"sheet": 0, "query": "1/4", "matchCase": false, "wholeCell": false});
    assert_eq!(find(&mut h, q), vec![(0, 0, 3)]);
    let q = json!({"sheet": 0, "query": "", "matchCase": false, "wholeCell": false});
    assert!(find(&mut h, q).is_empty());
}

#[test]
fn find_reports_inputs_and_unknown_sheets() {
    let mut h = find_doc();
    let doc = h.doc();
    let found = doc.find_cells(Some(0), "PIE", false, false).unwrap();
    assert_eq!(found[0].input, "Apple pie");
    assert_eq!(
        doc.find_cells(Some(9), "x", false, false)
            .unwrap_err()
            .code(),
        "unknown_sheet"
    );
    let reply = dispatch(
        &mut h,
        r#"{"type":"findCells","sheet":9,"query":"x","matchCase":false,"wholeCell":false}"#,
    );
    assert!(reply.contains("unknown_sheet"), "{reply}");
}

fn preview(h: &mut CalcHost, value: f64, code: &str) -> String {
    let req = json!({"type": "formatPreview", "value": value, "code": code});
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    reply["ok"]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("{reply}"))
        .to_owned()
}

#[test]
fn format_preview_covers_the_dialog_categories() {
    let mut h = host();
    assert_eq!(preview(&mut h, 1234.567, "General"), "1234.567");
    assert_eq!(preview(&mut h, 1234.567, "0.00"), "1234.57");
    assert_eq!(preview(&mut h, 1234.567, "#,##0.0"), "1,234.6");
    assert_eq!(preview(&mut h, 0.256, "0.0%"), "25.6%");
    assert_eq!(preview(&mut h, 45306.0, "yyyy-mm-dd"), "2024-01-15");
    assert_eq!(preview(&mut h, 45306.0, "dd.mm.yyyy"), "15.01.2024");
    assert_eq!(preview(&mut h, 0.75, "h:mm"), "18:00");
    assert_eq!(preview(&mut h, 45306.0, "m/d/yyyy"), "1/15/2024");
    assert_eq!(preview(&mut h, 45306.0, "d-mmm-yy"), "15-Jan-24");
    assert_eq!(preview(&mut h, 45306.0, "mmmm d, yyyy"), "January 15, 2024");
    assert_eq!(
        preview(&mut h, 0.75 + 30.0 / 86400.0, "h:mm:ss"),
        "18:00:30"
    );
    assert_eq!(preview(&mut h, 0.0625, "mm:ss"), "30:00");
    assert_eq!(preview(&mut h, 12.5, "@"), "12.5");
}

#[test]
fn format_preview_currency_symbols() {
    let mut h = host();
    assert_eq!(preview(&mut h, 1234.5, "$#,##0.00"), "$1,234.50");
    assert_eq!(preview(&mut h, 1234.5, "#,##0.00 \"€\""), "1,234.50 €");
    assert_eq!(preview(&mut h, 1234.5, "\"£\"#,##0"), "£1,235");
}

#[test]
fn paste_command_round_trips_as_json() {
    let mut h = numbers();
    let req = json!({"type": "apply", "command": {
        "type": "pasteRange", "sheet": 0, "r0": 3, "c0": 1,
        "src": {"sheet": 0, "r0": 0, "c0": 1, "r1": 0, "c1": 1},
        "cells": [{"dr": 0, "dc": 0, "input": "=A1*10"}],
        "mode": "all", "cut": false, "repeatRows": 1, "repeatCols": 1}});
    let reply = dispatch(&mut h, &req.to_string());
    assert!(reply.contains(r#""input":"=A4*10""#), "{reply}");
    let req = json!({"type": "apply", "command": {
        "type": "fillRange", "sheet": 0, "src": {"r0": 0, "c0": 0, "r1": 2, "c1": 0},
        "dst": {"r0": 3, "c0": 0, "r1": 3, "c1": 0}, "mode": "alternate"}});
    let reply = dispatch(&mut h, &req.to_string());
    assert!(reply.contains(r#""input":"1""#), "{reply}");
}
