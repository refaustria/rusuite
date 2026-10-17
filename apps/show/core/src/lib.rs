#![forbid(unsafe_code)]
//! Rusuite Show presentation core (ADR 0005 §2, ADR 0008): the
//! transport-agnostic part shared by the Tauri shell
//! (`apps/show/src-tauri`) and the wasm shell (`apps/show/src-wasm`).
//!
//! * [`ShowDocument`] wraps a [`model_show::Presentation`] and implements
//!   [`app_common::Document`]: [`ShowCommand`]s in, [`ShowPatch`]es out
//!   (whole slides), each command returning its exact inverse for
//!   undo/redo.
//! * [`dispatch_with`] is the single JSON entry point: a [`Request`] in, a
//!   [`Response`] out, against the shell's [`ShowHost`]. `.pptx` files
//!   cross it as standard base64 (`openPptx` / `savePptx`, ADR 0002 file-IO
//!   amendments).
//! * TypeScript definitions of every wire type (including the
//!   `model-show` types, derived behind its `ts` feature) are generated
//!   with `ts-rs` into `apps/show/src/generated/` by `cargo test`.
//!
//! ```
//! use show_core::{dispatch_with, ShowDocument, ShowHost};
//!
//! let mut host = ShowHost::new(ShowDocument::new());
//! let slide = host.doc().presentation().slides[0].id.0;
//! let reply = dispatch_with(
//!     &mut host,
//!     &format!(r#"{{"type":"apply","command":{{"type":"addSlide","after":{slide},"layout":"blank","newIds":[-1]}}}}"#),
//! );
//! assert!(reply.starts_with(r#"{"ok":{"type":"patch","envelope":{"revision":1,"#));
//! assert!(reply.contains(r#""idMap":[[-1,4]]"#));
//! ```

mod command;
mod dispatch;
mod doc;
mod image;
mod patch;
mod text;

pub use command::{
    AlignTarget, AnimationPatch, BackgroundTarget, ConnectorPatch, DesignTarget, HfTarget,
    MediaPatch, NewAttach, NewConnector, NewShape, NewShapeKind, PicturePatch, PlaceholderPatch,
    ShowCommand, SlideScale, TableCellPatch, TextParagraphPatch, ThemeChoice, ZOp,
};
pub use dispatch::{
    dispatch_with, PathKind, PathQuery, Request, Response, ResponseBody, ShapePaths, ShowHost,
    ViewState,
};
pub use doc::{ShowDocument, ShowError};
pub use patch::ShowPatch;
