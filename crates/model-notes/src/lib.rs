#![forbid(unsafe_code)]
//! Rusuite Notes document model (spec `docs/superpowers/specs/2026-11-12-notes-design.md` §4.2, format
//! `docs/notes-format.md`).
//!
//! Two kinds of [Loro](https://loro.dev) documents:
//!
//! * [`NotebookDoc`] – one per notebook: the hierarchy of section groups, sections and pages as a movable
//!   `LoroTree` (`"tree"`), the notebook map (`"notebook"`), tag definitions (`"tags"`) and the peer → device map
//!   (`"peers"`). Concurrent moves never duplicate or lose a page.
//! * [`PageDoc`] – one per page: the ProseMirror content in exactly the container layout `loro-prosemirror` 0.4.4
//!   writes (`"doc"`), page metadata (`"meta"`), canvas items (`"canvas"`) and ink strokes (`"ink"`). Every page
//!   starts from the deterministic [`page_genesis`] (peer id 0) so independently created copies merge.
//!
//! Pure and `wasm32-unknown-unknown` compatible: no clock (every mutation takes `now` in Unix milliseconds), no
//! file system, no threads.

mod canvas;
mod content;
mod error;
mod history;
mod notebook;
mod page;
mod tags;
mod util;

pub use canvas::{CanvasItem, InkStroke};
pub use content::{BlockTag, OutlineEntry, PageIndexData, PmNode, TaskItem};
pub use error::NotesError;
pub use history::{
    change_groups, frontiers_from_strings, frontiers_to_strings, ChangeGroup, HISTORY_MERGE_SECS,
};
pub use notebook::{
    DeletedNode, NewPage, NodeKind, NotebookDoc, NotebookInfo, TreeNode, RECYCLE_BIN_MS,
};
pub use page::{page_genesis, PageDoc, PageMeta, GENESIS_PEER};
pub use tags::{TagDef, TagKind};

pub use loro;

/// The notebook format version written to the `"notebook"` map and `notebook.json` (`docs/notes-format.md`).
pub const FORMAT_VERSION: u32 = 1;
