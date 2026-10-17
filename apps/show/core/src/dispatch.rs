//! The JSON entry point both shells call (ADR 0005 §3):
//! [`dispatch_with`]`(host, request_json) -> response_json`.

use app_common::{DispatchError, Envelope, Host, Revision};
use core_model::media::{base64_decode, base64_encode, MediaId};
use model_show::{
    flatten, Adjust, AdjustHandle, BuiltinTheme, ConnectorKind, Presentation, Preset, Site,
    SubPath, TextRect, ViewKind,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::ShowCommand;
use crate::doc::ShowDocument;
use crate::patch::ShowPatch;

/// The document host the shells keep (one per open presentation).
pub type ShowHost = Host<ShowDocument>;

/// What [`PathQuery`] asks the outline of.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum PathKind {
    /// An auto shape's geometry.
    Preset(Preset),
    /// A connector with its number of turns (1–4, see
    /// `Connector.bends`; default 2).
    #[serde(rename_all = "camelCase")]
    Connector {
        kind: ConnectorKind,
        #[serde(default = "two_turns")]
        #[ts(optional, as = "Option<u8>")]
        bends: u8,
    },
}

fn two_turns() -> u8 {
    2
}

/// One shape outline to compute (see [`Request::ShapePaths`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct PathQuery {
    pub kind: PathKind,
    /// Box width (EMU).
    pub w: f64,
    /// Box height (EMU).
    pub h: f64,
    /// Adjust values (absent = defaults).
    #[serde(default, skip_serializing_if = "Adjust::is_empty")]
    #[ts(optional, as = "Option<std::collections::HashMap<String, f64>>")]
    pub adjust: Adjust,
}

/// The outline and connection sites of one [`PathQuery`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct ShapePaths {
    /// Paths in the box (EMU), arcs already turned into cubic curves:
    /// only `moveTo`, `lineTo`, `quadTo`, `cubicTo` and `close`.
    pub paths: Vec<SubPath>,
    /// Connection sites (none for connectors).
    pub sites: Vec<Site>,
    /// The text rectangle (`a:rect`; connectors: the box).
    pub text_rect: TextRect,
    /// Adjust handles (none for connectors: the UI draws their own).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<AdjustHandle>>")]
    pub handles: Vec<AdjustHandle>,
}

impl PathQuery {
    /// Computes the outline.
    pub fn compute(&self) -> ShapePaths {
        match &self.kind {
            PathKind::Preset(p) => ShapePaths {
                paths: p
                    .paths(self.w, self.h, &self.adjust)
                    .into_iter()
                    .map(|sp| SubPath {
                        commands: flatten(&sp.commands),
                        ..sp
                    })
                    .collect(),
                sites: p.connection_sites(self.w, self.h, &self.adjust),
                text_rect: p.text_rect(self.w, self.h, &self.adjust),
                handles: p.handles(self.w, self.h, &self.adjust),
            },
            PathKind::Connector { kind, bends } => ShapePaths {
                paths: vec![SubPath::stroked(flatten(&kind.path(
                    *bends,
                    self.w,
                    self.h,
                    &self.adjust,
                )))],
                sites: Vec::new(),
                text_rect: TextRect {
                    l: 0.0,
                    t: 0.0,
                    r: self.w,
                    b: self.h,
                },
                handles: Vec::new(),
            },
        }
    }
}

/// The window state saved with a presentation (`viewProps.xml`): Normal
/// view zoom (`None` = fit), Slide Sorter zoom, thumbnail pane width and
/// slide / notes split (thousandths of a percent, as `restoredLeft` /
/// `restoredTop`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct ViewState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub zoom: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sorter_zoom: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub restored_left: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub restored_top: Option<u32>,
}

/// A request from the UI. JSON: `{"type":"apply","command":{...}}`,
/// `{"type":"undo"}`, `{"type":"getMedia","id":3}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum Request {
    /// Applies a command → `patch`.
    Apply { command: Box<ShowCommand> },
    /// → `patch` (an empty patch with the current revision when there is
    /// nothing to undo).
    Undo,
    /// → `patch` (empty when there is nothing to redo).
    Redo,
    /// Replaces the presentation by a full `Presentation` (ADR 0008 JSON;
    /// ids must be unique; text bodies are normalized) → `presentation`.
    Load { presentation: Box<Presentation> },
    /// → `presentation` (the whole presentation, media included).
    GetPresentation,
    /// Replaces the presentation by a new one (one title slide) →
    /// `presentation`.
    NewPresentation,
    /// → `media` with the bytes of image `id`.
    GetMedia {
        #[ts(as = "model_show::ts::MediaId")]
        id: MediaId,
    },
    /// Replaces the presentation by a `.pptx` file (standard base64 of its
    /// bytes; `name` is the file name shown to the user) → `opened`.
    OpenPptx { bytes_base64: String, name: String },
    /// Writes the presentation as `.pptx` → `saved`. Does NOT mark it
    /// saved: the shell sends `markSaved` once the file was really written.
    SavePptx {
        /// The view the user is in (Normal, Slide Sorter …), stamped into
        /// `viewProps.xml` `lastView` without an undo step.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        last_view: Option<ViewKind>,
        /// Zoom and pane sizes, stamped likewise (P9-S3).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        view_state: Option<ViewState>,
    },
    /// The whole presentation for crash recovery → `recoverySnapshot` (changes
    /// nothing; the JSON is the input of `restoreRecovery`).
    RecoverySnapshot,
    /// Replaces the presentation by a `recoverySnapshot` JSON and marks it
    /// dirty (it was never saved); `name` becomes the file name →
    /// `presentation`.
    RestoreRecovery {
        json: String,
        #[serde(default)]
        #[ts(optional)]
        name: Option<String>,
    },
    /// → `documentState`.
    DocumentState,
    /// Marks the current state as saved (after the shell wrote the file);
    /// `name` (save as) replaces the file name → `documentState`.
    MarkSaved {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// Outlines (and connection sites) of preset shapes and connectors for
    /// rendering → `shapePaths` (one entry per query, in order). Changes
    /// nothing.
    ShapePaths { queries: Vec<PathQuery> },
    /// The built-in themes (for the Design gallery) → `themes`. Changes
    /// nothing.
    GetThemes,
    /// Reads another `.pptx` file (standard base64) without opening it →
    /// `peeked` with its presentation (media included) and the reader's
    /// warnings; for Reuse Slides. Changes nothing.
    PeekPresentation { bytes_base64: String },
}

/// The successful part of a [`Response`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum ResponseBody {
    /// The reply to `apply`, `undo` and `redo`.
    Patch { envelope: Box<Envelope<ShowPatch>> },
    /// The whole presentation plus the host state (empty patch; after
    /// `load`/`newPresentation` a new revision, clean, no undo).
    Presentation {
        presentation: Box<Presentation>,
        envelope: Box<Envelope<ShowPatch>>,
    },
    /// The reply to `openPptx`: the whole new presentation, the reader's
    /// warnings (dropped or approximated content) and the host state
    /// (empty patch, new revision, clean, no undo).
    Opened {
        presentation: Box<Presentation>,
        warnings: Vec<String>,
        envelope: Box<Envelope<ShowPatch>>,
    },
    /// The reply to `savePptx`: the file (standard base64) and the file
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
    /// The reply to `recoverySnapshot`: the whole presentation as ADR 0008 JSON
    /// plus the host state it was taken at.
    RecoverySnapshot {
        json: String,
        revision: Revision,
        dirty: bool,
        name: Option<String>,
    },
    /// Host state for the title bar: dirty flag, revision and the file
    /// name (`null` for a new presentation).
    DocumentState {
        dirty: bool,
        revision: Revision,
        name: Option<String>,
    },
    /// The reply to `shapePaths`.
    ShapePaths { shapes: Vec<ShapePaths> },
    /// The reply to `getThemes`, in gallery order.
    Themes { themes: Vec<BuiltinTheme> },
    /// The reply to `peekPresentation`.
    Peeked {
        presentation: Box<Presentation>,
        warnings: Vec<String>,
    },
}

/// The reply: `{"ok":{"type":"patch",...}}` or
/// `{"err":{"code":"unknown_shape","message":"..."}}`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum Response {
    Ok(ResponseBody),
    Err(DispatchError),
}

fn handle(host: &mut ShowHost, request: Request) -> Result<ResponseBody, DispatchError> {
    let patch = |env: Option<Envelope<ShowPatch>>, host: &ShowHost| ResponseBody::Patch {
        envelope: Box::new(env.unwrap_or_else(|| host.envelope(ShowPatch::default()))),
    };
    let presentation = |host: &ShowHost| ResponseBody::Presentation {
        presentation: Box::new(host.doc().presentation().clone()),
        envelope: Box::new(host.envelope(ShowPatch::default())),
    };
    let state = |host: &ShowHost| ResponseBody::DocumentState {
        dirty: host.is_dirty(),
        revision: host.revision(),
        name: host.doc().source_name.clone(),
    };
    Ok(match request {
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
        Request::Load { presentation: p } => {
            host.replace(ShowDocument::from_presentation(*p)?);
            presentation(host)
        }
        Request::GetPresentation => presentation(host),
        Request::NewPresentation => {
            host.replace(ShowDocument::new());
            presentation(host)
        }
        Request::GetMedia { id } => {
            let media = host.doc().presentation().media.get(id).ok_or_else(|| {
                DispatchError::new("unknown_media", format!("unknown media {}", id.0))
            })?;
            ResponseBody::Media {
                content_type: media.content_type.clone(),
                bytes_base64: base64_encode(&media.data),
            }
        }
        Request::OpenPptx { bytes_base64, name } => {
            let bytes = base64_decode(&bytes_base64)
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            let (doc, warnings) = ShowDocument::open_pptx(&bytes, &name)?;
            host.replace(doc);
            ResponseBody::Opened {
                presentation: Box::new(host.doc().presentation().clone()),
                warnings,
                envelope: Box::new(host.envelope(ShowPatch::default())),
            }
        }
        Request::SavePptx {
            last_view,
            view_state,
        } => {
            if let Some(v) = last_view {
                host.doc_mut().stamp_last_view(v);
            }
            if let Some(s) = &view_state {
                host.doc_mut().stamp_view_state(s);
            }
            let bytes = host.doc().save_pptx()?;
            ResponseBody::Saved {
                bytes_base64: base64_encode(&bytes),
                suggested_name: host.doc().suggested_name(),
            }
        }
        Request::RecoverySnapshot => ResponseBody::RecoverySnapshot {
            json: serde_json::to_string(host.doc().presentation())
                .map_err(|e| DispatchError::new("internal", e.to_string()))?,
            revision: host.revision(),
            dirty: host.is_dirty(),
            name: host.doc().source_name.clone(),
        },
        Request::RestoreRecovery { json, name } => {
            let p: Presentation = serde_json::from_str(&json)
                .map_err(|e| DispatchError::new("invalid_snapshot", e.to_string()))?;
            let mut doc = ShowDocument::from_presentation(p)?;
            doc.source_name = name;
            host.replace(doc);
            host.mark_dirty();
            presentation(host)
        }
        Request::DocumentState => state(host),
        Request::PeekPresentation { bytes_base64 } => {
            let bytes = base64_decode(&bytes_base64)
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            let (doc, warnings) = ShowDocument::open_pptx(&bytes, "")?;
            ResponseBody::Peeked {
                presentation: Box::new(doc.into_presentation()),
                warnings,
            }
        }
        Request::GetThemes => ResponseBody::Themes {
            themes: model_show::builtin_themes(),
        },
        Request::ShapePaths { queries } => ResponseBody::ShapePaths {
            shapes: queries.iter().map(PathQuery::compute).collect(),
        },
        Request::MarkSaved { name } => {
            if let Some(name) = name {
                host.doc_mut().source_name = Some(name);
            }
            host.mark_saved();
            state(host)
        }
    })
}

/// Decodes a [`Request`], runs it against `host` and encodes the
/// [`Response`]. Never panics on bad input: undecodable JSON yields a
/// `bad_request` error response.
pub fn dispatch_with(host: &mut ShowHost, request_json: &str) -> String {
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
