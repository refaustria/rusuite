//! P8-35: Paste Special (parts, operations, skip blanks, transpose,
//! paste link) as one undo step each.

use app_common::Host;
use calc_core::{
    CalcCommand as C, CalcDocument, CalcHost, ClipCell, PasteMode, PasteOperation as Op,
    PasteParts as P, PasteSpecial, SheetRect,
};
use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::{CellStyle, NoteRun, WorkbookSnapshot};

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

/// Source A1:B2 = 2 | =A1*3 / (blank) | x; A1 bold with a number
/// format, B2 with a border. Destination area D1:E2 holds 10, 20, 30, 40.
fn setup() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, c, v) in [(0, 0, "2"), (0, 1, "=A1*3"), (1, 1, "x")] {
        h.apply(set(r, c, v)).unwrap();
    }
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        patch: CellStyle {
            font: core_model::RunProperties {
                bold: Some(true),
                ..Default::default()
            },
            number_format: Some("0.00".into()),
            ..Default::default()
        },
    })
    .unwrap();
    let thin = model_sheet::BorderSide {
        style: model_sheet::BorderStyle::Thin,
        color: core_model::Color::Rgb(core_model::Rgb::new(0, 0, 0)),
    };
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 1,
        c0: 1,
        r1: 1,
        c1: 1,
        patch: CellStyle {
            borders: model_sheet::Borders {
                bottom: Some(thin),
                ..Default::default()
            },
            ..Default::default()
        },
    })
    .unwrap();
    for (r, c, v) in [(0, 3, "10"), (0, 4, "20"), (1, 3, "30"), (1, 4, "40")] {
        h.apply(set(r, c, v)).unwrap();
    }
    h
}

fn clip(h: &CalcHost) -> Vec<ClipCell> {
    let wb = h.doc().workbook();
    wb.cells_in(model_sheet::CellRange::new(SheetId(0), 0, 0, 1, 1))
        .map(|(c, content, style)| ClipCell {
            dr: c.row,
            dc: c.col,
            input: model_sheet::content_to_input(content),
            style: Some(style.0),
        })
        .collect()
}

fn paste(h: &mut CalcHost, sp: PasteSpecial, at: (u32, u32)) {
    let cells = clip(h);
    let cmd = C::PasteRange {
        sheet: 0,
        r0: at.0,
        c0: at.1,
        src: SheetRect {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 1,
            c1: 1,
        },
        cells,
        mode: PasteMode::All,
        cut: false,
        repeat_rows: 1,
        repeat_cols: 1,
        annotations: false,
        special: Some(sp),
    };
    let snap = |h: &CalcHost| WorkbookSnapshot {
        styles: Vec::new(),
        ..h.doc().workbook().to_snapshot()
    };
    let before = snap(h);
    h.apply(cmd.clone()).unwrap();
    let after = snap(h);
    h.undo().unwrap();
    assert_eq!(snap(h), before, "undo {sp:?}");
    h.redo().unwrap();
    assert_eq!(snap(h), after, "redo {sp:?}");
}

fn v(h: &CalcHost, r: u32, c: u32) -> Value {
    h.doc().workbook().value(CellCoord::new(SheetId(0), r, c))
}

fn input(h: &CalcHost, r: u32, c: u32) -> String {
    model_sheet::content_to_input(h.doc().workbook().content(CellCoord::new(SheetId(0), r, c)))
}

fn style(h: &CalcHost, r: u32, c: u32) -> CellStyle {
    h.doc()
        .workbook()
        .style(CellCoord::new(SheetId(0), r, c))
        .clone()
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn sp(parts: P) -> PasteSpecial {
    PasteSpecial {
        parts,
        ..Default::default()
    }
}

#[test]
fn all_and_formulas() {
    let mut h = setup();
    paste(&mut h, sp(P::All), (0, 3));
    assert_eq!(input(&h, 0, 4), "=D1*3");
    assert_eq!(v(&h, 0, 4), n(6.0));
    assert_eq!(style(&h, 0, 3).font.bold, Some(true));
    // The blank source cell pastes as a blank.
    assert_eq!(v(&h, 1, 3), Value::Empty);
    let mut h = setup();
    paste(&mut h, sp(P::Formulas), (0, 3));
    assert_eq!(input(&h, 0, 4), "=D1*3");
    assert_eq!(style(&h, 0, 3).font.bold, None);
}

#[test]
fn values_and_formats() {
    let mut h = setup();
    paste(&mut h, sp(P::Values), (0, 3));
    assert_eq!(input(&h, 0, 4), "6");
    assert_eq!(style(&h, 0, 3).number_format, None);
    let mut h = setup();
    paste(&mut h, sp(P::Formats), (0, 3));
    assert_eq!(v(&h, 0, 3), n(10.0));
    assert_eq!(style(&h, 0, 3).font.bold, Some(true));
    assert!(style(&h, 1, 4).borders.bottom.is_some());
}

#[test]
fn number_formats_and_borders() {
    let mut h = setup();
    paste(&mut h, sp(P::ValuesAndNumberFormats), (0, 3));
    assert_eq!(input(&h, 0, 3), "2");
    assert_eq!(style(&h, 0, 3).number_format.as_deref(), Some("0.00"));
    assert_eq!(style(&h, 0, 3).font.bold, None);
    let mut h = setup();
    paste(&mut h, sp(P::FormulasAndNumberFormats), (0, 3));
    assert_eq!(input(&h, 0, 4), "=D1*3");
    assert_eq!(style(&h, 0, 3).number_format.as_deref(), Some("0.00"));
    let mut h = setup();
    paste(&mut h, sp(P::AllExceptBorders), (0, 3));
    assert!(style(&h, 1, 4).borders.bottom.is_none());
    assert_eq!(style(&h, 0, 3).font.bold, Some(true));
}

#[test]
fn operations() {
    let cases = [
        (Op::Add, [12.0, 26.0, 30.0]),
        (Op::Subtract, [8.0, 14.0, 30.0]),
        (Op::Multiply, [20.0, 120.0, 0.0]),
    ];
    for (op, want) in cases {
        let mut h = setup();
        paste(
            &mut h,
            PasteSpecial {
                parts: P::Values,
                operation: op,
                ..Default::default()
            },
            (0, 3),
        );
        assert_eq!(v(&h, 0, 3), n(want[0]), "{op:?}");
        assert_eq!(v(&h, 0, 4), n(want[1]), "{op:?}");
        assert_eq!(v(&h, 1, 3), n(want[2]), "{op:?} with a blank source");
        // Text sources leave the destination.
        assert_eq!(v(&h, 1, 4), n(40.0), "{op:?}");
    }
    let mut h = setup();
    paste(
        &mut h,
        PasteSpecial {
            parts: P::Values,
            operation: Op::Divide,
            ..Default::default()
        },
        (0, 3),
    );
    assert_eq!(v(&h, 0, 3), n(5.0));
    assert_eq!(v(&h, 1, 3), Value::Error(engine_formula::ErrorKind::Div0));
    // Onto a formula: the formula is wrapped.
    let mut h = setup();
    h.apply(set(0, 3, "=1+1")).unwrap();
    paste(
        &mut h,
        PasteSpecial {
            parts: P::All,
            operation: Op::Multiply,
            ..Default::default()
        },
        (0, 3),
    );
    assert_eq!(input(&h, 0, 3), "=(1+1)*2");
    assert_eq!(v(&h, 0, 3), n(4.0));
}

#[test]
fn skip_blanks_and_transpose() {
    let mut h = setup();
    paste(
        &mut h,
        PasteSpecial {
            parts: P::All,
            skip_blanks: true,
            ..Default::default()
        },
        (0, 3),
    );
    assert_eq!(v(&h, 1, 3), n(30.0), "skipped");
    assert_eq!(v(&h, 0, 3), n(2.0));
    let mut h = setup();
    paste(
        &mut h,
        PasteSpecial {
            parts: P::All,
            transpose: true,
            ..Default::default()
        },
        (5, 0),
    );
    // A1 → A6, B1 → A7, B2 → B7.
    assert_eq!(v(&h, 5, 0), n(2.0));
    assert_eq!(input(&h, 6, 0), "=A6*3");
    assert_eq!(v(&h, 6, 0), n(6.0));
    assert_eq!(v(&h, 6, 1), Value::Text("x".into()));
    assert_eq!(v(&h, 5, 1), Value::Empty);
    let mut h = setup();
    paste(
        &mut h,
        PasteSpecial {
            parts: P::Values,
            transpose: true,
            ..Default::default()
        },
        (5, 0),
    );
    assert_eq!(input(&h, 6, 0), "6");
}

#[test]
fn paste_link() {
    let mut h = setup();
    paste(
        &mut h,
        PasteSpecial {
            link: true,
            ..Default::default()
        },
        (5, 2),
    );
    assert_eq!(input(&h, 5, 2), "=A1");
    assert_eq!(input(&h, 6, 3), "=B2");
    assert_eq!(v(&h, 5, 3), n(6.0));
    // From another sheet: `=Sheet1!A1`.
    let mut h = setup();
    h.apply(C::AddSheet {
        name: "Two".into(),
        index: None,
    })
    .unwrap();
    let cells = clip(&h);
    h.apply(C::PasteRange {
        sheet: 1,
        r0: 0,
        c0: 0,
        src: SheetRect {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 1,
            c1: 1,
        },
        cells,
        mode: PasteMode::All,
        cut: false,
        repeat_rows: 1,
        repeat_cols: 1,
        annotations: false,
        special: Some(PasteSpecial {
            link: true,
            ..Default::default()
        }),
    })
    .unwrap();
    let wb = h.doc().workbook();
    assert_eq!(
        wb.formula_text(CellCoord::new(SheetId(1), 0, 1)),
        Some("=Sheet1!B1")
    );
    assert_eq!(wb.value(CellCoord::new(SheetId(1), 0, 1)), n(6.0));
}

#[test]
fn comments_validation_and_widths() {
    let mut h = setup();
    h.apply(C::SetNote {
        sheet: 0,
        row: 0,
        col: 0,
        text: vec![NoteRun::plain("hello")],
        author: Some("Me".into()),
        visible: None,
        bounds: None,
    })
    .unwrap();
    h.apply(C::SetValidation {
        sheet: 0,
        validation: model_sheet::DataValidation::new(
            vec![engine_formula::CellRect {
                r0: 1,
                c0: 1,
                r1: 1,
                c1: 1,
            }],
            model_sheet::ValidationKind::Whole {
                op: model_sheet::CompareOp::LessThan,
                f1: "5".into(),
                f2: None,
            },
        ),
    })
    .unwrap();
    h.apply(C::SetColWidth {
        sheet: 0,
        col: 1,
        width: Some(30.0),
    })
    .unwrap();
    paste(&mut h, sp(P::Comments), (0, 3));
    let wb = h.doc().workbook();
    assert!(wb.note_at(CellCoord::new(SheetId(0), 0, 3)).is_some());
    assert_eq!(wb.value(CellCoord::new(SheetId(0), 0, 3)), n(10.0));
    paste(&mut h, sp(P::Validation), (0, 3));
    assert!(h
        .doc()
        .workbook()
        .validation_at(CellCoord::new(SheetId(0), 1, 4))
        .is_some());
    paste(&mut h, sp(P::ColumnWidths), (0, 3));
    assert_eq!(h.doc().workbook().col_info(SheetId(0), 4).width, Some(30.0));
    assert_eq!(v(&h, 0, 4), n(20.0));
    paste(&mut h, sp(P::AllAndColumnWidths), (0, 6));
    assert_eq!(h.doc().workbook().col_info(SheetId(0), 7).width, Some(30.0));
    assert_eq!(input(&h, 0, 7), "=G1*3");
}

#[test]
fn cut_with_special_is_refused() {
    let mut h = setup();
    let cells = clip(&h);
    let e = h
        .apply(C::PasteRange {
            sheet: 0,
            r0: 5,
            c0: 5,
            src: SheetRect {
                sheet: 0,
                r0: 0,
                c0: 0,
                r1: 1,
                c1: 1,
            },
            cells,
            mode: PasteMode::All,
            cut: true,
            repeat_rows: 1,
            repeat_cols: 1,
            annotations: false,
            special: Some(sp(P::Values)),
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_range");
}
