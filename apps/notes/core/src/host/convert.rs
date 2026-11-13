//! Import and export (P11-N6a): applies `notes-convert` results to open notebooks – new notebooks, sections and
//! pages, blobs as persist effects – and exports pages and sections.
use std::collections::HashMap;

use loro::LoroDoc;
use model_notes::{NewPage, NodeKind, NotebookDoc, PageDoc, TagKind, TreeNode};
use notes_convert::onenote::{self, NotebookItem, OneNoteContext, OneSection};
use notes_convert::{
    docx, html, markdown, take_title, title_from_file_name, Blob, BlobSource, ConvertWarning,
    Converted, ExportContext, ExportFormat, ExportPage, ImportContext, PageContent, TagCatalog,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use super::{own, random_u64, NotebookSummary, NotesHost, Persist, Slot};
use crate::effects::PersistEffect;
use crate::CoreError;

/// What an import created.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct FileImported {
    pub notebook: NotebookSummary,
    pub tree: Vec<TreeNode>,
    /// The top-level nodes created (the section, or the page).
    pub nodes: Vec<String>,
    /// Every page created, in order.
    pub pages: Vec<NewPage>,
    pub warnings: Vec<ConvertWarning>,
}

/// Text formats imported as one page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageFormat {
    Markdown,
    Html,
    Docx,
}

/// A page planned for an import: its tree node, doc id and content source.
struct Planned<'a> {
    node: String,
    doc: String,
    page: &'a fmt_onenote::OnePage,
}

fn hex(c: fmt_onenote::Rgb) -> String {
    format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b)
}

fn new_doc_id() -> String {
    format!("pg-{:016x}", random_u64())
}

fn onenote_error(e: fmt_onenote::OneNoteError) -> CoreError {
    CoreError::Format(e.to_string())
}

fn convert_error(e: notes_convert::ConvertError) -> CoreError {
    CoreError::Format(e.to_string())
}

/// Creates a section and its pages (sub-pages under the page before them with a lower level).
fn build_section<'a>(
    d: &NotebookDoc,
    parent: Option<&str>,
    s: &'a OneSection,
    now: i64,
    out: &mut Vec<Planned<'a>>,
) -> Result<String, model_notes::NotesError> {
    let id = d.create_section(parent, None, s.name.trim(), now)?;
    if let Some(c) = s.color {
        d.set_color(&id, Some(&hex(c)), now)?;
    }
    let mut stack: Vec<(u8, String)> = Vec::new();
    for p in &s.pages {
        while stack.last().is_some_and(|(l, _)| *l >= p.level) {
            stack.pop();
        }
        let parent = stack.last().map_or(id.as_str(), |(_, n)| n.as_str());
        let doc = new_doc_id();
        let created = d.create_page_with_doc(parent, None, p.title.trim(), &doc, now)?;
        if let Some(c) = p.created {
            let c = c.saturating_mul(1000);
            let m = p.modified.map_or(c, |m| m.saturating_mul(1000));
            d.set_times(&created.node, c, m)?;
        }
        stack.push((p.level, created.node.clone()));
        out.push(Planned {
            node: created.node,
            doc,
            page: p,
        });
    }
    Ok(id)
}

fn build_items<'a>(
    d: &NotebookDoc,
    parent: Option<&str>,
    items: &'a [NotebookItem],
    now: i64,
    out: &mut Vec<Planned<'a>>,
    top: &mut Vec<String>,
) -> Result<(), model_notes::NotesError> {
    for item in items {
        match item {
            NotebookItem::Section(s) => top.push(build_section(d, parent, s, now, out)?),
            NotebookItem::Group { name, items } => {
                let id = d.create_group(parent, None, name.trim(), now)?;
                build_items(d, Some(&id), items, now, out, &mut Vec::new())?;
                top.push(id);
            }
        }
    }
    Ok(())
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

/// Blob bytes given by the shell for an export.
struct Blobs<'a>(&'a HashMap<String, Vec<u8>>);

impl BlobSource for Blobs<'_> {
    fn blob(&self, id: &str) -> Option<&[u8]> {
        self.0.get(id).map(Vec::as_slice)
    }
}

impl NotesHost {
    fn queue_blobs(&mut self, notebook: &str, blobs: Vec<Blob>) {
        for b in blobs {
            let dup = self.effects.iter().any(
                |e| matches!(e, PersistEffect::Blob { sha256, notebook: n, .. } if *sha256 == b.id && n == notebook),
            );
            if !dup {
                self.effects.push(PersistEffect::Blob {
                    notebook: notebook.into(),
                    sha256: b.id,
                    bytes: b.bytes,
                });
            }
        }
    }

    /// Page title (lowercase) → page doc id of the visible pages of `notebook`.
    fn title_index(&self, notebook: &str) -> Result<HashMap<String, String>, CoreError> {
        let mut m = HashMap::new();
        for (_, doc, title, deleted) in self.nb(notebook)?.doc.pages() {
            if !deleted {
                m.entry(title.trim().to_lowercase()).or_insert(doc);
            }
        }
        Ok(m)
    }

    /// Creates the page document of a planned/created page and fills it.
    fn fill_page(
        &mut self,
        notebook: &str,
        doc: &str,
        content: &PageContent,
    ) -> Result<(), CoreError> {
        let now = self.now;
        let ld = LoroDoc::new();
        own(&ld, self.peer)?;
        let page = PageDoc::create_in(ld, Some(&content.title), now);
        page.import_blocks(&content.blocks, now)?;
        if content.canvas {
            page.set_canvas(true, now)?;
        }
        for item in &content.items {
            page.add_canvas_item(item)?;
        }
        for s in &content.strokes {
            page.add_stroke(s)?;
        }
        if let Some(c) = content.created {
            page.set_times(c, content.modified.unwrap_or(c))?;
        }
        let nb = self.nb_mut(notebook)?;
        nb.data.insert(doc.to_string(), page.index_data());
        nb.persist.insert(doc.to_string(), Persist::default());
        nb.pages.insert(doc.to_string(), Slot::Loaded(page));
        self.after_page_change(notebook, doc)?;
        // Keep only the stored bytes: a large import must not keep every page materialised.
        let nb = self.nb_mut(notebook)?;
        if let Some(Slot::Loaded(p)) = nb.pages.get(doc) {
            let snapshot = super::snapshot_of(p.doc())?;
            nb.pages.insert(
                doc.to_string(),
                Slot::Stored {
                    snapshot,
                    updates: Vec::new(),
                },
            );
        }
        Ok(())
    }

    /// Imports a OneNote file: a notebook package (`.onepkg`, a CAB archive) becomes a new notebook (`id` or a
    /// random one); a section file (`.one`) becomes a new section of `notebook` (at the root, or in group
    /// `parent`).
    pub fn import_onenote(
        &mut self,
        file_name: &str,
        bytes: &[u8],
        notebook: Option<&str>,
        parent: Option<&str>,
        id: Option<&str>,
    ) -> Result<FileImported, CoreError> {
        let mut warnings: Vec<ConvertWarning> = Vec::new();
        let (target, items) = if bytes.starts_with(b"MSCF") {
            let r = onenote::read_package(bytes, file_name).map_err(onenote_error)?;
            warnings.extend(r.warnings.into_iter().map(Into::into));
            let summary = self.create_notebook(&r.value.name, id)?;
            if let Some(c) = r.value.color {
                self.set_notebook_color(&summary.id, Some(&hex(c)))?;
            }
            (summary.id, r.value.items)
        } else {
            let notebook = notebook.ok_or_else(|| {
                CoreError::BadRequest("a OneNote section (.one) needs a target notebook".into())
            })?;
            self.nb(notebook)?;
            let r = onenote::read_section(bytes, file_name).map_err(onenote_error)?;
            warnings.extend(r.warnings.into_iter().map(Into::into));
            (notebook.to_string(), vec![NotebookItem::Section(r.value)])
        };
        let pages = all_pages(&items);
        let custom = onenote::custom_tags(pages.iter().copied());
        let (planned, top, tag_ids) = self.edit(&target, |d, now| {
            let mut tag_ids = HashMap::new();
            for (label, todo) in &custom {
                let existing = d.tags().into_iter().find(|t| {
                    matches!(t.kind, TagKind::Custom | TagKind::CustomToDo) && t.label == *label
                });
                let id = match existing {
                    Some(t) => t.id,
                    None => {
                        let kind = if *todo {
                            TagKind::CustomToDo
                        } else {
                            TagKind::Custom
                        };
                        d.add_tag(label, None, None, kind)?
                    }
                };
                tag_ids.insert(label.clone(), id);
            }
            let mut planned = Vec::new();
            let mut top = Vec::new();
            build_items(d, parent, &items, now, &mut planned, &mut top)?;
            Ok((planned, top, tag_ids))
        })?;
        // Links between imported pages: by title, first page wins.
        let mut titles: HashMap<String, String> = HashMap::new();
        for p in &planned {
            titles
                .entry(p.page.title.trim().to_lowercase())
                .or_insert_with(|| p.doc.clone());
        }
        let resolve = |t: &str| titles.get(&t.trim().to_lowercase()).cloned();
        let ctx = OneNoteContext {
            custom_tags: tag_ids,
            resolve_page: Some(&resolve),
        };
        let mut created = Vec::new();
        for p in &planned {
            let Converted {
                value,
                blobs,
                warnings: w,
            } = onenote::page(p.page, &ctx);
            self.fill_page(&target, &p.doc, &value)?;
            self.queue_blobs(&target, blobs);
            warnings.extend(w);
            created.push(NewPage {
                node: p.node.clone(),
                doc_id: p.doc.clone(),
            });
        }
        self.reindex_notebook(&target);
        Ok(FileImported {
            notebook: self.summary(&target)?,
            tree: self.tree(&target)?,
            nodes: top,
            pages: created,
            warnings: merge_warnings(warnings),
        })
    }

    fn import_context_parts(
        &self,
        notebook: &str,
    ) -> Result<(HashMap<String, String>, TagCatalog), CoreError> {
        Ok((
            self.title_index(notebook)?,
            TagCatalog::new(self.nb(notebook)?.doc.tags()),
        ))
    }

    /// Imports a Markdown, HTML or `.docx` file as a new page under `parent` (a section or a page). The title is
    /// the leading level-1 heading (removed from the content), else the HTML `<title>`, else the file name.
    pub fn import_page(
        &mut self,
        format: PageFormat,
        file_name: &str,
        bytes: &[u8],
        notebook: &str,
        parent: &str,
    ) -> Result<FileImported, CoreError> {
        let (titles, tags) = self.import_context_parts(notebook)?;
        let resolve = |t: &str| titles.get(&t.trim().to_lowercase()).cloned();
        let ctx = ImportContext {
            resolve_page: Some(&resolve),
            tags,
        };
        let mut fallback = title_from_file_name(file_name);
        let r = match format {
            PageFormat::Markdown => markdown::import_bytes(bytes, &ctx).map_err(convert_error)?,
            PageFormat::Html => {
                let (r, title) = html::import_bytes(bytes, &ctx).map_err(convert_error)?;
                if let Some(t) = title {
                    fallback = t;
                }
                r
            }
            PageFormat::Docx => docx::import(bytes, &ctx).map_err(convert_error)?,
        };
        let Converted {
            value: mut blocks,
            blobs,
            warnings,
        } = r;
        let title = take_title(&mut blocks, &fallback);
        let page = self.create_page(notebook, parent, None, &title)?;
        let now = self.now;
        self.load_page(notebook, &page.doc_id)?
            .import_blocks(&blocks, now)?;
        self.after_page_change(notebook, &page.doc_id)?;
        self.queue_blobs(notebook, blobs);
        self.reindex_notebook(notebook);
        Ok(FileImported {
            notebook: self.summary(notebook)?,
            tree: self.tree(notebook)?,
            nodes: vec![page.node.clone()],
            pages: vec![page],
            warnings,
        })
    }

    /// The editor's paste path: sanitised HTML → a ProseMirror `doc` (images stored as blobs of `notebook`).
    pub fn paste_html(
        &mut self,
        notebook: &str,
        html_text: &str,
    ) -> Result<(Value, Vec<ConvertWarning>), CoreError> {
        let (titles, tags) = self.import_context_parts(notebook)?;
        let resolve = |t: &str| titles.get(&t.trim().to_lowercase()).cloned();
        let ctx = ImportContext {
            resolve_page: Some(&resolve),
            tags,
        };
        let r = html::import(html_text, &ctx);
        self.queue_blobs(notebook, r.blobs);
        Ok((json!({ "type": "doc", "content": r.value }), r.warnings))
    }

    /// Page doc id → tree title across open notebooks.
    fn page_titles(&self) -> HashMap<String, String> {
        self.notebooks
            .values()
            .flat_map(|nb| nb.doc.pages())
            .map(|(_, doc, title, _)| (doc, title))
            .collect()
    }

    fn export_pages(
        &self,
        notebook: &str,
        pages: &[ExportPage],
        section_title: &str,
        format: ExportFormat,
        section: bool,
        blobs: &HashMap<String, Vec<u8>>,
    ) -> Result<Vec<u8>, CoreError> {
        let titles = self.page_titles();
        let title_of = |id: &str| titles.get(id).cloned();
        let ctx = ExportContext {
            page_title: Some(&title_of),
            tags: TagCatalog::new(self.nb(notebook)?.doc.tags()),
        };
        let src = Blobs(blobs);
        Ok(match (format, section) {
            (ExportFormat::Md, false) => markdown::export_page(&pages[0], &src, &ctx).into_bytes(),
            (ExportFormat::Md, true) => {
                markdown::export_section(pages, &src, &ctx).map_err(convert_error)?
            }
            (ExportFormat::Html, false) => html::export_page(&pages[0], &src, &ctx).into_bytes(),
            (ExportFormat::Html, true) => {
                html::export_section(section_title, pages, &src, &ctx).into_bytes()
            }
            (ExportFormat::Docx, _) => docx::export(pages, &src, &ctx).map_err(convert_error)?,
        })
    }

    /// One page as Markdown, HTML or `.docx` bytes; `blobs` holds the bytes of the images/attachments it uses.
    pub fn export_page(
        &mut self,
        doc: &str,
        format: ExportFormat,
        blobs: &HashMap<String, Vec<u8>>,
    ) -> Result<Vec<u8>, CoreError> {
        let notebook = self
            .notebook_of(doc)
            .filter(|n| n != doc)
            .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?;
        let tree_title = self
            .nb(&notebook)?
            .doc
            .node_of_page_doc(doc)
            .and_then(|n| self.nb(&notebook).ok()?.doc.get_node(&n).ok())
            .map(|n| n.title);
        let page = self.load_page(&notebook, doc)?;
        let p = ExportPage {
            title: tree_title.unwrap_or_else(|| page.title()),
            doc: page.to_pm_json(),
            level: 0,
        };
        self.export_pages(&notebook, &[p], "", format, false, blobs)
    }

    /// A section's pages (sub-pages included, in tree order): Markdown zip, one HTML file or one `.docx`.
    pub fn export_section(
        &mut self,
        notebook: &str,
        section: &str,
        format: ExportFormat,
        blobs: &HashMap<String, Vec<u8>>,
    ) -> Result<Vec<u8>, CoreError> {
        let node = self.nb(notebook)?.doc.get_node(section)?;
        if node.kind == NodeKind::Group {
            return Err(CoreError::BadRequest(format!(
                "{section} is a section group, not a section"
            )));
        }
        fn walk(n: &TreeNode, level: u8, out: &mut Vec<(String, String, u8)>) {
            for c in &n.children {
                if let Some(doc) = &c.page_doc {
                    out.push((doc.clone(), c.title.clone(), level));
                }
                walk(c, level.saturating_add(1), out);
            }
        }
        let mut list = Vec::new();
        if let (NodeKind::Page, Some(doc)) = (node.kind, &node.page_doc) {
            list.push((doc.clone(), node.title.clone(), 0));
            walk(&node, 1, &mut list);
        } else {
            walk(&node, 0, &mut list);
        }
        let mut pages = Vec::new();
        for (doc, title, level) in list {
            let pm = self.load_page(notebook, &doc)?.to_pm_json();
            pages.push(ExportPage {
                title,
                doc: pm,
                level,
            });
        }
        if pages.is_empty() {
            pages.push(ExportPage {
                title: node.title.clone(),
                doc: json!({ "type": "doc", "content": [] }),
                level: 0,
            });
        }
        self.export_pages(notebook, &pages, &node.title, format, true, blobs)
    }
}

fn merge_warnings(ws: Vec<ConvertWarning>) -> Vec<ConvertWarning> {
    let mut out: Vec<ConvertWarning> = Vec::new();
    for w in ws {
        match out.iter_mut().find(|o| o.text == w.text) {
            Some(o) => o.count += w.count,
            None => out.push(w),
        }
    }
    out
}
