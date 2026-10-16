//! P8-44 (C-08): Format Cells › Border edges, alignment, protection and
//! their round trip through `.xlsx`.

use app_common::Host;
use calc_core::{BorderEdits, CalcCommand as C, CalcDocument, CalcHost, EdgeEdit};
use core_model::{Color, Rgb};
use model_sheet::{
    Alignment, BorderSide, BorderStyle, CellCoord, CellStyle, Fill, Protection, SheetId,
};

fn at(row: u32, col: u32) -> CellCoord {
    CellCoord::new(SheetId(0), row, col)
}

fn line(style: BorderStyle) -> EdgeEdit {
    EdgeEdit::Line {
        side: BorderSide {
            style,
            color: Color::Rgb(Rgb::new(255, 0, 0)),
        },
    }
}

fn borders(h: &CalcHost, row: u32, col: u32) -> model_sheet::Borders {
    h.doc().workbook().style(at(row, col)).borders
}

fn set_borders(h: &mut CalcHost, r1: u32, c1: u32, edits: BorderEdits) {
    h.apply(C::SetBorders {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1,
        c1,
        edits,
    })
    .unwrap();
}

#[test]
fn outline_sets_only_the_outer_edges() {
    let mut h = Host::new(CalcDocument::new());
    let thin = line(BorderStyle::Thin);
    set_borders(
        &mut h,
        1,
        1,
        BorderEdits {
            top: Some(thin),
            bottom: Some(thin),
            left: Some(thin),
            right: Some(thin),
            ..Default::default()
        },
    );
    let a1 = borders(&h, 0, 0);
    assert!(a1.top.is_some() && a1.left.is_some());
    assert!(a1.bottom.is_none() && a1.right.is_none());
    let b2 = borders(&h, 1, 1);
    assert!(b2.bottom.is_some() && b2.right.is_some());
    assert!(b2.top.is_none() && b2.left.is_none());
}

#[test]
fn inside_lines_none_and_undo() {
    let mut h = Host::new(CalcDocument::new());
    let med = line(BorderStyle::Medium);
    set_borders(
        &mut h,
        2,
        0,
        BorderEdits {
            inside_horizontal: Some(med),
            diagonal_down: Some(med),
            ..Default::default()
        },
    );
    // A2 (the middle row) gets top and bottom, A1 only its bottom.
    let a2 = borders(&h, 1, 0);
    assert_eq!(a2.top.map(|s| s.style), Some(BorderStyle::Medium));
    assert!(a2.bottom.is_some());
    assert!(borders(&h, 0, 0).top.is_none());
    assert!(borders(&h, 0, 0).bottom.is_some());
    assert!(borders(&h, 2, 0).diagonal_down.is_some());
    // None removes every line.
    let none = Some(EdgeEdit::None);
    set_borders(
        &mut h,
        2,
        0,
        BorderEdits {
            top: none,
            bottom: none,
            left: none,
            right: none,
            inside_horizontal: none,
            inside_vertical: none,
            diagonal_up: none,
            diagonal_down: none,
        },
    );
    assert!(borders(&h, 1, 0).is_default());
    h.undo().unwrap();
    assert!(borders(&h, 1, 0).top.is_some());
    h.undo().unwrap();
    assert!(borders(&h, 1, 0).is_default());
}

#[test]
fn format_cells_properties_survive_xlsx() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::SetInput {
        sheet: 0,
        row: 0,
        col: 0,
        input: "x".into(),
    })
    .unwrap();
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        patch: CellStyle {
            fill: Some(Fill::Solid(Color::Rgb(Rgb::new(255, 255, 0)))),
            alignment: Alignment {
                text_rotation: Some(45),
                shrink_to_fit: Some(true),
                indent: Some(1),
                ..Default::default()
            },
            protection: Protection {
                locked: Some(false),
                hidden: Some(true),
            },
            ..Default::default()
        },
    })
    .unwrap();
    let thin = line(BorderStyle::Thin);
    set_borders(
        &mut h,
        0,
        0,
        BorderEdits {
            top: Some(thin),
            bottom: Some(thin),
            left: Some(thin),
            right: Some(thin),
            diagonal_up: Some(thin),
            ..Default::default()
        },
    );
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, _) = CalcDocument::open_xlsx(&bytes, "t.xlsx").unwrap();
    let s = doc.workbook().style(at(0, 0)).clone();
    let before = h.doc().workbook().style(at(0, 0)).clone();
    assert_eq!(s, before);
    assert_eq!(s.alignment.text_rotation, Some(45));
    assert_eq!(s.protection.hidden, Some(true));
    assert!(s.borders.diagonal_up.is_some());
}
