//! `.docx` open/save through `dispatch_with` (P3-7, ADR 0002 file-IO
//! amendment).

use std::path::PathBuf;

use model_text::media::{base64_decode, base64_encode};
use serde_json::{json, Value as Json};
use write_core::{dispatch_with, WriteDocument, WriteHost};

fn testdata() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../testdata/docx")
}

fn call(h: &mut WriteHost, req: &Json) -> Json {
    serde_json::from_str(&dispatch_with(h, &req.to_string())).unwrap()
}

fn ok(h: &mut WriteHost, req: &Json) -> Json {
    let reply = call(h, req);
    assert!(reply.get("ok").is_some(), "{req}: {reply}");
    reply["ok"].clone()
}

fn open(h: &mut WriteHost, bytes: &[u8], name: &str) -> Json {
    ok(
        h,
        &json!({"type": "openDocx", "bytesBase64": base64_encode(bytes), "name": name}),
    )
}

fn manifest_files() -> Vec<String> {
    let text = std::fs::read_to_string(testdata().join("manifest.json")).unwrap();
    let entries: Vec<Json> = serde_json::from_str(&text).unwrap();
    entries
        .iter()
        .map(|e| e["file"].as_str().unwrap().to_owned())
        .collect()
}

/// All run text below `v` (a block or a body), in document order.
fn plain_text(v: &Json) -> String {
    fn walk(v: &Json, out: &mut String) {
        match v {
            Json::Object(m) => {
                if let Some(Json::String(t)) = m.get("text") {
                    out.push_str(t);
                }
                m.values().for_each(|v| walk(v, out));
            }
            Json::Array(a) => a.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = String::new();
    walk(v, &mut out);
    out
}

#[test]
fn opens_every_corpus_file_and_saves_it_back() {
    let files = manifest_files();
    assert!(files.len() >= 50, "{} files", files.len());
    let mut h = WriteHost::new(WriteDocument::new());
    let mut last_revision = 0;
    for file in files {
        let bytes = std::fs::read(testdata().join(&file)).unwrap();
        let opened = open(&mut h, &bytes, &file);
        assert_eq!(opened["type"], "opened", "{file}");
        assert!(opened["warnings"].is_array(), "{file}");
        assert!(
            opened["doc"]["body"]
                .as_array()
                .is_some_and(|b| !b.is_empty()),
            "{file}"
        );
        let env = &opened["envelope"];
        assert_eq!(env["dirty"], false, "{file}");
        assert_eq!(env["canUndo"], false, "{file}");
        let revision = env["revision"].as_u64().unwrap();
        assert!(revision > last_revision, "{file}");
        last_revision = revision;
        let state = ok(&mut h, &json!({"type": "documentState"}));
        assert_eq!(state["name"], file.as_str());

        let saved = ok(&mut h, &json!({"type": "saveDocx"}));
        assert_eq!(saved["suggestedName"], file.as_str());
        let back = base64_decode(saved["bytesBase64"].as_str().unwrap()).unwrap();
        let reopened = WriteDocument::open_docx(&back, &file).unwrap().0;
        assert_eq!(
            reopened.document().plain_text(),
            h.doc().document().plain_text(),
            "{file}"
        );
    }
}

#[test]
fn edit_save_reopen_keeps_the_edit() {
    let file = "provisional-47-report.docx";
    let bytes = std::fs::read(testdata().join(file)).unwrap();
    let mut h = WriteHost::new(WriteDocument::new());
    let opened = open(&mut h, &bytes, file);
    let first = &opened["doc"]["body"][0];
    assert_eq!(first["kind"], "paragraph");
    let id = first["value"]["id"].clone();

    let patch = ok(
        &mut h,
        &json!({"type": "apply", "command": {"type": "insertText", "block": id, "offset": 0, "text": "EDITED "}}),
    );
    assert_eq!(patch["envelope"]["dirty"], true);

    let saved = ok(&mut h, &json!({"type": "saveDocx"}));
    let out = base64_decode(saved["bytesBase64"].as_str().unwrap()).unwrap();
    let mut h2 = WriteHost::new(WriteDocument::new());
    let reopened = open(&mut h2, &out, "copy.docx");
    assert!(plain_text(&reopened["doc"]["body"][0]).starts_with("EDITED "));
    assert_eq!(
        h2.doc().document().plain_text(),
        h.doc().document().plain_text()
    );
}

#[test]
fn dirty_and_mark_saved_semantics() {
    let file = "provisional-23-table-2x2.docx";
    let bytes = std::fs::read(testdata().join(file)).unwrap();
    let mut h = WriteHost::new(WriteDocument::new());
    let state = ok(&mut h, &json!({"type": "documentState"}));
    assert_eq!(
        state,
        json!({"type": "documentState", "dirty": false, "revision": 0, "name": null})
    );

    let opened = open(&mut h, &bytes, file);
    let rev = opened["envelope"]["revision"].as_u64().unwrap();
    let id = opened["doc"]["body"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["kind"] == "paragraph")
        .unwrap()["value"]["id"]
        .clone();
    ok(
        &mut h,
        &json!({"type": "apply", "command": {"type": "insertText", "block": id, "offset": 0, "text": "x"}}),
    );
    // saveDocx does not mark the document saved.
    ok(&mut h, &json!({"type": "saveDocx"}));
    let state = ok(&mut h, &json!({"type": "documentState"}));
    assert_eq!(state["dirty"], true);
    assert_eq!(state["name"], file);
    // markSaved without a name keeps the name; with a name renames (save as).
    let state = ok(&mut h, &json!({"type": "markSaved"}));
    assert_eq!(
        state,
        json!({"type": "documentState", "dirty": false, "revision": rev + 1, "name": file})
    );
    let state = ok(
        &mut h,
        &json!({"type": "markSaved", "name": "renamed.docx"}),
    );
    assert_eq!(state["name"], "renamed.docx");
    assert_eq!(
        ok(&mut h, &json!({"type": "saveDocx"}))["suggestedName"],
        "renamed.docx"
    );
    // Undo after a save makes the document dirty again.
    ok(&mut h, &json!({"type": "undo"}));
    assert_eq!(ok(&mut h, &json!({"type": "documentState"}))["dirty"], true);
    // A new document forgets the name and the file context.
    ok(&mut h, &json!({"type": "newDocument"}));
    assert_eq!(
        ok(&mut h, &json!({"type": "documentState"}))["name"],
        Json::Null
    );
    assert!(h.doc().docx_context.is_none());
    assert_eq!(
        ok(&mut h, &json!({"type": "saveDocx"}))["suggestedName"],
        "Untitled.docx"
    );
}

#[test]
fn open_errors() {
    let mut h = WriteHost::new(WriteDocument::new());
    let r = call(
        &mut h,
        &json!({"type": "openDocx", "bytesBase64": "%%%%", "name": "a.docx"}),
    );
    assert_eq!(r["err"]["code"], "bad_request");
    let r = call(
        &mut h,
        &json!({"type": "openDocx", "bytesBase64": base64_encode(b"not a zip"), "name": "a.docx"}),
    );
    assert_eq!(r["err"]["code"], "invalid_file");
    // A failed open leaves the document alone.
    assert_eq!(ok(&mut h, &json!({"type": "documentState"}))["revision"], 0);
}
