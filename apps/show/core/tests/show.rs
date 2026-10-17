use app_common::Host;
use core_model::media::base64_encode;
use core_model::{Color, Rgb, RunProperties, ThemeColorSlot};
use model_show::{
    AlignMode, Alignment, Axis, Bullet, Emu, Fill, LayoutKind, Line, MediaId, NodeId, Presentation,
    Preset, Shape, ShapeKind, Slide, SlideSize, TextBody, TextParagraph, Transform,
};
use model_show::{
    Animation, AnimationKind, Direction, Effect, Transition, TransitionKind, Trigger,
};
use serde_json::{json, Value as Json};
use show_core::{
    dispatch_with, AlignTarget, AnimationPatch, NewShape, ShowCommand as C, ShowDocument, ShowHost,
    ShowPatch, TextParagraphPatch, ZOp,
};

/// A 2×3 px PNG header (enough for the size sniffer).
fn png(w: u8, h: u8) -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    b.extend([0, 0, 0, w, 0, 0, 0, h, 8, 6, 0, 0, 0]);
    b
}

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

fn id(n: u64) -> NodeId {
    NodeId(n)
}

/// Slide 1: title slide (ids 1; title 2, subtitle 3). Slide 4: blank with
/// rects 5 (0,0 100×100), 6 (200,0 100×100), 7 (500,300 50×50).
fn deck() -> Presentation {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    for t in [
        tr(0, 0, 100, 100),
        tr(200, 0, 100, 100),
        tr(500, 300, 50, 50),
    ] {
        p.add_shape(s, Shape::auto(Preset::Rect, t)).unwrap();
    }
    p
}

fn host() -> ShowHost {
    Host::new(ShowDocument::from_presentation(deck()).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

fn pres(h: &ShowHost) -> &Presentation {
    h.doc().presentation()
}

fn shape(h: &ShowHost, n: u64) -> &Shape {
    pres(h).find_shape(id(n)).unwrap().1
}

fn order(shapes: &[Shape]) -> Vec<u64> {
    shapes.iter().map(|s| s.id.0).collect()
}

fn slide_shapes(h: &ShowHost, slide: u64) -> Vec<u64> {
    order(&pres(h).slide(id(slide)).unwrap().shapes)
}

fn slide_ids(h: &ShowHost) -> Vec<u64> {
    pres(h).slides.iter().map(|s| s.id.0).collect()
}

/// Applies `cmd`, checks undo → before, redo → after, and leaves the
/// command applied. Returns the patch of the first application.
fn apply(h: &mut ShowHost, cmd: C) -> ShowPatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn err_code(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(
        json_of(h),
        before,
        "failed command changed the presentation"
    );
    e.code()
}

fn new_rect(temp: i64, t: Transform) -> NewShape {
    let mut s = Shape::auto(Preset::Rect, t);
    s.id = NodeId(0);
    let mut ns = NewShape::from(&s);
    ns.id = temp;
    ns
}

#[test]
fn slides_add_delete_duplicate_move() {
    let mut h = host();
    let p = apply(
        &mut h,
        C::AddSlide {
            after: Some(id(1)),
            layout: LayoutKind::TitleContent,
            new_ids: vec![-1, -2, -3],
        },
    );
    assert_eq!(p.id_map, vec![(-1, id(8)), (-2, id(9)), (-3, id(10))]);
    assert_eq!(p.slides_order, Some(vec![id(1), id(8), id(4)]));
    assert_eq!(p.slides.len(), 1);
    assert_eq!(order(&p.slides[0].shapes), [9, 10]);
    assert_eq!(shape(&h, 9).name, "Title 9");
    assert_eq!(shape(&h, 10).name, "Content Placeholder 10");

    // at the start, ids allocated
    let p = apply(
        &mut h,
        C::AddSlide {
            after: None,
            layout: LayoutKind::Blank,
            new_ids: vec![],
        },
    );
    assert_eq!(slide_ids(&h), [11, 1, 8, 4]);
    assert!(p.id_map.is_empty());

    let p = apply(
        &mut h,
        C::DuplicateSlide {
            id: id(4),
            new_ids: vec![-5, -6, -7, -8],
        },
    );
    assert_eq!(slide_ids(&h), [11, 1, 8, 4, 12]);
    assert_eq!(slide_shapes(&h, 12), [13, 14, 15]);
    assert_eq!(p.id_map.len(), 4);
    assert_eq!(shape(&h, 13).name, shape(&h, 5).name);

    let p = apply(
        &mut h,
        C::MoveSlide {
            id: id(12),
            to_index: 0,
        },
    );
    assert_eq!(slide_ids(&h), [12, 11, 1, 8, 4]);
    assert!(p.slides.is_empty());
    assert!(p.slides_order.is_some());

    let p = apply(
        &mut h,
        C::DeleteSlides {
            ids: vec![id(11), id(8)],
        },
    );
    assert_eq!(slide_ids(&h), [12, 1, 4]);
    assert_eq!(p.deleted_slides, vec![id(11), id(8)]);
    // undo restores at the old positions (checked by `apply`); errors
    assert_eq!(
        err_code(&mut h, C::DeleteSlides { ids: vec![id(99)] }),
        "unknown_slide"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::MoveSlide {
                id: id(1),
                to_index: 3
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::AddSlide {
                after: None,
                layout: LayoutKind::Title,
                new_ids: vec![-1],
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::AddSlide {
                after: None,
                layout: LayoutKind::Blank,
                new_ids: vec![5],
            }
        ),
        "invalid_command"
    );
}

#[test]
fn background_and_slide_size() {
    let mut h = host();
    let red = Fill::Solid(Color::Rgb(Rgb::new(255, 0, 0)));
    let p = apply(
        &mut h,
        C::SetSlideBackground {
            slide: id(4),
            fill: Some(red),
        },
    );
    assert_eq!(
        p.slides[0].background,
        Some(model_show::Background::Fill(red))
    );
    assert_eq!(p.slides_order, None);
    let p = apply(
        &mut h,
        C::SetSlideSize {
            size: SlideSize::standard(),
            scale: Default::default(),
        },
    );
    assert_eq!(p.slide_size, Some(SlideSize::standard()));
    assert_eq!(pres(&h).slide_size, SlideSize::standard());
    assert_eq!(
        pres(&h).layout(&LayoutKind::Title).unwrap().placeholders[0]
            .transform
            .w,
        Emu(7_772_400)
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetSlideSize {
                size: SlideSize {
                    width: Emu(0),
                    height: Emu(1)
                },
                scale: Default::default(),
            }
        ),
        "invalid_command"
    );
}

#[test]
fn add_and_delete_shapes() {
    let mut h = host();
    let p = apply(
        &mut h,
        C::AddShape {
            slide: id(4),
            shape: new_rect(-1, tr(1, 2, 3, 4)),
            index: Some(1),
        },
    );
    assert_eq!(p.id_map, vec![(-1, id(8))]);
    assert_eq!(slide_shapes(&h, 4), [5, 8, 6, 7]);
    assert_eq!(shape(&h, 8).name, "Rectangle 8");
    assert_eq!(p.slides[0].id, id(4));

    // a group with temporary child ids
    let mut g = Shape::group(vec![
        Shape::auto(Preset::Ellipse, tr(0, 0, 10, 10)),
        Shape::text_box(tr(20, 0, 10, 10), "hi"),
    ]);
    g.id = NodeId(0);
    let mut ng = NewShape::from(&g);
    ng.id = -10;
    if let show_core::NewShapeKind::Group { children } = &mut ng.kind {
        children[0].id = -11;
        children[1].id = -12;
    }
    let p = apply(
        &mut h,
        C::AddShape {
            slide: id(4),
            shape: ng,
            index: None,
        },
    );
    assert_eq!(p.id_map, vec![(-10, id(9)), (-11, id(10)), (-12, id(11))]);
    assert_eq!(shape(&h, 11).name, "TextBox 11");

    // deleting both children removes the empty group
    apply(
        &mut h,
        C::DeleteShapes {
            ids: vec![id(10), id(11), id(6)],
        },
    );
    assert_eq!(slide_shapes(&h, 4), [5, 8, 7]);

    assert_eq!(
        err_code(
            &mut h,
            C::AddShape {
                slide: id(4),
                shape: new_rect(-1, tr(0, 0, 1, 1)),
                index: Some(9),
            }
        ),
        "invalid_command"
    );
    let mut pic = new_rect(-1, tr(0, 0, 1, 1));
    pic.kind = show_core::NewShapeKind::Picture {
        media: MediaId(42),
        props: Default::default(),
    };
    assert_eq!(
        err_code(
            &mut h,
            C::AddShape {
                slide: id(4),
                shape: pic,
                index: None,
            }
        ),
        "unknown_media"
    );
    assert_eq!(
        err_code(&mut h, C::DeleteShapes { ids: vec![id(77)] }),
        "unknown_shape"
    );
}

#[test]
fn transforms_scale_group_children() {
    let mut h = host();
    apply(
        &mut h,
        C::Group {
            shapes: vec![id(5), id(6)],
            new_id: -1,
        },
    );
    // group 8: 0,0 300×100; children 5 at 0,0 and 6 at 200,0
    assert_eq!(shape(&h, 8).transform, tr(0, 0, 300, 100));
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(8), tr(1000, 1000, 600, 50)), (id(7), tr(1, 1, 1, 1))],
        },
    );
    assert_eq!(shape(&h, 5).transform, tr(0, 0, 200, 50));
    assert_eq!(shape(&h, 6).transform, tr(400, 0, 200, 50));
    assert_eq!(shape(&h, 7).transform, tr(1, 1, 1, 1));
    // moving only keeps child boxes
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(8), tr(0, 0, 600, 50))],
        },
    );
    assert_eq!(shape(&h, 6).transform, tr(400, 0, 200, 50));
    assert_eq!(
        err_code(
            &mut h,
            C::SetTransform {
                shapes: vec![(id(5), tr(0, 0, -1, 1))]
            }
        ),
        "invalid_command"
    );
}

#[test]
fn shape_style_and_name() {
    let mut h = host();
    let blue = Fill::Solid(Color::theme(ThemeColorSlot::Accent2));
    apply(
        &mut h,
        C::SetShapeStyle {
            shapes: vec![id(5), id(6)],
            fill: Some(Some(blue)),
            line: Some(None),
        },
    );
    assert_eq!(shape(&h, 5).fill, blue);
    assert!(shape(&h, 6).line.is_none());
    let line7 = shape(&h, 7).line;
    apply(
        &mut h,
        C::SetShapeStyle {
            shapes: vec![id(7)],
            fill: Some(None),
            line: None,
        },
    );
    assert_eq!(shape(&h, 7).fill, Fill::None);
    assert_eq!(shape(&h, 7).line, line7);
    // JSON: absent = unchanged, null = clear
    let c: C =
        serde_json::from_value(json!({"type":"setShapeStyle","shapes":[5],"fill":null})).unwrap();
    assert_eq!(
        c,
        C::SetShapeStyle {
            shapes: vec![id(5)],
            fill: Some(None),
            line: None
        }
    );
    assert_eq!(
        serde_json::to_value(&c).unwrap(),
        json!({"type":"setShapeStyle","shapes":[5],"fill":null})
    );
    // groups style their leaves
    apply(
        &mut h,
        C::Group {
            shapes: vec![id(5), id(6)],
            new_id: -1,
        },
    );
    apply(
        &mut h,
        C::SetShapeStyle {
            shapes: vec![id(8)],
            fill: None,
            line: Some(Some(Line::solid(Color::Rgb(Rgb::new(0, 0, 0)), Emu(100)))),
        },
    );
    assert_eq!(shape(&h, 6).line.width, Emu(100));
    apply(
        &mut h,
        C::SetName {
            shape: id(6),
            name: "Logo".into(),
        },
    );
    assert_eq!(shape(&h, 6).name, "Logo");
}

#[test]
fn text_runs_with_emoji_offsets() {
    let mut h = host();
    let body = TextBody {
        paragraphs: vec![
            TextParagraph::plain("a😀bc"),
            TextParagraph::bulleted(0).with_text("x"),
        ],
        ..TextBody::default()
    };
    let p = apply(&mut h, C::SetTextBody { shape: id(2), body });
    assert_eq!(p.slides[0].id, id(1));
    let bold = RunProperties {
        bold: Some(true),
        ..Default::default()
    };
    apply(
        &mut h,
        C::SetRunProps {
            shape: id(2),
            paragraph: 0,
            from: 1,
            to: 3,
            patch: bold.clone(),
        },
    );
    let runs = &shape(&h, 2).text().unwrap().paragraphs[0].runs;
    let texts: Vec<&str> = runs.iter().map(|r| r.text.as_str()).collect();
    assert_eq!(texts, ["a", "😀b", "c"]);
    assert_eq!(runs[1].props, bold);
    assert_eq!(
        err_code(
            &mut h,
            C::SetRunProps {
                shape: id(2),
                paragraph: 0,
                from: 2,
                to: 5,
                patch: bold.clone(),
            }
        ),
        "bad_offset"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetRunProps {
                shape: id(2),
                paragraph: 2,
                from: 0,
                to: 0,
                patch: bold,
            }
        ),
        "bad_offset"
    );

    apply(
        &mut h,
        C::SetParagraphProps {
            shape: id(2),
            paragraphs: vec![0, 1],
            patch: TextParagraphPatch {
                alignment: Some(Some(Alignment::Right)),
                level: Some(12),
                bullet: Some(None),
                ..Default::default()
            },
        },
    );
    let paras = &shape(&h, 2).text().unwrap().paragraphs;
    assert_eq!(paras[1].props.alignment, Some(Alignment::Right));
    assert_eq!(paras[1].props.level, 8);
    assert_eq!(paras[1].props.bullet, None);
    let patch: TextParagraphPatch =
        serde_json::from_value(json!({"bullet": {"kind": "none"}, "alignment": null})).unwrap();
    assert_eq!(patch.bullet, Some(Some(Bullet::None)));
    assert_eq!(patch.alignment, Some(None));
    assert_eq!(patch.level, None);

    // empty body is normalized; pictures cannot hold text
    apply(
        &mut h,
        C::SetTextBody {
            shape: id(3),
            body: TextBody::default(),
        },
    );
    assert_eq!(shape(&h, 3).text().unwrap().paragraphs.len(), 1);
    apply(
        &mut h,
        C::InsertPicture {
            slide: id(4),
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&png(2, 3)),
            transform: None,
            new_id: -1,
        },
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetTextBody {
                shape: id(8),
                body: TextBody::plain("x"),
            }
        ),
        "invalid_command"
    );
}

#[test]
fn z_order_ops() {
    let mut h = host();
    apply(
        &mut h,
        C::AddShape {
            slide: id(4),
            shape: new_rect(-1, tr(0, 0, 1, 1)),
            index: None,
        },
    );
    // [5, 6, 7, 8]
    let z = |h: &mut ShowHost, ids: &[u64], op| {
        apply(
            h,
            C::ZOrder {
                shapes: ids.iter().map(|&n| id(n)).collect(),
                op,
            },
        );
        slide_shapes(h, 4)
    };
    assert_eq!(z(&mut h, &[5, 6], ZOp::BringForward), [7, 5, 6, 8]);
    assert_eq!(z(&mut h, &[6, 8], ZOp::BringForward), [7, 5, 6, 8]);
    assert_eq!(z(&mut h, &[5, 8], ZOp::SendBackward), [5, 7, 8, 6]);
    assert_eq!(z(&mut h, &[5, 7], ZOp::BringToFront), [8, 6, 5, 7]);
    assert_eq!(z(&mut h, &[6, 7], ZOp::SendToBack), [6, 7, 8, 5]);
    // inside a group
    apply(
        &mut h,
        C::Group {
            shapes: vec![id(7), id(8)],
            new_id: -1,
        },
    );
    assert_eq!(slide_shapes(&h, 4), [6, 9, 5]);
    apply(
        &mut h,
        C::ZOrder {
            shapes: vec![id(7)],
            op: ZOp::BringToFront,
        },
    );
    assert_eq!(order(shape(&h, 9).children()), [8, 7]);
    assert_eq!(slide_shapes(&h, 4), [6, 9, 5]);
}

#[test]
fn align_and_distribute() {
    let mut h = host();
    apply(
        &mut h,
        C::Align {
            shapes: vec![id(5), id(6), id(7)],
            mode: AlignMode::Bottom,
            to: AlignTarget::Selection,
        },
    );
    let ys: Vec<i64> = [5, 6, 7].map(|n| shape(&h, n).transform.y.0).to_vec();
    assert_eq!(ys, [250, 250, 300]);
    apply(
        &mut h,
        C::Align {
            shapes: vec![id(7)],
            mode: AlignMode::CenterH,
            to: AlignTarget::Selection,
        },
    );
    assert_eq!(shape(&h, 7).transform.x, Emu((12_192_000 - 50) / 2));
    apply(
        &mut h,
        C::Align {
            shapes: vec![id(5), id(6)],
            mode: AlignMode::Right,
            to: AlignTarget::Slide,
        },
    );
    assert_eq!(shape(&h, 6).transform.x, Emu(12_192_000 - 100));
    // distribute: span 0..1050, widths 250 → gaps of 400
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![
                (id(5), tr(0, 0, 100, 100)),
                (id(6), tr(200, 0, 100, 100)),
                (id(7), tr(1000, 0, 50, 50)),
            ],
        },
    );
    apply(
        &mut h,
        C::Distribute {
            shapes: vec![id(5), id(6), id(7)],
            axis: Axis::Horizontal,
        },
    );
    assert_eq!(shape(&h, 6).transform.x, Emu(500));
    // shapes inside groups or on several slides are rejected
    apply(
        &mut h,
        C::Group {
            shapes: vec![id(5), id(6)],
            new_id: -1,
        },
    );
    assert_eq!(
        err_code(
            &mut h,
            C::Align {
                shapes: vec![id(5), id(7)],
                mode: AlignMode::Left,
                to: AlignTarget::Selection,
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::Align {
                shapes: vec![id(2), id(7)],
                mode: AlignMode::Left,
                to: AlignTarget::Selection,
            }
        ),
        "invalid_command"
    );
}

/// Absolute transforms of all leaf shapes of a slide, by id.
fn absolute_leaves(s: &Slide) -> Vec<(u64, Transform)> {
    fn walk(shapes: &[Shape], parent: Option<Transform>, out: &mut Vec<(u64, Transform)>) {
        for sh in shapes {
            let t = match parent {
                Some(p) => sh.absolute_transform(&p),
                None => sh.transform,
            };
            match &sh.kind {
                ShapeKind::Group { children } => walk(children, Some(t), out),
                _ => out.push((sh.id.0, t)),
            }
        }
    }
    let mut out = Vec::new();
    walk(&s.shapes, None, &mut out);
    out.sort_by_key(|(id, _)| *id);
    out
}

#[test]
fn group_and_ungroup_preserve_absolute_positions() {
    let mut h = host();
    let abs = absolute_leaves(pres(&h).slide(id(4)).unwrap());
    let p = apply(
        &mut h,
        C::Group {
            shapes: vec![id(7), id(5)],
            new_id: -3,
        },
    );
    assert_eq!(p.id_map, vec![(-3, id(8))]);
    // group at the z-position of the topmost member (7); children in z-order
    assert_eq!(slide_shapes(&h, 4), [6, 8]);
    assert_eq!(order(shape(&h, 8).children()), [5, 7]);
    assert_eq!(shape(&h, 8).name, "Group 8");
    assert_eq!(shape(&h, 8).transform, tr(0, 0, 550, 350));
    assert_eq!(absolute_leaves(pres(&h).slide(id(4)).unwrap()), abs);

    // nested group, then rotate + flip the outer group and ungroup
    apply(
        &mut h,
        C::Group {
            shapes: vec![id(6), id(8)],
            new_id: -4,
        },
    );
    assert_eq!(absolute_leaves(pres(&h).slide(id(4)).unwrap()), abs);
    let mut t = shape(&h, 9).transform;
    t.rotation_deg = 90.0;
    t.flip_h = true;
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(9), t)],
        },
    );
    let rotated = absolute_leaves(pres(&h).slide(id(4)).unwrap());
    apply(&mut h, C::Ungroup { group: id(9) });
    assert_eq!(slide_shapes(&h, 4), [6, 8]);
    assert_eq!(absolute_leaves(pres(&h).slide(id(4)).unwrap()), rotated);
    apply(&mut h, C::Ungroup { group: id(8) });
    assert_eq!(slide_shapes(&h, 4), [6, 5, 7]);
    assert_eq!(absolute_leaves(pres(&h).slide(id(4)).unwrap()), rotated);

    assert_eq!(
        err_code(&mut h, C::Ungroup { group: id(5) }),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::Group {
                shapes: vec![id(5)],
                new_id: -1
            }
        ),
        "invalid_command"
    );
}

#[test]
fn pictures_and_media_undo() {
    let mut h = host();
    let bytes = png(200, 100);
    let p = apply(
        &mut h,
        C::InsertPicture {
            slide: id(4),
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&bytes),
            transform: None,
            new_id: -1,
        },
    );
    assert_eq!(p.id_map, vec![(-1, id(8))]);
    let s = shape(&h, 8);
    assert_eq!(s.name, "Picture 8");
    // 200×100 px at 96 dpi, centered on 16:9
    assert_eq!(
        s.transform,
        tr(
            (12_192_000 - 1_905_000) / 2,
            (6_858_000 - 952_500) / 2,
            1_905_000,
            952_500
        )
    );
    assert_eq!(pres(&h).media.len(), 1);
    h.undo().unwrap();
    assert_eq!(pres(&h).media.len(), 0);
    h.redo().unwrap();
    assert_eq!(pres(&h).media.len(), 1);

    // larger than the slide: scaled down to fit; same bytes reuse the media
    let big = png(255, 255); // 2_428_875 EMU square
    apply(
        &mut h,
        C::SetSlideSize {
            size: SlideSize {
                width: Emu(1_000_000),
                height: Emu(500_000),
            },
            scale: Default::default(),
        },
    );
    apply(
        &mut h,
        C::InsertPicture {
            slide: id(4),
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&big),
            transform: None,
            new_id: -1,
        },
    );
    assert_eq!(shape(&h, 9).transform, tr(250_000, 0, 500_000, 500_000));
    apply(
        &mut h,
        C::InsertPicture {
            slide: id(1),
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&bytes),
            transform: Some(tr(1, 2, 3, 4)),
            new_id: -1,
        },
    );
    assert_eq!(pres(&h).media.len(), 2);
    assert_eq!(shape(&h, 10).transform, tr(1, 2, 3, 4));
    assert_eq!(
        err_code(
            &mut h,
            C::InsertPicture {
                slide: id(1),
                content_type: "image/png".into(),
                bytes_base64: "%%%".into(),
                transform: None,
                new_id: -1,
            }
        ),
        "bad_request"
    );
}

#[test]
fn compound_is_atomic() {
    let mut h = host();
    let before = json_of(&h);
    let e = h
        .apply(C::Compound {
            commands: vec![
                C::SetName {
                    shape: id(5),
                    name: "x".into(),
                },
                C::DeleteSlides { ids: vec![id(1)] },
                C::SetName {
                    shape: id(99),
                    name: "y".into(),
                },
            ],
        })
        .unwrap_err();
    assert_eq!(e.code(), "unknown_shape");
    assert_eq!(json_of(&h), before);
    assert!(!h.can_undo());

    let p = apply(
        &mut h,
        C::Compound {
            commands: vec![
                C::AddSlide {
                    after: Some(id(4)),
                    layout: LayoutKind::Blank,
                    new_ids: vec![-1],
                },
                C::AddShape {
                    slide: id(8),
                    shape: new_rect(-2, tr(0, 0, 5, 5)),
                    index: None,
                },
                C::DeleteSlides { ids: vec![id(1)] },
            ],
        },
    );
    assert_eq!(p.slides_order, Some(vec![id(4), id(8)]));
    assert_eq!(p.deleted_slides, vec![id(1)]);
    assert_eq!(p.slides.len(), 1);
    assert_eq!(order(&p.slides[0].shapes), [9]);
}

#[test]
fn scripted_session_undo_redo() {
    let mut h = host();
    let start = json_of(&h);
    let script = vec![
        C::AddSlide {
            after: Some(id(4)),
            layout: LayoutKind::TitleContent,
            new_ids: vec![-1, -2, -3],
        },
        C::SetTextBody {
            shape: id(9),
            body: TextBody::plain("Agenda 📅"),
        },
        C::SetRunProps {
            shape: id(9),
            paragraph: 0,
            from: 7,
            to: 8,
            patch: RunProperties {
                italic: Some(true),
                ..Default::default()
            },
        },
        C::SetParagraphProps {
            shape: id(10),
            paragraphs: vec![0],
            patch: TextParagraphPatch {
                level: Some(1),
                ..Default::default()
            },
        },
        C::AddShape {
            slide: id(8),
            shape: new_rect(-4, tr(10, 10, 100, 100)),
            index: None,
        },
        C::SetShapeStyle {
            shapes: vec![id(11)],
            fill: Some(Some(Fill::Solid(Color::Rgb(Rgb::new(1, 2, 3))))),
            line: None,
        },
        C::SetTransform {
            shapes: vec![(id(5), tr(50, 60, 70, 80))],
        },
        C::ZOrder {
            shapes: vec![id(5)],
            op: ZOp::BringToFront,
        },
        C::Align {
            shapes: vec![id(5), id(6)],
            mode: AlignMode::Top,
            to: AlignTarget::Selection,
        },
        C::Group {
            shapes: vec![id(5), id(6), id(7)],
            new_id: -5,
        },
        C::SetTransform {
            shapes: vec![(id(12), tr(0, 0, 1000, 1000))],
        },
        C::SetName {
            shape: id(12),
            name: "Cluster".into(),
        },
        C::DuplicateSlide {
            id: id(4),
            new_ids: vec![],
        },
        C::Ungroup { group: id(12) },
        C::InsertPicture {
            slide: id(1),
            content_type: "image/gif".into(),
            bytes_base64: base64_encode(b"GIF89a\x10\x00\x10\x00"),
            transform: None,
            new_id: -6,
        },
        C::SetSlideBackground {
            slide: id(1),
            fill: Some(Fill::Solid(Color::theme(ThemeColorSlot::Accent3))),
        },
        C::MoveSlide {
            id: id(1),
            to_index: 2,
        },
        C::Distribute {
            shapes: vec![id(5), id(6), id(7)],
            axis: Axis::Vertical,
        },
        C::SetSlideSize {
            size: SlideSize::standard(),
            scale: Default::default(),
        },
        C::DeleteShapes {
            ids: vec![id(6), id(11)],
        },
        C::DeleteSlides { ids: vec![id(8)] },
    ];
    let n = script.len();
    assert!(n >= 20);
    for cmd in script {
        apply(&mut h, cmd);
    }
    let end = json_of(&h);
    assert_ne!(end, start);
    for _ in 0..n {
        h.undo().unwrap().unwrap();
    }
    assert_eq!(json_of(&h), start);
    assert!(!h.is_dirty());
    for _ in 0..n {
        h.redo().unwrap().unwrap();
    }
    assert_eq!(json_of(&h), end);
}

#[test]
fn dispatch_roundtrip() {
    let mut h = ShowHost::new(ShowDocument::new());
    let call = |h: &mut ShowHost, req: Json| -> Json {
        serde_json::from_str(&dispatch_with(h, &req.to_string())).unwrap()
    };
    let p = deck();
    let r = call(&mut h, json!({"type": "load", "presentation": p}));
    assert_eq!(r["ok"]["type"], "presentation");
    assert_eq!(r["ok"]["envelope"]["revision"], 1);
    assert_eq!(r["ok"]["presentation"], serde_json::to_value(&p).unwrap());

    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setName", "shape": 5, "name": "A"}}),
    );
    let env = &r["ok"]["envelope"];
    assert_eq!(r["ok"]["type"], "patch");
    assert_eq!(env["revision"], 2);
    assert_eq!(env["canUndo"], true);
    assert_eq!(env["dirty"], true);
    assert_eq!(env["patch"]["slides"][0]["id"], 4);
    assert_eq!(env["patch"]["slides"][0]["shapes"][0]["name"], "A");
    assert_eq!(env["patch"]["slidesOrder"], Json::Null);
    assert_eq!(env["patch"]["idMap"], json!([]));

    let shape = json!({"id": -9, "transform": {"x": 0, "y": 0, "w": 10, "h": 10},
        "kind": {"kind": "auto", "value": {"geometry": "ellipse"}}});
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "addShape", "slide": 4, "shape": shape}}),
    );
    assert_eq!(r["ok"]["envelope"]["patch"]["idMap"], json!([[-9, 8]]));
    assert_eq!(
        r["ok"]["envelope"]["patch"]["slides"][0]["shapes"][3]["name"],
        "Oval 8"
    );
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "deleteSlides", "ids": [1]}}),
    );
    assert_eq!(r["ok"]["envelope"]["patch"]["deletedSlides"], json!([1]));
    assert_eq!(r["ok"]["envelope"]["patch"]["slidesOrder"], json!([4]));
    let r = call(&mut h, json!({"type": "undo"}));
    let patch = &r["ok"]["envelope"]["patch"];
    assert_eq!(patch["slidesOrder"], json!([1, 4]));
    assert_eq!(patch["slides"][0]["id"], 1);

    // Errors.
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setName", "shape": 77, "name": "x"}}),
    );
    assert_eq!(r["err"]["code"], "unknown_shape");
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "setSlideBackground", "slide": 77, "fill": null}}),
    );
    assert_eq!(r["err"]["code"], "unknown_slide");
    let r = call(&mut h, json!({"type": "nope"}));
    assert_eq!(r["err"]["code"], "bad_request");
    let r: Json = serde_json::from_str(&dispatch_with(&mut h, "not json")).unwrap();
    assert_eq!(r["err"]["code"], "bad_request");
    let mut dup = deck();
    dup.slides[1].shapes[1].id = NodeId(5);
    let r = call(&mut h, json!({"type": "load", "presentation": dup}));
    assert_eq!(r["err"]["code"], "invalid_document");

    // State.
    let r = call(&mut h, json!({"type": "markSaved", "name": "deck.pptx"}));
    assert_eq!(r["ok"]["type"], "documentState");
    assert_eq!(r["ok"]["dirty"], false);
    assert_eq!(r["ok"]["name"], "deck.pptx");
    let r = call(&mut h, json!({"type": "redo"}));
    assert_eq!(r["ok"]["envelope"]["dirty"], true);
    let r = call(&mut h, json!({"type": "redo"}));
    assert_eq!(r["ok"]["envelope"]["patch"]["slides"], json!([]));
    let r = call(&mut h, json!({"type": "getPresentation"}));
    assert_eq!(
        r["ok"]["presentation"]["slides"].as_array().unwrap().len(),
        1
    );
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "insertPicture", "slide": 4,
            "contentType": "image/png", "bytesBase64": base64_encode(&png(1, 1)), "newId": -1}}),
    );
    let media =
        r["ok"]["envelope"]["patch"]["slides"][0]["shapes"][4]["kind"]["value"]["media"].clone();
    let r = call(&mut h, json!({"type": "getMedia", "id": media}));
    assert_eq!(r["ok"]["type"], "media");
    assert_eq!(r["ok"]["contentType"], "image/png");
    assert_eq!(r["ok"]["bytesBase64"], base64_encode(&png(1, 1)));
    let r = call(&mut h, json!({"type": "getMedia", "id": 9}));
    assert_eq!(r["err"]["code"], "unknown_media");
    let r = call(&mut h, json!({"type": "newPresentation"}));
    assert_eq!(r["ok"]["envelope"]["canUndo"], false);
    assert_eq!(
        r["ok"]["presentation"]["slides"].as_array().unwrap().len(),
        1
    );
    let r = call(&mut h, json!({"type": "documentState"}));
    assert_eq!(r["ok"]["dirty"], false);
    assert_eq!(r["ok"]["name"], Json::Null);
}

#[test]
fn wire_types_roundtrip_through_json() {
    use show_core::Request;
    let cmds = vec![
        C::ZOrder {
            shapes: vec![id(1)],
            op: ZOp::SendBackward,
        },
        C::SetShapeStyle {
            shapes: vec![id(1)],
            fill: Some(None),
            line: Some(Some(Line::default())),
        },
        C::SetParagraphProps {
            shape: id(2),
            paragraphs: vec![0],
            patch: TextParagraphPatch {
                spacing_after: Some(None),
                ..Default::default()
            },
        },
        C::RestoreSlides {
            slides: vec![(0, Slide::new(id(3), LayoutKind::Blank))],
        },
        C::SetTransition {
            slides: vec![id(1)],
            transition: Some(Transition::new(TransitionKind::Push)),
        },
        C::AddAnimation {
            slide: id(4),
            animation: Animation::new(id(5), AnimationKind::Entrance, Effect::FlyIn),
            new_id: -1,
            index: Some(0),
        },
        C::UpdateAnimation {
            id: id(9),
            patch: AnimationPatch {
                direction: Some(None),
                trigger: Some(Trigger::AfterPrevious),
                ..Default::default()
            },
        },
    ];
    for c in cmds {
        let req = Request::Apply {
            command: Box::new(c),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(serde_json::from_str::<Request>(&json).unwrap(), req);
    }
    // NewShape has the JSON shape of Shape.
    let mut g = Shape::group(vec![Shape::text_box(tr(0, 0, 1, 1), "t")]);
    g.id = id(5);
    assert_eq!(
        serde_json::to_value(NewShape::from(&g)).unwrap(),
        serde_json::to_value(&g).unwrap()
    );
}

fn anims(h: &ShowHost, slide: u64) -> Vec<Animation> {
    pres(h).slide(id(slide)).unwrap().animations.clone()
}

#[test]
fn transitions() {
    let mut h = host();
    let mut push = Transition::new(TransitionKind::Push);
    push.direction = Some(Direction::Up);
    push.advance_after_ms = Some(2000);
    let patch = apply(
        &mut h,
        C::SetTransition {
            slides: vec![id(4), id(4)],
            transition: Some(push),
        },
    );
    assert_eq!(patch.slides.len(), 1);
    assert_eq!(patch.slides[0].transition, Some(push));
    assert_eq!(pres(&h).slides[0].transition, None);

    // apply to all
    let patch = apply(&mut h, C::ApplyTransitionToAll { from: id(4) });
    assert_eq!(patch.slides.len(), 2);
    assert!(pres(&h).slides.iter().all(|s| s.transition == Some(push)));
    // a no-op transition is stored as none; null removes
    apply(
        &mut h,
        C::SetTransition {
            slides: vec![id(1)],
            transition: Some(Transition::new(TransitionKind::None)),
        },
    );
    assert_eq!(pres(&h).slides[0].transition, None);
    apply(
        &mut h,
        C::SetTransition {
            slides: vec![id(4)],
            transition: None,
        },
    );
    assert_eq!(pres(&h).slides[1].transition, None);

    // invalid direction, unknown slide
    let mut bad = Transition::new(TransitionKind::Fade);
    bad.direction = Some(Direction::Left);
    let set = |t| C::SetTransition {
        slides: vec![id(1)],
        transition: Some(t),
    };
    assert_eq!(err_code(&mut h, set(bad)), "invalid_command");
    assert_eq!(
        err_code(
            &mut h,
            C::SetTransition {
                slides: vec![id(99)],
                transition: None
            }
        ),
        "unknown_slide"
    );
    assert_eq!(
        err_code(&mut h, C::ApplyTransitionToAll { from: id(99) }),
        "unknown_slide"
    );
}

#[test]
fn animations_add_update_reorder_remove() {
    let mut h = host();
    let fly = Animation::new(id(5), AnimationKind::Entrance, Effect::FlyIn);
    let patch = apply(
        &mut h,
        C::AddAnimation {
            slide: id(4),
            animation: fly.clone(),
            new_id: -1,
            index: None,
        },
    );
    let a1 = patch.id_map[0].1;
    assert_eq!(patch.slides.len(), 1);
    assert_eq!(
        patch.slides[0].animations,
        vec![Animation {
            id: a1,
            ..fly.clone()
        }]
    );
    let spin = Animation::new(id(6), AnimationKind::Emphasis, Effect::Spin);
    let patch = apply(
        &mut h,
        C::AddAnimation {
            slide: id(4),
            animation: spin,
            new_id: -2,
            index: Some(0),
        },
    );
    let a2 = patch.id_map[0].1;
    assert_eq!(
        anims(&h, 4).iter().map(|a| a.id).collect::<Vec<_>>(),
        [a2, a1]
    );

    // errors: shape on another slide, bad combination, bad index, used id
    let add = |anim: Animation, new_id: i64, index: Option<u32>| C::AddAnimation {
        slide: id(4),
        animation: anim,
        new_id,
        index,
    };
    let on_title = Animation::new(id(2), AnimationKind::Entrance, Effect::Fade);
    assert_eq!(err_code(&mut h, add(on_title, -3, None)), "invalid_command");
    let bad = Animation::new(id(5), AnimationKind::Exit, Effect::GrowShrink);
    assert_eq!(err_code(&mut h, add(bad, -3, None)), "invalid_command");
    assert_eq!(
        err_code(&mut h, add(fly.clone(), -3, Some(9))),
        "invalid_command"
    );
    assert_eq!(
        err_code(&mut h, add(fly, a1.0 as i64, None)),
        "invalid_command"
    );

    // update: wipe from the left, after previous; direction kept while it fits
    apply(
        &mut h,
        C::UpdateAnimation {
            id: a1,
            patch: AnimationPatch {
                effect: Some(Effect::Wipe),
                direction: Some(Some(Direction::Left)),
                trigger: Some(Trigger::AfterPrevious),
                duration_ms: Some(800),
                delay_ms: Some(100),
                ..Default::default()
            },
        },
    );
    let a = anims(&h, 4)[1].clone();
    assert_eq!(
        (a.effect, a.direction, a.trigger, a.duration_ms, a.delay_ms),
        (
            Effect::Wipe,
            Some(Direction::Left),
            Trigger::AfterPrevious,
            800,
            100
        )
    );
    // switching to Fade drops the direction that no longer fits
    apply(
        &mut h,
        C::UpdateAnimation {
            id: a1,
            patch: AnimationPatch {
                effect: Some(Effect::Fade),
                ..Default::default()
            },
        },
    );
    assert_eq!(anims(&h, 4)[1].direction, None);
    let upd = |patch| C::UpdateAnimation { id: a1, patch };
    assert_eq!(
        err_code(
            &mut h,
            upd(AnimationPatch {
                direction: Some(Some(Direction::Up)),
                ..Default::default()
            })
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            upd(AnimationPatch {
                kind: Some(AnimationKind::Emphasis),
                ..Default::default()
            })
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::UpdateAnimation {
                id: id(99),
                patch: AnimationPatch::default()
            }
        ),
        "invalid_command"
    );

    // reorder
    apply(&mut h, C::ReorderAnimation { id: a1, index: 0 });
    assert_eq!(
        anims(&h, 4).iter().map(|a| a.id).collect::<Vec<_>>(),
        [a1, a2]
    );
    assert_eq!(
        err_code(&mut h, C::ReorderAnimation { id: a1, index: 2 }),
        "invalid_command"
    );

    // remove
    apply(&mut h, C::RemoveAnimation { id: a2 });
    assert_eq!(anims(&h, 4).len(), 1);
    assert_eq!(
        err_code(&mut h, C::RemoveAnimation { id: a2 }),
        "invalid_command"
    );
}

#[test]
fn animations_follow_shapes() {
    let mut h = host();
    for (temp, shape) in [(-1, 5), (-2, 6), (-3, 7)] {
        apply(
            &mut h,
            C::AddAnimation {
                slide: id(4),
                animation: Animation::new(id(shape), AnimationKind::Entrance, Effect::Fade),
                new_id: temp,
                index: None,
            },
        );
    }
    // deleting a shape removes its animations (undo brings both back)
    apply(&mut h, C::DeleteShapes { ids: vec![id(6)] });
    assert_eq!(
        anims(&h, 4).iter().map(|a| a.shape.0).collect::<Vec<_>>(),
        [5, 7]
    );
    // grouping keeps them (children are still on the slide); ungrouping
    // removes the group, not the children
    let patch = apply(
        &mut h,
        C::Group {
            shapes: vec![id(5), id(7)],
            new_id: -9,
        },
    );
    let g = patch.id_map[0].1;
    pres(&h).validate().unwrap();
    apply(
        &mut h,
        C::AddAnimation {
            slide: id(4),
            animation: Animation::new(g, AnimationKind::Exit, Effect::Zoom),
            new_id: -4,
            index: None,
        },
    );
    apply(&mut h, C::Ungroup { group: g });
    assert_eq!(
        anims(&h, 4).iter().map(|a| a.shape.0).collect::<Vec<_>>(),
        [5, 7]
    );
    // duplicating a slide copies animations onto the copied shapes
    let patch = apply(
        &mut h,
        C::DuplicateSlide {
            id: id(4),
            new_ids: vec![],
        },
    );
    let copy = patch.slides_order.unwrap()[2];
    let c = pres(&h).slide(copy).unwrap();
    c.validate().unwrap();
    assert_eq!(c.animations.len(), 2);
    assert_eq!(c.animations[0].shape, c.shapes[0].id);
    assert!(c.animations.iter().all(|a| a.id.0 > 7));
    // deleting and restoring the slide keeps them
    apply(&mut h, C::DeleteSlides { ids: vec![id(4)] });
    pres(&h).validate().unwrap();
}

#[test]
fn loading_checks_animations() {
    let mut p = deck();
    let mut a = Animation::new(id(5), AnimationKind::Entrance, Effect::Fade);
    a.id = id(50);
    p.slides[1].animations.push(a);
    assert!(ShowDocument::from_presentation(p.clone()).is_ok());
    // the animation id clashes with a shape id
    p.slides[1].animations[0].id = id(6);
    let e = ShowDocument::from_presentation(p.clone()).unwrap_err();
    assert_eq!(e.code(), "invalid_document");
    // the target is on another slide
    p.slides[1].animations[0].id = id(50);
    p.slides[1].animations[0].shape = id(2);
    let e = ShowDocument::from_presentation(p).unwrap_err();
    assert_eq!(e.code(), "invalid_document");
}

#[test]
fn animations_survive_pptx() {
    let mut h = host();
    apply(
        &mut h,
        C::SetTransition {
            slides: vec![id(1), id(4)],
            transition: Some(Transition::new(TransitionKind::Fade)),
        },
    );
    apply(
        &mut h,
        C::AddAnimation {
            slide: id(4),
            animation: Animation::new(id(5), AnimationKind::Entrance, Effect::FlyIn),
            new_id: -1,
            index: None,
        },
    );
    let bytes = h.doc().save_pptx().unwrap();
    let (doc, warnings) = ShowDocument::open_pptx(&bytes, "a.pptx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = &doc.presentation().slides[1];
    assert_eq!(s.transition, Some(Transition::new(TransitionKind::Fade)));
    assert_eq!(s.animations.len(), 1);
    assert_eq!(s.animations[0].shape, s.shapes[0].id);
    assert_eq!(s.animations[0].effect, Effect::FlyIn);
}
