//! A [`Slide`]: its layout, shapes (in z-order) and background.

use serde::{Deserialize, Serialize};

use crate::layout::LayoutKind;
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
}

impl Slide {
    /// An empty slide (no shapes, inherited background).
    pub fn new(id: NodeId, layout: LayoutKind) -> Self {
        Self {
            id,
            layout,
            shapes: Vec::new(),
            background: None,
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
}
