//! JSON snapshots of a [`Presentation`].
//!
//! The snapshot is the presentation itself: node ids are persisted, and the
//! id counter is recomputed on load as the largest id + 1 so newly
//! allocated ids never collide with loaded ones.

use core_model::media::MediaStore;
use serde::Deserialize;

use crate::layout::{Layout, LayoutKind};
use crate::master::SlideMaster;
use crate::presentation::{Presentation, SlideSize};
use crate::section::Section;
use crate::slide::Slide;
use crate::theme::Theme;
use crate::view::{ShowSettings, ViewProps};
use crate::Error;

/// The serializable form of a [`Presentation`] (identical to it).
pub type PresentationSnapshot = Presentation;

/// Deserialization shape of [`Presentation`] (everything but the id
/// counter). A missing master is the built-in one for the slide size;
/// standard layouts that are missing (older snapshots had three) are added
/// from the master, after the given ones.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresentationData {
    #[serde(default)]
    slide_size: SlideSize,
    #[serde(default)]
    slides: Vec<Slide>,
    #[serde(default)]
    master: Option<SlideMaster>,
    #[serde(default)]
    layouts: Option<Vec<Layout>>,
    #[serde(default)]
    theme: Theme,
    #[serde(default)]
    sections: Vec<Section>,
    #[serde(default)]
    media: MediaStore,
    #[serde(default)]
    view: ViewProps,
    #[serde(default)]
    show_settings: ShowSettings,
}

impl From<PresentationData> for Presentation {
    fn from(d: PresentationData) -> Self {
        let mut p = Presentation::empty(d.slide_size);
        if let Some(m) = d.master {
            p.master = m;
        }
        if let Some(layouts) = d.layouts {
            let mut all = layouts;
            for k in LayoutKind::STANDARD {
                if !all.iter().any(|l| l.kind == k) {
                    all.push(Layout::from_master(k, &p.master, p.slide_size));
                }
            }
            p.layouts = all;
        }
        p.slides = d.slides;
        p.theme = d.theme;
        p.sections = d.sections;
        p.media = d.media;
        p.view = d.view;
        p.show_settings = d.show_settings;
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
