//! Rusuite's "Report a problem" relay (P8-43, ADR 0009 amendment "Report a problem").
//!
//! One endpoint, `POST /api/report`, receives the report the user submitted in an app's dialog and turns it into a
//! public GitHub issue (screenshots committed to the `issue-attachments` branch and linked from the body). The relay
//! holds the GitHub token (environment only, never logged or echoed), stores nothing except in-memory rate-limit
//! counters (lost on restart) and logs one line per request without any of the report's text or images.
//!
//! `GET /api/report/health` → `{ ok, version }`.

#![forbid(unsafe_code)]

pub mod config;
pub mod github;
pub mod issue;
pub mod limits;
pub mod report;
pub mod server;

pub use config::{Config, ConfigError};
pub use limits::{Clock, ManualClock, SystemClock};
pub use server::{router, AppState};

/// The crate version (reported by the health check).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
