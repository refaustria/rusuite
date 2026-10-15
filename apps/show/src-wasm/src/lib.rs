#![forbid(unsafe_code)]
//! Rusuite Show WebAssembly shell (ADR 0005 §2). No document logic lives
//! here.

use wasm_bindgen::prelude::wasm_bindgen;

/// Health check; same text as the Tauri `ping` command.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Show {}", env!("CARGO_PKG_VERSION"))
}

/// Runs one `show_core::dispatch` request (JSON in, JSON out).
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request: &str) -> String {
    show_core::dispatch(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_text() {
        assert!(ping().starts_with("Rusuite Show "));
    }

    #[test]
    fn dispatch_ping() {
        assert_eq!(dispatch(r#"{"type":"ping"}"#), r#"{"ok":{"type":"pong"}}"#);
    }
}
