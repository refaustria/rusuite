//! P9-C1: border presets clear the neighbours' facing sides (one undo
//! step); pattern fills and accounting underlines survive save → open.

use app_common::Host;
use calc_core::{BorderEdits, CalcCommand as C, CalcDocument, EdgeEdit};
use core_model::{Color, RunProperties, Underline};
use model_sheet::{
    BorderSide, BorderStyle, Borders, CellCoord, CellStyle, Fill, PatternFill, PatternType, SheetId,
};

fn at(row: u32, col: u32) -> CellCoord {
    CellCoord::new(SheetId(0), row, col)
}

fn line() -> Option<BorderSide> {
    Some(BorderSide {
        style: BorderStyle::Thick,
        color: Color::Auto,
    })
}

#[test]
fn no_border_clears_the_shared_edges_of_neighbours() {
    let mut h = Host::new(CalcDocument::new());
    // A1 has a bottom line, A3 a top line, B2's neighbours left/right.
    for (row, col, borders) in [
        (
            0,
            1,
            Borders {
                bottom: line(),
                ..Default::default()
            },
        ),
        (
            2,
            1,
            Borders {
                top: line(),
                ..Default::default()
            },
        ),
        (
            1,
            0,
            Borders {
                right: line(),
                ..Default::default()
            },
        ),
        (
            1,
            2,
            Borders {
                left: line(),
                right: line(),
                ..Default::default()
            },
        ),
    ] {
        h.apply(C::ApplyStyle {
            sheet: 0,
            r0: row,
            c0: col,
            r1: row,
            c1: col,
            patch: CellStyle {
                borders,
                ..Default::default()
            },
        })
        .unwrap();
    }
    let none = Some(EdgeEdit::None);
    let edits = BorderEdits {
        top: none,
        bottom: none,
        left: none,
        right: none,
        ..Default::default()
    };
    h.apply(C::SetBorders {
        sheet: 0,
        r0: 1,
        c0: 1,
        r1: 1,
        c1: 1,
        edits,
    })
    .unwrap();
    let wb = h.doc().workbook();
    assert!(wb.style(at(0, 1)).borders.bottom.is_none());
    assert!(wb.style(at(2, 1)).borders.top.is_none());
    assert!(wb.style(at(1, 0)).borders.right.is_none());
    let c2 = wb.style(at(1, 2)).borders;
    assert!(
        c2.left.is_none() && c2.right.is_some(),
        "only the facing side goes"
    );
    // One undo step brings all four back.
    h.undo().unwrap();
    let wb = h.doc().workbook();
    assert!(wb.style(at(0, 1)).borders.bottom.is_some());
    assert!(wb.style(at(1, 2)).borders.left.is_some());
    // Adding a line also replaces the neighbour's facing side.
    let thin = Some(EdgeEdit::Line {
        side: BorderSide {
            style: BorderStyle::Thin,
            color: Color::Auto,
        },
    });
    h.apply(C::SetBorders {
        sheet: 0,
        r0: 1,
        c0: 1,
        r1: 1,
        c1: 1,
        edits: BorderEdits {
            top: thin,
            ..Default::default()
        },
    })
    .unwrap();
    let wb = h.doc().workbook();
    assert!(wb.style(at(0, 1)).borders.bottom.is_none());
    assert_eq!(
        wb.style(at(1, 1)).borders.top.unwrap().style,
        BorderStyle::Thin
    );
}

#[test]
fn pattern_and_accounting_underline_survive_save_and_open() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::SetInput {
        sheet: 0,
        row: 0,
        col: 0,
        input: "Total".into(),
    })
    .unwrap();
    let patch = CellStyle {
        font: RunProperties {
            underline: Some(Underline::Double),
            ..Default::default()
        },
        underline_accounting: Some(true),
        fill: Some(Fill::Pattern(PatternFill {
            pattern: PatternType::LightTrellis,
            fg: Some(Color::Rgb(core_model::Rgb::new(0, 0x80, 0))),
            bg: None,
        })),
        ..Default::default()
    };
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        patch,
    })
    .unwrap();
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "f.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let style = doc.workbook().style(at(0, 0));
    assert_eq!(style.underline_accounting, Some(true));
    assert_eq!(style.font.underline, Some(Underline::Double));
    assert!(matches!(
        style.fill,
        Some(Fill::Pattern(PatternFill {
            pattern: PatternType::LightTrellis,
            ..
        }))
    ));
}
