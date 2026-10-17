//! P9-S1: text written for the rich in-place editor – line breaks
//! (`a:br`), text boxes that resize to fit (`spAutoFit`), the shape
//! style's text colour (`p:style/a:fontRef`) – written and read back
//! unchanged.

mod common;

use std::io::Cursor;

use core_model::{Color, ThemeColorSlot};
use fmt_ooxml::{Package, PartName};
use model_show::{
    Autofit, Emu, LayoutKind, Presentation, Preset, Shape, TextBody, TextParagraph, TextRun,
    Transform,
};

fn part(bytes: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let data = &pkg.part(&PartName::new(name).unwrap()).unwrap().data;
    String::from_utf8(data.clone()).unwrap()
}

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

/// A blank slide with a text box holding a line break, a filled
/// rectangle with text and a rectangle whose text sets its own colour.
fn deck() -> Presentation {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    let mut tb = Shape::text_box(tr(100_000, 100_000, 900_000, 369_332), "");
    if let Some(body) = tb.text_mut() {
        body.paragraphs = vec![TextParagraph {
            props: Default::default(),
            runs: vec![TextRun::new("one\ntwo")],
        }];
    }
    p.add_shape(s, tb).unwrap();
    let mut rect = Shape::auto(Preset::Rect, tr(1_000_000, 1_000_000, 1_000_000, 800_000));
    if let Some(body) = rect.text_mut() {
        body.paragraphs[0].runs.push(TextRun::new("white"));
    }
    p.add_shape(s, rect).unwrap();
    let mut red = Shape::auto(Preset::Ellipse, tr(3_000_000, 1_000_000, 1_000_000, 800_000));
    if let Some(body) = red.text_mut() {
        let mut r = TextRun::new("red");
        r.props.color = Some(Color::Rgb(core_model::Rgb::new(0xFF, 0, 0)));
        body.paragraphs[0].runs.push(r);
    }
    p.add_shape(s, red).unwrap();
    p
}

#[test]
fn rich_text_deck_roundtrips() {
    let p = deck();
    let bytes = fmt_pptx::write(&p).unwrap();
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    common::assert_same("rich text deck", &p, &back);
    let shapes = &back.slides[1].shapes;
    // the line break stays inside the paragraph
    let tb: &TextBody = shapes[0].text().unwrap();
    assert_eq!(tb.paragraphs.len(), 1);
    assert_eq!(tb.paragraphs[0].text(), "one\ntwo");
    assert_eq!(tb.props.autofit, Autofit::Resize);
    // the style's text colour stays on the shape, the runs set none
    assert_eq!(
        shapes[1].text_color,
        Some(Color::theme(ThemeColorSlot::Light1))
    );
    assert_eq!(shapes[1].text().unwrap().paragraphs[0].runs[0].props.color, None);
    assert!(shapes[2].text().unwrap().paragraphs[0].runs[0].props.color.is_some());
    assert_eq!(shapes[0].text_color, None);
}

#[test]
fn breaks_autofit_and_font_ref_xml() {
    let bytes = fmt_pptx::write(&deck()).unwrap();
    let xml = part(&bytes, "/ppt/slides/slide2.xml");
    assert!(xml.contains("<a:t>one</a:t></a:r><a:br/><a:r><a:t>two</a:t>"), "{xml}");
    assert!(xml.contains("<a:spAutoFit/>"), "{xml}");
    // p:style sits between p:spPr and p:txBody with the text colour only
    let style = r#"<p:style><a:lnRef idx="0"/><a:fillRef idx="0"/><a:effectRef idx="0"/><a:fontRef idx="minor"><a:schemeClr val="bg1"/></a:fontRef></p:style><p:txBody>"#;
    assert_eq!(xml.matches(style).count(), 2, "{xml}");
    assert!(xml.matches("</p:spPr><p:style>").count() == 2, "{xml}");
}
