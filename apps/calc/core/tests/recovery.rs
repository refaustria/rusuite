//! `recoverySnapshot` / `restoreRecovery` (crash recovery, P5-3).

use calc_core::{dispatch, CalcDocument, CalcHost};
use serde_json::{json, Value as Json};

fn call(host: &mut CalcHost, request: Json) -> Json {
    serde_json::from_str(&dispatch(host, &request.to_string())).unwrap()
}

#[test]
fn snapshot_restores_into_a_fresh_host_as_dirty() {
    let mut a = CalcHost::new(CalcDocument::new());
    for (row, input) in [(0, "2"), (1, "=A1*21")] {
        call(
            &mut a,
            json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": row, "col": 0, "input": input}}),
        );
    }
    let snap = call(&mut a, json!({"type": "recoverySnapshot"}));
    let snap = &snap["ok"];
    assert_eq!(snap["type"], "recoverySnapshot");
    assert_eq!(
        (&snap["revision"], &snap["dirty"], &snap["name"]),
        (&json!(2), &json!(true), &Json::Null)
    );

    let mut b = CalcHost::new(CalcDocument::new());
    let r = call(
        &mut b,
        json!({"type": "restoreRecovery", "json": snap["json"], "name": "book.xlsx"}),
    );
    assert_eq!(r["ok"]["type"], "info");
    let st = call(&mut b, json!({"type": "documentState"}));
    assert_eq!(
        st["ok"],
        json!({"type": "documentState", "dirty": true, "revision": 1, "name": "book.xlsx"})
    );
    let cells = call(
        &mut b,
        json!({"type": "snapshot", "sheet": 0, "r0": 0, "c0": 0, "r1": 1, "c1": 0}),
    );
    let displays: Vec<&Json> = cells["ok"]["snapshot"]["cells"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| &c["display"])
        .collect();
    assert_eq!(displays, [&json!("2"), &json!("42")]);
    // Same content, nothing to undo, still dirty after an undo attempt.
    let again = call(&mut b, json!({"type": "recoverySnapshot"}));
    assert_eq!(again["ok"]["json"], snap["json"]);
    assert_eq!(
        call(&mut b, json!({"type": "undo"}))["ok"]["envelope"]["dirty"],
        true
    );
    assert_eq!(
        call(&mut b, json!({"type": "markSaved"}))["ok"]["dirty"],
        false
    );
}

#[test]
fn invalid_snapshot_leaves_the_document() {
    let mut h = CalcHost::new(CalcDocument::new());
    call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": 0, "col": 0, "input": "x"}}),
    );
    let r = call(&mut h, json!({"type": "restoreRecovery", "json": "{"}));
    assert_eq!(r["err"]["code"], "invalid_snapshot");
    assert_eq!(
        call(&mut h, json!({"type": "documentState"}))["ok"]["revision"],
        1
    );
}
