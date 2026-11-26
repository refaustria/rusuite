#![forbid(unsafe_code)]
//! Rusuite Notes WebAssembly shell (ADR 0005 §2): one [`NotesHost`] per page behind [`dispatch`], plus binary
//! functions for Loro updates, stored documents, persist effects and backups (no base64 on the hot path). No
//! document logic lives here. The converters are not in this module (P11-N6b): `app-notes-convert-wasm` turns files
//! into import plans that [`apply_import`] applies, and exports the `pageExportSource` / `sectionExportSource`
//! replies of [`dispatch`]. Byte layouts: `docs/notes-format.md`.

use std::cell::RefCell;

use notes_core::{binary, log_record, NotesHost};
use wasm_bindgen::prelude::wasm_bindgen;

pub mod sync;
use sync::{SyncClient, SyncResult};

thread_local! {
    static HOST: RefCell<NotesHost> = RefCell::new(NotesHost::new("web"));
    static SYNC: RefCell<SyncClient> = RefCell::new(SyncClient::new());
}

fn sync<T>(f: impl FnOnce(&mut SyncClient) -> T) -> T {
    SYNC.with(|s| f(&mut s.borrow_mut()))
}

/// JS numbers for clocks and counters (wasm-bindgen maps `u64` to `BigInt`).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn u64_of(n: f64) -> u64 {
    if n.is_finite() && n > 0.0 {
        n as u64
    } else {
        0
    }
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

/// The device got its sharing id: peers recorded for `from` are recorded for `to` (persist effects queued).
#[wasm_bindgen]
pub fn rebind_device(from: &str, to: &str) -> Result<(), String> {
    with(|h| {
        h.rebind_device(from, to)
            .map_err(|e| binary::error_json(&e))
    })
}

/// Imports relay bytes into `doc` of open notebook `notebook` (a page doc may arrive before its tree node) →
/// whether anything changed. Throws the JSON error reply.
#[wasm_bindgen]
pub fn import_remote(notebook: &str, doc: &str, bytes: &[u8]) -> Result<bool, String> {
    with(|h| {
        h.import_updates(doc, bytes, Some(notebook))
            .map(|r| r.changed)
            .map_err(|e| binary::error_json(&e))
    })
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

/// [`export_updates`] in parts of at most `max_bytes` (the relay's envelope limit; P11-X1) as `{len:u32 LE, bytes}*`.
/// Throws the JSON error reply.
#[wasm_bindgen]
pub fn export_update_chunks(doc: &str, vv: &[u8], max_bytes: u32) -> Result<Vec<u8>, String> {
    with(|h| {
        h.export_update_chunks(doc, vv, max_bytes as usize)
            .map(|parts| parts.iter().flat_map(|p| log_record(p)).collect())
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

/// Applies an import: `request` is an `importOneNote` / `importMarkdown` / `importHtml` / `importDocx` request
/// (JSON, may carry `"now"`; its target fields count), `plan` the frame `app-notes-convert-wasm`'s `import_file` made
/// from the file → JSON `fileImported` (blobs are queued as persist effects).
#[wasm_bindgen]
#[must_use]
pub fn apply_import(request: &str, plan: &[u8]) -> String {
    with(|h| binary::apply_import(h, request, plan))
}

/// Stores an image / attachment of `notebook` (queued as a Blob persist effect) → its id (SHA-256 hex). Throws the
/// JSON error reply (unknown notebook).
#[wasm_bindgen]
pub fn put_blob(notebook: &str, bytes: &[u8]) -> Result<String, String> {
    with(|h| binary::put_blob(h, notebook, bytes))
}

/// The id (SHA-256 hex) of a blob.
#[wasm_bindgen]
#[must_use]
pub fn blob_id(bytes: &[u8]) -> String {
    notes_core::blob_id(bytes)
}

// ---- sharing (P11-N5b, `sync` module; secrets never leave this module except as the bytes the UI stores) ----------

/// New device keys → their bytes (store them; they are the device's identity).
#[wasm_bindgen]
#[must_use]
pub fn sync_device_create() -> Vec<u8> {
    sync(SyncClient::device_create)
}

/// Loads stored device keys → the device id (hex).
#[wasm_bindgen]
pub fn sync_device_load(bytes: &[u8]) -> SyncResult<String> {
    sync(|s| s.device_load(bytes))
}

/// Restores a shared notebook's state → its status JSON.
#[wasm_bindgen]
pub fn sync_book_load(bytes: &[u8]) -> SyncResult<String> {
    sync(|s| s.book_load(bytes).map(|v| v.to_string()))
}

/// A shared notebook's state to store (member lists, keyring, invites, open join requests).
#[wasm_bindgen]
pub fn sync_book_save(notebook: &str) -> SyncResult<Vec<u8>> {
    sync(|s| s.book_save(notebook))
}

#[wasm_bindgen]
pub fn sync_book_forget(notebook: &str) -> SyncResult<()> {
    sync(|s| s.book_forget(notebook))
}

#[wasm_bindgen]
pub fn sync_set_local_id(notebook: &str, local_id: &str) -> SyncResult<()> {
    sync(|s| s.set_local_id(notebook, local_id))
}

/// Turns sharing on → `{len u32 LE, status JSON}{len, genesis envelope}`.
#[wasm_bindgen]
pub fn sync_share_create(local_id: &str, display_name: &str) -> SyncResult<Vec<u8>> {
    sync(|s| {
        let (v, env) = s.share_create(local_id, display_name)?;
        let mut out = log_record(v.to_string().as_bytes());
        out.extend(log_record(&env));
        Ok(out)
    })
}

#[wasm_bindgen]
pub fn sync_join_start(fragment: &str, now_secs: f64) -> SyncResult<String> {
    sync(|s| {
        s.join_start(fragment, u64_of(now_secs))
            .map(|v| v.to_string())
    })
}

#[wasm_bindgen]
pub fn sync_join_request(notebook: &str, name: &str, now_secs: f64) -> SyncResult<Vec<u8>> {
    sync(|s| s.join_request(notebook, name, u64_of(now_secs)))
}

#[wasm_bindgen]
pub fn sync_status(notebook: &str) -> SyncResult<String> {
    sync(|s| s.status(notebook).map(|v| v.to_string()))
}

#[wasm_bindgen]
pub fn sync_doc_id(notebook: &str, doc: &str) -> SyncResult<String> {
    sync(|s| s.doc_id(notebook, doc))
}

#[wasm_bindgen]
pub fn sync_blob_doc_id(notebook: &str, sha: &str) -> SyncResult<String> {
    sync(|s| s.blob_doc_id(notebook, sha))
}

/// `Subscribe` for `docs` = JSON `[[doc hex, seq], …]`.
#[wasm_bindgen]
pub fn sync_subscribe(notebook: &str, docs: &str) -> SyncResult<Vec<u8>> {
    let list: Vec<(String, f64)> = serde_json::from_str(docs).map_err(|e| e.to_string())?;
    let list: Vec<(String, u64)> = list.into_iter().map(|(d, n)| (d, u64_of(n))).collect();
    sync(|s| s.subscribe_frame(notebook, &list))
}

#[wasm_bindgen]
pub fn sync_publish(tag: u32, envelope: &[u8]) -> SyncResult<Vec<u8>> {
    SyncClient::publish_frame(tag, envelope)
}

#[wasm_bindgen]
pub fn sync_fetch_blob(notebook: &str, sha: &str) -> SyncResult<Vec<u8>> {
    sync(|s| s.fetch_blob_frame(notebook, sha))
}

#[wasm_bindgen]
pub fn sync_stop_sharing(notebook: &str, now_secs: f64) -> SyncResult<Vec<u8>> {
    sync(|s| s.stop_sharing_frame(notebook, u64_of(now_secs)))
}

/// An Update (`covers` 0) or Snapshot envelope of local doc `doc`.
#[wasm_bindgen]
pub fn sync_seal_doc(notebook: &str, doc: &str, covers: f64, data: &[u8]) -> SyncResult<Vec<u8>> {
    sync(|s| s.seal_doc(notebook, doc, u64_of(covers), data))
}

#[wasm_bindgen]
pub fn sync_seal_blob(notebook: &str, sha: &str, data: &[u8]) -> SyncResult<Vec<u8>> {
    sync(|s| s.seal_blob(notebook, sha, data))
}

#[wasm_bindgen]
pub fn sync_seal_presence(notebook: &str, data: &[u8]) -> SyncResult<Vec<u8>> {
    sync(|s| s.seal_presence(notebook, data))
}

#[wasm_bindgen]
pub fn sync_reencrypt(notebook: &str, envelope: &[u8]) -> SyncResult<Vec<u8>> {
    sync(|s| s.reencrypt(notebook, envelope))
}

#[wasm_bindgen]
pub fn sync_envelope_epoch(envelope: &[u8]) -> SyncResult<u32> {
    SyncClient::envelope_epoch(envelope)
}

#[wasm_bindgen]
pub fn sync_invite_create(
    notebook: &str,
    role: &str,
    relay_hint: &str,
    now_secs: f64,
) -> SyncResult<String> {
    sync(|s| {
        s.invite_create(notebook, role, relay_hint, u64_of(now_secs))
            .map(|v| v.to_string())
    })
}

/// Admits a join request → framed envelopes (member list, key wrap).
#[wasm_bindgen]
pub fn sync_admit(notebook: &str, invite_id: &str) -> SyncResult<Vec<u8>> {
    sync(|s| s.admit(notebook, invite_id))
}

#[wasm_bindgen]
pub fn sync_decline(notebook: &str, invite_id: &str) -> SyncResult<()> {
    sync(|s| s.decline(notebook, invite_id))
}

/// Removes a device (key rotation) → framed envelopes (member list, key wraps).
#[wasm_bindgen]
pub fn sync_remove(notebook: &str, device: &str) -> SyncResult<Vec<u8>> {
    sync(|s| s.remove(notebook, device))
}

#[wasm_bindgen]
pub fn sync_set_role(notebook: &str, device: &str, role: &str) -> SyncResult<Vec<u8>> {
    sync(|s| s.set_role(notebook, device, role))
}

/// One relay frame of `notebook`'s connection → JSON event (decrypted bytes via `sync_take_payload`).
#[wasm_bindgen]
#[must_use]
pub fn sync_handle(notebook: &str, frame: &[u8], now_secs: f64) -> String {
    sync(|s| s.handle(notebook, frame, u64_of(now_secs)).to_string())
}

#[wasm_bindgen]
#[must_use]
pub fn sync_take_payload() -> Vec<u8> {
    sync(SyncClient::take_payload)
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

        // Apply an import plan (as the convert module makes them), then describe the page for an export.
        let plan = r#"{"page":{"title":"Title","blocks":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}}"#;
        let frame = notes_core::plan::encode_frame(plan, [b"img".as_slice()]);
        let req = format!(
            r#"{{"type":"importMarkdown","fileName":"a.md","notebook":"nb-w","parent":"{s}"}}"#
        );
        let r: Value = serde_json::from_str(&apply_import(&req, &frame)).unwrap();
        assert_eq!(r["ok"]["type"], "fileImported");
        let doc = r["ok"]["pages"][0]["docId"].as_str().unwrap().to_string();
        let src = call(&format!(r#"{{"type":"pageExportSource","docId":"{doc}"}}"#));
        assert_eq!(src["ok"]["source"]["title"], "Title");
        let r: Value = serde_json::from_str(&apply_import(&req, &frame[..3])).unwrap();
        assert_eq!(r["err"]["code"], "bad_request");
    }
}
