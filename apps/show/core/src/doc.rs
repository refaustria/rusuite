//! [`ShowDocument`]: a [`model_show::Presentation`] behind the
//! [`app_common::Document`] trait.

use std::collections::HashSet;

use app_common::{Applied, DispatchError, Document as AppDocument};
use core_model::media::{base64_decode, base64_encode, Media};
use core_model::units::Emu;
use model_show::{
    align_shapes, distribute, presentation::header_footer_shapes, AlignMode, Attach, Background,
    Connector, Crop, Fill, HeaderFooter, Layout, LayoutKind, Line, NodeId, PictureProps,
    PlaceholderDef, PlaceholderKind, Presentation, Shape, ShapeKind, Site, Slide, SlideMaster,
    Table, TextClass, Transform,
};

use crate::command::{
    AlignTarget, AnimationPatch, BackgroundTarget, DesignTarget, HfTarget, NewAttach, NewShape,
    NewShapeKind, PlaceholderPatch, ShowCommand, ThemeChoice, ZOp,
};
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
    /// Theme, master or layouts changed.
    design: bool,
    /// Sections changed.
    sections: bool,
}

/// Every slide, shape and animation id of `p` (master and layout shapes
/// included).
fn all_ids(p: &Presentation) -> HashSet<NodeId> {
    let mut out = HashSet::new();
    for slide in &p.slides {
        out.insert(slide.id);
        for_each_shape(&slide.shapes, &mut |s| {
            out.insert(s.id);
        });
        out.extend(slide.animations.iter().map(|a| a.id));
    }
    for_each_shape(&p.master.shapes, &mut |s| {
        out.insert(s.id);
    });
    for l in &p.layouts {
        for_each_shape(&l.shapes, &mut |s| {
            out.insert(s.id);
        });
    }
    out
}

/// Shape ids of `shapes`, depth-first (a group before its children).
fn shape_ids(shapes: &[Shape]) -> Vec<NodeId> {
    let mut out = Vec::new();
    for_each_shape(shapes, &mut |s| out.push(s.id));
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
        match &mut c.kind {
            ShapeKind::Group { children } => scale_shapes(children, sx, sy),
            ShapeKind::Table(table) => table.scale_to(t.w, t.h),
            _ => {}
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
        ShapeKind::Table(t) => t.normalize(),
        _ => {}
    }
}

/// Where shape `id` is on `slide` and where its connection sites are.
fn site_state(slide: &Slide, id: NodeId) -> Option<(Transform, Vec<Site>)> {
    Some((
        slide.absolute_transform(id)?,
        slide.find_shape(id)?.connection_sites(),
    ))
}

/// Keeps connectors glued after an edit of `slide` (`old` = its content
/// before): attachments to removed shapes are dropped; connectors whose
/// attached shapes moved (or changed geometry), or whose attachments or
/// kind changed, are rerouted; a connector moved by the edit itself lets go
/// of shapes that stayed where they were (as dragging it in PowerPoint).
fn follow_connectors(old: &Slide, slide: &mut Slide) {
    slide.detach_missing();
    let mut reroute = Vec::new();
    let mut detach = Vec::new();
    for cid in slide.connector_ids() {
        let Some(c) = slide.find_shape(cid).and_then(Shape::connector) else {
            continue;
        };
        let before = old.find_shape(cid).and_then(Shape::connector);
        let unchanged = before == Some(c);
        let self_moved = unchanged && old.absolute_transform(cid) != slide.absolute_transform(cid);
        let moved = |a: &Attach| site_state(old, a.shape) != site_state(slide, a.shape);
        let (start_moved, end_moved) = (
            c.start.is_some_and(|a| moved(&a)),
            c.end.is_some_and(|a| moved(&a)),
        );
        if self_moved {
            let lets_go = (
                c.start.is_some() && !start_moved,
                c.end.is_some() && !end_moved,
            );
            if lets_go.0 || lets_go.1 {
                detach.push((cid, lets_go));
            }
        }
        if !unchanged || start_moved || end_moved {
            reroute.push(cid);
        }
    }
    for (cid, (start, end)) in detach {
        if let Some(ShapeKind::Connector(c)) = slide.find_shape_mut(cid).map(|s| &mut s.kind) {
            if start {
                c.start = None;
            }
            if end {
                c.end = None;
            }
        }
    }
    for cid in reroute {
        slide.reroute_connector(cid);
    }
}

/// The table of shape `s`, or an error.
fn table_of(s: &mut Shape) -> R<&mut Table> {
    let id = s.id.0;
    s.table_mut()
        .ok_or_else(|| invalid(format!("shape {id} is not a table")))
}

/// Layout placeholder `d` inherits master change `old` → `new`: every
/// field that still had the master's old value takes the new one.
fn inherit(d: &mut PlaceholderDef, old: &PlaceholderDef, new: &PlaceholderDef) {
    if d.transform == old.transform {
        d.transform = new.transform;
    }
    if d.body_defaults == old.body_defaults {
        d.body_defaults = new.body_defaults;
    }
    let diff = model_show::run_diff(&new.run_defaults, &old.run_defaults);
    let own = model_show::run_diff(&d.run_defaults, &old.run_defaults);
    // only fields the layout did not override
    let mut r = d.run_defaults.clone();
    r.apply(&diff);
    r.apply(&own);
    d.run_defaults = r;
    let pdiff = new.paragraph_defaults.diff_from(&old.paragraph_defaults);
    let pown = d.paragraph_defaults.diff_from(&old.paragraph_defaults);
    let level = d.paragraph_defaults.level;
    d.paragraph_defaults = d.paragraph_defaults.merged_with(&pdiff).merged_with(&pown);
    d.paragraph_defaults.level = level;
}

/// The box of a picture whose crop changes from `old` to `new`: the image
/// stays where it is, the box follows the visible part.
fn recrop_box(t: &Transform, old: &Crop, new: &Crop) -> Transform {
    let (vw, vh) = (old.visible_w(), old.visible_h());
    if vw <= 0.0 || vh <= 0.0 {
        return *t;
    }
    let full_w = t.w.0 as f64 / vw;
    let full_h = t.h.0 as f64 / vh;
    let x0 = t.x.0 as f64 - full_w * old.left;
    let y0 = t.y.0 as f64 - full_h * old.top;
    Transform {
        x: Emu((x0 + full_w * new.left).round() as i64),
        y: Emu((y0 + full_h * new.top).round() as i64),
        w: Emu((full_w * new.visible_w()).round().max(0.0) as i64),
        h: Emu((full_h * new.visible_h()).round().max(0.0) as i64),
        ..*t
    }
}

/// Master and layouts for slide size `size`: the Office ones when the
/// presentation has exactly the Office design for its current size, else
/// its own with every placeholder and shape box scaled.
fn resized_design(p: &Presentation, size: model_show::SlideSize) -> (SlideMaster, Vec<Layout>) {
    let builtin = Presentation::empty(p.slide_size);
    if p.master == builtin.master && p.layouts == builtin.layouts {
        let fresh = Presentation::empty(size);
        return (fresh.master, fresh.layouts);
    }
    let sx = size.width.0 as f64 / p.slide_size.width.0.max(1) as f64;
    let sy = size.height.0 as f64 / p.slide_size.height.0.max(1) as f64;
    let sc = |t: &mut Transform| {
        t.x = Emu((t.x.0 as f64 * sx).round() as i64);
        t.y = Emu((t.y.0 as f64 * sy).round() as i64);
        t.w = Emu((t.w.0 as f64 * sx).round() as i64);
        t.h = Emu((t.h.0 as f64 * sy).round() as i64);
    };
    let mut master = p.master.clone();
    let mut layouts = p.layouts.clone();
    for d in master
        .placeholders
        .iter_mut()
        .chain(layouts.iter_mut().flat_map(|l| l.placeholders.iter_mut()))
    {
        sc(&mut d.transform);
    }
    for s in master
        .shapes
        .iter_mut()
        .chain(layouts.iter_mut().flat_map(|l| l.shapes.iter_mut()))
    {
        sc(&mut s.transform);
        let (w, h) = (s.transform.w, s.transform.h);
        match &mut s.kind {
            ShapeKind::Group { children } => scale_shapes(children, sx, sy),
            ShapeKind::Table(t) => t.scale_to(w, h),
            _ => {}
        }
    }
    (master, layouts)
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
            for a in &slide.animations {
                if !seen.insert(a.id) {
                    dup = dup.or(Some(a.id));
                }
            }
        }
        for shapes in
            std::iter::once(&pres.master.shapes).chain(pres.layouts.iter().map(|l| &l.shapes))
        {
            for_each_shape(shapes, &mut |s| {
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
        pres.validate()
            .map_err(|e| ShowError::InvalidDocument(e.to_string()))?;
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
        // Animations of shapes that were removed go with them; connectors
        // follow the shapes they are glued to.
        for (id, before) in slides.iter().zip(&old) {
            if let Some(s) = self.pres.slide_mut(*id) {
                s.prune_animations();
                follow_connectors(before, s);
            }
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

    /// Edits the table (and box) of table shape `shape` with `f`; the
    /// table must stay valid.
    fn edit_table(
        &mut self,
        shape: NodeId,
        ch: &mut Changes,
        f: impl FnOnce(&mut Table, &mut Transform) -> Result<(), String>,
    ) -> R<C> {
        if self.shape(shape)?.table_data().is_none() {
            return Err(invalid(format!("shape {} is not a table", shape.0)));
        }
        let mut f = Some(f);
        self.edit_shapes(&[shape], ch, |s| {
            let mut tr = s.transform;
            let t = table_of(s)?;
            if let Some(f) = f.take() {
                f(t, &mut tr).map_err(invalid)?;
            }
            t.validate().map_err(invalid)?;
            s.transform = tr;
            Ok(())
        })
    }

    /// Applies `cmd` and returns its inverse. On error the presentation is
    /// unchanged (compound commands roll back). Sections follow slide
    /// additions, removals and moves; when they change, the inverse puts
    /// them back too.
    fn exec(&mut self, cmd: &ShowCommand, ch: &mut Changes) -> R<C> {
        let own = matches!(
            cmd,
            C::Compound { .. }
                | C::RestoreSections { .. }
                | C::AddSection { .. }
                | C::RenameSection { .. }
                | C::RemoveSection { .. }
                | C::MoveSection { .. }
        );
        let before = (!own).then(|| self.pres.sections.clone());
        let inverse = self.exec_inner(cmd, ch)?;
        let Some(before) = before else {
            return Ok(inverse);
        };
        self.pres.fix_sections();
        if self.pres.sections == before {
            return Ok(inverse);
        }
        ch.sections = true;
        Ok(C::Compound {
            commands: vec![inverse, C::RestoreSections { sections: before }],
        })
    }

    fn exec_inner(&mut self, cmd: &ShowCommand, ch: &mut Changes) -> R<C> {
        match cmd {
            C::AddSlide {
                after,
                layout,
                new_ids,
            } => self.add_slide(*after, layout, new_ids, ch),
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
                let old_ids = shape_ids(&copy.shapes);
                reid(&mut copy.shapes, &mut next)?;
                // animations get fresh ids and follow their shapes' copies
                let map: std::collections::HashMap<NodeId, NodeId> =
                    old_ids.into_iter().zip(shape_ids(&copy.shapes)).collect();
                for a in &mut copy.animations {
                    a.id = self.pres.alloc_id();
                    a.shape = map.get(&a.shape).copied().unwrap_or(a.shape);
                }
                model_show::presentation::remap_attachments(&mut copy.shapes, &map);
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
                    // connectors must be glued to shapes of this slide
                    s.validate().map_err(|e| invalid(e.to_string()))
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
                        if let ShapeKind::Table(table) = &mut s.kind {
                            if (t.w, t.h) != (old.w, old.h) {
                                table.scale_to(t.w, t.h);
                            }
                        }
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
                let (master, layouts) = resized_design(&self.pres, *size);
                Ok(self.set_size(*size, master, layouts, ch))
            }
            C::SetSlideLayout { slide, layout } => {
                let old_kind = self.pres.slides[self.slide_index(*slide)?].layout.clone();
                let old = self.pres.layout_or_builtin(&old_kind);
                let new = self.known_layout(layout)?;
                self.edit_slides(&[*slide], ch, |d| {
                    let s = d.slide_mut(*slide)?;
                    s.apply_layout(&old, &new);
                    let fresh: Vec<usize> = (0..s.shapes.len())
                        .filter(|&i| s.shapes[i].id == NodeId(0))
                        .collect();
                    for i in fresh {
                        let id = d.pres.alloc_id();
                        let shape = &mut d.slide_mut(*slide)?.shapes[i];
                        shape.id = id;
                        shape.fill_default_name();
                    }
                    Ok(())
                })
            }
            C::SetSlidesHidden { slides, hidden } => {
                for &id in slides {
                    self.slide_index(id)?;
                }
                let mut unique = slides.clone();
                unique.sort_unstable();
                unique.dedup();
                self.edit_slides(&unique, ch, |d| {
                    for &id in &unique {
                        d.slide_mut(id)?.hidden = *hidden;
                    }
                    Ok(())
                })
            }
            C::SetNotes { slide, notes } => {
                let notes = notes.clone().filter(|n| !n.is_empty());
                self.edit_slide(*slide, ch, |s| {
                    s.notes = notes;
                    Ok(())
                })
            }
            C::SetAltText { shape, alt } => {
                let alt = alt.clone().filter(|a| !a.is_empty());
                self.edit_shapes(&[*shape], ch, |s| {
                    s.alt.clone_from(&alt);
                    Ok(())
                })
            }
            C::ReplacePicture {
                shape,
                content_type,
                bytes_base64,
            } => self.replace_picture(*shape, content_type, bytes_base64, ch),
            C::ResetPictureSize { shapes } => {
                let mut boxes = Vec::with_capacity(shapes.len());
                for &id in shapes {
                    let s = self.shape(id)?;
                    let ShapeKind::Picture { media, .. } = s.kind else {
                        return Err(invalid(format!("shape {} is not a picture", id.0)));
                    };
                    let bytes = &self
                        .pres
                        .media
                        .get(media)
                        .ok_or(ShowError::UnknownMedia(media.0))?
                        .data;
                    let natural = self.natural_box(bytes);
                    boxes.push((id, natural.w, natural.h));
                }
                self.edit_shapes(shapes, ch, |s| {
                    if let Some((_, w, h)) = boxes.iter().find(|(id, ..)| *id == s.id) {
                        s.transform.w = *w;
                        s.transform.h = *h;
                    }
                    Ok(())
                })
            }
            C::RestoreSlideSize {
                size,
                master,
                layouts,
            } => Ok(self.set_size(*size, (**master).clone(), layouts.clone(), ch)),
            C::RestoreDesign {
                theme,
                master,
                layouts,
            } => {
                let inverse = self.design_snapshot();
                self.pres.theme = (**theme).clone();
                self.pres.master = (**master).clone();
                self.pres.layouts = layouts.clone();
                let ids: Vec<NodeId> = std::iter::once(&self.pres.master.shapes)
                    .chain(self.pres.layouts.iter().map(|l| &l.shapes))
                    .flat_map(|l| shape_ids(l))
                    .collect();
                for id in ids {
                    self.pres.reserve_id(id);
                }
                ch.design = true;
                Ok(inverse)
            }
            C::RestoreSections { sections } => {
                let old = std::mem::replace(&mut self.pres.sections, sections.clone());
                self.pres
                    .validate_sections()
                    .map_err(|e| invalid(e.to_string()))
                    .inspect_err(|_| self.pres.sections = old.clone())?;
                ch.sections = true;
                Ok(C::RestoreSections { sections: old })
            }
            C::ApplyTheme { theme } => {
                let inverse = self.design_snapshot();
                match theme {
                    ThemeChoice::Builtin(id) => {
                        let b = model_show::builtin_theme(id)
                            .ok_or_else(|| invalid(format!("unknown theme {id:?}")))?;
                        self.pres.theme = b.theme;
                        self.pres.master.background = b.background;
                    }
                    ThemeChoice::Custom(t) => self.pres.theme = (**t).clone(),
                }
                ch.design = true;
                Ok(inverse)
            }
            C::SetThemeColors { colors } => {
                let inverse = self.design_snapshot();
                self.pres.theme.colors = colors.clone();
                ch.design = true;
                Ok(inverse)
            }
            C::SetThemeFonts { fonts } => {
                let inverse = self.design_snapshot();
                self.pres.theme.fonts = fonts.clone();
                ch.design = true;
                Ok(inverse)
            }
            C::AddLayout { name } => {
                let kind = LayoutKind::Custom(name.clone());
                if name.is_empty() || self.pres.layout(&kind).is_some() {
                    return Err(invalid(format!("layout name {name:?} is empty or taken")));
                }
                let inverse = self.design_snapshot();
                let l = Layout::from_master(kind, &self.pres.master, self.pres.slide_size);
                self.pres.layouts.push(l);
                ch.design = true;
                Ok(inverse)
            }
            C::DuplicateLayout { layout } => {
                let i = self.layout_index(layout)?;
                let mut copy = self.pres.layouts[i].clone();
                let base = copy.display_name().to_owned();
                let mut n = 1;
                let kind = loop {
                    let k = LayoutKind::Custom(format!("{n}_{base}"));
                    if self.pres.layout(&k).is_none() {
                        break k;
                    }
                    n += 1;
                };
                let inverse = self.design_snapshot();
                copy.kind = kind;
                copy.name.clear();
                let old = shape_ids(&copy.shapes);
                for sh in &mut copy.shapes {
                    self.pres.assign_ids(sh);
                }
                let map: std::collections::HashMap<NodeId, NodeId> =
                    old.into_iter().zip(shape_ids(&copy.shapes)).collect();
                model_show::presentation::remap_attachments(&mut copy.shapes, &map);
                self.pres.layouts.insert(i + 1, copy);
                ch.design = true;
                Ok(inverse)
            }
            C::DeleteLayout { layout } => {
                let i = self.layout_index(layout)?;
                if self.pres.slides.iter().any(|s| &s.layout == layout) {
                    return Err(invalid(format!("layout {layout} is used by slides")));
                }
                let inverse = self.design_snapshot();
                self.pres.layouts.remove(i);
                ch.design = true;
                Ok(inverse)
            }
            C::SetMasterPlaceholderProps {
                target,
                placeholder,
                idx,
                patch,
            } => self.set_placeholder_props(target, *placeholder, *idx, patch, ch),
            C::SetBackground {
                target,
                fill,
                hide_master_shapes,
            } => self.set_background(target, fill.as_ref(), *hide_master_shapes, ch),
            C::ResetSlide { slides } => {
                let mut layouts = Vec::new();
                for &id in slides {
                    let s = &self.pres.slides[self.slide_index(id)?];
                    layouts.push((id, self.pres.layout_or_builtin(&s.layout)));
                }
                self.edit_slides(slides, ch, |d| {
                    for (id, layout) in &layouts {
                        d.slide_mut(*id)?.reset_to_layout(layout);
                    }
                    for (id, _) in &layouts {
                        d.fresh_ids(*id)?;
                    }
                    Ok(())
                })
            }
            C::SetHeaderFooter {
                date,
                footer,
                slide_number,
                apply_to,
                not_on_title,
            } => {
                let hf = HeaderFooter {
                    date: date.clone(),
                    footer: footer.clone(),
                    slide_number: *slide_number,
                    not_on_title: *not_on_title,
                };
                self.set_header_footer(&hf, apply_to, ch)
            }
            C::AddSection { name, first_slide } => {
                let old = self.pres.sections.clone();
                self.pres
                    .add_section(name, *first_slide)
                    .map_err(|e| invalid(e.to_string()))?;
                ch.sections = true;
                Ok(C::RestoreSections { sections: old })
            }
            C::RenameSection { index, name } => {
                let s = self
                    .pres
                    .sections
                    .get_mut(*index as usize)
                    .ok_or_else(|| invalid(format!("no section {index}")))?;
                let old = std::mem::replace(&mut s.name, name.clone());
                ch.sections = true;
                Ok(C::RenameSection {
                    index: *index,
                    name: old,
                })
            }
            C::RemoveSection { index, keep_slides } => {
                let old = self.pres.sections.clone();
                let removed = self
                    .pres
                    .remove_section(*index as usize, *keep_slides)
                    .map_err(|e| invalid(e.to_string()))?;
                ch.sections = true;
                let restore = C::RestoreSections { sections: old };
                if removed.is_empty() {
                    return Ok(restore);
                }
                let slides: Vec<(u32, Slide)> =
                    removed.into_iter().map(|(i, s)| (i as u32, s)).collect();
                Ok(C::Compound {
                    commands: vec![C::RestoreSlides { slides }, restore],
                })
            }
            C::MoveSection { index, to_index } => {
                self.pres
                    .move_section(*index as usize, *to_index as usize)
                    .map_err(|e| invalid(e.to_string()))?;
                ch.sections = true;
                Ok(C::MoveSection {
                    index: *to_index,
                    to_index: *index,
                })
            }
            C::SetPictureProps { shapes, patch } => {
                for &id in shapes {
                    if self.shape(id)?.picture_props().is_none() {
                        return Err(invalid(format!("shape {} is not a picture", id.0)));
                    }
                }
                self.edit_shapes(shapes, ch, |s| {
                    if let Some(p) = s.picture_props_mut() {
                        patch.apply_to(p);
                    }
                    Ok(())
                })
            }
            C::CropPicture {
                shape,
                crop,
                transform,
            } => {
                let s = self.shape(*shape)?;
                let old = s
                    .picture_props()
                    .ok_or_else(|| invalid(format!("shape {} is not a picture", shape.0)))?
                    .crop;
                if crop.visible_w() <= 0.0 || crop.visible_h() <= 0.0 {
                    return Err(invalid("the crop leaves nothing visible"));
                }
                let t = match transform {
                    Some(t) => {
                        check_transform(t)?;
                        *t
                    }
                    None => recrop_box(&s.transform, &old, crop),
                };
                self.edit_shapes(&[*shape], ch, |s| {
                    s.transform = t;
                    if let Some(p) = s.picture_props_mut() {
                        p.crop = *crop;
                    }
                    Ok(())
                })
            }
            C::ResetPicture { shapes, size } => {
                let mut boxes = Vec::with_capacity(shapes.len());
                for &id in shapes {
                    let s = self.shape(id)?;
                    let ShapeKind::Picture { media, props } = &s.kind else {
                        return Err(invalid(format!("shape {} is not a picture", id.0)));
                    };
                    let mut t = recrop_box(&s.transform, &props.crop, &Crop::default());
                    if *size {
                        let bytes = &self
                            .pres
                            .media
                            .get(*media)
                            .ok_or(ShowError::UnknownMedia(media.0))?
                            .data;
                        let natural = self.natural_box(bytes);
                        t.w = natural.w;
                        t.h = natural.h;
                    }
                    boxes.push((id, t));
                }
                self.edit_shapes(shapes, ch, |s| {
                    if let Some((_, t)) = boxes.iter().find(|(id, _)| *id == s.id) {
                        s.transform = *t;
                    }
                    if let Some(p) = s.picture_props_mut() {
                        *p = PictureProps::default();
                    }
                    Ok(())
                })
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
            C::SetTransition { slides, transition } => self.set_transition(slides, *transition, ch),
            C::ApplyTransitionToAll { from } => {
                let t = self.pres.slides[self.slide_index(*from)?].transition;
                let all = self.order();
                self.set_transition(&all, t, ch)
            }
            C::AddAnimation {
                slide,
                animation,
                new_id,
                index,
            } => self.add_animation(*slide, animation, *new_id, *index, ch),
            C::UpdateAnimation { id, patch } => self.update_animation(*id, patch, ch),
            C::RemoveAnimation { id } => {
                let slide = self.slide_of_animation(*id)?;
                self.edit_slide(slide, ch, |s| {
                    s.animations.retain(|a| a.id != *id);
                    Ok(())
                })
            }
            C::ReorderAnimation { id, index } => {
                let slide = self.slide_of_animation(*id)?;
                self.edit_slide(slide, ch, |s| {
                    let len = s.animations.len();
                    let to = *index as usize;
                    if to >= len {
                        return Err(invalid(format!(
                            "animation index {to} out of range 0..{len}"
                        )));
                    }
                    let from = s.animation_index(*id).unwrap_or(0);
                    let a = s.animations.remove(from);
                    s.animations.insert(to, a);
                    Ok(())
                })
            }
            C::SetGeometry {
                shapes,
                geometry,
                adjust,
            } => {
                for &id in shapes {
                    let s = self.shape(id)?;
                    let ShapeKind::Auto { geometry: g, .. } = &s.kind else {
                        return Err(invalid(format!("shape {} is not an auto shape", id.0)));
                    };
                    let preset = geometry.as_ref().unwrap_or(g);
                    if let Some(adj) = adjust {
                        let allowed = preset.adjust_defaults();
                        if let Some(bad) = adj.keys().find(|k| !allowed.iter().any(|(n, _)| n == k))
                        {
                            return Err(invalid(format!(
                                "{} has no adjust value {bad}",
                                preset.prst()
                            )));
                        }
                    }
                }
                self.edit_shapes(shapes, ch, |s| {
                    if let ShapeKind::Auto {
                        geometry: g,
                        adjust: a,
                        ..
                    } = &mut s.kind
                    {
                        if let Some(new) = geometry {
                            if new != g {
                                *g = new.clone();
                                a.clear();
                            }
                        }
                        if let Some(new) = adjust {
                            a.clone_from(new);
                        }
                    }
                    Ok(())
                })
            }
            C::SetConnector { shape, patch } => {
                if self.shape(*shape)?.connector().is_none() {
                    return Err(invalid(format!("shape {} is not a connector", shape.0)));
                }
                let slides = self.slides_of(&[*shape])?;
                self.edit_slides(&slides, ch, |d| {
                    if let ShapeKind::Connector(c) = &mut d.shape_mut(*shape)?.kind {
                        patch.apply_to(c);
                    }
                    d.slide_mut(slides[0])?
                        .validate()
                        .map_err(|e| invalid(e.to_string()))
                })
            }
            C::InsertTable {
                slide,
                rows,
                cols,
                transform,
                new_id,
            } => {
                self.slide_index(*slide)?;
                if *rows == 0 || *cols == 0 || *rows > 1_000 || *cols > 1_000 {
                    return Err(invalid("a table needs 1–1000 rows and columns"));
                }
                let t = match transform {
                    Some(t) => {
                        check_transform(t)?;
                        *t
                    }
                    None => {
                        let size = self.pres.slide_size;
                        let w = size.width.0 * 2 / 3;
                        let h = 370_840 * i64::from(*rows);
                        Transform::new(
                            Emu((size.width.0 - w) / 2),
                            Emu(((size.height.0 - h) / 2).max(0)),
                            Emu(w),
                            Emu(h),
                        )
                    }
                };
                let mut ids = Ids::new(&self.pres);
                let id = ids.resolve(&mut self.pres, ch, Some(*new_id))?;
                let mut shape = Shape::table(*rows as usize, *cols as usize, t);
                shape.id = id;
                shape.fill_default_name();
                self.edit_slide(*slide, ch, |s| {
                    s.shapes.push(shape);
                    Ok(())
                })
            }
            C::SetTableCellText {
                shape,
                row,
                col,
                body,
            } => {
                let mut body = body.clone();
                body.normalize();
                self.edit_table(*shape, ch, |t, _| {
                    let cell = t
                        .cell_mut(*row as usize, *col as usize)
                        .ok_or_else(|| format!("cell {row},{col} out of the table"))?;
                    if cell.covered {
                        return Err(format!("cell {row},{col} is covered by a merged cell"));
                    }
                    // margins and alignment stay with the cell
                    let props = cell.text.props;
                    cell.text = body.clone();
                    cell.text.props = props;
                    Ok(())
                })
            }
            C::InsertTableRow { shape, index } => self.edit_table(*shape, ch, |t, tr| {
                t.insert_row(*index as usize)?;
                tr.h = Emu(tr.h.0 + t.rows[*index as usize].height.0);
                Ok(())
            }),
            C::InsertTableCol { shape, index } => self.edit_table(*shape, ch, |t, tr| {
                t.insert_col(*index as usize)?;
                tr.w = Emu(tr.w.0 + t.cols[*index as usize].width.0);
                Ok(())
            }),
            C::DeleteTableRow { shape, index } => self.edit_table(*shape, ch, |t, tr| {
                let h = t.rows.get(*index as usize).map_or(0, |r| r.height.0);
                t.delete_row(*index as usize)?;
                tr.h = Emu((tr.h.0 - h).max(0));
                Ok(())
            }),
            C::DeleteTableCol { shape, index } => self.edit_table(*shape, ch, |t, tr| {
                let w = t.cols.get(*index as usize).map_or(0, |c| c.width.0);
                t.delete_col(*index as usize)?;
                tr.w = Emu((tr.w.0 - w).max(0));
                Ok(())
            }),
            C::MergeTableCells {
                shape,
                row,
                col,
                row_span,
                col_span,
            } => self.edit_table(*shape, ch, |t, _| {
                t.merge(
                    *row as usize,
                    *col as usize,
                    *row_span as usize,
                    *col_span as usize,
                )
            }),
            C::SplitTableCell { shape, row, col } => {
                self.edit_table(*shape, ch, |t, _| t.split(*row as usize, *col as usize))
            }
            C::SetTableCellProps {
                shape,
                row,
                col,
                row_span,
                col_span,
                patch,
            } => self.edit_table(*shape, ch, |t, _| {
                let (r0, c0) = (*row as usize, *col as usize);
                let (r1, c1) = (r0 + *row_span as usize, c0 + *col_span as usize);
                if *row_span == 0 || *col_span == 0 || r1 > t.row_count() || c1 > t.col_count() {
                    return Err(format!(
                        "cell range {row},{col} {row_span}×{col_span} out of the table"
                    ));
                }
                for r in r0..r1 {
                    for c in c0..c1 {
                        if let Some(cell) = t.cell_mut(r, c) {
                            patch.apply_to(cell);
                        }
                    }
                }
                Ok(())
            }),
            C::SetTableStyle {
                shape,
                style_id,
                look,
            } => {
                let style = style_id.clone().filter(|s| !s.is_empty());
                self.edit_table(*shape, ch, |t, _| {
                    t.style_id.clone_from(&style);
                    t.look = *look;
                    Ok(())
                })
            }
            C::SetTableGrid {
                shape,
                col_widths,
                row_heights,
            } => self.edit_table(*shape, ch, |t, tr| {
                if let Some(w) = col_widths {
                    if w.len() != t.col_count() || w.iter().any(|v| v.0 < 0) {
                        return Err(format!("expected {} column widths ≥ 0", t.col_count()));
                    }
                    for (c, v) in t.cols.iter_mut().zip(w) {
                        c.width = *v;
                    }
                    tr.w = t.width();
                }
                if let Some(h) = row_heights {
                    if h.len() != t.row_count() || h.iter().any(|v| v.0 < 0) {
                        return Err(format!("expected {} row heights ≥ 0", t.row_count()));
                    }
                    for (r, v) in t.rows.iter_mut().zip(h) {
                        r.height = *v;
                    }
                    tr.h = t.height();
                }
                Ok(())
            }),
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
        let mut ids = shape_ids(&slide.shapes);
        ids.extend(slide.animations.iter().map(|a| a.id));
        for id in ids {
            self.pres.reserve_id(id);
        }
    }

    /// The slide holding animation `id`.
    fn slide_of_animation(&self, id: NodeId) -> R<NodeId> {
        self.pres
            .find_animation(id)
            .map(|(s, _)| s.id)
            .ok_or_else(|| invalid(format!("unknown animation {}", id.0)))
    }

    fn set_transition(
        &mut self,
        slides: &[NodeId],
        transition: Option<model_show::Transition>,
        ch: &mut Changes,
    ) -> R<C> {
        if let Some(t) = &transition {
            t.validate().map_err(invalid)?;
        }
        let transition = transition.filter(|t| !t.is_noop());
        let mut unique = Vec::with_capacity(slides.len());
        for &id in slides {
            self.slide_index(id)?;
            if !unique.contains(&id) {
                unique.push(id);
            }
        }
        self.edit_slides(&unique, ch, |d| {
            for &id in &unique {
                d.slide_mut(id)?.transition = transition;
            }
            Ok(())
        })
    }

    fn add_animation(
        &mut self,
        slide: NodeId,
        animation: &model_show::Animation,
        new_id: i64,
        index: Option<u32>,
        ch: &mut Changes,
    ) -> R<C> {
        let s = &self.pres.slides[self.slide_index(slide)?];
        let len = s.animations.len();
        let at = index.map_or(len, |i| i as usize);
        if at > len {
            return Err(invalid(format!(
                "animation index {at} out of range 0..={len}"
            )));
        }
        if s.find_shape(animation.shape).is_none() {
            return Err(invalid(format!(
                "shape {} is not on slide {}",
                animation.shape.0, slide.0
            )));
        }
        animation.validate().map_err(invalid)?;
        let mut ids = Ids::new(&self.pres);
        let id = ids.resolve(&mut self.pres, ch, Some(new_id))?;
        let a = model_show::Animation { id, ..*animation };
        self.edit_slide(slide, ch, |s| {
            s.animations.insert(at, a);
            Ok(())
        })
    }

    fn update_animation(&mut self, id: NodeId, patch: &AnimationPatch, ch: &mut Changes) -> R<C> {
        let slide = self.slide_of_animation(id)?;
        self.edit_slide(slide, ch, |s| {
            let a = s
                .animations
                .iter_mut()
                .find(|a| a.id == id)
                .ok_or_else(|| invalid(format!("unknown animation {}", id.0)))?;
            patch.apply_to(a);
            a.validate().map_err(invalid)
        })
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
        layout: &LayoutKind,
        new_ids: &[i64],
        ch: &mut Changes,
    ) -> R<C> {
        let index = match after {
            None => 0,
            Some(a) => self.slide_index(a)? + 1,
        };
        let l = self.known_layout(layout)?;
        let mut shapes = l.placeholder_shapes();
        shapes.extend(header_footer_shapes(
            &self.pres.master.header_footer,
            &l,
            &self.pres.master,
        ));
        let layout_ids = id_layout(new_ids, 1 + shapes.len())?;
        let mut ids = Ids::new(&self.pres);
        let id = ids.resolve(&mut self.pres, ch, layout_ids[0])?;
        for (s, new) in shapes.iter_mut().zip(&layout_ids[1..]) {
            s.id = ids.resolve(&mut self.pres, ch, *new)?;
            s.fill_default_name();
        }
        let mut slide = Slide::new(id, layout.clone());
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
            NewShapeKind::Auto {
                geometry,
                adjust,
                text,
            } => ShapeKind::Auto {
                geometry: geometry.clone(),
                adjust: adjust.clone(),
                text: text.clone(),
            },
            NewShapeKind::Connector(c) => {
                // temporary ids of shapes created earlier in this command
                let attach = |a: &Option<NewAttach>| -> R<Option<Attach>> {
                    let Some(a) = a else { return Ok(None) };
                    let shape = if a.shape < 0 {
                        ch.id_map
                            .iter()
                            .find(|(t, _)| *t == a.shape)
                            .map(|(_, real)| *real)
                            .ok_or_else(|| invalid(format!("unknown temporary id {}", a.shape)))?
                    } else {
                        NodeId(a.shape as u64)
                    };
                    Ok(Some(Attach {
                        shape,
                        site: a.site,
                    }))
                };
                ShapeKind::Connector(Connector {
                    kind: c.kind,
                    bends: c.bends.clamp(1, 4),
                    start: attach(&c.start)?,
                    end: attach(&c.end)?,
                    head: c.head,
                    tail: c.tail,
                    adjust: c.adjust.clone(),
                })
            }
            NewShapeKind::Table(t) => {
                t.validate().map_err(invalid)?;
                ShapeKind::Table(t.clone())
            }
            NewShapeKind::Picture { media, props } => {
                if self.pres.media.get(*media).is_none() {
                    return Err(ShowError::UnknownMedia(media.0));
                }
                ShapeKind::Picture {
                    media: *media,
                    props: props.clone(),
                }
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
            placeholder_idx: ns.placeholder_idx,
            alt: ns.alt.clone().filter(|a| !a.is_empty()),
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

    fn replace_picture(
        &mut self,
        shape: NodeId,
        content_type: &str,
        bytes_base64: &str,
        ch: &mut Changes,
    ) -> R<C> {
        let old = self.shape(shape)?.transform;
        if !matches!(self.shape(shape)?.kind, ShapeKind::Picture { .. }) {
            return Err(invalid(format!("shape {} is not a picture", shape.0)));
        }
        if content_type.is_empty() {
            return Err(invalid("missing content type"));
        }
        let bytes = base64_decode(bytes_base64)
            .map_err(|e| ShowError::BadRequest(format!("invalid base64: {e}")))?;
        let fitted = match pixel_size(&bytes) {
            Some((pw, ph)) if pw > 0 && ph > 0 && old.w.0 > 0 && old.h.0 > 0 => {
                let (pw, ph) = (f64::from(pw), f64::from(ph));
                let scale = (old.w.0 as f64 / pw).min(old.h.0 as f64 / ph);
                let w = ((pw * scale).round() as i64).max(1);
                let h = ((ph * scale).round() as i64).max(1);
                Transform {
                    x: Emu(old.x.0 + (old.w.0 - w) / 2),
                    y: Emu(old.y.0 + (old.h.0 - h) / 2),
                    w: Emu(w),
                    h: Emu(h),
                    ..old
                }
            }
            _ => old,
        };
        let count = self.pres.media.len();
        let media = self.pres.media.insert(content_type.to_owned(), bytes);
        let added = self.pres.media.len() > count;
        let restore = self.edit_shapes(&[shape], ch, |s| {
            let props = s.picture_props().cloned().unwrap_or_default();
            s.kind = ShapeKind::Picture { media, props };
            s.transform = fitted;
            Ok(())
        });
        let restore = match restore {
            Ok(r) => r,
            Err(e) => {
                if added {
                    self.pres.media.remove(media);
                }
                return Err(e);
            }
        };
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
        master: SlideMaster,
        layouts: Vec<Layout>,
        ch: &mut Changes,
    ) -> C {
        let old_size = std::mem::replace(&mut self.pres.slide_size, size);
        let old_master = std::mem::replace(&mut self.pres.master, master);
        let old_layouts = std::mem::replace(&mut self.pres.layouts, layouts);
        ch.slide_size = true;
        ch.design = true;
        C::RestoreSlideSize {
            size: old_size,
            master: Box::new(old_master),
            layouts: old_layouts,
        }
    }

    // ----- design ----------------------------------------------------------

    /// The inverse of a design change: the current theme, master and
    /// layouts.
    fn design_snapshot(&self) -> C {
        C::RestoreDesign {
            theme: Box::new(self.pres.theme.clone()),
            master: Box::new(self.pres.master.clone()),
            layouts: self.pres.layouts.clone(),
        }
    }

    /// Layout `kind` (standard kinds the presentation lacks: the built-in
    /// one); unknown custom layouts are an error.
    fn known_layout(&self, kind: &LayoutKind) -> R<Layout> {
        if !kind.is_standard() && self.pres.layout(kind).is_none() {
            return Err(invalid(format!("unknown layout {kind}")));
        }
        Ok(self.pres.layout_or_builtin(kind))
    }

    fn layout_index(&self, kind: &LayoutKind) -> R<usize> {
        self.pres
            .layouts
            .iter()
            .position(|l| &l.kind == kind)
            .ok_or_else(|| invalid(format!("unknown layout {kind}")))
    }

    /// Gives the shapes of slide `id` that have id 0 (just added) fresh
    /// ids and default names.
    fn fresh_ids(&mut self, id: NodeId) -> R<()> {
        let n = self.slide_mut(id)?.shapes.len();
        for i in 0..n {
            if self.slide_mut(id)?.shapes[i].id == NodeId(0) {
                let new = self.pres.alloc_id();
                let shape = &mut self.slide_mut(id)?.shapes[i];
                shape.id = new;
                shape.fill_default_name();
            }
        }
        Ok(())
    }

    fn set_placeholder_props(
        &mut self,
        target: &DesignTarget,
        kind: PlaceholderKind,
        idx: Option<u32>,
        patch: &PlaceholderPatch,
        ch: &mut Changes,
    ) -> R<C> {
        if let Some(t) = &patch.transform {
            check_transform(t)?;
        }
        let design = self.design_snapshot();
        let apply = |d: &mut PlaceholderDef| {
            if let Some(t) = patch.transform {
                d.transform = t;
            }
            if let Some(b) = patch.body {
                d.body_defaults = b;
            }
            if let Some(r) = &patch.run {
                d.run_defaults.apply(r);
            }
            if let Some(pp) = &patch.paragraph {
                pp.apply_to(&mut d.paragraph_defaults);
            }
        };
        // (layout kind, old def, new def) of every layout placeholder that changed
        let mut changed: Vec<(LayoutKind, PlaceholderDef, PlaceholderDef)> = Vec::new();
        match target {
            DesignTarget::Master => {
                let m = &mut self.pres.master;
                let i = m
                    .placeholders
                    .iter()
                    .position(|d| d.kind == kind && idx.map_or(true, |x| d.idx == x))
                    .ok_or_else(|| invalid(format!("the master has no {kind:?} placeholder")))?;
                let old = m.placeholders[i].clone();
                apply(&mut m.placeholders[i]);
                let new = m.placeholders[i].clone();
                // level 1 of the title/body text style follows
                let class = kind.text_class();
                if class != TextClass::Other {
                    if let Some(l) = m.text_styles.of_mut(class).first_mut() {
                        if let Some(r) = &patch.run {
                            l.run.apply(r);
                        }
                        if let Some(pp) = &patch.paragraph {
                            pp.apply_to(&mut l.paragraph);
                        }
                    }
                }
                let master = self.pres.master.clone();
                for layout in &mut self.pres.layouts {
                    for d in &mut layout.placeholders {
                        if master.placeholder_for(d.kind).map(|x| x.kind) != Some(new.kind) {
                            continue;
                        }
                        let before = d.clone();
                        inherit(d, &old, &new);
                        if *d != before {
                            changed.push((layout.kind.clone(), before, d.clone()));
                        }
                    }
                }
            }
            DesignTarget::Layout(lk) => {
                let li = self.layout_index(lk)?;
                let layout = &mut self.pres.layouts[li];
                let i = layout
                    .placeholders
                    .iter()
                    .position(|d| d.kind == kind && idx.map_or(true, |x| d.idx == x))
                    .ok_or_else(|| invalid(format!("layout {lk} has no {kind:?} placeholder")))?;
                let old = layout.placeholders[i].clone();
                apply(&mut layout.placeholders[i]);
                changed.push((lk.clone(), old, layout.placeholders[i].clone()));
            }
        }
        // slide placeholders that sat at their layout placeholder's
        // position (or had its body properties) follow it
        let mut slides = Vec::new();
        for s in &self.pres.slides {
            if changed.iter().any(|(k, ..)| *k == s.layout) {
                slides.push(s.id);
            }
        }
        let content = self.edit_slides(&slides, ch, |d| {
            for &id in &slides {
                let s = d.slide_mut(id)?;
                for (lk, old, new) in &changed {
                    if &s.layout != lk {
                        continue;
                    }
                    for shape in &mut s.shapes {
                        let Some(k) = shape.placeholder else { continue };
                        if !k.same_class(old.kind) || shape.placeholder_idx.unwrap_or(0) != old.idx
                        {
                            continue;
                        }
                        if shape.transform == old.transform {
                            shape.transform = new.transform;
                        }
                        if let Some(body) = shape.text_mut() {
                            if body.props == old.body_defaults {
                                body.props = new.body_defaults;
                            }
                        }
                    }
                }
            }
            Ok(())
        })?;
        ch.design = true;
        Ok(C::Compound {
            commands: vec![content, design],
        })
    }

    fn set_background(
        &mut self,
        target: &BackgroundTarget,
        fill: Option<&Background>,
        hide: Option<bool>,
        ch: &mut Changes,
    ) -> R<C> {
        match target {
            BackgroundTarget::Slides(slides) => {
                let fill = match fill {
                    None => None,
                    Some(Background::Fill(f)) => Some(*f),
                    Some(Background::Style { .. }) => {
                        return Err(invalid("slides take explicit background fills"))
                    }
                };
                for &id in slides {
                    self.slide_index(id)?;
                }
                let mut unique = slides.clone();
                unique.dedup();
                self.edit_slides(&unique, ch, |d| {
                    for &id in &unique {
                        let s = d.slide_mut(id)?;
                        s.background = fill;
                        if let Some(h) = hide {
                            s.show_master_shapes = !h;
                        }
                    }
                    Ok(())
                })
            }
            BackgroundTarget::Layout(kind) => {
                let i = self.layout_index(kind)?;
                let inverse = self.design_snapshot();
                let l = &mut self.pres.layouts[i];
                l.background = fill.copied();
                if let Some(h) = hide {
                    l.show_master_shapes = !h;
                }
                ch.design = true;
                Ok(inverse)
            }
            BackgroundTarget::Master => {
                if hide.is_some() {
                    return Err(invalid("the master has no master graphics to hide"));
                }
                let inverse = self.design_snapshot();
                self.pres.master.background = fill.copied().unwrap_or_default();
                ch.design = true;
                Ok(inverse)
            }
        }
    }

    fn set_header_footer(
        &mut self,
        hf: &HeaderFooter,
        target: &HfTarget,
        ch: &mut Changes,
    ) -> R<C> {
        let slides: Vec<NodeId> = match target {
            HfTarget::All => self.order(),
            HfTarget::Slides(list) => {
                for &id in list {
                    self.slide_index(id)?;
                }
                let mut u = list.clone();
                u.dedup();
                u
            }
        };
        let master = self.pres.master.clone();
        let mut plans = Vec::new();
        for &id in &slides {
            let s = &self.pres.slides[self.slide_index(id)?];
            let layout = self.pres.layout_or_builtin(&s.layout);
            plans.push((id, header_footer_shapes(hf, &layout, &master)));
        }
        let design = matches!(target, HfTarget::All).then(|| self.design_snapshot());
        let content = self.edit_slides(&slides, ch, |d| {
            for (id, add) in &plans {
                let s = d.slide_mut(*id)?;
                let old: Vec<Shape> = s
                    .shapes
                    .iter()
                    .filter(|x| x.placeholder.is_some_and(PlaceholderKind::is_header_footer))
                    .cloned()
                    .collect();
                s.shapes
                    .retain(|x| !x.placeholder.is_some_and(PlaceholderKind::is_header_footer));
                for mut shape in add.clone() {
                    // a moved placeholder keeps its box
                    if let Some(o) = old.iter().find(|o| o.placeholder == shape.placeholder) {
                        shape.transform = o.transform;
                    }
                    s.shapes.push(shape);
                }
                d.fresh_ids(*id)?;
            }
            Ok(())
        })?;
        let Some(design) = design else {
            return Ok(content);
        };
        self.pres.master.header_footer = hf.clone();
        ch.design = true;
        Ok(C::Compound {
            commands: vec![content, design],
        })
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
            theme: ch.design.then(|| self.pres.theme.clone()),
            master: ch.design.then(|| self.pres.master.clone()),
            layouts: ch.design.then(|| self.pres.layouts.clone()),
            sections: ch.sections.then(|| self.pres.sections.clone()),
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
