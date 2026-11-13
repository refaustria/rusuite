//! The JSON entry point both shells call: [`dispatch_with`]`(host, request_json) -> response_json`.
//!
//! Every request may carry a top-level `"now"` (Unix ms, the UI's clock) next to `"type"`; mutations are stamped
//! with it (the core has no clock). Bytes (Loro updates, snapshots, backups, blobs) never cross this JSON
//! interface: the shells have binary functions for them.
use app_common::DispatchError;
use model_notes::{DeletedNode, NewPage, TagDef, TagKind, TreeNode};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::effects::LoadWarning;
use crate::host::convert::{FileImported, PageFormat};
use crate::host::{
    HistoryEntry, ImportResult, NotebookSummary, NotesHost, OpenedPage, PageRef, TaskEntry,
    TaskFilter, VersionPreview,
};
use crate::search::SearchHit;
use notes_convert::{ConvertWarning, ExportFormat};

/// A request from the UI, e.g. `{"type":"createPage","notebook":"nb-1","parent":"3@7","title":"Hi","now":…}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub enum Request {
    /// → `hello` (version, peer ids). Sets the device id used in the `"peers"` map.
    Hello {
        device_id: String,
    },
    /// → `notebook`. `id` = a new random id when absent.
    CreateNotebook {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        id: Option<String>,
    },
    /// Opens a notebook whose docs were given to the binary `load_doc` → `notebook`.
    OpenNotebook {
        id: String,
    },
    /// → `done` (pending effects are queued first).
    CloseNotebook {
        id: String,
    },
    /// → `notebooks`.
    ListNotebooks,
    /// → `done`.
    RenameNotebook {
        notebook: String,
        name: String,
    },
    /// → `done`.
    SetNotebookColor {
        notebook: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
    },
    /// → `tree`.
    GetTree {
        notebook: String,
    },
    /// → `recycleBin`.
    RecycleBin {
        notebook: String,
    },
    /// → `created` (`parent` absent = root; `index` among visible siblings, absent = last).
    CreateGroup {
        notebook: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        parent: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        index: Option<u32>,
        title: String,
    },
    /// → `created`.
    CreateSection {
        notebook: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        parent: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        index: Option<u32>,
        title: String,
    },
    /// → `pageCreated` (in a section, or as a sub-page under a page).
    CreatePage {
        notebook: String,
        parent: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        index: Option<u32>,
        title: String,
    },
    /// → `done`. Pages: the page doc's title follows.
    Rename {
        notebook: String,
        node: String,
        title: String,
    },
    /// → `done` (`color` absent = clear).
    SetColor {
        notebook: String,
        node: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
    },
    /// → `done`. `parent` absent = root; `index` among the visible children of the new parent.
    Move {
        notebook: String,
        node: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        parent: Option<String>,
        index: u32,
    },
    /// Soft delete (recycle bin) → `done`.
    Delete {
        notebook: String,
        node: String,
    },
    /// Out of the recycle bin (into `to` when given) → `done`.
    RestoreNode {
        notebook: String,
        node: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        to: Option<String>,
    },
    /// Removes recycle-bin entries older than 60 days → `purged`.
    Purge {
        notebook: String,
    },
    /// Permanently deletes one recycle-bin entry and its subtree → `purged`.
    PurgeNode {
        notebook: String,
        node: String,
    },
    /// Structural undo/redo of this device's own tree edits → `undone` (`changed`).
    Undo {
        notebook: String,
    },
    Redo {
        notebook: String,
    },
    /// → `tags`.
    Tags {
        notebook: String,
    },
    /// → `created` (the tag id).
    AddTag {
        notebook: String,
        label: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        icon: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
        kind: TagKind,
    },
    /// Changes a tag definition → `done`. Absent fields stay; `""` clears `icon` / `color`.
    UpdateTag {
        notebook: String,
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        label: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        icon: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
    },
    /// → `page`. Bind the editor mirror afterwards (seed it with the binary `export_updates(docId, empty)`).
    OpenPage {
        doc_id: String,
    },
    /// → `done`.
    ClosePage {
        doc_id: String,
    },
    /// → `done`.
    SetCanvas {
        doc_id: String,
        canvas: bool,
    },
    /// → `searchHits` (`limit` default 50).
    Search {
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        notebook: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        limit: Option<u32>,
    },
    /// → `tasks`.
    Tasks {
        filter: TaskFilter,
    },
    /// → `pages` (pages linking to page doc `pageId`).
    Backlinks {
        page_id: String,
    },
    /// → `blobIds` (blobs referenced by a notebook's pages).
    ReferencedBlobs {
        notebook: String,
    },
    /// → `history`.
    History {
        doc_id: String,
    },
    /// → `preview`.
    CheckoutPreview {
        doc_id: String,
        frontiers: Vec<String>,
    },
    /// New ops that bring the doc back to `frontiers` → `version`.
    Restore {
        doc_id: String,
        frontiers: Vec<String>,
    },
    /// Queues a full-history snapshot replacing the doc's log → `done`.
    Compact {
        doc_id: String,
    },
    /// Binary `import_file` only → `fileImported`. A `.onepkg` (CAB) becomes a new notebook (`id`, else random);
    /// a `.one` section a new section of `notebook` (in group `parent`, else at the root). Images, attachments →
    /// blob effects; reader warnings in the reply.
    ImportOneNote {
        file_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        notebook: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        parent: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        id: Option<String>,
    },
    /// A Markdown file as a new page under `parent` (section or page) → `fileImported`. `text` here, or the bytes
    /// through `import_file`.
    ImportMarkdown {
        file_name: String,
        notebook: String,
        parent: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        text: Option<String>,
    },
    /// An HTML file as a new page (sanitised) → `fileImported`. `html` here, or the bytes through `import_file`.
    ImportHtml {
        file_name: String,
        notebook: String,
        parent: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        html: Option<String>,
    },
    /// Binary `import_file` only: a `.docx` as a new page → `fileImported`.
    ImportDocx {
        file_name: String,
        notebook: String,
        parent: String,
    },
    /// The editor's paste path: sanitised HTML → `pasted` (a ProseMirror `doc`; images become blobs of `notebook`).
    PasteHtml {
        notebook: String,
        html: String,
    },
    /// Binary `export` only → the file's bytes.
    ExportPage {
        doc_id: String,
        format: ExportFormat,
    },
    /// Binary `export` only: all pages of a section (sub-pages included) → a Markdown zip, one HTML file or one
    /// `.docx`.
    ExportSection {
        notebook: String,
        section: String,
        format: ExportFormat,
    },
}

/// A successful reply.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub enum ResponseBody {
    Hello {
        version: String,
        peer: String,
        mirror_peer: String,
    },
    Notebook {
        notebook: NotebookSummary,
        tree: Vec<TreeNode>,
    },
    Notebooks {
        notebooks: Vec<NotebookSummary>,
    },
    Done,
    Tree {
        tree: Vec<TreeNode>,
    },
    RecycleBin {
        entries: Vec<DeletedNode>,
    },
    Created {
        id: String,
    },
    PageCreated {
        page: NewPage,
    },
    Purged {
        doc_ids: Vec<String>,
    },
    Undone {
        changed: bool,
    },
    Tags {
        tags: Vec<TagDef>,
    },
    Page {
        page: OpenedPage,
    },
    SearchHits {
        hits: Vec<SearchHit>,
    },
    Tasks {
        tasks: Vec<TaskEntry>,
    },
    Pages {
        pages: Vec<PageRef>,
    },
    BlobIds {
        ids: Vec<String>,
    },
    History {
        entries: Vec<HistoryEntry>,
    },
    Preview {
        preview: VersionPreview,
    },
    Version {
        version: Vec<String>,
    },
    /// Binary `load_doc`.
    Loaded {
        warnings: Vec<LoadWarning>,
    },
    /// Binary `import_updates`.
    Imported {
        result: ImportResult,
    },
    /// `importOneNote`, `importMarkdown`, `importHtml`, `importDocx`.
    FileImported {
        #[serde(flatten)]
        result: FileImported,
    },
    Pasted {
        /// A ProseMirror `doc` node.
        #[ts(type = "unknown")]
        content: serde_json::Value,
        warnings: Vec<ConvertWarning>,
    },
    /// Binary `import_backup`.
    BackupImported {
        notebook: NotebookSummary,
        tree: Vec<TreeNode>,
        warnings: Vec<LoadWarning>,
    },
}

/// `{"ok": body}` or `{"err": {code, message}}`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub enum Response {
    Ok(ResponseBody),
    Err(DispatchError),
}

#[derive(Deserialize)]
struct Clock {
    #[serde(default)]
    now: Option<f64>,
}

fn idx(i: Option<u32>) -> Option<usize> {
    i.map(|i| i as usize)
}

fn handle(host: &mut NotesHost, req: Request) -> Result<ResponseBody, crate::CoreError> {
    use Request as R;
    use ResponseBody as B;
    Ok(match req {
        R::Hello { device_id } => {
            host.set_device(&device_id);
            B::Hello {
                version: env!("CARGO_PKG_VERSION").into(),
                peer: host.peer().to_string(),
                mirror_peer: host.mirror_peer().to_string(),
            }
        }
        R::CreateNotebook { name, id } => {
            let notebook = host.create_notebook(&name, id.as_deref())?;
            let tree = host.tree(&notebook.id)?;
            B::Notebook { notebook, tree }
        }
        R::OpenNotebook { id } => {
            let notebook = host.open_notebook(&id)?;
            B::Notebook {
                tree: host.tree(&id)?,
                notebook,
            }
        }
        R::CloseNotebook { id } => {
            host.close_notebook(&id)?;
            B::Done
        }
        R::ListNotebooks => B::Notebooks {
            notebooks: host.list_notebooks(),
        },
        R::RenameNotebook { notebook, name } => {
            host.rename_notebook(&notebook, &name)?;
            B::Done
        }
        R::SetNotebookColor { notebook, color } => {
            host.set_notebook_color(&notebook, color.as_deref())?;
            B::Done
        }
        R::GetTree { notebook } => B::Tree {
            tree: host.tree(&notebook)?,
        },
        R::RecycleBin { notebook } => B::RecycleBin {
            entries: host.recycle_bin(&notebook)?,
        },
        R::CreateGroup {
            notebook,
            parent,
            index,
            title,
        } => B::Created {
            id: host.create_group(&notebook, parent.as_deref(), idx(index), &title)?,
        },
        R::CreateSection {
            notebook,
            parent,
            index,
            title,
        } => B::Created {
            id: host.create_section(&notebook, parent.as_deref(), idx(index), &title)?,
        },
        R::CreatePage {
            notebook,
            parent,
            index,
            title,
        } => B::PageCreated {
            page: host.create_page(&notebook, &parent, idx(index), &title)?,
        },
        R::Rename {
            notebook,
            node,
            title,
        } => {
            host.rename(&notebook, &node, &title)?;
            B::Done
        }
        R::SetColor {
            notebook,
            node,
            color,
        } => {
            host.set_color(&notebook, &node, color.as_deref())?;
            B::Done
        }
        R::Move {
            notebook,
            node,
            parent,
            index,
        } => {
            host.move_node(&notebook, &node, parent.as_deref(), index as usize)?;
            B::Done
        }
        R::Delete { notebook, node } => {
            host.delete_node(&notebook, &node)?;
            B::Done
        }
        R::RestoreNode { notebook, node, to } => {
            host.restore_node(&notebook, &node, to.as_deref())?;
            B::Done
        }
        R::Purge { notebook } => B::Purged {
            doc_ids: host.purge_expired(&notebook)?,
        },
        R::PurgeNode { notebook, node } => B::Purged {
            doc_ids: host.purge_node(&notebook, &node)?,
        },
        R::Undo { notebook } => B::Undone {
            changed: host.undo(&notebook)?,
        },
        R::Redo { notebook } => B::Undone {
            changed: host.redo(&notebook)?,
        },
        R::Tags { notebook } => B::Tags {
            tags: host.notebook_doc(&notebook)?.tags(),
        },
        R::AddTag {
            notebook,
            label,
            icon,
            color,
            kind,
        } => B::Created {
            id: host.add_tag(&notebook, &label, icon.as_deref(), color.as_deref(), kind)?,
        },
        R::UpdateTag {
            notebook,
            id,
            label,
            icon,
            color,
        } => {
            host.update_tag(
                &notebook,
                &id,
                label.as_deref(),
                icon.as_deref(),
                color.as_deref(),
            )?;
            B::Done
        }
        R::OpenPage { doc_id } => B::Page {
            page: host.open_page(&doc_id)?,
        },
        R::ClosePage { doc_id } => {
            host.close_page(&doc_id)?;
            B::Done
        }
        R::SetCanvas { doc_id, canvas } => {
            host.set_canvas(&doc_id, canvas)?;
            B::Done
        }
        R::Search {
            query,
            notebook,
            limit,
        } => B::SearchHits {
            hits: host.search(
                &query,
                notebook.as_deref(),
                limit.map_or(50, |l| l as usize),
            ),
        },
        R::Tasks { filter } => B::Tasks {
            tasks: host.tasks(filter),
        },
        R::Backlinks { page_id } => B::Pages {
            pages: host.backlinks(&page_id),
        },
        R::ReferencedBlobs { notebook } => B::BlobIds {
            ids: host.referenced_blobs(&notebook)?,
        },
        R::History { doc_id } => B::History {
            entries: host.history(&doc_id)?,
        },
        R::CheckoutPreview { doc_id, frontiers } => B::Preview {
            preview: host.checkout_preview(&doc_id, &frontiers)?,
        },
        R::Restore { doc_id, frontiers } => B::Version {
            version: host.restore_version(&doc_id, &frontiers)?,
        },
        R::Compact { doc_id } => {
            host.compact(&doc_id)?;
            B::Done
        }
        R::PasteHtml { notebook, html } => {
            let (content, warnings) = host.paste_html(&notebook, &html)?;
            B::Pasted { content, warnings }
        }
        req @ (R::ImportOneNote { .. }
        | R::ImportMarkdown { .. }
        | R::ImportHtml { .. }
        | R::ImportDocx { .. }) => import(host, req, None)?,
        R::ExportPage { .. } | R::ExportSection { .. } => {
            return Err(crate::CoreError::BadRequest(
                "exports return bytes: use the binary export function".into(),
            ))
        }
    })
}

/// Runs an import request; `bytes` from the binary `import_file` (Markdown/HTML may carry their text instead).
fn import(
    host: &mut NotesHost,
    req: Request,
    bytes: Option<&[u8]>,
) -> Result<ResponseBody, crate::CoreError> {
    fn need(b: Option<&[u8]>) -> Result<&[u8], crate::CoreError> {
        b.ok_or_else(|| {
            crate::CoreError::BadRequest(
                "this import takes the file's bytes: use import_file".into(),
            )
        })
    }
    let result = match req {
        Request::ImportOneNote {
            file_name,
            notebook,
            parent,
            id,
        } => host.import_onenote(
            &file_name,
            need(bytes)?,
            notebook.as_deref(),
            parent.as_deref(),
            id.as_deref(),
        )?,
        Request::ImportMarkdown {
            file_name,
            notebook,
            parent,
            text,
        } => {
            let b = match &text {
                Some(t) => t.as_bytes(),
                None => need(bytes)?,
            };
            host.import_page(PageFormat::Markdown, &file_name, b, &notebook, &parent)?
        }
        Request::ImportHtml {
            file_name,
            notebook,
            parent,
            html,
        } => {
            let b = match &html {
                Some(t) => t.as_bytes(),
                None => need(bytes)?,
            };
            host.import_page(PageFormat::Html, &file_name, b, &notebook, &parent)?
        }
        Request::ImportDocx {
            file_name,
            notebook,
            parent,
        } => host.import_page(
            PageFormat::Docx,
            &file_name,
            need(bytes)?,
            &notebook,
            &parent,
        )?,
        _ => {
            return Err(crate::CoreError::BadRequest(
                "import_file takes an import request".into(),
            ))
        }
    };
    Ok(ResponseBody::FileImported { result })
}

/// Runs one JSON request against `host` and returns the JSON reply.
pub fn dispatch_with(host: &mut NotesHost, request_json: &str) -> String {
    let response = match serde_json::from_str::<Request>(request_json) {
        Ok(request) => {
            if let Ok(Clock { now: Some(now) }) = serde_json::from_str::<Clock>(request_json) {
                host.set_now(now as i64);
            }
            match handle(host, request) {
                Ok(body) => Response::Ok(body),
                Err(e) => Response::Err(e.into()),
            }
        }
        Err(e) => Response::Err(DispatchError::new("bad_request", e.to_string())),
    };
    to_json(&response)
}

fn reply(r: Result<ResponseBody, crate::CoreError>) -> String {
    to_json(&match r {
        Ok(b) => Response::Ok(b),
        Err(e) => Response::Err(e.into()),
    })
}

/// The binary entry points of the shells, with JSON replies in the same `{"ok"}` / `{"err"}` envelope.
pub mod binary {
    use super::{reply, ResponseBody};

    use crate::NotesHost;

    /// `load_doc(notebook, doc, snapshot, log)` → `loaded`.
    pub fn load_doc(
        host: &mut NotesHost,
        notebook: &str,
        doc: &str,
        snapshot: &[u8],
        log: &[u8],
    ) -> String {
        reply(
            host.load_doc(notebook, doc, snapshot, log)
                .map(|warnings| ResponseBody::Loaded { warnings }),
        )
    }

    /// `import_updates(doc, bytes)` → `imported`.
    pub fn import_updates(host: &mut NotesHost, doc: &str, bytes: &[u8]) -> String {
        reply(
            host.import_updates(doc, bytes, None)
                .map(|result| ResponseBody::Imported { result }),
        )
    }

    /// `put_blob(notebook, bytes)`: stores an image / attachment (Blob effect) → the blob id (SHA-256 hex), or
    /// the JSON error reply.
    pub fn put_blob(host: &mut NotesHost, notebook: &str, bytes: &[u8]) -> Result<String, String> {
        host.put_blob(notebook, bytes).map_err(|e| error_json(&e))
    }

    /// `import_backup(bytes)` → `backupImported`.
    pub fn import_backup(host: &mut NotesHost, bytes: &[u8]) -> String {
        reply(host.import_backup(bytes).and_then(|(notebook, warnings)| {
            let tree = host.tree(&notebook.id)?;
            Ok(ResponseBody::BackupImported {
                notebook,
                tree,
                warnings,
            })
        }))
    }

    /// `import_file(request, bytes)`: an `importOneNote` / `importMarkdown` / `importHtml` / `importDocx` request
    /// (JSON, may carry `"now"`) with the file's bytes → `fileImported`.
    pub fn import_file(host: &mut NotesHost, request_json: &str, bytes: &[u8]) -> String {
        let req = match serde_json::from_str::<super::Request>(request_json) {
            Ok(r) => r,
            Err(e) => return reply(Err(crate::CoreError::BadRequest(e.to_string()))),
        };
        set_clock(host, request_json);
        reply(super::import(host, req, Some(bytes)))
    }

    /// `export(request, blobs)`: an `exportPage` / `exportSection` request (JSON) and the bytes of the blobs the
    /// content uses (`{len:u32 LE, bytes}*`, as for `export_backup`) → the file's bytes, or the JSON error reply.
    pub fn export(
        host: &mut NotesHost,
        request_json: &str,
        blobs: &[u8],
    ) -> Result<Vec<u8>, String> {
        let req = serde_json::from_str::<super::Request>(request_json)
            .map_err(|e| error_json(&crate::CoreError::BadRequest(e.to_string())))?;
        set_clock(host, request_json);
        let blobs: std::collections::HashMap<String, Vec<u8>> = crate::split_blobs(blobs)
            .into_iter()
            .map(|b| (crate::blob_id(&b), b))
            .collect();
        let r = match req {
            super::Request::ExportPage { doc_id, format } => {
                host.export_page(&doc_id, format, &blobs)
            }
            super::Request::ExportSection {
                notebook,
                section,
                format,
            } => host.export_section(&notebook, &section, format, &blobs),
            _ => Err(crate::CoreError::BadRequest(
                "export takes an exportPage or exportSection request".into(),
            )),
        };
        r.map_err(|e| error_json(&e))
    }

    fn set_clock(host: &mut NotesHost, request_json: &str) {
        if let Ok(super::Clock { now: Some(now) }) = serde_json::from_str(request_json) {
            host.set_now(now as i64);
        }
    }

    /// An error reply for binary functions that return bytes (thrown by the shells).
    #[must_use]
    pub fn error_json(e: &crate::CoreError) -> String {
        super::to_json(&super::Response::Err(super::DispatchError::new(
            e.code(),
            e.to_string(),
        )))
    }
}

/// Serialises a reply (never fails: an internal error reply instead).
pub(crate) fn to_json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|e| {
        let message = serde_json::to_string(&e.to_string()).unwrap_or_else(|_| "\"\"".into());
        format!(r#"{{"err":{{"code":"internal","message":{message}}}}}"#)
    })
}
