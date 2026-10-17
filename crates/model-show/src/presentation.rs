//! The [`Presentation`]: slide size, slides, master, layouts, theme,
//! sections and media.

use core_model::media::MediaStore;
use core_model::units::Emu;
use core_model::RunProperties;
use serde::{Deserialize, Serialize};

use crate::anim::Animation;
use crate::layout::{Layout, LayoutKind, PlaceholderDef, PlaceholderKind};
use crate::master::{HeaderFooter, HfDate, LevelStyle, SlideMaster, TextClass};
use crate::section::Section;
use crate::shape::{Shape, ShapeKind};
use crate::slide::{find_in, Slide};
use crate::tablestyle::TableStyleDef;
use crate::text::{TextBody, TextField, TextParagraph, TextParagraphProps, TextRun};
use crate::theme::{Background, ResolvedFill, Theme};
use crate::view::{ShowSettings, ViewProps};
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
    /// The slide master (one per presentation).
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<SlideMaster>"))]
    pub master: SlideMaster,
    /// The master's layouts, in file order; kinds are unique. New
    /// presentations have the eleven standard layouts.
    pub layouts: Vec<Layout>,
    /// Theme colours, fonts and format styles.
    pub theme: Theme,
    /// Sections (empty = none); see [`crate::section`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Section>>"))]
    pub sections: Vec<Section>,
    /// Images.
    #[cfg_attr(feature = "ts", ts(as = "Vec<crate::ts::MediaItem>"))]
    pub media: MediaStore,
    /// Guides, grid, snapping, ruler and the last view (`viewProps.xml`).
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ViewProps>"))]
    pub view: ViewProps,
    /// Set Up Slide Show (`presProps.xml`).
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ShowSettings>"))]
    pub show_settings: ShowSettings,
    /// Table styles of the file that are not PowerPoint built-ins
    /// (`ppt/tableStyles.xml`; tables find their style here first, then
    /// among [`crate::builtin_table_styles`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<TableStyleDef>>"))]
    pub table_styles: Vec<TableStyleDef>,
    #[serde(skip)]
    pub(crate) next_id: u64,
}

fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

impl Default for Presentation {
    fn default() -> Self {
        Self::new()
    }
}

/// What [`Presentation::resolve_placeholder`] returns: the effective
/// geometry and text defaults of a slide placeholder.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedPlaceholder {
    /// The layout (or master) placeholder it inherits from.
    pub def: PlaceholderDef,
    /// Whether `def` comes from the master (the layout has none).
    pub from_master: bool,
}

/// The date of a slide's footer (see [`Presentation::resolved_footer`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum FooterDate {
    /// Fixed text.
    Fixed(String),
    /// Today's date in format `format` ([`crate::text::date_format_pattern`]).
    #[serde(rename_all = "camelCase")]
    Auto {
        /// `datetimeN`.
        format: u8,
    },
}

/// What a slide shows in its date, footer and slide-number placeholders.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ResolvedFooter {
    /// Date (`None` = no date placeholder).
    pub date: Option<FooterDate>,
    /// Footer text (`None` = no footer placeholder).
    pub footer: Option<String>,
    /// 1-based slide number (`None` = no slide-number placeholder).
    pub slide_number: Option<u32>,
}

impl Presentation {
    /// A new presentation: 16:9, Office theme, the eleven standard
    /// layouts, one Title slide with empty title and subtitle placeholders.
    pub fn new() -> Self {
        let mut p = Self::empty(SlideSize::widescreen());
        p.add_slide(LayoutKind::Title);
        p
    }

    /// A presentation without slides (e.g. for importers), with the
    /// Office master and standard layouts for `slide_size`, Office theme
    /// and no media.
    pub fn empty(slide_size: SlideSize) -> Self {
        let master = SlideMaster::builtin(slide_size);
        let layouts = LayoutKind::STANDARD
            .iter()
            .map(|k| Layout::from_master(k.clone(), &master, slide_size))
            .collect();
        Self {
            slide_size,
            slides: Vec::new(),
            master,
            layouts,
            theme: Theme::default(),
            sections: Vec::new(),
            media: MediaStore::new(),
            view: ViewProps::default(),
            show_settings: ShowSettings::default(),
            table_styles: Vec::new(),
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

    /// The layout `kind`, if the presentation has it.
    pub fn layout(&self, kind: &LayoutKind) -> Option<&Layout> {
        self.layouts.iter().find(|l| &l.kind == kind)
    }

    /// Mutable access to layout `kind`.
    pub fn layout_mut(&mut self, kind: &LayoutKind) -> Option<&mut Layout> {
        self.layouts.iter_mut().find(|l| &l.kind == kind)
    }

    /// The layout `kind`, or – for a standard kind the presentation lacks –
    /// the built-in one for its master.
    pub fn layout_or_builtin(&self, kind: &LayoutKind) -> Layout {
        self.layout(kind)
            .cloned()
            .unwrap_or_else(|| Layout::from_master(kind.clone(), &self.master, self.slide_size))
    }

    /// The layout placeholder (or, when the layout has none, the master
    /// placeholder) slide placeholder `shape` of slide `slide` inherits
    /// position, body properties and text defaults from.
    pub fn resolve_placeholder(&self, slide: &Slide, shape: &Shape) -> Option<ResolvedPlaceholder> {
        let kind = shape.placeholder?;
        let layout = self.layout_or_builtin(&slide.layout);
        if let Some(def) = layout.find(kind, shape.placeholder_idx) {
            return Some(ResolvedPlaceholder {
                def: def.clone(),
                from_master: false,
            });
        }
        self.master
            .placeholder_for(kind)
            .map(|d| ResolvedPlaceholder {
                def: PlaceholderDef { kind, ..d.clone() },
                from_master: true,
            })
    }

    /// The effective paragraph and run formatting of outline level
    /// `level` (0-based) in placeholder `shape` of `slide`: level 1 is
    /// the placeholder's defaults, deeper levels the master's text style
    /// of the placeholder's class overlaid with the layout placeholder's
    /// own changes of that level. Shapes that are not placeholders use
    /// the master's "other" style.
    pub fn resolve_level(
        &self,
        slide: &Slide,
        shape: &Shape,
        level: u8,
    ) -> (TextParagraphProps, RunProperties) {
        let l = self.resolve_level_style(slide, shape, level);
        (l.paragraph, l.run)
    }

    /// [`resolve_level`](Self::resolve_level) with the level's margins
    /// (`marL`/`indent`; level 1: the master text style's).
    pub fn resolve_level_style(&self, slide: &Slide, shape: &Shape, level: u8) -> LevelStyle {
        let class = shape
            .placeholder
            .map_or(TextClass::Other, |k| k.text_class());
        let style = self.master.text_styles.level(class, level);
        let Some(r) = self.resolve_placeholder(slide, shape) else {
            return style;
        };
        if level == 0 {
            return LevelStyle {
                paragraph: r.def.paragraph_defaults,
                run: r.def.run_defaults,
                ..style
            };
        }
        match r.def.level_override(level) {
            Some(o) => style.merged_with(o),
            None => style,
        }
    }

    /// The effective background of slide `slide`: its own, else its
    /// layout's, else the master's.
    pub fn background_of(&self, slide: &Slide) -> Background {
        if let Some(b) = slide.background {
            return b;
        }
        self.layout(&slide.layout)
            .and_then(|l| l.background)
            .unwrap_or(self.master.background)
    }

    /// [`background_of`](Self::background_of) resolved to colours.
    pub fn resolved_background(&self, slide: &Slide) -> ResolvedFill {
        self.theme.resolve_background(&self.background_of(slide))
    }

    /// What slide `slide` shows in its date, footer and slide-number
    /// placeholders (for the UI, printing and the presenter view): the
    /// date placeholder's text, or its date field's format; the footer's
    /// text; the slide's 1-based position for a slide-number placeholder.
    pub fn resolved_footer(&self, slide: NodeId) -> Option<ResolvedFooter> {
        let index = self.slide_index(slide)?;
        let s = &self.slides[index];
        let mut out = ResolvedFooter::default();
        for shape in &s.shapes {
            let Some(kind) = shape.placeholder else {
                continue;
            };
            let text = shape.text();
            match kind {
                PlaceholderKind::DateTime => {
                    let field = text.and_then(|t| {
                        t.paragraphs
                            .iter()
                            .flat_map(|p| &p.runs)
                            .find_map(|r| match &r.field {
                                Some(TextField::DateTime { format }) => Some(*format),
                                _ => None,
                            })
                    });
                    out.date = Some(match field {
                        Some(format) => FooterDate::Auto { format },
                        None => {
                            FooterDate::Fixed(text.map(TextBody::plain_text).unwrap_or_default())
                        }
                    });
                }
                PlaceholderKind::Footer => {
                    out.footer = Some(text.map(TextBody::plain_text).unwrap_or_default());
                }
                PlaceholderKind::SlideNumber => {
                    out.slide_number = Some(index as u32 + 1);
                }
                _ => {}
            }
        }
        Some(out)
    }

    /// Appends a slide with `layout`, holding one empty shape per layout
    /// placeholder (at the placeholder's position, with its body
    /// properties) and the master's header/footer placeholders. Returns
    /// the slide's id.
    pub fn add_slide(&mut self, layout: LayoutKind) -> NodeId {
        let id = self.alloc_id();
        let mut slide = Slide::new(id, layout.clone());
        let l = self.layout_or_builtin(&layout);
        let mut shapes = l.placeholder_shapes();
        shapes.extend(header_footer_shapes(
            &self.master.header_footer,
            &l,
            &self.master,
        ));
        for mut shape in shapes {
            self.assign_ids(&mut shape);
            slide.shapes.push(shape);
        }
        self.slides.push(slide);
        self.fix_sections();
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
        self.fix_sections();
        Ok(new_id)
    }

    /// Moves slide `id` so that it ends up at position `to_index`
    /// (`0..slides.len()`); with sections it joins the section of the
    /// slide before its new position.
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
        if from != to_index {
            self.resection_moved(id);
        }
        Ok(())
    }

    /// Removes slide `id` and returns it (a presentation may end up with
    /// no slides; its section stays, possibly empty).
    pub fn remove_slide(&mut self, id: NodeId) -> Result<Slide> {
        let index = self.slide_index(id).ok_or(Error::UnknownSlide(id))?;
        let s = self.slides.remove(index);
        self.fix_sections();
        Ok(s)
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

    /// Checks every slide ([`Slide::validate`]), that slides use layouts
    /// of the presentation (standard kinds may be missing: they fall back
    /// to the built-ins), that layout kinds are unique and the sections
    /// ([`Presentation::validate_sections`]).
    pub fn validate(&self) -> Result<()> {
        self.slides.iter().try_for_each(Slide::validate)?;
        for (i, l) in self.layouts.iter().enumerate() {
            if self.layouts[..i].iter().any(|o| o.kind == l.kind) {
                return Err(Error::InvalidLayout(format!(
                    "layout {} is listed twice",
                    l.kind
                )));
            }
        }
        for s in &self.slides {
            if !s.layout.is_standard() && self.layout(&s.layout).is_none() {
                return Err(Error::InvalidLayout(format!(
                    "slide {} uses the missing layout {}",
                    s.id.0, s.layout
                )));
            }
        }
        self.validate_sections()
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
        walk(&mut self.master.shapes);
        for l in &mut self.layouts {
            walk(&mut l.shapes);
        }
    }

    /// Every media item `shapes` use (pictures, audio/video files and
    /// posters, embedded chart workbooks), in first-use order, recursively.
    pub fn media_of(shapes: &[Shape]) -> Vec<core_model::media::MediaId> {
        fn walk(shapes: &[Shape], out: &mut Vec<core_model::media::MediaId>) {
            for s in shapes {
                let ids: Vec<core_model::media::MediaId> = match &s.kind {
                    ShapeKind::Picture { media, .. } => vec![*media],
                    ShapeKind::Media(m) => m.media_ids().collect(),
                    ShapeKind::Chart(c) => c.workbook.into_iter().collect(),
                    ShapeKind::Group { children } => {
                        walk(children, out);
                        Vec::new()
                    }
                    _ => Vec::new(),
                };
                for id in ids {
                    if !out.contains(&id) {
                        out.push(id);
                    }
                }
            }
        }
        let mut out = Vec::new();
        walk(shapes, &mut out);
        out
    }

    /// Largest node id in use (0 if none), including master and layout
    /// shapes.
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
        walk(&self.master.shapes, &mut max);
        for l in &self.layouts {
            walk(&l.shapes, &mut max);
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

/// The date/footer/slide-number placeholder shapes `hf` asks for on a
/// slide with `layout` (positions from the layout, else the master; none
/// on title slides with [`HeaderFooter::not_on_title`]). Ids are 0.
pub fn header_footer_shapes(
    hf: &HeaderFooter,
    layout: &Layout,
    master: &SlideMaster,
) -> Vec<Shape> {
    if hf.is_off() || (hf.not_on_title && layout.kind == LayoutKind::Title) {
        return Vec::new();
    }
    let def = |k: PlaceholderKind| {
        layout
            .placeholder(k)
            .or_else(|| master.placeholder_for(k))
            .cloned()
            .unwrap_or_else(|| {
                let mut d = SlideMaster::builtin(SlideSize::widescreen())
                    .placeholder_for(k)
                    .cloned()
                    .expect("built-in footer placeholders");
                d.idx = k.default_idx();
                d
            })
    };
    let with_text = |k: PlaceholderKind, run: TextRun| {
        let mut shape = def(k).empty_shape();
        if let Some(body) = shape.text_mut() {
            body.paragraphs = vec![TextParagraph {
                props: TextParagraphProps::default(),
                runs: vec![run],
            }];
        }
        shape
    };
    let mut out = Vec::new();
    match &hf.date {
        HfDate::Off => {}
        HfDate::Auto { format } => out.push(with_text(
            PlaceholderKind::DateTime,
            TextRun::field(TextField::DateTime { format: *format }, ""),
        )),
        HfDate::Fixed { text } => out.push(with_text(
            PlaceholderKind::DateTime,
            TextRun::new(text.clone()),
        )),
    }
    if let Some(f) = &hf.footer {
        out.push(with_text(PlaceholderKind::Footer, TextRun::new(f.clone())));
    }
    if hf.slide_number {
        out.push(with_text(
            PlaceholderKind::SlideNumber,
            TextRun::field(TextField::SlideNumber, "‹#›"),
        ));
    }
    out
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
