//! P6-5 commands: slide layout, hidden slides, speaker notes, alt text,
//! replace picture / reset size, and their `.pptx` round trip.

use app_common::Host;
use core_model::media::{base64_decode, base64_encode};
use model_show::{
    Emu, LayoutKind, NodeId, PlaceholderKind, Presentation, Preset, Shape, ShapeKind, TextBody,
    Transform,
};
use serde_json::{json, Value as Json};
use show_core::{dispatch_with, NewShape, ShowCommand as C, ShowDocument, ShowHost};

/// A `w`×`h` px PNG header (enough for the size sniffer).
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

/// Slide 1: title slide (title 2, subtitle 3). Slide 4: blank with rects
/// 5, 6, 7.
fn host() -> ShowHost {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    for t in [
        tr(0, 0, 100, 100),
        tr(200, 0, 100, 100),
        tr(500, 300, 50, 50),
    ] {
        p.add_shape(s, Shape::auto(Preset::Rect, t)).unwrap();
    }
    Host::new(ShowDocument::from_presentation(p).unwrap())
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

/// Applies `cmd`, checks undo and redo, leaves it applied.
fn apply(h: &mut ShowHost, cmd: C) {
    let before = json_of(h);
    h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
}

fn err_code(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before);
    e.code()
}

fn kinds(h: &ShowHost, slide: u64) -> Vec<Option<PlaceholderKind>> {
    pres(h)
        .slide(id(slide))
        .unwrap()
        .shapes
        .iter()
        .map(|s| s.placeholder)
        .collect()
}

#[test]
fn set_slide_layout_maps_placeholders_and_keeps_user_shapes() {
    let mut h = host();
    // the title slide becomes title + content: title maps, subtitle → body
    apply(
        &mut h,
        C::SetSlideLayout {
            slide: id(1),
            layout: LayoutKind::TitleContent,
        },
    );
    let s = pres(&h).slide(id(1)).unwrap();
    assert_eq!(s.layout, LayoutKind::TitleContent);
    assert_eq!(
        kinds(&h, 1),
        [Some(PlaceholderKind::Title), Some(PlaceholderKind::Body)]
    );
    assert_eq!(
        s.shapes.iter().map(|x| x.id.0).collect::<Vec<_>>(),
        [2, 3],
        "existing placeholders keep their ids"
    );
    let def = pres(&h)
        .layout(&LayoutKind::TitleContent)
        .unwrap()
        .placeholders[0]
        .transform;
    assert_eq!(shape(&h, 2).transform, def);

    // the blank slide gets title + body placeholders below its rects
    apply(
        &mut h,
        C::SetSlideLayout {
            slide: id(4),
            layout: LayoutKind::Title,
        },
    );
    assert_eq!(
        kinds(&h, 4),
        [
            Some(PlaceholderKind::CenteredTitle),
            Some(PlaceholderKind::Subtitle),
            None,
            None,
            None
        ]
    );
    let shapes = &pres(&h).slide(id(4)).unwrap().shapes;
    assert!(shapes[0].id.0 > 7 && shapes[1].id.0 > shapes[0].id.0);
    assert_eq!(shapes[0].name, format!("Title {}", shapes[0].id.0));
    assert!(shapes[0].text().is_some());

    // back to blank: the empty placeholders go, the rects stay
    apply(
        &mut h,
        C::SetSlideLayout {
            slide: id(4),
            layout: LayoutKind::Blank,
        },
    );
    assert_eq!(kinds(&h, 4), [None, None, None]);
    assert_eq!(
        err_code(
            &mut h,
            C::SetSlideLayout {
                slide: id(99),
                layout: LayoutKind::Blank
            }
        ),
        "unknown_slide"
    );
}

#[test]
fn set_slide_layout_keeps_placeholders_with_text() {
    let mut h = host();
    apply(
        &mut h,
        C::SetTextBody {
            shape: id(3),
            body: TextBody::plain("keep me"),
        },
    );
    apply(
        &mut h,
        C::SetSlideLayout {
            slide: id(1),
            layout: LayoutKind::Blank,
        },
    );
    assert_eq!(kinds(&h, 1), [Some(PlaceholderKind::Subtitle)]);
}

#[test]
fn hide_slides_and_notes() {
    let mut h = host();
    apply(
        &mut h,
        C::SetSlidesHidden {
            slides: vec![id(4), id(1), id(4)],
            hidden: true,
        },
    );
    assert!(pres(&h).slides.iter().all(|s| s.hidden));
    apply(
        &mut h,
        C::SetSlidesHidden {
            slides: vec![id(1)],
            hidden: false,
        },
    );
    assert!(!pres(&h).slides[0].hidden && pres(&h).slides[1].hidden);
    assert_eq!(
        err_code(
            &mut h,
            C::SetSlidesHidden {
                slides: vec![id(5)],
                hidden: true
            }
        ),
        "unknown_slide"
    );

    apply(
        &mut h,
        C::SetNotes {
            slide: id(4),
            notes: Some("Say hello\nThen goodbye".into()),
        },
    );
    assert_eq!(
        pres(&h).slides[1].notes.as_deref(),
        Some("Say hello\nThen goodbye")
    );
    apply(
        &mut h,
        C::SetNotes {
            slide: id(4),
            notes: Some(String::new()),
        },
    );
    assert_eq!(pres(&h).slides[1].notes, None, "empty notes are none");
}

#[test]
fn notes_and_hidden_reach_the_patch_and_json() {
    let mut h = host();
    let reply = dispatch_with(
        &mut h,
        &json!({"type": "apply", "command": {"type": "setNotes", "slide": 1, "notes": "n"}})
            .to_string(),
    );
    assert!(reply.contains(r#""notes":"n""#), "{reply}");
    let reply = dispatch_with(
        &mut h,
        &json!({"type": "apply", "command": {"type": "setSlidesHidden", "slides": [4], "hidden": true}})
            .to_string(),
    );
    assert!(reply.contains(r#""hidden":true"#), "{reply}");
}

#[test]
fn alt_text() {
    let mut h = host();
    apply(
        &mut h,
        C::SetAltText {
            shape: id(5),
            alt: Some("Blue box".into()),
        },
    );
    assert_eq!(shape(&h, 5).alt.as_deref(), Some("Blue box"));
    apply(
        &mut h,
        C::SetAltText {
            shape: id(5),
            alt: None,
        },
    );
    assert_eq!(shape(&h, 5).alt, None);
    assert_eq!(
        err_code(
            &mut h,
            C::SetAltText {
                shape: id(42),
                alt: None
            }
        ),
        "unknown_shape"
    );
    // pasted shapes keep their alt text
    let mut s = shape(&h, 6).clone();
    s.alt = Some("copy".into());
    let mut ns = NewShape::from(&s);
    ns.id = -1;
    apply(
        &mut h,
        C::AddShape {
            slide: id(4),
            shape: ns,
            index: None,
        },
    );
    let last = pres(&h).slides[1].shapes.last().unwrap();
    assert_eq!(last.alt.as_deref(), Some("copy"));
}

fn insert_png(h: &mut ShowHost, w: u8, hgt: u8) -> NodeId {
    h.apply(C::InsertPicture {
        slide: id(4),
        content_type: "image/png".into(),
        bytes_base64: base64_encode(&png(w, hgt)),
        transform: Some(tr(1000, 1000, 400_000, 400_000)),
        new_id: -1,
    })
    .unwrap()
    .patch
    .id_map[0]
        .1
}

#[test]
fn replace_picture_fits_the_old_box() {
    let mut h = host();
    let pic = insert_png(&mut h, 10, 10);
    apply(
        &mut h,
        C::ReplacePicture {
            shape: pic,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&png(20, 10)),
        },
    );
    let s = shape(&h, pic.0);
    assert_eq!(s.transform, tr(1000, 1000 + 100_000, 400_000, 200_000));
    let ShapeKind::Picture { media, .. } = s.kind else {
        panic!()
    };
    assert_eq!(pres(&h).media.len(), 2);
    assert_eq!(pres(&h).media.get(media).unwrap().data, png(20, 10));
    h.undo().unwrap();
    assert_eq!(pres(&h).media.len(), 1, "undo removes the new image");
    h.redo().unwrap();
    assert_eq!(
        err_code(
            &mut h,
            C::ReplacePicture {
                shape: id(5),
                content_type: "image/png".into(),
                bytes_base64: base64_encode(&png(1, 1)),
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::ReplacePicture {
                shape: pic,
                content_type: "image/png".into(),
                bytes_base64: "***".into(),
            }
        ),
        "bad_request"
    );
}

#[test]
fn reset_picture_size() {
    let mut h = host();
    let pic = insert_png(&mut h, 200, 100);
    apply(&mut h, C::ResetPictureSize { shapes: vec![pic] });
    assert_eq!(
        shape(&h, pic.0).transform,
        tr(1000, 1000, 1_905_000, 952_500)
    );
    assert_eq!(
        err_code(
            &mut h,
            C::ResetPictureSize {
                shapes: vec![id(5)]
            }
        ),
        "invalid_command"
    );
}

#[test]
fn notes_hidden_and_alt_survive_save_and_open() {
    let mut h = host();
    let pic = insert_png(&mut h, 4, 4);
    for cmd in [
        C::SetNotes {
            slide: id(1),
            notes: Some("Welcome everyone\n\nAgenda & goals".into()),
        },
        C::SetSlidesHidden {
            slides: vec![id(4)],
            hidden: true,
        },
        C::SetAltText {
            shape: pic,
            alt: Some("Company logo".into()),
        },
        C::SetSlideLayout {
            slide: id(4),
            layout: LayoutKind::TitleContent,
        },
    ] {
        h.apply(cmd).unwrap();
    }
    let saved: Json =
        serde_json::from_str(&dispatch_with(&mut h, r#"{"type":"savePptx"}"#)).unwrap();
    let b64 = saved["ok"]["bytesBase64"].as_str().unwrap().to_owned();
    let bytes = base64_decode(&b64).unwrap();
    let (doc, warnings) = ShowDocument::open_pptx(&bytes, "x.pptx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let p = doc.presentation();
    assert_eq!(
        p.slides[0].notes.as_deref(),
        Some("Welcome everyone\n\nAgenda & goals")
    );
    assert!(!p.slides[0].hidden && p.slides[1].hidden);
    assert_eq!(p.slides[1].layout, LayoutKind::TitleContent);
    let alts: Vec<_> = p.slides[1]
        .shapes
        .iter()
        .filter_map(|s| s.alt.as_deref())
        .collect();
    assert_eq!(alts, ["Company logo"]);
}
