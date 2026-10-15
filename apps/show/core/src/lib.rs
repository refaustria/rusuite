#![forbid(unsafe_code)]
//! Rusuite Show document core (ADR 0005 §2). Placeholder: only the
//! transport (`dispatch`) exists; the document arrives with a later task.

use serde_json::{json, Value};

/// The JSON entry point both shells call: `dispatch(request_json) ->
/// response_json`. Answers `{"type":"ping"}` with `{"ok":{"type":"pong"}}`;
/// everything else is `{"err":{"code":"unknown_request",…}}`.
#[must_use]
pub fn dispatch(request: &str) -> String {
    let kind = serde_json::from_str::<Value>(request)
        .ok()
        .and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_owned));
    let reply = match kind.as_deref() {
        Some("ping") => json!({"ok": {"type": "pong"}}),
        _ => json!({"err": {"code": "unknown_request", "message": "unknown or malformed request"}}),
    };
    reply.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_is_answered() {
        assert_eq!(dispatch(r#"{"type":"ping"}"#), r#"{"ok":{"type":"pong"}}"#);
    }

    #[test]
    fn everything_else_is_unknown_request() {
        for req in [r#"{"type":"nope"}"#, "not json", "{}"] {
            let v: Value = serde_json::from_str(&dispatch(req)).unwrap();
            assert_eq!(v["err"]["code"], "unknown_request");
        }
    }
}
