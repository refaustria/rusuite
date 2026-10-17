//! A [`Slide`]: its layout, shapes (in z-order) and background.

use serde::{Deserialize, Serialize};

use crate::anim::{Animation, Transition};
use crate::layout::{Layout, LayoutKind, PlaceholderDef};
use crate::shape::{Fill, Shape, ShapeKind};
use crate::theme::Background;
use crate::{Error, NodeId};

/// A slide.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Slide {
    /// Node id (presentation-unique).
    pub id: NodeId,
    /// The layout the slide is based on.
    pub layout: LayoutKind,
    /// Shapes; vector order is the z-order (first = bottom).
    #[serde(default)]
    pub shapes: Vec<Shape>,
    /// Background; `None` inherits the layout's (else the master's).
    /// Older snapshots stored a plain [`Fill`] here; it is read as
    /// [`Background::Fill`].
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "background_compat"
    )]
    pub background: Option<Background>,
    /// Hidden in the slide show (`p:sld/@show="0"`); still edited and saved.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub hidden: bool,
    /// Speaker notes as plain text (paragraphs separated by `\n`; the
    /// slide's `notesSlide` part).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// How the slide appears in the slide show and when it advances
    /// (`p:transition`); `None` = no transition, advance on click.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub transition: Option<Transition>,
    /// Animations of the slide's shapes, in play order (`p:timing`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Animation>>"))]
    pub animations: Vec<Animation>,
    /// Draw the master's and layout's shapes below the slide's
    /// (`showMasterSp`; PowerPoint's "Hide background graphics" = false).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub show_master_shapes: bool,
}

/// A background, or (older snapshots) a plain fill.
fn background_compat<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Background>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Either {
        Background(Background),
        Fill(Fill),
    }
    Ok(match Option::<Either>::deserialize(d)? {
        None => None,
        Some(Either::Background(b)) => Some(b),
        Some(Either::Fill(f)) => Some(Background::Fill(f)),
    })
}

fn is_false(v: &bool) -> bool {
    !*v
}

/// One matching rule of [`Slide::apply_layout`].
type MatchPass = dyn Fn(&Shape, &PlaceholderDef) -> bool;

fn is_true(v: &bool) -> bool {
    *v
}

fn yes() -> bool {
    true
}

impl Slide {
    /// An empty slide (no shapes, inherited background).
    pub fn new(id: NodeId, layout: LayoutKind) -> Self {
        Self {
            id,
            layout,
            shapes: Vec::new(),
            background: None,
            hidden: false,
            notes: None,
            transition: None,
            animations: Vec::new(),
            show_master_shapes: true,
        }
    }

    /// Checks the slide's transition and animations (valid
    /// effect/kind/direction combinations, unique animation ids, every
    /// animation targets a shape of this slide), its tables
    /// ([`crate::Table::validate`]) and that connectors are attached only
    /// to other non-group, non-connector shapes of the slide.
    pub fn validate(&self) -> Result<(), Error> {
        let bad = |reason: String| Error::InvalidSlide {
            slide: self.id,
            reason,
        };
        if let Some(t) = &self.transition {
            t.validate().map_err(bad)?;
        }
        fn tables(shapes: &[Shape], bad: &dyn Fn(String) -> Error) -> Result<(), Error> {
            for s in shapes {
                match &s.kind {
                    ShapeKind::Table(t) => t
                        .validate()
                        .map_err(|e| bad(format!("table {}: {e}", s.id.0)))?,
                    ShapeKind::Group { children } => tables(children, bad)?,
                    _ => {}
                }
            }
            Ok(())
        }
        tables(&self.shapes, &bad)?;
        for id in self.connector_ids() {
            let Some(c) = self.find_shape(id).and_then(Shape::connector) else {
                continue;
            };
            for a in c.attachments() {
                let ok = a.shape != id
                    && self.find_shape(a.shape).is_some_and(|s| {
                        !matches!(s.kind, ShapeKind::Group { .. } | ShapeKind::Connector(_))
                    });
                if !ok {
                    return Err(bad(format!(
                        "connector {} is attached to shape {}, which cannot take it",
                        id.0, a.shape.0
                    )));
                }
            }
        }
        let mut seen = std::collections::HashSet::new();
        for a in &self.animations {
            if !seen.insert(a.id) {
                return Err(bad(format!("animation id {} is used twice", a.id.0)));
            }
            a.validate()
                .map_err(|e| bad(format!("animation {}: {e}", a.id.0)))?;
            let Some(target) = self.find_shape(a.shape) else {
                return Err(bad(format!(
                    "animation {} targets shape {}, which is not on the slide",
                    a.id.0, a.shape.0
                )));
            };
            if a.kind == crate::anim::AnimationKind::Media
                && !matches!(target.kind, ShapeKind::Media(_))
            {
                return Err(bad(format!(
                    "media animation {} targets shape {}, which is no audio/video",
                    a.id.0, a.shape.0
                )));
            }
            match &a.start_on {
                None => {}
                Some(crate::anim::StartOn::Click(s)) => {
                    if self.find_shape(*s).is_none() {
                        return Err(bad(format!(
                            "animation {} is triggered by shape {}, which is not on the slide",
                            a.id.0, s.0
                        )));
                    }
                }
                Some(crate::anim::StartOn::Bookmark { shape, name }) => {
                    let ok = self.find_shape(*shape).is_some_and(|s| match &s.kind {
                        ShapeKind::Media(m) => m.bookmarks.iter().any(|b| &b.name == name),
                        _ => false,
                    });
                    if !ok {
                        return Err(bad(format!(
                            "animation {} is triggered by bookmark {name:?} of shape {}, which does not exist",
                            a.id.0, shape.0
                        )));
                    }
                }
            }
        }
        Ok(())
    }

    /// Removes animations whose shape (or trigger shape or bookmark) is no
    /// longer on the slide (after shapes were deleted or ungrouped). Returns how many were removed.
    pub fn prune_animations(&mut self) -> usize {
        let before = self.animations.len();
        let shapes = &self.shapes;
        self.animations.retain(|a| {
            find_in(shapes, a.shape).is_some()
                && a.start_on.as_ref().map_or(true, |t| match t {
                    crate::anim::StartOn::Click(s) => find_in(shapes, *s).is_some(),
                    crate::anim::StartOn::Bookmark { shape, name } => find_in(shapes, *shape)
                        .is_some_and(|s| match &s.kind {
                            ShapeKind::Media(m) => m.bookmarks.iter().any(|b| &b.name == name),
                            _ => false,
                        }),
                })
        });
        before - self.animations.len()
    }

    /// Puts the animations of the click sequence first, then the
    /// triggered ones grouped by trigger in order of first appearance
    /// (stable): the order of `p:timing` and of PowerPoint's Animation
    /// pane. Returns whether anything moved.
    pub fn order_triggered(&mut self) -> bool {
        let mut keys: Vec<Option<crate::anim::StartOn>> = vec![None];
        for a in &self.animations {
            if !keys.contains(&a.start_on) {
                keys.push(a.start_on.clone());
            }
        }
        let before: Vec<NodeId> = self.animations.iter().map(|a| a.id).collect();
        self.animations.sort_by_key(|a| {
            keys.iter()
                .position(|k| *k == a.start_on)
                .unwrap_or(usize::MAX)
        });
        before
            .iter()
            .zip(&self.animations)
            .any(|(id, a)| *id != a.id)
    }

    /// Position of animation `id` in the play order.
    pub fn animation_index(&self, id: NodeId) -> Option<usize> {
        self.animations.iter().position(|a| a.id == id)
    }

    /// Changes the slide's layout to `new` (PowerPoint's "Layout"; `old`
    /// is the current one). Placeholders that have a counterpart in the
    /// new layout – same kind and `idx`, else same kind, else same class
    /// (title ↔ centred title; body ↔ subtitle ↔ picture; date, footer and
    /// slide number only to themselves) – take its kind and `idx` and, if
    /// they still sit where the old layout put them (or have its body
    /// properties), its position (or body properties); their text is kept.
    /// Empty placeholders without a counterpart are removed (date, footer
    /// and slide number stay); missing placeholders are added as empty
    /// shapes below the others (with id 0 and no name: the caller assigns
    /// both). Other shapes are kept as they are.
    pub fn apply_layout(&mut self, old: &Layout, new: &Layout) {
        let defs = &new.placeholders;
        let shapes = std::mem::take(&mut self.shapes);
        // target def of each shape: exact kind + idx first (for all
        // shapes), then same kind, then same class
        let mut target: Vec<Option<usize>> = vec![None; shapes.len()];
        let mut matched: Vec<usize> = Vec::new();
        let passes: [&MatchPass; 3] = [
            &|s, d| s.placeholder == Some(d.kind) && s.placeholder_idx.unwrap_or(0) == d.idx,
            &|s, d| s.placeholder == Some(d.kind),
            &|s, d| s.placeholder.is_some_and(|k| d.kind.same_class(k)),
        ];
        for pass in passes {
            for (si, shape) in shapes.iter().enumerate() {
                if target[si].is_some() || shape.placeholder.is_none() {
                    continue;
                }
                if let Some(di) =
                    (0..defs.len()).find(|di| !matched.contains(di) && pass(shape, &defs[*di]))
                {
                    matched.push(di);
                    target[si] = Some(di);
                }
            }
        }
        let mut keep = Vec::with_capacity(shapes.len());
        for (mut shape, t) in shapes.into_iter().zip(target) {
            let Some(kind) = shape.placeholder else {
                keep.push(shape);
                continue;
            };
            let before = old.find(kind, shape.placeholder_idx);
            match t {
                Some(i) => {
                    let def = &defs[i];
                    if before.is_some_and(|d| d.transform == shape.transform) {
                        shape.transform = def.transform;
                    }
                    let old_body = before.map(|d| d.body_defaults);
                    if let Some(body) = shape.text_mut() {
                        if old_body == Some(body.props) {
                            body.props = def.body_defaults;
                        }
                    }
                    shape.placeholder = Some(def.kind);
                    shape.placeholder_idx = (def.idx != 0).then_some(def.idx);
                    keep.push(shape);
                }
                None if kind.is_header_footer() => keep.push(shape),
                None if !shape.text().is_some_and(|t| !t.is_empty()) => {}
                None => keep.push(shape),
            }
        }
        // Missing placeholders go below the existing shapes, in layout order.
        let mut added: Vec<Shape> = defs
            .iter()
            .enumerate()
            .filter(|(i, d)| !matched.contains(i) && !d.kind.is_header_footer())
            .map(|(_, d)| d.empty_shape())
            .collect();
        added.extend(keep);
        self.shapes = added;
        self.layout = new.kind.clone();
    }

    /// Resets the placeholders to `layout` (PowerPoint's "Reset"): each
    /// placeholder takes its layout placeholder's position, size and body
    /// properties, and loses its paragraph and run formatting (outline
    /// levels and text stay); missing placeholders (except date, footer
    /// and slide number) are added empty, with id 0. Other shapes are
    /// unchanged.
    pub fn reset_to_layout(&mut self, layout: &Layout) {
        let mut used = Vec::new();
        for shape in &mut self.shapes {
            let Some(kind) = shape.placeholder else {
                continue;
            };
            let Some(def) = layout.find(kind, shape.placeholder_idx) else {
                continue;
            };
            used.push((def.kind, def.idx));
            shape.transform = def.transform;
            if let Some(body) = shape.text_mut() {
                body.props = def.body_defaults;
                for p in &mut body.paragraphs {
                    let level = p.props.level;
                    p.props = crate::text::TextParagraphProps {
                        level,
                        ..Default::default()
                    };
                    for r in &mut p.runs {
                        r.props = core_model::RunProperties::default();
                    }
                }
            }
        }
        let missing: Vec<Shape> = layout
            .placeholders
            .iter()
            .filter(|d| !d.kind.is_header_footer() && !used.contains(&(d.kind, d.idx)))
            .map(PlaceholderDef::empty_shape)
            .collect();
        if !missing.is_empty() {
            let mut shapes = missing;
            shapes.append(&mut self.shapes);
            self.shapes = shapes;
        }
    }

    /// The shape with id `id`, searching inside groups.
    pub fn find_shape(&self, id: NodeId) -> Option<&Shape> {
        find_in(&self.shapes, id)
    }

    /// Mutable access to the shape with id `id`, searching inside groups.
    pub fn find_shape_mut(&mut self, id: NodeId) -> Option<&mut Shape> {
        find_in_mut(&mut self.shapes, id)
    }

    /// The shape list holding shape `id` (the slide's shapes or a group's
    /// children) and the shape's index in it.
    pub fn container_mut(&mut self, id: NodeId) -> Option<(&mut Vec<Shape>, usize)> {
        container_of(&mut self.shapes, id)
    }

    /// Moves shape `id` one step up in z-order (within its group, if any).
    /// Returns whether anything changed.
    pub fn bring_forward(&mut self, id: NodeId) -> bool {
        self.reorder(id, |i, len| (i + 1 < len).then_some(i + 1))
    }

    /// Moves shape `id` one step down in z-order. Returns whether anything
    /// changed.
    pub fn send_backward(&mut self, id: NodeId) -> bool {
        self.reorder(id, |i, _| i.checked_sub(1))
    }

    /// Moves shape `id` to the top of its z-order. Returns whether anything
    /// changed.
    pub fn bring_to_front(&mut self, id: NodeId) -> bool {
        self.reorder(id, |i, len| (i + 1 < len).then_some(len - 1))
    }

    /// Moves shape `id` to the bottom of its z-order. Returns whether
    /// anything changed.
    pub fn send_to_back(&mut self, id: NodeId) -> bool {
        self.reorder(id, |i, _| (i > 0).then_some(0))
    }

    fn reorder(&mut self, id: NodeId, to: impl Fn(usize, usize) -> Option<usize>) -> bool {
        let Some((list, i)) = container_of(&mut self.shapes, id) else {
            return false;
        };
        let Some(j) = to(i, list.len()) else {
            return false;
        };
        let shape = list.remove(i);
        list.insert(j, shape);
        true
    }
}

pub(crate) fn find_in(shapes: &[Shape], id: NodeId) -> Option<&Shape> {
    for s in shapes {
        if s.id == id {
            return Some(s);
        }
        if let ShapeKind::Group { children } = &s.kind {
            if let Some(found) = find_in(children, id) {
                return Some(found);
            }
        }
    }
    None
}

fn find_in_mut(shapes: &mut [Shape], id: NodeId) -> Option<&mut Shape> {
    for s in shapes {
        if s.id == id {
            return Some(s);
        }
        if let ShapeKind::Group { children } = &mut s.kind {
            if let Some(found) = find_in_mut(children, id) {
                return Some(found);
            }
        }
    }
    None
}

/// The list holding shape `id` and its index there.
fn container_of(shapes: &mut Vec<Shape>, id: NodeId) -> Option<(&mut Vec<Shape>, usize)> {
    if let Some(i) = shapes.iter().position(|s| s.id == id) {
        return Some((shapes, i));
    }
    for s in shapes.iter_mut() {
        if let ShapeKind::Group { children } = &mut s.kind {
            if let Some(found) = container_of(children, id) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::PlaceholderKind;
    use crate::shape::{Preset, Transform};
    use crate::text::TextBody;
    use crate::Emu;

    fn slide_with(ids: &[u64]) -> Slide {
        let mut s = Slide::new(NodeId(1), LayoutKind::Blank);
        for &id in ids {
            let mut sh = Shape::auto(Preset::Rect, Transform::default());
            sh.id = NodeId(id);
            s.shapes.push(sh);
        }
        s
    }

    fn order(shapes: &[Shape]) -> Vec<u64> {
        shapes.iter().map(|s| s.id.0).collect()
    }

    #[test]
    fn z_order_ops() {
        let mut s = slide_with(&[10, 11, 12, 13]);
        assert!(s.bring_forward(NodeId(10)));
        assert_eq!(order(&s.shapes), [11, 10, 12, 13]);
        assert!(s.send_backward(NodeId(12)));
        assert_eq!(order(&s.shapes), [11, 12, 10, 13]);
        assert!(s.bring_to_front(NodeId(11)));
        assert_eq!(order(&s.shapes), [12, 10, 13, 11]);
        assert!(s.send_to_back(NodeId(13)));
        assert_eq!(order(&s.shapes), [13, 12, 10, 11]);
        // no-ops at the ends and for unknown ids
        assert!(!s.bring_forward(NodeId(11)));
        assert!(!s.bring_to_front(NodeId(11)));
        assert!(!s.send_backward(NodeId(13)));
        assert!(!s.send_to_back(NodeId(13)));
        assert!(!s.bring_forward(NodeId(99)));
        assert_eq!(order(&s.shapes), [13, 12, 10, 11]);
    }

    #[test]
    fn z_order_inside_group() {
        let mut s = slide_with(&[10]);
        let mut a = Shape::auto(Preset::Rect, Transform::default());
        a.id = NodeId(20);
        let mut b = a.clone();
        b.id = NodeId(21);
        let mut g = Shape::group(vec![a, b]);
        g.id = NodeId(30);
        s.shapes.push(g);
        assert!(s.send_to_back(NodeId(21)));
        assert_eq!(
            order(s.find_shape(NodeId(30)).unwrap().children()),
            [21, 20]
        );
        assert_eq!(order(&s.shapes), [10, 30]);
        assert_eq!(s.find_shape(NodeId(20)).unwrap().id, NodeId(20));
        s.find_shape_mut(NodeId(21)).unwrap().name = "x".into();
        assert_eq!(s.find_shape(NodeId(21)).unwrap().name, "x");
    }

    #[test]
    fn apply_layout_maps_adds_and_drops_placeholders() {
        use crate::presentation::SlideSize;
        let size = SlideSize::widescreen();
        let title_l = Layout::builtin(LayoutKind::Title, size);
        let content_l = Layout::builtin(LayoutKind::TitleContent, size);
        let blank_l = Layout::builtin(LayoutKind::Blank, size);
        let mut s = Slide::new(NodeId(1), LayoutKind::Title);
        s.shapes = title_l.placeholder_shapes();
        // the subtitle was moved by the user and holds text
        s.shapes[1].transform.x = Emu(5);
        *s.shapes[1].text_mut().unwrap() = TextBody::plain("sub");
        let mut rect = Shape::auto(Preset::Rect, Transform::default());
        rect.id = NodeId(9);
        s.shapes.push(rect);

        s.apply_layout(&title_l, &content_l);
        assert_eq!(s.layout, LayoutKind::TitleContent);
        let kinds: Vec<_> = s.shapes.iter().map(|x| x.placeholder).collect();
        assert_eq!(
            kinds,
            [
                Some(PlaceholderKind::Title),
                Some(PlaceholderKind::Body),
                None
            ]
        );
        // unmoved title jumps to the new layout's box; the moved body stays
        assert_eq!(
            s.shapes[0].transform,
            content_l
                .placeholder(PlaceholderKind::Title)
                .unwrap()
                .transform
        );
        assert_eq!(s.shapes[1].transform.x, Emu(5));
        assert_eq!(s.shapes[2].id, NodeId(9));

        // to blank: the empty title goes, the body with text and the rect stay
        s.apply_layout(&content_l, &blank_l);
        assert_eq!(s.layout, LayoutKind::Blank);
        assert_eq!(
            s.shapes.iter().map(|x| x.placeholder).collect::<Vec<_>>(),
            [Some(PlaceholderKind::Body), None]
        );

        // back to title: a missing centered title is added at the bottom, the
        // body becomes the subtitle
        s.apply_layout(&blank_l, &title_l);
        assert_eq!(
            s.shapes.iter().map(|x| x.placeholder).collect::<Vec<_>>(),
            [
                Some(PlaceholderKind::CenteredTitle),
                Some(PlaceholderKind::Subtitle),
                None
            ]
        );
        assert_eq!(s.shapes[0].id, NodeId(0), "new shapes have no id yet");
    }

    #[test]
    fn hidden_and_notes_serialize_only_when_set() {
        let mut s = Slide::new(NodeId(3), LayoutKind::Blank);
        let json = serde_json::to_string(&s).unwrap();
        assert!(
            !json.contains("hidden") && !json.contains("notes"),
            "{json}"
        );
        s.hidden = true;
        s.notes = Some("hi".into());
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""hidden":true"#) && json.contains(r#""notes":"hi""#));
        let back: Slide = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
        let old: Slide = serde_json::from_str(r#"{"id":1,"layout":"blank"}"#).unwrap();
        assert!(!old.hidden && old.notes.is_none());
    }

    #[test]
    fn triggered_animations_follow_the_click_sequence() {
        use crate::anim::{Animation, AnimationKind, Effect, StartOn};
        let mut s = Slide::new(NodeId(1), LayoutKind::Blank);
        let mk = |id: u64, on: Option<StartOn>| Animation {
            id: NodeId(id),
            start_on: on,
            ..Animation::new(NodeId(2), AnimationKind::Entrance, Effect::Fade)
        };
        let a = Some(StartOn::Click(NodeId(7)));
        let b = Some(StartOn::Click(NodeId(8)));
        s.animations = vec![
            mk(10, a.clone()),
            mk(11, None),
            mk(12, b.clone()),
            mk(13, a.clone()),
            mk(14, None),
        ];
        assert!(s.order_triggered());
        let ids: Vec<u64> = s.animations.iter().map(|x| x.id.0).collect();
        assert_eq!(ids, [11, 14, 10, 13, 12]);
        assert!(!s.order_triggered(), "stable once ordered");
    }
}
