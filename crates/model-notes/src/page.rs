//! The page document: content (`"doc"`, loro-prosemirror layout), `"meta"`, `"canvas"`, `"ink"`.
use loro::{
    CommitOptions, ExpandType, ExportMode, LoroDoc, LoroList, LoroMap, LoroText, StyleConfig,
    StyleConfigMap,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::content::{self, PageIndexData, PmNode, MARK_STYLES};
use crate::util::{as_list, commit_at, get_bool, get_i64, get_str};
use crate::{BlockTag, NotesError, OutlineEntry, TaskItem};

/// The fixed peer id of the page genesis. No real peer may use it.
pub const GENESIS_PEER: u64 = 0;

const DOC: &str = "doc";
const META: &str = "meta";

/// The genesis of every page document (spike rule b): the root structure `loro-prosemirror` expects plus one
/// empty paragraph with its (empty) text container, written by peer [`GENESIS_PEER`] at timestamp 0. Identical
/// bytes on every peer, so independently created copies of a page merge instead of one root winning.
#[must_use]
pub fn page_genesis() -> Vec<u8> {
    let g = LoroDoc::new();
    // Peer 0 and fixed content: the ops (and so their ids) are the same on every peer.
    let _ = g.set_peer_id(GENESIS_PEER);
    let build = || -> Result<(), loro::LoroError> {
        let root = g.get_map(DOC);
        root.insert("nodeName", "doc")?;
        root.insert_container("attributes", LoroMap::new())?;
        let children = root.insert_container("children", LoroList::new())?;
        let p = children.insert_container(0, LoroMap::new())?;
        p.insert("nodeName", "paragraph")?;
        p.insert_container("attributes", LoroMap::new())?;
        let pc = p.insert_container("children", LoroList::new())?;
        pc.insert_container(0, LoroText::new())?;
        Ok(())
    };
    let _ = build();
    g.commit_with(CommitOptions::new().timestamp(0));
    g.export(ExportMode::all_updates()).unwrap_or_default()
}

/// The `"meta"` map of a page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub title: String,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub created: i64,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub modified: i64,
    /// The page is a freeform canvas page.
    pub canvas: bool,
}

/// A page document.
#[derive(Debug)]
pub struct PageDoc {
    doc: LoroDoc,
}

impl PageDoc {
    /// A new page: genesis + metadata (title, created, modified) by this peer.
    #[must_use]
    pub fn create(title: Option<&str>, now: i64) -> Self {
        Self::create_in(LoroDoc::new(), title, now)
    }

    /// Like [`PageDoc::create`], in a given (empty) document – e.g. one whose peer id is already set.
    #[must_use]
    pub fn create_in(doc: LoroDoc, title: Option<&str>, now: i64) -> Self {
        let _ = doc.import(&page_genesis());
        let page = Self::from_doc(doc);
        let meta = page.doc.get_map(META);
        if let Some(t) = title {
            let _ = meta.insert("title", t);
        }
        let _ = meta.insert("created", now);
        let _ = meta.insert("modified", now);
        commit_at(&page.doc, now);
        page
    }

    /// Wraps a Loro document (configures the text styles as the editor's binding does).
    #[must_use]
    pub fn from_doc(doc: LoroDoc) -> Self {
        let mut styles = StyleConfigMap::new();
        for (name, inclusive) in MARK_STYLES {
            styles.insert(
                (*name).into(),
                StyleConfig {
                    expand: if *inclusive {
                        ExpandType::After
                    } else {
                        ExpandType::None
                    },
                },
            );
        }
        doc.config_text_style(styles);
        doc.config_default_text_style(Some(StyleConfig {
            expand: ExpandType::After,
        }));
        Self { doc }
    }

    /// Loads from a snapshot (may be empty) and update records. A page with neither starts as the genesis.
    pub fn from_bytes(snapshot: &[u8], updates: &[Vec<u8>]) -> Result<Self, NotesError> {
        let doc = LoroDoc::new();
        if !snapshot.is_empty() {
            doc.import(snapshot)?;
        }
        if !updates.is_empty() {
            doc.import_batch(updates)?;
        }
        if snapshot.is_empty() && updates.is_empty() {
            doc.import(&page_genesis())?;
        }
        Ok(Self::from_doc(doc))
    }

    #[must_use]
    pub fn doc(&self) -> &LoroDoc {
        &self.doc
    }

    #[must_use]
    pub fn into_doc(self) -> LoroDoc {
        self.doc
    }

    // ---- meta ---------------------------------------------------------------------------------------------

    #[must_use]
    pub fn meta(&self) -> PageMeta {
        let m = self.doc.get_map(META);
        PageMeta {
            title: get_str(&m, "title").unwrap_or_default(),
            created: get_i64(&m, "created").unwrap_or(0),
            modified: get_i64(&m, "modified").unwrap_or(0),
            canvas: get_bool(&m, "canvas").unwrap_or(false),
        }
    }

    /// The page title from `meta.title` (the notebook tree's title is authoritative for navigation; the core
    /// keeps both equal).
    #[must_use]
    pub fn title(&self) -> String {
        self.meta().title
    }

    pub fn set_title(&self, title: &str, now: i64) -> Result<(), NotesError> {
        let m = self.doc.get_map(META);
        m.insert("title", title)?;
        m.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    #[must_use]
    pub fn is_canvas(&self) -> bool {
        self.meta().canvas
    }

    pub fn set_canvas(&self, canvas: bool, now: i64) -> Result<(), NotesError> {
        let m = self.doc.get_map(META);
        m.insert("canvas", canvas)?;
        m.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    // ---- content ------------------------------------------------------------------------------------------

    /// The content tree (an empty `doc` when the page has no content yet).
    #[must_use]
    pub fn content(&self) -> PmNode {
        let root = self.doc.get_map(DOC);
        if root.is_empty() {
            return PmNode::Element {
                name: "doc".into(),
                attrs: Default::default(),
                children: Vec::new(),
            };
        }
        PmNode::read(&root)
    }

    /// The content as ProseMirror JSON.
    #[must_use]
    pub fn to_pm_json(&self) -> Value {
        self.content().to_json()
    }

    /// Appends top-level blocks given as ProseMirror JSON (importers, tests, restore helpers).
    pub fn append_blocks(&self, blocks: &[Value]) -> Result<(), NotesError> {
        let root = self.doc.get_map(DOC);
        let children = as_list(root.get("children"))
            .ok_or_else(|| NotesError::Content("page has no genesis".into()))?;
        content::write_children(&children, children.len(), blocks)?;
        self.doc.commit();
        Ok(())
    }

    /// Fills a page from an importer: appends `blocks` and, when the page held nothing but the genesis' empty
    /// paragraph, removes that paragraph (an imported page should not start with a blank line). With no blocks
    /// the genesis paragraph stays.
    pub fn import_blocks(&self, blocks: &[Value], now: i64) -> Result<(), NotesError> {
        if blocks.is_empty() {
            return Ok(());
        }
        let root = self.doc.get_map(DOC);
        let children = as_list(root.get("children"))
            .ok_or_else(|| NotesError::Content("page has no genesis".into()))?;
        let only_empty_genesis = children.len() == 1 && {
            let c = self.content();
            c.children().len() == 1
                && c.children()[0].name() == content::names::PARAGRAPH
                && c.children()[0].children().is_empty()
        };
        content::write_children(&children, children.len(), blocks)?;
        if only_empty_genesis {
            children.delete(0, 1)?;
        }
        self.doc.get_map(META).insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    /// Sets `meta.created` / `meta.modified` (Unix ms), e.g. to the times of an imported page.
    pub fn set_times(&self, created: i64, modified: i64) -> Result<(), NotesError> {
        let m = self.doc.get_map(META);
        m.insert("created", created)?;
        m.insert("modified", modified)?;
        self.doc.commit();
        Ok(())
    }

    /// Everything the search/tasks/backlinks index needs, in one pass.
    #[must_use]
    pub fn index_data(&self) -> PageIndexData {
        let mut d = content::index(&self.content());
        let mut blobs: std::collections::BTreeSet<String> = d.blobs.into_iter().collect();
        blobs.extend(self.canvas_items().into_iter().filter_map(|i| i.blob));
        d.blobs = blobs.into_iter().collect();
        d
    }

    /// Plain text: one line per non-empty text block.
    #[must_use]
    pub fn plain_text(&self) -> String {
        self.content().text()
    }

    #[must_use]
    pub fn outline(&self) -> Vec<OutlineEntry> {
        self.index_data().outline
    }

    /// Ids of linked pages (`pageLink` nodes and marks, attr `pageId`), deduplicated in document order.
    #[must_use]
    pub fn links(&self) -> Vec<String> {
        self.index_data().links
    }

    /// Blob ids (attr `blob` of any node, canvas images), sorted.
    #[must_use]
    pub fn blobs(&self) -> Vec<String> {
        self.index_data().blobs
    }

    #[must_use]
    pub fn block_tags(&self) -> Vec<BlockTag> {
        self.index_data().block_tags
    }

    /// To-dos: `taskItem`s and blocks tagged with one of `todo_tags`.
    #[must_use]
    pub fn tasks(&self, todo_tags: &[String]) -> Vec<TaskItem> {
        self.index_data().tasks(todo_tags)
    }
}
