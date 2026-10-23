//! PDF commands (P10-M6): File › Export PDF…, the mobile Print… and Share as PDF. The page mounts its print root
//! (`ui-shared`'s `exportPdfDocument`) and calls one of these; the webview's own PDF renderer does the rest
//! (`tauri-plugin-rusuite-mobile`'s `pdf` module). Mobile: the system "save to" picker, print service or share
//! sheet. Desktop: the native save dialog for the PDF's path first, then WebKitGTK's print-to-file on Linux;
//! macOS and Windows have no dialog-free path here (`DESKTOP_PDF` false: the page keeps the print dialog). This
//! file is identical in the three shells.

use tauri_plugin_rusuite_mobile::{pdf_file_name, Paper};

use crate::{blocking, DialogText, FileError};

/// Export PDF…: the PDF of the page's print root on `paper`, written where the user picks; the chosen file name,
/// `None` when cancelled.
#[tauri::command]
pub async fn export_pdf(
    window: tauri::WebviewWindow,
    suggested_name: String,
    paper: Paper,
    dialog: Option<DialogText>,
) -> Result<Option<String>, FileError> {
    let name = pdf_file_name(&suggested_name);
    #[cfg(mobile)]
    {
        use tauri::Manager as _;
        use tauri_plugin_rusuite_mobile::RusuiteMobileExt as _;
        let _ = dialog;
        let app = window.app_handle().clone();
        blocking(move || Ok(app.rusuite_mobile().export_pdf(&name, paper)?)).await
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt as _;
        if !tauri_plugin_rusuite_mobile::DESKTOP_PDF {
            return Err(tauri_plugin_rusuite_mobile::Error::Unsupported.into());
        }
        let text = dialog.unwrap_or_default();
        let mut picker = window
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("PDF", &["pdf"])
            .set_file_name(name);
        if let Some(title) = text.title {
            picker = picker.set_title(title);
        }
        let Some(path) = blocking(move || Ok(picker.blocking_save_file())).await? else {
            return Ok(None);
        };
        let path = crate::into_path(path)?;
        blocking(move || {
            tauri_plugin_rusuite_mobile::print_to_pdf(&window, &path, paper)?;
            Ok(Some(crate::file_name(&path)))
        })
        .await
    }
}

/// Mobile Print…: the same PDF handed to the system print service (printers and "Save as PDF" are chosen there).
#[tauri::command]
pub async fn print_pdf(
    app: tauri::AppHandle,
    suggested_name: String,
    paper: Paper,
) -> Result<(), FileError> {
    use tauri_plugin_rusuite_mobile::RusuiteMobileExt as _;
    blocking(move || Ok(app.rusuite_mobile().print_pdf(&suggested_name, paper)?)).await
}

/// Mobile Share as PDF: the same PDF handed to the system share sheet.
#[tauri::command]
pub async fn share_pdf(
    app: tauri::AppHandle,
    suggested_name: String,
    paper: Paper,
) -> Result<(), FileError> {
    use tauri_plugin_rusuite_mobile::RusuiteMobileExt as _;
    blocking(move || Ok(app.rusuite_mobile().share_pdf(&suggested_name, paper)?)).await
}

/// `--smoke` with `RUSUITE_SMOKE_PDF=<path>` (Linux desktop): prints the loaded page to that PDF without a dialog
/// (A4) before the report, so the smoke check covers [`tauri_plugin_rusuite_mobile::print_to_pdf`].
pub async fn smoke_pdf(window: tauri::WebviewWindow) -> Result<(), String> {
    let Some(path) = std::env::var_os("RUSUITE_SMOKE_PDF") else {
        return Ok(());
    };
    let paper = Paper {
        width_mm: 210.0,
        height_mm: 297.0,
        landscape: false,
    };
    let path = std::path::PathBuf::from(path);
    blocking(move || {
        Ok(tauri_plugin_rusuite_mobile::print_to_pdf(
            &window, &path, paper,
        )?)
    })
    .await
    .map_err(|e| format!("PDF: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_arrives_in_the_page_names() {
        let p: Paper =
            serde_json::from_str(r#"{"widthMm":210,"heightMm":297,"landscape":false}"#).unwrap();
        assert_eq!(p.width_mm, 210.0);
        assert_eq!(pdf_file_name("Book1"), "Book1.pdf");
    }
}
