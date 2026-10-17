//! P9-C4: error checking rules, Evaluate Formula steps, Watch Window,
//! Convert to Number.

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost, ErrorRule, Rect, WatchCell};
use model_sheet::{CellCoord, SheetId};

fn host() -> CalcHost {
    Host::new(CalcDocument::new())
}

fn set(h: &mut CalcHost, row: u32, col: u32, input: &str) {
    h.apply(C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    })
    .unwrap();
}

const ALL: [ErrorRule; 5] = [
    ErrorRule::ErrorValue,
    ErrorRule::InconsistentFormula,
    ErrorRule::NumberAsText,
    ErrorRule::EmptyCellRefs,
    ErrorRule::UnlockedFormula,
];

#[test]
fn error_checking_rules() {
    let mut h = host();
    set(&mut h, 0, 0, "1");
    set(&mut h, 1, 0, "2");
    set(&mut h, 2, 0, "3");
    // B1:B3: =A1*2 except an inconsistent B2.
    set(&mut h, 0, 1, "=A1*2");
    set(&mut h, 1, 1, "=A2*3");
    set(&mut h, 2, 1, "=A3*2");
    set(&mut h, 0, 3, "'42");
    set(&mut h, 1, 3, "=1/0");
    set(&mut h, 2, 3, "=Z99+1");
    let issues = h.doc().error_checks(0, &ALL).unwrap();
    let found: Vec<(u32, u32, ErrorRule)> = issues.iter().map(|i| (i.row, i.col, i.rule)).collect();
    assert_eq!(
        found,
        [
            (0, 3, ErrorRule::NumberAsText),
            (1, 1, ErrorRule::InconsistentFormula),
            (1, 3, ErrorRule::ErrorValue),
            (2, 3, ErrorRule::EmptyCellRefs),
        ]
    );
    assert_eq!(issues[1].suggestion.as_deref(), Some("=A2*2"));
    // Excel's defaults leave out "formulas referring to empty cells".
    assert_eq!(
        h.doc()
            .error_checks(0, &calc_core::DEFAULT_RULES)
            .unwrap()
            .len(),
        3
    );
    // Unlocked formula cells.
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 1,
        r1: 0,
        c1: 1,
        patch: model_sheet::CellStyle {
            protection: model_sheet::style::Protection {
                locked: Some(false),
                hidden: None,
            },
            ..Default::default()
        },
    })
    .unwrap();
    let issues = h
        .doc()
        .error_checks(0, &[ErrorRule::UnlockedFormula])
        .unwrap();
    assert_eq!(issues.len(), 1);
    assert_eq!((issues[0].row, issues[0].col), (0, 1));
}

#[test]
fn convert_to_number() {
    let mut h = host();
    set(&mut h, 0, 0, "'42");
    set(&mut h, 1, 0, "=A1+1");
    let v = |h: &CalcHost, r| h.doc().cell_view(CellCoord::new(SheetId(0), r, 0));
    assert_eq!(h.doc().error_checks(0, &ALL).unwrap().len(), 1);
    h.apply(C::ConvertToNumber {
        sheet: 0,
        cells: vec![Rect {
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
        }],
    })
    .unwrap();
    assert_eq!(v(&h, 0).input, "42");
    assert_eq!(v(&h, 1).display, "43");
    assert!(h.doc().error_checks(0, &ALL).unwrap().is_empty());
    h.undo().unwrap();
    assert_eq!(v(&h, 0).input, "'42");
}

#[test]
fn evaluate_formula_steps() {
    let mut h = host();
    set(&mut h, 0, 0, "1");
    set(&mut h, 1, 0, "2");
    set(&mut h, 0, 1, "10");
    set(&mut h, 2, 2, "=SUM(A1:A2)*B1");
    let e = h.doc().evaluate_steps(0, 2, 2).unwrap();
    assert_eq!(e.formula, "=SUM(A1:A2)*B1");
    let steps: Vec<(String, String, String)> = e
        .steps
        .iter()
        .map(|s| {
            let u: Vec<u16> = s.text.encode_utf16().collect();
            let part = String::from_utf16(&u[s.start as usize..s.end as usize]).unwrap();
            (s.text.clone(), part, s.value.clone())
        })
        .collect();
    assert_eq!(
        steps,
        [
            ("=SUM(A1:A2)*B1".into(), "SUM(A1:A2)".into(), "3".into()),
            ("=3*B1".into(), "B1".into(), "10".into()),
            ("=3*10".into(), "3*10".into(), "30".into()),
        ]
    );
    assert_eq!(e.result, "30");
    // Step In: a reference to a formula cell.
    set(&mut h, 3, 2, "=C3+(A1-1)*2");
    let e = h.doc().evaluate_steps(0, 3, 2).unwrap();
    let first = &e.steps[0];
    assert_eq!(first.value, "30");
    assert_eq!(first.step_in.map(|r| (r.r0, r.c0)), Some((2, 2)));
    let texts: Vec<&str> = e.steps.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "=C3+(A1-1)*2",
            "=30+(A1-1)*2",
            "=30+(1-1)*2",
            "=30+0*2",
            "=30+0"
        ]
    );
    // A constant cell: no steps.
    assert!(h.doc().evaluate_steps(0, 0, 0).unwrap().steps.is_empty());
}

#[test]
fn watch_window_values() {
    let mut h = host();
    set(&mut h, 0, 0, "5");
    set(&mut h, 0, 1, "=A1*2");
    let items = h.doc().watch_cells(&[
        WatchCell {
            sheet: 0,
            row: 0,
            col: 1,
        },
        WatchCell {
            sheet: 9,
            row: 0,
            col: 0,
        },
    ]);
    assert_eq!(items[0].value, "10");
    assert_eq!(items[0].formula.as_deref(), Some("=A1*2"));
    assert_eq!(items[0].sheet_name.as_deref(), Some("Sheet1"));
    assert_eq!(items[1].value, "#REF!");
    let reply = calc_core::dispatch(
        &mut h,
        r#"{"type":"watchCells","cells":[{"sheet":0,"row":0,"col":1}]}"#,
    );
    assert!(reply.contains(r#""value":"10""#), "{reply}");
    let reply = calc_core::dispatch(&mut h, r#"{"type":"errorChecks","sheet":0}"#);
    assert!(reply.contains(r#""type":"errorChecks""#), "{reply}");
    let reply = calc_core::dispatch(
        &mut h,
        r#"{"type":"evaluateFormula","sheet":0,"row":0,"col":1}"#,
    );
    assert!(reply.contains(r#""steps""#), "{reply}");
}
