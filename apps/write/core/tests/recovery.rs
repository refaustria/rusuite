//! `recoverySnapshot` / `restoreRecovery` (crash recovery, P5-3).

use serde_json::{json, Value as Json};
use write_core::{dispatch_with, WriteDocument, WriteHost};

fn call(host: &mut WriteHost, request: Json) -> Json {
    serde_json::from_str(&dispatch_with(host, &request.to_string())).unwrap()
}

#[test]
fn snapshot_restores_into_a_fresh_host_as_dirty() {
    let mut a = WriteHost::new(WriteDocument::new());
    let doc = call(&mut a, json!({"type": "getDocument"}));
    let block = doc["ok"]["doc"]["body"][0]["value"]["id"].clone();
    call(
        &mut a,
        json!({"type": "apply", "command": {"type": "insertText", "block": block, "offset": 0, "text": "Recovered 🙂"}}),
    );
    let snap = call(&mut a, json!({"type": "recoverySnapshot"}));
    let snap = &snap["ok"];
    assert_eq!(snap["type"], "recoverySnapshot");
    assert_eq!((&snap["dirty"], &snap["name"]), (&json!(true), &Json::Null));
    let expected = call(&mut a, json!({"type": "getDocument"}))["ok"]["doc"].clone();

    let mut b = WriteHost::new(WriteDocument::new());
    let r = call(
        &mut b,
        json!({"type": "restoreRecovery", "json": snap["json"], "name": "letter.docx"}),
    );
    assert_eq!(r["ok"]["type"], "document");
    assert_eq!(r["ok"]["doc"], expected);
    assert_eq!(r["ok"]["envelope"]["dirty"], true);
    assert_eq!(r["ok"]["envelope"]["canUndo"], false);
    assert_eq!(
        call(&mut b, json!({"type": "documentState"}))["ok"]["name"],
        "letter.docx"
    );
    assert_eq!(
        call(&mut b, json!({"type": "recoverySnapshot"}))["ok"]["json"],
        snap["json"]
    );
    assert_eq!(
        call(&mut b, json!({"type": "markSaved"}))["ok"]["dirty"],
        false
    );
}

#[test]
fn invalid_snapshot_leaves_the_document() {
    let mut h = WriteHost::new(WriteDocument::new());
    let before = call(&mut h, json!({"type": "getDocument"}));
    let r = call(
        &mut h,
        json!({"type": "restoreRecovery", "json": "{\"body\": 3}"}),
    );
    assert_eq!(r["err"]["code"], "invalid_snapshot");
    assert_eq!(call(&mut h, json!({"type": "getDocument"})), before);
}
