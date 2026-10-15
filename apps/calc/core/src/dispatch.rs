//! The JSON entry point both shells call (ADR 0005 §3):
//! [`dispatch`]`(host, request_json) -> response_json`.

use app_common::{DispatchError, Envelope, Host, Revision};
use base64::Engine as _;
use model_sheet::{Workbook, WorkbookSnapshot};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::CalcCommand;
use crate::doc::CalcDocument;
use crate::patch::{CalcPatch, RegionSnapshot, WorkbookInfo};

/// The document host the shells keep (one per open document).
pub type CalcHost = Host<CalcDocument>;

/// A request from the UI. JSON: `{"type":"apply","command":{...}}`,
/// `{"type":"undo"}`, `{"type":"snapshot","sheet":0,"r0":0,...}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum Request {
    /// Applies a command → `patch`.
    Apply { command: Box<CalcCommand> },
    /// → `patch` (an empty patch with the current revision when there is
    /// nothing to undo).
    Undo,
    /// → `patch` (empty when there is nothing to redo).
    Redo,
    /// → `snapshot`.
    Snapshot {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// → `info`.
    Info,
    /// Replaces the document by an empty workbook → `info`.
    NewDocument,
    /// Replaces the document by a `WorkbookSnapshot` JSON → `info`.
    LoadSnapshotJson { json: String },
    /// → `snapshotJson` with the whole workbook as `WorkbookSnapshot`
    /// JSON (does not mark the document saved).
    SaveSnapshotJson,
    /// Replaces the document by an `.xlsx` file (standard base64 of its
    /// bytes; `name` is the file name shown to the user) → `opened`.
    OpenXlsx { bytes_base64: String, name: String },
    /// Writes the document as `.xlsx` → `saved`. Does NOT mark it saved:
    /// the shell sends `markSaved` once the file was really written.
    SaveXlsx,
    /// Marks the current state as saved (after the shell wrote the file);
    /// `name` (save as) replaces the document's file name → `documentState`.
    MarkSaved {
        #[serde(default)]
        #[ts(optional)]
        name: Option<String>,
    },
    /// → `documentState`.
    DocumentState,
}

/// The successful part of a [`Response`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum ResponseBody {
    Patch {
        envelope: Envelope<CalcPatch>,
    },
    Snapshot {
        snapshot: RegionSnapshot,
    },
    Info {
        info: WorkbookInfo,
    },
    SnapshotJson {
        json: String,
    },
    /// The reply to `openXlsx`: the new workbook, the reader's warnings
    /// (dropped or approximated content) and the host state (empty patch,
    /// new revision, clean).
    Opened {
        info: WorkbookInfo,
        warnings: Vec<String>,
        envelope: Box<Envelope<CalcPatch>>,
    },
    /// The reply to `saveXlsx`: the file (standard base64) and the file
    /// name to offer.
    Saved {
        bytes_base64: String,
        suggested_name: String,
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
/// `{"err":{"code":"bad_request","message":"..."}}`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum Response {
    Ok(ResponseBody),
    Err(DispatchError),
}

fn handle(host: &mut CalcHost, request: Request) -> Result<ResponseBody, DispatchError> {
    let patch = |env: Option<Envelope<CalcPatch>>, host: &CalcHost| ResponseBody::Patch {
        envelope: env.unwrap_or_else(|| host.envelope(CalcPatch::default())),
    };
    let workbook_info = |host: &CalcHost| WorkbookInfo {
        revision: host.revision(),
        ..host.doc().info()
    };
    let info = |host: &CalcHost| ResponseBody::Info {
        info: workbook_info(host),
    };
    let state = |host: &CalcHost| ResponseBody::DocumentState {
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
        Request::Snapshot {
            sheet,
            r0,
            c0,
            r1,
            c1,
        } => ResponseBody::Snapshot {
            snapshot: host.doc().snapshot(sheet, r0, c0, r1, c1)?,
        },
        Request::Info => info(host),
        Request::NewDocument => {
            host.replace(CalcDocument::new());
            info(host)
        }
        Request::LoadSnapshotJson { json } => {
            let snapshot: WorkbookSnapshot = serde_json::from_str(&json)
                .map_err(|e| DispatchError::new("invalid_snapshot", e.to_string()))?;
            let workbook = Workbook::from_snapshot(&snapshot)
                .map_err(|e| DispatchError::from(crate::CalcError::from(e)))?;
            host.replace(CalcDocument::from_workbook(workbook));
            info(host)
        }
        Request::SaveSnapshotJson => ResponseBody::SnapshotJson {
            json: serde_json::to_string(&host.doc().workbook().to_snapshot())
                .map_err(|e| DispatchError::new("internal", e.to_string()))?,
        },
        Request::OpenXlsx { bytes_base64, name } => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_base64.as_bytes())
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            let (doc, warnings) = CalcDocument::open_xlsx(&bytes, &name)?;
            host.replace(doc);
            ResponseBody::Opened {
                info: workbook_info(host),
                warnings,
                envelope: Box::new(host.envelope(CalcPatch::default())),
            }
        }
        Request::SaveXlsx => {
            let bytes = host.doc().save_xlsx()?;
            ResponseBody::Saved {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                suggested_name: host.doc().suggested_name(),
            }
        }
        Request::MarkSaved { name } => {
            if let Some(name) = name {
                host.doc_mut().source_name = Some(name);
            }
            host.mark_saved();
            state(host)
        }
        Request::DocumentState => state(host),
    })
}

/// Decodes a [`Request`], runs it against `host` and encodes the
/// [`Response`]. Never panics on bad input: undecodable JSON yields a
/// `bad_request` error response.
pub fn dispatch(host: &mut CalcHost, request_json: &str) -> String {
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
