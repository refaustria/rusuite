#![forbid(unsafe_code)]
//! Rusuite Write WebAssembly shell (ADR 0005 §2): one [`WriteHost`] per
//! page behind [`dispatch`]. No document logic lives here.

use std::cell::RefCell;

use wasm_bindgen::prelude::wasm_bindgen;
use write_core::{WriteDocument, WriteHost};

thread_local! {
    static HOST: RefCell<WriteHost> = RefCell::new(WriteHost::new(WriteDocument::new()));
}

/// Health check; same text as the Tauri `ping` command.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Write {}", env!("CARGO_PKG_VERSION"))
}

/// Runs one `write_core::dispatch_with` request (JSON in, JSON out)
/// against the page's document.
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request: &str) -> String {
    HOST.with(|host| {
        let mut host = host.borrow_mut();
        write_core::dispatch_with(&mut host, request)
    })
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
        assert!(ping().starts_with("Rusuite Write "));
    }

    #[test]
    fn dispatch_state_and_errors() {
        let v = call(r#"{"type":"documentState"}"#);
        assert_eq!(v["ok"]["type"], "documentState");
        for req in [r#"{"type":"ping"}"#, "not json"] {
            assert_eq!(call(req)["err"]["code"], "bad_request");
        }
    }

    #[test]
    fn dispatch_keeps_state_between_calls() {
        let doc = call(r#"{"type":"getDocument"}"#);
        let id = &doc["ok"]["doc"]["body"][0]["value"]["id"];
        let v = call(&format!(
            r#"{{"type":"apply","command":{{"type":"insertText","block":{id},"offset":0,"text":"Hi"}}}}"#
        ));
        assert_eq!(v["ok"]["type"], "patch");
        assert_eq!(call(r#"{"type":"documentState"}"#)["ok"]["dirty"], true);
        let saved = call(r#"{"type":"saveDocx"}"#);
        assert_eq!(saved["ok"]["suggestedName"], "Untitled.docx");
    }
    #[test]
    fn recovery_snapshot_roundtrip() {
        // The page keeps recovery entries in IndexedDB; the core only
        // produces and restores the snapshot JSON.
        let snap = call(r#"{"type":"recoverySnapshot"}"#);
        assert_eq!(snap["ok"]["type"], "recoverySnapshot");
        let request =
            serde_json::json!({"type": "restoreRecovery", "json": snap["ok"]["json"], "name": "r"});
        assert!(call(&request.to_string())["ok"].is_object());
        let st = call(r#"{"type":"documentState"}"#);
        assert_eq!(
            (&st["ok"]["dirty"], &st["ok"]["name"]),
            (&Value::Bool(true), &Value::from("r"))
        );
    }
}
