//! P9-C5: conditional formatting and validations follow pasted, cut,
//! sorted and renamed cells, as one undo step with the edit.

use app_common::Host;
use calc_core::{
    CalcCommand as C, CalcDocument, CalcHost, ClipCell, PasteMode, PasteParts, PasteSpecial,
    SheetRect,
};
use engine_formula::{CellRect, SheetId};
use model_sheet::{CfKind, CfRule, DataValidation, DxfStyle, SortKey, SortKind, ValidationKind};

fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
    CellRect { r0, c0, r1, c1 }
}

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

fn rule(ranges: Vec<CellRect>, formula: &str) -> CfRule {
    CfRule {
        ranges,
        dxf: Some(DxfStyle {
            bold: Some(true),
            ..Default::default()
        }),
        ..CfRule::new(CfKind::Expression {
            formula: formula.into(),
        })
    }
}

fn host() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for (r, v) in ["3", "1", "2"].iter().enumerate() {
        h.apply(set(r as u32, 0, v)).unwrap();
    }
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: rule(vec![rect(0, 0, 0, 0)], "A1>2"),
    })
    .unwrap();
    h.apply(C::SetValidation {
        sheet: 0,
        validation: DataValidation::new(
            vec![rect(0, 0, 0, 0)],
            ValidationKind::Custom {
                formula: "A1>0".into(),
            },
        ),
    })
    .unwrap();
    h
}

fn ranges(h: &CalcHost) -> (Vec<CellRect>, Vec<CellRect>) {
    let wb = h.doc().workbook();
    (
        wb.cf_rules(SheetId(0))
            .iter()
            .flat_map(|r| r.ranges.clone())
            .collect(),
        wb.validations(SheetId(0))
            .iter()
            .flat_map(|v| v.ranges.clone())
            .collect(),
    )
}

fn paste(at: (u32, u32), mode: PasteMode, cut: bool, special: Option<PasteSpecial>) -> C {
    C::PasteRange {
        sheet: 0,
        r0: at.0,
        c0: at.1,
        src: SheetRect {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
        },
        cells: vec![ClipCell {
            dr: 0,
            dc: 0,
            input: "3".into(),
            style: Some(0),
        }],
        mode,
        cut,
        repeat_rows: 1,
        repeat_cols: 1,
        annotations: true,
        special,
    }
}

#[test]
fn copy_paste_extends_rules_and_undo_restores() {
    let mut h = host();
    let before = ranges(&h);
    h.apply(paste((1, 0), PasteMode::All, false, None)).unwrap();
    assert_eq!(ranges(&h), (vec![rect(0, 0, 1, 0)], vec![rect(0, 0, 1, 0)]));
    h.undo().unwrap();
    assert_eq!(ranges(&h), before);
    h.redo().unwrap();
    assert_eq!(ranges(&h).0, vec![rect(0, 0, 1, 0)]);
    // Paste Formats: the rule, not the validation.
    h.apply(paste((5, 0), PasteMode::FormatsOnly, false, None))
        .unwrap();
    let (cf, dv) = ranges(&h);
    assert_eq!(cf, vec![rect(0, 0, 1, 0), rect(5, 0, 5, 0)]);
    assert_eq!(dv, vec![rect(0, 0, 1, 0)]);
    // Paste Special › Validation: the validation only.
    let special = PasteSpecial {
        parts: PasteParts::Validation,
        ..Default::default()
    };
    h.apply(paste((7, 0), PasteMode::All, false, Some(special)))
        .unwrap();
    let (cf, dv) = ranges(&h);
    assert_eq!(cf.len(), 2);
    assert_eq!(dv, vec![rect(0, 0, 1, 0), rect(7, 0, 7, 0)]);
    // Values only carries nothing.
    h.apply(paste((9, 0), PasteMode::ValuesOnly, false, None))
        .unwrap();
    assert_eq!(ranges(&h).0.len(), 2);
}

#[test]
fn cut_paste_and_sort_move_rules_with_the_cells() {
    let mut h = host();
    h.apply(paste((0, 3), PasteMode::All, true, None)).unwrap();
    assert_eq!(ranges(&h), (vec![rect(0, 3, 0, 3)], vec![rect(0, 3, 0, 3)]));
    assert_eq!(
        h.doc().workbook().cf_rules(SheetId(0))[0].kind,
        CfKind::Expression {
            formula: "D1>2".into()
        }
    );
    h.undo().unwrap();
    assert_eq!(ranges(&h), (vec![rect(0, 0, 0, 0)], vec![rect(0, 0, 0, 0)]));
    // Sort A1:A3 ascending: the 3 (with its rule) goes to A3.
    h.apply(C::SortRange {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 2,
        c1: 0,
        keys: vec![SortKey {
            col: 0,
            ascending: true,
            kind: SortKind::Auto,
            ..Default::default()
        }],
        has_header: false,
        case_sensitive: false,
        columns: false,
    })
    .unwrap();
    assert_eq!(ranges(&h), (vec![rect(2, 0, 2, 0)], vec![rect(2, 0, 2, 0)]));
    h.undo().unwrap();
    assert_eq!(ranges(&h), (vec![rect(0, 0, 0, 0)], vec![rect(0, 0, 0, 0)]));
}

#[test]
fn renaming_a_sheet_rewrites_rules_and_undo_renames_back() {
    let mut h = host();
    h.apply(C::AddSheet {
        name: "Data".into(),
        index: None,
    })
    .unwrap();
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: rule(vec![rect(5, 0, 5, 0)], "A6>Data!$A$1"),
    })
    .unwrap();
    h.apply(C::RenameSheet {
        sheet: 1,
        name: "Totals".into(),
    })
    .unwrap();
    let f = |h: &CalcHost| h.doc().workbook().cf_rules(SheetId(0))[0].kind.clone();
    assert_eq!(
        f(&h),
        CfKind::Expression {
            formula: "A6>Totals!$A$1".into()
        }
    );
    h.undo().unwrap();
    assert_eq!(
        f(&h),
        CfKind::Expression {
            formula: "A6>Data!$A$1".into()
        }
    );
}

#[test]
fn invalid_cells_request() {
    let mut h = host();
    // A1 = 3 passes A1>0; A2 = -1 under a whole-number validation fails.
    h.apply(set(1, 0, "-1")).unwrap();
    h.apply(C::SetValidation {
        sheet: 0,
        validation: DataValidation::new(
            vec![rect(1, 0, 5, 0)],
            ValidationKind::Whole {
                op: model_sheet::CompareOp::GreaterThan,
                f1: "0".into(),
                f2: None,
            },
        ),
    })
    .unwrap();
    let reply: serde_json::Value = serde_json::from_str(&calc_core::dispatch(
        &mut h,
        r#"{"type":"invalidCells","sheet":0}"#,
    ))
    .unwrap();
    assert_eq!(
        reply["ok"],
        serde_json::json!({"type":"invalidCells","cells":[{"r0":1,"c0":0,"r1":1,"c1":0}]})
    );
}

#[test]
fn typing_under_an_auto_filter_grows_it_and_undo_shrinks_it() {
    let mut h = host();
    h.apply(C::SetAutoFilter {
        sheet: 0,
        range: Some(calc_core::Rect {
            r0: 0,
            c0: 0,
            r1: 2,
            c1: 1,
        }),
    })
    .unwrap();
    let r1 = |h: &CalcHost| h.doc().workbook().auto_filter(SheetId(0)).unwrap().r1;
    let r1_before = r1(&h);
    h.apply(set(r1_before + 1, 1, "7")).unwrap();
    assert_eq!(r1(&h), r1_before + 1);
    h.undo().unwrap();
    assert_eq!(r1(&h), r1_before);
    // Two rows below: no growth.
    h.apply(set(r1_before + 2, 0, "7")).unwrap();
    assert_eq!(r1(&h), r1_before);
}

#[test]
fn line_colors_and_sort_by_colour_through_dispatch() {
    let mut h = host();
    let reply: serde_json::Value = serde_json::from_str(&calc_core::dispatch(
        &mut h,
        r#"{"type":"lineColors","sheet":0,"r0":0,"c0":0,"r1":2,"c1":0,"line":0}"#,
    ))
    .unwrap();
    // A1 = 3 > 2 is bold (the rule's dxf has no fill): no fills, no icons.
    assert_eq!(
        reply["ok"],
        serde_json::json!({"type":"lineColors","colors":{"fills":[null],"fonts":[null],"icons":[]}})
    );
    let cmd: C = serde_json::from_value(serde_json::json!({
        "type": "sortRange", "sheet": 0, "r0": 0, "c0": 0, "r1": 2, "c1": 0,
        "keys": [{"col": 0, "ascending": true, "sortOn": {"type": "cellColor"}}],
        "hasHeader": false, "caseSensitive": false
    }))
    .unwrap();
    h.apply(cmd).unwrap();
    let st = h.doc().workbook().sort_state(SheetId(0)).unwrap().clone();
    assert_eq!(
        st.keys[0].sort_on,
        model_sheet::SortOn::CellColor { color: None }
    );
}
