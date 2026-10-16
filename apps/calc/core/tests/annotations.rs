//! P8-26: notes, threaded comments and hyperlinks through the document
//! host: commands, patches, undo identity, structural edits, paste,
//! sort, sheets, requests and xlsx.

use app_common::Host;
use calc_core::{
    dispatch, CalcCommand as C, CalcDocument, CalcHost, ClipCell, CommentState, PasteMode,
    SheetRect,
};
use model_sheet::{
    CellCoord, LinkTarget, NoteBounds, NoteRun, Person, SortKey, SortKind, WorkbookSnapshot,
};
use serde_json::{json, Value as Json};

fn set(sheet: u32, row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet,
        row,
        col,
        input: input.into(),
    }
}

fn note(row: u32, col: u32, text: &str) -> C {
    C::SetNote {
        sheet: 0,
        row,
        col,
        text: vec![NoteRun::plain(text)],
        author: Some("Ann".into()),
        visible: None,
        bounds: None,
    }
}

fn ann() -> Person {
    Person::new("Ann Lee", "AL")
}

fn comment(row: u32, col: u32, text: &str) -> C {
    C::AddComment {
        sheet: 0,
        row,
        col,
        text: text.into(),
        author: ann(),
        date: "2026-10-16T09:00:00.00".into(),
    }
}

/// The workbook without its style table (undo keeps interned styles).
fn snap(h: &CalcHost) -> WorkbookSnapshot {
    WorkbookSnapshot {
        styles: Vec::new(),
        ..h.doc().workbook().to_snapshot()
    }
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

/// Applies `cmd`, checks that undo restores the state before and redo
/// the state after it exactly; returns the patch JSON.
fn undoable(h: &mut CalcHost, cmd: C) -> Json {
    let before = snap(h);
    let env = h.apply(cmd).unwrap();
    let after = snap(h);
    h.undo().unwrap().expect("undoable");
    assert_eq!(snap(h), before, "undo");
    h.redo().unwrap().expect("redoable");
    assert_eq!(snap(h), after, "redo");
    serde_json::to_value(&env.patch).unwrap()
}

fn at(row: u32, col: u32) -> CellCoord {
    CellCoord::new(model_sheet::SheetId(0), row, col)
}

#[test]
fn notes_set_show_delete_with_undo() {
    let mut h = Host::new(CalcDocument::new());
    let patch = undoable(&mut h, note(1, 1, "first"));
    assert_eq!(patch["annotations"][0]["notes"][0]["author"], "Ann");
    assert_eq!(patch["cells"][0]["cells"][0]["note"], true);
    // Editing keeps the author and the visibility.
    undoable(
        &mut h,
        C::ShowHideNote {
            sheet: 0,
            row: 1,
            col: 1,
            visible: None,
        },
    );
    undoable(
        &mut h,
        C::SetNote {
            sheet: 0,
            row: 1,
            col: 1,
            text: vec![NoteRun::plain("second")],
            author: None,
            visible: None,
            bounds: Some(NoteBounds {
                x: 5.0,
                y: 0.0,
                w: 80.0,
                h: 40.0,
            }),
        },
    );
    let n = h.doc().workbook().note_at(at(1, 1)).unwrap();
    assert_eq!(
        (n.author.as_str(), n.visible, n.plain_text().as_str()),
        ("Ann", true, "second")
    );
    assert!(h
        .apply(C::ShowHideNote {
            sheet: 0,
            row: 5,
            col: 5,
            visible: Some(true)
        })
        .is_err());
    // Clear contents keeps the note; Delete Note removes it.
    h.apply(set(0, 1, 1, "x")).unwrap();
    h.apply(C::ClearRange {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 3,
        c1: 3,
    })
    .unwrap();
    assert!(h.doc().workbook().note_at(at(1, 1)).is_some());
    let patch = undoable(
        &mut h,
        C::DeleteNote {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 3,
        },
    );
    assert!(h.doc().workbook().notes(model_sheet::SheetId(0)).is_empty());
    assert_eq!(patch["annotations"][0]["notes"], json!([]));
    assert!(patch["cells"][0]["cells"][0].get("note").is_none());
}

#[test]
fn threads_add_reply_edit_resolve_delete() {
    let mut h = Host::new(CalcDocument::new());
    let patch = undoable(&mut h, comment(0, 0, "Why?"));
    assert_eq!(patch["cells"][0]["cells"][0]["comment"], "open");
    assert!(h.apply(comment(0, 0, "again")).is_err());
    let t = h.doc().workbook().thread_at(at(0, 0)).unwrap().clone();
    assert!(t.id.starts_with('{') && t.id.len() == 38);
    undoable(
        &mut h,
        C::ReplyComment {
            sheet: 0,
            row: 0,
            col: 0,
            text: "Because.".into(),
            author: Person::new("Bob", ""),
            date: "2026-10-16T10:00:00.00".into(),
        },
    );
    let reply = h.doc().workbook().thread_at(at(0, 0)).unwrap().replies[0].clone();
    assert_ne!(reply.id, t.id);
    undoable(
        &mut h,
        C::EditComment {
            sheet: 0,
            row: 0,
            col: 0,
            id: reply.id.clone(),
            text: "Edited.".into(),
        },
    );
    undoable(
        &mut h,
        C::EditComment {
            sheet: 0,
            row: 0,
            col: 0,
            id: t.id.clone(),
            text: "Why not?".into(),
        },
    );
    let patch = undoable(
        &mut h,
        C::ResolveThread {
            sheet: 0,
            row: 0,
            col: 0,
            resolved: true,
        },
    );
    assert_eq!(patch["cells"][0]["cells"][0]["comment"], "resolved");
    assert_eq!(
        h.doc().cell_view(at(0, 0)).comment,
        Some(CommentState::Resolved)
    );
    undoable(
        &mut h,
        C::DeleteReply {
            sheet: 0,
            row: 0,
            col: 0,
            id: reply.id,
        },
    );
    let th = h.doc().workbook().thread_at(at(0, 0)).unwrap();
    assert_eq!(
        (th.text.as_str(), th.replies.len(), th.resolved),
        ("Why not?", 0, true)
    );
    undoable(
        &mut h,
        C::DeleteThread {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
        },
    );
    assert!(h.doc().workbook().thread_at(at(0, 0)).is_none());
}

#[test]
fn convert_notes_and_set_user() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(C::SetNote {
        sheet: 0,
        row: 2,
        col: 0,
        text: vec![NoteRun::plain("Ann:\nCheck it")],
        author: Some("Ann".into()),
        visible: None,
        bounds: None,
    })
    .unwrap();
    h.apply(note(3, 0, "kept")).unwrap();
    h.apply(comment(3, 0, "existing")).unwrap();
    undoable(
        &mut h,
        C::ConvertNotesToComments {
            sheet: 0,
            author: ann(),
            date: "2026-10-16T11:00:00.00".into(),
        },
    );
    let wb = h.doc().workbook();
    let t = wb.thread_at(at(2, 0)).unwrap();
    assert_eq!(
        (t.author.name.as_str(), t.text.as_str()),
        ("Ann", "Check it")
    );
    assert!(wb.note_at(at(2, 0)).is_none());
    assert!(wb.note_at(at(3, 0)).is_some());
    let patch = undoable(
        &mut h,
        C::SetUser {
            name: "Ann Lee".into(),
            initials: "AL".into(),
        },
    );
    assert_eq!(patch["persons"][0]["name"], "Ann Lee");
    let info = ok(&mut h, json!({"type": "info"}));
    assert_eq!(info["info"]["persons"][0]["initials"], "AL");
}

#[test]
fn annotations_follow_rows_and_columns_with_exact_undo() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(note(2, 1, "n")).unwrap();
    h.apply(comment(4, 1, "t")).unwrap();
    // A note stays with its cell when a row is inserted above.
    let patch = undoable(
        &mut h,
        C::InsertRows {
            sheet: 0,
            at: 0,
            count: 1,
        },
    );
    assert!(h.doc().workbook().note_at(at(3, 1)).is_some());
    assert_eq!(patch["annotations"][0]["notes"][0]["row"], 3);
    undoable(
        &mut h,
        C::InsertCols {
            sheet: 0,
            at: 0,
            count: 2,
        },
    );
    assert!(h.doc().workbook().thread_at(at(5, 3)).is_some());
    // Deleting the note's row drops it; undo brings it back.
    undoable(
        &mut h,
        C::DeleteRows {
            sheet: 0,
            at: 3,
            count: 1,
        },
    );
    assert!(h.doc().workbook().notes(model_sheet::SheetId(0)).is_empty());
    undoable(
        &mut h,
        C::DeleteCols {
            sheet: 0,
            at: 3,
            count: 1,
        },
    );
    assert!(h
        .doc()
        .workbook()
        .threads(model_sheet::SheetId(0))
        .is_empty());
}

fn paste(src: (u32, u32, u32, u32), to: (u32, u32), cut: bool) -> C {
    C::PasteRange {
        sheet: 0,
        r0: to.0,
        c0: to.1,
        src: SheetRect {
            sheet: 0,
            r0: src.0,
            c0: src.1,
            r1: src.2,
            c1: src.3,
        },
        cells: vec![ClipCell {
            dr: 0,
            dc: 0,
            input: "v".into(),
            style: Some(0),
        }],
        mode: PasteMode::All,
        cut,
        repeat_rows: 1,
        repeat_cols: 1,
        annotations: true,
        special: None,
    }
}

#[test]
fn copy_copies_notes_and_cut_moves_everything() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(set(0, 0, 0, "v")).unwrap();
    h.apply(note(0, 0, "n")).unwrap();
    h.apply(comment(0, 0, "t")).unwrap();
    undoable(&mut h, paste((0, 0, 0, 0), (5, 5), false));
    let wb = h.doc().workbook();
    assert!(wb.note_at(at(5, 5)).is_some());
    assert!(wb.thread_at(at(5, 5)).is_none());
    assert!(wb.note_at(at(0, 0)).is_some());
    undoable(&mut h, paste((0, 0, 0, 0), (9, 2), true));
    let wb = h.doc().workbook();
    assert!(wb.note_at(at(0, 0)).is_none() && wb.thread_at(at(0, 0)).is_none());
    assert!(wb.note_at(at(9, 2)).is_some() && wb.thread_at(at(9, 2)).is_some());
    // Text from another program does not touch annotations.
    let mut plain = paste((5, 5, 5, 5), (5, 5), false);
    if let C::PasteRange { annotations, .. } = &mut plain {
        *annotations = false;
    }
    h.apply(plain).unwrap();
    assert!(h.doc().workbook().note_at(at(5, 5)).is_some());
}

#[test]
fn sort_moves_notes_and_sheet_operations_keep_them() {
    let mut h = Host::new(CalcDocument::new());
    for (r, v) in ["3", "1", "2"].iter().enumerate() {
        h.apply(set(0, r as u32, 0, v)).unwrap();
    }
    h.apply(note(0, 0, "three")).unwrap();
    undoable(
        &mut h,
        C::SortRange {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 2,
            c1: 0,
            keys: vec![SortKey {
                col: 0,
                ascending: true,
                kind: SortKind::Auto,
            }],
            has_header: false,
            case_sensitive: false,
        },
    );
    assert_eq!(
        h.doc().workbook().note_at(at(2, 0)).unwrap().plain_text(),
        "three"
    );
    h.apply(comment(1, 1, "c")).unwrap();
    h.apply(C::AddSheet {
        name: "Other".into(),
        index: None,
    })
    .unwrap();
    undoable(
        &mut h,
        C::DuplicateSheet {
            sheet: 0,
            name: "Copy".into(),
        },
    );
    let copy = h.doc().workbook().sheet_id("Copy").unwrap();
    assert_eq!(h.doc().workbook().notes(copy).len(), 1);
    assert_eq!(h.doc().workbook().threads(copy).len(), 1);
    undoable(&mut h, C::DeleteSheet { sheet: 0 });
}

#[test]
fn hyperlinks_style_text_requests_and_undo() {
    let mut h = Host::new(CalcDocument::new());
    let patch = undoable(
        &mut h,
        C::SetHyperlink {
            sheet: 0,
            r0: 1,
            c0: 1,
            r1: 1,
            c1: 1,
            target: LinkTarget::Url {
                url: "https://example.com".into(),
            },
            tooltip: Some("Example".into()),
            text: Some("Example site".into()),
        },
    );
    let cell = &patch["cells"][0]["cells"][0];
    assert_eq!(cell["input"], "Example site");
    assert_eq!(cell["link"], true);
    let style = h.doc().workbook().style(at(1, 1)).clone();
    assert_eq!(style.font.underline, Some(core_model::Underline::Single));
    assert!(patch["annotations"][0]["hyperlinks"][0]["tooltip"] == "Example");
    h.apply(set(0, 3, 0, "=HYPERLINK(\"#Sheet1!B2\",\"jump\")"))
        .unwrap();
    let reply = ok(
        &mut h,
        json!({"type": "cellAnnotations", "sheet": 0, "r0": 0, "c0": 0, "r1": 50, "c1": 50}),
    );
    let a = &reply["annotations"];
    assert_eq!(a["hyperlinks"][0]["target"]["url"], "https://example.com");
    assert_eq!(
        a["formulaLinks"][0]["target"],
        json!({"kind": "location", "location": "Sheet1!B2"})
    );
    assert!(h.doc().cell_view(at(3, 0)).link);
    undoable(
        &mut h,
        C::RemoveHyperlink {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 5,
            c1: 5,
        },
    );
    assert!(h
        .doc()
        .workbook()
        .hyperlinks(model_sheet::SheetId(0))
        .is_empty());
}

#[test]
fn requests_snapshot_flags_and_xlsx_roundtrip() {
    let mut h = Host::new(CalcDocument::new());
    h.apply(note(4, 4, "empty cell note")).unwrap();
    h.apply(comment(6, 6, "t")).unwrap();
    h.apply(C::AddSheet {
        name: "Two".into(),
        index: None,
    })
    .unwrap();
    // The snapshot lists annotated empty cells for the indicators.
    let s = ok(
        &mut h,
        json!({"type": "snapshot", "sheet": 0, "r0": 0, "c0": 0, "r1": 20, "c1": 20}),
    );
    let cells = s["snapshot"]["cells"].as_array().unwrap();
    assert!(cells.iter().any(|c| c["row"] == 4 && c["note"] == true));
    assert!(cells
        .iter()
        .any(|c| c["row"] == 6 && c["comment"] == "open"));
    let all = ok(&mut h, json!({"type": "allComments", "sheet": null}));
    assert_eq!(all["sheets"].as_array().unwrap().len(), 1);
    assert_eq!(all["sheets"][0]["threads"][0]["text"], "t");
    let one = ok(&mut h, json!({"type": "allComments", "sheet": 1}));
    assert_eq!(one["sheets"][0]["threads"], json!([]));
    // Save and reopen.
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "c.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let wb = doc.workbook();
    assert_eq!(
        wb.note_at(at(4, 4)).unwrap().plain_text(),
        "empty cell note"
    );
    assert_eq!(wb.thread_at(at(6, 6)).unwrap().author.name, "Ann Lee");
}
