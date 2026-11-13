#![forbid(unsafe_code)]
//! Rusuite Notes core (`notes-core`): the transport- and storage-agnostic part shared by the wasm shell
//! (`apps/notes/src-wasm`) and the Tauri shell (P11-N7). Spec: `docs/superpowers/specs/2026-11-12-notes-design.md`;
//! storage format: `docs/notes-format.md`.
//!
//! * [`NotesHost`] owns every open notebook's Loro documents (the documents of record; the editor holds a mirror
//!   and exchanges Loro update bytes with [`NotesHost::import_updates`] / [`NotesHost::export_updates`]).
//! * Storage-agnostic: documents are loaded from `(doc id, snapshot, log)` ([`NotesHost::load_doc`]) and every
//!   change is returned as a [`PersistEffect`] ([`NotesHost::take_effects`]); the web UI writes them to
//!   IndexedDB, `FolderStore` (feature `fs`) to a notebook folder.
//! * [`dispatch_with`] is the JSON entry point for commands (`Request` → `Response`); bytes cross the shells'
//!   binary functions instead (never base64 on the hot path).
//! * In-memory [`SearchIndex`], tasks, backlinks, history (change groups, preview, restore), compaction and the
//!   `.rnotes` backup archive.
//!
//! ```
//! use notes_core::{dispatch_with, NotesHost};
//!
//! let mut host = NotesHost::with_peers("device-1", 7, 8);
//! let reply = dispatch_with(&mut host, r#"{"type":"createNotebook","name":"Work","id":"nb-1","now":1000}"#);
//! assert!(reply.starts_with(r#"{"ok":{"type":"notebook","#));
//! assert!(!host.take_effects().is_empty(), "the new notebook doc is queued for storage");
//! ```

mod backup;
mod dispatch;
mod effects;
mod host;
pub mod search;
#[cfg(feature = "fs")]
mod store;

pub use backup::{Backup, NotebookManifest, StoredDoc, BACKUP_EXT, FORMAT_NAME, MANIFEST};
pub use dispatch::{binary, dispatch_with, Request, Response, ResponseBody};
pub use effects::{
    blob_id, decode_effects, encode_effects, is_safe_id, log_record, split_blobs, split_log,
    LoadWarning, PersistEffect,
};
pub use host::{
    HistoryEntry, ImportResult, NotebookSummary, NotesHost, OpenedPage, PageRef, TaskEntry,
    TaskFilter, VersionPreview, COMPACT_AFTER_APPENDS, MIRROR_MERGE_INTERVAL_SECS,
};
pub use model_notes;
pub use model_notes::page_genesis;
pub use search::{SearchHit, SearchIndex};
#[cfg(feature = "fs")]
pub use store::FolderStore;

/// Errors of the core; each has a stable wire code ([`CoreError::code`]).
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error(transparent)]
    Model(#[from] model_notes::NotesError),
    #[error("loro: {0}")]
    Loro(#[from] loro::LoroError),
    #[error("loro export: {0}")]
    Encode(#[from] loro::LoroEncodeError),
    #[error("no open notebook {0}")]
    UnknownNotebook(String),
    #[error("unknown document {0}")]
    UnknownDoc(String),
    #[error("notebook {0} is already open")]
    NotebookOpen(String),
    #[error("{0}")]
    Format(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl CoreError {
    /// The stable machine-readable code of the error reply.
    #[must_use]
    pub fn code(&self) -> &'static str {
        use model_notes::NotesError as N;
        match self {
            CoreError::Model(N::UnknownNode(_)) => "unknown_node",
            CoreError::Model(N::InvalidParent { .. }) => "invalid_parent",
            CoreError::Model(N::Cycle) => "cycle",
            CoreError::Model(N::ParentDeleted(_)) => "parent_deleted",
            CoreError::Model(N::NotDeleted(_)) => "not_deleted",
            CoreError::Model(N::UnknownItem(_)) => "unknown_item",
            CoreError::Model(N::Content(_)) => "invalid_content",
            CoreError::Model(N::Loro(_) | N::Encode(_))
            | CoreError::Loro(_)
            | CoreError::Encode(_) => "loro",
            CoreError::UnknownNotebook(_) => "unknown_notebook",
            CoreError::UnknownDoc(_) => "unknown_doc",
            CoreError::NotebookOpen(_) => "notebook_open",
            CoreError::Format(_) => "format",
            CoreError::BadRequest(_) => "bad_request",
            CoreError::Io(_) => "io",
        }
    }
}

impl From<CoreError> for app_common::DispatchError {
    fn from(e: CoreError) -> Self {
        app_common::DispatchError::new(e.code(), e.to_string())
    }
}
