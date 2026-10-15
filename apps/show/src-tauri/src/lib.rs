#![forbid(unsafe_code)]
//! Rusuite Show Tauri shell (ADR 0005 §2): a [`ShowHost`] behind the
//! `dispatch` command plus the native file dialogs. No document logic
//! lives here.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use core_model::media::{base64_decode, base64_encode, Base64Error};
use serde::{Serialize, Serializer};
use show_core::{ShowDocument, ShowHost};
use tauri_plugin_dialog::DialogExt;

/// The Tauri-managed app state: the host of the open presentation.
pub struct ShowState(pub Mutex<ShowHost>);

impl Default for ShowState {
    fn default() -> Self {
        ShowState(Mutex::new(ShowHost::new(ShowDocument::new())))
    }
}

impl ShowState {
    /// Runs one `show_core::dispatch_with` request (JSON in, JSON out). A
    /// poisoned lock is recovered: the host is never left half-updated.
    pub fn dispatch(&self, request: &str) -> String {
        let mut host = self.0.lock().unwrap_or_else(|e| e.into_inner());
        show_core::dispatch_with(&mut host, request)
    }
}

/// Errors of the file commands, sent to the UI as their message.
#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid base64: {0}")]
    Base64(#[from] Base64Error),
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
        bytes_base64: base64_encode(&bytes),
    })
}

/// Writes base64 `bytes_base64` to `path`.
pub fn write_file(path: &Path, bytes_base64: &str) -> Result<(), FileError> {
    let bytes = base64_decode(bytes_base64)?;
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Health check: `"Rusuite Show <version>"`.
#[tauri::command]
fn ping() -> String {
    format!("Rusuite Show {}", env!("CARGO_PKG_VERSION"))
}

/// The single document entry point (ADR 0002 amendment).
#[tauri::command]
fn dispatch(request: String, state: tauri::State<'_, ShowState>) -> String {
    state.dispatch(&request)
}

fn pptx_dialog(window: &tauri::Window) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    window
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("PowerPoint presentation", &["pptx"])
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
    let dialog = pptx_dialog(&window);
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
    let dialog = pptx_dialog(&window).set_file_name(suggested_name);
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
        .manage(ShowState::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            dispatch,
            open_file_dialog,
            save_file_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rusuite Show");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn call(state: &ShowState, request: Value) -> Value {
        serde_json::from_str(&state.dispatch(&request.to_string())).unwrap()
    }

    #[test]
    fn ping_reports_version() {
        assert!(ping().starts_with("Rusuite Show "));
    }

    #[test]
    fn dispatch_through_the_state() {
        let state = ShowState::default();
        let p = call(&state, json!({"type": "getPresentation"}));
        let slide = p["ok"]["presentation"]["slides"][0]["id"].clone();
        let r = call(
            &state,
            json!({"type": "apply", "command": {"type": "addSlide", "after": slide, "layout": "blank", "newIds": [-1]}}),
        );
        assert_eq!(r["ok"]["envelope"]["revision"], 1);
        assert_eq!(
            call(&state, json!({"type": "documentState"}))["ok"]["dirty"],
            true
        );
        let r = call(&state, json!({"type": "savePptx"}));
        assert_eq!(r["ok"]["suggestedName"], "Untitled.pptx");
        assert_eq!(
            call(&state, json!({"type": "documentState"}))["ok"]["dirty"],
            true
        );
        assert_eq!(
            call(&state, json!({"type": "markSaved", "name": "a.pptx"}))["ok"],
            json!({"type": "documentState", "dirty": false, "revision": 1, "name": "a.pptx"})
        );
        let opened = call(
            &state,
            json!({"type": "openPptx", "bytesBase64": r["ok"]["bytesBase64"], "name": "b.pptx"}),
        );
        assert_eq!(
            opened["ok"]["presentation"]["slides"]
                .as_array()
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            call(&state, json!({"type": "ping"}))["err"]["code"],
            "bad_request"
        );
    }

    #[test]
    fn file_roundtrip_and_errors() {
        let dir = std::env::temp_dir().join(format!("rusuite-show-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("deck.pptx");
        write_file(&path, "UEsDBA==").unwrap();
        let opened = read_file(&path).unwrap();
        assert_eq!(opened.name, "deck.pptx");
        assert_eq!(opened.bytes_base64, "UEsDBA==");
        assert_eq!(
            serde_json::to_value(&opened).unwrap()["bytesBase64"],
            "UEsDBA=="
        );
        assert!(matches!(write_file(&path, "%%"), Err(FileError::Base64(_))));
        let missing = read_file(&dir.join("missing.pptx")).unwrap_err();
        assert!(serde_json::to_string(&missing)
            .unwrap()
            .starts_with("\"i/o error"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
