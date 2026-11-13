#![forbid(unsafe_code)]
//! Rusuite Notes converters (P11-N6a): pure functions between other formats and Notes page content, which is
//! ProseMirror JSON in the schema of `docs/notes-format.md` §4.4 (the same JSON
//! [`model_notes::PageDoc::append_blocks`] takes and [`model_notes::PageDoc::to_pm_json`] returns).
//!
//! | Format | Import | Export |
//! |---|---|---|
//! | OneNote `.one` / `.onepkg` ([`onenote`]) | via `fmt-onenote` → sections/pages, canvas rule | – |
//! | Markdown ([`markdown`]) | CommonMark + GFM tables, task lists, strikethrough (`pulldown-cmark`) | page `.md`, section zip |
//! | HTML ([`html`]) | sanitised (allow-list; images only from `data:` URIs) – files and the editor's paste path | standalone `.html` |
//! | `.docx` ([`docx`]) | via `fmt-docx` → `model-text` | via `model-text` → `fmt-docx` |
//!
//! Importers return [`Converted`] values: the content, the blobs it references (images, attachments; blob id =
//! SHA-256 hex of the bytes) and [`ConvertWarning`]s about what was dropped or approximated. Exporters read blob
//! bytes through a [`BlobSource`]. No I/O, no clock, `wasm32-unknown-unknown` compatible. Applying an import to a
//! notebook (creating sections/pages, storing blobs) is `notes-core`'s job.

pub mod docx;
pub mod html;
pub mod markdown;
pub mod onenote;
mod pm;
mod tags;
mod warn;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use pm::{blob_id, sniff_mime};
pub use tags::{tag_label, TagCatalog};
pub use warn::ConvertWarning;
pub(crate) use warn::Warnings;

/// An image or attachment referenced by imported content (attribute `blob`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blob {
    /// SHA-256 hex of `bytes`.
    pub id: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// An import result: the value, the blobs its content references and the warnings.
#[derive(Debug, Clone, PartialEq)]
pub struct Converted<T> {
    pub value: T,
    pub blobs: Vec<Blob>,
    pub warnings: Vec<ConvertWarning>,
}

/// One imported page.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PageContent {
    pub title: String,
    /// Sub-page depth (OneNote): 0 = page, 1 = sub-page, …
    pub level: u8,
    /// Unix ms.
    pub created: Option<i64>,
    /// Unix ms.
    pub modified: Option<i64>,
    /// Top-level blocks (ProseMirror JSON nodes).
    pub blocks: Vec<Value>,
    /// A freeform canvas page (`meta.canvas`): `items` and `strokes` are its positioned content.
    pub canvas: bool,
    pub items: Vec<model_notes::CanvasItem>,
    pub strokes: Vec<model_notes::InkStroke>,
}

/// Why a file could not be converted at all (partial problems are [`ConvertWarning`]s).
#[derive(Debug, thiserror::Error)]
pub enum ConvertError {
    #[error(transparent)]
    OneNote(#[from] fmt_onenote::OneNoteError),
    #[error("the .docx file could not be read: {0}")]
    Docx(#[from] fmt_docx::Error),
    #[error("the file is not valid UTF-8 text")]
    NotText,
    #[error("{0}")]
    Zip(String),
}

/// Export formats of pages and sections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    /// Page: `.md` (images as `data:` URIs); section: `.zip` of `<page>.md` + `assets/`.
    Md,
    /// Standalone `.html` with embedded images (a section: one file, one `<article>` per page).
    Html,
    /// `.docx`; a section is one document, each page a Heading 1 starting on a new page.
    Docx,
}

impl ExportFormat {
    /// File extension of a page (`section` = a section export).
    #[must_use]
    pub fn extension(self, section: bool) -> &'static str {
        match self {
            ExportFormat::Md if section => "zip",
            ExportFormat::Md => "md",
            ExportFormat::Html => "html",
            ExportFormat::Docx => "docx",
        }
    }
}

/// A page to export: its title and content (`PageDoc::to_pm_json()`, a `doc` node).
#[derive(Debug, Clone, PartialEq)]
pub struct ExportPage {
    pub title: String,
    pub doc: Value,
    /// Sub-page depth inside the section (0 = page).
    pub level: u8,
}

/// Blob bytes for exporters (images, attachments) by blob id. Missing blobs export as their alt text / name.
pub trait BlobSource {
    fn blob(&self, id: &str) -> Option<&[u8]>;
}

impl BlobSource for HashMap<String, Vec<u8>> {
    fn blob(&self, id: &str) -> Option<&[u8]> {
        self.get(id).map(Vec::as_slice)
    }
}

/// No blobs available.
pub struct NoBlobs;

impl BlobSource for NoBlobs {
    fn blob(&self, _: &str) -> Option<&[u8]> {
        None
    }
}

/// A lookup by string: page title → page doc id, or page doc id → title.
pub type Lookup<'f> = dyn Fn(&str) -> Option<String> + 'f;

/// What importers need from the target notebook: page titles for `[[Title]]` links (→ `pageLink` nodes) and the
/// tag catalog for plain-text tag markers (` [Important]`).
#[derive(Default)]
pub struct ImportContext<'a> {
    /// Page title → page doc id (case-insensitive match is the caller's choice).
    pub resolve_page: Option<&'a Lookup<'a>>,
    pub tags: TagCatalog,
}

impl ImportContext<'_> {
    pub(crate) fn page_id(&self, title: &str) -> Option<String> {
        self.resolve_page.and_then(|f| f(title))
    }
}

/// What exporters need from the notebook: page doc id → title (for `pageLink` marks without a title) and tag
/// labels.
#[derive(Default)]
pub struct ExportContext<'a> {
    pub page_title: Option<&'a Lookup<'a>>,
    pub tags: TagCatalog,
}

impl ExportContext<'_> {
    pub(crate) fn title_of(&self, id: &str) -> Option<String> {
        self.page_title.and_then(|f| f(id))
    }
}

/// The title a page gets from a file name: its last path component without the extension.
#[must_use]
pub fn title_from_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = base.rsplit_once('.').map_or(base, |(s, _)| s);
    stem.trim().to_string()
}

/// Uses a leading level-1 heading as the page title (removing it); otherwise `fallback`.
#[must_use]
pub fn take_title(blocks: &mut Vec<Value>, fallback: &str) -> String {
    let first_h1 = blocks.first().is_some_and(|b| {
        b.get("type").and_then(Value::as_str) == Some("heading")
            && b.pointer("/attrs/level").and_then(Value::as_u64) == Some(1)
    });
    if first_h1 {
        let t = pm::inline_text(&blocks[0]);
        if !t.trim().is_empty() {
            blocks.remove(0);
            return t.trim().to_string();
        }
    }
    fallback.to_string()
}
