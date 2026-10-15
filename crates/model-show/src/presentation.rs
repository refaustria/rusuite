//! The [`Presentation`]: slide size, slides, layouts, theme and media.

use core_model::media::MediaStore;
use core_model::units::Emu;
use core_model::Theme;
use serde::{Deserialize, Serialize};

use crate::anim::Animation;
use crate::layout::{Layout, LayoutKind};
use crate::shape::{Shape, ShapeKind};
use crate::slide::{find_in, Slide};
use crate::{Error, NodeId, Result};

/// The slide size (`p:sldSz`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct SlideSize {
    /// Width.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Height.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub height: Emu,
}

impl SlideSize {
    /// 16:9 widescreen, 13.333" × 7.5" (PowerPoint's default).
    pub const fn widescreen() -> Self {
        Self {
            width: Emu(12_192_000),
            height: Emu(6_858_000),
        }
    }

    /// 4:3 standard, 10" × 7.5".
    pub const fn standard() -> Self {
        Self {
            width: Emu(9_144_000),
            height: Emu(6_858_000),
        }
    }
}

impl Default for SlideSize {
    fn default() -> Self {
        Self::widescreen()
    }
}

/// A Show presentation.
///
/// Serializes with all node ids; the id counter is not serialized but
/// recomputed on load as the largest id + 1 (see [`crate::snapshot`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "crate::snapshot::PresentationData")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Presentation {
    /// Size of every slide.
    pub slide_size: SlideSize,
    /// Slides in order.
    pub slides: Vec<Slide>,
    /// The built-in layouts, in [`LayoutKind::ALL`] order.
    pub layouts: [Layout; 3],
    /// Theme colors and fonts.
    #[cfg_attr(feature = "ts", ts(as = "crate::ts::Theme"))]
    pub theme: Theme,
    /// Images.
    #[cfg_attr(feature = "ts", ts(as = "Vec<crate::ts::MediaItem>"))]
    pub media: MediaStore,
    #[serde(skip)]
    pub(crate) next_id: u64,
}

impl Default for Presentation {
    fn default() -> Self {
        Self::new()
    }
}

impl Presentation {
    /// A new presentation: 16:9, Office theme, one Title slide with empty
    /// title and subtitle placeholders.
    pub fn new() -> Self {
        let mut p = Self::empty(SlideSize::widescreen());
        p.add_slide(LayoutKind::Title);
        p
    }

    /// A presentation without slides (e.g. for importers), with the
    /// built-in layouts for `slide_size`, Office theme and no media.
    pub fn empty(slide_size: SlideSize) -> Self {
        Self {
            slide_size,
            slides: Vec::new(),
            layouts: LayoutKind::ALL.map(|k| Layout::builtin(k, slide_size)),
            theme: Theme::default(),
            media: MediaStore::new(),
            next_id: 1,
        }
    }

    /// Allocates a fresh, presentation-unique node id.
    pub fn alloc_id(&mut self) -> NodeId {
        let id = NodeId(self.next_id);
        self.next_id += 1;
        id
    }

    /// Makes sure [`alloc_id`](Self::alloc_id) never returns `id` (for
    /// nodes placed with ids chosen elsewhere, e.g. restored by undo).
    pub fn reserve_id(&mut self, id: NodeId) {
        self.next_id = self.next_id.max(id.0.saturating_add(1));
    }

    /// The layout `kind`.
    pub fn layout(&self, kind: LayoutKind) -> &Layout {
        &self.layouts[kind.index()]
    }

    /// Appends a slide with `layout`, holding one empty shape per layout
    /// placeholder (at the placeholder's position, with its body
    /// properties). Returns the slide's id.
    pub fn add_slide(&mut self, layout: LayoutKind) -> NodeId {
        let id = self.alloc_id();
        let mut slide = Slide::new(id, layout);
        for mut shape in self.layouts[layout.index()].placeholder_shapes() {
            self.assign_ids(&mut shape);
            slide.shapes.push(shape);
        }
        self.slides.push(slide);
        id
    }

    /// Inserts a deep copy of slide `id` right after it, with fresh ids for
    /// the slide, all its shapes and its animations (which target the
    /// copied shapes). Returns the copy's id.
    pub fn duplicate_slide(&mut self, id: NodeId) -> Result<NodeId> {
        let index = self.slide_index(id).ok_or(Error::UnknownSlide(id))?;
        let mut copy = self.slides[index].clone();
        copy.id = self.alloc_id();
        let old = shape_ids(&copy.shapes);
        for shape in &mut copy.shapes {
            self.assign_ids(shape);
        }
        let map: std::collections::HashMap<NodeId, NodeId> =
            old.into_iter().zip(shape_ids(&copy.shapes)).collect();
        for a in &mut copy.animations {
            a.id = self.alloc_id();
            if let Some(&new) = map.get(&a.shape) {
                a.shape = new;
            }
        }
        remap_attachments(&mut copy.shapes, &map);
        let new_id = copy.id;
        self.slides.insert(index + 1, copy);
        Ok(new_id)
    }

    /// Moves slide `id` so that it ends up at position `to_index`
    /// (`0..slides.len()`).
    pub fn move_slide(&mut self, id: NodeId, to_index: usize) -> Result<()> {
        let from = self.slide_index(id).ok_or(Error::UnknownSlide(id))?;
        let len = self.slides.len();
        if to_index >= len {
            return Err(Error::SlideIndexOutOfRange {
                index: to_index,
                len,
            });
        }
        let slide = self.slides.remove(from);
        self.slides.insert(to_index, slide);
        Ok(())
    }

    /// Removes slide `id` and returns it (a presentation may end up with
    /// no slides).
    pub fn remove_slide(&mut self, id: NodeId) -> Result<Slide> {
        let index = self.slide_index(id).ok_or(Error::UnknownSlide(id))?;
        Ok(self.slides.remove(index))
    }

    /// Position of slide `id`.
    pub fn slide_index(&self, id: NodeId) -> Option<usize> {
        self.slides.iter().position(|s| s.id == id)
    }

    /// The slide with id `id`.
    pub fn slide(&self, id: NodeId) -> Option<&Slide> {
        self.slides.iter().find(|s| s.id == id)
    }

    /// Mutable access to the slide with id `id`.
    pub fn slide_mut(&mut self, id: NodeId) -> Option<&mut Slide> {
        self.slides.iter_mut().find(|s| s.id == id)
    }

    /// The animation with id `id` and its slide.
    pub fn find_animation(&self, id: NodeId) -> Option<(&Slide, &Animation)> {
        self.slides.iter().find_map(|slide| {
            slide
                .animations
                .iter()
                .find(|a| a.id == id)
                .map(|a| (slide, a))
        })
    }

    /// Checks every slide ([`Slide::validate`]).
    pub fn validate(&self) -> Result<()> {
        self.slides.iter().try_for_each(Slide::validate)
    }

    /// The shape with id `id` (searching inside groups) and its slide.
    pub fn find_shape(&self, id: NodeId) -> Option<(&Slide, &Shape)> {
        self.slides
            .iter()
            .find_map(|slide| find_in(&slide.shapes, id).map(|shape| (slide, shape)))
    }

    /// Mutable access to the shape with id `id` (searching inside groups).
    pub fn find_shape_mut(&mut self, id: NodeId) -> Option<&mut Shape> {
        self.slides
            .iter_mut()
            .find_map(|slide| slide.find_shape_mut(id))
    }

    /// The slide holding shape `shape_id`.
    pub fn slide_of(&self, shape_id: NodeId) -> Option<&Slide> {
        self.find_shape(shape_id).map(|(slide, _)| slide)
    }

    /// Puts `shape` on top of slide `slide_id`, giving it (and, for a
    /// group, its descendants) fresh ids and default names where the name
    /// is empty. Returns the shape's id.
    pub fn add_shape(&mut self, slide_id: NodeId, mut shape: Shape) -> Result<NodeId> {
        let index = self
            .slide_index(slide_id)
            .ok_or(Error::UnknownSlide(slide_id))?;
        self.assign_ids(&mut shape);
        let id = shape.id;
        self.slides[index].shapes.push(shape);
        Ok(id)
    }

    /// Gives `shape` and all its descendants fresh ids; empty names become
    /// PowerPoint-style defaults such as `"Rectangle 4"`
    /// ([`Shape::default_name`] + id).
    pub fn assign_ids(&mut self, shape: &mut Shape) {
        shape.id = self.alloc_id();
        shape.fill_default_name();
        if let ShapeKind::Group { children } = &mut shape.kind {
            for child in children {
                self.assign_ids(child);
            }
        }
    }

    /// Canonicalizes the content: every text body gets at least one
    /// (empty) paragraph. Shapes and their z-order are left unchanged.
    pub fn normalize(&mut self) {
        fn walk(shapes: &mut [Shape]) {
            for s in shapes {
                match &mut s.kind {
                    ShapeKind::Auto {
                        text: Some(body), ..
                    } => body.normalize(),
                    ShapeKind::Group { children } => walk(children),
                    ShapeKind::Table(t) => t.normalize(),
                    _ => {}
                }
            }
        }
        for slide in &mut self.slides {
            walk(&mut slide.shapes);
        }
    }

    /// Largest node id in use (0 if none).
    pub(crate) fn max_node_id(&self) -> u64 {
        fn walk(shapes: &[Shape], max: &mut u64) {
            for s in shapes {
                *max = (*max).max(s.id.0);
                walk(s.children(), max);
            }
        }
        let mut max = 0;
        for slide in &self.slides {
            max = max.max(slide.id.0);
            walk(&slide.shapes, &mut max);
            for a in &slide.animations {
                max = max.max(a.id.0);
            }
        }
        max
    }

    /// Reroutes every attached connector of slide `slide` from the current
    /// positions of the shapes they are glued to (see
    /// [`Slide::reroute_connectors`]). Returns the connectors that changed.
    pub fn reroute_connectors(&mut self, slide: NodeId) -> Result<Vec<NodeId>> {
        Ok(self
            .slide_mut(slide)
            .ok_or(Error::UnknownSlide(slide))?
            .reroute_connectors())
    }
}

/// Points connector attachments of `shapes` (recursively) at the shapes'
/// new ids after a copy (`map`: old id → new id); attachments to shapes
/// outside the map are kept.
pub fn remap_attachments(shapes: &mut [Shape], map: &std::collections::HashMap<NodeId, NodeId>) {
    for s in shapes {
        match &mut s.kind {
            ShapeKind::Connector(c) => {
                for a in [&mut c.start, &mut c.end].into_iter().flatten() {
                    if let Some(&new) = map.get(&a.shape) {
                        a.shape = new;
                    }
                }
            }
            ShapeKind::Group { children } => remap_attachments(children, map),
            _ => {}
        }
    }
}

/// Ids of `shapes` and their descendants, depth-first (a group before its
/// children).
pub(crate) fn shape_ids(shapes: &[Shape]) -> Vec<NodeId> {
    fn walk(shapes: &[Shape], out: &mut Vec<NodeId>) {
        for s in shapes {
            out.push(s.id);
            walk(s.children(), out);
        }
    }
    let mut out = Vec::new();
    walk(shapes, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anim::{AnimationKind, Effect, Transition, TransitionKind};
    use crate::shape::{Preset, Transform};

    #[test]
    fn duplicate_slide_remaps_animations() {
        let mut p = Presentation::empty(SlideSize::widescreen());
        let s = p.add_slide(LayoutKind::Blank);
        let a = p
            .add_shape(s, Shape::auto(Preset::Rect, Transform::default()))
            .unwrap();
        let g = p
            .add_shape(
                s,
                Shape::group(vec![Shape::auto(Preset::Ellipse, Transform::default())]),
            )
            .unwrap();
        let child = p.slide(s).unwrap().shapes[1].children()[0].id;
        let mut anim = Animation::new(a, AnimationKind::Entrance, Effect::Fade);
        anim.id = p.alloc_id();
        let mut anim2 = Animation::new(child, AnimationKind::Emphasis, Effect::Spin);
        anim2.id = p.alloc_id();
        {
            let slide = p.slide_mut(s).unwrap();
            slide.animations = vec![anim, anim2];
            slide.transition = Some(Transition::new(TransitionKind::Fade));
        }
        p.validate().unwrap();
        let copy = p.duplicate_slide(s).unwrap();
        p.validate().unwrap();
        let c = p.slide(copy).unwrap();
        assert_eq!(c.transition, Some(Transition::new(TransitionKind::Fade)));
        assert_eq!(c.animations[0].shape, c.shapes[0].id);
        assert_eq!(c.animations[1].shape, c.shapes[1].children()[0].id);
        assert_ne!(c.animations[0].id, anim.id);
        assert_ne!(c.shapes[1].id, g);
        assert_eq!(p.find_animation(c.animations[1].id).unwrap().0.id, copy);
        // ids survive a snapshot round trip and the counter skips them
        let max = c.animations[1].id;
        let mut back = Presentation::from_json(&p.to_json().unwrap()).unwrap();
        assert_eq!(back, p);
        assert!(back.alloc_id() > max);
    }

    #[test]
    fn connectors_and_tables_copy_and_validate() {
        use crate::connector::{Attach, Connector};
        use crate::geometry::ConnectorKind;
        use core_model::units::Emu;
        let mut p = Presentation::empty(SlideSize::widescreen());
        let s = p.add_slide(LayoutKind::Blank);
        let t = Transform::new(Emu(0), Emu(0), Emu(100), Emu(100));
        let a = p.add_shape(s, Shape::auto(Preset::Rect, t)).unwrap();
        let mut c = Connector::new(ConnectorKind::Elbow);
        c.start = Some(Attach { shape: a, site: 2 });
        let cx = p.add_shape(s, Shape::connector_shape(c, t)).unwrap();
        let tb = p.add_shape(s, Shape::table(2, 2, t)).unwrap();
        p.validate().unwrap();
        // a copied slide's connectors follow the copied shapes
        let copy = p.duplicate_slide(s).unwrap();
        let cs = p.slide(copy).unwrap();
        let conn = cs.shapes[1].connector().unwrap();
        assert_eq!(conn.start.unwrap().shape, cs.shapes[0].id);
        assert_eq!(cs.shapes[1].name, format!("Elbow Connector {}", cx.0));
        let copied = cs.shapes[1].id;
        assert_eq!(p.reroute_connectors(copy).unwrap(), [copied]);
        // invalid attachments and tables are reported
        let slide = p.slide_mut(s).unwrap();
        if let ShapeKind::Connector(c) = &mut slide.find_shape_mut(cx).unwrap().kind {
            c.end = Some(Attach { shape: cx, site: 0 });
        }
        assert!(slide
            .validate()
            .unwrap_err()
            .to_string()
            .contains("cannot take it"));
        if let ShapeKind::Connector(c) = &mut slide.find_shape_mut(cx).unwrap().kind {
            c.end = None;
        }
        slide.find_shape_mut(tb).unwrap().table_mut().unwrap().cells[0][1].covered = true;
        assert!(slide.validate().unwrap_err().to_string().contains("table"));
    }

    #[test]
    fn validation_and_pruning() {
        let mut p = Presentation::empty(SlideSize::widescreen());
        let s = p.add_slide(LayoutKind::Blank);
        let a = p
            .add_shape(s, Shape::auto(Preset::Rect, Transform::default()))
            .unwrap();
        let mut anim = Animation::new(a, AnimationKind::Exit, Effect::FlyIn);
        anim.id = p.alloc_id();
        let slide = p.slide_mut(s).unwrap();
        slide.animations.push(anim);
        assert!(slide.validate().is_ok());
        slide.animations.push(anim);
        assert!(matches!(slide.validate(), Err(Error::InvalidSlide { .. })));
        slide.animations[1].id = NodeId(99);
        slide.animations[1].shape = NodeId(98);
        let err = slide.validate().unwrap_err().to_string();
        assert!(err.contains("not on the slide"), "{err}");
        slide.animations[1].shape = a;
        slide.animations[1].effect = Effect::GrowShrink;
        assert!(slide.validate().is_err());
        slide.animations[1].effect = Effect::Fade;
        assert!(slide.validate().is_ok());
        let mut t = Transition::new(TransitionKind::Fade);
        t.direction = Some(crate::anim::Direction::Up);
        slide.transition = Some(t);
        assert!(slide.validate().is_err());
        slide.transition = None;
        assert_eq!(slide.prune_animations(), 0);
        slide.shapes.clear();
        assert_eq!(slide.prune_animations(), 2);
        assert!(slide.animations.is_empty());
    }
}
