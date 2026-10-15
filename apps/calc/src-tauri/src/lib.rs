#![forbid(unsafe_code)]
//! Rusuite Calc Tauri shell.

/// Health-check command used by the placeholder UI.
#[tauri::command]
fn ping() -> String {
    format!("Rusuite Calc {}", env!("CARGO_PKG_VERSION"))
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running Rusuite Calc");
}

#[cfg(test)]
mod tests {
    #[test]
    fn ping_reports_version() {
        assert!(super::ping().starts_with("Rusuite Calc "));
    }
}
