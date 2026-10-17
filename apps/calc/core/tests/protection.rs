//! P9-C1: sheet and workbook protection.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcError, CalcHost};
use model_sheet::{CellCoord, CellStyle, Protection, SheetId, SheetProtection};

fn host() -> CalcHost {
    Host::new(CalcDocument::new())
}

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

fn unlock(r0: u32, c0: u32, r1: u32, c1: u32, hidden: bool) -> C {
    C::ApplyStyle {
        sheet: 0,
        r0,
        c0,
        r1,
        c1,
        patch: CellStyle {
            protection: Protection {
                locked: Some(false),
                hidden: hidden.then_some(true),
            },
            ..Default::default()
        },
    }
}

fn protect(options: SheetProtection, password: Option<&str>) -> C {
    C::ProtectSheet {
        sheet: 0,
        options,
        password: password.map(Into::into),
        salt: Some("AAECAwQFBgcICQoLDA0ODw==".into()),
    }
}

fn code(e: CalcError) -> &'static str {
    e.code()
}

fn refused(h: &mut CalcHost, cmd: C) -> String {
    let e = h.apply(cmd).expect_err("refused");
    assert_eq!(code(e.clone()), "sheet_protected", "{e}");
    e.to_string()
}

#[test]
fn locked_cells_refuse_with_excels_message() {
    let mut h = host();
    h.apply(unlock(1, 1, 1, 1, false)).unwrap();
    h.apply(protect(SheetProtection::default(), Some("pw")))
        .unwrap();
    let msg = refused(&mut h, set(0, 0, "x"));
    assert_eq!(msg, "The cell or chart you're trying to change is on a protected sheet. To make a change, unprotect the sheet. You might be requested to enter a password.");
    // The unlocked cell takes input.
    h.apply(set(1, 1, "42")).unwrap();
    assert_eq!(
        h.doc().cell_view(CellCoord::new(SheetId(0), 1, 1)).display,
        "42"
    );
    // Clearing a range with a locked cell, formatting, rows: refused.
    refused(
        &mut h,
        C::ClearRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 1,
            c1: 1,
        },
    );
    refused(&mut h, unlock(5, 5, 5, 5, false));
    refused(
        &mut h,
        C::InsertRows {
            sheet: 0,
            at: 0,
            count: 1,
        },
    );
    refused(
        &mut h,
        C::DeleteCols {
            sheet: 0,
            at: 0,
            count: 1,
        },
    );
    refused(
        &mut h,
        C::SetColWidth {
            sheet: 0,
            col: 0,
            width: Some(20.0),
        },
    );
    refused(
        &mut h,
        C::MergeCells {
            sheet: 0,
            r0: 1,
            c0: 1,
            r1: 1,
            c1: 2,
        },
    );
    refused(
        &mut h,
        C::SetAutoFilter {
            sheet: 0,
            range: None,
        },
    );
    // Clearing just the unlocked cell works.
    h.apply(C::ClearRange {
        sheet: 0,
        r0: 1,
        c0: 1,
        r1: 1,
        c1: 1,
    })
    .unwrap();
}

#[test]
fn options_allow_actions() {
    let mut h = host();
    let allow = SheetProtection {
        format_cells: false,
        format_columns: false,
        insert_rows: false,
        ..SheetProtection::default()
    };
    h.apply(protect(allow, None)).unwrap();
    h.apply(unlock(3, 3, 3, 3, false)).unwrap();
    h.apply(C::SetColWidth {
        sheet: 0,
        col: 2,
        width: Some(20.0),
    })
    .unwrap();
    h.apply(C::InsertRows {
        sheet: 0,
        at: 0,
        count: 1,
    })
    .unwrap();
    refused(
        &mut h,
        C::SetRowHeight {
            sheet: 0,
            row: 0,
            height: Some(30.0),
        },
    );
    refused(
        &mut h,
        C::DeleteRows {
            sheet: 0,
            at: 0,
            count: 1,
        },
    );
    refused(
        &mut h,
        C::SortSheetByColumn {
            sheet: 0,
            row: 0,
            col: 0,
            ascending: true,
        },
    );
}

#[test]
fn unprotect_needs_the_password() {
    let mut h = host();
    h.apply(protect(SheetProtection::default(), Some("Geheim")))
        .unwrap();
    let e = h
        .apply(C::UnprotectSheet {
            sheet: 0,
            password: Some("geheim".into()),
        })
        .unwrap_err();
    assert_eq!(e.code(), "wrong_password");
    assert!(e
        .to_string()
        .starts_with("The password you supplied is not correct."));
    assert!(h
        .apply(C::UnprotectSheet {
            sheet: 0,
            password: None
        })
        .is_err());
    let patch = h
        .apply(C::UnprotectSheet {
            sheet: 0,
            password: Some("Geheim".into()),
        })
        .unwrap()
        .patch;
    assert!(patch.sheets.unwrap()[0].protection.is_none());
    h.apply(set(0, 0, "free")).unwrap();
}

#[test]
fn protection_is_undoable_and_hashes_like_excel() {
    let mut h = host();
    let patch = h
        .apply(protect(SheetProtection::default(), Some("test")))
        .unwrap()
        .patch;
    let info = &patch.sheets.unwrap()[0];
    let hashed = info
        .protection
        .as_ref()
        .unwrap()
        .password
        .hashed
        .clone()
        .unwrap();
    // The same vector as model_sheet's test (salt 00..0F, 100000 spins).
    assert_eq!(
        hashed.hash_value,
        "kdzmKvUf75HfA139bmknTx3jS5fWiutEA6RBGAszO6u8TWVHxbvj+mCzRnoOrXQhYGnJ5tcghBKAX1PBRLZdtg=="
    );
    refused(&mut h, set(0, 0, "x"));
    h.undo().unwrap();
    h.apply(set(0, 0, "x")).unwrap();
    h.undo().unwrap();
    h.redo().unwrap();
    // Redo of the edit happened unprotected; protect again via redo is gone
    // (a new command cleared the redo stack).
    assert!(h.doc().workbook().active_protection(SheetId(0)).is_none());
}

#[test]
fn hidden_formulas_and_saved_protection() {
    let mut h = host();
    h.apply(set(0, 0, "=1+2")).unwrap();
    h.apply(unlock(0, 0, 0, 0, true)).unwrap();
    h.apply(protect(SheetProtection::default(), Some("pw")))
        .unwrap();
    let c = CellCoord::new(SheetId(0), 0, 0);
    assert!(h.doc().workbook().is_formula_hidden(c));
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "p.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let p = doc.workbook().active_protection(SheetId(0)).unwrap();
    assert!(p.password.verify("pw"));
    assert!(doc.workbook().is_formula_hidden(c));
    // The info carries it to the UI.
    assert!(doc.info().sheets[0].protection.is_some());
}

#[test]
fn workbook_structure_lock() {
    let mut h = host();
    h.apply(C::AddSheet {
        name: "Two".into(),
        index: None,
    })
    .unwrap();
    let patch = h
        .apply(C::ProtectWorkbook {
            structure: true,
            windows: false,
            password: Some("wb".into()),
            salt: None,
        })
        .unwrap()
        .patch;
    assert!(patch.workbook_protection.unwrap().lock_structure);
    let refusals = [
        C::AddSheet {
            name: "Three".into(),
            index: None,
        },
        C::DeleteSheet { sheet: 1 },
        C::RenameSheet {
            sheet: 1,
            name: "X".into(),
        },
        C::MoveSheet { sheet: 1, index: 0 },
        C::DuplicateSheet {
            sheet: 0,
            name: "Sheet1 (2)".into(),
        },
        C::SetSheetHidden {
            sheet: 1,
            hidden: true,
            very_hidden: None,
        },
        C::SetSheetTabColor {
            sheet: 1,
            color: None,
        },
    ];
    for cmd in refusals {
        let e = h.apply(cmd).unwrap_err();
        assert_eq!(e.code(), "workbook_protected");
        assert_eq!(
            e.to_string(),
            "The workbook is protected and cannot be changed."
        );
    }
    // Cells are not protected by the workbook protection.
    h.apply(set(0, 0, "ok")).unwrap();
    assert_eq!(
        h.apply(C::UnprotectWorkbook {
            password: Some("x".into())
        })
        .unwrap_err()
        .code(),
        "wrong_password"
    );
    let patch = h
        .apply(C::UnprotectWorkbook {
            password: Some("wb".into()),
        })
        .unwrap()
        .patch;
    assert!(!patch.workbook_protection.unwrap().lock_structure);
    h.apply(C::RenameSheet {
        sheet: 1,
        name: "X".into(),
    })
    .unwrap();
}

#[test]
fn compound_and_deleted_sheet_keep_protection() {
    let mut h = host();
    h.apply(C::AddSheet {
        name: "Two".into(),
        index: None,
    })
    .unwrap();
    h.apply(C::ProtectSheet {
        sheet: 1,
        options: SheetProtection::default(),
        password: None,
        salt: None,
    })
    .unwrap();
    let e = h
        .apply(C::Compound {
            commands: vec![
                set(0, 0, "a"),
                C::SetInput {
                    sheet: 1,
                    row: 0,
                    col: 0,
                    input: "b".into(),
                },
            ],
        })
        .unwrap_err();
    assert_eq!(e.code(), "sheet_protected");
    assert_eq!(
        h.doc().cell_view(CellCoord::new(SheetId(0), 0, 0)).input,
        ""
    );
    // Deleting a protected sheet is allowed; undo brings the protection back.
    h.apply(C::DeleteSheet { sheet: 1 }).unwrap();
    h.undo().unwrap();
    assert!(h.doc().workbook().active_protection(SheetId(1)).is_some());
    // Without a password, unprotect needs none.
    h.apply(C::UnprotectSheet {
        sheet: 1,
        password: None,
    })
    .unwrap();
}

#[test]
fn dispatch_reports_codes() {
    let mut h = host();
    let reply = dispatch(
        &mut h,
        r#"{"type":"apply","command":{"type":"protectSheet","sheet":0,"options":{"sheet":true,"objects":true,"scenarios":true,"formatCells":true,"formatColumns":true,"formatRows":true,"insertColumns":true,"insertRows":true,"insertHyperlinks":true,"deleteColumns":true,"deleteRows":true,"selectLockedCells":false,"selectUnlockedCells":false,"sort":true,"autoFilter":true,"pivotTables":true},"password":"a"}}"#,
    );
    assert!(reply.contains(r#""protection":{"sheet":true"#), "{reply}");
    let reply = dispatch(
        &mut h,
        r#"{"type":"apply","command":{"type":"setInput","sheet":0,"row":0,"col":0,"input":"1"}}"#,
    );
    assert!(reply.contains(r#""code":"sheet_protected""#), "{reply}");
    let reply = dispatch(&mut h, r#"{"type":"saveXlsx","activeSheet":0}"#);
    assert!(reply.contains("bytesBase64"), "{reply}");
}
