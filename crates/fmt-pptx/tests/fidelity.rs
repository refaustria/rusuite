//! P8-32 parts: picture backgrounds (`p:bg/p:bgPr/a:blipFill`), locked
//! aspect ratios (`a:spLocks` … `noChangeAspect`), custom placeholder
//! prompts (`hasCustomPrompt`), master text levels, `lastView` and the
//! new preset names – written, snapshotted and read back unchanged.

mod common;

use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_show::{
    Background, Emu, LayoutKind, PictureFill, PlaceholderKind, Presentation, Preset, Shape,
    TextClass, Transform, ViewKind,
};

fn pretty_part(bytes: &[u8], part: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let xml = &pkg.part(&PartName::new(part).unwrap()).unwrap().data;
    common::pretty(std::str::from_utf8(xml).unwrap())
}

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

/// A deck with a tiled, half transparent picture background on slide 1,
/// a stretched one on the master, a locked U-turn arrow, a locked
/// picture and an unlocked one, a custom layout prompt, a red level-2
/// body style and the Slide Sorter as last view.
fn deck() -> Presentation {
    let mut p = Presentation::new();
    let img = p.media.insert("image/png", b"\x89PNG\r\n\x1a\nbg".to_vec());
    let pic = p
        .media
        .insert("image/png", b"\x89PNG\r\n\x1a\npic".to_vec());
    p.slides[0].background = Some(Background::Picture(PictureFill {
        tile: true,
        transparency: 0.5,
        ..PictureFill::new(img)
    }));
    p.master.background = Background::Picture(PictureFill::new(img));
    let s = p.add_slide(LayoutKind::Blank);
    let mut arrow = Shape::auto(
        Preset::UturnArrow,
        tr(100_000, 100_000, 2_000_000, 1_500_000),
    );
    arrow.lock_aspect = true;
    p.add_shape(s, arrow).unwrap();
    for (i, preset) in [
        Preset::FlowChartMagneticDisk,
        Preset::Sun,
        Preset::MathNotEqual,
        Preset::Ribbon2,
    ]
    .into_iter()
    .enumerate()
    {
        p.add_shape(
            s,
            Shape::auto(
                preset,
                tr(
                    3_000_000 + i as i64 * 1_100_000,
                    100_000,
                    1_000_000,
                    1_000_000,
                ),
            ),
        )
        .unwrap();
    }
    p.add_shape(
        s,
        Shape::picture(pic, tr(0, 3_000_000, 1_000_000, 1_000_000)),
    )
    .unwrap();
    let mut free = Shape::picture(pic, tr(2_000_000, 3_000_000, 1_000_000, 500_000));
    free.lock_aspect = false;
    p.add_shape(s, free).unwrap();
    let title = p
        .layouts
        .iter_mut()
        .find(|l| l.kind == LayoutKind::TitleContent)
        .unwrap();
    title.placeholders[0].prompt = Some("Name the topic".into());
    title.name = "Agenda".into();
    let level = &mut p.master.text_styles.body[1];
    level.run.color = Some(model_show::Color::Rgb(core_model::Rgb::new(0xC0, 0, 0)));
    p.view.last_view = ViewKind::SlideSorter;
    p
}

#[test]
fn fidelity_deck_roundtrips() {
    let p = deck();
    let bytes = fmt_pptx::write(&p).unwrap();
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    common::assert_same("fidelity deck", &p, &back);
    assert_eq!(back.view.last_view, ViewKind::SlideSorter);
    assert_eq!(
        back.master.text_styles.level(TextClass::Body, 1).run.color,
        p.master.text_styles.level(TextClass::Body, 1).run.color
    );
    let l = back.layout(&LayoutKind::TitleContent).unwrap();
    assert_eq!(l.display_name(), "Agenda");
    assert_eq!(l.placeholders[0].prompt.as_deref(), Some("Name the topic"));
    assert_eq!(l.placeholders[0].kind, PlaceholderKind::Title);
    let shapes = &back.slides[1].shapes;
    assert!(shapes[0].lock_aspect);
    assert!(shapes[5].lock_aspect && !shapes[6].lock_aspect);
    assert_eq!(
        shapes[1..5]
            .iter()
            .map(|s| match &s.kind {
                model_show::ShapeKind::Auto { geometry, .. } => geometry.prst(),
                _ => "",
            })
            .collect::<Vec<_>>(),
        ["flowChartMagneticDisk", "sun", "mathNotEqual", "ribbon2"]
    );
}

#[test]
fn picture_background_snapshot() {
    let bytes = fmt_pptx::write(&deck()).unwrap();
    let slide = pretty_part(&bytes, "/ppt/slides/slide1.xml");
    let bg = &slide[slide.find("<p:bg>").unwrap()..slide.find("</p:bg>").unwrap() + 7];
    insta::assert_snapshot!("picture_background", bg);
    let master = pretty_part(&bytes, "/ppt/slideMasters/slideMaster1.xml");
    assert!(master.contains("<a:stretch>"), "{master}");
}

#[test]
fn locks_prompts_and_last_view_snapshot() {
    let bytes = fmt_pptx::write(&deck()).unwrap();
    let slide = pretty_part(&bytes, "/ppt/slides/slide2.xml");
    let first = &slide[slide.find("<p:nvSpPr>").unwrap()..slide.find("</p:nvSpPr>").unwrap() + 11];
    insta::assert_snapshot!("locked_shape_nv", first);
    assert!(slide.contains(r#"<a:picLocks noChangeAspect="1"/>"#));
    assert!(slide.contains("<p:cNvPicPr/>"));
    let layout = pretty_part(&bytes, "/ppt/slideLayouts/slideLayout2.xml");
    assert!(layout.contains(r#"hasCustomPrompt="1""#), "{layout}");
    assert!(layout.contains("Name the topic"));
    assert!(layout.contains(r#"<p:cSld name="Agenda">"#));
    let view = pretty_part(&bytes, "/ppt/viewProps.xml");
    assert!(view.contains(r#"lastView="sldSorterView""#), "{view}");
    let master = pretty_part(&bytes, "/ppt/slideMasters/slideMaster1.xml");
    let body = &master[master.find("<p:bodyStyle>").unwrap()..];
    let lvl2 = &body[body.find("<a:lvl2pPr").unwrap()..];
    let lvl2 = &lvl2[..lvl2.find("</a:lvl2pPr>").unwrap()];
    assert!(lvl2.contains(r#"<a:srgbClr val="C00000"/>"#), "{lvl2}");
}
