//! P9-C4: calculation options and commands, Apply Names, Paste Names.

use app_common::Host;
use calc_core::{CalcCommand as C, CalcDocument, CalcHost, CalcModeWire, CalcOptions, NameDef};
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

fn shown(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(0), row, col))
        .display
}

fn input(h: &CalcHost, row: u32, col: u32) -> String {
    h.doc()
        .cell_view(CellCoord::new(SheetId(0), row, col))
        .input
}

fn manual() -> CalcOptions {
    CalcOptions {
        mode: CalcModeWire::Manual,
        full_calc_on_load: true,
        r1c1: false,
    }
}

#[test]
fn manual_mode_and_calculate_now() {
    let mut h = host();
    set(&mut h, 0, 0, "1");
    set(&mut h, 0, 1, "=A1*10");
    let p = h
        .apply(C::SetCalcOptions { options: manual() })
        .unwrap()
        .patch;
    let state = p.calc.expect("calc state in the patch");
    assert_eq!(state.options.mode, CalcModeWire::Manual);
    assert!(!state.needs_calc);
    let p = h
        .apply(C::SetInput {
            sheet: 0,
            row: 0,
            col: 0,
            input: "2".into(),
        })
        .unwrap()
        .patch;
    assert!(p.calc.expect("needs calc now").needs_calc);
    assert_eq!(shown(&h, 0, 1), "10");
    assert!(h.doc().info().calc.needs_calc);
    let p = h.apply(C::CalculateNow).unwrap().patch;
    assert!(!p.calc.unwrap().needs_calc);
    assert_eq!(shown(&h, 0, 1), "20");
    // Calculate Sheet.
    set(&mut h, 0, 0, "3");
    h.apply(C::CalculateSheet { sheet: 0 }).unwrap();
    assert_eq!(shown(&h, 0, 1), "30");
    // Undo of the options restores automatic mode.
    h.apply(C::SetCalcOptions {
        options: CalcOptions {
            mode: CalcModeWire::Automatic,
            ..manual()
        },
    })
    .unwrap();
    set(&mut h, 0, 0, "4");
    assert_eq!(shown(&h, 0, 1), "40");
    // The setting is saved.
    h.apply(C::SetCalcOptions { options: manual() }).unwrap();
    let bytes = calc_core::dispatch(&mut h, r#"{"type":"saveXlsx"}"#);
    assert!(bytes.contains("saved"), "{bytes}");
}

#[test]
fn apply_names_replaces_matching_references() {
    let mut h = host();
    for (r, v) in ["1", "2", "3"].iter().enumerate() {
        set(&mut h, r as u32, 0, v);
    }
    set(&mut h, 0, 2, "=SUM(A1:A3)+$B$1");
    set(&mut h, 1, 2, "=AVERAGE($A$1:$A$3)*A1:A3");
    set(&mut h, 2, 2, "=SUM(A1:A2)");
    for (name, refers) in [("Data", "Sheet1!$A$1:$A$3"), ("Rate", "Sheet1!$B$1")] {
        h.apply(C::DefineName {
            def: NameDef {
                name: name.into(),
                sheet: None,
                refers_to: refers.into(),
                comment: None,
                hidden: false,
                builtin: None,
            },
        })
        .unwrap();
    }
    h.apply(C::ApplyNames {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        names: vec!["Data".into(), "Rate".into()],
        ignore_relative: true,
    })
    .unwrap();
    assert_eq!(input(&h, 0, 2), "=SUM(Data)+Rate");
    assert_eq!(input(&h, 1, 2), "=AVERAGE(Data)*Data");
    assert_eq!(input(&h, 2, 2), "=SUM(A1:A2)");
    assert_eq!(shown(&h, 0, 2), "6");
    h.undo().unwrap();
    assert_eq!(input(&h, 0, 2), "=SUM(A1:A3)+$B$1");
    // Without "ignore relative/absolute" only absolute references match.
    h.apply(C::ApplyNames {
        sheet: 0,
        r0: 0,
        c0: 2,
        r1: 2,
        c1: 2,
        names: vec!["Data".into()],
        ignore_relative: false,
    })
    .unwrap();
    assert_eq!(input(&h, 0, 2), "=SUM(A1:A3)+$B$1");
    assert_eq!(input(&h, 1, 2), "=AVERAGE(Data)*A1:A3");
}

#[test]
fn paste_name_list_writes_names_and_definitions() {
    let mut h = host();
    for (name, refers) in [("Zeta", "Sheet1!$A$1"), ("alpha", "0.19")] {
        h.apply(C::DefineName {
            def: NameDef {
                name: name.into(),
                sheet: None,
                refers_to: refers.into(),
                comment: None,
                hidden: false,
                builtin: None,
            },
        })
        .unwrap();
    }
    h.apply(C::PasteNameList {
        sheet: 0,
        row: 4,
        col: 1,
    })
    .unwrap();
    assert_eq!(shown(&h, 4, 1), "alpha");
    assert_eq!(shown(&h, 4, 2), "=0.19");
    assert_eq!(shown(&h, 5, 1), "Zeta");
    assert_eq!(shown(&h, 5, 2), "=Sheet1!$A$1");
    h.undo().unwrap();
    assert_eq!(shown(&h, 4, 1), "");
}

#[test]
fn names_referring_to_a_deleted_sheet_are_ref_errors() {
    let mut h = host();
    h.apply(C::AddSheet {
        name: "Data".into(),
        index: None,
    })
    .unwrap();
    let data = h.doc().info().sheets[1].id;
    h.apply(C::SetInput {
        sheet: data,
        row: 0,
        col: 0,
        input: "5".into(),
    })
    .unwrap();
    h.apply(C::DefineName {
        def: NameDef {
            name: "Five".into(),
            sheet: None,
            refers_to: "Data!$A$1".into(),
            comment: None,
            hidden: false,
            builtin: None,
        },
    })
    .unwrap();
    set(&mut h, 0, 0, "=Five*2");
    assert_eq!(shown(&h, 0, 0), "10");
    h.apply(C::DeleteSheet { sheet: data }).unwrap();
    assert_eq!(shown(&h, 0, 0), "#REF!");
    let names = h.doc().info().names;
    assert_eq!(names[0].def.refers_to, "#REF!");
}
