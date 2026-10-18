//! P9-C7: cells, panes, comments and pictures round 2 through the
//! document host (fill tips, panes, Go To Special, comments, hyperlinks,
//! pictures).

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost};
use serde_json::{json, Value as Json};

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

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn tip(h: &mut CalcHost, src: [u32; 4], dst: [u32; 4]) -> Json {
    let r = |a: [u32; 4]| json!({"r0": a[0], "c0": a[1], "r1": a[2], "c1": a[3]});
    ok(
        h,
        json!({"type": "fillPreview", "sheet": 0, "src": r(src), "dst": r(dst), "mode": "auto"}),
    )["text"]
        .clone()
}

#[test]
fn fill_tip_shows_the_last_value_in_the_source_format() {
    let mut h = host();
    h.apply(set(1, 0, "$1.50")).unwrap();
    h.apply(set(2, 0, "$2.00")).unwrap();
    // A series in currency: the fifth row after the source gets $4.50.
    assert_eq!(tip(&mut h, [1, 0, 2, 0], [3, 0, 7, 0]), json!("$4.50"));
    // Filling upwards: the topmost cell is the farthest.
    assert_eq!(tip(&mut h, [1, 0, 2, 0], [0, 0, 0, 0]), json!("$1.00"));
    h.apply(set(10, 0, "3/4/2024")).unwrap();
    assert_eq!(
        tip(&mut h, [10, 0, 10, 0], [11, 0, 12, 0]),
        json!("3/6/2024")
    );
    h.apply(set(10, 2, "Mon")).unwrap();
    assert_eq!(tip(&mut h, [10, 2, 10, 2], [11, 2, 13, 2]), json!("Thu"));
    // A copied constant shows as displayed; a copied formula has no tip.
    h.apply(set(20, 0, "12%")).unwrap();
    h.apply(set(20, 1, "=A21*2")).unwrap();
    assert_eq!(tip(&mut h, [20, 0, 20, 0], [21, 0, 22, 0]), json!("12%"));
    assert_eq!(tip(&mut h, [20, 1, 20, 1], [21, 1, 22, 1]), Json::Null);
}

fn areas(
    h: &mut CalcHost,
    range: [u32; 4],
    at: (u32, u32),
    kind: &str,
    extra: Json,
) -> Vec<[u32; 4]> {
    let mut req = json!({
        "type": "goToSpecial", "sheet": 0,
        "range": {"r0": range[0], "c0": range[1], "r1": range[2], "c1": range[3]},
        "row": at.0, "col": at.1, "kind": kind,
    });
    for (k, v) in extra.as_object().unwrap() {
        req[k] = v.clone();
    }
    ok(h, req)["areas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let g = |k: &str| r[k].as_u64().unwrap() as u32;
            [g("r0"), g("c0"), g("r1"), g("c1")]
        })
        .collect()
}

#[test]
fn go_to_special_finds_blanks_constants_formulas_and_differences() {
    let mut h = host();
    for (r, c, v) in [
        (0, 0, "1"),
        (1, 0, "x"),
        (3, 0, "TRUE"),
        (0, 1, "=A1*2"),
        (1, 1, "=A2*2"),
        (2, 1, "=A3+1"),
        (3, 1, "=1/0"),
    ] {
        h.apply(set(r, c, v)).unwrap();
    }
    // One selected cell searches the used range A1:B4.
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "blanks", json!({})),
        vec![[2, 0, 2, 0]]
    );
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "constants", json!({})),
        vec![[0, 0, 1, 0], [3, 0, 3, 0]]
    );
    let numbers =
        json!({"types": {"numbers": true, "text": false, "logicals": false, "errors": false}});
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "constants", numbers.clone()),
        vec![[0, 0, 0, 0]]
    );
    // B2 is `"x"*2` = #VALUE!.
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "formulas", numbers),
        vec![[0, 1, 0, 1], [2, 1, 2, 1]]
    );
    let errors =
        json!({"types": {"numbers": false, "text": false, "logicals": false, "errors": true}});
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "formulas", errors),
        vec![[1, 1, 1, 1], [3, 1, 3, 1]]
    );
    // Column differences in B1:B4 against B1: B3's formula is not B1's filled down.
    assert_eq!(
        areas(&mut h, [0, 1, 3, 1], (0, 1), "columnDifferences", json!({})),
        vec![[2, 1, 3, 1]]
    );
    // Within a selection only; the last cell; direct and all precedents.
    assert_eq!(
        areas(&mut h, [0, 0, 1, 1], (0, 0), "blanks", json!({})),
        Vec::<[u32; 4]>::new()
    );
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "lastCell", json!({})),
        vec![[3, 1, 3, 1]]
    );
    h.apply(set(5, 0, "=B1+B2")).unwrap();
    assert_eq!(
        areas(&mut h, [5, 0, 5, 0], (5, 0), "precedents", json!({})),
        vec![[0, 1, 1, 1]]
    );
    assert_eq!(
        areas(
            &mut h,
            [5, 0, 5, 0],
            (5, 0),
            "precedents",
            json!({"allLevels": true})
        ),
        vec![[0, 0, 1, 1]]
    );
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "dependents", json!({})),
        vec![[0, 1, 0, 1]]
    );
    assert_eq!(
        areas(
            &mut h,
            [0, 0, 0, 0],
            (0, 0),
            "dependents",
            json!({"allLevels": true})
        ),
        vec![[0, 1, 0, 1], [5, 0, 5, 0]]
    );
}

#[test]
fn go_to_special_visible_cells_and_notes() {
    let mut h = host();
    h.apply(C::SetRowHidden {
        sheet: 0,
        row: 1,
        hidden: true,
    })
    .unwrap();
    assert_eq!(
        areas(&mut h, [0, 0, 3, 1], (0, 0), "visibleCellsOnly", json!({})),
        vec![[0, 0, 0, 1], [2, 0, 3, 1]]
    );
    h.apply(C::SetNote {
        sheet: 0,
        row: 4,
        col: 2,
        text: vec![model_sheet::NoteRun::plain("n")],
        author: None,
        visible: None,
        bounds: None,
    })
    .unwrap();
    h.apply(set(9, 9, "end")).unwrap();
    assert_eq!(
        areas(&mut h, [0, 0, 0, 0], (0, 0), "notes", json!({})),
        vec![[4, 2, 4, 2]]
    );
}

#[test]
fn freezing_while_scrolled_keeps_the_scroll_position_and_undoes_exactly() {
    let mut h = host();
    h.apply(C::SetFreeze {
        sheet: 0,
        rows: 5,
        cols: 1,
        top_row: Some(19),
        left_col: Some(2),
    })
    .unwrap();
    let v = h.doc().workbook().sheet_view(model_sheet::SheetId(0));
    assert_eq!(
        (
            v.top_row,
            v.frozen_rows,
            v.pane_row,
            v.left_col,
            v.frozen_cols,
            v.pane_col
        ),
        (19, 5, 24, 2, 1, 3)
    );
    // The file keeps both top-left cells.
    let saved = ok(
        &mut h,
        json!({"type": "saveXlsx", "scroll": {"sheet": 0, "topRow": 0, "leftCol": 0, "paneRow": 40, "paneCol": 3}}),
    );
    let bytes = base64_decode(saved["bytesBase64"].as_str().unwrap());
    let back = fmt_xlsx::read(&bytes).unwrap();
    let v = back.sheet_view(model_sheet::SheetId(0));
    assert_eq!(
        (
            v.top_row,
            v.frozen_rows,
            v.pane_row,
            v.left_col,
            v.frozen_cols
        ),
        (19, 5, 40, 2, 1)
    );
    h.undo().unwrap();
    assert!(!h
        .doc()
        .workbook()
        .sheet_view(model_sheet::SheetId(0))
        .is_frozen());
}

fn base64_decode(s: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

#[test]
fn comments_record_mentions_of_known_people() {
    let mut h = host();
    h.apply(C::SetUser {
        name: "Ann Lee".into(),
        initials: "AL".into(),
    })
    .unwrap();
    h.apply(C::AddComment {
        sheet: 0,
        row: 0,
        col: 0,
        text: "first".into(),
        author: model_sheet::Person::new("Bob", ""),
        date: "2026-10-18T09:00:00.00".into(),
    })
    .unwrap();
    h.apply(C::ReplyComment {
        sheet: 0,
        row: 0,
        col: 0,
        text: "@Ann Lee and @Bob, have a look".into(),
        author: model_sheet::Person::new("Ann Lee", "AL"),
        date: "2026-10-18T09:10:00.00".into(),
    })
    .unwrap();
    let t = h.doc().workbook().threads(model_sheet::SheetId(0))[0].clone();
    let m: Vec<(u32, u32)> = t.replies[0]
        .mentions
        .iter()
        .map(|m| (m.start, m.length))
        .collect();
    assert_eq!(m, vec![(0, 8), (13, 4)]);
    // Editing the text recomputes them.
    let rid = t.replies[0].id.clone();
    h.apply(C::EditComment {
        sheet: 0,
        row: 0,
        col: 0,
        id: rid,
        text: "thanks".into(),
    })
    .unwrap();
    assert!(
        h.doc().workbook().threads(model_sheet::SheetId(0))[0].replies[0]
            .mentions
            .is_empty()
    );
}

#[test]
fn remove_hyperlink_clears_the_link_formatting_and_undoes_exactly() {
    let mut h = host();
    h.apply(set(0, 0, "site")).unwrap();
    h.apply(C::ApplyStyle {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        patch: model_sheet::CellStyle {
            font: core_model::RunProperties {
                bold: Some(true),
                ..Default::default()
            },
            ..Default::default()
        },
    })
    .unwrap();
    h.apply(C::SetHyperlink {
        sheet: 0,
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
        target: model_sheet::LinkTarget::Url {
            url: "https://example.com".into(),
        },
        tooltip: None,
        text: None,
    })
    .unwrap();
    let c = engine_formula::CellCoord::new(model_sheet::SheetId(0), 0, 0);
    let linked = h.doc().workbook().style(c).clone();
    assert!(linked.font.color.is_some() && linked.font.underline.is_some());
    let before = h.doc().workbook().to_snapshot();
    let env = h
        .apply(C::RemoveHyperlink {
            sheet: 0,
            r0: 0,
            c0: 0,
            r1: 0,
            c1: 0,
        })
        .unwrap();
    assert!(
        !env.patch.cells.is_empty(),
        "the cell's new style is in the patch"
    );
    let plain = h.doc().workbook().style(c).clone();
    assert_eq!(
        (plain.font.color, plain.font.underline, plain.font.bold),
        (None, None, Some(true))
    );
    assert!(h
        .doc()
        .workbook()
        .hyperlinks(model_sheet::SheetId(0))
        .is_empty());
    h.undo().unwrap();
    assert_eq!(h.doc().workbook().to_snapshot(), before);
}
