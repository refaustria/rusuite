//! TypeScript-only mirrors of `core-model` types that appear in the Show
//! model (`core-model` depends on `ts-rs` only for its `geometry` module,
//! behind its `ts` feature, which this crate's `ts` enables). They copy the serde
//! shape exactly and exist only to generate the TS definitions; model types
//! point at them with `#[ts(as = "...")]`. A test round-trips real values
//! through them to catch drift.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// The doc comment below is the one emitted into `MediaId.ts`.
/// Id of an image in the presentation's media store. Serializes as a
/// plain number.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct MediaId(pub u32);

/// One entry of the media store (the store serializes as an array of
/// these).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct MediaItem {
    /// Id.
    pub id: MediaId,
    /// MIME type.
    pub content_type: String,
    /// Standard base64 of the bytes.
    pub data: String,
}

/// Mirror of `core_model::ColorScheme`: 12 colors in theme-slot order
/// (dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct ColorScheme {
    /// Scheme name.
    pub name: String,
    /// Colors as 6-digit hex strings.
    pub colors: Vec<app_common::wire::Rgb>,
}

/// Mirror of `core_model::FontScheme`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct FontScheme {
    /// Scheme name.
    pub name: String,
    /// Major Latin font.
    pub major_latin: String,
    /// Minor Latin font.
    pub minor_latin: String,
    /// Major East Asian font.
    pub major_east_asian: String,
    /// Minor East Asian font.
    pub minor_east_asian: String,
    /// Major complex-script font.
    pub major_complex_script: String,
    /// Minor complex-script font.
    pub minor_complex_script: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirrors_match_core_model() {
        let theme = core_model::Theme::default();
        let json = serde_json::to_value(&theme.colors).unwrap();
        let mirror: ColorScheme = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&mirror).unwrap(), json);
        let json = serde_json::to_value(&theme.fonts).unwrap();
        let mirror: FontScheme = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&mirror).unwrap(), json);

        let mut store = core_model::MediaStore::new();
        store.insert("image/png", vec![1, 2, 3]);
        let json = serde_json::to_value(&store).unwrap();
        let mirror: Vec<MediaItem> = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&mirror).unwrap(), json);
    }
}
