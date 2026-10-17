//! Charts, audio/video and Reuse Slides (P8-24): the commands that bring
//! content into the presentation (`InsertChart`, `SetChartData`,
//! `UpdateChart`, `InsertMedia`, `SetMediaPoster`, `InsertSlides`).

use std::collections::HashMap;

use core_model::chart::{Chart, ChartKind};
use core_model::media::{MediaId, MediaStore};
use model_show::{ChartData, ChartShape, Hyperlink, LinkTarget, MediaClip, MediaKind, SlideRef};

use super::*;

/// Replaces media ids by `map` in pictures, clips, posters and chart
/// workbooks (recursively).
fn remap_media(shapes: &mut [Shape], map: &HashMap<MediaId, MediaId>) {
    let m = |id: &mut MediaId| {
        if let Some(n) = map.get(id) {
            *id = *n;
        }
    };
    for s in shapes {
        match &mut s.kind {
            ShapeKind::Picture { media, .. } => m(media),
            ShapeKind::Media(c) => {
                m(&mut c.media);
                if let Some(p) = &mut c.poster {
                    m(p);
                }
            }
            ShapeKind::Chart(c) => {
                if let Some(w) = &mut c.workbook {
                    m(w);
                }
            }
            ShapeKind::Group { children } => remap_media(children, map),
            _ => {}
        }
    }
}

/// Rewrites links to slides by `map`; links to other slides are removed.
fn remap_slide_links(shapes: &mut [Shape], map: &HashMap<NodeId, NodeId>) {
    let fix = |h: &mut Option<Hyperlink>| {
        if let Some(Hyperlink {
            target: LinkTarget::Slide(SlideRef::Id(id)),
            ..
        }) = h
        {
            match map.get(id) {
                Some(n) => *id = *n,
                None => *h = None,
            }
        }
    };
    for s in shapes {
        fix(&mut s.click_action);
        match &mut s.kind {
            ShapeKind::Auto {
                text: Some(body), ..
            } => {
                for r in body.paragraphs.iter_mut().flat_map(|p| p.runs.iter_mut()) {
                    fix(&mut r.hyperlink);
                }
            }
            ShapeKind::Table(t) => {
                for r in t
                    .cells
                    .iter_mut()
                    .flatten()
                    .flat_map(|c| c.text.paragraphs.iter_mut())
                    .flat_map(|p| p.runs.iter_mut())
                {
                    fix(&mut r.hyperlink);
                }
            }
            ShapeKind::Group { children } => remap_slide_links(children, map),
            _ => {}
        }
    }
}

/// The standard layout a slide with these placeholders fits (Reuse Slides
/// without source formatting, for custom layouts): a centred title or a
/// subtitle → Title Slide; a title and a body → Title and Content (two
/// bodies: Two Content); a title only → Title Only; nothing → Blank.
pub(crate) fn infer_layout(slide: &Slide) -> LayoutKind {
    let count = |k: &[PlaceholderKind]| {
        slide
            .shapes
            .iter()
            .filter(|s| s.placeholder.is_some_and(|p| k.contains(&p)))
            .count()
    };
    let titles = count(&[PlaceholderKind::Title]);
    let centred = count(&[PlaceholderKind::CenteredTitle, PlaceholderKind::Subtitle]);
    let bodies = count(&[PlaceholderKind::Body, PlaceholderKind::Picture]);
    match (centred, titles, bodies) {
        (c, _, _) if c > 0 => LayoutKind::Title,
        (_, _, b) if b >= 2 => LayoutKind::TwoContent,
        (_, _, 1) => LayoutKind::TitleContent,
        (_, t, 0) if t > 0 => LayoutKind::TitleOnly,
        _ => LayoutKind::Blank,
    }
}

impl ShowDocument {
    /// A box of `fraction` of the slide, centered (aspect `ratio` w/h when
    /// given, fitted into that box).
    fn centered_box(&self, fraction: f64, ratio: Option<f64>) -> Transform {
        let size = self.pres.slide_size;
        let (sw, sh) = (size.width.0 as f64, size.height.0 as f64);
        let (mut w, mut h) = (sw * fraction, sh * fraction);
        if let Some(r) = ratio {
            if w / h > r {
                w = h * r;
            } else {
                h = w / r;
            }
        }
        let (w, h) = (w.round().max(1.0) as i64, h.round().max(1.0) as i64);
        Transform::new(
            Emu((size.width.0 - w) / 2),
            Emu((size.height.0 - h) / 2),
            Emu(w),
            Emu(h),
        )
    }

    pub(super) fn insert_chart(
        &mut self,
        slide: NodeId,
        kind: &ChartKind,
        transform: Option<&Transform>,
        new_id: i64,
        ch: &mut Changes,
    ) -> R<C> {
        self.slide_index(slide)?;
        if matches!(kind, ChartKind::Unsupported { .. } | ChartKind::Combo) {
            return Err(invalid(
                "insert a chart of a basic type (combo charts: change its type afterwards)",
            ));
        }
        if let Some(t) = transform {
            check_transform(t)?;
        }
        let t = transform
            .copied()
            .unwrap_or_else(|| self.centered_box(2.0 / 3.0, None));
        let mut ids = Ids::new(&self.pres);
        let id = ids.resolve(&mut self.pres, ch, Some(new_id))?;
        let mut shape = Shape::chart(ChartShape::sample(kind.clone()), t);
        shape.id = id;
        shape.fill_default_name();
        self.edit_slide(slide, ch, |s| {
            s.shapes.push(shape);
            Ok(())
        })
    }

    /// The chart of shape `shape` (must be editable: not unsupported).
    fn editable_chart(&self, shape: NodeId) -> R<&ChartShape> {
        let c = self
            .shape(shape)?
            .chart_data()
            .ok_or_else(|| invalid(format!("shape {} is not a chart", shape.0)))?;
        if matches!(c.chart.kind, ChartKind::Unsupported { .. }) {
            return Err(invalid("this chart type is read-only"));
        }
        Ok(c)
    }

    pub(super) fn set_chart_data(
        &mut self,
        shape: NodeId,
        data: &ChartData,
        ch: &mut Changes,
    ) -> R<C> {
        self.editable_chart(shape)?;
        data.validate().map_err(invalid)?;
        let mut data = data.clone();
        data.normalize();
        self.edit_shapes(&[shape], ch, |s| {
            if let ShapeKind::Chart(c) = &mut s.kind {
                c.set_data(data.clone());
            }
            Ok(())
        })
    }

    pub(super) fn update_chart(&mut self, shape: NodeId, chart: &Chart, ch: &mut Changes) -> R<C> {
        self.editable_chart(shape)?;
        if matches!(chart.kind, ChartKind::Unsupported { .. }) {
            return Err(invalid("a chart cannot become an unsupported type"));
        }
        if !(1..=48).contains(&chart.style) {
            return Err(invalid(format!(
                "chart style {} outside 1..48",
                chart.style
            )));
        }
        self.edit_shapes(&[shape], ch, |s| {
            if let ShapeKind::Chart(c) = &mut s.kind {
                c.chart = chart.clone();
                c.canonicalize();
            }
            Ok(())
        })
    }

    /// Adds `bytes` to the media store; the inverse part removes it again
    /// when it is new.
    fn add_media(&mut self, content_type: &str, bytes_base64: &str) -> R<(MediaId, bool)> {
        let bytes = base64_decode(bytes_base64)
            .map_err(|e| ShowError::BadRequest(format!("invalid base64: {e}")))?;
        let count = self.pres.media.len();
        let id = self.pres.media.insert(content_type.to_owned(), bytes);
        Ok((id, self.pres.media.len() > count))
    }

    pub(super) fn insert_media(
        &mut self,
        slide: NodeId,
        content_type: &str,
        bytes_base64: &str,
        transform: Option<&Transform>,
        new_id: i64,
        ch: &mut Changes,
    ) -> R<C> {
        self.slide_index(slide)?;
        if !(content_type.starts_with("video/") || content_type.starts_with("audio/")) {
            return Err(invalid(format!("{content_type} is no audio or video type")));
        }
        if let Some(t) = transform {
            check_transform(t)?;
        }
        let kind = MediaKind::of_content_type(content_type);
        let t = match (transform, kind) {
            (Some(t), _) => *t,
            (None, MediaKind::Video) => self.centered_box(0.5, Some(16.0 / 9.0)),
            (None, MediaKind::Audio) => {
                let size = self.pres.slide_size;
                let d = 457_200;
                Transform::new(
                    Emu((size.width.0 - d) / 2),
                    Emu((size.height.0 - d) / 2),
                    Emu(d),
                    Emu(d),
                )
            }
        };
        let mut ids = Ids::new(&self.pres);
        let id = ids.resolve(&mut self.pres, ch, Some(new_id))?;
        let (media, added) = self.add_media(content_type, bytes_base64)?;
        let mut shape = Shape::media(MediaClip::new(kind, media), t);
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

    pub(super) fn set_media_poster(
        &mut self,
        shape: NodeId,
        content_type: Option<&str>,
        bytes_base64: Option<&str>,
        ch: &mut Changes,
    ) -> R<C> {
        if self.shape(shape)?.media_clip().is_none() {
            return Err(invalid(format!("shape {} is no audio or video", shape.0)));
        }
        let (poster, added) = match (content_type, bytes_base64) {
            (Some(ct), Some(b)) if ct.starts_with("image/") => {
                let (id, added) = self.add_media(ct, b)?;
                (Some(id), added)
            }
            (None, None) => (None, false),
            _ => return Err(invalid("a poster frame needs an image type and its bytes")),
        };
        let restore = self.edit_shapes(&[shape], ch, |s| {
            if let ShapeKind::Media(m) = &mut s.kind {
                m.poster = poster;
            }
            Ok(())
        })?;
        Ok(match (added, poster) {
            (true, Some(id)) => C::Compound {
                commands: vec![restore, C::RemoveMedia { id }],
            },
            _ => restore,
        })
    }

    /// A unique custom layout kind for `name`.
    fn unique_custom(&self, name: &str) -> LayoutKind {
        let base = if name.trim().is_empty() {
            "Custom Layout".to_owned()
        } else {
            name.trim().to_owned()
        };
        let taken = |n: &str| {
            self.pres
                .layouts
                .iter()
                .any(|l| l.kind == LayoutKind::Custom(n.to_owned()) || l.display_name() == n)
        };
        if !taken(&base) {
            return LayoutKind::Custom(base);
        }
        (2..)
            .map(|i| format!("{base} {i}"))
            .find(|n| !taken(n))
            .map(LayoutKind::Custom)
            .unwrap_or(LayoutKind::Blank)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn insert_slides(
        &mut self,
        after: Option<NodeId>,
        slides: &[Slide],
        layouts: &[Layout],
        media: &MediaStore,
        keep: bool,
        ch: &mut Changes,
    ) -> R<C> {
        if slides.is_empty() {
            return Err(invalid("no slides to insert"));
        }
        let mut index = match after {
            None => 0,
            Some(a) => self.slide_index(a)? + 1,
        };
        let design_before = self.design_snapshot();
        // media: shared when identical, removed again on undo when new
        let mut media_map: HashMap<MediaId, MediaId> = HashMap::new();
        let mut added_media = Vec::new();
        for (old, m) in media.iter() {
            let count = self.pres.media.len();
            let new = self
                .pres
                .media
                .insert(m.content_type.clone(), m.data.clone());
            if self.pres.media.len() > count {
                added_media.push(new);
            }
            media_map.insert(old, new);
        }
        let source: HashMap<&LayoutKind, &Layout> = layouts.iter().map(|l| (&l.kind, l)).collect();
        // keep source formatting: each used source layout once, as a custom layout
        let mut copied: HashMap<LayoutKind, LayoutKind> = HashMap::new();
        if keep {
            for s in slides {
                let Some(l) = source.get(&s.layout) else {
                    continue;
                };
                if copied.contains_key(&s.layout) {
                    continue;
                }
                let kind = self.unique_custom(l.display_name());
                let mut copy = (*l).clone();
                copy.kind = kind.clone();
                copy.name.clear();
                for sh in &mut copy.shapes {
                    self.pres.assign_ids(sh);
                }
                remap_media(&mut copy.shapes, &media_map);
                self.pres.layouts.push(copy);
                copied.insert(s.layout.clone(), kind);
            }
            ch.design |= !copied.is_empty();
        }
        // fresh ids for the slides first (links between inserted slides)
        let slide_map: HashMap<NodeId, NodeId> = slides
            .iter()
            .map(|s| (s.id, self.pres.alloc_id()))
            .collect();
        let mut inserted = Vec::with_capacity(slides.len());
        for s in slides {
            let mut slide = s.clone();
            slide.id = slide_map[&s.id];
            match copied.get(&s.layout) {
                Some(kind) => slide.layout = kind.clone(),
                None => {
                    let target = if self.pres.layout(&s.layout).is_some() || s.layout.is_standard()
                    {
                        s.layout.clone()
                    } else {
                        infer_layout(&slide)
                    };
                    let new = self
                        .known_layout(&target)
                        .or_else(|_| self.known_layout(&LayoutKind::Blank))?;
                    let old = source
                        .get(&s.layout)
                        .map(|l| (*l).clone())
                        .unwrap_or_else(|| self.pres.layout_or_builtin(&s.layout));
                    slide.apply_layout(&old, &new);
                }
            }
            let old_ids = shape_ids(&slide.shapes);
            let pres = &mut self.pres;
            reid(&mut slide.shapes, &mut || Ok(pres.alloc_id()))?;
            let map: HashMap<NodeId, NodeId> =
                old_ids.into_iter().zip(shape_ids(&slide.shapes)).collect();
            for a in &mut slide.animations {
                a.id = self.pres.alloc_id();
                a.shape = map.get(&a.shape).copied().unwrap_or(a.shape);
                if let Some(t) = &a.start_on {
                    a.start_on =
                        Some(t.with_shape(map.get(&t.shape()).copied().unwrap_or(t.shape())));
                }
            }
            slide.prune_animations();
            model_show::presentation::remap_attachments(&mut slide.shapes, &map);
            remap_media(&mut slide.shapes, &media_map);
            if let Some(model_show::TransitionSound::Play { media, .. }) =
                slide.transition.as_mut().and_then(|t| t.sound.as_mut())
            {
                if let Some(n) = media_map.get(media) {
                    *media = *n;
                }
                if self.pres.media.get(*media).is_none() {
                    // the source's sound is not available: no sound
                    if let Some(t) = slide.transition.as_mut() {
                        t.sound = None;
                    }
                }
            }
            remap_slide_links(&mut slide.shapes, &slide_map);
            for sh in &mut slide.shapes {
                normalize_shape(sh);
            }
            slide
                .validate()
                .map_err(|e| invalid(format!("inserted slide: {e}")))?;
            for id in Presentation::media_of(&slide.shapes) {
                if self.pres.media.get(id).is_none() {
                    return Err(ShowError::UnknownMedia(id.0));
                }
            }
            inserted.push(slide);
        }
        let ids: Vec<NodeId> = inserted.iter().map(|s| s.id).collect();
        for slide in inserted {
            self.pres.slides.insert(index, slide);
            index += 1;
        }
        ch.slides.extend_from_slice(&ids);
        let mut undo = vec![C::DeleteSlides { ids }];
        undo.extend(added_media.into_iter().map(|id| C::RemoveMedia { id }));
        if !copied.is_empty() {
            undo.push(design_before);
        }
        Ok(C::Compound { commands: undo })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_inference() {
        let mut s = Slide::new(NodeId(1), LayoutKind::Custom("X".into()));
        assert_eq!(infer_layout(&s), LayoutKind::Blank);
        let ph = |k| {
            let mut sh = Shape::text_box(Transform::default(), "");
            sh.placeholder = Some(k);
            sh
        };
        s.shapes.push(ph(PlaceholderKind::Title));
        assert_eq!(infer_layout(&s), LayoutKind::TitleOnly);
        s.shapes.push(ph(PlaceholderKind::Body));
        assert_eq!(infer_layout(&s), LayoutKind::TitleContent);
        s.shapes.push(ph(PlaceholderKind::Body));
        assert_eq!(infer_layout(&s), LayoutKind::TwoContent);
        s.shapes.push(ph(PlaceholderKind::Subtitle));
        assert_eq!(infer_layout(&s), LayoutKind::Title);
    }
}
