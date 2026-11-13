//! Import plans and export sources (P11-N6b): the seam between the converters and the documents.
//!
//! The web app keeps the converters (`notes-convert`: OneNote, Markdown, HTML, `.docx`) out of its main wasm
//! module: they live in a second module (`app-notes-convert-wasm`) loaded on first use. That side is pure – it
//! turns a file into an [`ImportPlan`] (sections, pages as ProseMirror JSON, custom tags, warnings) plus the blobs
//! the pages use, an [`ExportSource`] into file bytes, and pasted HTML into a `doc`. The documents stay with the
//! [`NotesHost`](crate::NotesHost): it hands out the [`ImportContextData`] / [`ExportSource`] and applies plans
//! ([`NotesHost::apply_import`](crate::NotesHost::apply_import)). Feature `convert` (default) adds the converter
//! side ([`convert`]) and the one-step import/export commands built from both halves (Tauri, tests).
//!
//! **Frame** (plans and paste results between the modules): `json_len: u32 LE`, the JSON, then the blobs as
//! `{len: u32 LE, bytes}*` (blob id = SHA-256 hex of the bytes).
use std::collections::BTreeMap;

use model_notes::{CanvasItem, InkStroke, TagDef};
use notes_convert::ConvertWarning;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::CoreError;

/// What importers need from the target notebook (`importContext` reply).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct ImportContextData {
    /// Lower-case page title → page doc id of the visible pages (`[[Title]]` → page links).
    #[serde(default)]
    pub titles: BTreeMap<String, String>,
    /// The notebook's tag definitions (plain-text tag markers → tags).
    #[serde(default)]
    pub tags: Vec<TagDef>,
}

/// The import formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub enum ImportKind {
    /// `.one` (a section) or `.onepkg` (a notebook; sniffed by its CAB signature).
    OneNote,
    Markdown,
    Html,
    Docx,
}

/// A page to create.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct PlanPage {
    pub title: String,
    /// Sub-page depth inside its section (OneNote).
    #[serde(default)]
    pub level: u8,
    /// The page doc id (OneNote pages: links between the imported pages point at it); absent = a new one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub doc_id: Option<String>,
    /// Unix ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub created: Option<i64>,
    /// Unix ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub modified: Option<i64>,
    /// Top-level blocks (ProseMirror JSON, `docs/notes-format.md` §7.1).
    #[ts(type = "Array<unknown>")]
    pub blocks: Vec<Value>,
    /// A freeform canvas page.
    #[serde(default)]
    pub canvas: bool,
    #[serde(default)]
    pub items: Vec<CanvasItem>,
    #[serde(default)]
    pub strokes: Vec<InkStroke>,
}

/// A section (with its pages in order; sub-pages follow their page) or a section group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub enum PlanItem {
    Section {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
        pages: Vec<PlanPage>,
    },
    Group {
        name: String,
        items: Vec<PlanItem>,
    },
}

/// A new notebook (`.onepkg`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct PlanNotebook {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
}

/// A custom tag the pages use: their `tags` attributes carry `placeholder` until the import creates (or finds) the
/// notebook's tag with this label.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct PlanTag {
    pub placeholder: String,
    pub label: String,
    /// Has a check box (a custom to-do tag).
    pub todo: bool,
}

/// Counts for the import result dialog.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct ImportStats {
    pub sections: u32,
    pub pages: u32,
    /// Distinct pictures (image blobs).
    pub images: u32,
    /// Distinct attached files (other blobs).
    pub attachments: u32,
}

/// What an import creates: a new notebook with sections (`.onepkg`), sections (`.one`) or one page (Markdown,
/// HTML, `.docx`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct ImportPlan {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notebook: Option<PlanNotebook>,
    #[serde(default)]
    pub items: Vec<PlanItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub page: Option<PlanPage>,
    #[serde(default)]
    pub tags: Vec<PlanTag>,
    #[serde(default)]
    pub warnings: Vec<ConvertWarning>,
    #[serde(default)]
    pub stats: ImportStats,
}

/// A page of an [`ExportSource`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct ExportSourcePage {
    pub title: String,
    /// `PageDoc::to_pm_json()` (a `doc` node).
    #[ts(type = "unknown")]
    pub doc: Value,
    /// Sub-page depth inside the section.
    pub level: u8,
}

/// Everything an exporter needs, without the blob bytes (`pageExportSource` / `sectionExportSource` reply).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct ExportSource {
    /// A section export (Markdown: a zip; HTML: one `<article>` per page; `.docx`: a page per page).
    pub section: bool,
    /// The section's (or the page's) title – also the suggested file name.
    pub title: String,
    pub pages: Vec<ExportSourcePage>,
    /// Page doc id → title (page links without a title).
    #[serde(default)]
    pub titles: BTreeMap<String, String>,
    #[serde(default)]
    pub tags: Vec<TagDef>,
    /// The blob ids the pages use (the shell passes their bytes to the exporter).
    #[serde(default)]
    pub blobs: Vec<String>,
}

/// Writes a frame: the JSON, then the blobs.
#[must_use]
pub fn encode_frame<'b>(json: &str, blobs: impl IntoIterator<Item = &'b [u8]>) -> Vec<u8> {
    let mut out = Vec::with_capacity(json.len() + 4);
    let len = u32::try_from(json.len()).unwrap_or(u32::MAX);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(json.as_bytes());
    for b in blobs {
        out.extend_from_slice(&crate::log_record(b));
    }
    out
}

/// Reads a frame → (JSON, blobs).
pub fn decode_frame(bytes: &[u8]) -> Result<(&str, Vec<Vec<u8>>), CoreError> {
    let bad = || CoreError::BadRequest("truncated import frame".into());
    let head: [u8; 4] = bytes
        .get(..4)
        .ok_or_else(bad)?
        .try_into()
        .map_err(|_| bad())?;
    let len = u32::from_le_bytes(head) as usize;
    let end = 4usize.checked_add(len).ok_or_else(bad)?;
    let json = bytes.get(4..end).ok_or_else(bad)?;
    let json = std::str::from_utf8(json).map_err(|_| bad())?;
    let tail = &bytes[end..];
    let (blobs, valid) = crate::split_log(tail);
    if valid != tail.len() {
        return Err(bad());
    }
    Ok((json, blobs))
}

/// Replaces placeholder tag ids in the `tags` attributes of `blocks` (nested blocks included).
pub(crate) fn rewrite_tags(blocks: &mut [Value], ids: &BTreeMap<String, String>) {
    fn walk(v: &mut Value, ids: &BTreeMap<String, String>) {
        match v {
            Value::Object(m) => {
                if let Some(Value::Array(tags)) = m.get_mut("attrs").and_then(|a| a.get_mut("tags"))
                {
                    for t in tags.iter_mut() {
                        if let Some(id) = t.as_str().and_then(|s| ids.get(s)) {
                            *t = Value::String(id.clone());
                        }
                    }
                }
                if let Some(c) = m.get_mut("content") {
                    walk(c, ids);
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| walk(x, ids)),
            _ => {}
        }
    }
    if ids.is_empty() {
        return;
    }
    for b in blocks {
        walk(b, ids);
    }
}

/// The blob ids (`attrs.blob`) used in a ProseMirror JSON tree, first use first.
pub(crate) fn blob_refs(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            if let Some(Value::String(b)) = m.get("attrs").and_then(|a| a.get("blob")) {
                if !out.contains(b) {
                    out.push(b.clone());
                }
            }
            if let Some(c) = m.get("content") {
                blob_refs(c, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| blob_refs(x, out)),
        _ => {}
    }
}

#[cfg(feature = "convert")]
pub mod convert;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_round_trip_and_reject_truncation() {
        let f = encode_frame(r#"{"a":1}"#, [b"img".as_slice(), b"".as_slice()]);
        let (json, blobs) = decode_frame(&f).unwrap();
        assert_eq!(json, r#"{"a":1}"#);
        assert_eq!(blobs, vec![b"img".to_vec(), Vec::new()]);
        assert!(decode_frame(&f[..f.len() - 1]).is_err());
        assert!(decode_frame(&f[..3]).is_err());
        assert!(decode_frame(&[9, 0, 0, 0, b'{']).is_err());
    }

    #[test]
    fn tags_are_rewritten_in_nested_blocks() {
        let mut blocks = vec![
            json!({"type": "bulletList", "content": [{"type": "listItem", "content": [
            {"type": "paragraph", "attrs": {"tags": ["import-tag-0", "todo"]}}]}]}),
        ];
        let ids = BTreeMap::from([("import-tag-0".to_string(), "t-7-1".to_string())]);
        rewrite_tags(&mut blocks, &ids);
        assert_eq!(
            blocks[0].pointer("/content/0/content/0/attrs/tags"),
            Some(&json!(["t-7-1", "todo"]))
        );
        let mut refs = Vec::new();
        blob_refs(
            &json!({"type": "doc", "content": [{"type": "image", "attrs": {"blob": "b1"}},
                {"type": "paragraph", "content": [{"type": "image", "attrs": {"blob": "b1"}}]},
                {"type": "attachment", "attrs": {"blob": "b2"}}]}),
            &mut refs,
        );
        assert_eq!(refs, ["b1", "b2"]);
    }
}
