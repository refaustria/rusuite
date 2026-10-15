//! `recoverySnapshot` / `restoreRecovery` (crash recovery, P5-3).

use serde_json::{json, Value as Json};
use show_core::{dispatch_with, ShowDocument, ShowHost};

fn call(host: &mut ShowHost, request: Json) -> Json {
    serde_json::from_str(&dispatch_with(host, &request.to_string())).unwrap()
}

#[test]
fn snapshot_restores_into_a_fresh_host_as_dirty() {
    let mut a = ShowHost::new(ShowDocument::new());
    let p = call(&mut a, json!({"type": "getPresentation"}));
    let slide = p["ok"]["presentation"]["slides"][0]["id"].clone();
    call(
        &mut a,
        json!({"type": "apply", "command": {"type": "addSlide", "after": slide, "layout": "blank", "newIds": [-1]}}),
    );
    let snap = call(&mut a, json!({"type": "recoverySnapshot"}));
    let snap = &snap["ok"];
    assert_eq!(snap["type"], "recoverySnapshot");
    assert_eq!(
        (&snap["dirty"], &snap["revision"]),
        (&json!(true), &json!(1))
    );
    let expected = call(&mut a, json!({"type": "getPresentation"}))["ok"]["presentation"].clone();
    assert_eq!(expected["slides"].as_array().map(Vec::len), Some(2));

    let mut b = ShowHost::new(ShowDocument::new());
    let r = call(
        &mut b,
        json!({"type": "restoreRecovery", "json": snap["json"], "name": "deck.pptx"}),
    );
    assert_eq!(r["ok"]["type"], "presentation");
    assert_eq!(r["ok"]["presentation"], expected);
    assert_eq!(r["ok"]["envelope"]["dirty"], true);
    assert_eq!(
        call(&mut b, json!({"type": "documentState"}))["ok"]["name"],
        "deck.pptx"
    );
    assert_eq!(
        call(&mut b, json!({"type": "recoverySnapshot"}))["ok"]["json"],
        snap["json"]
    );
}

#[test]
fn invalid_snapshot_leaves_the_presentation() {
    let mut h = ShowHost::new(ShowDocument::new());
    let before = call(&mut h, json!({"type": "getPresentation"}));
    let r = call(
        &mut h,
        json!({"type": "restoreRecovery", "json": "{\"slides\": 3}"}),
    );
    assert_eq!(r["err"]["code"], "invalid_snapshot");
    assert_eq!(call(&mut h, json!({"type": "getPresentation"})), before);
}
