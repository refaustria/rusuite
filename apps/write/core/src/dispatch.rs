//! The JSON entry point both shells call (ADR 0005 §3, ADR 0007 §7):
//! [`dispatch_with`]`(host, request_json) -> response_json`.

use app_common::{DispatchError, Envelope, Host, Revision};
use model_text::media::{base64_decode, base64_encode};
use model_text::{Document, MediaId, NodeId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{FindMatch, FindQuery, WriteCommand};
use crate::doc::WriteDocument;
use crate::patch::WritePatch;

/// The document host the shells keep (one per open document).
pub type WriteHost = Host<WriteDocument>;

/// A request from the UI. JSON: `{"type":"apply","command":{...}}`,
/// `{"type":"undo"}`, `{"type":"getMedia","id":3}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/write/src/generated/")]
pub enum Request {
    /// Applies a command → `patch`.
    Apply { command: Box<WriteCommand> },
    /// → `patch` (an empty patch with the current revision when there is
    /// nothing to undo).
    Undo,
    /// → `patch` (empty when there is nothing to redo).
    Redo,
    /// Replaces the document by a full `Document` (ADR 0006 JSON; ids must
    /// be unique; the document is normalized) → `document`.
    Load { document: Box<Document> },
    /// → `document` (the whole document, media included).
    GetDocument,
    /// Replaces the document by an empty one → `document`.
    NewDocument,
    /// → `media` with the bytes of image `id`.
    GetMedia {
        #[ts(as = "model_text::media::MediaIdTs")]
        id: MediaId,
    },
    /// Replaces the document by a `.docx` file (standard base64 of its
    /// bytes; `name` is the file name shown to the user) → `opened`.
    OpenDocx { bytes_base64: String, name: String },
    /// Writes the document as `.docx` → `saved`. Does NOT mark it saved:
    /// the shell sends `markSaved` once the file was really written. The
    /// optional fields stamp the document properties first (`modified` =
    /// the UI's clock, ISO 8601; `user` = last modified by; `pages` = the
    /// page count of the pagination; revision + 1) — not an edit.
    SaveDocx {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        modified: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        user: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pages: Option<u32>,
    },
    /// The whole document for crash recovery → `recoverySnapshot` (changes
    /// nothing; the JSON is the input of `restoreRecovery`).
    RecoverySnapshot,
    /// Replaces the document by a `recoverySnapshot` JSON and marks it
    /// dirty (it was never saved); `name` becomes the file name →
    /// `document`.
    RestoreRecovery {
        json: String,
        #[serde(default)]
        #[ts(optional)]
        name: Option<String>,
    },
    /// → `documentState`.
    DocumentState,
    /// The paragraphs (all containers) using style `id` (Word's "Select
    /// All n Instances"; see `Document::blocks_with_style`) → `blockIds`.
    BlocksWithStyle { id: String },
    /// The matches of a search (Find and Replace with formatting or
    /// wildcards; body paragraphs, table cells included) → `findMatches`.
    Find { query: Box<FindQuery> },
    /// Sets the author of new comments and replies for this document (the
    /// UI remembers it in the browser / app data and sends it after every
    /// load; empty `initials` are derived from the name, an empty name
    /// clears it). Not an edit: no undo step, not dirty →
    /// `documentState`.
    SetUser {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        initials: Option<String>,
    },
    /// Marks the current state as saved (after the shell wrote the file);
    /// `name` (save as) replaces the document's file name →
    /// `documentState`.
    MarkSaved {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
}

/// The successful part of a [`Response`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/write/src/generated/")]
pub enum ResponseBody {
    /// The reply to `apply`, `undo` and `redo`.
    Patch { envelope: Box<Envelope<WritePatch>> },
    /// The whole document plus the host state (empty patch; after
    /// `load`/`newDocument` a new revision, clean, no undo).
    Document {
        doc: Box<Document>,
        envelope: Box<Envelope<WritePatch>>,
    },
    /// The reply to `openDocx`: the whole new document, the reader's
    /// warnings (dropped or approximated content) and the host state
    /// (empty patch, new revision, clean, no undo).
    Opened {
        doc: Box<Document>,
        warnings: Vec<String>,
        envelope: Box<Envelope<WritePatch>>,
    },
    /// The reply to `saveDocx`: the file (standard base64) and the file
    /// name to offer.
    Saved {
        bytes_base64: String,
        suggested_name: String,
    },
    /// An image: MIME type and standard base64 of the bytes.
    Media {
        content_type: String,
        bytes_base64: String,
    },
    /// The reply to `recoverySnapshot`: the whole document as ADR 0006 JSON
    /// plus the host state it was taken at.
    RecoverySnapshot {
        json: String,
        revision: Revision,
        dirty: bool,
        name: Option<String>,
    },
    /// Block ids, in document order.
    BlockIds { ids: Vec<NodeId> },
    /// Find results in document order, with the revision they belong to.
    FindMatches {
        matches: Vec<FindMatch>,
        revision: Revision,
    },
    /// Host state for the title bar: dirty flag, revision and the file
    /// name (`null` for a new document).
    DocumentState {
        dirty: bool,
        revision: Revision,
        name: Option<String>,
    },
}

/// The reply: `{"ok":{"type":"patch",...}}` or
/// `{"err":{"code":"unknown_block","message":"..."}}`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub enum Response {
    Ok(ResponseBody),
    Err(DispatchError),
}

fn handle(host: &mut WriteHost, request: Request) -> Result<ResponseBody, DispatchError> {
    let patch = |env: Option<Envelope<WritePatch>>, host: &WriteHost| ResponseBody::Patch {
        envelope: Box::new(env.unwrap_or_else(|| host.envelope(WritePatch::default()))),
    };
    let document = |host: &WriteHost| ResponseBody::Document {
        doc: Box::new(host.doc().snapshot()),
        envelope: Box::new(host.envelope(WritePatch::default())),
    };
    let state = |host: &WriteHost| ResponseBody::DocumentState {
        dirty: host.is_dirty(),
        revision: host.revision(),
        name: host.doc().source_name.clone(),
    };
    // The comment author stays when the document is replaced.
    let user = host.doc().user.clone();
    let replaces = matches!(
        request,
        Request::Load { .. }
            | Request::NewDocument
            | Request::OpenDocx { .. }
            | Request::RestoreRecovery { .. }
    );
    let body = match request {
        Request::Apply { command } => {
            let env = host.apply(*command)?;
            patch(Some(env), host)
        }
        Request::Undo => {
            let env = host.undo()?;
            patch(env, host)
        }
        Request::Redo => {
            let env = host.redo()?;
            patch(env, host)
        }
        Request::Load { document: doc } => {
            host.replace(WriteDocument::from_document(*doc)?);
            document(host)
        }
        Request::GetDocument => document(host),
        Request::NewDocument => {
            host.replace(WriteDocument::new());
            document(host)
        }
        Request::GetMedia { id } => {
            let media = host.doc().document().media.get(id).ok_or_else(|| {
                DispatchError::new("unknown_media", format!("unknown media {}", id.0))
            })?;
            ResponseBody::Media {
                content_type: media.content_type.clone(),
                bytes_base64: base64_encode(&media.data),
            }
        }
        Request::OpenDocx { bytes_base64, name } => {
            let bytes = base64_decode(&bytes_base64)
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            let (doc, warnings) = WriteDocument::open_docx(&bytes, &name)?;
            host.replace(doc);
            ResponseBody::Opened {
                doc: Box::new(host.doc().snapshot()),
                warnings,
                envelope: Box::new(host.envelope(WritePatch::default())),
            }
        }
        Request::SaveDocx {
            modified,
            user,
            pages,
        } => {
            if modified.is_some() || user.is_some() || pages.is_some() {
                host.doc_mut()
                    .stamp_save(modified.as_deref(), user.as_deref(), pages);
            }
            let bytes = host.doc().save_docx()?;
            ResponseBody::Saved {
                bytes_base64: base64_encode(&bytes),
                suggested_name: host.doc().suggested_name(),
            }
        }
        Request::RecoverySnapshot => ResponseBody::RecoverySnapshot {
            json: serde_json::to_string(host.doc().document())
                .map_err(|e| DispatchError::new("internal", e.to_string()))?,
            revision: host.revision(),
            dirty: host.is_dirty(),
            name: host.doc().source_name.clone(),
        },
        Request::RestoreRecovery { json, name } => {
            let doc: Document = serde_json::from_str(&json)
                .map_err(|e| DispatchError::new("invalid_snapshot", e.to_string()))?;
            let mut doc = WriteDocument::from_document(doc)?;
            doc.source_name = name;
            host.replace(doc);
            host.mark_dirty();
            document(host)
        }
        Request::DocumentState => state(host),
        Request::BlocksWithStyle { id } => ResponseBody::BlockIds {
            ids: host.doc().document().blocks_with_style(&id),
        },
        Request::Find { query } => ResponseBody::FindMatches {
            matches: host.doc().find(&query)?,
            revision: host.revision(),
        },
        Request::SetUser { name, initials } => {
            host.doc_mut().set_user(&name, initials.as_deref());
            state(host)
        }
        Request::MarkSaved { name } => {
            if let Some(name) = name {
                host.doc_mut().source_name = Some(name);
            }
            host.mark_saved();
            state(host)
        }
    };
    if replaces {
        host.doc_mut().user = user;
    }
    Ok(body)
}

/// Decodes a [`Request`], runs it against `host` and encodes the
/// [`Response`]. Never panics on bad input: undecodable JSON yields a
/// `bad_request` error response.
pub fn dispatch_with(host: &mut WriteHost, request_json: &str) -> String {
    let response = match serde_json::from_str::<Request>(request_json) {
        Ok(request) => match handle(host, request) {
            Ok(body) => Response::Ok(body),
            Err(e) => Response::Err(e),
        },
        Err(e) => Response::Err(DispatchError::new("bad_request", e.to_string())),
    };
    serde_json::to_string(&response).unwrap_or_else(|e| {
        let message = serde_json::to_string(&e.to_string()).unwrap_or_else(|_| "\"\"".into());
        format!(r#"{{"err":{{"code":"internal","message":{message}}}}}"#)
    })
}
