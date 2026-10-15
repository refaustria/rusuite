//! `.xlsx` open/save through [`dispatch`] (P2-7).

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use calc_core::{dispatch, CalcDocument, CalcHost};
use serde_json::{json, Value as Json};

fn call(host: &mut CalcHost, request: Json) -> Json {
    serde_json::from_str(&dispatch(host, &request.to_string())).unwrap()
}

fn basic_base64() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../testdata/xlsx/provisional-basic.xlsx"
    );
    STANDARD.encode(std::fs::read(path).unwrap())
}

fn sheet_names(info: &Json) -> Vec<&str> {
    info["sheets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect()
}

fn state(host: &mut CalcHost) -> Json {
    let r = call(host, json!({"type": "documentState"}));
    assert_eq!(r["ok"]["type"], "documentState");
    r["ok"].clone()
}

#[test]
fn open_edit_save_reopen() {
    let mut host = CalcHost::new(CalcDocument::new());
    call(
        &mut host,
        json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": 0, "col": 0, "input": "x"}}),
    );
    assert_eq!(
        state(&mut host),
        json!({"type": "documentState", "dirty": true, "revision": 1, "name": null})
    );

    let r = call(
        &mut host,
        json!({"type": "openXlsx", "bytesBase64": basic_base64(), "name": "provisional-basic.xlsx"}),
    );
    let opened = &r["ok"];
    assert_eq!(opened["type"], "opened", "{r}");
    assert_eq!(sheet_names(&opened["info"]), ["Data", "Summary"]);
    assert_eq!(opened["info"]["revision"], 2);
    assert!(opened["warnings"].is_array());
    let env = &opened["envelope"];
    assert_eq!(env["revision"], 2);
    assert_eq!(
        (&env["dirty"], &env["canUndo"], &env["canRedo"]),
        (&json!(false), &json!(false), &json!(false))
    );
    assert_eq!(
        state(&mut host),
        json!({"type": "documentState", "dirty": false, "revision": 2, "name": "provisional-basic.xlsx"})
    );

    let r = call(
        &mut host,
        json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": 40, "col": 3, "input": "edited"}}),
    );
    assert_eq!(r["ok"]["envelope"]["dirty"], true);
    assert_eq!(state(&mut host)["dirty"], true);

    let r = call(&mut host, json!({"type": "saveXlsx"}));
    let saved = &r["ok"];
    assert_eq!(saved["type"], "saved", "{r}");
    assert_eq!(saved["suggestedName"], "provisional-basic.xlsx");
    assert_eq!(state(&mut host)["dirty"], false);

    // Undo after save makes it dirty again; markSaved cleans it.
    call(&mut host, json!({"type": "undo"}));
    assert_eq!(state(&mut host)["dirty"], true);
    let r = call(&mut host, json!({"type": "markSaved"}));
    assert_eq!(r["ok"]["dirty"], false);
    assert_eq!(r["ok"]["type"], "documentState");

    // The saved bytes re-open with the edit present.
    let bytes = saved["bytesBase64"].as_str().unwrap().to_owned();
    let mut other = CalcHost::new(CalcDocument::new());
    let r = call(
        &mut other,
        json!({"type": "openXlsx", "bytesBase64": bytes, "name": "copy.xlsx"}),
    );
    assert_eq!(sheet_names(&r["ok"]["info"]), ["Data", "Summary"]);
    let r = call(
        &mut other,
        json!({"type": "snapshot", "sheet": 0, "r0": 40, "c0": 3, "r1": 40, "c1": 3}),
    );
    assert_eq!(r["ok"]["snapshot"]["cells"][0]["input"], "edited", "{r}");
}

#[test]
fn new_document_saves_as_untitled() {
    let mut host = CalcHost::new(CalcDocument::new());
    let r = call(&mut host, json!({"type": "saveXlsx"}));
    assert_eq!(r["ok"]["suggestedName"], "Untitled.xlsx");
    let bytes = STANDARD
        .decode(r["ok"]["bytesBase64"].as_str().unwrap())
        .unwrap();
    assert!(bytes.starts_with(b"PK"));
}

#[test]
fn open_errors_keep_the_document() {
    let mut host = CalcHost::new(CalcDocument::new());
    for (req, code) in [
        (
            json!({"type": "openXlsx", "bytesBase64": "%%%", "name": "a.xlsx"}),
            "bad_request",
        ),
        (
            json!({"type": "openXlsx", "bytesBase64": STANDARD.encode(b"not a zip"), "name": "a.xlsx"}),
            "invalid_file",
        ),
        (json!({"type": "openXlsx", "name": "a.xlsx"}), "bad_request"),
    ] {
        let r = call(&mut host, req.clone());
        assert_eq!(r["err"]["code"], code, "{req}");
    }
    assert_eq!(host.revision().0, 0);
    assert_eq!(state(&mut host)["name"], Json::Null);
}
