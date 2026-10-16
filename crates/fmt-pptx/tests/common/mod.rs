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
    fn order(shapes: &[Shape], out: &mut Vec<NodeId>) {
        for s in shapes {
            out.push(s.id);
            order(s.children(), out);
        }
    }
    walk(&mut p.master.shapes);
    for l in &mut p.layouts {
        walk(&mut l.shapes);
    }
    for slide in &mut p.slides {
        slide.id = NodeId(0);
        // animation targets become depth-first shape positions
        let mut ids = Vec::new();
        order(&slide.shapes, &mut ids);
        let pos = |id: NodeId| {
            NodeId(
                ids.iter()
                    .position(|i| *i == id)
                    .map_or(u64::MAX, |i| i as u64),
            )
        };
        for a in &mut slide.animations {
            a.id = NodeId(0);
            a.shape = pos(a.shape);
        }
        // connector attachments too
        fn attach(shapes: &mut [Shape], pos: &dyn Fn(NodeId) -> NodeId) {
            for s in shapes {
                match &mut s.kind {
                    ShapeKind::Connector(c) => {
                        for a in [&mut c.start, &mut c.end].into_iter().flatten() {
                            a.shape = pos(a.shape);
                        }
                    }
                    ShapeKind::Group { children } => attach(children, pos),
                    _ => {}
                }
            }
        }
        attach(&mut slide.shapes, &pos);
        walk(&mut slide.shapes);
    }
}

/// Asserts `a` and `b` are equal ignoring node ids.
pub fn assert_same(name: &str, a: &Presentation, b: &Presentation) {
    // sections hold slide ids: compare them as slide positions
    let pos = |p: &Presentation| {
        p.sections
            .iter()
            .map(|s| {
                (
                    s.name.clone(),
                    s.slide_ids
                        .iter()
                        .map(|id| p.slide_index(*id))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(pos(a), pos(b), "{name}: sections");
    let (mut a, mut b) = (a.clone(), b.clone());
    zero_ids(&mut a);
    zero_ids(&mut b);
    assert_eq!(a.slide_size, b.slide_size, "{name}: slide size");
    assert_eq!(a.theme, b.theme, "{name}: theme");
    assert_eq!(a.media, b.media, "{name}: media");
    assert_eq!(a.master, b.master, "{name}: master");
    assert_eq!(a.layouts, b.layouts, "{name}: layouts");
    assert_eq!(a.slides.len(), b.slides.len(), "{name}: slide count");
    for (i, (x, y)) in a.slides.iter().zip(&b.slides).enumerate() {
        assert_eq!(x, y, "{name}: slide {}", i + 1);
    }
}

/// `xml` (an element or a sequence of elements) re-indented for review.
#[allow(dead_code)]
pub fn pretty(xml: &str) -> String {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(xml.as_bytes());
    let mut writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 1);
    loop {
        match reader.read_event().unwrap() {
            Event::Eof => break,
            Event::Decl(_) => {}
            ev => writer.write_event(ev).unwrap(),
        }
    }
    String::from_utf8(writer.into_inner()).unwrap()
}
