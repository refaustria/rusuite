//! Mobile document commands (P10-M1, ADR 0005 amendment): the system document pickers instead of the native file
//! dialogs, through `tauri-plugin-rusuite-mobile`. A document is bound to an opaque handle (Android content URI,
//! iOS bookmark) kept in [`DocPath`] like a desktop path, so `observe` keeps working unchanged: Open binds the
//! picked document once the core opened it, Save writes back to it, an untitled document (or Save As) is exported
//! through the system "save to" picker and bound to the new document. The commands exist on the desktop too (and
//! fail there with "not supported"); `ui-shared`'s `TauriBackend` calls them only when `isMobile()`.

use std::path::PathBuf;

use tauri_plugin_rusuite_mobile::{DocumentTypes, PickedDocument, RusuiteMobileExt};

use crate::{blocking, DocPath, FileError, OpenedFile, SavedFile, SessionState};

/// The presentation type: `.pptx`.
pub fn document_types() -> DocumentTypes {
    DocumentTypes::new(
        &["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
        &["org.openxmlformats.presentationml.presentation"],
    )
}

fn opened(doc: PickedDocument) -> OpenedFile {
    OpenedFile {
        path: doc.handle,
        name: doc.name,
        bytes_base64: doc.bytes_base64,
    }
}

/// A document read for opening: recent list (a convenience, never fails the open) and the binding once the core
/// opened it.
fn reading(file: &OpenedFile, session: &SessionState, doc_path: &DocPath) {
    let _ = session.record_named(&file.path, &file.name);
    doc_path.opening(PathBuf::from(&file.path));
}

/// File › Open: the system document picker → the picked document; `None` when cancelled.
#[tauri::command]
pub async fn open_document(
    app: tauri::AppHandle,
    session: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
) -> Result<Option<OpenedFile>, FileError> {
    let picked = blocking(move || Ok(app.rusuite_mobile().pick_document(&document_types())?))
        .await?
        .map(opened);
    if let Some(file) = &picked {
        reading(file, &session, &doc_path);
    }
    Ok(picked)
}

/// Save / Save As: a plain Save of a bound document writes back to it; an untitled document, Save As, or a
/// document that cannot be written (a read-only "Open with" grant, a revoked permission) goes through the system
/// "save to" picker, and the document is bound to the new one when the platform lets the app write there again.
/// The written document (`path` = its handle, empty when unbound), or `None` when cancelled.
#[tauri::command]
pub async fn save_document(
    app: tauri::AppHandle,
    session: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
    suggested_name: String,
    bytes_base64: String,
    save_as: bool,
) -> Result<Option<SavedFile>, FileError> {
    let target = doc_path
        .save_target(save_as)
        .map(|p| p.to_string_lossy().into_owned());
    let saved = blocking(move || {
        let mobile = app.rusuite_mobile();
        if let Some(handle) = target {
            if let Ok(name) = mobile.write_document(&handle, &bytes_base64) {
                return Ok(Some((Some(handle), name)));
            }
        }
        Ok(mobile
            .export_document(&suggested_name, &document_types(), &bytes_base64)?
            .map(|e| (e.handle, e.name)))
    })
    .await?;
    let Some((handle, name)) = saved else {
        return Ok(None);
    };
    doc_path.set(handle.as_ref().map(PathBuf::from));
    if let Some(handle) = &handle {
        let _ = session.record_named(handle, &name);
    }
    Ok(Some(SavedFile {
        path: handle.unwrap_or_default(),
        name,
    }))
}

/// Save a copy: the system "save to" picker without binding the document; the chosen name, `None` when cancelled.
#[tauri::command]
pub async fn export_document(
    app: tauri::AppHandle,
    suggested_name: String,
    bytes_base64: String,
) -> Result<Option<String>, FileError> {
    blocking(move || {
        Ok(app
            .rusuite_mobile()
            .export_document(&suggested_name, &document_types(), &bytes_base64)?
            .map(|e| e.name))
    })
    .await
}

/// Share: the system share sheet with a copy of the document.
#[tauri::command]
pub async fn share_document(
    app: tauri::AppHandle,
    suggested_name: String,
    bytes_base64: String,
) -> Result<(), FileError> {
    blocking(move || {
        Ok(app.rusuite_mobile().share_document(
            &suggested_name,
            &document_types(),
            &bytes_base64,
        )?)
    })
    .await
}

/// The document the app was opened with ("Open with", a tap in Files), once; `None` when there is none. The page
/// asks on start and whenever it becomes visible again.
#[tauri::command]
pub async fn take_launch_document(
    app: tauri::AppHandle,
    session: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
) -> Result<Option<OpenedFile>, FileError> {
    let file = blocking(move || Ok(app.rusuite_mobile().take_launch_document()?))
        .await?
        .map(opened);
    if let Some(file) = &file {
        reading(file, &session, &doc_path);
    }
    Ok(file)
}

/// Re-opens a document of the recent list by its handle (mobile `recent_open`); one that cannot be read any more
/// (deleted, permission revoked) is dropped from the list.
// Mobile only: the desktop `recent_open` has the same command name.
#[cfg(mobile)]
#[tauri::command]
pub async fn recent_open(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<'_, SessionState>,
    doc_path: tauri::State<'_, DocPath>,
) -> Result<OpenedFile, FileError> {
    if state.session().recent_path(&path)?.is_none() {
        return Err(FileError::NotRecent(path));
    }
    let handle = path.clone();
    match blocking(move || Ok(app.rusuite_mobile().read_document(&handle)?)).await {
        Ok(doc) => {
            let file = opened(doc);
            reading(&file, &state, &doc_path);
            Ok(file)
        }
        Err(e) => {
            let _ = state.session().remove_recent(&path);
            Err(e)
        }
    }
}

/// Design › Save Current Theme (P9-S5) on mobile: the system "save to" picker for a file that is not the document
/// (no binding, not recent); the chosen name, `None` when cancelled.
// Mobile only: the desktop `export_file` has the same command name.
#[cfg(mobile)]
#[tauri::command]
pub async fn export_file(
    app: tauri::AppHandle,
    suggested_name: String,
    bytes_base64: String,
    filter_name: String,
    extension: String,
) -> Result<Option<String>, FileError> {
    let _ = (filter_name, extension);
    let types = DocumentTypes::new(&["application/octet-stream"], &["public.data"]);
    blocking(move || {
        Ok(app
            .rusuite_mobile()
            .export_document(&suggested_name, &types, &bytes_base64)?
            .map(|e| e.name))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_types_save_the_app_format_first() {
        let t = document_types();
        assert_eq!(
            t.mime_types[0],
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
        assert_eq!(t.utis[0], "org.openxmlformats.presentationml.presentation");
    }

    #[test]
    fn mobile_commands_report_unsupported_on_the_desktop() {
        let e = FileError::from(tauri_plugin_rusuite_mobile::Error::Unsupported);
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            "\"not supported on this platform\""
        );
    }
}
