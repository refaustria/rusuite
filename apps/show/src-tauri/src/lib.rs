#![forbid(unsafe_code)]
//! Rusuite Show Tauri shell (ADR 0005 §2): a [`ShowHost`] behind the
//! `dispatch` command plus the native file dialogs and the recent-files /
//! crash-recovery store (`SessionState`). No document logic lives here.

pub mod smoke;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(desktop)]
use app_common::connectors_tauri;
use app_common::session::{
    DirStorage, RecentEntry, RecoveryEntry, RecoveryInfo, Session, SessionError,
};

use core_model::media::{base64_decode, base64_encode, Base64Error};
use serde::{Deserialize, Serialize, Serializer};
use show_core::{ShowDocument, ShowHost};
use tauri::{Emitter, Manager};
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
    #[error("{0}")]
    Session(#[from] SessionError),
    #[error("not a recent file: {0}")]
    NotRecent(String),
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

/// A file written by `save_file`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SavedFile {
    pub path: String,
    /// The file name without the directory (the document's new name).
    pub name: String,
}

impl SavedFile {
    fn new(path: &Path) -> Self {
        SavedFile {
            path: path.to_string_lossy().into_owned(),
            name: file_name(path),
        }
    }
}

/// The file name of `path` without the directory.
fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

/// Reads `path` for the UI.
pub fn read_file(path: &Path) -> Result<OpenedFile, FileError> {
    let bytes = std::fs::read(path)?;
    Ok(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        name: file_name(path),
        bytes_base64: base64_encode(&bytes),
    })
}

/// Writes base64 `bytes_base64` to `path`.
pub fn write_file(path: &Path, bytes_base64: &str) -> Result<(), FileError> {
    let bytes = base64_decode(bytes_base64)?;
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Whole milliseconds since the Unix epoch (as `Date.now()`).
fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// Recent files and crash-recovery entries (P5-3), JSON files in the app
/// data directory (`app_common::session`).
pub struct SessionState(pub Mutex<Session<DirStorage>>);

impl SessionState {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        SessionState(Mutex::new(Session::new(DirStorage::new(dir))))
    }

    fn session(&self) -> std::sync::MutexGuard<'_, Session<DirStorage>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Puts `path` (just opened or saved) at the top of the recent list.
    pub fn record(&self, path: &str) -> Result<Vec<RecentEntry>, FileError> {
        let name = Path::new(path)
            .file_name()
            .map_or_else(|| path.to_owned(), |n| n.to_string_lossy().into_owned());
        Ok(self.session().add_recent(RecentEntry {
            name,
            path: Some(path.to_owned()),
            blob_id: None,
            opened_at: now_ms(),
        })?)
    }

    /// Reads a file of the recent list (only listed paths can be read; a
    /// file that no longer exists is dropped from the list).
    pub fn open_recent(&self, path: &str) -> Result<OpenedFile, FileError> {
        if self.session().recent_path(path)?.is_none() {
            return Err(FileError::NotRecent(path.to_owned()));
        }
        match read_file(Path::new(path)) {
            Ok(file) => {
                self.record(path)?;
                Ok(file)
            }
            Err(FileError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                self.session().remove_recent(path)?;
                Err(FileError::Io(e))
            }
            Err(e) => Err(e),
        }
    }
}

/// Event sent to the UI when a close request was held (`ui-shared`'s
/// `CLOSE_REQUESTED_EVENT`).
pub const CLOSE_REQUESTED_EVENT: &str = "rusuite://close-requested";

/// Unsaved-changes close guard (P7-6): the UI sets it while the document
/// is dirty. A close request is then held and passed to the UI, which asks
/// Save / Don't save / Cancel, clears the guard and closes the window again.
#[derive(Debug, Default)]
pub struct CloseGuard(AtomicBool);

impl CloseGuard {
    pub fn set(&self, on: bool) {
        self.0.store(on, Ordering::SeqCst);
    }

    pub fn is_set(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// Decides a close request: `true` = hold it (prevent the close and ask the UI).
    pub fn hold_close(&self) -> bool {
        self.is_set()
    }
}

/// The file the open document is bound to (P7-7): set by Open (the
/// dialog or a recent file) and by Save As, cleared when the document is
/// replaced by a new or recovered one. A plain Save writes there without a
/// dialog.
#[derive(Debug, Default)]
pub struct DocPath(Mutex<PathState>);

#[derive(Debug, Default)]
struct PathState {
    current: Option<PathBuf>,
    /// A file read for opening; it becomes `current` once the core opened it.
    opening: Option<PathBuf>,
}

/// The `type` of a dispatched request (the rest is skipped).
#[derive(Deserialize)]
struct RequestType<'a> {
    #[serde(rename = "type", borrow)]
    kind: std::borrow::Cow<'a, str>,
}

impl DocPath {
    fn state(&self) -> std::sync::MutexGuard<'_, PathState> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn current(&self) -> Option<PathBuf> {
        self.state().current.clone()
    }

    /// Binds the document to `path` (after Save As).
    pub fn set(&self, path: Option<PathBuf>) {
        let mut st = self.state();
        st.current = path;
        st.opening = None;
    }

    /// `path` was read for opening (see [`DocPath::observe`]).
    pub fn opening(&self, path: PathBuf) {
        self.state().opening = Some(path);
    }

    /// Where a save writes without asking: the current file, unless Save As.
    pub fn save_target(&self, save_as: bool) -> Option<PathBuf> {
        if save_as {
            None
        } else {
            self.current()
        }
    }

    /// Follows a dispatched request and its reply: a successful open binds
    /// the file read for it (none: opened from bytes, untitled); a new,
    /// loaded or recovered document is untitled.
    pub fn observe(&self, request: &str, reply: &str) {
        if !reply.starts_with("{\"ok\"") {
            return;
        }
        let Ok(RequestType { kind }) = serde_json::from_str::<RequestType<'_>>(request) else {
            return;
        };
        let mut st = self.state();
        match kind.as_ref() {
            "openPptx" => st.current = st.opening.take(),
            "newPresentation" | "load" | "restoreRecovery" => {
                st.current = None;
                st.opening = None;
            }
            _ => {}
        }
    }
}

#[tauri::command]
fn set_close_guard(on: bool, guard: tauri::State<'_, CloseGuard>) {
    guard.set(on);
}

#[tauri::command]
fn recent_list(state: tauri::State<'_, SessionState>) -> Result<Vec<RecentEntry>, FileError> {
    Ok(state.session().recent()?)
}

/// Re-opens a file of the recent list → its contents (as `open_file_dialog`).
#[tauri::command]
fn recent_open(
    path: String,
    state: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
) -> Result<OpenedFile, FileError> {
    let file = state.open_recent(&path)?;
    doc_path.opening(PathBuf::from(&file.path));
    Ok(file)
}

#[tauri::command]
fn recovery_list(state: tauri::State<'_, SessionState>) -> Result<Vec<RecoveryInfo>, FileError> {
    Ok(state.session().recovery_list()?)
}

#[tauri::command]
fn recovery_get(
    id: String,
    state: tauri::State<'_, SessionState>,
) -> Result<Option<RecoveryEntry>, FileError> {
    Ok(state.session().recovery_get(&id)?)
}

#[tauri::command]
fn recovery_put(
    entry: RecoveryEntry,
    state: tauri::State<'_, SessionState>,
) -> Result<(), FileError> {
    Ok(state.session().recovery_put(&entry)?)
}

#[tauri::command]
fn recovery_remove(id: String, state: tauri::State<'_, SessionState>) -> Result<(), FileError> {
    Ok(state.session().recovery_remove(&id)?)
}

/// Opens the webview's native print dialog (File › Print, P7-9):
/// WebKitGTK's print operation on Linux (the command runs on the main
/// thread, so it returns once the dialog is closed), `NSPrintOperation` on
/// macOS, `window.print()` in WebView2. The page shows only the print view
/// under `@media print`.
#[cfg(desktop)]
#[tauri::command]
fn print_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Mobile webviews have no print operation (P10-M6 adds PDF + share sheet): `Backend.print` rejects and the UI
/// hides Print (`Backend.capabilities.print`).
#[cfg(mobile)]
#[tauri::command]
fn print_webview() -> Result<(), String> {
    Err("unsupported".to_owned())
}

/// Health check: `"Rusuite Show <version>"`.
#[tauri::command]
fn ping() -> String {
    format!("Rusuite Show {}", env!("CARGO_PKG_VERSION"))
}

/// The single document entry point (ADR 0002 amendment); the shell only
/// watches it for the document's file ([`DocPath::observe`]).
#[tauri::command]
fn dispatch(
    request: String,
    state: tauri::State<'_, ShowState>,
    doc_path: tauri::State<'_, DocPath>,
) -> String {
    let reply = state.dispatch(&request);
    doc_path.observe(&request, &reply);
    reply
}

/// Localized texts of a native file dialog, passed by the UI (P7-11).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogText {
    /// Window title ("Open", "Speichern unter", …).
    title: Option<String>,
    /// Name of the file-type filter ("Excel workbook", …).
    filter_name: Option<String>,
}

/// The native file dialog for `.pptx` files, with the UI's texts; without
/// them the platform's title and the English filter name.
fn pptx_dialog(
    window: &tauri::Window,
    text: Option<DialogText>,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let text = text.unwrap_or_default();
    let dialog = parented(window.dialog().file(), window).add_filter(
        text.filter_name
            .as_deref()
            .unwrap_or("PowerPoint presentation"),
        &["pptx"],
    );
    match text.title {
        Some(title) => dialog.set_title(title),
        None => dialog,
    }
}

/// The dialog's parent window (desktop; the mobile pickers are always modal).
#[cfg(desktop)]
fn parented(
    dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    window: &tauri::Window,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    dialog.set_parent(window)
}

#[cfg(mobile)]
fn parented(
    dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    _window: &tauri::Window,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    dialog
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
async fn open_file_dialog(
    window: tauri::Window,
    session: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
    dialog: Option<DialogText>,
) -> Result<Option<OpenedFile>, FileError> {
    let dialog = pptx_dialog(&window, dialog);
    let picked = blocking(move || {
        dialog
            .blocking_pick_file()
            .map(|p| read_file(&into_path(p)?))
            .transpose()
    })
    .await?;
    if let Some(file) = &picked {
        // The recent list is a convenience: failing to update it never
        // fails the open.
        let _ = session.record(&file.path);
        doc_path.opening(PathBuf::from(&file.path));
    }
    Ok(picked)
}

/// Saves the document (P7-7): a plain Save (`save_as` false) of a document
/// bound to a file writes there; otherwise the native save dialog asks
/// (in the current file's directory) and the document is bound to the
/// chosen file. The written file, or `None` when cancelled.
#[tauri::command]
async fn save_file(
    window: tauri::Window,
    session: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
    suggested_name: String,
    bytes_base64: String,
    save_as: bool,
    dialog: Option<DialogText>,
) -> Result<Option<SavedFile>, FileError> {
    let saved = match doc_path.save_target(save_as) {
        Some(path) => {
            blocking(move || {
                write_file(&path, &bytes_base64)?;
                Ok(Some(path))
            })
            .await?
        }
        None => {
            let mut dialog = pptx_dialog(&window, dialog).set_file_name(suggested_name);
            if let Some(dir) = doc_path.current().as_deref().and_then(Path::parent) {
                dialog = dialog.set_directory(dir);
            }
            blocking(move || {
                let Some(path) = dialog.blocking_save_file() else {
                    return Ok(None);
                };
                let path = into_path(path)?;
                write_file(&path, &bytes_base64)?;
                Ok(Some(path))
            })
            .await?
        }
    };
    let Some(path) = saved else {
        return Ok(None);
    };
    doc_path.set(Some(path.clone()));
    let file = SavedFile::new(&path);
    let _ = session.record(&file.path);
    Ok(Some(file))
}

/// `--smoke` (P8-41, [`smoke`]): the page's report of its IPC round trip;
/// prints the result and exits. Ignored unless started with `--smoke`.
#[tauri::command]
fn smoke_report(
    window: tauri::WebviewWindow,
    smoke: tauri::State<'_, smoke::Smoke>,
    report: smoke::Report,
) {
    smoke.finish("Rusuite Show", &window.title().unwrap_or_default(), &report);
}

/// Design › Save Current Theme (P9-S5): writes a file that is not the
/// document (a `.thmx`) where the native save dialog says, without binding
/// the document to it or recording it as recent. The file name, or `None`
/// when cancelled.
#[tauri::command]
async fn export_file(
    window: tauri::Window,
    suggested_name: String,
    bytes_base64: String,
    filter_name: String,
    extension: String,
) -> Result<Option<String>, FileError> {
    let dialog = parented(window.dialog().file(), &window)
        .add_filter(filter_name, &[extension.as_str()])
        .set_file_name(suggested_name);
    blocking(move || {
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = into_path(path)?;
        write_file(&path, &bytes_base64)?;
        Ok(Some(file_name(&path)))
    })
    .await
}

// ----- Slide Show › Monitors (P9-S5) -------------------------------------------------------

/// A monitor as the Monitor menu lists it (logical pixels).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Index in the shell's monitor list (the remembered choice).
    pub index: usize,
    /// The system's name of the monitor, if any.
    pub name: Option<String>,
    /// Whether it is the primary monitor.
    pub primary: bool,
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// A monitor's rectangle in physical pixels: `(x, y, width, height)`.
type PhysRect = (i32, i32, u32, u32);

/// The monitor (index into `rects`) containing the point `p`.
#[cfg_attr(mobile, allow(dead_code))]
fn monitor_at(rects: &[PhysRect], p: (i32, i32)) -> Option<usize> {
    rects.iter().position(|&(x, y, w, h)| {
        p.0 >= x
            && p.1 >= y
            && i64::from(p.0) < i64::from(x) + i64::from(w)
            && i64::from(p.1) < i64::from(y) + i64::from(h)
    })
}

/// Swap displays: where the presenter view (`main`) and the slide show
/// (`audience`) go – each to the other's monitor; `None` when they share
/// one (nothing to swap) or a monitor is unknown.
#[cfg_attr(mobile, allow(dead_code))]
fn swap_plan(main: Option<usize>, audience: Option<usize>) -> Option<(usize, usize)> {
    match (main, audience) {
        (Some(m), Some(a)) if m != a => Some((a, m)),
        _ => None,
    }
}

/// The monitors, primary flagged (P9-S5: Slide Show › Monitor).
#[tauri::command]
fn show_monitors(window: tauri::WebviewWindow) -> Vec<MonitorInfo> {
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| *m.position());
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, m)| {
            let k = m.scale_factor().max(0.1);
            MonitorInfo {
                index,
                name: m.name().cloned(),
                primary: primary == Some(*m.position()),
                x: f64::from(m.position().x) / k,
                y: f64::from(m.position().y) / k,
                width: f64::from(m.size().width) / k,
                height: f64::from(m.size().height) / k,
            }
        })
        .collect()
}

/// Presenter view › Swap displays: the slide show window moves to the
/// presenter view's monitor (full screen) and the main window to the
/// show's. Returns whether anything moved.
#[cfg(desktop)]
#[tauri::command]
fn show_swap_displays(app: tauri::AppHandle) -> bool {
    let (Some(main), Some(show)) = (
        app.get_webview_window("main"),
        app.get_webview_window("audience"),
    ) else {
        return false;
    };
    let monitors = main.available_monitors().unwrap_or_default();
    let rects: Vec<PhysRect> = monitors
        .iter()
        .map(|m| {
            (
                m.position().x,
                m.position().y,
                m.size().width,
                m.size().height,
            )
        })
        .collect();
    let centre = |w: &tauri::WebviewWindow| -> Option<(i32, i32)> {
        let p = w.outer_position().ok()?;
        let s = w.outer_size().ok()?;
        let half = |v: u32| i32::try_from(v / 2).unwrap_or(0);
        Some((
            p.x.saturating_add(half(s.width)),
            p.y.saturating_add(half(s.height)),
        ))
    };
    let at = |w: &tauri::WebviewWindow| centre(w).and_then(|c| monitor_at(&rects, c));
    let Some((main_to, show_to)) = swap_plan(at(&main), at(&show)) else {
        return false;
    };
    let origin = |i: usize| {
        let (x, y, _, _) = rects[i];
        tauri::PhysicalPosition::new(x, y)
    };
    let main_max = main.is_maximized().unwrap_or(false);
    let _ = show.set_fullscreen(false);
    let _ = main.unmaximize();
    let _ = show.set_position(origin(show_to));
    let _ = main.set_position(origin(main_to));
    let _ = show.set_fullscreen(true);
    if main_max {
        let _ = main.maximize();
    }
    true
}

/// Mobile: one display, nothing to swap (the presenter view is desktop-only for now).
#[cfg(mobile)]
#[tauri::command]
fn show_swap_displays() -> bool {
    false
}

/// Builds and runs the Tauri application.
///
/// # Panics
/// Panics if the Tauri runtime fails to start.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(smoke::Smoke::from_args())
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && webview.label() == "main"
                && webview.state::<smoke::Smoke>().start()
            {
                smoke::watchdog();
                let _ = webview.eval(smoke::SCRIPT);
            }
        })
        .manage(CloseGuard::default())
        .manage(DocPath::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseGuard>().hold_close() {
                    api.prevent_close();
                    let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
                }
            }
        })
        .manage(ShowState::default())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("rusuite-show"));
            // Cloud connections (P8-36): records next to the session files, passwords in the OS keyring.
            // Desktop only (owner rule): mobile builds have neither connections nor the AI assistant.
            #[cfg(desktop)]
            app.manage(connectors_tauri::ConnectorState::new(&dir));
            app.manage(SessionState::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            smoke_report,
            dispatch,
            open_file_dialog,
            save_file,
            recent_list,
            recent_open,
            recovery_list,
            recovery_get,
            recovery_put,
            recovery_remove,
            set_close_guard,
            print_webview,
            show_monitors,
            show_swap_displays,
            export_file,
            #[cfg(mobile)]
            #[cfg(desktop)]
            connectors_tauri::connector_list,
            #[cfg(desktop)]
            connectors_tauri::connector_stat,
            #[cfg(desktop)]
            connectors_tauri::connector_read,
            #[cfg(desktop)]
            connectors_tauri::connector_write,
            #[cfg(desktop)]
            connectors_tauri::connector_mkdir,
            #[cfg(desktop)]
            connectors_tauri::connector_delete,
            #[cfg(desktop)]
            connectors_tauri::connector_rename,
            #[cfg(desktop)]
            connectors_tauri::connector_store_load,
            #[cfg(desktop)]
            connectors_tauri::connector_store_save,
            #[cfg(desktop)]
            connectors_tauri::connector_secret_get,
            #[cfg(desktop)]
            connectors_tauri::connector_secret_set,
            #[cfg(desktop)]
            connectors_tauri::connector_secret_delete
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
    fn monitors_contain_points_and_swap_exchanges_them() {
        let rects = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert_eq!(monitor_at(&rects, (10, 10)), Some(0));
        assert_eq!(monitor_at(&rects, (1920, 5)), Some(1));
        assert_eq!(monitor_at(&rects, (5000, 5)), None);
        assert_eq!(monitor_at(&rects, (-1, 5)), None);
        assert_eq!(swap_plan(Some(0), Some(1)), Some((1, 0)));
        assert_eq!(swap_plan(Some(1), Some(1)), None);
        assert_eq!(swap_plan(None, Some(1)), None);
    }

    #[test]
    fn close_guard_holds_close_requests_only_while_set() {
        let guard = CloseGuard::default();
        assert!(!guard.hold_close());
        guard.set(true);
        assert!(guard.is_set());
        assert!(guard.hold_close());
        // Still set: every further request is held until the UI clears it.
        assert!(guard.hold_close());
        guard.set(false);
        assert!(!guard.hold_close());
        assert_eq!(CLOSE_REQUESTED_EVENT, "rusuite://close-requested");
    }

    #[test]
    fn doc_path_follows_open_save_as_and_new() {
        let state = ShowState::default();
        let doc_path = DocPath::default();
        let run = |request: Value| {
            let request = request.to_string();
            let reply = state.dispatch(&request);
            doc_path.observe(&request, &reply);
            serde_json::from_str::<Value>(&reply).unwrap()
        };
        // Untitled: Save asks (no target).
        assert_eq!(doc_path.save_target(false), None);
        let bytes = run(json!({"type": "savePptx"}))["ok"]["bytesBase64"].clone();
        // Opened from bytes alone (no file read for it): still untitled.
        run(json!({"type": "openPptx", "bytesBase64": bytes, "name": "a.pptx"}));
        assert_eq!(doc_path.current(), None);
        // A file read for opening is bound once the core opened it; a
        // failed open keeps the previous binding.
        let file = PathBuf::from("/docs/a.pptx");
        doc_path.opening(file.clone());
        let bad = run(json!({"type": "openPptx", "bytesBase64": "UEsDBA==", "name": "a.pptx"}));
        assert!(bad.get("err").is_some(), "{bad}");
        assert_eq!(doc_path.current(), None);
        run(json!({"type": "openPptx", "bytesBase64": bytes, "name": "a.pptx"}));
        assert_eq!(doc_path.current(), Some(file.clone()));
        // Save writes there; Save As always asks.
        assert_eq!(doc_path.save_target(false), Some(file));
        assert_eq!(doc_path.save_target(true), None);
        // Other requests keep the binding; Save As re-binds.
        run(json!({"type": "documentState"}));
        let other = PathBuf::from("/docs/b.pptx");
        doc_path.set(Some(other.clone()));
        assert_eq!(doc_path.save_target(false), Some(other));
        assert_eq!(SavedFile::new(Path::new("/docs/b.pptx")).name, "b.pptx");
        // New: untitled again.
        run(json!({"type": "newPresentation"}));
        assert_eq!(doc_path.current(), None);
        // Garbage never panics.
        doc_path.observe("not json", "{\"ok\":{}}");
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
    #[test]
    fn recent_files_and_recovery_in_the_data_dir() {
        let dir = std::env::temp_dir().join(format!("rusuite-show-session-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let state = SessionState::new(dir.join("data"));
        let file = dir.join("doc.pptx");
        write_file(&file, "UEsDBA==").unwrap();
        let path = file.to_string_lossy().into_owned();
        // Only listed paths can be re-opened.
        assert!(matches!(
            state.open_recent(&path),
            Err(FileError::NotRecent(_))
        ));
        let list = state.record(&path).unwrap();
        assert_eq!(list[0].name, "doc.pptx");
        assert_eq!(state.open_recent(&path).unwrap().bytes_base64, "UEsDBA==");
        // A vanished file drops out of the list.
        std::fs::remove_file(&file).unwrap();
        assert!(matches!(state.open_recent(&path), Err(FileError::Io(_))));
        assert!(state.session().recent().unwrap().is_empty());
        // Recovery entries persist across sessions (a new state = restart).
        let entry = RecoveryEntry {
            id: "doc-1".into(),
            name: None,
            saved_at: now_ms(),
            revision: app_common::Revision(3),
            json: "{}".into(),
        };
        state.session().recovery_put(&entry).unwrap();
        let restarted = SessionState::new(dir.join("data"));
        assert_eq!(restarted.session().recovery_list().unwrap()[0].id, "doc-1");
        assert_eq!(
            restarted.session().recovery_get("doc-1").unwrap(),
            Some(entry)
        );
        let err = restarted.session().recovery_get("../x").unwrap_err();
        assert!(serde_json::to_string(&FileError::from(err))
            .unwrap()
            .contains("invalid document id"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
