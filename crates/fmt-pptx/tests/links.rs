//! The links deck of `examples/links_deck.rs`: hyperlinks on runs and
//! shapes, action buttons and audio/video are written, read back
//! unchanged, and the slides are snapshotted.

mod common;

#[path = "../examples/links_deck.rs"]
#[allow(dead_code)]
mod links_deck;

use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_show::{LinkTarget, MediaStart, ShapeKind, SlideRef};

fn text(bytes: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    String::from_utf8(
        pkg.part(&PartName::new(name).unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap()
}

/// The relationships of a part as `Type Target [External]` lines.
fn rels(bytes: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    pkg.relationships(&PartName::new(name).unwrap())
        .map(|r| {
            r.iter()
                .map(|r| format!("{} {} {:?}", r.rel_type, r.target, r.target_mode))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// The slide's shape tree.
fn tree(bytes: &[u8], slide: usize) -> String {
    let xml = text(bytes, &format!("/ppt/slides/slide{slide}.xml"));
    let start = xml.find("</p:grpSpPr>").unwrap() + "</p:grpSpPr>".len();
    let end = xml.find("</p:spTree>").unwrap();
    common::pretty(&xml[start..end])
}

#[test]
fn links_deck_roundtrips() {
    let deck = links_deck::links_deck();
    deck.validate().unwrap();
    let bytes = fmt_pptx::write(&deck).unwrap();
    assert_eq!(bytes, fmt_pptx::write(&deck).unwrap(), "deterministic");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    common::assert_same("links deck", &deck, &back);
    assert_eq!(fmt_pptx::write(&back).unwrap(), bytes, "fixpoint");

    // the slide link points at the third slide of the read deck
    let run = &back.slides[0].shapes[0].text().unwrap().paragraphs[0].runs[3];
    assert_eq!(
        run.hyperlink.as_ref().unwrap().target,
        LinkTarget::Slide(SlideRef::Id(back.slides[2].id))
    );
    let sound = back.slides[2].shapes[1].media_clip().unwrap();
    assert_eq!(sound.start, MediaStart::Automatically);
    assert!(sound.loop_playback && sound.hide_when_not_playing);
    assert!(matches!(back.slides[2].shapes[0].kind, ShapeKind::Media(_)));

    let s1 = text(&bytes, "/ppt/slides/slide1.xml");
    assert!(
        s1.contains(r#"<a:hlinkClick r:id="rId2" tooltip="The Rusuite site"/>"#),
        "{s1}"
    );
    assert!(s1.contains(r#"action="ppaction://hlinkshowjump?jump=endshow""#));
    let r1 = rels(&bytes, "/ppt/slides/slide1.xml");
    assert!(
        r1.contains("hyperlink https://example.com/rusuite?a=1&b=2 External"),
        "{r1}"
    );
    assert!(r1.contains("/slide slide3.xml Internal"), "{r1}");
    let s2 = text(&bytes, "/ppt/slides/slide2.xml");
    assert!(s2.contains(r#"prst="actionButtonForwardNext""#));
    assert!(s2.contains(r#"action="ppaction://hlinkshowjump?jump=nextslide""#));
    assert!(s2.contains(r#"action="ppaction://hlinkshowjump?jump=lastslideviewed""#));
    let r3 = rels(&bytes, "/ppt/slides/slide3.xml");
    assert!(r3.contains("../media/media1.webm"), "{r3}");
    assert!(r3.contains("relationships/video"), "{r3}");
    assert!(r3.contains("relationships/audio"), "{r3}");
}

#[test]
fn slide_snapshots() {
    let bytes = fmt_pptx::write(&links_deck::links_deck()).unwrap();
    insta::assert_snapshot!("links_slide_xml", tree(&bytes, 1));
    insta::assert_snapshot!("media_slide_xml", {
        let xml = text(&bytes, "/ppt/slides/slide3.xml");
        let start = xml.find("<p:cSld>").unwrap();
        let end = xml.find("</p:sld>").unwrap();
        common::pretty(&xml[start..end])
    });
}

#[test]
fn links_to_deleted_slides_are_dropped_on_write() {
    let mut deck = links_deck::links_deck();
    let id = deck.slides[2].id;
    deck.remove_slide(id).unwrap();
    let bytes = fmt_pptx::write(&deck).unwrap();
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let runs = &back.slides[0].shapes[0].text().unwrap().paragraphs[0].runs;
    let links: Vec<_> = runs.iter().filter_map(|r| r.hyperlink.as_ref()).collect();
    assert_eq!(links.len(), 1, "only the web link is left");
    assert!(matches!(links[0].target, LinkTarget::Url(_)));
}
