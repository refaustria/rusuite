//! PDF export through the webview's own PDF renderer (P10-M6): the page mounts its print root
//! (`#rusuite-print-root`, one fixed-size page per sheet) and the platform prints the webview to a file:
//!
//! - **Android**: `WebView.createPrintDocumentAdapter()` driven by hand (`onStart`, `onLayout` with the
//!   [`Paper`], `onWrite` of all pages into a file in `cacheDir`, `onFinish`), then `ACTION_CREATE_DOCUMENT`
//!   (export), `ACTION_SEND` (share) or `PrintManager.print` with an adapter over that file (print);
//! - **iOS**: `UIPrintPageRenderer` with the webview's `viewPrintFormatter()` on the paper's rect, drawn into a
//!   PDF context, then `UIDocumentPickerViewController(forExporting:)`, `UIActivityViewController` or
//!   `UIPrintInteractionController` (`printingItem` = the PDF data);
//! - **Linux desktop**: WebKitGTK's `PrintOperation::print()` (no dialog) with the "Print to File" printer,
//!   `output-file-format=pdf` and `output-uri` ([`print_to_pdf`]);
//! - macOS (`WKWebView`) and Windows (WebView2 `PrintToPdf`) are reachable only through raw pointers / COM calls,
//!   i.e. `unsafe` code, which the shells forbid: there [`DESKTOP_PDF`] is false and the print dialog stays.

use serde::{Deserialize, Serialize};

/// The sheet size of the PDF's pages: the print document's `@page` size (width × height as laid out, so a
/// landscape page has `width_mm > height_mm`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub width_mm: f64,
    pub height_mm: f64,
    #[serde(default)]
    pub landscape: bool,
}

impl Paper {
    /// The short and the long side in mm (portrait order).
    pub fn portrait_mm(&self) -> (f64, f64) {
        let (a, b) = (self.width_mm, self.height_mm);
        if a <= b {
            (a, b)
        } else {
            (b, a)
        }
    }

    /// Whether the pages are wider than high (the flag, or the sizes when it is missing).
    pub fn is_landscape(&self) -> bool {
        self.landscape || self.width_mm > self.height_mm
    }

    /// A usable paper: positive, finite sizes up to 5 m.
    pub fn validated(self) -> crate::Result<Paper> {
        let ok = |v: f64| v.is_finite() && v > 1.0 && v <= 5000.0;
        if ok(self.width_mm) && ok(self.height_mm) {
            Ok(self)
        } else {
            Err(crate::Error::Native(format!(
                "invalid paper size {} × {} mm",
                self.width_mm, self.height_mm
            )))
        }
    }
}

/// Whether this build renders PDFs on the desktop ([`print_to_pdf`]): WebKitGTK on Linux only.
pub const DESKTOP_PDF: bool = cfg!(all(target_os = "linux", not(target_os = "android")));

/// Whether this build renders PDFs at all (the mobile shells and [`DESKTOP_PDF`]); the page reads it as
/// `window.__RUSUITE_PDF__` (`ui-shared`'s `Backend.capabilities.pdf`).
pub const PDF_EXPORT: bool = crate::MOBILE_OS.is_some() || DESKTOP_PDF;

/// The page-side marker of [`PDF_EXPORT`].
pub fn pdf_init_script() -> &'static str {
    "Object.defineProperty(window, \"__RUSUITE_PDF__\", { value: true, configurable: false });"
}

/// `name` with a `.pdf` extension (the system pickers take it as the suggested file name).
pub fn pdf_file_name(name: &str) -> String {
    let name = name.trim().replace(['/', '\\'], "_");
    let name = if name.is_empty() {
        "document".to_owned()
    } else {
        name
    };
    if name.to_ascii_lowercase().ends_with(".pdf") {
        name
    } else {
        format!("{name}.pdf")
    }
}

/// Prints `window`'s page (its print media: the mounted print root) to the PDF file `path` without a dialog,
/// blocking until WebKitGTK finished writing it (call it off the main thread). Not Linux: [`crate::Error::Unsupported`].
#[cfg(all(target_os = "linux", not(target_os = "android")))]
pub fn print_to_pdf(
    window: &tauri::WebviewWindow<tauri::Wry>,
    path: &std::path::Path,
    paper: Paper,
) -> crate::Result<()> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::time::Duration;

    use gtk::{PageOrientation, PageSetup, PaperSize, PrintSettings, Unit};
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let paper = paper.validated()?;
    let uri = tauri::Url::from_file_path(path)
        .map_err(|()| crate::Error::Native(format!("not an absolute path: {}", path.display())))?
        .to_string();
    let (tx, rx) = std::sync::mpsc::channel::<std::result::Result<(), String>>();
    window.with_webview(move |webview| {
        let (short, long) = paper.portrait_mm();
        let orientation = if paper.is_landscape() {
            PageOrientation::Landscape
        } else {
            PageOrientation::Portrait
        };
        let size = PaperSize::new_custom("rusuite", "Rusuite", short, long, Unit::Mm);
        let settings = PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&uri));
        settings.set_paper_size(&size);
        settings.set_orientation(orientation);
        let setup = PageSetup::new();
        setup.set_paper_size(&size);
        setup.set_orientation(orientation);
        setup.set_top_margin(0.0, Unit::Mm);
        setup.set_bottom_margin(0.0, Unit::Mm);
        setup.set_left_margin(0.0, Unit::Mm);
        setup.set_right_margin(0.0, Unit::Mm);
        let op = PrintOperation::new(&webview.inner());
        op.set_print_settings(&settings);
        op.set_page_setup(&setup);
        // Kept alive until `finished` (WebKit may drop its own reference before the file is complete).
        let keep = Rc::new(RefCell::new(Some(op.clone())));
        let failed = tx.clone();
        op.connect_failed(move |_, e| {
            let _ = failed.send(Err(e.to_string()));
        });
        op.connect_finished(move |_| {
            let _ = tx.send(Ok(()));
            keep.borrow_mut().take();
        });
        op.print();
    })?;
    // `failed` (if any) arrives before `finished`: the first message decides.
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(Ok(())) if path.is_file() => Ok(()),
        Ok(Ok(())) => Err(crate::Error::Native("the PDF was not written".to_owned())),
        Ok(Err(e)) => Err(crate::Error::Native(e)),
        Err(_) => Err(crate::Error::Native("printing to PDF timed out".to_owned())),
    }
}

/// [`print_to_pdf`] on platforms without a dialog-free webview PDF path: always [`crate::Error::Unsupported`].
#[cfg(not(all(target_os = "linux", not(target_os = "android"))))]
pub fn print_to_pdf<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _path: &std::path::Path,
    _paper: Paper,
) -> crate::Result<()> {
    Err(crate::Error::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_uses_the_bridge_names_and_orders_its_sides() {
        let p: Paper =
            serde_json::from_str(r#"{"widthMm":297,"heightMm":210,"landscape":true}"#).unwrap();
        assert_eq!(p.portrait_mm(), (210.0, 297.0));
        assert!(p.is_landscape());
        let p: Paper = serde_json::from_str(r#"{"widthMm":216,"heightMm":279}"#).unwrap();
        assert!(!p.is_landscape());
        assert!(p.validated().is_ok());
        let bad = Paper {
            width_mm: f64::NAN,
            height_mm: 1.0,
            landscape: false,
        };
        assert!(bad.validated().is_err());
    }

    #[test]
    fn pdf_names_end_in_pdf() {
        assert_eq!(pdf_file_name("Budget"), "Budget.pdf");
        assert_eq!(pdf_file_name("a/b.PDF"), "a_b.PDF");
        assert_eq!(pdf_file_name("  "), "document.pdf");
    }

    #[test]
    fn the_desktop_renders_pdfs_on_linux_only() {
        assert_eq!(DESKTOP_PDF, cfg!(target_os = "linux"));
        assert_eq!(PDF_EXPORT, cfg!(target_os = "linux"));
        assert!(pdf_init_script().contains("__RUSUITE_PDF__"));
    }
}
