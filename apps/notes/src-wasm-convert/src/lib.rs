#![forbid(unsafe_code)]
//! Rusuite Notes converters as a second WebAssembly module (P11-N6b): OneNote, Markdown, HTML and `.docx` import,
//! Markdown/HTML/`.docx` export and the HTML paste sanitiser. The web app loads it with a dynamic `import()` the
//! first time one of them is used, so the main module (`app-notes-wasm`) stays small. Pure functions: files →
//! import plans (frames, `notes_core::plan`) that the main module applies with `apply_import`; export sources (the
//! main module's `pageExportSource` / `sectionExportSource` replies) → file bytes. Errors are thrown as the JSON
//! `{"err": {code, message}}` reply.

use notes_core::plan::convert::wire;
use wasm_bindgen::prelude::wasm_bindgen;

/// Health check.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Notes converters {}", env!("CARGO_PKG_VERSION"))
}

/// `request` = `{kind: "oneNote"|"markdown"|"html"|"docx", fileName, seed?, context?}` (context: the
/// `importContext` reply), `bytes` = the file → a plan frame for `apply_import`.
#[wasm_bindgen]
pub fn import_file(request: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    wire::import_file(request, bytes)
}

/// `request` = `{format: "md"|"html"|"docx", source}` (source: an `exportSource` reply), `blobs` = the bytes of
/// `source.blobs` as `{len:u32 LE, bytes}*` → the file's bytes.
#[wasm_bindgen]
pub fn export_file(request: &str, blobs: &[u8]) -> Result<Vec<u8>, String> {
    wire::export(request, blobs)
}

/// `request` = `{html, context?}` → a frame: `{content, warnings}` (content: a ProseMirror `doc`) and the blobs of
/// its `data:` images (store them with the main module's `put_blob`).
#[wasm_bindgen]
pub fn paste_html(request: &str) -> Result<Vec<u8>, String> {
    wire::paste_html(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notes_core::plan::decode_frame;
    use serde_json::{json, Value};

    #[test]
    fn markdown_import_export_and_paste() {
        assert!(ping().starts_with("Rusuite Notes converters "));
        let frame = import_file(
            &json!({"kind": "markdown", "fileName": "a.md"}).to_string(),
            b"# Title\n\nHello *world*\n",
        )
        .unwrap();
        let (plan, blobs) = decode_frame(&frame).unwrap();
        let plan: Value = serde_json::from_str(plan).unwrap();
        assert_eq!(plan["page"]["title"], "Title");
        assert!(blobs.is_empty());
        let source = json!({"section": false, "title": "Title", "pages": [{"title": "Title", "level": 0,
            "doc": {"type": "doc", "content": plan["page"]["blocks"]}}]});
        let md = export_file(&json!({"format": "md", "source": source}).to_string(), &[]).unwrap();
        assert_eq!(String::from_utf8(md).unwrap(), "# Title\n\nHello *world*\n");
        let err = export_file(r#"{"format":"pdf"}"#, &[]).unwrap_err();
        assert!(err.contains("bad_request"), "{err}");
        let pasted = paste_html(&json!({"html": "<ul><li>a</li></ul>"}).to_string()).unwrap();
        let (v, _) = decode_frame(&pasted).unwrap();
        assert!(v.contains("bulletList"), "{v}");
    }
}
