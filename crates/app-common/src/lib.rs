#![forbid(unsafe_code)]
//! Shared app plumbing (ADR 0001, 0002, 0005): the transport-agnostic
//! document [`Host`] (undo/redo, revision, dirty flag), the [`Document`]
//! trait every app core implements, and the wire types shared by all
//! apps ([`Revision`], [`Envelope`], [`DispatchError`] and the TypeScript
//! mirrors of `core-model` types in [`wire`]), and the recent-files /
//! crash-recovery [`session`].
//!
//! TypeScript definitions are generated with `ts-rs` into
//! `packages/ui-shared/src/generated/` when `cargo test -p app-common`
//! runs; CI fails when the committed files are stale.
//!
//! ```
//! use app_common::{Applied, Document, Host, Patch};
//! use serde::{Deserialize, Serialize};
//!
//! /// A document holding one number.
//! struct Counter(i64);
//!
//! #[derive(Clone, Serialize, Deserialize)]
//! struct Add(i64);
//!
//! #[derive(Default, Serialize)]
//! struct NewValue(Option<i64>);
//!
//! impl Patch for NewValue {
//!     fn merge(&mut self, other: Self) {
//!         if other.0.is_some() {
//!             *self = other;
//!         }
//!     }
//! }
//!
//! impl Document for Counter {
//!     type Command = Add;
//!     type Patch = NewValue;
//!     type Error = std::convert::Infallible;
//!     fn apply(&mut self, cmd: &Add) -> Result<Applied<Add, NewValue>, Self::Error> {
//!         self.0 += cmd.0;
//!         Ok(Applied { patch: NewValue(Some(self.0)), inverse: Some(Add(-cmd.0)) })
//!     }
//! }
//!
//! let mut host = Host::new(Counter(0));
//! let env = host.apply(Add(5)).unwrap();
//! assert_eq!((env.revision.0, env.patch.0, env.can_undo, env.dirty), (1, Some(5), true, true));
//! host.undo().unwrap();
//! assert_eq!(host.doc().0, 0);
//! assert!(!host.is_dirty() && host.can_redo());
//! ```

pub mod connector;
#[cfg(feature = "tauri-connectors")]
pub mod connectors_tauri;
pub mod host;
pub mod session;
#[cfg(feature = "webdav")]
pub mod webdav;
pub mod wire;

pub use host::{Applied, Document, Envelope, Host, Patch, Revision, DEFAULT_UNDO_LIMIT};
pub use wire::DispatchError;
