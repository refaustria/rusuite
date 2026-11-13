//! The converter side of the seam (feature `convert`): files → [`ImportPlan`]s, [`ExportSource`]s → files, pasted
//! HTML → a `doc`. Pure (no documents, no clock); the second wasm module calls the [`wire`] functions.
use std::collections::HashMap;

use notes_convert::onenote::{self, NotebookItem, OneNoteContext, OneSection};
use notes_convert::{
    docx, html, markdown, take_title, title_from_file_name, Blob, BlobSource, ConvertError,
    ConvertWarning, Converted, ExportContext, ExportFormat, ExportPage, ImportContext, PageContent,
    TagCatalog,
};
use serde_json::{json, Value};

use super::{
    ExportSource, ImportContextData, ImportKind, ImportPlan, ImportStats, PlanItem, PlanNotebook,
    PlanPage, PlanTag,
};
use crate::CoreError;

/// Placeholder tag id of the `i`-th custom tag of an import.
fn placeholder(i: usize) -> String {
    format!("import-tag-{i}")
}

/// Page doc ids of an import: `pg-` + 16 hex digits derived from the shell's random `seed` (splitmix64).
struct DocIds {
    state: u64,
}

impl DocIds {
    fn next(&mut self) -> String {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        format!("pg-{:016x}", z ^ (z >> 31))
    }
}

fn hex(c: fmt_onenote::Rgb) -> String {
    format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b)
}

fn convert_error(e: ConvertError) -> CoreError {
    CoreError::Format(e.to_string())
}

fn onenote_error(e: fmt_onenote::OneNoteError) -> CoreError {
    CoreError::Format(e.to_string())
}

/// Same warning text → one warning with the counts added.
pub(crate) fn merge_warnings(ws: Vec<ConvertWarning>) -> Vec<ConvertWarning> {
    let mut out: Vec<ConvertWarning> = Vec::new();
    for w in ws {
        match out.iter_mut().find(|o| o.text == w.text) {
            Some(o) => o.count += w.count,
            None => out.push(w),
        }
    }
    out
}

fn plan_page(c: PageContent, doc_id: Option<String>) -> PlanPage {
    PlanPage {
        title: c.title,
        level: c.level,
        doc_id,
        created: c.created,
        modified: c.modified,
        blocks: c.blocks,
        canvas: c.canvas,
        items: c.items,
        strokes: c.strokes,
    }
}

fn all_pages(items: &[NotebookItem]) -> Vec<&fmt_onenote::OnePage> {
    let mut out = Vec::new();
    for i in items {
        match i {
            NotebookItem::Section(s) => out.extend(&s.pages),
            NotebookItem::Group { items, .. } => out.extend(all_pages(items)),
        }
    }
    out
}

fn dedup_blobs(blobs: &mut Vec<Blob>, more: Vec<Blob>) {
    for b in more {
        if !blobs.iter().any(|x| x.id == b.id) {
            blobs.push(b);
        }
    }
}

fn stats(sections: u32, pages: u32, blobs: &[Blob]) -> ImportStats {
    let images = blobs
        .iter()
        .filter(|b| b.mime.starts_with("image/"))
        .count();
    ImportStats {
        sections,
        pages,
        images: u32::try_from(images).unwrap_or(u32::MAX),
        attachments: u32::try_from(blobs.len() - images).unwrap_or(u32::MAX),
    }
}

/// A OneNote file → its plan: a package (`.onepkg`, CAB) a new notebook, a `.one` a section.
fn onenote_plan(
    file_name: &str,
    bytes: &[u8],
    seed: u64,
) -> Result<(ImportPlan, Vec<Blob>), CoreError> {
    let mut warnings: Vec<ConvertWarning> = Vec::new();
    let (notebook, items) = if bytes.starts_with(b"MSCF") {
        let r = onenote::read_package(bytes, file_name).map_err(onenote_error)?;
        warnings.extend(r.warnings.into_iter().map(Into::into));
        let nb = PlanNotebook {
            name: r.value.name.clone(),
            color: r.value.color.map(hex),
        };
        (Some(nb), r.value.items)
    } else {
        let r = onenote::read_section(bytes, file_name).map_err(onenote_error)?;
        warnings.extend(r.warnings.into_iter().map(Into::into));
        (None, vec![NotebookItem::Section(r.value)])
    };
    let pages = all_pages(&items);
    let custom = onenote::custom_tags(pages.iter().copied());
    let tags: Vec<PlanTag> = custom
        .into_iter()
        .enumerate()
        .map(|(i, (label, todo))| PlanTag {
            placeholder: placeholder(i),
            label,
            todo,
        })
        .collect();
    // Doc ids first: links between the imported pages resolve by title (first page wins).
    let mut ids = DocIds { state: seed };
    let doc_ids: Vec<String> = pages.iter().map(|_| ids.next()).collect();
    let mut titles: HashMap<String, String> = HashMap::new();
    for (p, id) in pages.iter().zip(&doc_ids) {
        titles
            .entry(p.title.trim().to_lowercase())
            .or_insert_with(|| id.clone());
    }
    let resolve = |t: &str| titles.get(&t.trim().to_lowercase()).cloned();
    let ctx = OneNoteContext {
        custom_tags: tags
            .iter()
            .map(|t| (t.label.clone(), t.placeholder.clone()))
            .collect(),
        resolve_page: Some(&resolve),
    };
    let mut blobs = Vec::new();
    let mut next = doc_ids.into_iter();
    let mut sections = 0u32;
    let mut n_pages = 0u32;
    fn section(
        s: &OneSection,
        ctx: &OneNoteContext<'_>,
        next: &mut impl Iterator<Item = String>,
        blobs: &mut Vec<Blob>,
        warnings: &mut Vec<ConvertWarning>,
        counts: (&mut u32, &mut u32),
    ) -> PlanItem {
        *counts.0 += 1;
        let mut pages = Vec::new();
        for p in &s.pages {
            let Converted {
                value,
                blobs: b,
                warnings: w,
            } = onenote::page(p, ctx);
            dedup_blobs(blobs, b);
            warnings.extend(w);
            pages.push(plan_page(value, next.next()));
            *counts.1 += 1;
        }
        PlanItem::Section {
            name: s.name.trim().to_string(),
            color: s.color.map(hex),
            pages,
        }
    }
    fn walk(
        items: &[NotebookItem],
        ctx: &OneNoteContext<'_>,
        next: &mut impl Iterator<Item = String>,
        blobs: &mut Vec<Blob>,
        warnings: &mut Vec<ConvertWarning>,
        counts: (&mut u32, &mut u32),
    ) -> Vec<PlanItem> {
        let (s, p) = counts;
        let mut out = Vec::new();
        for i in items {
            out.push(match i {
                NotebookItem::Section(sec) => {
                    section(sec, ctx, next, blobs, warnings, (&mut *s, &mut *p))
                }
                NotebookItem::Group { name, items } => PlanItem::Group {
                    name: name.trim().to_string(),
                    items: walk(items, ctx, next, blobs, warnings, (&mut *s, &mut *p)),
                },
            });
        }
        out
    }
    let items = walk(
        &items,
        &ctx,
        &mut next,
        &mut blobs,
        &mut warnings,
        (&mut sections, &mut n_pages),
    );
    let stats = stats(sections, n_pages, &blobs);
    Ok((
        ImportPlan {
            notebook,
            items,
            page: None,
            tags,
            warnings: merge_warnings(warnings),
            stats,
        },
        blobs,
    ))
}

/// A file → its import plan and the blobs its pages use. `seed` (random, from the shell) makes the page doc ids
/// of OneNote imports; `ctx` describes the target notebook (Markdown, HTML, `.docx`).
pub fn build_import(
    kind: ImportKind,
    file_name: &str,
    bytes: &[u8],
    ctx: &ImportContextData,
    seed: u64,
) -> Result<(ImportPlan, Vec<Blob>), CoreError> {
    if kind == ImportKind::OneNote {
        return onenote_plan(file_name, bytes, seed);
    }
    let resolve = |t: &str| ctx.titles.get(&t.trim().to_lowercase()).cloned();
    let ictx = ImportContext {
        resolve_page: Some(&resolve),
        tags: TagCatalog::new(ctx.tags.clone()),
    };
    let mut fallback = title_from_file_name(file_name);
    let r = match kind {
        ImportKind::Markdown => markdown::import_bytes(bytes, &ictx).map_err(convert_error)?,
        ImportKind::Html => {
            let (r, title) = html::import_bytes(bytes, &ictx).map_err(convert_error)?;
            if let Some(t) = title {
                fallback = t;
            }
            r
        }
        ImportKind::Docx => docx::import(bytes, &ictx).map_err(convert_error)?,
        ImportKind::OneNote => unreachable!("handled above"),
    };
    let Converted {
        value: mut blocks,
        blobs,
        warnings,
    } = r;
    let title = take_title(&mut blocks, &fallback);
    let stats = stats(0, 1, &blobs);
    Ok((
        ImportPlan {
            page: Some(PlanPage {
                title,
                blocks,
                ..PlanPage::default()
            }),
            warnings,
            stats,
            ..ImportPlan::default()
        },
        blobs,
    ))
}

/// The editor's paste path: sanitised HTML → a ProseMirror `doc`, its warnings and the blobs it uses (`data:`
/// images; remote images become links and are never fetched).
#[must_use]
pub fn paste_html(
    html_text: &str,
    ctx: &ImportContextData,
) -> (Value, Vec<ConvertWarning>, Vec<Blob>) {
    let resolve = |t: &str| ctx.titles.get(&t.trim().to_lowercase()).cloned();
    let ictx = ImportContext {
        resolve_page: Some(&resolve),
        tags: TagCatalog::new(ctx.tags.clone()),
    };
    let r = html::import(html_text, &ictx);
    (
        json!({ "type": "doc", "content": r.value }),
        r.warnings,
        r.blobs,
    )
}

struct Blobs<'a>(&'a HashMap<String, Vec<u8>>);

impl BlobSource for Blobs<'_> {
    fn blob(&self, id: &str) -> Option<&[u8]> {
        self.0.get(id).map(Vec::as_slice)
    }
}

/// Exports a page or section: Markdown (a page `.md`, a section `.zip`), HTML or `.docx` bytes. `blobs` = the
/// bytes of [`ExportSource::blobs`] by id (missing ones export as their alt text / name).
pub fn run_export(
    src: &ExportSource,
    format: ExportFormat,
    blobs: &HashMap<String, Vec<u8>>,
) -> Result<Vec<u8>, CoreError> {
    let title_of = |id: &str| src.titles.get(id).cloned();
    let ctx = ExportContext {
        page_title: Some(&title_of),
        tags: TagCatalog::new(src.tags.clone()),
    };
    let pages: Vec<ExportPage> = src
        .pages
        .iter()
        .map(|p| ExportPage {
            title: p.title.clone(),
            doc: p.doc.clone(),
            level: p.level,
        })
        .collect();
    let first = pages
        .first()
        .ok_or_else(|| CoreError::BadRequest("nothing to export".into()))?;
    let b = Blobs(blobs);
    Ok(match (format, src.section) {
        (ExportFormat::Md, false) => markdown::export_page(first, &b, &ctx).into_bytes(),
        (ExportFormat::Md, true) => {
            markdown::export_section(&pages, &b, &ctx).map_err(convert_error)?
        }
        (ExportFormat::Html, false) => html::export_page(first, &b, &ctx).into_bytes(),
        (ExportFormat::Html, true) => {
            html::export_section(&src.title, &pages, &b, &ctx).into_bytes()
        }
        (ExportFormat::Docx, _) => docx::export(&pages, &b, &ctx).map_err(convert_error)?,
    })
}

/// The JSON/bytes entry points of `app-notes-convert-wasm` (errors: the JSON `{"err"}` reply, thrown by the
/// shell).
pub mod wire {
    use std::collections::HashMap;

    use notes_convert::ExportFormat;
    use serde::Deserialize;

    use super::super::{encode_frame, ExportSource, ImportContextData, ImportKind};
    use crate::dispatch::binary::error_json;
    use crate::CoreError;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ImportRequest {
        kind: ImportKind,
        file_name: String,
        /// Random (JS: below 2^53); seeds the page doc ids of OneNote imports.
        #[serde(default)]
        seed: u64,
        #[serde(default)]
        context: ImportContextData,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExportRequest {
        format: ExportFormat,
        source: ExportSource,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PasteRequest {
        html: String,
        #[serde(default)]
        context: ImportContextData,
    }

    fn bad(e: impl std::fmt::Display) -> String {
        error_json(&CoreError::BadRequest(e.to_string()))
    }

    /// `{kind, fileName, seed, context}` + the file → a frame: the [`ImportPlan`](super::ImportPlan) JSON and the
    /// blobs.
    pub fn import_file(request_json: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
        let r: ImportRequest = serde_json::from_str(request_json).map_err(bad)?;
        let (plan, blobs) = super::build_import(r.kind, &r.file_name, bytes, &r.context, r.seed)
            .map_err(|e| error_json(&e))?;
        let json = serde_json::to_string(&plan).map_err(bad)?;
        Ok(encode_frame(
            &json,
            blobs.iter().map(|b| b.bytes.as_slice()),
        ))
    }

    /// `{format, source}` + the blobs (`{len:u32 LE, bytes}*`) → the file's bytes.
    pub fn export(request_json: &str, blobs: &[u8]) -> Result<Vec<u8>, String> {
        let r: ExportRequest = serde_json::from_str(request_json).map_err(bad)?;
        let blobs: HashMap<String, Vec<u8>> = crate::split_blobs(blobs)
            .into_iter()
            .map(|b| (crate::blob_id(&b), b))
            .collect();
        super::run_export(&r.source, r.format, &blobs).map_err(|e| error_json(&e))
    }

    /// `{html, context}` → a frame: `{content, warnings}` (content: a ProseMirror `doc`) and the blobs.
    pub fn paste_html(request_json: &str) -> Result<Vec<u8>, String> {
        let r: PasteRequest = serde_json::from_str(request_json).map_err(bad)?;
        let (content, warnings, blobs) = super::paste_html(&r.html, &r.context);
        let json =
            serde_json::to_string(&serde_json::json!({ "content": content, "warnings": warnings }))
                .map_err(bad)?;
        Ok(encode_frame(
            &json,
            blobs.iter().map(|b| b.bytes.as_slice()),
        ))
    }
}
