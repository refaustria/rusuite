#![forbid(unsafe_code)]
//! Rusuite Write WebAssembly shell (ADR 0005 §2). No document logic lives
//! here.

use wasm_bindgen::prelude::wasm_bindgen;

/// Health check; same text as the Tauri `ping` command.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Write {}", env!("CARGO_PKG_VERSION"))
}

/// Runs one `write_core::dispatch` request (JSON in, JSON out).
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request: &str) -> String {
    write_core::dispatch(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_text() {
        assert!(ping().starts_with("Rusuite Write "));
    }

    #[test]
    fn dispatch_ping() {
        assert_eq!(dispatch(r#"{"type":"ping"}"#), r#"{"ok":{"type":"pong"}}"#);
    }
}
