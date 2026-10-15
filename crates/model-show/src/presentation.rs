//! The [`Presentation`]: slide size, slides, layouts, theme and media.

use core_model::media::MediaStore;
use core_model::units::Emu;
use core_model::Theme;
use serde::{Deserialize, Serialize};

use crate::layout::{Layout, LayoutKind};
use crate::shape::{Shape, ShapeKind};
use crate::slide::{find_in, Slide};
use crate::text::{TextBody, TextParagraph};
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
        let defs = self.layouts[layout.index()].placeholders.clone();
        for def in defs {
            let mut shape = Shape::text_box(def.transform, "");
            if let Some(body) = shape.text_mut() {
                *body = TextBody {
                    props: def.body_defaults,
                    paragraphs: vec![TextParagraph::new()],
                };
            }
            shape.placeholder = Some(def.kind);
            self.assign_ids(&mut shape);
            slide.shapes.push(shape);
        }
        self.slides.push(slide);
        id
    }

    /// Inserts a deep copy of slide `id` right after it, with fresh ids for
    /// the slide and all its shapes. Returns the copy's id.
    pub fn duplicate_slide(&mut self, id: NodeId) -> Result<NodeId> {
        let index = self.slide_index(id).ok_or(Error::UnknownSlide(id))?;
        let mut copy = self.slides[index].clone();
        copy.id = self.alloc_id();
        for shape in &mut copy.shapes {
            self.assign_ids(shape);
        }
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
        if shape.name.is_empty() {
            shape.name = format!("{} {}", shape.default_name(), shape.id.0);
        }
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
        }
        max
    }
}
