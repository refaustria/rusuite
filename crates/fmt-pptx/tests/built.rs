//! The 10-slide deck of `examples/build_deck.rs`: built in code, written,
//! read back unchanged.

mod common;

#[path = "../examples/build_deck.rs"]
#[allow(dead_code)]
mod build_deck;

use model_show::{LayoutKind, Preset, Shape, ShapeKind};

#[test]
fn built_deck_roundtrips() {
    let deck = build_deck::build_deck();
    assert_eq!(deck.slides.len(), 10);
    for kind in [
        LayoutKind::Title,
        LayoutKind::TitleContent,
        LayoutKind::Blank,
    ] {
        assert!(deck.slides.iter().any(|s| s.layout == kind), "{kind:?}");
    }
    fn walk<'a>(shapes: &'a [Shape], out: &mut Vec<&'a Shape>) {
        for s in shapes {
            out.push(s);
            walk(s.children(), out);
        }
    }
    let mut all = Vec::new();
    for s in &deck.slides {
        walk(&s.shapes, &mut all);
    }
    for preset in [
        Preset::Rect,
        Preset::RoundRect,
        Preset::Ellipse,
        Preset::Line,
    ] {
        assert!(all.iter().any(
            |s| matches!(s.kind, ShapeKind::Auto { ref geometry, .. } if *geometry == preset)
        ));
    }
    assert!(all
        .iter()
        .any(|s| matches!(s.kind, ShapeKind::Picture { .. })));
    assert!(all.iter().any(|s| s.is_text_box()));
    assert!(all
        .iter()
        .any(|s| s.children().iter().any(|c| !c.children().is_empty())));

    let bytes = fmt_pptx::write(&deck).unwrap();
    assert_eq!(bytes, fmt_pptx::write(&deck).unwrap(), "deterministic");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    common::assert_same("built deck", &deck, &back);
}
