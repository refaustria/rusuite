use model_show::{
    Emu, Error, LayoutKind, NodeId, PlaceholderKind, Presentation, Preset, Shape, ShapeKind,
    SlideSize, TextBody, TextParagraph, Transform,
};

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

/// Collects all ids (slides and shapes, recursively) in order.
fn all_ids(p: &Presentation) -> Vec<u64> {
    fn walk(shapes: &[Shape], out: &mut Vec<u64>) {
        for s in shapes {
            out.push(s.id.0);
            walk(s.children(), out);
        }
    }
    let mut out = Vec::new();
    for slide in &p.slides {
        out.push(slide.id.0);
        walk(&slide.shapes, &mut out);
    }
    out
}

/// Title slide, title+content with bullets at levels 0/1, and a blank slide
/// with rect, ellipse, line, picture and a group.
fn three_slide_deck() -> Presentation {
    let mut p = Presentation::new();
    let s1 = p.slides[0].id;
    let title = p.slides[0].shapes[0].id;
    let subtitle = p.slides[0].shapes[1].id;
    *p.find_shape_mut(title).unwrap().text_mut().unwrap() = TextBody {
        props: p.find_shape(title).unwrap().1.text().unwrap().props,
        paragraphs: vec![TextParagraph::plain("Rusuite Show")],
    };
    p.find_shape_mut(subtitle)
        .unwrap()
        .text_mut()
        .unwrap()
        .paragraphs = vec![TextParagraph::plain("A deck built in Rust")];

    let s2 = p.add_slide(LayoutKind::TitleContent);
    let slide = p.slide_mut(s2).unwrap();
    slide.shapes[0].text_mut().unwrap().paragraphs = vec![TextParagraph::plain("Agenda")];
    slide.shapes[1].text_mut().unwrap().paragraphs = vec![
        TextParagraph::bulleted(0).with_text("Model"),
        TextParagraph::bulleted(1).with_text("Shapes and text"),
    ];

    let s3 = p.add_slide(LayoutKind::Blank);
    let png = p.media.insert("image/png", b"\x89PNG fake".to_vec());
    p.add_shape(
        s3,
        Shape::auto(Preset::Rect, tr(914_400, 914_400, 1_828_800, 914_400)),
    )
    .unwrap();
    p.add_shape(
        s3,
        Shape::auto(Preset::Ellipse, tr(3_657_600, 914_400, 914_400, 914_400)),
    )
    .unwrap();
    p.add_shape(
        s3,
        Shape::auto(Preset::Line, tr(914_400, 2_743_200, 3_657_600, 0)),
    )
    .unwrap();
    p.add_shape(
        s3,
        Shape::picture(png, tr(6_400_800, 914_400, 1_828_800, 1_371_600)),
    )
    .unwrap();
    let group = Shape::group(vec![
        Shape::auto(
            Preset::RoundRect,
            tr(914_400, 4_114_800, 1_371_600, 914_400),
        ),
        Shape::text_box(tr(2_743_200, 4_572_000, 1_828_800, 457_200), "Grouped"),
    ]);
    p.add_shape(s3, group).unwrap();
    assert_eq!(
        p.slides.iter().map(|s| s.id).collect::<Vec<_>>(),
        [s1, s2, s3]
    );
    p
}

#[test]
fn new_presentation_snapshot() {
    let p = Presentation::new();
    assert_eq!(p.slide_size, SlideSize::widescreen());
    assert_eq!(p.slides.len(), 1);
    insta::assert_json_snapshot!("new_presentation", p);
}

#[test]
fn three_slide_deck_snapshot() {
    let p = three_slide_deck();
    // master, layouts and theme are those of `new_presentation`
    let json = serde_json::to_value(&p).unwrap();
    let new = serde_json::to_value(Presentation::new()).unwrap();
    for key in ["master", "layouts", "theme"] {
        assert_eq!(json[key], new[key], "{key}");
    }
    insta::assert_json_snapshot!(
        "three_slide_deck",
        serde_json::json!({
            "slideSize": json["slideSize"],
            "slides": json["slides"],
            "media": json["media"],
        })
    );
    // ids are unique
    let mut ids = all_ids(&p);
    let n = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), n);
}

#[test]
fn add_slide_creates_placeholders() {
    let mut p = Presentation::new();
    let kinds = |p: &Presentation, id| {
        p.slide(id)
            .unwrap()
            .shapes
            .iter()
            .map(|s| (s.placeholder.unwrap(), s.name.clone(), s.transform))
            .collect::<Vec<_>>()
    };
    let first = p.slides[0].id;
    let k = kinds(&p, first);
    assert_eq!(k[0].0, PlaceholderKind::CenteredTitle);
    assert_eq!(k[0].1, "Title 2");
    assert_eq!(k[0].2, tr(1_524_000, 1_122_363, 9_144_000, 2_387_600));
    assert_eq!(k[1].0, PlaceholderKind::Subtitle);
    assert_eq!(k[1].1, "Subtitle 3");

    let id = p.add_slide(LayoutKind::TitleContent);
    let k = kinds(&p, id);
    assert_eq!(k.len(), 2);
    assert_eq!(k[0].0, PlaceholderKind::Title);
    assert_eq!(k[0].2, tr(838_200, 365_125, 10_515_600, 1_325_563));
    assert_eq!(k[1].0, PlaceholderKind::Body);
    assert_eq!(k[1].1, "Content Placeholder 6");
    assert_eq!(k[1].2, tr(838_200, 1_825_625, 10_515_600, 4_351_338));
    let body = p.slide(id).unwrap().shapes[1].text().unwrap();
    assert_eq!(body.paragraphs, vec![TextParagraph::new()]);
    assert_eq!(
        body.props,
        p.layout(&LayoutKind::TitleContent).unwrap().placeholders[1].body_defaults
    );

    let blank = p.add_slide(LayoutKind::Blank);
    assert!(p.slide(blank).unwrap().shapes.is_empty());
    assert_eq!(p.slides.last().unwrap().id, blank);
}

#[test]
fn duplicate_slide_fresh_ids_equal_content() {
    let mut p = three_slide_deck();
    let before = all_ids(&p);
    let src = p.slides[2].id;
    let copy = p.duplicate_slide(src).unwrap();
    assert_eq!(p.slides.len(), 4);
    assert_eq!(p.slide_index(copy), Some(3));
    let (a, b) = (&p.slides[2], &p.slides[3]);
    assert_ne!(a.id, b.id);

    // Equal content once ids are cleared.
    fn strip(shapes: &[Shape]) -> Vec<Shape> {
        shapes
            .iter()
            .map(|s| {
                let mut s = s.clone();
                s.id = NodeId(0);
                if let ShapeKind::Group { children } = &mut s.kind {
                    *children = strip(children);
                }
                s
            })
            .collect()
    }
    assert_eq!(strip(&a.shapes), strip(&b.shapes));
    assert_eq!(a.layout, b.layout);

    // All ids of the copy are new and unique.
    let after = all_ids(&p);
    let new: Vec<u64> = after
        .iter()
        .filter(|i| !before.contains(i))
        .copied()
        .collect();
    assert_eq!(new.len(), after.len() - before.len());
    let mut sorted = after.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), after.len());

    assert!(matches!(
        p.duplicate_slide(NodeId(999)),
        Err(Error::UnknownSlide(NodeId(999)))
    ));
}

#[test]
fn move_and_remove_slides() {
    let mut p = three_slide_deck();
    let ids: Vec<NodeId> = p.slides.iter().map(|s| s.id).collect();
    let order = |p: &Presentation| p.slides.iter().map(|s| s.id).collect::<Vec<_>>();

    p.move_slide(ids[0], 2).unwrap();
    assert_eq!(order(&p), [ids[1], ids[2], ids[0]]);
    p.move_slide(ids[0], 0).unwrap();
    assert_eq!(order(&p), ids);
    p.move_slide(ids[1], 1).unwrap();
    assert_eq!(order(&p), ids);
    assert!(matches!(
        p.move_slide(ids[1], 3),
        Err(Error::SlideIndexOutOfRange { index: 3, len: 3 })
    ));
    assert!(matches!(
        p.move_slide(NodeId(999), 0),
        Err(Error::UnknownSlide(_))
    ));
    assert_eq!(order(&p), ids);

    let removed = p.remove_slide(ids[1]).unwrap();
    assert_eq!(removed.id, ids[1]);
    assert_eq!(order(&p), [ids[0], ids[2]]);
    assert!(matches!(
        p.remove_slide(ids[1]),
        Err(Error::UnknownSlide(_))
    ));
    p.remove_slide(ids[0]).unwrap();
    p.remove_slide(ids[2]).unwrap();
    assert!(p.slides.is_empty());
    assert!(matches!(
        p.move_slide(ids[0], 0),
        Err(Error::UnknownSlide(_))
    ));
}

#[test]
fn find_shapes_inside_groups() {
    let p = three_slide_deck();
    let s3 = &p.slides[2];
    let group = s3.shapes.last().unwrap();
    let child = &group.children()[1];
    let (slide, shape) = p.find_shape(child.id).unwrap();
    assert_eq!(slide.id, s3.id);
    assert_eq!(shape.text().unwrap().plain_text(), "Grouped");
    assert_eq!(p.slide_of(child.id).unwrap().id, s3.id);
    assert!(p.find_shape(NodeId(999)).is_none());
    assert!(p.slide_of(s3.id).is_none(), "slide ids are not shape ids");

    // Group children are relative; absolute transforms restore them.
    assert_eq!(group.transform, tr(914_400, 4_114_800, 3_657_600, 914_400));
    assert_eq!(
        child.absolute_transform(&group.transform),
        tr(2_743_200, 4_572_000, 1_828_800, 457_200)
    );
}

#[test]
fn json_roundtrip_recomputes_next_id() {
    let p = three_slide_deck();
    let json = p.to_json().unwrap();
    let mut back = Presentation::from_json(&json).unwrap();
    assert_eq!(back, p);
    let max = *all_ids(&p).iter().max().unwrap();
    assert_eq!(back.alloc_id(), NodeId(max + 1));
    assert_eq!(
        back.media
            .get(back.media.iter().next().unwrap().0)
            .unwrap()
            .data,
        b"\x89PNG fake"
    );

    // minimal JSON: layouts default to the built-ins
    let p =
        Presentation::from_json(r#"{"slideSize":{"width":9144000,"height":6858000},"slides":[]}"#)
            .unwrap();
    assert_eq!(p.slide_size, SlideSize::standard());
    assert_eq!(
        p.layouts,
        Presentation::empty(SlideSize::standard()).layouts
    );
    assert!(matches!(Presentation::from_json("{"), Err(Error::Json(_))));
}

#[test]
fn normalize_fills_empty_text_bodies() {
    let mut p = three_slide_deck();
    let s3 = p.slides[2].id;
    let mut shape = Shape::text_box(tr(0, 0, 10, 10), "");
    shape.text_mut().unwrap().paragraphs.clear();
    let mut grouped = Shape::text_box(tr(0, 0, 10, 10), "");
    grouped.text_mut().unwrap().paragraphs.clear();
    let id = p.add_shape(s3, shape).unwrap();
    let gid = p.add_shape(s3, Shape::group(vec![grouped])).unwrap();
    let order_before: Vec<NodeId> = p.slides[2].shapes.iter().map(|s| s.id).collect();
    let snapshot = p.clone();

    p.normalize();
    let (_, s) = p.find_shape(id).unwrap();
    assert_eq!(s.text().unwrap().paragraphs, vec![TextParagraph::new()]);
    let (_, g) = p.find_shape(gid).unwrap();
    assert_eq!(g.children()[0].text().unwrap().paragraphs.len(), 1);
    let order_after: Vec<NodeId> = p.slides[2].shapes.iter().map(|s| s.id).collect();
    assert_eq!(order_before, order_after);
    // everything else is untouched
    assert_eq!(p.slides[..2], snapshot.slides[..2]);
}
