#![forbid(unsafe_code)]
//! Rusuite Calc WebAssembly shell (placeholder dispatcher).

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Wire-level request; the real command set comes from calc-core later.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Ping,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Response {
    Ok { pong: String },
    Err { code: &'static str, message: String },
}

fn banner() -> String {
    format!("Rusuite Calc {}", env!("CARGO_PKG_VERSION"))
}

/// Health check; same text as the Tauri `ping` command.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    banner()
}

/// Dispatches a JSON request and returns a JSON response
/// (`{"ok":{...}}` or `{"err":{"code","message"}}`).
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request_json: &str) -> String {
    let response = match serde_json::from_str::<Request>(request_json) {
        Ok(Request::Ping) => Response::Ok { pong: banner() },
        Err(e) => Response::Err {
            code: "unknown_request",
            message: e.to_string(),
        },
    };
    serde_json::to_string(&response).unwrap_or_else(|_| {
        r#"{"err":{"code":"internal","message":"serialization failed"}}"#.to_owned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_text() {
        assert!(ping().starts_with("Rusuite Calc "));
    }

    #[test]
    fn dispatch_ping() {
        let v: serde_json::Value = serde_json::from_str(&dispatch(r#"{"type":"ping"}"#)).unwrap();
        assert_eq!(v["ok"]["pong"], ping());
    }

    #[test]
    fn dispatch_unknown() {
        for req in [r#"{"type":"nope"}"#, "not json"] {
            let v: serde_json::Value = serde_json::from_str(&dispatch(req)).unwrap();
            assert_eq!(v["err"]["code"], "unknown_request");
        }
    }
}
