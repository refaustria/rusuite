//! The design deck of `examples/design_deck.rs` (theme, master and layout
//! backgrounds, a custom layout, every standard layout, footers, sections,
//! adjusted pictures): written, read back unchanged, and its master,
//! custom layout, `presentation.xml`, a footer slide and the picture slide
//! snapshotted.

mod common;

#[path = "../examples/design_deck.rs"]
#[allow(dead_code)]
mod design_deck;

use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_show::{LayoutKind, PlaceholderKind, Recolor, TextField};

fn pretty_part(bytes: &[u8], part: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let xml = &pkg.part(&PartName::new(part).unwrap()).unwrap().data;
    common::pretty(std::str::from_utf8(xml).unwrap())
}

#[test]
fn design_deck_roundtrips() {
    let deck = design_deck::design_deck();
    deck.validate().unwrap();
    assert_eq!(deck.layouts.len(), 12);
    assert_eq!(deck.sections.len(), 3);
    let bytes = fmt_pptx::write(&deck).unwrap();
    assert_eq!(bytes, fmt_pptx::write(&deck).unwrap(), "deterministic");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    common::assert_same("design deck", &deck, &back);
    // the read deck: custom layout with its bar, footers, fields, pictures
    let quote = back
        .layout(&LayoutKind::Custom("Quote".into()))
        .expect("custom layout");
    assert_eq!(quote.shapes.len(), 1);
    assert!(quote.background.is_some());
    assert!(
        !back
            .layout(&LayoutKind::SectionHeader)
            .unwrap()
            .show_master_shapes
    );
    assert!(back.master.header_footer.slide_number && back.master.header_footer.not_on_title);
    let s2 = &back.slides[1];
    let f = back.resolved_footer(s2.id).unwrap();
    assert_eq!(
        f.date,
        Some(model_show::FooterDate::Fixed("16 October 2026".into()))
    );
    assert_eq!(f.footer.as_deref(), Some("Rusuite design deck"));
    assert_eq!(f.slide_number, Some(2));
    let num = s2
        .shapes
        .iter()
        .find(|s| s.placeholder == Some(PlaceholderKind::SlideNumber))
        .unwrap();
    assert_eq!(
        num.text().unwrap().paragraphs[0].runs[0].field,
        Some(TextField::SlideNumber)
    );
    let pics: Vec<_> = back
        .slides
        .last()
        .unwrap()
        .shapes
        .iter()
        .filter_map(|s| s.picture_props())
        .collect();
    assert_eq!(pics.len(), 5);
    assert_eq!(pics[0].crop.left, 0.25);
    assert_eq!(pics[2].recolor, Recolor::Sepia);
    assert!((pics[2].transparency - 0.4).abs() < 1e-9);
    assert!(pics[4].shadow.is_some());
    // our output reads the same without context, too (theme generated)
    let plain = fmt_pptx::read(&fmt_pptx::write(&back).unwrap()).unwrap();
    common::assert_same("design deck (again)", &back, &plain);
}

#[test]
fn design_part_snapshots() {
    let bytes = fmt_pptx::write(&design_deck::design_deck()).unwrap();
    insta::assert_snapshot!(
        "design_master_xml",
        pretty_part(&bytes, "/ppt/slideMasters/slideMaster1.xml")
    );
    insta::assert_snapshot!(
        "design_custom_layout_xml",
        pretty_part(&bytes, "/ppt/slideLayouts/slideLayout12.xml")
    );
    insta::assert_snapshot!(
        "design_presentation_xml",
        pretty_part(&bytes, "/ppt/presentation.xml")
    );
    insta::assert_snapshot!(
        "design_footer_slide_xml",
        pretty_part(&bytes, "/ppt/slides/slide2.xml")
    );
    insta::assert_snapshot!(
        "design_picture_slide_xml",
        pretty_part(&bytes, "/ppt/slides/slide10.xml")
    );
}
