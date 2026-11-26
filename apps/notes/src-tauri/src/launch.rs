//! Files from the OS (P11-D1): a Finder / Explorer double-click or "Open with" on a `.rnotes` backup or a OneNote
//! file (macOS: `RunEvent::Opened`; Windows / Linux: the command line, and a second start's command line forwarded
//! by `tauri-plugin-single-instance`), and files dropped onto the window (macOS: also onto the Dock icon). [`offer`]
//! queues the paths ([`app_common::launch::LaunchQueue`]) and tells the page ([`OPEN_DOCUMENT_EVENT`]); the page
//! takes them ([`take_launch_files`]): backups open as notebooks, the other files go through File › Import. Notes
//! adds instead of replacing, so there is no unsaved-changes question. The page never names a path here.

use std::path::{Path, PathBuf};

use app_common::launch::{self, LaunchQueue};
use tauri::ipc::Response;
use tauri::{Emitter, Manager};

use crate::{blocking, push_record, Res};

/// What Notes takes from the OS: backups (`.rnotes`) and what File › Import reads (`convert/formats.ts`).
pub const OPEN_EXTENSIONS: &[&str] = &[
    "rnotes", "one", "onepkg", "md", "markdown", "html", "htm", "docx",
];

/// Sent to the page when files wait (`apps/notes/src/tauri/backend.ts`).
pub const OPEN_DOCUMENT_EVENT: &str = "rusuite://open-document";

/// The files the OS delivered that the page has not taken yet.
#[derive(Debug, Default)]
pub struct Launch(pub LaunchQueue);

/// Queues `paths`, brings the window to the front and tells the page (before it has loaded nobody listens: the
/// page takes the queue when it starts).
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

/// The files of this process's command line.
pub fn offer_args(app: &tauri::AppHandle) {
    let cwd = std::env::current_dir().unwrap_or_default();
    offer(app, launch::paths_from_args(std::env::args(), &cwd));
}

/// The `file://` URLs of a macOS `RunEvent::Opened` as paths.
pub fn url_paths(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .collect()
}

/// Windows / Linux: a second start hands its command line to the running instance and exits (not with `--smoke`).
pub fn single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    if std::env::args().any(|a| a == crate::smoke::FLAG) {
        return builder;
    }
    builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let paths = launch::paths_from_args(argv, Path::new(&cwd));
        if paths.is_empty() {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        offer(app, paths);
    }))
}

/// Takes the waiting files → records: `{"files":[name…],"unsupported":[name…],"failed":[message…]}`, then each
/// file's bytes in the order of `files`.
#[tauri::command]
pub async fn take_launch_files(launch: tauri::State<'_, Launch>) -> Res<Response> {
    let taken = launch.0.take(OPEN_EXTENSIONS, true);
    let paths: Vec<PathBuf> = taken.open.into_iter().chain(taken.not_opened).collect();
    let unsupported = taken.unsupported;
    blocking(move || Ok(Response::new(read_all(&paths, &unsupported)))).await
}

fn name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn read_all(paths: &[PathBuf], unsupported: &[PathBuf]) -> Vec<u8> {
    let mut names = Vec::new();
    let mut bytes = Vec::new();
    let mut failed = Vec::new();
    for p in paths {
        match std::fs::read(p) {
            Ok(b) => {
                names.push(name(p));
                bytes.push(b);
            }
            Err(e) => failed.push(format!("{}: {e}", name(p))),
        }
    }
    let head = serde_json::json!({
        "files": names,
        "unsupported": unsupported.iter().map(|p| name(p)).collect::<Vec<_>>(),
        "failed": failed,
    });
    let mut out = Vec::new();
    push_record(&mut out, head.to_string().as_bytes());
    for b in &bytes {
        push_record(&mut out, b);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(mut b: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        while !b.is_empty() {
            let len = u32::from_le_bytes(b[..4].try_into().unwrap()) as usize;
            out.push(b[4..4 + len].to_vec());
            b = &b[4 + len..];
        }
        out
    }

    #[test]
    fn taken_files_are_framed_with_their_names() {
        let dir = std::env::temp_dir().join(format!("rusuite-notes-launch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.rnotes"), b"PK").unwrap();
        std::fs::write(dir.join("b.one"), b"ONE").unwrap();
        let out = read_all(
            &[
                dir.join("a.rnotes"),
                dir.join("missing.md"),
                dir.join("b.one"),
            ],
            &[dir.join("x.bmp")],
        );
        let r = records(&out);
        let head: serde_json::Value = serde_json::from_slice(&r[0]).unwrap();
        assert_eq!(head["files"], serde_json::json!(["a.rnotes", "b.one"]));
        assert_eq!(head["unsupported"], serde_json::json!(["x.bmp"]));
        assert!(head["failed"][0]
            .as_str()
            .unwrap()
            .starts_with("missing.md: "));
        assert_eq!(&r[1..], &[b"PK".to_vec(), b"ONE".to_vec()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn associations_are_the_same_everywhere_and_openable() {
        let configs = [
            include_str!("../tauri.macos.conf.json"),
            include_str!("../tauri.linux.conf.json"),
            include_str!("../tauri.windows.conf.json"),
        ];
        assert!(configs.iter().all(|c| *c == configs[0]));
        let config: serde_json::Value = serde_json::from_str(configs[0]).unwrap();
        for a in config["bundle"]["fileAssociations"].as_array().unwrap() {
            assert_eq!(a["rank"], "Alternate");
            for ext in a["ext"].as_array().unwrap() {
                assert!(OPEN_EXTENSIONS.contains(&ext.as_str().unwrap()), "{ext}");
            }
        }
        let urls = [tauri::Url::parse("file:///Users/u/My%20Notes.rnotes").unwrap()];
        assert_eq!(
            url_paths(&urls),
            vec![PathBuf::from("/Users/u/My Notes.rnotes")]
        );
    }
}
