#![forbid(unsafe_code)]
//! Rusuite Calc Tauri shell (ADR 0005 §2): a [`CalcHost`] behind the
//! `dispatch` command plus the native file dialogs. No document logic
//! lives here.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use calc_core::{CalcDocument, CalcHost};
use serde::{Serialize, Serializer};
use tauri_plugin_dialog::DialogExt;

/// The Tauri-managed app state: the host of the open document.
pub struct CalcState(pub Mutex<CalcHost>);

impl Default for CalcState {
    fn default() -> Self {
        CalcState(Mutex::new(CalcHost::new(CalcDocument::new())))
    }
}

impl CalcState {
    /// Runs one `calc_core::dispatch` request (JSON in, JSON out). A
    /// poisoned lock is recovered: the host is never left half-updated.
    pub fn dispatch(&self, request: &str) -> String {
        let mut host = self.0.lock().unwrap_or_else(|e| e.into_inner());
        calc_core::dispatch(&mut host, request)
    }
}

/// Errors of the file commands, sent to the UI as their message.
#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid base64: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("the dialog returned a non-file path")]
    InvalidPath,
    #[error("file dialog failed: {0}")]
    Dialog(String),
}

impl Serialize for FileError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// A file picked in the open dialog.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    /// The file name without the directory.
    pub name: String,
    /// The file contents, standard base64.
    pub bytes_base64: String,
}

/// Reads `path` for the UI.
pub fn read_file(path: &Path) -> Result<OpenedFile, FileError> {
    let bytes = std::fs::read(path)?;
    Ok(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
        bytes_base64: STANDARD.encode(bytes),
    })
}

/// Writes base64 `bytes_base64` to `path`.
pub fn write_file(path: &Path, bytes_base64: &str) -> Result<(), FileError> {
    let bytes = STANDARD.decode(bytes_base64.as_bytes())?;
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Health check: `"Rusuite Calc <version>"`.
#[tauri::command]
fn ping() -> String {
    format!("Rusuite Calc {}", env!("CARGO_PKG_VERSION"))
}

/// The single document entry point (ADR 0002 amendment).
#[tauri::command]
fn dispatch(request: String, state: tauri::State<'_, CalcState>) -> String {
    state.dispatch(&request)
}

fn xlsx_dialog(window: &tauri::Window) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    window
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("Excel workbook", &["xlsx"])
}

/// Runs a blocking dialog off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, FileError> + Send + 'static,
) -> Result<T, FileError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| FileError::Dialog(e.to_string()))?
}

fn into_path(p: tauri_plugin_dialog::FilePath) -> Result<PathBuf, FileError> {
    p.into_path().map_err(|_| FileError::InvalidPath)
}

/// Shows the native open dialog and reads the picked file; `None` when
/// cancelled.
#[tauri::command]
async fn open_file_dialog(window: tauri::Window) -> Result<Option<OpenedFile>, FileError> {
    let dialog = xlsx_dialog(&window);
    blocking(move || {
        dialog
            .blocking_pick_file()
            .map(|p| read_file(&into_path(p)?))
            .transpose()
    })
    .await
}

/// Shows the native save dialog and writes the file; the chosen path, or
/// `None` when cancelled.
#[tauri::command]
async fn save_file_dialog(
    window: tauri::Window,
    suggested_name: String,
    bytes_base64: String,
) -> Result<Option<String>, FileError> {
    let dialog = xlsx_dialog(&window).set_file_name(suggested_name);
    blocking(move || {
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = into_path(path)?;
        write_file(&path, &bytes_base64)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(CalcState::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            dispatch,
            open_file_dialog,
            save_file_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rusuite Calc");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn call(state: &CalcState, request: Value) -> Value {
        serde_json::from_str(&state.dispatch(&request.to_string())).unwrap()
    }

    #[test]
    fn ping_reports_version() {
        assert!(ping().starts_with("Rusuite Calc "));
    }

    #[test]
    fn dispatch_through_the_state() {
        let state = CalcState::default();
        let r = call(
            &state,
            json!({"type": "apply", "command": {"type": "setInput", "sheet": 0, "row": 0, "col": 0, "input": "=6*7"}}),
        );
        assert_eq!(r["ok"]["envelope"]["revision"], 1);
        assert_eq!(
            r["ok"]["envelope"]["patch"]["cells"][0]["cells"][0]["display"],
            "42"
        );
        let r = call(&state, json!({"type": "documentState"}));
        assert_eq!(r["ok"]["dirty"], true);
        let r = call(&state, json!({"type": "saveXlsx"}));
        assert_eq!(r["ok"]["suggestedName"], "Untitled.xlsx");
        assert_eq!(
            call(&state, json!({"type": "documentState"}))["ok"]["dirty"],
            true
        );
        assert_eq!(
            call(&state, json!({"type": "markSaved"}))["ok"]["dirty"],
            false
        );
        assert_eq!(
            call(&state, json!({"type": "nope"}))["err"]["code"],
            "bad_request"
        );
    }

    #[test]
    fn file_roundtrip_and_errors() {
        let dir = std::env::temp_dir().join(format!("rusuite-calc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("book.xlsx");
        write_file(&path, "UEsDBA==").unwrap();
        let opened = read_file(&path).unwrap();
        assert_eq!(opened.name, "book.xlsx");
        assert_eq!(opened.bytes_base64, "UEsDBA==");
        assert_eq!(
            serde_json::to_value(&opened).unwrap()["bytesBase64"],
            "UEsDBA=="
        );
        assert!(matches!(write_file(&path, "%%"), Err(FileError::Base64(_))));
        let missing = read_file(&dir.join("missing.xlsx")).unwrap_err();
        assert!(serde_json::to_string(&missing)
            .unwrap()
            .starts_with("\"i/o error"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
