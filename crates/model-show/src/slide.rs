//! A [`Slide`]: its layout, shapes (in z-order) and background.

use serde::{Deserialize, Serialize};

use crate::layout::{Layout, LayoutKind, PlaceholderKind};
use crate::shape::{Fill, Shape, ShapeKind};
use crate::NodeId;

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
    /// Background; `None` inherits the master's (white).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<Fill>,
    /// Hidden in the slide show (`p:sld/@show="0"`); still edited and saved.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub hidden: bool,
    /// Speaker notes as plain text (paragraphs separated by `\n`; the
    /// slide's `notesSlide` part).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn is_false(v: &bool) -> bool {
    !*v
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
        }
    }

    /// Changes the slide's layout to `layout` (PowerPoint's "Layout"):
    /// placeholders that have a counterpart in the new layout (same kind,
    /// or same class: title ↔ centered title, body ↔ subtitle) take its
    /// kind and, if they still sit where the old layout put them, its
    /// position; empty placeholders without a counterpart are removed;
    /// missing placeholders are added as empty shapes (with id 0 and no
    /// name: the caller assigns both). Other shapes are kept as they are.
    pub fn apply_layout(&mut self, old: &Layout, new: &Layout) {
        let class = |k: PlaceholderKind| match k {
            PlaceholderKind::Title | PlaceholderKind::CenteredTitle => 0,
            PlaceholderKind::Subtitle | PlaceholderKind::Body => 1,
        };
        let mut matched: Vec<PlaceholderKind> = Vec::new();
        let mut keep = Vec::with_capacity(self.shapes.len());
        for mut shape in std::mem::take(&mut self.shapes) {
            let Some(kind) = shape.placeholder else {
                keep.push(shape);
                continue;
            };
            let target = new
                .placeholder(kind)
                .filter(|d| !matched.contains(&d.kind))
                .or_else(|| {
                    new.placeholders
                        .iter()
                        .find(|d| class(d.kind) == class(kind) && !matched.contains(&d.kind))
                });
            match target {
                Some(def) => {
                    matched.push(def.kind);
                    let at_default = old
                        .placeholder(kind)
                        .is_some_and(|d| d.transform == shape.transform);
                    if at_default {
                        shape.transform = def.transform;
                    }
                    shape.placeholder = Some(def.kind);
                    keep.push(shape);
                }
                None if !shape.text().is_some_and(|t| !t.is_empty()) => {}
                None => keep.push(shape),
            }
        }
        // Missing placeholders go below the existing shapes, in layout order.
        let mut added: Vec<Shape> = new
            .placeholder_shapes()
            .into_iter()
            .filter(|s| s.placeholder.is_some_and(|k| !matched.contains(&k)))
            .collect();
        added.extend(keep);
        self.shapes = added;
        self.layout = new.kind;
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
}
