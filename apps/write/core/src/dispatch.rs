//! The JSON entry point both shells call (ADR 0005 §3, ADR 0007 §7):
//! [`dispatch_with`]`(host, request_json) -> response_json`.

use app_common::{DispatchError, Envelope, Host, Patch, Revision};
use model_text::media::{base64_decode, base64_encode};
use model_text::{Document, MediaId, NodeId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{
    FindMatch, FindQuery, ShapeOutline, ShapeOutlinePath, ShapePathQuery, WriteCommand,
};
use crate::doc::WriteDocument;
use crate::patch::WritePatch;

/// A reader warning on the wire (`openDocx`): a stable code (the UI's
/// catalog key is `reader.<code>`), the values of its `{name}`
/// placeholders, the English text (the fallback) and how often it
/// occurred.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct ReaderWarning {
    pub code: String,
    pub params: std::collections::BTreeMap<String, String>,
    pub text: String,
    pub count: usize,
}

impl From<fmt_docx::ReaderWarning> for ReaderWarning {
    fn from(w: fmt_docx::ReaderWarning) -> Self {
        Self {
            code: w.code,
            params: w.params,
            text: w.text,
            count: w.count,
        }
    }
}

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
    /// Replaces the document by an empty one → `document`. `styleSet`
    /// (Design › Set as Default, kept by the UI) formats it from the start
    /// (no undo step, not dirty).
    NewDocument {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        style_set: Option<Box<model_text::StyleSet>>,
    },
    /// → `media` with the bytes of image `id`.
    GetMedia {
        #[ts(as = "model_text::media::MediaIdTs")]
        id: MediaId,
    },
    /// Replaces the document by a `.docx` file (standard base64 of its
    /// bytes; `name` is the file name shown to the user) → `opened`.
    OpenDocx { bytes_base64: String, name: String },
    /// File › New from a template (`.dotx` or `.docx`, standard base64):
    /// an untitled document with the template's styles, numbering,
    /// sections, headers and content; its title, subject, keywords,
    /// comments, category and company stay, author, dates and revision go
    /// (the save stamps them) → `opened`. `name` names the template in
    /// reader warnings only.
    NewFromTemplate { bytes_base64: String, name: String },
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
        /// Save as a template (`.dotx` content type) from now on (`true`)
        /// or as a document (`false`); absent = as before (a file opened
        /// as `.dotx` stays a template).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        template: Option<bool>,
    },
    /// The built-in style sets (Design › Style Sets gallery) and the
    /// document's current one (named `current`) → `styleSets`.
    StyleSets,
    /// File › Info statistics → `statistics`.
    Statistics,
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
    /// The outlines of shape presets (shapes and text boxes, the Insert ›
    /// Shapes gallery icons) → `shapePaths`, one entry per query in order;
    /// unknown presets are drawn as rectangles. Changes nothing.
    ShapePaths { queries: Vec<ShapePathQuery> },
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
        warnings: Vec<ReaderWarning>,
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
    /// The reply to `shapePaths`.
    ShapePaths { shapes: Vec<ShapeOutline> },
    /// The reply to `styleSets`.
    StyleSets {
        sets: Vec<model_text::StyleSet>,
        current: Box<model_text::StyleSet>,
    },
    /// The reply to `statistics`.
    Statistics {
        stats: model_text::DocumentStatistics,
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

type Step = fn(&mut WriteHost) -> Result<Option<Envelope<WritePatch>>, crate::WriteError>;

/// Runs `step` (undo / redo) up to `n` times; the patches are merged into
/// one envelope (the last one's host state). Returns how many ran.
fn repeat(
    host: &mut WriteHost,
    n: usize,
    step: Step,
) -> Result<(Option<Envelope<WritePatch>>, usize), DispatchError> {
    let mut merged: Option<Envelope<WritePatch>> = None;
    let mut done = 0;
    for _ in 0..n.max(1) {
        let Some(env) = step(host)? else { break };
        done += 1;
        merged = Some(match merged {
            None => env,
            Some(mut m) => {
                m.patch.merge(env.patch);
                Envelope {
                    patch: m.patch,
                    ..env
                }
            }
        });
    }
    Ok((merged, done))
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
            | Request::NewDocument { .. }
            | Request::OpenDocx { .. }
            | Request::NewFromTemplate { .. }
            | Request::RestoreRecovery { .. }
    );
    let body = match request {
        Request::Apply { command } => {
            let limit = host.undo_limit();
            let planned = host.doc().undo_groups.plan(&command);
            let env = host.apply(*command)?;
            host.doc_mut().undo_groups.applied(planned, limit);
            patch(Some(env), host)
        }
        // One step = a typing run (Word): several host entries, one reply.
        Request::Undo => {
            let n = host.doc_mut().undo_groups.take_undo();
            let (env, done) = repeat(host, n, WriteHost::undo)?;
            if done > 0 {
                host.doc_mut().undo_groups.undone(done);
            }
            patch(env, host)
        }
        Request::Redo => {
            let n = host.doc_mut().undo_groups.take_redo();
            let (env, done) = repeat(host, n, WriteHost::redo)?;
            if done > 0 {
                host.doc_mut().undo_groups.redone(done);
            }
            patch(env, host)
        }
        Request::Load { document: doc } => {
            host.replace(WriteDocument::from_document(*doc)?);
            document(host)
        }
        Request::GetDocument => document(host),
        Request::NewDocument { style_set } => {
            let mut doc = WriteDocument::new();
            if let Some(set) = style_set {
                doc.use_style_set(&set);
            }
            host.replace(doc);
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
            let (doc, warnings) = WriteDocument::open_docx_coded(&bytes, &name)?;
            let warnings = warnings.into_iter().map(ReaderWarning::from).collect();
            host.replace(doc);
            ResponseBody::Opened {
                doc: Box::new(host.doc().snapshot()),
                warnings,
                envelope: Box::new(host.envelope(WritePatch::default())),
            }
        }
        Request::NewFromTemplate { bytes_base64, name } => {
            let bytes = base64_decode(&bytes_base64)
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            let (doc, warnings) = WriteDocument::new_from_template(&bytes, &name)?;
            let warnings = warnings.into_iter().map(ReaderWarning::from).collect();
            host.replace(doc);
            ResponseBody::Opened {
                doc: Box::new(host.doc().snapshot()),
                warnings,
                envelope: Box::new(host.envelope(WritePatch::default())),
            }
        }
        Request::StyleSets => ResponseBody::StyleSets {
            sets: model_text::StyleSet::builtins(),
            current: Box::new(host.doc().document().styles.capture_style_set("current")),
        },
        Request::Statistics => ResponseBody::Statistics {
            stats: host.doc().document().statistics(),
        },
        Request::SaveDocx {
            modified,
            user,
            pages,
            template,
        } => {
            if let Some(t) = template {
                host.doc_mut().set_template(t);
            }
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
        Request::ShapePaths { queries } => ResponseBody::ShapePaths {
            shapes: queries.iter().map(shape_outline).collect(),
        },
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

/// The outline of one preset query, from the shared preset geometry
/// (`model_show::geometry`, ECMA-376 preset definitions).
pub fn shape_outline(q: &ShapePathQuery) -> ShapeOutline {
    use model_show::geometry::{flatten, PathCmd, Preset};
    let preset = Preset::from_prst(&q.preset).unwrap_or(Preset::Rect);
    let (w, h) = (q.w.clamp(1.0, 1e9), q.h.clamp(1.0, 1e9));
    let n = |v: f64| format!("{}", (v * 100.0).round() / 100.0);
    let paths = preset
        .paths(w, h, &q.adjust)
        .into_iter()
        .map(|p| {
            let mut d = String::new();
            for c in flatten(&p.commands) {
                if !d.is_empty() {
                    d.push(' ');
                }
                match c {
                    PathCmd::MoveTo { x, y } => d.push_str(&format!("M{} {}", n(x), n(y))),
                    PathCmd::LineTo { x, y } => d.push_str(&format!("L{} {}", n(x), n(y))),
                    PathCmd::QuadTo { x1, y1, x, y } => {
                        d.push_str(&format!("Q{} {} {} {}", n(x1), n(y1), n(x), n(y)))
                    }
                    PathCmd::CubicTo {
                        x1,
                        y1,
                        x2,
                        y2,
                        x,
                        y,
                    } => d.push_str(&format!(
                        "C{} {} {} {} {} {}",
                        n(x1),
                        n(y1),
                        n(x2),
                        n(y2),
                        n(x),
                        n(y)
                    )),
                    PathCmd::Close => d.push('Z'),
                    PathCmd::ArcTo { .. } => {}
                }
            }
            ShapeOutlinePath {
                d,
                fill: p.fill,
                stroke: p.stroke,
                darken: p.darken,
            }
        })
        .collect();
    ShapeOutline {
        paths,
        defaults: preset
            .adjust_defaults()
            .iter()
            .map(|(k, v)| ((*k).to_owned(), *v))
            .collect(),
    }
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
