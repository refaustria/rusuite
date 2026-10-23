// `tauri::ios_plugin_binding!` declares the Swift entry point as an `extern "C"` function, which the `unsafe_code`
// lint counts; it is the only exception and exists on iOS only.
#![cfg_attr(not(target_os = "ios"), forbid(unsafe_code))]
//! Rusuite's mobile document access (P10-M1, ADR 0005 amendment): the shells' `open_document`, `save_document`,
//! `export_document`, `share_document` and `take_launch_document` commands call this API, which runs the Kotlin
//! (`android/`) and Swift (`ios/`) halves:
//!
//! - **pick**: Android `ACTION_OPEN_DOCUMENT` (persistable read/write grant), iOS
//!   `UIDocumentPickerViewController(forOpeningContentTypes:asCopy: false)` (open in place);
//! - **write back** to the picked document: Android `ContentResolver.openOutputStream(uri, "wt")`, iOS a
//!   coordinated write to the security-scoped URL behind a bookmark;
//! - **export** (Save As / untitled): Android `ACTION_CREATE_DOCUMENT` (the share sheet when no document provider
//!   exists), iOS `UIDocumentPickerViewController(forExporting:asCopy: true)` from a temporary copy;
//! - **share**: Android `ACTION_SEND` through the app's `FileProvider`, iOS `UIActivityViewController`;
//! - **Open with**: Android `ACTION_VIEW`/`ACTION_EDIT` intents (cold start and `onNewIntent`), iOS
//!   `RunEvent::Opened` (`scene:openURLContexts:`), kept until the page asks for them.
//!
//! A document is addressed by an opaque **handle**: the content URI on Android, `bm:<base64 bookmark>` (or a
//! `file://` URL when no bookmark can be made) on iOS. Desktop builds compile everything, and every call returns
//! [`Error::Unsupported`].

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod error;
pub use error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_rusuite_mobile);

/// `"android"` / `"ios"` in mobile builds, `None` on the desktop.
pub const MOBILE_OS: Option<&str> = if cfg!(target_os = "android") {
    Some("android")
} else if cfg!(target_os = "ios") {
    Some("ios")
} else {
    None
};

/// The page-side marker of a mobile shell (`ui-shared`'s `isMobile()` reads `window.__RUSUITE_MOBILE__`).
pub fn init_script(os: &str) -> String {
    format!(
        "Object.defineProperty(window, \"__RUSUITE_MOBILE__\", {{ value: {}, configurable: false }});",
        serde_json::Value::String(os.to_owned())
    )
}

/// The file types an app opens and saves: MIME types (Android pickers and intents, first = the saved type) and
/// uniform type identifiers (iOS pickers, first = the saved type).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTypes {
    pub mime_types: Vec<String>,
    pub utis: Vec<String>,
}

impl DocumentTypes {
    /// `mime_types` / `utis` from string slices.
    pub fn new(mime_types: &[&str], utis: &[&str]) -> Self {
        DocumentTypes {
            mime_types: mime_types.iter().map(|s| (*s).to_owned()).collect(),
            utis: utis.iter().map(|s| (*s).to_owned()).collect(),
        }
    }
}

/// A document read through the platform: its handle (for writing back), display name and contents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedDocument {
    pub handle: String,
    pub name: String,
    /// Standard base64.
    pub bytes_base64: String,
}

/// Where an export went: the chosen name and, when the platform lets the app write there again, its handle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedDocument {
    #[serde(default)]
    pub handle: Option<String>,
    pub name: String,
}

/// `{ document?: T }`: a missing document = cancelled / nothing pending.
#[derive(Debug, Deserialize)]
struct Reply<T> {
    #[serde(default = "Option::default")]
    document: Option<T>,
}

#[derive(Debug, Deserialize)]
struct Written {
    name: String,
}

#[derive(Debug, Deserialize)]
struct Nothing {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HandleArgs<'a> {
    handle: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteArgs<'a> {
    handle: &'a str,
    bytes_base64: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportArgs<'a> {
    name: &'a str,
    mime_type: &'a str,
    uti: &'a str,
    bytes_base64: &'a str,
}

/// The launch documents among the URLs the system handed the app: `file://` URLs only (deep links are not ours).
pub fn launch_documents<'a>(urls: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    urls.into_iter()
        .filter(|u| u.starts_with("file://"))
        .map(str::to_owned)
        .collect()
}

/// The plugin's state (`app.rusuite_mobile()`).
pub struct RusuiteMobile<R: Runtime> {
    #[cfg(mobile)]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(mobile))]
    _runtime: std::marker::PhantomData<fn() -> R>,
    /// iOS: documents opened with the app (`RunEvent::Opened`) the page has not taken yet.
    opened: std::sync::Mutex<Vec<String>>,
}

impl<R: Runtime> RusuiteMobile<R> {
    /// Runs a Kotlin/Swift method (blocking: call it off the main thread, e.g. in `spawn_blocking`).
    #[cfg(mobile)]
    fn run<T: DeserializeOwned>(&self, method: &str, payload: impl Serialize) -> Result<T> {
        Ok(self.handle.run_mobile_plugin(method, payload)?)
    }

    #[cfg(not(mobile))]
    fn run<T: DeserializeOwned>(&self, _method: &str, _payload: impl Serialize) -> Result<T> {
        Err(Error::Unsupported)
    }

    /// The system document picker for `types`; `None` when cancelled.
    pub fn pick_document(&self, types: &DocumentTypes) -> Result<Option<PickedDocument>> {
        Ok(self
            .run::<Reply<PickedDocument>>("pickDocument", types)?
            .document)
    }

    /// Reads a document again by its handle (recent files, launch documents).
    pub fn read_document(&self, handle: &str) -> Result<PickedDocument> {
        self.run::<Reply<PickedDocument>>("readDocument", HandleArgs { handle })?
            .document
            .ok_or_else(|| Error::Native(format!("cannot read {handle}")))
    }

    /// Replaces the document behind `handle` with `bytes_base64`; its display name.
    pub fn write_document(&self, handle: &str, bytes_base64: &str) -> Result<String> {
        Ok(self
            .run::<Written>(
                "writeDocument",
                WriteArgs {
                    handle,
                    bytes_base64,
                },
            )?
            .name)
    }

    /// Lets the user pick where a new document `name` goes (the system "save to" picker) and writes it there;
    /// `None` when cancelled.
    pub fn export_document(
        &self,
        name: &str,
        types: &DocumentTypes,
        bytes_base64: &str,
    ) -> Result<Option<ExportedDocument>> {
        let args = ExportArgs {
            name,
            mime_type: types
                .mime_types
                .first()
                .map_or("application/octet-stream", String::as_str),
            uti: types.utis.first().map_or("public.data", String::as_str),
            bytes_base64,
        };
        Ok(self
            .run::<Reply<ExportedDocument>>("exportDocument", args)?
            .document)
    }

    /// Hands a copy of `name` to the system share sheet.
    pub fn share_document(
        &self,
        name: &str,
        types: &DocumentTypes,
        bytes_base64: &str,
    ) -> Result<()> {
        let args = ExportArgs {
            name,
            mime_type: types
                .mime_types
                .first()
                .map_or("application/octet-stream", String::as_str),
            uti: types.utis.first().map_or("public.data", String::as_str),
            bytes_base64,
        };
        self.run::<Nothing>("shareDocument", args).map(|_| ())
    }

    /// The document the app was opened with ("Open with", a tap in Files), once; `None` when there is none.
    pub fn take_launch_document(&self) -> Result<Option<PickedDocument>> {
        if cfg!(target_os = "ios") {
            let next = {
                let mut opened = self.opened.lock().unwrap_or_else(|e| e.into_inner());
                (!opened.is_empty()).then(|| opened.remove(0))
            };
            return next.map(|url| self.read_document(&url)).transpose();
        }
        Ok(self
            .run::<Reply<PickedDocument>>("takeLaunchDocument", ())?
            .document)
    }

    /// Remembers documents the system opened the app with (iOS `RunEvent::Opened`).
    pub fn opened(&self, urls: Vec<String>) {
        let mut opened = self.opened.lock().unwrap_or_else(|e| e.into_inner());
        opened.extend(urls);
    }
}

/// `app.rusuite_mobile()` on an `App`, `AppHandle` or window.
pub trait RusuiteMobileExt<R: Runtime> {
    fn rusuite_mobile(&self) -> &RusuiteMobile<R>;
}

impl<R: Runtime, T: Manager<R>> RusuiteMobileExt<R> for T {
    fn rusuite_mobile(&self) -> &RusuiteMobile<R> {
        self.state::<RusuiteMobile<R>>().inner()
    }
}

/// The plugin: registers the Kotlin/Swift classes on mobile, marks the page (`window.__RUSUITE_MOBILE__`) and
/// keeps the documents iOS opens the app with.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let mut builder = Builder::<R>::new("rusuite-mobile");
    if let Some(os) = MOBILE_OS {
        builder = builder.js_init_script(init_script(os));
    }
    builder
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle =
                api.register_android_plugin("dev.rusuite.mobile", "RusuiteMobilePlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_rusuite_mobile)?;
            #[cfg(not(mobile))]
            let _ = api;
            app.manage(RusuiteMobile::<R> {
                #[cfg(mobile)]
                handle,
                #[cfg(not(mobile))]
                _runtime: std::marker::PhantomData,
                opened: std::sync::Mutex::new(Vec::new()),
            });
            Ok(())
        })
        .on_event(|_app, _event| {
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let urls = launch_documents(urls.iter().map(|u| u.as_str()));
                _app.rusuite_mobile().opened(urls);
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_without_a_document_mean_cancelled() {
        let r: Reply<PickedDocument> = serde_json::from_str("{}").unwrap();
        assert!(r.document.is_none());
        let r: Reply<PickedDocument> = serde_json::from_str(
            r#"{"document":{"handle":"content://x/1","name":"a.xlsx","bytesBase64":"UEsDBA=="}}"#,
        )
        .unwrap();
        assert_eq!(r.document.unwrap().name, "a.xlsx");
        // An export iOS cannot write to again has no handle.
        let r: Reply<ExportedDocument> =
            serde_json::from_str(r#"{"document":{"name":"b.docx"}}"#).unwrap();
        assert_eq!(
            r.document,
            Some(ExportedDocument {
                handle: None,
                name: "b.docx".into()
            })
        );
    }

    #[test]
    fn document_types_and_args_use_the_bridge_names() {
        let t = DocumentTypes::new(&["application/x"], &["org.x"]);
        assert_eq!(
            serde_json::to_value(&t).unwrap(),
            serde_json::json!({"mimeTypes": ["application/x"], "utis": ["org.x"]})
        );
        let a = ExportArgs {
            name: "a",
            mime_type: "m",
            uti: "u",
            bytes_base64: "b",
        };
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::json!({"name": "a", "mimeType": "m", "uti": "u", "bytesBase64": "b"})
        );
    }

    #[test]
    fn only_file_urls_are_launch_documents() {
        assert_eq!(
            launch_documents([
                "file:///private/var/a.xlsx",
                "rusuite://x",
                "https://e.com/a.xlsx"
            ]),
            vec!["file:///private/var/a.xlsx".to_owned()]
        );
    }

    #[test]
    fn the_init_script_marks_the_page() {
        assert_eq!(
            init_script("ios"),
            "Object.defineProperty(window, \"__RUSUITE_MOBILE__\", { value: \"ios\", configurable: false });"
        );
        assert_eq!(MOBILE_OS, None);
    }
}
