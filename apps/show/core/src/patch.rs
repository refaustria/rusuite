//! [`ShowPatch`]: what changed, reported after every command, undo and
//! redo. Patches are per slide: a slide whose content changed is sent
//! whole (shapes are small).

use app_common::Patch;
use model_show::{
    CustomShow, Design, Layout, NodeId, Section, ShowSettings, Slide, SlideMaster, SlideSize,
    Theme, ViewProps,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The authoritative changes of one command, undo or redo.
///
/// The UI removes `deletedSlides`, then replaces (or adds) every slide of
/// `slides` by id, then, when `slidesOrder` is present, reorders its
/// slides to exactly that list. `theme`, `master` and `layouts` come
/// together whenever any of them changed; `sections` whenever they
/// changed.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct ShowPatch {
    /// All slide ids in order, when slides were added, removed or moved.
    pub slides_order: Option<Vec<NodeId>>,
    /// Full slides that are new or whose content changed.
    pub slides: Vec<Slide>,
    /// Removed slides.
    pub deleted_slides: Vec<NodeId>,
    /// `[temporary id, real id]` for every temporary id of the command.
    #[ts(type = "Array<[number, NodeId]>")]
    pub id_map: Vec<(i64, NodeId)>,
    /// The slide size, when it changed.
    pub slide_size: Option<SlideSize>,
    /// The theme, when it (or the master or a layout) changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub theme: Option<Theme>,
    /// The master, when the design changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub master: Option<SlideMaster>,
    /// All layouts, when the design changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub layouts: Option<Vec<Layout>>,
    /// All further designs (P9-S5), when the design changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub designs: Option<Vec<Design>>,
    /// All sections, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sections: Option<Vec<Section>>,
    /// The view settings (guides, grid …), when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub view: Option<ViewProps>,
    /// The Set Up Slide Show options, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_settings: Option<ShowSettings>,
    /// All custom shows, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub custom_shows: Option<Vec<CustomShow>>,
    /// A message for the status bar.
    pub info: Option<String>,
}

impl ShowPatch {
    /// Whether nothing changed.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

impl Patch for ShowPatch {
    /// Folds a later patch into this one (the document folds compound
    /// commands itself; this is for callers combining replies).
    fn merge(&mut self, other: Self) {
        for id in other.deleted_slides {
            self.slides.retain(|s| s.id != id);
            if !self.deleted_slides.contains(&id) {
                self.deleted_slides.push(id);
            }
        }
        for slide in other.slides {
            self.deleted_slides.retain(|id| *id != slide.id);
            match self.slides.iter_mut().find(|s| s.id == slide.id) {
                Some(slot) => *slot = slide,
                None => self.slides.push(slide),
            }
        }
        if other.slides_order.is_some() {
            self.slides_order = other.slides_order;
        }
        self.id_map.extend(other.id_map);
        if other.slide_size.is_some() {
            self.slide_size = other.slide_size;
        }
        if other.theme.is_some() {
            self.theme = other.theme;
            self.master = other.master;
            self.layouts = other.layouts;
            self.designs = other.designs;
        }
        if other.sections.is_some() {
            self.sections = other.sections;
        }
        if other.view.is_some() {
            self.view = other.view;
        }
        if other.show_settings.is_some() {
            self.show_settings = other.show_settings;
        }
        if other.custom_shows.is_some() {
            self.custom_shows = other.custom_shows;
        }
        if other.info.is_some() {
            self.info = other.info;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_show::LayoutKind;

    #[test]
    fn merge_folds_later_changes() {
        let s = |n| Slide::new(NodeId(n), LayoutKind::Blank);
        let mut a = ShowPatch {
            slides: vec![s(1), s(2)],
            id_map: vec![(-1, NodeId(2))],
            ..Default::default()
        };
        a.merge(ShowPatch {
            slides_order: Some(vec![NodeId(1)]),
            deleted_slides: vec![NodeId(2)],
            slide_size: Some(SlideSize::standard()),
            info: Some("x".into()),
            ..Default::default()
        });
        assert_eq!(a.slides, vec![s(1)]);
        assert_eq!(a.deleted_slides, vec![NodeId(2)]);
        a.merge(ShowPatch {
            slides: vec![s(2)],
            ..Default::default()
        });
        assert!(a.deleted_slides.is_empty());
        assert_eq!(a.slides.len(), 2);
        assert_eq!(a.slide_size, Some(SlideSize::standard()));
        assert!(!a.is_empty());
    }
}
