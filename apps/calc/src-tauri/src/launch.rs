//! Documents from the OS (P11-D1, desktop only): a Finder / Explorer double-click or "Open with" (macOS:
//! `RunEvent::Opened`; Windows / Linux: the command line, and a second launch's command line forwarded by
//! `tauri-plugin-single-instance`), and files dropped onto the window (macOS: also onto the Dock icon, which is
//! `Opened` again). [`offer`] queues the paths ([`app_common::launch::LaunchQueue`]) and tells the page
//! ([`OPEN_DOCUMENT_EVENT`]); the page asks the unsaved-changes question, then takes them
//! ([`take_launch_documents`]), which reads the first openable one exactly like the open dialog does: recent list,
//! and the document is bound to the file once the core opened it. The page never names a path here.
//! This file is identical in the three document shells; the app's types are [`crate::OPEN_EXTENSIONS`].

use std::path::{Path, PathBuf};

use app_common::launch::{self, LaunchQueue};
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::{blocking, file_name, read_file, DocPath, FileError, OpenedFile, SessionState};

/// Sent to the page when documents wait (`ui-shared`'s `OPEN_DOCUMENT_EVENT`).
pub const OPEN_DOCUMENT_EVENT: &str = "rusuite://open-document";

/// The documents the OS delivered that the page has not taken yet.
#[derive(Debug, Default)]
pub struct Launch(pub LaunchQueue);

/// Queues `paths` and tells the page (and brings the window to the front). Before the page has loaded nobody
/// listens: the page takes the queue when it starts.
pub fn offer(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    // Managed in `setup`; an event that came earlier still finds the queue.
    app.manage(Launch::default());
    if !app.state::<Launch>().0.push(paths) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit(OPEN_DOCUMENT_EVENT, ());
    }
}

/// The documents of this process's command line (Windows / Linux "Open with", a terminal).
pub fn offer_args(app: &tauri::AppHandle) {
    let cwd = std::env::current_dir().unwrap_or_default();
    offer(app, launch::paths_from_args(std::env::args(), &cwd));
}

/// The `file://` URLs of a macOS `RunEvent::Opened` as paths (other URLs are not documents).
pub fn url_paths(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .collect()
}

/// Windows / Linux: a second start (Explorer / the file manager opening another document) hands its command line
/// to the running instance and exits. Not in `--smoke` mode: a smoke run must never end up in a running app.
pub fn single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    if std::env::args().any(|a| a == crate::smoke::FLAG) {
        return builder;
    }
    builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let paths = launch::paths_from_args(argv, Path::new(&cwd));
        if paths.is_empty() {
            // Started again without a document: show the running window.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        offer(app, paths);
    }))
}

/// What [`take_launch_documents`] hands the page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDocuments {
    /// The document to open.
    pub file: Option<OpenedFile>,
    /// Names of further documents (one per window); they are on the recent list.
    pub not_opened: Vec<String>,
    /// Names of files of types this app does not open.
    pub unsupported: Vec<String>,
}

/// Whether an openable document waits (the page then asks about unsaved changes and takes it).
#[tauri::command]
pub fn launch_pending(launch: tauri::State<'_, Launch>) -> bool {
    launch.0.has_openable(crate::OPEN_EXTENSIONS)
}

/// Takes the waiting documents: with `open` the first openable one is read (as the open dialog does: recent list,
/// bound once the core opened it), further ones go on the recent list; without `open` (the user kept the open
/// document) they are dropped. Unsupported files are always named.
#[tauri::command]
pub async fn take_launch_documents(
    open: bool,
    launch: tauri::State<'_, Launch>,
    session: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
) -> Result<LaunchDocuments, FileError> {
    take(&launch, &session, &doc_path, open).await
}

async fn take(
    launch: &Launch,
    session: &SessionState,
    doc_path: &DocPath,
    open: bool,
) -> Result<LaunchDocuments, FileError> {
    let taken = launch.0.take(crate::OPEN_EXTENSIONS, open);
    // The recent list is a convenience: failing to update it never fails the open.
    for p in &taken.not_opened {
        let _ = session.record(&p.to_string_lossy());
    }
    let file = match taken.open {
        Some(path) => {
            let file = blocking(move || read_file(&path)).await?;
            let _ = session.record(&file.path);
            doc_path.opening(PathBuf::from(&file.path));
            Some(file)
        }
        None => None,
    };
    let names = |paths: &[PathBuf]| paths.iter().map(|p| file_name(p)).collect();
    Ok(LaunchDocuments {
        file,
        not_opened: names(&taken.not_opened),
        unsupported: names(&taken.unsupported),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opened_urls_become_paths() {
        let urls = [
            tauri::Url::parse("file:///Users/u/My%20Book.xlsx").unwrap(),
            tauri::Url::parse("https://example.com/a.xlsx").unwrap(),
        ];
        assert_eq!(
            url_paths(&urls),
            vec![PathBuf::from("/Users/u/My Book.xlsx")]
        );
    }

    #[test]
    fn taking_reads_the_first_document_and_records_all() {
        let dir = std::env::temp_dir().join(format!("rusuite-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ext = crate::OPEN_EXTENSIONS[0];
        let first = dir.join(format!("first.{ext}"));
        let second = dir.join(format!("second.{ext}"));
        std::fs::write(&first, b"PK").unwrap();
        std::fs::write(&second, b"PK").unwrap();
        let launch = Launch::default();
        let session = SessionState::new(dir.join("data"));
        let doc_path = DocPath::default();
        launch
            .0
            .push([dir.join("picture.bmp"), first.clone(), second.clone()]);
        assert!(launch.0.has_openable(crate::OPEN_EXTENSIONS));
        let run = |open| {
            tauri::async_runtime::block_on(take(&launch, &session, &doc_path, open)).unwrap()
        };
        let docs = run(true);
        let file = docs.file.unwrap();
        assert_eq!(file.path, first.to_string_lossy());
        assert_eq!(file.bytes_base64, "UEs=");
        assert_eq!(docs.not_opened, vec![format!("second.{ext}")]);
        assert_eq!(docs.unsupported, vec!["picture.bmp".to_owned()]);
        // Both documents are on the recent list, the opened one on top.
        let recent = session.session().recent().unwrap();
        let paths: Vec<_> = recent.iter().filter_map(|r| r.path.clone()).collect();
        assert_eq!(
            paths,
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned()
            ]
        );
        // Declined: nothing is read or recorded; a missing file fails the take.
        launch.0.push([dir.join(format!("third.{ext}"))]);
        assert_eq!(run(false).file, None);
        launch.0.push([dir.join(format!("missing.{ext}"))]);
        let missing = tauri::async_runtime::block_on(take(&launch, &session, &doc_path, true));
        assert!(matches!(missing, Err(FileError::Io(_))));
        assert_eq!(session.session().recent().unwrap().len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
