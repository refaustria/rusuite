//! P9-S5: Insert Placeholder › Text, pictures into placeholders, date
//! fields saved with the UI's clock.

use std::io::Cursor;

use app_common::Host;
use core_model::media::base64_encode;
use model_show::{
    Emu, LayoutKind, PlaceholderKind, Presentation, ShapeKind, TextField, TextParagraph, TextRun,
    Transform,
};
use serde_json::{json, Value as Json};
use show_core::{dispatch_with, DesignTarget, ShowCommand as C, ShowDocument, ShowHost};

fn host_with(p: Presentation) -> ShowHost {
    Host::new(ShowDocument::from_presentation(p).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

fn apply(h: &mut ShowHost, cmd: C) {
    let before = json_of(h);
    h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo");
}

/// A PNG header of `w` × `h` pixels (enough for the core's size sniffing).
fn png(w: u32, h: u32) -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 2, 0, 0, 0]);
    b
}

fn part(bytes: &[u8], name: &str) -> String {
    let pkg = fmt_ooxml::Package::open(Cursor::new(bytes)).unwrap();
    String::from_utf8(
        pkg.part(&fmt_ooxml::PartName::new(name).unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap()
}

#[test]
fn insert_placeholder_text_is_a_text_only_body() {
    let mut h = host_with(Presentation::new());
    let target = DesignTarget::Layout(LayoutKind::TitleOnly);
    let tr = Transform::new(Emu(100), Emu(200), Emu(3_000_000), Emu(2_000_000));
    apply(
        &mut h,
        C::AddPlaceholder {
            target: target.clone(),
            kind: PlaceholderKind::Body,
            transform: tr,
            text_only: true,
        },
    );
    let l = h
        .doc()
        .presentation()
        .layout(&LayoutKind::TitleOnly)
        .unwrap()
        .clone();
    let d = l
        .placeholders
        .iter()
        .find(|d| d.kind == PlaceholderKind::Body)
        .unwrap();
    assert!(d.text_only);
    let bytes = h.doc().save_pptx().unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    let d = back
        .layout(&LayoutKind::TitleOnly)
        .unwrap()
        .placeholders
        .iter()
        .find(|d| d.kind == PlaceholderKind::Body)
        .unwrap()
        .clone();
    assert!(d.text_only, "written as type=\"body\"");
    // only body placeholders can be text only
    let e = h
        .apply(C::AddPlaceholder {
            target,
            kind: PlaceholderKind::Picture,
            transform: tr,
            text_only: true,
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_command");
}

#[test]
fn a_picture_fills_an_empty_picture_placeholder() {
    let mut p = Presentation::new();
    p.slides.clear();
    let id = p.add_slide(LayoutKind::PictureWithCaption);
    let slide = p.slide(id).unwrap().clone();
    let (at, ph) = slide
        .shapes
        .iter()
        .enumerate()
        .find(|(_, s)| s.placeholder == Some(PlaceholderKind::Picture))
        .map(|(i, s)| (i, s.clone()))
        .expect("picture placeholder");
    let mut h = host_with(p);
    // a picture twice as wide as the placeholder's proportions
    let (bw, bh) = (ph.transform.w.0 as f64, ph.transform.h.0 as f64);
    let (pw, phh) = ((bw / bh * 2000.0).round() as u32, 1000u32);
    apply(
        &mut h,
        C::InsertPicture {
            slide: id,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&png(pw, phh)),
            transform: None,
            placeholder: Some(ph.id),
            new_id: -1,
        },
    );
    let s = h.doc().presentation().slide(id).unwrap().clone();
    assert_eq!(
        s.shapes.len(),
        slide.shapes.len(),
        "the picture replaces the placeholder"
    );
    let pic = &s.shapes[at];
    assert_eq!(pic.transform, ph.transform);
    assert_eq!(pic.placeholder, Some(PlaceholderKind::Picture));
    let ShapeKind::Picture { props, .. } = &pic.kind else {
        panic!("picture")
    };
    assert!(
        (props.crop.left - 0.25).abs() < 1e-3 && (props.crop.right - 0.25).abs() < 1e-3,
        "{:?}",
        props.crop
    );
    assert_eq!(props.crop.top, 0.0);
    // saved as a picture placeholder (p:pic with p:ph type="pic")
    let bytes = h.doc().save_pptx().unwrap();
    let xml = part(&bytes, "/ppt/slides/slide1.xml");
    assert!(
        xml.contains("<p:pic>") && xml.contains(r#"<p:ph type="pic""#),
        "{xml}"
    );
    // not a placeholder, or not empty: refused
    let title = s
        .shapes
        .iter()
        .find(|x| x.placeholder == Some(PlaceholderKind::Title))
        .unwrap()
        .id;
    let e = h
        .apply(C::InsertPicture {
            slide: id,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&png(10, 10)),
            transform: None,
            placeholder: Some(title),
            new_id: -2,
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_command");
}

#[test]
fn date_fields_are_saved_with_the_uis_clock() {
    let mut p = Presentation::new();
    let s = p.slides[0].id;
    let mut tb = model_show::Shape::text_box(Transform::default(), "");
    tb.text_mut().unwrap().paragraphs = vec![TextParagraph {
        runs: vec![TextRun::field(TextField::DateTime { format: 1 }, "old")],
        ..TextParagraph::default()
    }];
    p.add_shape(s, tb).unwrap();
    p.master.header_footer.date = model_show::HfDate::Auto { format: 4 };
    let mut h = host_with(p);
    let reply: Json = serde_json::from_str(&dispatch_with(
        &mut h,
        &json!({"type": "savePptx", "dateTexts": {"1": "10/17/2026", "4": "October 17, 2026"}})
            .to_string(),
    ))
    .unwrap();
    let bytes = core_model::media::base64_decode(
        reply["ok"]["bytesBase64"]
            .as_str()
            .unwrap_or_else(|| panic!("{reply}")),
    )
    .unwrap();
    let slide = part(&bytes, "/ppt/slides/slide1.xml");
    assert!(slide.contains("<a:t>10/17/2026</a:t>"), "{slide}");
    let master = part(&bytes, "/ppt/slideMasters/slideMaster1.xml");
    assert!(master.contains("<a:t>October 17, 2026</a:t>"), "{master}");
    // the document keeps its own text
    let stored: Vec<String> = h.doc().presentation().slides[0]
        .shapes
        .iter()
        .filter_map(|x| x.text())
        .flat_map(|t| t.paragraphs.iter().flat_map(|p| p.runs.iter()))
        .filter(|r| r.field.is_some())
        .map(|r| r.text.clone())
        .collect();
    assert_eq!(stored, vec!["old".to_owned()]);
    // without a clock the stored text is written
    let plain = h.doc().save_pptx().unwrap();
    assert!(part(&plain, "/ppt/slides/slide1.xml").contains("<a:t>old</a:t>"));
}
