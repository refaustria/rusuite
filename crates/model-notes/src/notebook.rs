//! The notebook document: hierarchy (`LoroTree "tree"`), notebook map, tags and peers.
use loro::{ExportMode, LoroDoc, LoroMap, LoroTree, LoroValue, TreeID, TreeParentId, UndoManager};
use serde::{Deserialize, Serialize};

use crate::tags::{TagDef, TagKind, BUILTIN_TAGS};
use crate::util::{as_map, commit_at, get_i64, get_str, value};
use crate::{NotesError, FORMAT_VERSION};

/// Soft-deleted nodes stay in the recycle bin for 60 days ([`NotebookDoc::purge_expired`]).
pub const RECYCLE_BIN_MS: i64 = 60 * 24 * 60 * 60 * 1000;

const TREE: &str = "tree";
const NOTEBOOK: &str = "notebook";
const TAGS: &str = "tags";
const PEERS: &str = "peers";

/// What a tree node is. Pages live in sections or under pages (sub-pages); sections and section groups live at
/// the root or in groups.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Group,
    Section,
    Page,
}

impl NodeKind {
    fn as_str(self) -> &'static str {
        match self {
            NodeKind::Group => "group",
            NodeKind::Section => "section",
            NodeKind::Page => "page",
        }
    }
    fn parse(s: &str) -> Option<NodeKind> {
        Some(match s {
            "group" => NodeKind::Group,
            "section" => NodeKind::Section,
            "page" => NodeKind::Page,
            _ => return None,
        })
    }
    fn allowed_under(self, parent: Option<NodeKind>) -> bool {
        match self {
            NodeKind::Page => matches!(parent, Some(NodeKind::Section | NodeKind::Page)),
            NodeKind::Section | NodeKind::Group => matches!(parent, None | Some(NodeKind::Group)),
        }
    }
}

/// One node of the hierarchy as the UI sees it (children in order). Ids are Loro tree ids (`"counter@peer"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: String,
    /// `None` for root nodes.
    pub parent: Option<String>,
    pub kind: NodeKind,
    pub title: String,
    /// Section colour (`#RRGGBB`), if set.
    pub color: Option<String>,
    /// Pages: the id of the page document.
    pub page_doc: Option<String>,
    /// Unix ms.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub created: i64,
    /// Unix ms.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub modified: i64,
    pub children: Vec<TreeNode>,
}

/// A recycle-bin entry: a node with its own deletion mark, with its subtree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct DeletedNode {
    pub node: TreeNode,
    /// When it was deleted (Unix ms); it is purged 60 days later.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub deleted: i64,
    /// An ancestor is deleted too: restoring this node alone needs a target (`restore_to`).
    pub parent_deleted: bool,
}

/// The `"notebook"` map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct NotebookInfo {
    pub name: String,
    pub color: Option<String>,
    pub format_version: u32,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub created: i64,
}

/// A page created by [`NotebookDoc::create_page`]: its tree node and the id of its page document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct NewPage {
    pub node: String,
    pub doc_id: String,
}

/// A notebook document.
#[derive(Debug)]
pub struct NotebookDoc {
    doc: LoroDoc,
}

impl NotebookDoc {
    /// A new notebook named `name` with the built-in tags.
    #[must_use]
    pub fn new(name: &str, now: i64) -> Self {
        Self::create_in(LoroDoc::new(), name, now)
    }

    /// Like [`NotebookDoc::new`], in a given (empty) document – e.g. one whose peer id is already set.
    #[must_use]
    pub fn create_in(doc: LoroDoc, name: &str, now: i64) -> Self {
        let nb = Self::from_doc(doc);
        let map = nb.doc.get_map(NOTEBOOK);
        // Infallible on an attached root map with plain values.
        let _ = map.insert("name", name);
        let _ = map.insert("formatVersion", i64::from(FORMAT_VERSION));
        let _ = map.insert("created", now);
        let tags = nb.doc.get_list(TAGS);
        for (id, kind, icon) in BUILTIN_TAGS {
            if let Ok(t) = tags.push_container(LoroMap::new()) {
                let _ = t.insert("id", *id);
                let _ = t.insert("kind", kind.as_str());
                let _ = t.insert("label", "");
                let _ = t.insert("icon", *icon);
            }
        }
        commit_at(&nb.doc, now);
        nb
    }

    /// Wraps an existing Loro document (configures the tree's fractional index, which is local state).
    #[must_use]
    pub fn from_doc(doc: LoroDoc) -> Self {
        doc.get_tree(TREE).enable_fractional_index(0);
        Self { doc }
    }

    /// Loads a notebook from a snapshot (may be empty) and update records (`docs/notes-format.md`).
    pub fn from_bytes(snapshot: &[u8], updates: &[Vec<u8>]) -> Result<Self, NotesError> {
        let doc = LoroDoc::new();
        if !snapshot.is_empty() {
            doc.import(snapshot)?;
        }
        if !updates.is_empty() {
            doc.import_batch(updates)?;
        }
        Ok(Self::from_doc(doc))
    }

    #[must_use]
    pub fn doc(&self) -> &LoroDoc {
        &self.doc
    }

    /// A full-history snapshot.
    pub fn snapshot(&self) -> Result<Vec<u8>, NotesError> {
        Ok(self.doc.export(ExportMode::Snapshot)?)
    }

    /// An undo manager for structural undo of this peer's own changes (never undoes others' edits).
    #[must_use]
    pub fn undo_manager(&self) -> UndoManager {
        let mut u = UndoManager::new(&self.doc);
        u.set_merge_interval(0);
        u
    }

    fn tree_c(&self) -> LoroTree {
        self.doc.get_tree(TREE)
    }

    #[must_use]
    pub fn info(&self) -> NotebookInfo {
        let m = self.doc.get_map(NOTEBOOK);
        NotebookInfo {
            name: get_str(&m, "name").unwrap_or_default(),
            color: get_str(&m, "color"),
            format_version: get_i64(&m, "formatVersion")
                .and_then(|v| u32::try_from(v).ok())
                .unwrap_or(FORMAT_VERSION),
            created: get_i64(&m, "created").unwrap_or(0),
        }
    }

    pub fn rename_notebook(&self, name: &str, now: i64) -> Result<(), NotesError> {
        self.doc.get_map(NOTEBOOK).insert("name", name)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    pub fn set_notebook_color(&self, color: Option<&str>, now: i64) -> Result<(), NotesError> {
        let m = self.doc.get_map(NOTEBOOK);
        match color {
            Some(c) => m.insert("color", c)?,
            None => m.delete("color")?,
        }
        commit_at(&self.doc, now);
        Ok(())
    }

    // ---- nodes --------------------------------------------------------------------------------------------

    fn parse_id(&self, id: &str) -> Result<TreeID, NotesError> {
        let t = TreeID::try_from(id).map_err(|_| NotesError::UnknownNode(id.to_string()))?;
        let tree = self.tree_c();
        if !tree.contains(t) || tree.is_node_deleted(&t).unwrap_or(true) {
            return Err(NotesError::UnknownNode(id.to_string()));
        }
        Ok(t)
    }

    fn meta(&self, id: TreeID) -> Result<LoroMap, NotesError> {
        Ok(self.tree_c().get_meta(id)?)
    }

    fn kind_of(&self, id: TreeID) -> Option<NodeKind> {
        self.meta(id)
            .ok()
            .and_then(|m| get_str(&m, "kind"))
            .and_then(|k| NodeKind::parse(&k))
    }

    fn own_deleted(&self, id: TreeID) -> Option<i64> {
        self.meta(id).ok().and_then(|m| get_i64(&m, "deleted"))
    }

    fn parent_of(&self, id: TreeID) -> Option<TreeID> {
        match self.tree_c().parent(id) {
            Some(TreeParentId::Node(p)) => Some(p),
            _ => None,
        }
    }

    fn ancestor_deleted(&self, id: TreeID) -> bool {
        let mut cur = self.parent_of(id);
        while let Some(p) = cur {
            if self.own_deleted(p).is_some() {
                return true;
            }
            cur = self.parent_of(p);
        }
        false
    }

    fn children_of(&self, parent: Option<TreeID>) -> Vec<TreeID> {
        let tree = self.tree_c();
        let p = parent.map_or(TreeParentId::Root, TreeParentId::Node);
        tree.children(p).unwrap_or_default()
    }

    fn check_parent(&self, kind: NodeKind, parent: Option<TreeID>) -> Result<(), NotesError> {
        let pk = match parent {
            None => None,
            Some(p) => Some(
                self.kind_of(p)
                    .ok_or_else(|| NotesError::UnknownNode(p.to_string()))?,
            ),
        };
        if kind.allowed_under(pk) {
            Ok(())
        } else {
            Err(NotesError::InvalidParent {
                child: kind.as_str(),
                parent: pk.map_or("the notebook root", NodeKind::as_str).to_string(),
            })
        }
    }

    /// Maps an index among the visible (not soft-deleted) children of `parent` – without `exclude` – to a Loro
    /// child index (also without `exclude`, which is what `mov_to` expects).
    fn loro_index(
        &self,
        parent: Option<TreeID>,
        visible: Option<usize>,
        exclude: Option<TreeID>,
    ) -> usize {
        let all: Vec<TreeID> = self
            .children_of(parent)
            .into_iter()
            .filter(|c| Some(*c) != exclude)
            .collect();
        let Some(k) = visible else { return all.len() };
        all.iter()
            .enumerate()
            .filter(|(_, c)| self.own_deleted(**c).is_none())
            .nth(k)
            .map_or(all.len(), |(i, _)| i)
    }

    fn create_node(
        &self,
        kind: NodeKind,
        parent: Option<&str>,
        index: Option<usize>,
        title: &str,
        now: i64,
    ) -> Result<(TreeID, LoroMap), NotesError> {
        let parent = parent.map(|p| self.parse_id(p)).transpose()?;
        self.check_parent(kind, parent)?;
        let at = self.loro_index(parent, index, None);
        let tree = self.tree_c();
        let id = tree.create_at(parent.map_or(TreeParentId::Root, TreeParentId::Node), at)?;
        let meta = tree.get_meta(id)?;
        meta.insert("kind", kind.as_str())?;
        meta.insert("title", title)?;
        meta.insert("created", now)?;
        meta.insert("modified", now)?;
        Ok((id, meta))
    }

    /// A new section group under the root (`parent = None`) or a group, at a visible `index` (`None` = last).
    pub fn create_group(
        &self,
        parent: Option<&str>,
        index: Option<usize>,
        title: &str,
        now: i64,
    ) -> Result<String, NotesError> {
        let (id, _) = self.create_node(NodeKind::Group, parent, index, title, now)?;
        commit_at(&self.doc, now);
        Ok(id.to_string())
    }

    /// A new section under the root or a group.
    pub fn create_section(
        &self,
        parent: Option<&str>,
        index: Option<usize>,
        title: &str,
        now: i64,
    ) -> Result<String, NotesError> {
        let (id, _) = self.create_node(NodeKind::Section, parent, index, title, now)?;
        commit_at(&self.doc, now);
        Ok(id.to_string())
    }

    /// A new page in a section (or a sub-page under a page). The page document id is derived from the tree id
    /// (unique within this notebook); hosts with several notebooks use [`NotebookDoc::create_page_with_doc`]
    /// with a globally unique id. Its content starts from [`crate::page_genesis`].
    pub fn create_page(
        &self,
        parent: &str,
        index: Option<usize>,
        title: &str,
        now: i64,
    ) -> Result<NewPage, NotesError> {
        self.create_page_inner(parent, index, title, None, now)
    }

    /// A new page whose document id is `doc_id`.
    pub fn create_page_with_doc(
        &self,
        parent: &str,
        index: Option<usize>,
        title: &str,
        doc_id: &str,
        now: i64,
    ) -> Result<NewPage, NotesError> {
        self.create_page_inner(parent, index, title, Some(doc_id), now)
    }

    fn create_page_inner(
        &self,
        parent: &str,
        index: Option<usize>,
        title: &str,
        doc_id: Option<&str>,
        now: i64,
    ) -> Result<NewPage, NotesError> {
        let (id, meta) = self.create_node(NodeKind::Page, Some(parent), index, title, now)?;
        let doc_id = doc_id.map_or_else(
            || format!("pg-{:x}-{}", id.peer, id.counter),
            str::to_string,
        );
        meta.insert("pageDoc", doc_id.as_str())?;
        commit_at(&self.doc, now);
        Ok(NewPage {
            node: id.to_string(),
            doc_id,
        })
    }

    /// Moves a node to `parent` (`None` = root) at a visible `index` among its new siblings.
    pub fn move_node(
        &self,
        id: &str,
        parent: Option<&str>,
        index: usize,
        now: i64,
    ) -> Result<(), NotesError> {
        let node = self.parse_id(id)?;
        let parent = parent.map(|p| self.parse_id(p)).transpose()?;
        let kind = self
            .kind_of(node)
            .ok_or_else(|| NotesError::UnknownNode(id.to_string()))?;
        let mut cur = parent;
        while let Some(p) = cur {
            if p == node {
                return Err(NotesError::Cycle);
            }
            cur = self.parent_of(p);
        }
        self.check_parent(kind, parent)?;
        let at = self.loro_index(parent, Some(index), Some(node));
        self.tree_c().mov_to(
            node,
            parent.map_or(TreeParentId::Root, TreeParentId::Node),
            at,
        )?;
        self.meta(node)?.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    pub fn rename(&self, id: &str, title: &str, now: i64) -> Result<(), NotesError> {
        let meta = self.meta(self.parse_id(id)?)?;
        meta.insert("title", title)?;
        meta.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    /// Sets or clears the colour (`#RRGGBB`) of a node (sections; groups and pages accept it too).
    pub fn set_color(&self, id: &str, color: Option<&str>, now: i64) -> Result<(), NotesError> {
        let meta = self.meta(self.parse_id(id)?)?;
        match color {
            Some(c) => meta.insert("color", c)?,
            None => meta.delete("color")?,
        }
        meta.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    /// Soft delete: the node and its subtree go to the recycle bin (restorable for [`RECYCLE_BIN_MS`]).
    pub fn delete(&self, id: &str, now: i64) -> Result<(), NotesError> {
        let meta = self.meta(self.parse_id(id)?)?;
        meta.insert("deleted", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    /// Takes a node out of the recycle bin to where it was.
    pub fn restore(&self, id: &str, now: i64) -> Result<(), NotesError> {
        let node = self.parse_id(id)?;
        if self.own_deleted(node).is_none() {
            return Err(NotesError::NotDeleted(id.to_string()));
        }
        if self.ancestor_deleted(node) {
            return Err(NotesError::ParentDeleted(id.to_string()));
        }
        let meta = self.meta(node)?;
        meta.delete("deleted")?;
        meta.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    /// Restores a node into another (live) parent, as its last child.
    pub fn restore_to(&self, id: &str, parent: &str, now: i64) -> Result<(), NotesError> {
        let node = self.parse_id(id)?;
        if self.own_deleted(node).is_none() {
            return Err(NotesError::NotDeleted(id.to_string()));
        }
        let p = self.parse_id(parent)?;
        if self.own_deleted(p).is_some() || self.ancestor_deleted(p) {
            return Err(NotesError::ParentDeleted(parent.to_string()));
        }
        let kind = self
            .kind_of(node)
            .ok_or_else(|| NotesError::UnknownNode(id.to_string()))?;
        self.check_parent(kind, Some(p))?;
        let at = self.loro_index(Some(p), None, Some(node));
        self.tree_c().mov_to(node, TreeParentId::Node(p), at)?;
        let meta = self.meta(node)?;
        meta.delete("deleted")?;
        meta.insert("modified", now)?;
        commit_at(&self.doc, now);
        Ok(())
    }

    /// Permanently removes nodes that have been in the recycle bin for [`RECYCLE_BIN_MS`] or longer. Returns the
    /// page document ids of every removed page (the caller drops their storage).
    pub fn purge_expired(&self, now: i64) -> Result<Vec<String>, NotesError> {
        let mut expired = Vec::new();
        self.walk(None, &mut |id| {
            if self
                .own_deleted(id)
                .is_some_and(|d| d + RECYCLE_BIN_MS <= now)
            {
                expired.push(id);
                false
            } else {
                true
            }
        });
        if expired.is_empty() {
            return Ok(Vec::new());
        }
        let mut docs = Vec::new();
        for id in &expired {
            self.walk(Some(*id), &mut |c| {
                docs.extend(self.page_doc_of(c));
                true
            });
            docs.extend(self.page_doc_of(*id));
        }
        let tree = self.tree_c();
        for id in expired {
            tree.delete(id)?;
        }
        commit_at(&self.doc, now);
        Ok(docs)
    }

    fn page_doc_of(&self, id: TreeID) -> Option<String> {
        self.meta(id).ok().and_then(|m| get_str(&m, "pageDoc"))
    }

    /// Visits the descendants of `parent` (pre-order); `f` returns whether to descend into a node.
    fn walk(&self, parent: Option<TreeID>, f: &mut dyn FnMut(TreeID) -> bool) {
        for c in self.children_of(parent) {
            if f(c) {
                self.walk(Some(c), f);
            }
        }
    }

    fn node(&self, id: TreeID, with_flagged_children: bool) -> TreeNode {
        let meta = self.meta(id).ok();
        let get = |k: &str| meta.as_ref().and_then(|m| get_str(m, k));
        let geti = |k: &str| meta.as_ref().and_then(|m| get_i64(m, k)).unwrap_or(0);
        TreeNode {
            id: id.to_string(),
            parent: self.parent_of(id).map(|p| p.to_string()),
            kind: get("kind")
                .and_then(|k| NodeKind::parse(&k))
                .unwrap_or(NodeKind::Page),
            title: get("title").unwrap_or_default(),
            color: get("color"),
            page_doc: get("pageDoc"),
            created: geti("created"),
            modified: geti("modified"),
            children: self
                .children_of(Some(id))
                .into_iter()
                .filter(|c| with_flagged_children || self.own_deleted(*c).is_none())
                .map(|c| self.node(c, with_flagged_children))
                .collect(),
        }
    }

    /// The live hierarchy (soft-deleted nodes and their subtrees left out), in order.
    #[must_use]
    pub fn tree(&self) -> Vec<TreeNode> {
        self.children_of(None)
            .into_iter()
            .filter(|c| self.own_deleted(*c).is_none())
            .map(|c| self.node(c, false))
            .collect()
    }

    /// One live node (with its live subtree).
    pub fn get_node(&self, id: &str) -> Result<TreeNode, NotesError> {
        Ok(self.node(self.parse_id(id)?, false))
    }

    /// Whether the node or one of its ancestors is soft-deleted.
    pub fn is_deleted(&self, id: &str) -> Result<bool, NotesError> {
        let n = self.parse_id(id)?;
        Ok(self.own_deleted(n).is_some() || self.ancestor_deleted(n))
    }

    /// The recycle bin: every node with its own deletion mark (most recent first), each with its subtree minus
    /// children that carry their own mark (they are entries of their own).
    #[must_use]
    pub fn recycle_bin(&self) -> Vec<DeletedNode> {
        let mut out = Vec::new();
        self.walk(None, &mut |id| {
            if let Some(d) = self.own_deleted(id) {
                out.push(DeletedNode {
                    node: self.node(id, false),
                    deleted: d,
                    parent_deleted: self.ancestor_deleted(id),
                });
            }
            true
        });
        out.sort_by_key(|e| std::cmp::Reverse(e.deleted));
        out
    }

    /// The page document ids of every page that still exists (live or in the recycle bin), in tree order.
    #[must_use]
    pub fn page_doc_ids(&self) -> Vec<String> {
        let mut out = Vec::new();
        self.walk(None, &mut |id| {
            out.extend(self.page_doc_of(id));
            true
        });
        out
    }

    /// Every page (live or deleted) as (tree node id, page doc id, title, deleted-or-under-deleted).
    #[must_use]
    pub fn pages(&self) -> Vec<(String, String, String, bool)> {
        let mut out = Vec::new();
        self.walk_with_deleted(None, false, &mut |id, deleted| {
            if let Some(doc) = self.page_doc_of(id) {
                let title = self
                    .meta(id)
                    .ok()
                    .and_then(|m| get_str(&m, "title"))
                    .unwrap_or_default();
                out.push((id.to_string(), doc, title, deleted));
            }
        });
        out
    }

    fn walk_with_deleted(
        &self,
        parent: Option<TreeID>,
        deleted: bool,
        f: &mut dyn FnMut(TreeID, bool),
    ) {
        for c in self.children_of(parent) {
            let d = deleted || self.own_deleted(c).is_some();
            f(c, d);
            self.walk_with_deleted(Some(c), d, f);
        }
    }

    /// The tree node of the page whose document is `doc_id`.
    #[must_use]
    pub fn node_of_page_doc(&self, doc_id: &str) -> Option<String> {
        let mut found = None;
        self.walk(None, &mut |id| {
            if found.is_none() && self.page_doc_of(id).as_deref() == Some(doc_id) {
                found = Some(id.to_string());
            }
            found.is_none()
        });
        found
    }

    // ---- tags ---------------------------------------------------------------------------------------------

    #[must_use]
    pub fn tags(&self) -> Vec<TagDef> {
        let list = self.doc.get_list(TAGS);
        let mut out = Vec::new();
        for i in 0..list.len() {
            if let Some(m) = as_map(list.get(i)) {
                out.push(TagDef {
                    id: get_str(&m, "id").unwrap_or_default(),
                    kind: TagKind::parse(&get_str(&m, "kind").unwrap_or_default()),
                    label: get_str(&m, "label").unwrap_or_default(),
                    icon: get_str(&m, "icon"),
                    color: get_str(&m, "color"),
                });
            }
        }
        out
    }

    /// Adds a custom tag definition and returns its id (unique: derived from the next op id).
    pub fn add_tag(
        &self,
        label: &str,
        icon: Option<&str>,
        color: Option<&str>,
        kind: TagKind,
    ) -> Result<String, NotesError> {
        self.doc.commit();
        let peer = self.doc.peer_id();
        let counter = self.doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        let id = format!("t-{peer:x}-{counter}");
        let m = self.doc.get_list(TAGS).push_container(LoroMap::new())?;
        m.insert("id", id.as_str())?;
        m.insert("kind", kind.as_str())?;
        m.insert("label", label)?;
        if let Some(i) = icon {
            m.insert("icon", i)?;
        }
        if let Some(c) = color {
            m.insert("color", c)?;
        }
        self.doc.commit();
        Ok(id)
    }

    // ---- peers --------------------------------------------------------------------------------------------

    /// Records that Loro peer `peer` belongs to device `device` (map `"peers"`); no-op when already recorded.
    pub fn register_peer(&self, peer: u64, device: &str) -> Result<bool, NotesError> {
        if self.device_of(peer).as_deref() == Some(device) {
            return Ok(false);
        }
        self.doc.get_map(PEERS).insert(&peer.to_string(), device)?;
        self.doc.commit();
        Ok(true)
    }

    #[must_use]
    pub fn device_of(&self, peer: u64) -> Option<String> {
        match value(self.doc.get_map(PEERS).get(&peer.to_string())) {
            Some(LoroValue::String(s)) => Some(s.to_string()),
            _ => None,
        }
    }
}
