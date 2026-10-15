//! [`ShowDocument`]: a [`model_show::Presentation`] behind the
//! [`app_common::Document`] trait.

use std::collections::HashSet;

use app_common::{Applied, DispatchError, Document as AppDocument};
use core_model::media::{base64_decode, base64_encode, Media};
use core_model::units::Emu;
use model_show::{
    align_shapes, distribute, AlignMode, Fill, Layout, LayoutKind, Line, NodeId, Presentation,
    Shape, ShapeKind, Slide, Transform,
};

use crate::command::{AlignTarget, NewShape, NewShapeKind, ShowCommand, ZOp};
use crate::image::pixel_size;
use crate::patch::ShowPatch;
use crate::text::{para_len, set_run_props};

/// Errors of [`ShowDocument`]; [`code`](Self::code) is the stable
/// [`DispatchError::code`].
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ShowError {
    /// No slide has this id.
    #[error("unknown slide {0}")]
    UnknownSlide(u64),
    /// No shape has this id.
    #[error("unknown shape {0}")]
    UnknownShape(u64),
    /// No media item has this id.
    #[error("unknown media {0}")]
    UnknownMedia(u32),
    /// A paragraph index or char range outside the shape's text.
    #[error(
        "paragraph {paragraph} range {from}..{to} out of range (length {len}) in shape {shape}"
    )]
    BadOffset {
        shape: u64,
        paragraph: u32,
        from: u32,
        to: u32,
        len: usize,
    },
    /// A well-formed command that cannot be applied.
    #[error("invalid command: {0}")]
    Invalid(String),
    /// Undecodable payload (e.g. base64).
    #[error("bad request: {0}")]
    BadRequest(String),
    /// A loaded presentation violates the model's invariants.
    #[error("invalid presentation: {0}")]
    InvalidDocument(String),
    /// The bytes are not a readable `.pptx` file.
    #[error("cannot read .pptx: {0}")]
    ReadPptx(String),
    /// Writing the `.pptx` file failed.
    #[error("cannot write .pptx: {0}")]
    WritePptx(String),
}

impl ShowError {
    /// Machine-readable error code sent to the UI.
    pub fn code(&self) -> &'static str {
        match self {
            ShowError::UnknownSlide(_) => "unknown_slide",
            ShowError::UnknownShape(_) => "unknown_shape",
            ShowError::UnknownMedia(_) => "unknown_media",
            ShowError::BadOffset { .. } => "bad_offset",
            ShowError::Invalid(_) => "invalid_command",
            ShowError::BadRequest(_) => "bad_request",
            ShowError::InvalidDocument(_) => "invalid_document",
            ShowError::ReadPptx(_) => "invalid_file",
            ShowError::WritePptx(_) => "internal",
        }
    }
}

impl From<ShowError> for DispatchError {
    fn from(e: ShowError) -> Self {
        DispatchError::new(e.code(), e.to_string())
    }
}

type R<T> = Result<T, ShowError>;
type C = ShowCommand;

fn invalid(msg: impl Into<String>) -> ShowError {
    ShowError::Invalid(msg.into())
}

/// EMU per pixel at 96 dpi.
const EMU_PER_PX: i64 = 9_525;

/// The Show document: owns a [`Presentation`] and applies
/// [`ShowCommand`]s.
#[derive(Debug, Clone, PartialEq)]
pub struct ShowDocument {
    pres: Presentation,
    /// File-level `.pptx` data (the raw theme part) kept from
    /// [`open_pptx`](Self::open_pptx) for [`save_pptx`](Self::save_pptx).
    pub pptx_context: Option<fmt_pptx::PptxContext>,
    /// The file name the presentation was opened from (no directory).
    pub source_name: Option<String>,
}

impl Default for ShowDocument {
    fn default() -> Self {
        Self::new()
    }
}

/// What one command touched; turned into a [`ShowPatch`] at the end.
#[derive(Debug, Default)]
struct Changes {
    slides: Vec<NodeId>,
    id_map: Vec<(i64, NodeId)>,
    slide_size: bool,
}

/// Every slide and shape id of `p`.
fn all_ids(p: &Presentation) -> HashSet<NodeId> {
    let mut out = HashSet::new();
    for slide in &p.slides {
        out.insert(slide.id);
        for_each_shape(&slide.shapes, &mut |s| {
            out.insert(s.id);
        });
    }
    out
}

/// Calls `f` on every shape, depth-first (a group before its children).
fn for_each_shape(shapes: &[Shape], f: &mut impl FnMut(&Shape)) {
    for s in shapes {
        f(s);
        for_each_shape(s.children(), f);
    }
}

fn count_shapes(shapes: &[Shape]) -> usize {
    let mut n = 0;
    for_each_shape(shapes, &mut |_| n += 1);
    n
}

/// Gives every shape a new id from `next`, depth-first.
fn reid(shapes: &mut [Shape], next: &mut impl FnMut() -> R<NodeId>) -> R<()> {
    for s in shapes {
        s.id = next()?;
        if let ShapeKind::Group { children } = &mut s.kind {
            reid(children, next)?;
        }
    }
    Ok(())
}

/// `new_ids` as `n` entries (`None` = allocate): empty or exactly `n`.
fn id_layout(new_ids: &[i64], n: usize) -> R<Vec<Option<i64>>> {
    match new_ids.len() {
        0 => Ok(vec![None; n]),
        k if k == n => Ok(new_ids.iter().copied().map(Some).collect()),
        k => Err(invalid(format!("expected 0 or {n} new ids, got {k}"))),
    }
}

/// Resolves ids sent by the UI: negative = temporary (allocated, reported
/// in the id map), non-negative = explicit (must be unused).
struct Ids {
    used: HashSet<NodeId>,
    seen: HashSet<NodeId>,
    temps: HashSet<i64>,
}

impl Ids {
    fn new(p: &Presentation) -> Self {
        Ids {
            used: all_ids(p),
            seen: HashSet::new(),
            temps: HashSet::new(),
        }
    }

    fn resolve(&mut self, p: &mut Presentation, ch: &mut Changes, id: Option<i64>) -> R<NodeId> {
        let real = match id {
            None => p.alloc_id(),
            Some(t) if t < 0 => {
                if !self.temps.insert(t) {
                    return Err(invalid(format!("temporary id {t} used twice")));
                }
                let real = p.alloc_id();
                ch.id_map.push((t, real));
                real
            }
            Some(n) => {
                let real = NodeId(n as u64);
                if self.used.contains(&real) || self.seen.contains(&real) {
                    return Err(invalid(format!("id {n} is already in use")));
                }
                p.reserve_id(real);
                real
            }
        };
        self.seen.insert(real);
        Ok(real)
    }
}

/// Scales the boxes of `shapes` (children of a resized group) by
/// `sx`/`sy`, recursively.
fn scale_shapes(shapes: &mut [Shape], sx: f64, sy: f64) {
    let s = |v: Emu, f: f64| Emu((v.0 as f64 * f).round() as i64);
    for c in shapes {
        let t = &mut c.transform;
        t.x = s(t.x, sx);
        t.y = s(t.y, sy);
        t.w = s(t.w, sx);
        t.h = s(t.h, sy);
        if let ShapeKind::Group { children } = &mut c.kind {
            scale_shapes(children, sx, sy);
        }
    }
}

/// Sets fill/outline on a shape, or on every leaf of a group.
fn apply_style(shape: &mut Shape, fill: Option<Option<Fill>>, line: Option<Option<Line>>) {
    if let ShapeKind::Group { children } = &mut shape.kind {
        for c in children {
            apply_style(c, fill, line);
        }
        return;
    }
    if let Some(f) = fill {
        shape.fill = f.unwrap_or(Fill::None);
    }
    if let Some(l) = line {
        shape.line = l.unwrap_or_default();
    }
}

/// Applies a z-order operation to the selected shapes of `shapes` and,
/// recursively, of every group.
fn zorder(shapes: &mut Vec<Shape>, sel: &HashSet<NodeId>, op: ZOp) {
    for s in shapes.iter_mut() {
        if let ShapeKind::Group { children } = &mut s.kind {
            zorder(children, sel, op);
        }
    }
    let is = |s: &Shape| sel.contains(&s.id);
    let n = shapes.len();
    match op {
        ZOp::BringForward => {
            for i in (0..n.saturating_sub(1)).rev() {
                if is(&shapes[i]) && !is(&shapes[i + 1]) {
                    shapes.swap(i, i + 1);
                }
            }
        }
        ZOp::SendBackward => {
            for i in 1..n {
                if is(&shapes[i]) && !is(&shapes[i - 1]) {
                    shapes.swap(i, i - 1);
                }
            }
        }
        ZOp::BringToFront | ZOp::SendToBack => {
            let (mut picked, rest): (Vec<Shape>, Vec<Shape>) = shapes.drain(..).partition(is);
            if op == ZOp::BringToFront {
                shapes.extend(rest);
                shapes.append(&mut picked);
            } else {
                shapes.append(&mut picked);
                shapes.extend(rest);
            }
        }
    }
}

/// Removes groups left without children, recursively.
fn prune_empty_groups(shapes: &mut Vec<Shape>) {
    for s in shapes.iter_mut() {
        if let ShapeKind::Group { children } = &mut s.kind {
            prune_empty_groups(children);
        }
    }
    shapes.retain(|s| !matches!(&s.kind, ShapeKind::Group { children } if children.is_empty()));
}

fn check_transform(t: &Transform) -> R<()> {
    if t.w.0 < 0 || t.h.0 < 0 {
        return Err(invalid("shape size must not be negative"));
    }
    if !t.rotation_deg.is_finite() {
        return Err(invalid("rotation must be finite"));
    }
    Ok(())
}

fn normalize_shape(shape: &mut Shape) {
    match &mut shape.kind {
        ShapeKind::Auto {
            text: Some(body), ..
        } => body.normalize(),
        ShapeKind::Group { children } => children.iter_mut().for_each(normalize_shape),
        _ => {}
    }
}

impl ShowDocument {
    /// A new presentation: 16:9, one title slide.
    pub fn new() -> Self {
        Self::from_valid(Presentation::new())
    }

    fn from_valid(pres: Presentation) -> Self {
        ShowDocument {
            pres,
            pptx_context: None,
            source_name: None,
        }
    }

    /// Wraps a presentation after checking that its node ids are unique,
    /// and normalizes it ([`Presentation::normalize`]).
    pub fn from_presentation(mut pres: Presentation) -> R<Self> {
        let mut seen = HashSet::new();
        let mut dup = None;
        for slide in &pres.slides {
            if !seen.insert(slide.id) {
                dup = dup.or(Some(slide.id));
            }
            for_each_shape(&slide.shapes, &mut |s| {
                if !seen.insert(s.id) {
                    dup = dup.or(Some(s.id));
                }
            });
        }
        if let Some(id) = dup {
            return Err(ShowError::InvalidDocument(format!(
                "node id {} is used twice",
                id.0
            )));
        }
        pres.normalize();
        Ok(Self::from_valid(pres))
    }

    /// Reads a `.pptx` file; `name` is the file name shown to the user.
    /// Returns the presentation and the reader's warnings about content
    /// that was dropped or approximated. The file's
    /// [`fmt_pptx::PptxContext`] is kept for [`save_pptx`](Self::save_pptx).
    pub fn open_pptx(bytes: &[u8], name: &str) -> R<(Self, Vec<String>)> {
        let out =
            fmt_pptx::read_with_context(bytes).map_err(|e| ShowError::ReadPptx(e.to_string()))?;
        let mut doc = Self::from_presentation(out.presentation)?;
        doc.pptx_context = Some(out.context);
        doc.source_name = Some(name.to_owned());
        Ok((doc, out.warnings))
    }

    /// Writes the presentation as `.pptx`, with the file-level data it was
    /// opened with (if any).
    pub fn save_pptx(&self) -> R<Vec<u8>> {
        let default_ctx = fmt_pptx::PptxContext::default();
        let ctx = self.pptx_context.as_ref().unwrap_or(&default_ctx);
        fmt_pptx::write_with_context(&self.pres, ctx)
            .map_err(|e| ShowError::WritePptx(e.to_string()))
    }

    /// The file name to offer when saving: the source name with a `.pptx`
    /// extension, else `Untitled.pptx`.
    pub fn suggested_name(&self) -> String {
        match self.source_name.as_deref() {
            None | Some("") => "Untitled.pptx".to_owned(),
            Some(n) if n.to_ascii_lowercase().ends_with(".pptx") => n.to_owned(),
            Some(n) => {
                let stem = n.rsplit_once('.').map_or(n, |(stem, _)| stem);
                format!("{stem}.pptx")
            }
        }
    }

    /// The presentation.
    pub fn presentation(&self) -> &Presentation {
        &self.pres
    }

    /// The presentation, consuming the wrapper.
    pub fn into_presentation(self) -> Presentation {
        self.pres
    }

    // ----- lookups -------------------------------------------------------

    fn slide_index(&self, id: NodeId) -> R<usize> {
        self.pres
            .slide_index(id)
            .ok_or(ShowError::UnknownSlide(id.0))
    }

    fn shape(&self, id: NodeId) -> R<&Shape> {
        self.pres
            .find_shape(id)
            .map(|(_, s)| s)
            .ok_or(ShowError::UnknownShape(id.0))
    }

    fn shape_mut(&mut self, id: NodeId) -> R<&mut Shape> {
        self.pres
            .find_shape_mut(id)
            .ok_or(ShowError::UnknownShape(id.0))
    }

    fn slide_mut(&mut self, id: NodeId) -> R<&mut Slide> {
        self.pres.slide_mut(id).ok_or(ShowError::UnknownSlide(id.0))
    }

    /// The slides holding `shapes` (validated), without duplicates.
    fn slides_of(&self, shapes: &[NodeId]) -> R<Vec<NodeId>> {
        let mut out = Vec::new();
        for &id in shapes {
            let slide = self
                .pres
                .slide_of(id)
                .ok_or(ShowError::UnknownShape(id.0))?;
            if !out.contains(&slide.id) {
                out.push(slide.id);
            }
        }
        Ok(out)
    }

    /// The one slide holding all `shapes` as top-level shapes (distinct,
    /// non-empty).
    fn top_level_slide(&self, shapes: &[NodeId]) -> R<NodeId> {
        let slides = self.slides_of(shapes)?;
        let [slide] = slides[..] else {
            return Err(invalid("shapes must be on one slide"));
        };
        let s = self
            .pres
            .slide(slide)
            .ok_or(ShowError::UnknownSlide(slide.0))?;
        let unique: HashSet<NodeId> = shapes.iter().copied().collect();
        if unique.len() != shapes.len() {
            return Err(invalid("a shape is listed twice"));
        }
        if !shapes.iter().all(|id| s.shapes.iter().any(|t| t.id == *id)) {
            return Err(invalid("shapes must not be inside a group"));
        }
        Ok(slide)
    }

    fn slide_box(&self) -> Transform {
        let size = self.pres.slide_size;
        Transform::new(Emu(0), Emu(0), size.width, size.height)
    }

    // ----- execution -----------------------------------------------------

    /// Runs `f`, which may change only the content of `slides`; on error
    /// those slides are restored. The inverse puts their old content back.
    fn edit_slides(
        &mut self,
        slides: &[NodeId],
        ch: &mut Changes,
        f: impl FnOnce(&mut Self) -> R<()>,
    ) -> R<C> {
        let old = slides
            .iter()
            .map(|&id| {
                self.pres
                    .slide(id)
                    .cloned()
                    .ok_or(ShowError::UnknownSlide(id.0))
            })
            .collect::<R<Vec<Slide>>>()?;
        if let Err(e) = f(self) {
            for s in &old {
                if let Some(slot) = self.pres.slide_mut(s.id) {
                    *slot = s.clone();
                }
            }
            return Err(e);
        }
        ch.slides.extend_from_slice(slides);
        Ok(C::RestoreSlideContent { slides: old })
    }

    fn edit_slide(
        &mut self,
        slide: NodeId,
        ch: &mut Changes,
        f: impl FnOnce(&mut Slide) -> R<()>,
    ) -> R<C> {
        self.edit_slides(&[slide], ch, |d| f(d.slide_mut(slide)?))
    }

    /// Edits shapes (wherever they are) with `f`.
    fn edit_shapes(
        &mut self,
        shapes: &[NodeId],
        ch: &mut Changes,
        mut f: impl FnMut(&mut Shape) -> R<()>,
    ) -> R<C> {
        let slides = self.slides_of(shapes)?;
        self.edit_slides(&slides, ch, |d| {
            for &id in shapes {
                f(d.shape_mut(id)?)?;
            }
            Ok(())
        })
    }

    /// Applies `cmd` and returns its inverse. On error the presentation is
    /// unchanged (compound commands roll back).
    fn exec(&mut self, cmd: &ShowCommand, ch: &mut Changes) -> R<C> {
        match cmd {
            C::AddSlide {
                after,
                layout,
                new_ids,
            } => self.add_slide(*after, *layout, new_ids, ch),
            C::DeleteSlides { ids } => {
                let set: HashSet<NodeId> = ids.iter().copied().collect();
                if set.len() != ids.len() {
                    return Err(invalid("a slide is listed twice"));
                }
                for &id in ids {
                    self.slide_index(id)?;
                }
                let removed: Vec<(u32, Slide)> = self
                    .pres
                    .slides
                    .iter()
                    .enumerate()
                    .filter(|(_, s)| set.contains(&s.id))
                    .map(|(i, s)| (i as u32, s.clone()))
                    .collect();
                self.pres.slides.retain(|s| !set.contains(&s.id));
                Ok(C::RestoreSlides { slides: removed })
            }
            C::RestoreSlides { slides } => {
                let used = all_ids(&self.pres);
                let len = self.pres.slides.len();
                let mut fresh = HashSet::new();
                for (k, (index, slide)) in slides.iter().enumerate() {
                    if *index as usize > len + k {
                        return Err(invalid(format!("slide index {index} out of range")));
                    }
                    if used.contains(&slide.id) || !fresh.insert(slide.id) {
                        return Err(invalid(format!("id {} is already in use", slide.id.0)));
                    }
                }
                for (index, slide) in slides {
                    self.reserve_slide_ids(slide);
                    self.pres.slides.insert(*index as usize, slide.clone());
                    ch.slides.push(slide.id);
                }
                Ok(C::DeleteSlides {
                    ids: slides.iter().map(|(_, s)| s.id).collect(),
                })
            }
            C::RestoreSlideContent { slides } => {
                for s in slides {
                    self.slide_index(s.id)?;
                }
                let mut old = Vec::with_capacity(slides.len());
                for s in slides {
                    self.reserve_slide_ids(s);
                    let slot = self.slide_mut(s.id)?;
                    old.push(std::mem::replace(slot, s.clone()));
                    ch.slides.push(s.id);
                }
                old.reverse();
                Ok(C::RestoreSlideContent { slides: old })
            }
            C::DuplicateSlide { id, new_ids } => {
                let index = self.slide_index(*id)?;
                let mut copy = self.pres.slides[index].clone();
                let layout = id_layout(new_ids, 1 + count_shapes(&copy.shapes))?;
                let mut ids = Ids::new(&self.pres);
                let mut it = layout.into_iter();
                let pres = &mut self.pres;
                let mut next = || ids.resolve(pres, ch, it.next().flatten());
                copy.id = next()?;
                reid(&mut copy.shapes, &mut next)?;
                let new_id = copy.id;
                self.pres.slides.insert(index + 1, copy);
                ch.slides.push(new_id);
                Ok(C::DeleteSlides { ids: vec![new_id] })
            }
            C::MoveSlide { id, to_index } => {
                let from = self.slide_index(*id)?;
                self.pres
                    .move_slide(*id, *to_index as usize)
                    .map_err(|e| invalid(e.to_string()))?;
                Ok(C::MoveSlide {
                    id: *id,
                    to_index: from as u32,
                })
            }
            C::SetSlideBackground { slide, fill } => {
                let s = self.slide_mut(*slide)?;
                let old = std::mem::replace(&mut s.background, *fill);
                ch.slides.push(*slide);
                Ok(C::SetSlideBackground {
                    slide: *slide,
                    fill: old,
                })
            }
            C::AddShape {
                slide,
                shape,
                index,
            } => {
                let len = self.pres.slides[self.slide_index(*slide)?].shapes.len();
                let at = index.map_or(len, |i| i as usize);
                if at > len {
                    return Err(invalid(format!("shape index {at} out of range 0..={len}")));
                }
                let mut ids = Ids::new(&self.pres);
                let shape = self.build_shape(shape, &mut ids, ch)?;
                self.edit_slide(*slide, ch, |s| {
                    s.shapes.insert(at, shape);
                    Ok(())
                })
            }
            C::DeleteShapes { ids } => {
                let slides = self.slides_of(ids)?;
                self.edit_slides(&slides, ch, |d| {
                    for &slide in &slides {
                        let s = d.slide_mut(slide)?;
                        for id in ids {
                            if let Some((list, i)) = s.container_mut(*id) {
                                list.remove(i);
                            }
                        }
                        prune_empty_groups(&mut s.shapes);
                    }
                    Ok(())
                })
            }
            C::SetTransform { shapes } => {
                for (_, t) in shapes {
                    check_transform(t)?;
                }
                let ids: Vec<NodeId> = shapes.iter().map(|(id, _)| *id).collect();
                let slides = self.slides_of(&ids)?;
                self.edit_slides(&slides, ch, |d| {
                    for (id, t) in shapes {
                        let s = d.shape_mut(*id)?;
                        let old = s.transform;
                        if let ShapeKind::Group { children } = &mut s.kind {
                            let f = |new: Emu, old: Emu| {
                                if old.0 == 0 {
                                    1.0
                                } else {
                                    new.0 as f64 / old.0 as f64
                                }
                            };
                            let (sx, sy) = (f(t.w, old.w), f(t.h, old.h));
                            if sx != 1.0 || sy != 1.0 {
                                scale_shapes(children, sx, sy);
                            }
                        }
                        s.transform = *t;
                    }
                    Ok(())
                })
            }
            C::SetShapeStyle { shapes, fill, line } => self.edit_shapes(shapes, ch, |s| {
                apply_style(s, *fill, *line);
                Ok(())
            }),
            C::SetTextBody { shape, body } => {
                match &self.shape(*shape)?.kind {
                    ShapeKind::Auto { .. } => {}
                    _ => return Err(invalid(format!("shape {} cannot hold text", shape.0))),
                }
                let mut body = body.clone();
                body.normalize();
                self.edit_shapes(&[*shape], ch, |s| {
                    if let ShapeKind::Auto { text, .. } = &mut s.kind {
                        *text = Some(body.clone());
                    }
                    Ok(())
                })
            }
            C::SetRunProps {
                shape,
                paragraph,
                from,
                to,
                patch,
            } => {
                let (f, t) = self.text_range(*shape, *paragraph, *from, *to)?;
                self.edit_shapes(&[*shape], ch, |s| {
                    if let Some(p) = s
                        .text_mut()
                        .and_then(|b| b.paragraphs.get_mut(*paragraph as usize))
                    {
                        set_run_props(p, f, t, patch);
                    }
                    Ok(())
                })
            }
            C::SetParagraphProps {
                shape,
                paragraphs,
                patch,
            } => {
                for &p in paragraphs {
                    self.text_range(*shape, p, 0, 0)?;
                }
                self.edit_shapes(&[*shape], ch, |s| {
                    if let Some(body) = s.text_mut() {
                        for &p in paragraphs {
                            if let Some(para) = body.paragraphs.get_mut(p as usize) {
                                patch.apply_to(&mut para.props);
                            }
                        }
                    }
                    Ok(())
                })
            }
            C::SetName { shape, name } => self.edit_shapes(&[*shape], ch, |s| {
                s.name.clone_from(name);
                Ok(())
            }),
            C::ZOrder { shapes, op } => {
                let slides = self.slides_of(shapes)?;
                let sel: HashSet<NodeId> = shapes.iter().copied().collect();
                self.edit_slides(&slides, ch, |d| {
                    for &slide in &slides {
                        zorder(&mut d.slide_mut(slide)?.shapes, &sel, *op);
                    }
                    Ok(())
                })
            }
            C::Align { shapes, mode, to } => self.align(shapes, *mode, *to, ch),
            C::Distribute { shapes, axis } => {
                let slide = self.top_level_slide(shapes)?;
                let sel: HashSet<NodeId> = shapes.iter().copied().collect();
                self.edit_slide(slide, ch, |s| {
                    let mut refs: Vec<&mut Shape> = s
                        .shapes
                        .iter_mut()
                        .filter(|t| sel.contains(&t.id))
                        .collect();
                    distribute(&mut refs, *axis);
                    Ok(())
                })
            }
            C::Group { shapes, new_id } => {
                if shapes.len() < 2 {
                    return Err(invalid("a group needs at least two shapes"));
                }
                let slide = self.top_level_slide(shapes)?;
                let mut ids = Ids::new(&self.pres);
                let gid = ids.resolve(&mut self.pres, ch, Some(*new_id))?;
                let sel: HashSet<NodeId> = shapes.iter().copied().collect();
                self.edit_slide(slide, ch, |s| {
                    let top = s
                        .shapes
                        .iter()
                        .rposition(|t| sel.contains(&t.id))
                        .unwrap_or(0);
                    let (children, rest): (Vec<Shape>, Vec<Shape>) =
                        s.shapes.drain(..).partition(|t| sel.contains(&t.id));
                    s.shapes = rest;
                    let mut group = Shape::group(children);
                    group.id = gid;
                    group.fill_default_name();
                    s.shapes.insert(top + 1 - sel.len(), group);
                    Ok(())
                })
            }
            C::Ungroup { group } => {
                if !matches!(self.shape(*group)?.kind, ShapeKind::Group { .. }) {
                    return Err(invalid(format!("shape {} is not a group", group.0)));
                }
                let slides = self.slides_of(&[*group])?;
                self.edit_slides(&slides, ch, |d| {
                    let s = d.slide_mut(slides[0])?;
                    let (list, i) = s
                        .container_mut(*group)
                        .ok_or(ShowError::UnknownShape(group.0))?;
                    let g = list.remove(i);
                    let children: Vec<Shape> = g
                        .children()
                        .iter()
                        .map(|c| Shape {
                            transform: c.absolute_transform(&g.transform),
                            ..c.clone()
                        })
                        .collect();
                    list.splice(i..i, children);
                    Ok(())
                })
            }
            C::InsertPicture {
                slide,
                content_type,
                bytes_base64,
                transform,
                new_id,
            } => self.insert_picture(
                *slide,
                content_type,
                bytes_base64,
                transform.as_ref(),
                *new_id,
                ch,
            ),
            C::SetSlideSize { size } => {
                if size.width.0 <= 0 || size.height.0 <= 0 {
                    return Err(invalid("slide size must be positive"));
                }
                let layouts = LayoutKind::ALL.map(|k| Layout::builtin(k, *size));
                Ok(self.set_size(*size, layouts, ch))
            }
            C::RestoreSlideSize { size, layouts } => {
                Ok(self.set_size(*size, (**layouts).clone(), ch))
            }
            C::RemoveMedia { id } => {
                let media = self
                    .pres
                    .media
                    .remove(*id)
                    .ok_or(ShowError::UnknownMedia(id.0))?;
                Ok(C::RestoreMedia {
                    id: *id,
                    content_type: media.content_type,
                    bytes_base64: base64_encode(&media.data),
                })
            }
            C::RestoreMedia {
                id,
                content_type,
                bytes_base64,
            } => {
                let data = base64_decode(bytes_base64)
                    .map_err(|e| ShowError::BadRequest(format!("invalid base64: {e}")))?;
                self.pres.media.insert_with_id(
                    *id,
                    Media {
                        content_type: content_type.clone(),
                        data,
                    },
                );
                Ok(C::RemoveMedia { id: *id })
            }
            C::Compound { commands } => {
                let mut inverses = Vec::with_capacity(commands.len());
                for cmd in commands {
                    match self.exec(cmd, ch) {
                        Ok(inv) => inverses.push(inv),
                        Err(e) => {
                            // Roll back what was applied.
                            let mut scratch = Changes::default();
                            for inv in inverses.iter().rev() {
                                let _ = self.exec(inv, &mut scratch);
                            }
                            return Err(e);
                        }
                    }
                }
                inverses.reverse();
                Ok(C::Compound { commands: inverses })
            }
        }
    }

    fn reserve_slide_ids(&mut self, slide: &Slide) {
        self.pres.reserve_id(slide.id);
        let mut ids = Vec::new();
        for_each_shape(&slide.shapes, &mut |s| ids.push(s.id));
        for id in ids {
            self.pres.reserve_id(id);
        }
    }

    /// Checks `from <= to <= len` for paragraph `paragraph` of the text of
    /// `shape`.
    fn text_range(&self, shape: NodeId, paragraph: u32, from: u32, to: u32) -> R<(usize, usize)> {
        let body = self
            .shape(shape)?
            .text()
            .ok_or_else(|| invalid(format!("shape {} has no text", shape.0)))?;
        let bad = |len| ShowError::BadOffset {
            shape: shape.0,
            paragraph,
            from,
            to,
            len,
        };
        let p = body.paragraphs.get(paragraph as usize).ok_or(bad(0))?;
        let len = para_len(p);
        let (f, t) = (from as usize, to as usize);
        if f > t || t > len {
            return Err(bad(len));
        }
        Ok((f, t))
    }

    fn add_slide(
        &mut self,
        after: Option<NodeId>,
        layout: LayoutKind,
        new_ids: &[i64],
        ch: &mut Changes,
    ) -> R<C> {
        let index = match after {
            None => 0,
            Some(a) => self.slide_index(a)? + 1,
        };
        let mut shapes = self.pres.layout(layout).placeholder_shapes();
        let layout_ids = id_layout(new_ids, 1 + shapes.len())?;
        let mut ids = Ids::new(&self.pres);
        let id = ids.resolve(&mut self.pres, ch, layout_ids[0])?;
        for (s, new) in shapes.iter_mut().zip(&layout_ids[1..]) {
            s.id = ids.resolve(&mut self.pres, ch, *new)?;
            s.fill_default_name();
        }
        let mut slide = Slide::new(id, layout);
        slide.shapes = shapes;
        self.pres.slides.insert(index, slide);
        ch.slides.push(id);
        Ok(C::DeleteSlides { ids: vec![id] })
    }

    /// A model shape from a UI shape: ids resolved, default names, media
    /// checked, text normalized.
    fn build_shape(&mut self, ns: &NewShape, ids: &mut Ids, ch: &mut Changes) -> R<Shape> {
        check_transform(&ns.transform)?;
        let id = ids.resolve(&mut self.pres, ch, Some(ns.id))?;
        let kind = match &ns.kind {
            NewShapeKind::Auto { geometry, text } => ShapeKind::Auto {
                geometry: *geometry,
                text: text.clone(),
            },
            NewShapeKind::Picture { media } => {
                if self.pres.media.get(*media).is_none() {
                    return Err(ShowError::UnknownMedia(media.0));
                }
                ShapeKind::Picture { media: *media }
            }
            NewShapeKind::Group { children } => ShapeKind::Group {
                children: children
                    .iter()
                    .map(|c| self.build_shape(c, ids, ch))
                    .collect::<R<Vec<_>>>()?,
            },
        };
        let mut shape = Shape {
            id,
            name: ns.name.clone(),
            transform: ns.transform,
            kind,
            fill: ns.fill,
            line: ns.line,
            placeholder: ns.placeholder,
        };
        shape.fill_default_name();
        normalize_shape(&mut shape);
        Ok(shape)
    }

    fn align(
        &mut self,
        shapes: &[NodeId],
        mode: AlignMode,
        to: AlignTarget,
        ch: &mut Changes,
    ) -> R<C> {
        let slide = self.top_level_slide(shapes)?;
        let sel: HashSet<NodeId> = shapes.iter().copied().collect();
        let within = if to == AlignTarget::Slide || shapes.len() == 1 {
            self.slide_box()
        } else {
            let picked: Vec<Shape> = shapes
                .iter()
                .map(|&id| self.shape(id).cloned())
                .collect::<R<_>>()?;
            Transform::bounds_of(&picked)
        };
        self.edit_slide(slide, ch, |s| {
            let mut refs: Vec<&mut Shape> = s
                .shapes
                .iter_mut()
                .filter(|t| sel.contains(&t.id))
                .collect();
            align_shapes(&mut refs, mode, within);
            Ok(())
        })
    }

    fn insert_picture(
        &mut self,
        slide: NodeId,
        content_type: &str,
        bytes_base64: &str,
        transform: Option<&Transform>,
        new_id: i64,
        ch: &mut Changes,
    ) -> R<C> {
        self.slide_index(slide)?;
        if content_type.is_empty() {
            return Err(invalid("missing content type"));
        }
        if let Some(t) = transform {
            check_transform(t)?;
        }
        let bytes = base64_decode(bytes_base64)
            .map_err(|e| ShowError::BadRequest(format!("invalid base64: {e}")))?;
        let transform = match transform {
            Some(t) => *t,
            None => self.natural_box(&bytes),
        };
        let mut ids = Ids::new(&self.pres);
        let id = ids.resolve(&mut self.pres, ch, Some(new_id))?;
        let count = self.pres.media.len();
        let media = self.pres.media.insert(content_type.to_owned(), bytes);
        let added = self.pres.media.len() > count;
        let mut shape = Shape::picture(media, transform);
        shape.id = id;
        shape.fill_default_name();
        let restore = self.edit_slide(slide, ch, |s| {
            s.shapes.push(shape);
            Ok(())
        })?;
        Ok(if added {
            C::Compound {
                commands: vec![restore, C::RemoveMedia { id: media }],
            }
        } else {
            restore
        })
    }

    /// The image's natural size at 96 dpi (half the slide when unknown),
    /// scaled down to fit the slide, centered.
    fn natural_box(&self, bytes: &[u8]) -> Transform {
        let size = self.pres.slide_size;
        let (sw, sh) = (size.width.0, size.height.0);
        let (w, h) = match pixel_size(bytes) {
            Some((pw, ph)) => (i64::from(pw) * EMU_PER_PX, i64::from(ph) * EMU_PER_PX),
            None => (sw / 2, sh / 2),
        };
        let scale = (sw as f64 / w as f64).min(sh as f64 / h as f64).min(1.0);
        let w = ((w as f64 * scale).round() as i64).clamp(1, sw.max(1));
        let h = ((h as f64 * scale).round() as i64).clamp(1, sh.max(1));
        Transform::new(Emu((sw - w) / 2), Emu((sh - h) / 2), Emu(w), Emu(h))
    }

    fn set_size(
        &mut self,
        size: model_show::SlideSize,
        layouts: [Layout; 3],
        ch: &mut Changes,
    ) -> C {
        let old_size = std::mem::replace(&mut self.pres.slide_size, size);
        let old_layouts = std::mem::replace(&mut self.pres.layouts, layouts);
        ch.slide_size = true;
        C::RestoreSlideSize {
            size: old_size,
            layouts: Box::new(old_layouts),
        }
    }

    // ----- patch ---------------------------------------------------------

    fn order(&self) -> Vec<NodeId> {
        self.pres.slides.iter().map(|s| s.id).collect()
    }

    /// Builds the patch from the slide order before the command and what
    /// it touched.
    fn finish(&self, before: Vec<NodeId>, ch: Changes) -> ShowPatch {
        let after = self.order();
        let before_set: HashSet<NodeId> = before.iter().copied().collect();
        let after_set: HashSet<NodeId> = after.iter().copied().collect();
        let deleted_slides = before
            .iter()
            .copied()
            .filter(|id| !after_set.contains(id))
            .collect();
        let touched: HashSet<NodeId> = ch
            .slides
            .iter()
            .copied()
            .chain(after.iter().copied().filter(|id| !before_set.contains(id)))
            .collect();
        let slides = self
            .pres
            .slides
            .iter()
            .filter(|s| touched.contains(&s.id))
            .cloned()
            .collect();
        ShowPatch {
            slides_order: (after != before).then_some(after),
            slides,
            deleted_slides,
            id_map: ch.id_map,
            slide_size: ch.slide_size.then_some(self.pres.slide_size),
            info: None,
        }
    }
}

impl AppDocument for ShowDocument {
    type Command = ShowCommand;
    type Patch = ShowPatch;
    type Error = ShowError;

    fn apply(&mut self, cmd: &ShowCommand) -> Result<Applied<ShowCommand, ShowPatch>, ShowError> {
        let before = self.order();
        let mut ch = Changes::default();
        let inverse = self.exec(cmd, &mut ch)?;
        let patch = self.finish(before, ch);
        Ok(Applied {
            patch,
            inverse: Some(inverse),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_names() {
        let named = |n: &str| ShowDocument {
            source_name: Some(n.into()),
            ..ShowDocument::new()
        };
        assert_eq!(ShowDocument::new().suggested_name(), "Untitled.pptx");
        assert_eq!(named("a.pptx").suggested_name(), "a.pptx");
        assert_eq!(named("b.PPTX").suggested_name(), "b.PPTX");
        assert_eq!(named("c.ppt").suggested_name(), "c.pptx");
        assert_eq!(named("d").suggested_name(), "d.pptx");
    }

    #[test]
    fn open_rejects_garbage() {
        let err = ShowDocument::open_pptx(b"not a zip", "x.pptx").unwrap_err();
        assert_eq!(err.code(), "invalid_file");
    }

    #[test]
    fn new_presentation_saves_and_reopens() {
        let bytes = ShowDocument::new().save_pptx().unwrap();
        let (doc, _) = ShowDocument::open_pptx(&bytes, "n.pptx").unwrap();
        assert_eq!(doc.source_name.as_deref(), Some("n.pptx"));
        assert!(doc.pptx_context.is_some());
        assert_eq!(doc.presentation().slides.len(), 1);
    }
}
