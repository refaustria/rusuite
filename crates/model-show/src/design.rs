//! Further designs (P9-S5): a presentation's main design is its
//! [`master`](crate::Presentation::master), [`layouts`](crate::Presentation::layouts)
//! and [`theme`](crate::Presentation::theme); a [`Design`] is one more
//! slide master with its own theme and layouts – what PowerPoint creates
//! when slides are reused with "Keep source formatting", and what files
//! with several `p:sldMasterId`s hold. A slide uses a further design when
//! its [`design`](crate::Slide::design) names it; layouts are looked up
//! among that design's.

use serde::{Deserialize, Serialize};

use crate::layout::{Layout, LayoutKind};
use crate::master::SlideMaster;
use crate::presentation::SlideSize;
use crate::theme::Theme;

/// A further slide master with its theme and layouts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Design {
    /// Presentation-unique, ≥ 1 (slides refer to it).
    pub id: u32,
    /// The master.
    pub master: SlideMaster,
    /// Its layouts, in file order; kinds are unique.
    pub layouts: Vec<Layout>,
    /// Its theme.
    pub theme: Theme,
}

impl Design {
    /// The design's name as PowerPoint lists it: the master's name, else
    /// the theme's.
    pub fn name(&self) -> &str {
        if self.master.name.is_empty() {
            &self.theme.name
        } else {
            &self.master.name
        }
    }

    /// Whether `other` is the same design (PowerPoint deduplicates reused
    /// masters by name; Rusuite also compares the theme and the master's
    /// text styles and background, so different masters of the same name
    /// stay apart).
    pub fn same_as(&self, master: &SlideMaster, theme: &Theme) -> bool {
        self.master.name == master.name
            && self.theme == *theme
            && self.master.text_styles == master.text_styles
            && self.master.background == master.background
            && self.master.color_map == master.color_map
    }
}

/// A design borrowed from a presentation: the main one or a [`Design`].
#[derive(Debug, Clone, Copy)]
pub struct DesignRef<'a> {
    /// `None`: the main design.
    pub id: Option<u32>,
    /// The master.
    pub master: &'a SlideMaster,
    /// Its layouts.
    pub layouts: &'a [Layout],
    /// Its theme.
    pub theme: &'a Theme,
}

impl<'a> DesignRef<'a> {
    /// Layout `kind`, if the design has it.
    pub fn layout(&self, kind: &LayoutKind) -> Option<&'a Layout> {
        self.layouts.iter().find(|l| &l.kind == kind)
    }

    /// Layout `kind`, or – for a standard kind the design lacks – the
    /// built-in one for its master.
    pub fn layout_or_builtin(&self, kind: &LayoutKind, size: SlideSize) -> Layout {
        self.layout(kind)
            .cloned()
            .unwrap_or_else(|| Layout::from_master(kind.clone(), self.master, size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LayoutKind, Presentation};

    fn deck() -> Presentation {
        let mut p = Presentation::new();
        let size = p.slide_size;
        let mut master = SlideMaster::builtin(size);
        master.name = "Second".into();
        let layouts = vec![Layout::from_master(LayoutKind::Title, &master, size)];
        p.designs.push(Design {
            id: 4,
            master,
            layouts,
            theme: Theme {
                name: "Other".into(),
                ..Theme::default()
            },
        });
        p
    }

    #[test]
    fn designs_resolve_swap_and_validate() {
        let mut p = deck();
        let id = p.add_slide(LayoutKind::TitleContent);
        p.slide_mut(id).unwrap().design = Some(4);
        p.validate().unwrap();
        let s = p.slide(id).unwrap().clone();
        assert_eq!(p.design_of(&s).master.name, "Second");
        assert_eq!(p.design_of(&s).theme.name, "Other");
        // a standard layout the design lacks comes from its master
        assert_eq!(p.slide_layout(&s).kind, LayoutKind::TitleContent);
        assert_eq!(p.design(None).id, None);
        assert_eq!(
            p.design(Some(99)).id,
            None,
            "unknown ids are the main design"
        );
        assert_eq!(p.next_design_id(), 5);
        assert_eq!(p.designs[0].name(), "Second");
        // swapping twice restores
        let before = p.clone();
        assert!(p.swap_design(4));
        assert_eq!(p.master.name, "Second");
        assert!(p.swap_design(4));
        assert_eq!(p, before);
        assert!(!p.swap_design(7));
        // a slide on a missing design, a duplicate id, a custom layout the design lacks
        let mut bad = p.clone();
        bad.slide_mut(id).unwrap().design = Some(8);
        assert!(bad.validate().is_err());
        let mut dup = p.clone();
        let again = dup.designs[0].clone();
        dup.designs.push(again);
        assert!(dup.validate().is_err());
        let mut custom = p.clone();
        custom.slide_mut(id).unwrap().layout = LayoutKind::Custom("Nope".into());
        assert!(custom.validate().is_err());
        // same_as compares name, theme, styles, background and colour map
        let d = &p.designs[0];
        assert!(d.same_as(&d.master, &d.theme));
        assert!(!d.same_as(&p.master, &d.theme));
        // snapshots keep designs and the slide's design
        let back = Presentation::from_json(&p.to_json().unwrap()).unwrap();
        assert_eq!(back.designs, p.designs);
        assert_eq!(back.slide(id).unwrap().design, Some(4));
    }
}
