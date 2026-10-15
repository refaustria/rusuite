//! The transitions-and-animations deck of `examples/anim_deck.rs`: every
//! supported transition kind and effect is written, read back unchanged,
//! and slide 1 (fade transition + fly-in) is snapshotted.

mod common;

#[path = "../examples/anim_deck.rs"]
#[allow(dead_code)]
mod anim_deck;

use std::collections::BTreeSet;
use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_show::{AnimationKind, Effect, TransitionKind};

fn part(bytes: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let data = &pkg.part(&PartName::new(name).unwrap()).unwrap().data;
    String::from_utf8(data.clone()).unwrap()
}

#[test]
fn anim_deck_roundtrips() {
    let deck = anim_deck::anim_deck();
    deck.validate().unwrap();
    let kinds: BTreeSet<_> = deck
        .slides
        .iter()
        .filter_map(|s| s.transition.map(|t| format!("{:?}", t.kind)))
        .collect();
    let all: BTreeSet<_> = TransitionKind::ALL
        .iter()
        .filter(|k| **k != TransitionKind::None)
        .map(|k| format!("{k:?}"))
        .collect();
    assert_eq!(kinds, all);
    let effects: BTreeSet<_> = deck
        .slides
        .iter()
        .flat_map(|s| &s.animations)
        .map(|a| format!("{:?} {:?}", a.kind, a.effect))
        .collect();
    for kind in [
        AnimationKind::Entrance,
        AnimationKind::Emphasis,
        AnimationKind::Exit,
    ] {
        for effect in Effect::ALL.into_iter().filter(|e| e.supports(kind)) {
            assert!(
                effects.contains(&format!("{kind:?} {effect:?}")),
                "{kind:?} {effect:?}"
            );
        }
    }

    let bytes = fmt_pptx::write(&deck).unwrap();
    assert_eq!(bytes, fmt_pptx::write(&deck).unwrap(), "deterministic");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    back.validate().unwrap();
    common::assert_same("animation deck", &deck, &back);
    assert_eq!(fmt_pptx::write(&back).unwrap(), bytes, "fixpoint");

    let s1 = part(&bytes, "/ppt/slides/slide1.xml");
    assert!(s1.contains("<p:timing>") && s1.contains("<mc:AlternateContent"));
    // the slide without a transition effect but with a timer
    let s7 = part(&bytes, "/ppt/slides/slide7.xml");
    assert!(s7.contains(r#"advClick="0" advTm="2000""#), "{s7}");
}

#[test]
fn anim_slide1_xml_snapshot() {
    let bytes = fmt_pptx::write(&anim_deck::anim_deck()).unwrap();
    let xml = part(&bytes, "/ppt/slides/slide1.xml");
    let start = xml.find("</p:clrMapOvr>").unwrap() + "</p:clrMapOvr>".len();
    insta::assert_snapshot!(
        "anim_slide1_xml",
        common::pretty(&xml[start..xml.len() - "</p:sld>".len()])
    );
}

#[test]
fn invalid_targets_fail_to_write() {
    let mut deck = anim_deck::anim_deck();
    deck.slides[0].animations[0].shape = model_show::NodeId(9999);
    assert!(matches!(
        fmt_pptx::write(&deck),
        Err(fmt_pptx::Error::InvalidPresentation(_))
    ));
}
