#![forbid(unsafe_code)]
//! Rusuite Write document core (ADR 0005 §2, ADR 0007): the
//! transport-agnostic part shared by the Tauri shell
//! (`apps/write/src-tauri`) and the wasm shell (`apps/write/src-wasm`).
//!
//! * [`WriteDocument`] wraps a [`model_text::Document`] and implements
//!   [`app_common::Document`]: [`WriteCommand`]s in, [`WritePatch`]es out,
//!   each command returning its inverse for undo/redo.
//! * [`dispatch_with`] is the single JSON entry point: a [`Request`] in, a
//!   [`Response`] out, against the shell's [`WriteHost`]. `.docx` files
//!   cross it as standard base64 (`openDocx` / `saveDocx`, ADR 0002 file-IO
//!   amendment); the core never touches the file system.
//! * TypeScript definitions of every wire type (including the
//!   `model-text` types, derived behind its `ts` feature) are generated
//!   with `ts-rs` into `apps/write/src/generated/` by `cargo test`.
//!
//! ```
//! use write_core::{dispatch_with, WriteDocument, WriteHost};
//!
//! let mut host = WriteHost::new(WriteDocument::new());
//! let id = host.doc().document().body[0].id().0;
//! let reply = dispatch_with(
//!     &mut host,
//!     &format!(r#"{{"type":"apply","command":{{"type":"insertText","block":{id},"offset":0,"text":"Hi"}}}}"#),
//! );
//! assert!(reply.starts_with(r#"{"ok":{"type":"patch","envelope":{"revision":1,"#));
//! assert!(reply.contains(r#""text":"Hi""#));
//! ```

mod command;
mod dispatch;
mod doc;
mod find;
mod patch;
mod text;
mod tree;
mod undo_groups;

pub use command::{
    CommentPoint, FieldRefresh, FindFormat, FindMatch, FindQuery, ListKind, MarginsPatch, NewBlock,
    NewCell, NewParagraph, NewRow, NewTable, NewToc, PageSetupPatch, RefShow, RefTarget,
    SectionPatch, ShapeOutline, ShapeOutlinePath, ShapePathQuery, TextCase, WriteCommand,
};
pub use dispatch::{
    dispatch_with, shape_outline, ReaderWarning, Request, Response, ResponseBody, WriteHost,
};
pub use doc::{WriteDocument, WriteError};
pub use patch::{InsertedBlock, WritePatch};
