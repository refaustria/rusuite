//! [`NotesHost`]: the open notebooks, lazily loaded page documents, the search index and the effects queue.
use std::collections::{BTreeMap, BTreeSet, HashMap};

use loro::{ExportMode, LoroDoc, UndoManager, VersionVector};
use model_notes::{
    change_groups, frontiers_from_strings, frontiers_to_strings, DeletedNode, NewPage, NotebookDoc,
    NotebookInfo, PageDoc, PageIndexData, TreeNode, HISTORY_MERGE_SECS,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::backup::{Backup, NotebookManifest, StoredDoc};
use crate::effects::{blob_id, is_safe_id, log_record, split_log, LoadWarning, PersistEffect};
use crate::search::{SearchHit, SearchIndex};
use crate::CoreError;

pub mod convert;

/// After this many appended records a document's log is compacted into a new snapshot.
pub const COMPACT_AFTER_APPENDS: u32 = 500;

/// Loro change merge interval for the editor mirror and the core's own docs (seconds). History groups are
/// formed on top of that ([`model_notes::HISTORY_MERGE_SECS`]).
pub const MIRROR_MERGE_INTERVAL_SECS: u32 = 10;

/// A summary of an open notebook.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct NotebookSummary {
    pub id: String,
    pub info: NotebookInfo,
    pub pages: u32,
}

/// What `OpenPage` returns: bind the editor mirror to `docId` with peer id `mirrorPeer`, seeded with
/// `export_updates(docId, empty)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct OpenedPage {
    pub notebook_id: String,
    pub doc_id: String,
    pub node_id: Option<String>,
    pub title: String,
    pub canvas: bool,
    /// Current frontiers (`counter@peer`).
    pub version: Vec<String>,
    /// The peer id (decimal) the editor's mirror `LoroDoc` must use. Never the core's own peer id.
    pub mirror_peer: String,
    /// The mirror must call `setChangeMergeInterval(this)` (seconds) and `setRecordTimestamp(true)`: Loro's
    /// default (1000 s) would merge a quarter hour of typing into one history change.
    pub merge_interval_secs: u32,
}

/// The result of importing update bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct ImportResult {
    pub notebook_id: String,
    pub doc_id: String,
    /// The document's version changed.
    pub changed: bool,
    /// Some changes wait for missing dependencies (they apply once those arrive).
    pub pending: bool,
    pub version: Vec<String>,
}

/// A to-do across notebooks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct TaskEntry {
    pub notebook_id: String,
    pub doc_id: String,
    pub page_title: String,
    pub text: String,
    pub checked: bool,
    /// Top-level block index on the page.
    pub block: u32,
    pub tags: Vec<String>,
    /// Child indices from the page's `doc` node to the node holding `checked` (`path[0] == block`).
    pub path: Vec<u32>,
}

/// Which to-dos `Tasks` returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub enum TaskFilter {
    Open,
    Done,
    All,
}

/// A page reference (backlinks).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct PageRef {
    pub notebook_id: String,
    pub doc_id: String,
    pub node_id: Option<String>,
    pub title: String,
}

/// One entry of a document's history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct HistoryEntry {
    /// Loro peer id (decimal).
    pub peer: String,
    /// The device the peer belongs to, if recorded in the notebook's `"peers"` map.
    pub device_id: Option<String>,
    /// Unix ms.
    #[ts(type = "number")]
    pub start: i64,
    #[ts(type = "number")]
    pub end: i64,
    pub ops: u32,
    pub frontiers: Vec<String>,
}

/// A read-only view of an earlier version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct VersionPreview {
    pub text: String,
    /// ProseMirror JSON of the content at that version.
    #[ts(type = "unknown")]
    pub pm: serde_json::Value,
    pub title: String,
}

enum Slot {
    /// Not materialised: the stored bytes (an unmodified copy of what storage holds).
    Stored {
        snapshot: Vec<u8>,
        updates: Vec<Vec<u8>>,
    },
    Loaded(PageDoc),
}

#[derive(Default)]
struct Persist {
    vv: VersionVector,
    appends: u32,
}

struct Notebook {
    doc: NotebookDoc,
    undo: UndoManager,
    pages: HashMap<String, Slot>,
    persist: HashMap<String, Persist>,
    data: HashMap<String, PageIndexData>,
    stale: BTreeSet<String>,
    registered: BTreeSet<u64>,
}

#[derive(Default)]
struct Pending {
    docs: BTreeMap<String, (Vec<u8>, Vec<Vec<u8>>)>,
}

/// The Notes core state one shell keeps.
pub struct NotesHost {
    device_id: String,
    peer: u64,
    mirror_peer: u64,
    now: i64,
    notebooks: BTreeMap<String, Notebook>,
    pending: HashMap<String, Pending>,
    effects: Vec<PersistEffect>,
    index: SearchIndex,
}

/// A random u64 (Loro draws random peer ids; on wasm via `crypto.getRandomValues`).
fn random_u64() -> u64 {
    loop {
        let p = LoroDoc::new().peer_id();
        if p > 1 {
            return p;
        }
    }
}

/// Makes `doc` this host's: its peer id and the change merge interval.
fn own(doc: &LoroDoc, peer: u64) -> Result<(), CoreError> {
    doc.set_peer_id(peer)?;
    doc.set_change_merge_interval(i64::from(MIRROR_MERGE_INTERVAL_SECS));
    Ok(())
}

fn snapshot_of(doc: &LoroDoc) -> Result<Vec<u8>, CoreError> {
    Ok(doc.export(ExportMode::Snapshot)?)
}

impl NotesHost {
    /// A host for device `device_id` with random peer ids.
    #[must_use]
    pub fn new(device_id: &str) -> Self {
        let peer = random_u64();
        let mut mirror = random_u64();
        while mirror == peer {
            mirror = random_u64();
        }
        Self::with_peers(device_id, peer, mirror)
    }

    /// A host with fixed peer ids (tests). Peer 0 is reserved for page genesis.
    #[must_use]
    pub fn with_peers(device_id: &str, peer: u64, mirror_peer: u64) -> Self {
        Self {
            device_id: device_id.to_string(),
            peer,
            mirror_peer,
            now: 0,
            notebooks: BTreeMap::new(),
            pending: HashMap::new(),
            effects: Vec::new(),
            index: SearchIndex::new(),
        }
    }

    /// The UI's clock (Unix ms); every mutation is stamped with the latest value.
    pub fn set_now(&mut self, now: i64) {
        self.now = now;
    }

    #[must_use]
    pub fn now(&self) -> i64 {
        self.now
    }

    pub fn set_device(&mut self, device_id: &str) {
        self.device_id = device_id.to_string();
    }

    #[must_use]
    pub fn peer(&self) -> u64 {
        self.peer
    }

    #[must_use]
    pub fn mirror_peer(&self) -> u64 {
        self.mirror_peer
    }

    /// Drains the persist effects queued since the last call.
    pub fn take_effects(&mut self) -> Vec<PersistEffect> {
        std::mem::take(&mut self.effects)
    }

    // ---- loading ------------------------------------------------------------------------------------------

    /// Provides a stored document of notebook `notebook` (snapshot may be empty, `log` in `.log` framing). Call
    /// for the notebook doc (`doc == notebook`) and its page docs, then [`NotesHost::open_notebook`]. Page docs
    /// of an already open notebook are merged in directly. A truncated last log record is dropped with a
    /// warning, never an error.
    pub fn load_doc(
        &mut self,
        notebook: &str,
        doc: &str,
        snapshot: &[u8],
        log: &[u8],
    ) -> Result<Vec<LoadWarning>, CoreError> {
        if !is_safe_id(notebook) || !is_safe_id(doc) {
            return Err(CoreError::BadRequest(format!("bad id {notebook}/{doc}")));
        }
        let (updates, valid) = split_log(log);
        let mut warnings = Vec::new();
        if valid < log.len() {
            warnings.push(LoadWarning {
                code: "truncated_log".into(),
                doc: doc.into(),
                message: format!(
                    "{} trailing bytes of an interrupted write ignored",
                    log.len() - valid
                ),
            });
        }
        if self.notebooks.contains_key(notebook) {
            if doc == notebook {
                return Err(CoreError::NotebookOpen(notebook.into()));
            }
            let mut all = Vec::new();
            if !snapshot.is_empty() {
                all.push(snapshot.to_vec());
            }
            all.extend(updates);
            for u in all {
                self.import_updates(doc, &u, Some(notebook))?;
            }
            return Ok(warnings);
        }
        self.pending
            .entry(notebook.to_string())
            .or_default()
            .docs
            .insert(doc.to_string(), (snapshot.to_vec(), updates));
        Ok(warnings)
    }

    /// Opens a notebook from the docs given to [`NotesHost::load_doc`]; builds its search/tasks index (every
    /// page doc read once).
    pub fn open_notebook(&mut self, notebook: &str) -> Result<NotebookSummary, CoreError> {
        if self.notebooks.contains_key(notebook) {
            return Err(CoreError::NotebookOpen(notebook.into()));
        }
        let mut pending = self.pending.remove(notebook).unwrap_or_default();
        let (snap, updates) = pending
            .docs
            .remove(notebook)
            .ok_or_else(|| CoreError::UnknownDoc(notebook.to_string()))?;
        let appends = u32::try_from(updates.len()).unwrap_or(u32::MAX);
        let doc = NotebookDoc::from_bytes(&snap, &updates)?;
        own(doc.doc(), self.peer)?;
        let mut nb = Notebook {
            undo: doc.undo_manager(),
            persist: HashMap::new(),
            doc,
            pages: HashMap::new(),
            data: HashMap::new(),
            stale: BTreeSet::new(),
            registered: BTreeSet::new(),
        };
        nb.persist.insert(
            notebook.to_string(),
            Persist {
                vv: nb.doc.doc().oplog_vv(),
                appends,
            },
        );
        for (id, (snapshot, updates)) in pending.docs {
            let page = PageDoc::from_bytes(&snapshot, &updates)?;
            nb.data.insert(id.clone(), page.index_data());
            nb.pages.insert(id, Slot::Stored { snapshot, updates });
        }
        self.notebooks.insert(notebook.to_string(), nb);
        self.reindex_notebook(notebook);
        self.summary(notebook)
    }

    /// Creates a new, empty notebook (`id` = a new random id when absent) → its summary; the notebook doc is
    /// queued for storage.
    pub fn create_notebook(
        &mut self,
        name: &str,
        id: Option<&str>,
    ) -> Result<NotebookSummary, CoreError> {
        let id = match id {
            Some(i) if is_safe_id(i) => i.to_string(),
            Some(i) => return Err(CoreError::BadRequest(format!("bad id {i}"))),
            None => format!("nb-{:016x}", random_u64()),
        };
        if self.notebooks.contains_key(&id) {
            return Err(CoreError::NotebookOpen(id));
        }
        let ld = LoroDoc::new();
        own(&ld, self.peer)?;
        let doc = NotebookDoc::create_in(ld, name, self.now);
        let nb = Notebook {
            undo: doc.undo_manager(),
            doc,
            pages: HashMap::new(),
            persist: HashMap::new(),
            data: HashMap::new(),
            stale: BTreeSet::new(),
            registered: BTreeSet::new(),
        };
        self.notebooks.insert(id.clone(), nb);
        self.after_notebook_change(&id)?;
        self.summary(&id)
    }

    pub fn close_notebook(&mut self, notebook: &str) -> Result<(), CoreError> {
        self.nb(notebook)?;
        self.flush_all(notebook)?;
        self.notebooks.remove(notebook);
        self.index.remove_notebook(notebook);
        Ok(())
    }

    #[must_use]
    pub fn list_notebooks(&self) -> Vec<NotebookSummary> {
        self.notebooks
            .keys()
            .filter_map(|id| self.summary(id).ok())
            .collect()
    }

    fn summary(&self, notebook: &str) -> Result<NotebookSummary, CoreError> {
        let nb = self.nb(notebook)?;
        Ok(NotebookSummary {
            id: notebook.to_string(),
            info: nb.doc.info(),
            pages: u32::try_from(nb.doc.pages().iter().filter(|p| !p.3).count())
                .unwrap_or(u32::MAX),
        })
    }

    fn nb(&self, notebook: &str) -> Result<&Notebook, CoreError> {
        self.notebooks
            .get(notebook)
            .ok_or_else(|| CoreError::UnknownNotebook(notebook.to_string()))
    }

    fn nb_mut(&mut self, notebook: &str) -> Result<&mut Notebook, CoreError> {
        self.notebooks
            .get_mut(notebook)
            .ok_or_else(|| CoreError::UnknownNotebook(notebook.to_string()))
    }

    /// The notebook document itself (read access for shells and tests).
    pub fn notebook_doc(&self, notebook: &str) -> Result<&NotebookDoc, CoreError> {
        Ok(&self.nb(notebook)?.doc)
    }

    /// Which open notebook holds document `doc` (its notebook doc, a loaded page doc or a page in its tree).
    #[must_use]
    pub fn notebook_of(&self, doc: &str) -> Option<String> {
        if self.notebooks.contains_key(doc) {
            return Some(doc.to_string());
        }
        self.notebooks
            .iter()
            .find(|(_, nb)| nb.pages.contains_key(doc))
            .or_else(|| {
                self.notebooks
                    .iter()
                    .find(|(_, nb)| nb.doc.node_of_page_doc(doc).is_some())
            })
            .map(|(id, _)| id.clone())
    }

    // ---- persistence --------------------------------------------------------------------------------------

    /// Queues what changed in `doc` since it was last persisted.
    fn flush(&mut self, notebook: &str, doc: &str) -> Result<(), CoreError> {
        let Some(nb) = self.notebooks.get_mut(notebook) else {
            return Ok(());
        };
        let ld = if doc == notebook {
            nb.doc.doc()
        } else {
            match nb.pages.get(doc) {
                Some(Slot::Loaded(p)) => p.doc(),
                _ => return Ok(()),
            }
        };
        let st = nb.persist.entry(doc.to_string()).or_default();
        let vv = ld.oplog_vv();
        if vv == st.vv {
            return Ok(());
        }
        st.appends += 1;
        if st.appends >= COMPACT_AFTER_APPENDS {
            st.appends = 0;
            self.effects.push(PersistEffect::Replace {
                notebook: notebook.into(),
                doc: doc.into(),
                snapshot: snapshot_of(ld)?,
            });
        } else {
            let bytes = ld.export(ExportMode::updates(&st.vv))?;
            self.effects.push(PersistEffect::Append {
                notebook: notebook.into(),
                doc: doc.into(),
                bytes,
            });
        }
        st.vv = vv;
        Ok(())
    }

    fn flush_all(&mut self, notebook: &str) -> Result<(), CoreError> {
        let docs: Vec<String> = std::iter::once(notebook.to_string())
            .chain(self.nb(notebook)?.pages.keys().cloned())
            .collect();
        for d in docs {
            self.flush(notebook, &d)?;
        }
        Ok(())
    }

    /// Records `peer → device` in the notebook doc for peers that wrote to any of its docs.
    fn register_peers(&mut self, notebook: &str, doc: &str) -> Result<(), CoreError> {
        let (peer, mirror, device) = (self.peer, self.mirror_peer, self.device_id.clone());
        let Some(nb) = self.notebooks.get_mut(notebook) else {
            return Ok(());
        };
        let vv = if doc == notebook {
            nb.doc.doc().oplog_vv()
        } else {
            match nb.pages.get(doc) {
                Some(Slot::Loaded(p)) => p.doc().oplog_vv(),
                _ => return Ok(()),
            }
        };
        let mut changed = false;
        for p in [peer, mirror] {
            if !nb.registered.contains(&p) && vv.get(&p).is_some() {
                changed |= nb.doc.register_peer(p, &device)?;
                nb.registered.insert(p);
            }
        }
        if changed {
            self.flush(notebook, notebook)?;
        }
        Ok(())
    }

    fn after_notebook_change(&mut self, notebook: &str) -> Result<(), CoreError> {
        self.register_peers(notebook, notebook)?;
        self.flush(notebook, notebook)?;
        self.reindex_notebook(notebook);
        Ok(())
    }

    fn after_page_change(&mut self, notebook: &str, doc: &str) -> Result<(), CoreError> {
        self.register_peers(notebook, doc)?;
        self.flush(notebook, doc)?;
        if let Some(nb) = self.notebooks.get_mut(notebook) {
            nb.stale.insert(doc.to_string());
        }
        Ok(())
    }

    // ---- index --------------------------------------------------------------------------------------------

    /// Brings page titles (from the tree) and stale page texts up to date in the search index.
    fn reindex_notebook(&mut self, notebook: &str) {
        let Some(nb) = self.notebooks.get_mut(notebook) else {
            return;
        };
        let stale = std::mem::take(&mut nb.stale);
        for d in stale {
            if let Some(Slot::Loaded(p)) = nb.pages.get(&d) {
                nb.data.insert(d, p.index_data());
            }
        }
        let pages = nb.doc.pages();
        let mut in_tree = BTreeSet::new();
        for (_, doc, title, _) in &pages {
            in_tree.insert(doc.clone());
            let text = nb.data.get(doc).map(|d| d.text.as_str()).unwrap_or("");
            self.index.upsert_if_changed(notebook, doc, title, text);
        }
        let orphans: Vec<String> = nb
            .data
            .keys()
            .filter(|d| !in_tree.contains(*d))
            .cloned()
            .collect();
        for d in orphans {
            self.index.remove(notebook, &d);
        }
    }

    fn refresh(&mut self) {
        let ids: Vec<String> = self.notebooks.keys().cloned().collect();
        for id in ids {
            if self
                .notebooks
                .get(&id)
                .is_some_and(|nb| !nb.stale.is_empty())
            {
                self.reindex_notebook(&id);
            }
        }
    }

    // ---- page docs ----------------------------------------------------------------------------------------

    /// Materialises page `doc` of `notebook` (from its stored bytes, or the genesis when nothing is stored).
    fn load_page(&mut self, notebook: &str, doc: &str) -> Result<&PageDoc, CoreError> {
        let peer = self.peer;
        let nb = self.nb_mut(notebook)?;
        let slot = nb.pages.remove(doc);
        let page = match slot {
            Some(Slot::Loaded(p)) => p,
            Some(Slot::Stored { snapshot, updates }) => {
                // Storage holds exactly these bytes: persisted up to their version.
                let page = PageDoc::from_bytes(&snapshot, &updates)?;
                let appends = u32::try_from(updates.len()).unwrap_or(u32::MAX);
                nb.persist.insert(
                    doc.to_string(),
                    Persist {
                        vv: page.doc().oplog_vv(),
                        appends,
                    },
                );
                own(page.doc(), peer)?;
                page
            }
            None => {
                // Nothing stored yet: the genesis (and everything after it) still has to be written.
                let page = PageDoc::from_bytes(&[], &[])?;
                nb.persist.insert(doc.to_string(), Persist::default());
                own(page.doc(), peer)?;
                page
            }
        };
        nb.pages.insert(doc.to_string(), Slot::Loaded(page));
        match nb.pages.get(doc) {
            Some(Slot::Loaded(p)) => Ok(p),
            _ => Err(CoreError::UnknownDoc(doc.to_string())),
        }
    }

    /// The (materialised) page doc `doc`.
    pub fn page(&mut self, doc: &str) -> Result<&PageDoc, CoreError> {
        let notebook = self
            .notebook_of(doc)
            .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?;
        self.load_page(&notebook, doc)
    }

    fn doc_ref(&mut self, doc: &str) -> Result<(String, &LoroDoc), CoreError> {
        let notebook = self
            .notebook_of(doc)
            .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?;
        if notebook == doc {
            return Ok((notebook.clone(), self.nb(&notebook)?.doc.doc()));
        }
        let p = self.load_page(&notebook, doc)?;
        Ok((notebook, p.doc()))
    }

    /// Opens page `doc` for editing.
    pub fn open_page(&mut self, doc: &str) -> Result<OpenedPage, CoreError> {
        let notebook = self
            .notebook_of(doc)
            .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?;
        if notebook == doc {
            return Err(CoreError::BadRequest(format!("{doc} is a notebook")));
        }
        let mirror = self.mirror_peer;
        let page = self.load_page(&notebook, doc)?;
        let meta = page.meta();
        let version = frontiers_to_strings(&page.doc().oplog_frontiers());
        let fresh = !self.nb(&notebook)?.data.contains_key(doc);
        if fresh {
            // A page without stored content starts as the genesis: store it.
            self.after_page_change(&notebook, doc)?;
            self.reindex_notebook(&notebook);
        }
        let nb = self.nb(&notebook)?;
        let node = nb.doc.node_of_page_doc(doc);
        let title = node
            .as_deref()
            .and_then(|n| nb.doc.get_node(n).ok())
            .map_or(meta.title, |n| n.title);
        Ok(OpenedPage {
            notebook_id: notebook,
            doc_id: doc.to_string(),
            node_id: node,
            title,
            canvas: meta.canvas,
            version,
            mirror_peer: mirror.to_string(),
            merge_interval_secs: MIRROR_MERGE_INTERVAL_SECS,
        })
    }

    /// Releases the in-memory document of a page (stays indexed).
    pub fn close_page(&mut self, doc: &str) -> Result<(), CoreError> {
        let notebook = self
            .notebook_of(doc)
            .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?;
        self.flush(&notebook, doc)?;
        self.reindex_notebook(&notebook);
        let nb = self.nb_mut(&notebook)?;
        if let Some(Slot::Loaded(p)) = nb.pages.get(doc) {
            let snapshot = snapshot_of(p.doc())?;
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

    /// Imports Loro update (or snapshot) bytes into `doc` – from the editor mirror or from the relay. Unknown
    /// page docs of a notebook's tree are created from the genesis first. `notebook` disambiguates docs that
    /// arrive before their tree node.
    pub fn import_updates(
        &mut self,
        doc: &str,
        bytes: &[u8],
        notebook: Option<&str>,
    ) -> Result<ImportResult, CoreError> {
        let notebook = match notebook {
            Some(n) => {
                self.nb(n)?;
                n.to_string()
            }
            None => self
                .notebook_of(doc)
                .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?,
        };
        let is_nb = notebook == doc;
        let ld = if is_nb {
            self.nb(&notebook)?.doc.doc().clone()
        } else {
            self.load_page(&notebook, doc)?.doc().clone()
        };
        let before = ld.oplog_vv();
        let status = ld.import(bytes)?;
        let pending = status.pending.is_some();
        let changed = ld.oplog_vv() != before;
        if pending {
            // Changes waiting for dependencies are not in an export yet: keep the raw bytes.
            self.effects.push(PersistEffect::Append {
                notebook: notebook.clone(),
                doc: doc.into(),
                bytes: bytes.to_vec(),
            });
        }
        if is_nb {
            self.after_notebook_change(&notebook)?;
        } else {
            self.after_page_change(&notebook, doc)?;
        }
        Ok(ImportResult {
            notebook_id: notebook,
            doc_id: doc.to_string(),
            changed,
            pending,
            version: frontiers_to_strings(&ld.oplog_frontiers()),
        })
    }

    /// Updates of `doc` the holder of version vector `vv` (Loro `VersionVector.encode()`, empty = nothing)
    /// does not have yet.
    pub fn export_updates(&mut self, doc: &str, vv: &[u8]) -> Result<Vec<u8>, CoreError> {
        let vv = if vv.is_empty() {
            VersionVector::new()
        } else {
            VersionVector::decode(vv)?
        };
        let (_, ld) = self.doc_ref(doc)?;
        Ok(ld.export(ExportMode::updates(&vv))?)
    }

    /// The encoded version vector of `doc`.
    pub fn version_vector(&mut self, doc: &str) -> Result<Vec<u8>, CoreError> {
        let (_, ld) = self.doc_ref(doc)?;
        Ok(ld.oplog_vv().encode())
    }

    // ---- structure ----------------------------------------------------------------------------------------

    pub fn tree(&self, notebook: &str) -> Result<Vec<TreeNode>, CoreError> {
        Ok(self.nb(notebook)?.doc.tree())
    }

    pub fn recycle_bin(&self, notebook: &str) -> Result<Vec<DeletedNode>, CoreError> {
        Ok(self.nb(notebook)?.doc.recycle_bin())
    }

    /// Runs a structural edit on the notebook doc (one undo step), then persists and reindexes.
    fn edit<T>(
        &mut self,
        notebook: &str,
        f: impl FnOnce(&NotebookDoc, i64) -> Result<T, model_notes::NotesError>,
    ) -> Result<T, CoreError> {
        let now = self.now;
        let nb = self.nb_mut(notebook)?;
        let out = f(&nb.doc, now)?;
        nb.undo.record_new_checkpoint()?;
        self.after_notebook_change(notebook)?;
        Ok(out)
    }

    pub fn rename_notebook(&mut self, notebook: &str, name: &str) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| d.rename_notebook(name, now))
    }

    pub fn set_notebook_color(
        &mut self,
        notebook: &str,
        color: Option<&str>,
    ) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| d.set_notebook_color(color, now))
    }

    pub fn create_group(
        &mut self,
        notebook: &str,
        parent: Option<&str>,
        index: Option<usize>,
        title: &str,
    ) -> Result<String, CoreError> {
        self.edit(notebook, |d, now| d.create_group(parent, index, title, now))
    }

    pub fn create_section(
        &mut self,
        notebook: &str,
        parent: Option<&str>,
        index: Option<usize>,
        title: &str,
    ) -> Result<String, CoreError> {
        self.edit(notebook, |d, now| {
            d.create_section(parent, index, title, now)
        })
    }

    /// Creates a page node and its page doc (genesis + meta).
    pub fn create_page(
        &mut self,
        notebook: &str,
        parent: &str,
        index: Option<usize>,
        title: &str,
    ) -> Result<NewPage, CoreError> {
        // Page doc ids are global (links and the host's doc lookup span notebooks): random, not tree-derived.
        let doc_id = format!("pg-{:016x}", random_u64());
        let created = self.edit(notebook, |d, now| {
            d.create_page_with_doc(parent, index, title, &doc_id, now)
        })?;
        let ld = LoroDoc::new();
        own(&ld, self.peer)?;
        let page = PageDoc::create_in(ld, Some(title), self.now);
        let nb = self.nb_mut(notebook)?;
        nb.data.insert(created.doc_id.clone(), page.index_data());
        nb.persist
            .insert(created.doc_id.clone(), Persist::default());
        nb.pages.insert(created.doc_id.clone(), Slot::Loaded(page));
        self.after_page_change(notebook, &created.doc_id)?;
        self.reindex_notebook(notebook);
        Ok(created)
    }

    /// Renames a node; for pages the page doc's `meta.title` follows.
    pub fn rename(&mut self, notebook: &str, node: &str, title: &str) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| d.rename(node, title, now))?;
        let page_doc = self
            .nb(notebook)?
            .doc
            .get_node(node)
            .ok()
            .and_then(|n| n.page_doc);
        if let Some(doc) = page_doc {
            let now = self.now;
            self.load_page(notebook, &doc)?.set_title(title, now)?;
            self.after_page_change(notebook, &doc)?;
        }
        Ok(())
    }

    pub fn set_color(
        &mut self,
        notebook: &str,
        node: &str,
        color: Option<&str>,
    ) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| d.set_color(node, color, now))
    }

    pub fn move_node(
        &mut self,
        notebook: &str,
        node: &str,
        parent: Option<&str>,
        index: usize,
    ) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| d.move_node(node, parent, index, now))
    }

    pub fn delete_node(&mut self, notebook: &str, node: &str) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| d.delete(node, now))
    }

    pub fn restore_node(
        &mut self,
        notebook: &str,
        node: &str,
        to: Option<&str>,
    ) -> Result<(), CoreError> {
        self.edit(notebook, |d, now| match to {
            Some(p) => d.restore_to(node, p, now),
            None => d.restore(node, now),
        })
    }

    /// Purges recycle-bin entries older than 60 days; their page docs are dropped (Delete effects).
    pub fn purge_expired(&mut self, notebook: &str) -> Result<Vec<String>, CoreError> {
        let docs = self.edit(notebook, |d, now| d.purge_expired(now))?;
        self.drop_pages(notebook, &docs)?;
        Ok(docs)
    }

    /// Permanently deletes one recycle-bin entry (with its subtree); their page docs are dropped (Delete effects).
    /// The UI does not offer to undo it (like `Purge`).
    pub fn purge_node(&mut self, notebook: &str, node: &str) -> Result<Vec<String>, CoreError> {
        let docs = self.edit(notebook, |d, now| d.purge_node(node, now))?;
        self.drop_pages(notebook, &docs)?;
        Ok(docs)
    }

    fn drop_pages(&mut self, notebook: &str, docs: &[String]) -> Result<(), CoreError> {
        let nb = self.nb_mut(notebook)?;
        for d in docs {
            nb.pages.remove(d);
            nb.persist.remove(d);
            nb.data.remove(d);
        }
        for d in docs {
            self.index.remove(notebook, d);
            self.effects.push(PersistEffect::Delete {
                notebook: notebook.into(),
                doc: d.clone(),
            });
        }
        Ok(())
    }

    /// Stores a blob (image, attachment) of a notebook: queues a Blob effect (content addressed, written once)
    /// and returns its id (SHA-256 hex).
    pub fn put_blob(&mut self, notebook: &str, bytes: &[u8]) -> Result<String, CoreError> {
        self.nb(notebook)?;
        let id = blob_id(bytes);
        let queued = self.effects.iter().any(|e| {
            matches!(e, PersistEffect::Blob { sha256, notebook: n, .. } if *sha256 == id && n == notebook)
        });
        if !queued {
            self.effects.push(PersistEffect::Blob {
                notebook: notebook.into(),
                sha256: id.clone(),
                bytes: bytes.to_vec(),
            });
        }
        Ok(id)
    }

    /// Structural undo of this device's own last tree edit (never others'). Returns whether anything changed.
    pub fn undo(&mut self, notebook: &str) -> Result<bool, CoreError> {
        let done = self.nb_mut(notebook)?.undo.undo()?;
        self.after_notebook_change(notebook)?;
        Ok(done)
    }

    pub fn redo(&mut self, notebook: &str) -> Result<bool, CoreError> {
        let done = self.nb_mut(notebook)?.undo.redo()?;
        self.after_notebook_change(notebook)?;
        Ok(done)
    }

    pub fn add_tag(
        &mut self,
        notebook: &str,
        label: &str,
        icon: Option<&str>,
        color: Option<&str>,
        kind: model_notes::TagKind,
    ) -> Result<String, CoreError> {
        self.edit(notebook, |d, _| d.add_tag(label, icon, color, kind))
    }

    pub fn update_tag(
        &mut self,
        notebook: &str,
        id: &str,
        label: Option<&str>,
        icon: Option<&str>,
        color: Option<&str>,
    ) -> Result<(), CoreError> {
        self.edit(notebook, |d, _| d.update_tag(id, label, icon, color))
    }

    pub fn set_canvas(&mut self, doc: &str, canvas: bool) -> Result<(), CoreError> {
        let notebook = self
            .notebook_of(doc)
            .ok_or_else(|| CoreError::UnknownDoc(doc.to_string()))?;
        let now = self.now;
        self.load_page(&notebook, doc)?.set_canvas(canvas, now)?;
        self.after_page_change(&notebook, doc)
    }

    // ---- queries ------------------------------------------------------------------------------------------

    /// Doc ids of pages that are deleted or under a deleted node, per notebook.
    fn hidden_pages(&self) -> HashMap<String, BTreeSet<String>> {
        self.notebooks
            .iter()
            .map(|(id, nb)| {
                let hidden: BTreeSet<String> = nb
                    .doc
                    .pages()
                    .into_iter()
                    .filter(|p| p.3)
                    .map(|p| p.1)
                    .collect();
                (id.clone(), hidden)
            })
            .collect()
    }

    /// Full-text search across the open notebooks (or one).
    pub fn search(&mut self, query: &str, notebook: Option<&str>, limit: usize) -> Vec<SearchHit> {
        self.refresh();
        let hidden = self.hidden_pages();
        self.index.search(query, notebook, limit, &|n, d| {
            !hidden.get(n).is_some_and(|h| h.contains(d))
        })
    }

    /// To-dos of every live page of the open notebooks.
    pub fn tasks(&mut self, filter: TaskFilter) -> Vec<TaskEntry> {
        self.refresh();
        let mut out = Vec::new();
        for (id, nb) in &self.notebooks {
            let todo: Vec<String> = nb
                .doc
                .tags()
                .into_iter()
                .filter(|t| t.kind.is_todo())
                .map(|t| t.id)
                .collect();
            for (_, doc, title, deleted) in nb.doc.pages() {
                if deleted {
                    continue;
                }
                let Some(data) = nb.data.get(&doc) else {
                    continue;
                };
                for t in data.tasks(&todo) {
                    let keep = match filter {
                        TaskFilter::Open => !t.checked,
                        TaskFilter::Done => t.checked,
                        TaskFilter::All => true,
                    };
                    if keep {
                        out.push(TaskEntry {
                            notebook_id: id.clone(),
                            doc_id: doc.clone(),
                            page_title: title.clone(),
                            text: t.text,
                            checked: t.checked,
                            block: t.block,
                            tags: t.tags,
                            path: t.path,
                        });
                    }
                }
            }
        }
        out
    }

    /// Live pages linking to page doc `page` (`pageLink` attr `pageId`).
    pub fn backlinks(&mut self, page: &str) -> Vec<PageRef> {
        self.refresh();
        let mut out = Vec::new();
        for (id, nb) in &self.notebooks {
            for (node, doc, title, deleted) in nb.doc.pages() {
                if !deleted
                    && doc != page
                    && nb
                        .data
                        .get(&doc)
                        .is_some_and(|d| d.links.iter().any(|l| l == page))
                {
                    out.push(PageRef {
                        notebook_id: id.clone(),
                        doc_id: doc,
                        node_id: Some(node),
                        title,
                    });
                }
            }
        }
        out
    }

    /// Blob ids referenced by the pages of a notebook (to include in a backup / sync).
    pub fn referenced_blobs(&mut self, notebook: &str) -> Result<Vec<String>, CoreError> {
        self.refresh();
        let nb = self.nb(notebook)?;
        let set: BTreeSet<String> = nb
            .data
            .values()
            .flat_map(|d| d.blobs.iter().cloned())
            .collect();
        Ok(set.into_iter().collect())
    }

    /// History of a document: change groups (same peer, ≤ 60 s apart), oldest first.
    pub fn history(&mut self, doc: &str) -> Result<Vec<HistoryEntry>, CoreError> {
        let (notebook, ld) = self.doc_ref(doc)?;
        let groups = change_groups(ld, HISTORY_MERGE_SECS);
        let nb = self.nb(&notebook)?;
        Ok(groups
            .into_iter()
            .map(|g| HistoryEntry {
                device_id: g.peer.parse().ok().and_then(|p| nb.doc.device_of(p)),
                peer: g.peer,
                start: g.start,
                end: g.end,
                ops: g.ops,
                frontiers: g.frontiers,
            })
            .collect())
    }

    /// The page as it was at `frontiers` (read-only; the live doc is not touched).
    pub fn checkout_preview(
        &mut self,
        doc: &str,
        frontiers: &[String],
    ) -> Result<VersionPreview, CoreError> {
        let f = frontiers_from_strings(frontiers)?;
        let (_, ld) = self.doc_ref(doc)?;
        let old = PageDoc::from_doc(ld.fork_at(&f)?);
        Ok(VersionPreview {
            text: old.plain_text(),
            pm: old.to_pm_json(),
            title: old.title(),
        })
    }

    /// Brings `doc` back to its state at `frontiers` with new operations (history is kept).
    pub fn restore_version(
        &mut self,
        doc: &str,
        frontiers: &[String],
    ) -> Result<Vec<String>, CoreError> {
        let f = frontiers_from_strings(frontiers)?;
        let now = self.now;
        let (notebook, ld) = self.doc_ref(doc)?;
        let ld = ld.clone();
        ld.revert_to(&f)?;
        ld.commit_with(loro::CommitOptions::new().timestamp(now.div_euclid(1000)));
        if notebook == doc {
            self.after_notebook_change(&notebook)?;
        } else {
            self.after_page_change(&notebook, doc)?;
        }
        Ok(frontiers_to_strings(&ld.oplog_frontiers()))
    }

    /// Replaces a document's stored log by one full-history snapshot (no shallow snapshots).
    pub fn compact(&mut self, doc: &str) -> Result<(), CoreError> {
        let (notebook, ld) = self.doc_ref(doc)?;
        let snapshot = snapshot_of(ld)?;
        let vv = ld.oplog_vv();
        self.nb_mut(&notebook)?
            .persist
            .insert(doc.to_string(), Persist { vv, appends: 0 });
        self.effects.push(PersistEffect::Replace {
            notebook,
            doc: doc.into(),
            snapshot,
        });
        Ok(())
    }

    // ---- backup -------------------------------------------------------------------------------------------

    /// A `.rnotes` backup of an open notebook: full-history snapshots of every doc plus the given blobs.
    pub fn export_backup(
        &mut self,
        notebook: &str,
        blobs: &[Vec<u8>],
    ) -> Result<Vec<u8>, CoreError> {
        self.flush_all(notebook)?;
        let nb = self.nb(notebook)?;
        let mut docs = vec![StoredDoc {
            id: notebook.into(),
            snapshot: nb.doc.snapshot()?,
            log: Vec::new(),
        }];
        let mut ids: Vec<&String> = nb.pages.keys().collect();
        ids.sort();
        for id in ids {
            let d = match &nb.pages[id] {
                Slot::Loaded(p) => StoredDoc {
                    id: id.clone(),
                    snapshot: snapshot_of(p.doc())?,
                    log: Vec::new(),
                },
                Slot::Stored { snapshot, updates } => StoredDoc {
                    id: id.clone(),
                    snapshot: snapshot.clone(),
                    log: updates.iter().flat_map(|u| log_record(u)).collect(),
                },
            };
            docs.push(d);
        }
        let mut blob_list: Vec<(String, Vec<u8>)> =
            blobs.iter().map(|b| (blob_id(b), b.clone())).collect();
        blob_list.sort();
        blob_list.dedup_by(|a, b| a.0 == b.0);
        Backup {
            manifest: NotebookManifest::new(notebook, &nb.doc.info().name),
            docs,
            blobs: blob_list,
        }
        .write()
    }

    /// Opens a notebook from a `.rnotes` backup and queues all of it (docs as snapshots, blobs) for storage.
    pub fn import_backup(
        &mut self,
        bytes: &[u8],
    ) -> Result<(NotebookSummary, Vec<LoadWarning>), CoreError> {
        let (backup, mut warnings) = Backup::read(bytes)?;
        let id = backup.manifest.notebook_id.clone();
        if self.notebooks.contains_key(&id) {
            return Err(CoreError::NotebookOpen(id));
        }
        for d in &backup.docs {
            warnings.extend(self.load_doc(&id, &d.id, &d.snapshot, &d.log)?);
        }
        let summary = self.open_notebook(&id)?;
        let nb = self.nb(&id)?;
        let mut effects = vec![PersistEffect::Replace {
            notebook: id.clone(),
            doc: id.clone(),
            snapshot: nb.doc.snapshot()?,
        }];
        for (doc, slot) in &nb.pages {
            let snapshot = match slot {
                Slot::Loaded(p) => snapshot_of(p.doc())?,
                Slot::Stored { snapshot, updates } if updates.is_empty() => snapshot.clone(),
                Slot::Stored { snapshot, updates } => {
                    snapshot_of(PageDoc::from_bytes(snapshot, updates)?.doc())?
                }
            };
            effects.push(PersistEffect::Replace {
                notebook: id.clone(),
                doc: doc.clone(),
                snapshot,
            });
        }
        for (sha, b) in backup.blobs {
            effects.push(PersistEffect::Blob {
                notebook: id.clone(),
                sha256: sha,
                bytes: b,
            });
        }
        self.effects.extend(effects);
        Ok((summary, warnings))
    }
}

impl SearchIndex {
    /// Upserts unless title and text are unchanged.
    pub(crate) fn upsert_if_changed(&mut self, notebook: &str, doc: &str, title: &str, text: &str) {
        if !self.same(notebook, doc, title, text) {
            self.upsert(notebook, doc, title, text);
        }
    }
}
