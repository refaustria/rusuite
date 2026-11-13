//! Import and export (P11-N6a, split in P11-N6b): applies [`ImportPlan`]s to open notebooks – new notebooks,
//! sections and pages, custom tags, blobs as persist effects – and describes pages/sections for the exporters
//! ([`ExportSource`]). The converters themselves run in `crate::plan::convert` (feature `convert`); the
//! one-step commands at the end combine both halves.
#[cfg(feature = "convert")]
use std::collections::HashMap;
use std::collections::{BTreeMap, HashSet};

use loro::LoroDoc;
use model_notes::{NewPage, NodeKind, NotebookDoc, PageDoc, TagKind, TreeNode};
use notes_convert::ConvertWarning;
#[cfg(feature = "convert")]
use notes_convert::ExportFormat;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use super::{own, random_u64, NotebookSummary, NotesHost, Persist, Slot};
use crate::effects::{is_safe_id, PersistEffect};
use crate::plan::{
    blob_refs, rewrite_tags, ExportSource, ExportSourcePage, ImportContextData, ImportPlan,
    PlanItem, PlanPage,
};
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

/// Where an import goes: `notebook` (unused for a new notebook from a package), `parent` (the section or page of
/// a page import; the group of a section import), `id` (the new notebook's id).
#[derive(Debug, Clone, Copy, Default)]
pub struct ImportTarget<'a> {
    pub notebook: Option<&'a str>,
    pub parent: Option<&'a str>,
    pub id: Option<&'a str>,
}

/// A planned page: its tree node, doc id and content.
struct Planned<'a> {
    node: String,
    doc: String,
    page: &'a PlanPage,
}

fn new_doc_id() -> String {
    format!("pg-{:016x}", random_u64())
}

/// A plan's doc id when it is usable (safe, not taken), else a new one.
fn doc_id_for(p: &PlanPage, taken: &HashSet<String>) -> String {
    match &p.doc_id {
        Some(id) if is_safe_id(id) && !taken.contains(id) => id.clone(),
        _ => new_doc_id(),
    }
}

/// Creates a section and its pages (sub-pages under the page before them with a lower level).
fn build_section<'a>(
    d: &NotebookDoc,
    parent: Option<&str>,
    (name, color, pages): (&str, Option<&str>, &'a [PlanPage]),
    now: i64,
    taken: &mut HashSet<String>,
    out: &mut Vec<Planned<'a>>,
) -> Result<String, model_notes::NotesError> {
    let id = d.create_section(parent, None, name.trim(), now)?;
    if let Some(c) = color {
        d.set_color(&id, Some(c), now)?;
    }
    let mut stack: Vec<(u8, String)> = Vec::new();
    for p in pages {
        while stack.last().is_some_and(|(l, _)| *l >= p.level) {
            stack.pop();
        }
        let parent = stack.last().map_or(id.as_str(), |(_, n)| n.as_str());
        let doc = doc_id_for(p, taken);
        taken.insert(doc.clone());
        let created = d.create_page_with_doc(parent, None, p.title.trim(), &doc, now)?;
        if let Some(c) = p.created {
            d.set_times(&created.node, c, p.modified.unwrap_or(c))?;
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
    items: &'a [PlanItem],
    now: i64,
    taken: &mut HashSet<String>,
    out: &mut Vec<Planned<'a>>,
    top: &mut Vec<String>,
) -> Result<(), model_notes::NotesError> {
    for item in items {
        match item {
            PlanItem::Section { name, color, pages } => top.push(build_section(
                d,
                parent,
                (name, color.as_deref(), pages),
                now,
                taken,
                out,
            )?),
            PlanItem::Group { name, items } => {
                let id = d.create_group(parent, None, name.trim(), now)?;
                build_items(d, Some(&id), items, now, taken, out, &mut Vec::new())?;
                top.push(id);
            }
        }
    }
    Ok(())
}

impl NotesHost {
    fn queue_blobs(&mut self, notebook: &str, blobs: Vec<Vec<u8>>) {
        for bytes in blobs {
            let id = crate::blob_id(&bytes);
            let dup = self.effects.iter().any(
                |e| matches!(e, PersistEffect::Blob { sha256, notebook: n, .. } if *sha256 == id && n == notebook),
            );
            if !dup {
                self.effects.push(PersistEffect::Blob {
                    notebook: notebook.into(),
                    sha256: id,
                    bytes,
                });
            }
        }
    }

    /// What importers need from `notebook`: lower-case page title → page doc id of its visible pages (first page
    /// wins) and its tags.
    pub fn import_context(&self, notebook: &str) -> Result<ImportContextData, CoreError> {
        let nb = self.nb(notebook)?;
        let mut titles = BTreeMap::new();
        for (_, doc, title, deleted) in nb.doc.pages() {
            if !deleted {
                titles.entry(title.trim().to_lowercase()).or_insert(doc);
            }
        }
        Ok(ImportContextData {
            titles,
            tags: nb.doc.tags(),
        })
    }

    /// Creates the page document of a planned page and fills it.
    fn fill_page(
        &mut self,
        notebook: &str,
        doc: &str,
        content: &PlanPage,
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

    /// Applies an import plan (from the converters, `crate::plan`) with the bytes of the blobs its pages use.
    /// A plan with a `notebook` creates a new notebook (`target.id` or a random id); `items` become sections and
    /// groups of the target notebook (at the root, or in group `target.parent`; one undo step); a `page` becomes a
    /// new page under `target.parent` (a section or a page).
    pub fn apply_import(
        &mut self,
        target: &ImportTarget<'_>,
        mut plan: ImportPlan,
        blobs: Vec<Vec<u8>>,
    ) -> Result<FileImported, CoreError> {
        let notebook = match &plan.notebook {
            Some(nb) => {
                let summary = self.create_notebook(&nb.name, target.id)?;
                if let Some(c) = &nb.color {
                    self.set_notebook_color(&summary.id, Some(c))?;
                }
                summary.id
            }
            None => {
                let nb = target.notebook.ok_or_else(|| {
                    CoreError::BadRequest("this import needs a target notebook".into())
                })?;
                self.nb(nb)?;
                nb.to_string()
            }
        };
        let mut nodes = Vec::new();
        let mut created = Vec::new();
        if let Some(page) = plan.page.take() {
            let parent = target.parent.ok_or_else(|| {
                CoreError::BadRequest("a page import needs a parent section or page".into())
            })?;
            let new = self.create_page(&notebook, parent, None, &page.title)?;
            let now = self.now;
            self.load_page(&notebook, &new.doc_id)?
                .import_blocks(&page.blocks, now)?;
            self.after_page_change(&notebook, &new.doc_id)?;
            nodes.push(new.node.clone());
            created.push(new);
        }
        if !plan.items.is_empty() {
            let tags = std::mem::take(&mut plan.tags);
            let mut taken: HashSet<String> = self
                .notebooks
                .values()
                .flat_map(|nb| nb.doc.pages())
                .map(|(_, doc, _, _)| doc)
                .collect();
            let parent = if plan.notebook.is_some() {
                None
            } else {
                target.parent
            };
            let items = std::mem::take(&mut plan.items);
            let (planned, top, tag_ids) = self.edit(&notebook, |d, now| {
                let mut tag_ids = BTreeMap::new();
                for t in &tags {
                    let existing = d.tags().into_iter().find(|x| {
                        matches!(x.kind, TagKind::Custom | TagKind::CustomToDo)
                            && x.label == t.label
                    });
                    let id = match existing {
                        Some(x) => x.id,
                        None => {
                            let kind = if t.todo {
                                TagKind::CustomToDo
                            } else {
                                TagKind::Custom
                            };
                            d.add_tag(&t.label, None, None, kind)?
                        }
                    };
                    tag_ids.insert(t.placeholder.clone(), id);
                }
                let mut planned = Vec::new();
                let mut top = Vec::new();
                build_items(d, parent, &items, now, &mut taken, &mut planned, &mut top)?;
                let planned: Vec<(String, String, PlanPage)> = planned
                    .into_iter()
                    .map(|p| (p.node, p.doc, p.page.clone()))
                    .collect();
                Ok((planned, top, tag_ids))
            })?;
            for (node, doc, mut page) in planned {
                rewrite_tags(&mut page.blocks, &tag_ids);
                self.fill_page(&notebook, &doc, &page)?;
                created.push(NewPage { node, doc_id: doc });
            }
            nodes.extend(top);
        }
        self.queue_blobs(&notebook, blobs);
        self.reindex_notebook(&notebook);
        Ok(FileImported {
            notebook: self.summary(&notebook)?,
            tree: self.tree(&notebook)?,
            nodes,
            pages: created,
            warnings: plan.warnings,
        })
    }

    /// Page doc id → tree title across open notebooks.
    fn page_titles(&self) -> BTreeMap<String, String> {
        self.notebooks
            .values()
            .flat_map(|nb| nb.doc.pages())
            .map(|(_, doc, title, _)| (doc, title))
            .collect()
    }

    fn export_source(
        &self,
        notebook: &str,
        section: bool,
        title: String,
        pages: Vec<ExportSourcePage>,
    ) -> Result<ExportSource, CoreError> {
        let mut blobs = Vec::new();
        for p in &pages {
            blob_refs(&p.doc, &mut blobs);
        }
        Ok(ExportSource {
            section,
            title,
            pages,
            titles: self.page_titles(),
            tags: self.nb(notebook)?.doc.tags(),
            blobs,
        })
    }

    /// One page for the exporters (its tree title and content).
    pub fn page_export_source(&mut self, doc: &str) -> Result<ExportSource, CoreError> {
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
        let title = tree_title.unwrap_or_else(|| page.title());
        let p = ExportSourcePage {
            title: title.clone(),
            doc: page.to_pm_json(),
            level: 0,
        };
        self.export_source(&notebook, false, title, vec![p])
    }

    /// A section's pages (sub-pages included, in tree order) for the exporters. A page node works too: the page
    /// and its sub-pages.
    pub fn section_export_source(
        &mut self,
        notebook: &str,
        section: &str,
    ) -> Result<ExportSource, CoreError> {
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
            pages.push(ExportSourcePage {
                title,
                doc: pm,
                level,
            });
        }
        if pages.is_empty() {
            pages.push(ExportSourcePage {
                title: node.title.clone(),
                doc: json!({ "type": "doc", "content": [] }),
                level: 0,
            });
        }
        self.export_source(notebook, true, node.title.clone(), pages)
    }
}

/// The one-step commands (the converters in this process: Tauri, tests).
#[cfg(feature = "convert")]
impl NotesHost {
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
        if !bytes.starts_with(b"MSCF") {
            let nb = notebook.ok_or_else(|| {
                CoreError::BadRequest("a OneNote section (.one) needs a target notebook".into())
            })?;
            self.nb(nb)?;
        }
        let (plan, blobs) = crate::plan::convert::build_import(
            crate::plan::ImportKind::OneNote,
            file_name,
            bytes,
            &ImportContextData::default(),
            random_u64(),
        )?;
        let target = ImportTarget {
            notebook,
            parent,
            id,
        };
        self.apply_import(&target, plan, blobs.into_iter().map(|b| b.bytes).collect())
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
        use crate::plan::ImportKind as K;
        let ctx = self.import_context(notebook)?;
        let kind = match format {
            PageFormat::Markdown => K::Markdown,
            PageFormat::Html => K::Html,
            PageFormat::Docx => K::Docx,
        };
        let (plan, blobs) = crate::plan::convert::build_import(kind, file_name, bytes, &ctx, 0)?;
        let target = ImportTarget {
            notebook: Some(notebook),
            parent: Some(parent),
            id: None,
        };
        self.apply_import(&target, plan, blobs.into_iter().map(|b| b.bytes).collect())
    }

    /// The editor's paste path: sanitised HTML → a ProseMirror `doc` (images stored as blobs of `notebook`).
    pub fn paste_html(
        &mut self,
        notebook: &str,
        html_text: &str,
    ) -> Result<(serde_json::Value, Vec<ConvertWarning>), CoreError> {
        let ctx = self.import_context(notebook)?;
        let (doc, warnings, blobs) = crate::plan::convert::paste_html(html_text, &ctx);
        self.queue_blobs(notebook, blobs.into_iter().map(|b| b.bytes).collect());
        Ok((doc, warnings))
    }

    /// One page as Markdown, HTML or `.docx` bytes; `blobs` holds the bytes of the images/attachments it uses.
    pub fn export_page(
        &mut self,
        doc: &str,
        format: ExportFormat,
        blobs: &HashMap<String, Vec<u8>>,
    ) -> Result<Vec<u8>, CoreError> {
        let src = self.page_export_source(doc)?;
        crate::plan::convert::run_export(&src, format, blobs)
    }

    /// A section's pages (sub-pages included, in tree order): Markdown zip, one HTML file or one `.docx`.
    pub fn export_section(
        &mut self,
        notebook: &str,
        section: &str,
        format: ExportFormat,
        blobs: &HashMap<String, Vec<u8>>,
    ) -> Result<Vec<u8>, CoreError> {
        let src = self.section_export_source(notebook, section)?;
        crate::plan::convert::run_export(&src, format, blobs)
    }
}
