//! JSON snapshots of a [`Presentation`].
//!
//! The snapshot is the presentation itself: node ids are persisted, and the
//! id counter is recomputed on load as the largest id + 1 so newly
//! allocated ids never collide with loaded ones.

use core_model::media::MediaStore;
use core_model::Theme;
use serde::Deserialize;

use crate::layout::Layout;
use crate::presentation::{Presentation, SlideSize};
use crate::slide::Slide;
use crate::Error;

/// The serializable form of a [`Presentation`] (identical to it).
pub type PresentationSnapshot = Presentation;

/// Deserialization shape of [`Presentation`] (everything but the id
/// counter). Missing layouts default to the built-ins for the slide size.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresentationData {
    #[serde(default)]
    slide_size: SlideSize,
    #[serde(default)]
    slides: Vec<Slide>,
    #[serde(default)]
    layouts: Option<[Layout; 3]>,
    #[serde(default)]
    theme: Theme,
    #[serde(default)]
    media: MediaStore,
}

impl From<PresentationData> for Presentation {
    fn from(d: PresentationData) -> Self {
        let mut p = Presentation::empty(d.slide_size);
        p.slides = d.slides;
        if let Some(layouts) = d.layouts {
            p.layouts = layouts;
        }
        p.theme = d.theme;
        p.media = d.media;
        p.next_id = p.max_node_id() + 1;
        p
    }
}

impl Presentation {
    /// Serializes the presentation to JSON.
    pub fn to_json(&self) -> Result<String, Error> {
        Ok(serde_json::to_string(self)?)
    }

    /// Parses a presentation from JSON produced by
    /// [`Presentation::to_json`].
    pub fn from_json(json: &str) -> Result<Self, Error> {
        Ok(serde_json::from_str(json)?)
    }
}
