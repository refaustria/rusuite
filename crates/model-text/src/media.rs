//! Binary media (images) of a document.
//!
//! The types live in [`core_model::media`] (shared with Show, ADR 0008) and
//! are re-exported here unchanged.

pub use core_model::media::*;

// TypeScript mirror of `MediaId` (`core-model` does not depend on `ts-rs`);
// app crates point at it with `#[ts(as = "model_text::media::MediaIdTs")]`.
// The doc comment below is the one emitted into `MediaId.ts`.
/// Id of a [`Media`] item in a [`MediaStore`]. Serializes as a plain number.
#[cfg(feature = "ts")]
#[derive(ts_rs::TS)]
#[ts(export, export_to = "apps/write/src/generated/", rename = "MediaId")]
pub struct MediaIdTs(pub u32);

/// TypeScript shape of one [`MediaStore`] entry (the store serializes as
/// an array of these); only used to generate the TS definitions.
#[cfg(feature = "ts")]
#[derive(ts_rs::TS)]
#[ts(
    export,
    export_to = "apps/write/src/generated/",
    rename_all = "camelCase"
)]
pub struct MediaItem {
    /// Id.
    pub id: MediaIdTs,
    /// MIME type.
    pub content_type: String,
    /// Standard base64 of the bytes.
    pub data: String,
}
