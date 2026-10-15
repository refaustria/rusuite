#![forbid(unsafe_code)]
//! Rusuite Write document core (ADR 0005 §2, ADR 0007): the
//! transport-agnostic part shared by the Tauri shell
//! (`apps/write/src-tauri`) and the wasm shell (`apps/write/src-wasm`).
//!
//! * [`WriteDocument`] wraps a [`model_text::Document`] and implements
//!   [`app_common::Document`]: [`WriteCommand`]s in, [`WritePatch`]es out,
//!   each command returning its inverse for undo/redo.
//! * [`dispatch_with`] is the single JSON entry point: a [`Request`] in, a
//!   [`Response`] out, against the shell's [`WriteHost`].
//! * TypeScript definitions of every wire type (including the
//!   `model-text` types, derived behind its `ts` feature) are generated
//!   with `ts-rs` into `apps/write/src/generated/` by `cargo test`.
//!
//! ```
//! use write_core::{dispatch_with, WriteDocument, WriteHost};
//!
//! let mut host = WriteHost::new(WriteDocument::new());
//! let id = host.doc().document().body[0].id().0;
//! let reply = dispatch_with(
//!     &mut host,
//!     &format!(r#"{{"type":"apply","command":{{"type":"insertText","block":{id},"offset":0,"text":"Hi"}}}}"#),
//! );
//! assert!(reply.starts_with(r#"{"ok":{"type":"patch","envelope":{"revision":1,"#));
//! assert!(reply.contains(r#""text":"Hi""#));
//! ```

mod command;
mod dispatch;
mod doc;
mod find;
mod patch;
mod text;
mod tree;

pub use command::{
    ListKind, MarginsPatch, NewBlock, NewCell, NewParagraph, NewRow, NewTable, PageSetupPatch,
    WriteCommand,
};
pub use dispatch::{dispatch_with, Request, Response, ResponseBody, WriteHost};
pub use doc::{WriteDocument, WriteError};
pub use patch::{InsertedBlock, WritePatch};

/// Transitional health-check endpoint of the P3-3 shells, which keep no
/// document yet: answers `{"type":"ping"}` with `{"ok":{"type":"pong"}}`,
/// everything else with `{"err":{"code":"unknown_request",…}}`. The shells
/// switch to [`dispatch_with`] and a [`WriteHost`] in P3-7; this function
/// goes away then.
#[must_use]
pub fn dispatch(request: &str) -> String {
    let kind = serde_json::from_str::<serde_json::Value>(request)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_owned));
    let reply = match kind.as_deref() {
        Some("ping") => serde_json::json!({"ok": {"type": "pong"}}),
        _ => serde_json::json!({
            "err": {"code": "unknown_request", "message": "unknown or malformed request"}
        }),
    };
    reply.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_ping() {
        assert_eq!(dispatch(r#"{"type":"ping"}"#), r#"{"ok":{"type":"pong"}}"#);
        for req in [r#"{"type":"nope"}"#, "not json", "{}"] {
            assert!(dispatch(req).contains("unknown_request"));
        }
    }
}
