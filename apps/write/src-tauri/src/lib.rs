#![forbid(unsafe_code)]
//! Rusuite Write Tauri shell (ADR 0005 §2): the `dispatch` command in front
//! of `write-core`. No document logic lives here.

/// Health check: `"Rusuite Write <version>"`.
#[tauri::command]
fn ping() -> String {
    format!("Rusuite Write {}", env!("CARGO_PKG_VERSION"))
}

/// The single document entry point (ADR 0002 amendment).
#[tauri::command]
fn dispatch(request: String) -> String {
    write_core::dispatch(&request)
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ping, dispatch])
        .run(tauri::generate_context!())
        .expect("error while running Rusuite Write");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_reports_version() {
        assert!(ping().starts_with("Rusuite Write "));
    }

    #[test]
    fn dispatch_answers_ping() {
        assert_eq!(
            dispatch(r#"{"type":"ping"}"#.into()),
            r#"{"ok":{"type":"pong"}}"#
        );
        assert!(dispatch("{}".into()).contains("unknown_request"));
    }
}
