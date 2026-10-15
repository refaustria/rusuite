//! Helpers shared by the integration tests.

use model_show::{NodeId, Presentation, Shape, ShapeKind};

fn zero_ids(p: &mut Presentation) {
    fn walk(shapes: &mut [Shape]) {
        for s in shapes {
            s.id = NodeId(0);
            if let ShapeKind::Group { children } = &mut s.kind {
                walk(children);
            }
        }
    }
    for slide in &mut p.slides {
        slide.id = NodeId(0);
        walk(&mut slide.shapes);
    }
}

/// Asserts `a` and `b` are equal ignoring node ids.
pub fn assert_same(name: &str, a: &Presentation, b: &Presentation) {
    let (mut a, mut b) = (a.clone(), b.clone());
    zero_ids(&mut a);
    zero_ids(&mut b);
    assert_eq!(a.slide_size, b.slide_size, "{name}: slide size");
    assert_eq!(a.theme, b.theme, "{name}: theme");
    assert_eq!(a.media, b.media, "{name}: media");
    assert_eq!(a.layouts, b.layouts, "{name}: layouts");
    assert_eq!(a.slides.len(), b.slides.len(), "{name}: slide count");
    for (i, (x, y)) in a.slides.iter().zip(&b.slides).enumerate() {
        assert_eq!(x, y, "{name}: slide {}", i + 1);
    }
}
