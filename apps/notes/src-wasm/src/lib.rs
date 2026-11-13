#![forbid(unsafe_code)]
//! Rusuite Notes WebAssembly shell (ADR 0005 §2): one [`NotesHost`] per page behind [`dispatch`], plus binary
//! functions for Loro updates, stored documents, persist effects and backups (no base64 on the hot path). No
//! document logic lives here. Byte layouts: `docs/notes-format.md`.

use std::cell::RefCell;

use notes_core::{binary, NotesHost};
use wasm_bindgen::prelude::wasm_bindgen;

thread_local! {
    static HOST: RefCell<NotesHost> = RefCell::new(NotesHost::new("web"));
}

fn with<T>(f: impl FnOnce(&mut NotesHost) -> T) -> T {
    HOST.with(|h| f(&mut h.borrow_mut()))
}

/// Health check.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Notes {}", env!("CARGO_PKG_VERSION"))
}

/// Runs one `notes_core::dispatch_with` request (JSON in, JSON out). Requests may carry `"now"` (Unix ms).
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request: &str) -> String {
    with(|h| notes_core::dispatch_with(h, request))
}

/// Provides a stored document (snapshot, log in `.log` framing) before `openNotebook` → JSON `loaded`.
#[wasm_bindgen]
#[must_use]
pub fn load_doc(notebook: &str, doc: &str, snapshot: &[u8], log: &[u8]) -> String {
    with(|h| binary::load_doc(h, notebook, doc, snapshot, log))
}

/// Imports Loro update bytes (editor mirror's local updates or relay updates) → JSON `imported`.
#[wasm_bindgen]
#[must_use]
pub fn import_updates(doc: &str, bytes: &[u8]) -> String {
    with(|h| binary::import_updates(h, doc, bytes))
}

/// Updates of `doc` missing from version vector `vv` (`VersionVector.encode()`; empty = everything). Throws the
/// JSON error reply.
#[wasm_bindgen]
pub fn export_updates(doc: &str, vv: &[u8]) -> Result<Vec<u8>, String> {
    with(|h| {
        h.export_updates(doc, vv)
            .map_err(|e| binary::error_json(&e))
    })
}

/// The encoded version vector of `doc`.
#[wasm_bindgen]
pub fn version_vector(doc: &str) -> Result<Vec<u8>, String> {
    with(|h| h.version_vector(doc).map_err(|e| binary::error_json(&e)))
}

/// Drains the queued persist effects (framing in `docs/notes-format.md`).
#[wasm_bindgen]
#[must_use]
pub fn take_persist_effects() -> Vec<u8> {
    with(|h| notes_core::encode_effects(&h.take_effects()))
}

/// The page genesis update (the editor checks its mirror starts from exactly these bytes).
#[wasm_bindgen]
#[must_use]
pub fn page_genesis() -> Vec<u8> {
    notes_core::page_genesis()
}

/// A `.rnotes` backup of an open notebook; `blobs` = `{ len:u32 LE, bytes }*` of the blobs to include.
#[wasm_bindgen]
pub fn export_backup(notebook: &str, blobs: &[u8]) -> Result<Vec<u8>, String> {
    with(|h| {
        h.export_backup(notebook, &notes_core::split_blobs(blobs))
            .map_err(|e| binary::error_json(&e))
    })
}

/// Opens a notebook from a `.rnotes` backup → JSON `backupImported` (its docs and blobs are queued as effects).
#[wasm_bindgen]
#[must_use]
pub fn import_backup(bytes: &[u8]) -> String {
    with(|h| binary::import_backup(h, bytes))
}

/// Imports a file: `request` is an `importOneNote` / `importMarkdown` / `importHtml` / `importDocx` request (JSON,
/// may carry `"now"`), `bytes` the file → JSON `fileImported` (blobs are queued as persist effects).
#[wasm_bindgen]
#[must_use]
pub fn import_file(request: &str, bytes: &[u8]) -> String {
    with(|h| binary::import_file(h, request, bytes))
}

/// Exports a page or section: `request` is an `exportPage` / `exportSection` request (JSON), `blobs` the
/// `{ len:u32 LE, bytes }*` of the images/attachments it uses → the file's bytes (`.md`, `.zip`, `.html` or
/// `.docx`). Throws the JSON error reply.
#[wasm_bindgen]
pub fn export(request: &str, blobs: &[u8]) -> Result<Vec<u8>, String> {
    with(|h| binary::export(h, request, blobs))
}

/// The id (SHA-256 hex) of a blob.
#[wasm_bindgen]
#[must_use]
pub fn blob_id(bytes: &[u8]) -> String {
    notes_core::blob_id(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn call(request: &str) -> Value {
        serde_json::from_str(&dispatch(request)).unwrap()
    }

    #[test]
    fn ping_text() {
        assert!(ping().starts_with("Rusuite Notes "));
    }

    #[test]
    fn notebook_page_and_binary_round_trip() {
        call(r#"{"type":"hello","deviceId":"browser-1"}"#);
        let nb = call(r#"{"type":"createNotebook","name":"Web","id":"nb-w","now":1000}"#);
        assert_eq!(nb["ok"]["notebook"]["info"]["name"], "Web");
        let s = call(r#"{"type":"createSection","notebook":"nb-w","title":"S"}"#);
        let s = s["ok"]["id"].as_str().unwrap().to_string();
        let p = call(&format!(
            r#"{{"type":"createPage","notebook":"nb-w","parent":"{s}","title":"P"}}"#
        ));
        let doc = p["ok"]["page"]["docId"].as_str().unwrap().to_string();
        let opened = call(&format!(r#"{{"type":"openPage","docId":"{doc}"}}"#));
        assert_eq!(opened["ok"]["page"]["title"], "P");

        let all = export_updates(&doc, &[]).unwrap();
        let v: Value = serde_json::from_str(&import_updates(&doc, &all)).unwrap();
        assert_eq!(v["ok"]["result"]["changed"], false);
        assert!(!version_vector(&doc).unwrap().is_empty());
        let effects = notes_core::decode_effects(&take_persist_effects()).unwrap();
        assert!(!effects.is_empty());
        assert!(
            take_persist_effects().len() == 4,
            "drained: just the zero count"
        );

        let backup = export_backup("nb-w", &notes_core::log_record(b"img")).unwrap();
        let again: Value = serde_json::from_str(&import_backup(&backup)).unwrap();
        assert_eq!(again["err"]["code"], "notebook_open");
        assert_eq!(blob_id(b"img").len(), 64);
        assert!(!page_genesis().is_empty());
        let err = export_updates("nope", &[]).unwrap_err();
        assert!(err.contains("unknown_doc"), "{err}");
        let loaded: Value = serde_json::from_str(&load_doc("nb-x", "nb-x", &[], &[1, 2])).unwrap();
        assert_eq!(loaded["ok"]["warnings"][0]["code"], "truncated_log");

        // Import a Markdown file through the binary path, export it again.
        let req = format!(
            r#"{{"type":"importMarkdown","fileName":"a.md","notebook":"nb-w","parent":"{s}"}}"#
        );
        let r: Value =
            serde_json::from_str(&import_file(&req, b"# Title\n\nHello *world*\n")).unwrap();
        assert_eq!(r["ok"]["type"], "fileImported");
        let doc = r["ok"]["pages"][0]["docId"].as_str().unwrap().to_string();
        let md = export(
            &format!(r#"{{"type":"exportPage","docId":"{doc}","format":"md"}}"#),
            &[],
        )
        .unwrap();
        assert_eq!(String::from_utf8(md).unwrap(), "# Title\n\nHello *world*\n");
        let err = export(
            r#"{"type":"exportPage","docId":"nope","format":"html"}"#,
            &[],
        )
        .unwrap_err();
        assert!(err.contains("unknown_doc"), "{err}");
    }
}
