//! Rusuite Notes relay (P11-N5a, spec section 4.4): a blind store-and-forward service for shared notebooks.
//!
//! `GET /api/notes/ws` (WebSocket, binary frames, [`notes_sync::protocol`]) – subscribe, catch up, publish.
//! `DELETE /api/notes/notebooks/{id}` – owner-signed "stop sharing" (also available over the WebSocket).
//! `GET /api/notes/health` → `{ ok, version }`.
//!
//! The relay never decrypts anything (it has no keys). It verifies every envelope's Ed25519 signature and the
//! member-list chain, accepts content only from current members whose role allows it, keeps per-doc append-only logs
//! with sequence numbers, drops log entries covered by a client-uploaded snapshot, and stores no IP addresses or
//! names. Protocol and threat model: `docs/notes-sync-protocol.md`.

#![forbid(unsafe_code)]

pub mod clock;
pub mod config;
pub mod relay;
pub mod server;
pub mod store;

pub use clock::{Clock, ManualClock, SystemClock};
pub use config::{Config, ConfigError, Limits};
pub use relay::Relay;
pub use server::router;

/// The crate version (reported by the health check).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
