#![forbid(unsafe_code)]
//! Rusuite Show WebAssembly shell (ADR 0005 §2): one [`ShowHost`] per
//! page behind [`dispatch`]. No document logic lives here.

use std::cell::RefCell;

use show_core::{ShowDocument, ShowHost};
use wasm_bindgen::prelude::wasm_bindgen;

thread_local! {
    static HOST: RefCell<ShowHost> = RefCell::new(ShowHost::new(ShowDocument::new()));
}

/// Health check; same text as the Tauri `ping` command.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Show {}", env!("CARGO_PKG_VERSION"))
}

/// Runs one `show_core::dispatch_with` request (JSON in, JSON out)
/// against the page's presentation.
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request: &str) -> String {
    HOST.with(|host| {
        let mut host = host.borrow_mut();
        show_core::dispatch_with(&mut host, request)
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
        assert!(ping().starts_with("Rusuite Show "));
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
        let p = call(r#"{"type":"getPresentation"}"#);
        let slide = &p["ok"]["presentation"]["slides"][0]["id"];
        let v = call(&format!(
            r#"{{"type":"apply","command":{{"type":"addSlide","after":{slide},"layout":"blank","newIds":[-1]}}}}"#
        ));
        assert_eq!(v["ok"]["type"], "patch");
        assert_eq!(call(r#"{"type":"documentState"}"#)["ok"]["dirty"], true);
        let saved = call(r#"{"type":"savePptx"}"#);
        assert_eq!(saved["ok"]["suggestedName"], "Untitled.pptx");
        let opened = call(&format!(
            r#"{{"type":"openPptx","bytesBase64":{},"name":"x.pptx"}}"#,
            saved["ok"]["bytesBase64"]
        ));
        assert_eq!(opened["ok"]["type"], "opened");
        assert_eq!(call(r#"{"type":"documentState"}"#)["ok"]["name"], "x.pptx");
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
