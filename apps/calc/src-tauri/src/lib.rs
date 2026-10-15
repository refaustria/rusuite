#![forbid(unsafe_code)]
//! Rusuite Calc Tauri shell.

/// Health-check command used by the placeholder UI.
#[tauri::command]
fn ping() -> String {
    format!("Rusuite Calc {}", env!("CARGO_PKG_VERSION"))
}

/// Placeholder request dispatcher (the real one is wired up by calc-core).
#[tauri::command]
fn dispatch(request: String) -> String {
    if request.contains("\"ping\"") {
        format!(r#"{{"ok":{{"pong":"{}"}}}}"#, ping())
    } else {
        r#"{"err":{"code":"unknown_request","message":"unknown request"}}"#.to_owned()
    }
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, dispatch])
        .run(tauri::generate_context!())
        .expect("error while running Rusuite Calc");
}

#[cfg(test)]
mod tests {
    #[test]
    fn ping_reports_version() {
        assert!(super::ping().starts_with("Rusuite Calc "));
    }

    #[test]
    fn dispatch_placeholder() {
        assert!(super::dispatch(r#"{"type":"ping"}"#.to_owned()).starts_with(r#"{"ok""#));
        assert!(super::dispatch("{}".to_owned()).contains("unknown_request"));
    }
}
