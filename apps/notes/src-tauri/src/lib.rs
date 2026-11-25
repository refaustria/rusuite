#![forbid(unsafe_code)]
//! Rusuite Notes desktop shell (P11-N7, ADR 0005 §2 / ADR 0010): the native [`NotesHost`] (`notes-core` with the
//! `fs` and `convert` features) behind the same calls as the web's wasm module, the notebook folders
//! ([`folders`]), the sharing relay setting and the window's Content-Security-Policy ([`relay`]), the OS keyring
//! (device keys, the AI key) and the native dialogs. No document logic lives here.
//!
//! Byte-carrying commands use raw IPC bodies (no base64): the UI sends `json_len:u32 LE` + the JSON arguments +
//! the payload bytes ([`args`]) and gets bytes back as an `ArrayBuffer`. Errors are strings – the core's JSON
//! error reply where there is one.

pub mod folders;
pub mod relay;
pub mod smoke;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use app_common::connectors_tauri::{self, ConnectorState};
use app_common::session::{DirStorage, RecentEntry, Session, SessionError};
use notes_core::{binary, NotesHost, PersistEffect};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize, Serializer};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use folders::{FolderError, Folders, OpenedFolder};
use relay::RelayConfig;

pub const APP_NAME: &str = "Rusuite Notes";

/// The keyring entry of the sharing device keys (`sync:deviceKeys`).
pub const DEVICE_KEYS_SECRET: &str = "rusuite-notes-device-keys";

/// The fallback file of the device keys when the OS keyring is unavailable (app data directory).
pub const DEVICE_KEYS_FILE: &str = "device-keys.hex";

// ---- errors -------------------------------------------------------------------------------------------------

/// Errors of the shell's commands, sent to the UI as their message.
#[derive(Debug, thiserror::Error)]
pub enum ShellError {
    #[error("{0}")]
    Folder(#[from] FolderError),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Session(#[from] SessionError),
    #[error("{0}")]
    Relay(#[from] relay::SaveError),
    #[error("bad arguments: {0}")]
    Args(String),
    #[error("the dialog returned a non-file path")]
    InvalidPath,
    #[error("not a recent notebook: {0}")]
    NotRecent(String),
    #[error("{0}")]
    Core(String),
    #[error("{0}")]
    Task(String),
}

impl Serialize for ShellError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type Res<T> = Result<T, ShellError>;

// ---- state --------------------------------------------------------------------------------------------------

/// The core host of the window (replaced by `notes_reset` when the page (re)starts).
pub struct NotesState(Mutex<NotesHost>);

impl Default for NotesState {
    fn default() -> Self {
        NotesState(Mutex::new(NotesHost::new("desktop")))
    }
}

impl NotesState {
    /// The host; a poisoned lock is recovered (the host is never left half-updated).
    pub fn host(&self) -> MutexGuard<'_, NotesHost> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The notebook folders and app settings.
pub struct FolderState(Mutex<Folders>);

impl FolderState {
    fn get(&self) -> MutexGuard<'_, Folders> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The recent notebook folders (`app_common::session`, the shared recent list of the desktop apps).
pub struct SessionState(Mutex<Session<DirStorage>>);

impl SessionState {
    fn get(&self) -> MutexGuard<'_, Session<DirStorage>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn record(&self, folder: &OpenedFolder) {
        // The recent list is a convenience: failing to update it never fails an open.
        let _ = self.get().add_recent(RecentEntry {
            name: folder.name.clone(),
            path: Some(folder.path.clone()),
            blob_id: None,
            opened_at: now_ms(),
        });
    }
}

/// The app data directory and the relay setting the window was created with.
pub struct AppDirs {
    data: PathBuf,
    relay: RelayConfig,
    /// The device keys are in the fallback file (no usable OS keyring).
    keys_in_file: AtomicBool,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

// ---- raw IPC ------------------------------------------------------------------------------------------------

/// Splits a raw body (`json_len:u32 LE` + JSON + payload) into the arguments and the payload; a JSON body is
/// all arguments.
pub fn split_args<T: DeserializeOwned>(body: &InvokeBody) -> Res<(T, &[u8])> {
    let bad = |m: String| ShellError::Args(m);
    match body {
        InvokeBody::Json(v) => Ok((
            serde_json::from_value(v.clone()).map_err(|e| bad(e.to_string()))?,
            &[],
        )),
        InvokeBody::Raw(b) => {
            let len = b
                .get(..4)
                .map(|h| u32::from_le_bytes([h[0], h[1], h[2], h[3]]) as usize)
                .ok_or_else(|| bad("short body".into()))?;
            let json = b.get(4..4 + len).ok_or_else(|| bad("short body".into()))?;
            let args = serde_json::from_slice(json).map_err(|e| bad(e.to_string()))?;
            Ok((args, &b[4 + len..]))
        }
    }
}

fn args<T: DeserializeOwned>(req: &Request<'_>) -> Res<(T, Vec<u8>)> {
    split_args(req.body()).map(|(a, p)| (a, p.to_vec()))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| ShellError::Task(e.to_string()))?
}

#[derive(Deserialize)]
struct NbDoc {
    notebook: String,
    doc: String,
}
#[derive(Deserialize)]
struct Doc {
    doc: String,
}
#[derive(Deserialize)]
struct Nb {
    notebook: String,
}
#[derive(Deserialize)]
struct Req {
    request: String,
}
#[derive(Deserialize)]
struct FromTo {
    from: String,
    to: String,
}
#[derive(Deserialize)]
struct NbSha {
    notebook: String,
    sha: String,
}
#[derive(Deserialize)]
struct NoArgs {}

/// A core JSON error reply as the command's error (the UI's `rethrow` turns it into a `CoreError`).
fn core_err(e: &notes_core::CoreError) -> ShellError {
    ShellError::Core(binary::error_json(e))
}

// ---- core commands (the wasm module's calls) ----------------------------------------------------------------

#[tauri::command]
fn ping() -> String {
    format!("{APP_NAME} {}", env!("CARGO_PKG_VERSION"))
}

/// A fresh host for a (re)loaded page: the page loads its notebooks again.
#[tauri::command]
fn notes_reset(state: tauri::State<'_, NotesState>) {
    *state.host() = NotesHost::new("desktop");
}

#[tauri::command]
async fn dispatch(request: String, state: tauri::State<'_, NotesState>) -> Res<String> {
    Ok(notes_core::dispatch_with(&mut state.host(), &request))
}

#[tauri::command]
async fn load_doc(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<String> {
    let (a, payload): (NbDoc, _) = args(&req)?;
    // The payload is the snapshot (`len:u32` + bytes) followed by the log.
    let (snapshot, log) = split_pair(&payload)?;
    Ok(binary::load_doc(
        &mut state.host(),
        &a.notebook,
        &a.doc,
        snapshot,
        log,
    ))
}

fn split_pair(b: &[u8]) -> Res<(&[u8], &[u8])> {
    let len = b
        .get(..4)
        .map(|h| u32::from_le_bytes([h[0], h[1], h[2], h[3]]) as usize)
        .ok_or_else(|| ShellError::Args("short pair".into()))?;
    let first = b
        .get(4..4 + len)
        .ok_or_else(|| ShellError::Args("short pair".into()))?;
    Ok((first, &b[4 + len..]))
}

#[tauri::command]
async fn import_updates(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<String> {
    let (a, bytes): (Doc, _) = args(&req)?;
    Ok(binary::import_updates(&mut state.host(), &a.doc, &bytes))
}

#[tauri::command]
async fn rebind_device(from: String, to: String, state: tauri::State<'_, NotesState>) -> Res<()> {
    let a = FromTo { from, to };
    state
        .host()
        .rebind_device(&a.from, &a.to)
        .map_err(|e| core_err(&e))
}

#[tauri::command]
async fn import_remote(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<bool> {
    let (a, bytes): (NbDoc, _) = args(&req)?;
    state
        .host()
        .import_updates(&a.doc, &bytes, Some(&a.notebook))
        .map(|r| r.changed)
        .map_err(|e| core_err(&e))
}

#[tauri::command]
async fn export_updates(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<Response> {
    let (a, vv): (Doc, _) = args(&req)?;
    let out = state
        .host()
        .export_updates(&a.doc, &vv)
        .map_err(|e| core_err(&e))?;
    Ok(Response::new(out))
}

#[tauri::command]
async fn version_vector(doc: String, state: tauri::State<'_, NotesState>) -> Res<Response> {
    let out = state
        .host()
        .version_vector(&doc)
        .map_err(|e| core_err(&e))?;
    Ok(Response::new(out))
}

#[tauri::command]
async fn take_persist_effects(state: tauri::State<'_, NotesState>) -> Res<Response> {
    let effects = state.host().take_effects();
    Ok(Response::new(notes_core::encode_effects(&effects)))
}

#[tauri::command]
fn page_genesis() -> Response {
    Response::new(notes_core::page_genesis())
}

#[tauri::command]
async fn export_backup(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<Response> {
    let (a, blobs): (Nb, _) = args(&req)?;
    let out = state
        .host()
        .export_backup(&a.notebook, &notes_core::split_blobs(&blobs))
        .map_err(|e| core_err(&e))?;
    Ok(Response::new(out))
}

#[tauri::command]
async fn import_backup(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<String> {
    let (_, bytes): (NoArgs, _) = args(&req)?;
    Ok(binary::import_backup(&mut state.host(), &bytes))
}

#[tauri::command]
async fn apply_import(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<String> {
    let (a, frame): (Req, _) = args(&req)?;
    Ok(binary::apply_import(&mut state.host(), &a.request, &frame))
}

#[tauri::command]
async fn put_blob(req: Request<'_>, state: tauri::State<'_, NotesState>) -> Res<String> {
    let (a, bytes): (Nb, _) = args(&req)?;
    binary::put_blob(&mut state.host(), &a.notebook, &bytes).map_err(ShellError::Core)
}

#[tauri::command]
async fn blob_id(req: Request<'_>) -> Res<String> {
    let (_, bytes): (NoArgs, _) = args(&req)?;
    Ok(notes_core::blob_id(&bytes))
}

// ---- converters (native: the web's `app-notes-convert-wasm`) -------------------------------------------------

#[tauri::command]
async fn convert_import(req: Request<'_>) -> Res<Response> {
    let (a, bytes): (Req, _) = args(&req)?;
    blocking(move || {
        notes_core::plan::convert::wire::import_file(&a.request, &bytes)
            .map(Response::new)
            .map_err(ShellError::Core)
    })
    .await
}

#[tauri::command]
async fn convert_export(req: Request<'_>) -> Res<Response> {
    let (a, blobs): (Req, _) = args(&req)?;
    blocking(move || {
        notes_core::plan::convert::wire::export(&a.request, &blobs)
            .map(Response::new)
            .map_err(ShellError::Core)
    })
    .await
}

#[tauri::command]
async fn convert_paste_html(request: String) -> Res<Response> {
    blocking(move || {
        notes_core::plan::convert::wire::paste_html(&request)
            .map(Response::new)
            .map_err(ShellError::Core)
    })
    .await
}

// ---- storage (the UI's `NotesStore`) ------------------------------------------------------------------------

/// Writes persist effects (the `take_persist_effects` encoding) into the notebook folders.
#[tauri::command]
async fn store_apply(
    req: Request<'_>,
    notes: tauri::State<'_, NotesState>,
    folders: tauri::State<'_, FolderState>,
) -> Res<()> {
    let (_, bytes): (NoArgs, _) = args(&req)?;
    let effects: Vec<PersistEffect> =
        notes_core::decode_effects(&bytes).ok_or_else(|| ShellError::Args("bad effects".into()))?;
    let names: std::collections::BTreeMap<String, String> = notes
        .host()
        .list_notebooks()
        .into_iter()
        .map(|n| (n.id, n.info.name))
        .collect();
    folders.get().apply(&effects, |id| names.get(id).cloned())?;
    Ok(())
}

/// A notebook's stored documents: `json_len:u32` + `{"docs":[id…],"warnings":[…]}` + per doc the snapshot and
/// the log, each as `len:u32` + bytes.
#[tauri::command]
async fn store_load(notebook: String, folders: tauri::State<'_, FolderState>) -> Res<Response> {
    let (docs, warnings) = folders.get().load_docs(&notebook)?;
    let json = serde_json::json!({
        "docs": docs.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(),
        "warnings": warnings,
    })
    .to_string();
    let mut out = Vec::with_capacity(
        4 + json.len()
            + docs
                .iter()
                .map(|d| 8 + d.snapshot.len() + d.log.len())
                .sum::<usize>(),
    );
    push_record(&mut out, json.as_bytes());
    for d in &docs {
        push_record(&mut out, &d.snapshot);
        push_record(&mut out, &d.log);
    }
    Ok(Response::new(out))
}

fn push_record(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&u32::try_from(b.len()).unwrap_or(u32::MAX).to_le_bytes());
    out.extend_from_slice(b);
}

/// All blobs of a notebook, `{len:u32, bytes}*`.
#[tauri::command]
async fn store_blobs(notebook: String, folders: tauri::State<'_, FolderState>) -> Res<Response> {
    let blobs = folders.get().blobs(&notebook)?;
    let mut out = Vec::new();
    for b in &blobs {
        push_record(&mut out, b);
    }
    Ok(Response::new(out))
}

/// One blob; an empty body when it is not stored (a stored blob is never empty: its id is its hash).
#[tauri::command]
async fn store_get_blob(
    notebook: String,
    sha: String,
    folders: tauri::State<'_, FolderState>,
) -> Res<Response> {
    let a = NbSha { notebook, sha };
    Ok(Response::new(
        folders
            .get()
            .get_blob(&a.notebook, &a.sha)
            .unwrap_or_default(),
    ))
}

/// Forgets a notebook's folder (the folder stays on disk).
#[tauri::command]
async fn store_forget(notebook: String, folders: tauri::State<'_, FolderState>) -> Res<()> {
    Ok(folders.get().forget(&notebook)?)
}

/// "Remove local data": forgets all folders, the settings and the device keys (the folders stay).
#[tauri::command]
async fn store_clear(
    folders: tauri::State<'_, FolderState>,
    session: tauri::State<'_, SessionState>,
    connectors: tauri::State<'_, ConnectorState>,
    dirs: tauri::State<'_, AppDirs>,
) -> Res<()> {
    folders.get().forget_all()?;
    {
        let mut s = session.get();
        for e in s.recent()? {
            s.remove_recent(e.key())?;
        }
    }
    let _ = connectors.secrets().delete(DEVICE_KEYS_SECRET);
    match std::fs::remove_file(dirs.data.join(DEVICE_KEYS_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
        _ => {}
    }
    Ok(())
}

#[tauri::command]
async fn meta_get(key: String, folders: tauri::State<'_, FolderState>) -> Res<Option<String>> {
    Ok(folders.get().meta_get(&key)?)
}

#[tauri::command]
async fn meta_set(
    key: String,
    json: Option<String>,
    folders: tauri::State<'_, FolderState>,
) -> Res<()> {
    Ok(folders.get().meta_set(&key, json.as_deref())?)
}

// ---- device keys: the OS keyring, else a file in the app data directory -------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeysInfo {
    /// The keys are in the fallback file, not the OS keyring (the UI warns).
    in_file: bool,
}

/// The device keys (raw bytes; empty: none stored).
#[tauri::command]
async fn device_keys_get(
    connectors: tauri::State<'_, ConnectorState>,
    dirs: tauri::State<'_, AppDirs>,
) -> Res<Response> {
    let secrets = connectors.secrets();
    let data = dirs.data.clone();
    let (hex, in_file) = blocking(move || {
        Ok(match secrets.get(DEVICE_KEYS_SECRET) {
            Ok(Some(hex)) => (Some(hex), false),
            _ => (
                std::fs::read_to_string(data.join(DEVICE_KEYS_FILE)).ok(),
                true,
            ),
        })
    })
    .await?;
    let bytes = hex.and_then(|h| from_hex(h.trim())).unwrap_or_default();
    dirs.keys_in_file
        .store(in_file && !bytes.is_empty(), Ordering::SeqCst);
    Ok(Response::new(bytes))
}

/// Stores the device keys in the OS keyring; without one, in the app data directory (→ `inFile`).
#[tauri::command]
async fn device_keys_set(
    req: Request<'_>,
    connectors: tauri::State<'_, ConnectorState>,
    dirs: tauri::State<'_, AppDirs>,
) -> Res<KeysInfo> {
    let (_, bytes): (NoArgs, _) = args(&req)?;
    let hex = to_hex(&bytes);
    let secrets = connectors.secrets();
    let data = dirs.data.clone();
    let in_file = blocking(move || {
        let file = data.join(DEVICE_KEYS_FILE);
        if secrets.set(DEVICE_KEYS_SECRET, &hex).is_ok()
            && secrets.get(DEVICE_KEYS_SECRET).ok().flatten().as_deref() == Some(hex.as_str())
        {
            match std::fs::remove_file(&file) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                _ => {}
            }
            return Ok(false);
        }
        std::fs::create_dir_all(&data)?;
        std::fs::write(&file, hex)?;
        Ok(true)
    })
    .await?;
    dirs.keys_in_file.store(in_file, Ordering::SeqCst);
    Ok(KeysInfo { in_file })
}

#[tauri::command]
fn device_keys_info(dirs: tauri::State<'_, AppDirs>) -> KeysInfo {
    KeysInfo {
        in_file: dirs.keys_in_file.load(Ordering::SeqCst),
    }
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

// ---- notebook folders: dialogs and the recent list ----------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogText {
    title: Option<String>,
    filter_name: Option<String>,
}

fn into_path(p: tauri_plugin_dialog::FilePath) -> Res<PathBuf> {
    p.into_path().map_err(|_| ShellError::InvalidPath)
}

fn folder_dialog(
    window: &tauri::Window,
    text: Option<DialogText>,
    dir: &Path,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let text = text.unwrap_or_default();
    let mut d = window.dialog().file().set_parent(window);
    if dir.is_dir() {
        d = d.set_directory(dir);
    }
    match text.title {
        Some(t) => d.set_title(t),
        None => d,
    }
}

/// File › New notebook in folder…: picks the folder of the next new notebook → whether one was picked.
#[tauri::command]
async fn notebook_pick_location(
    window: tauri::Window,
    folders: tauri::State<'_, FolderState>,
    dialog: Option<DialogText>,
) -> Res<bool> {
    let root = folders.get().default_root().to_path_buf();
    let _ = std::fs::create_dir_all(&root);
    let d = folder_dialog(&window, dialog, &root);
    let picked = blocking(move || d.blocking_pick_folder().map(into_path).transpose()).await?;
    let ok = picked.is_some();
    folders.get().set_pending(picked);
    Ok(ok)
}

/// File › Open notebook folder…: a folder with `notebook.json` → the notebook (`None`: cancelled).
#[tauri::command]
async fn notebook_open_folder(
    window: tauri::Window,
    folders: tauri::State<'_, FolderState>,
    session: tauri::State<'_, SessionState>,
    dialog: Option<DialogText>,
) -> Res<Option<OpenedFolder>> {
    let root = folders.get().default_root().to_path_buf();
    let d = folder_dialog(&window, dialog, &root);
    let Some(path) = blocking(move || d.blocking_pick_folder().map(into_path).transpose()).await?
    else {
        return Ok(None);
    };
    let opened = folders.get().open_folder(&path)?;
    session.record(&opened);
    Ok(Some(opened))
}

/// A folder of the recent list (only listed folders; a vanished one leaves the list).
#[tauri::command]
async fn notebook_open_recent(
    path: String,
    folders: tauri::State<'_, FolderState>,
    session: tauri::State<'_, SessionState>,
) -> Res<OpenedFolder> {
    if session.get().recent_path(&path)?.is_none() {
        return Err(ShellError::NotRecent(path));
    }
    match folders.get().open_folder(Path::new(&path)) {
        Ok(opened) => {
            session.record(&opened);
            Ok(opened)
        }
        Err(e @ FolderError::NotANotebook(_)) => {
            session.get().remove_recent(&path)?;
            Err(e.into())
        }
        Err(e) => Err(e.into()),
    }
}

/// Records an open notebook in the recent list (after New / a restored backup / a join got its folder).
#[tauri::command]
async fn notebook_touch(
    notebook: String,
    name: String,
    folders: tauri::State<'_, FolderState>,
    session: tauri::State<'_, SessionState>,
) -> Res<Option<String>> {
    let path = folders
        .get()
        .path_of(&notebook)
        .map(|p| p.to_string_lossy().into_owned());
    if let Some(path) = &path {
        session.record(&OpenedFolder {
            id: notebook,
            name,
            path: path.clone(),
        });
    }
    Ok(path)
}

#[tauri::command]
async fn recent_list(session: tauri::State<'_, SessionState>) -> Res<Vec<RecentEntry>> {
    Ok(session.get().recent()?)
}

/// Shows a notebook's folder in the file manager is out of scope; the UI shows its path ([`notebook_touch`]).
#[tauri::command]
async fn notebook_path(
    notebook: String,
    folders: tauri::State<'_, FolderState>,
) -> Res<Option<String>> {
    Ok(folders
        .get()
        .path_of(&notebook)
        .map(|p| p.to_string_lossy().into_owned()))
}

// ---- files: backups and exports -----------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenArgs {
    dialog: Option<DialogText>,
    #[serde(default)]
    filters: Vec<FileFilter>,
}

/// A native open dialog → `json_len:u32` + `{"name":…}` + the file's bytes; an empty body when cancelled.
#[tauri::command]
async fn open_file(req: Request<'_>, window: tauri::Window) -> Res<Response> {
    let (a, _): (OpenArgs, _) = args(&req)?;
    let mut d = window.dialog().file().set_parent(&window);
    for f in &a.filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        d = d.add_filter(&f.name, &exts);
    }
    if let Some(t) = a.dialog.and_then(|d| d.title) {
        d = d.set_title(t);
    }
    let picked = blocking(move || {
        let Some(p) = d.blocking_pick_file() else {
            return Ok(None);
        };
        let path = into_path(p)?;
        let bytes = std::fs::read(&path)?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(Some((name, bytes)))
    })
    .await?;
    let Some((name, bytes)) = picked else {
        return Ok(Response::new(Vec::new()));
    };
    let mut out = Vec::new();
    push_record(
        &mut out,
        serde_json::json!({ "name": name }).to_string().as_bytes(),
    );
    out.extend_from_slice(&bytes);
    Ok(Response::new(out))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveArgs {
    suggested_name: String,
    dialog: Option<DialogText>,
}

/// A native save dialog for `name` → the saved file's name (`None`: cancelled).
#[tauri::command]
async fn save_file(req: Request<'_>, window: tauri::Window) -> Res<Option<String>> {
    let (a, bytes): (SaveArgs, _) = args(&req)?;
    let text = a.dialog.unwrap_or_default();
    let ext = Path::new(&a.suggested_name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .filter(|e| !e.is_empty());
    let mut d = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(&a.suggested_name);
    if let Some(ext) = &ext {
        d = d.add_filter(text.filter_name.as_deref().unwrap_or(ext), &[ext.as_str()]);
    }
    if let Some(t) = text.title {
        d = d.set_title(t);
    }
    blocking(move || {
        let Some(p) = d.blocking_save_file() else {
            return Ok(None);
        };
        let path = into_path(p)?;
        std::fs::write(&path, bytes)?;
        Ok(Some(
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        ))
    })
    .await
}

/// File › Print: the webview's native print dialog (also the desktop's PDF export: "Save as PDF" there).
#[tauri::command]
fn print_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

// ---- the sharing relay -------------------------------------------------------------------------------------

/// The relay the window was created with (its CSP allows exactly this origin).
#[tauri::command]
fn relay_get(dirs: tauri::State<'_, AppDirs>) -> relay::RelayInfo {
    dirs.relay.info()
}

/// Checks and stores a new relay → its addresses; it takes effect after [`restart`].
#[tauri::command]
async fn relay_set(
    url: String,
    allow_http: bool,
    dirs: tauri::State<'_, AppDirs>,
) -> Res<relay::RelayInfo> {
    Ok(RelayConfig::save(&dirs.data, &url, allow_http)?.info())
}

/// Restarts the app (a changed relay needs a new window policy).
#[tauri::command]
fn restart(app: tauri::AppHandle) {
    app.restart();
}

// ---- close: the UI flushes its writes first -------------------------------------------------------------------

/// Event sent to the UI when the window is about to close (it flushes pending writes, then calls `close_now`).
pub const CLOSE_REQUESTED_EVENT: &str = "rusuite://close-requested";

/// Set once the UI has flushed (or did not answer in time): the next close request goes through.
#[derive(Debug, Default)]
pub struct CloseGate(AtomicBool);

impl CloseGate {
    /// Decides a close request: `true` = hold it (the UI flushes first).
    pub fn hold(&self) -> bool {
        !self.0.load(Ordering::SeqCst)
    }

    pub fn open(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
fn close_now(window: tauri::Window, gate: tauri::State<'_, CloseGate>) -> Result<(), String> {
    gate.open();
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
async fn smoke_report(
    window: tauri::WebviewWindow,
    smoke: tauri::State<'_, smoke::Smoke>,
    report: smoke::Report,
) -> Result<(), ()> {
    smoke.finish(APP_NAME, &window.title().unwrap_or_default(), &report);
    Ok(())
}

// ---- the window ---------------------------------------------------------------------------------------------

/// The user's documents folder's `Rusuite Notes` (the home folder's when there is none).
fn default_root(app: &tauri::App) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(folders::DEFAULT_ROOT_NAME)
}

fn create_window(app: &tauri::App, csp: String) -> tauri::Result<()> {
    let url = tauri::WebviewUrl::App(PathBuf::from("index.html"));
    let csp_value = tauri::http::HeaderValue::from_str(&csp).ok();
    tauri::WebviewWindowBuilder::new(app, "main", url)
        .title(APP_NAME)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .on_web_resource_request(move |_req, resp| {
            if let Some(v) = &csp_value {
                resp.headers_mut()
                    .insert(tauri::http::header::CONTENT_SECURITY_POLICY, v.clone());
            }
        })
        .build()?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(smoke::Smoke::from_args())
        .manage(NotesState::default())
        .manage(CloseGate::default())
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && webview.label() == "main"
                && webview.state::<smoke::Smoke>().start()
            {
                smoke::watchdog();
                let _ = webview.eval(smoke::SCRIPT);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let gate = window.state::<CloseGate>();
                if gate.hold() {
                    api.prevent_close();
                    let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
                    // A UI that does not answer (hung, or still loading) never keeps the window open.
                    let w = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        w.state::<CloseGate>().open();
                        let _ = w.close();
                    });
                }
            }
        })
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("rusuite-notes"));
            let relay = RelayConfig::load(&dir);
            let csp = relay::csp(&relay.url);
            app.manage(ConnectorState::new(&dir));
            app.manage(FolderState(Mutex::new(Folders::load(
                &dir,
                &default_root(app),
            ))));
            app.manage(SessionState(Mutex::new(Session::new(DirStorage::new(
                &dir,
            )))));
            app.manage(AppDirs {
                data: dir,
                relay,
                keys_in_file: AtomicBool::new(false),
            });
            create_window(app, csp)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            smoke_report,
            notes_reset,
            dispatch,
            load_doc,
            import_updates,
            rebind_device,
            import_remote,
            export_updates,
            version_vector,
            take_persist_effects,
            page_genesis,
            export_backup,
            import_backup,
            apply_import,
            put_blob,
            blob_id,
            convert_import,
            convert_export,
            convert_paste_html,
            store_apply,
            store_load,
            store_blobs,
            store_get_blob,
            store_forget,
            store_clear,
            meta_get,
            meta_set,
            device_keys_get,
            device_keys_set,
            device_keys_info,
            notebook_pick_location,
            notebook_open_folder,
            notebook_open_recent,
            notebook_touch,
            notebook_path,
            recent_list,
            open_file,
            save_file,
            print_webview,
            relay_get,
            relay_set,
            restart,
            close_now,
            connectors_tauri::connector_secret_get,
            connectors_tauri::connector_secret_set,
            connectors_tauri::connector_secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rusuite Notes");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_reports_the_app_and_version() {
        assert_eq!(
            ping(),
            format!("Rusuite Notes {}", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn raw_bodies_split_into_args_and_payload() {
        let json = br#"{"notebook":"nb","doc":"d"}"#;
        let mut body = (json.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(json);
        body.extend_from_slice(&[1, 2, 3]);
        let raw = InvokeBody::Raw(body);
        let (a, payload): (NbDoc, &[u8]) = split_args(&raw).unwrap();
        assert_eq!(
            (a.notebook.as_str(), a.doc.as_str(), payload),
            ("nb", "d", &[1u8, 2, 3][..])
        );
        let js = InvokeBody::Json(serde_json::json!({"doc": "x"}));
        let (d, p): (Doc, &[u8]) = split_args(&js).unwrap();
        assert_eq!((d.doc.as_str(), p.len()), ("x", 0));
        for bad in [vec![], vec![9, 0, 0, 0, b'{'], vec![2, 0, 0, 0, b'n', b'o']] {
            assert!(split_args::<NoArgs>(&InvokeBody::Raw(bad)).is_err());
        }
        let mut pair = Vec::new();
        push_record(&mut pair, b"snap");
        pair.extend_from_slice(b"log");
        assert_eq!(split_pair(&pair).unwrap(), (&b"snap"[..], &b"log"[..]));
    }

    #[test]
    fn hex_round_trip() {
        let b = [0u8, 1, 0xab, 0xff];
        assert_eq!(to_hex(&b), "0001abff");
        assert_eq!(from_hex("0001abff").unwrap(), b);
        assert!(from_hex("abc").is_none());
        assert!(from_hex("zz").is_none());
    }

    #[test]
    fn close_gate_holds_until_opened() {
        let g = CloseGate::default();
        assert!(g.hold());
        g.open();
        assert!(!g.hold());
    }

    #[test]
    fn the_native_core_answers_like_the_wasm_module() {
        let state = NotesState::default();
        let reply =
            notes_core::dispatch_with(&mut state.host(), r#"{"type":"createNotebook","name":"N"}"#);
        assert!(reply.starts_with("{\"ok\""), "{reply}");
        assert_eq!(state.host().list_notebooks().len(), 1);
        let err = binary::put_blob(&mut state.host(), "missing", b"x").unwrap_err();
        assert!(
            serde_json::from_str::<serde_json::Value>(&err).unwrap()["err"]["code"].is_string()
        );
    }
}
