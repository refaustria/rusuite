//! The shapes deck of `examples/shapes_deck.rs`: every preset (with and
//! without adjust values), custom geometry, glued connectors with
//! arrowheads and tables are written, read back unchanged, and the
//! flowchart and table slides are snapshotted.

mod common;

#[path = "../examples/shapes_deck.rs"]
#[allow(dead_code)]
mod shapes_deck;

use std::io::Cursor;

use fmt_ooxml::{Package, PartName};
use model_show::{ConnectorKind, Presentation, Preset, Shape, ShapeKind};

fn part(bytes: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let data = &pkg.part(&PartName::new(name).unwrap()).unwrap().data;
    String::from_utf8(data.clone()).unwrap()
}

fn all_shapes(p: &Presentation) -> Vec<&Shape> {
    fn walk<'a>(shapes: &'a [Shape], out: &mut Vec<&'a Shape>) {
        for s in shapes {
            out.push(s);
            walk(s.children(), out);
        }
    }
    let mut out = Vec::new();
    for slide in &p.slides {
        walk(&slide.shapes, &mut out);
    }
    out
}

/// The slide's shape tree, between `p:spTree`'s group properties and its
/// end.
fn tree(bytes: &[u8], slide: usize) -> String {
    let xml = part(bytes, &format!("/ppt/slides/slide{slide}.xml"));
    let start = xml.find("</p:grpSpPr>").unwrap() + "</p:grpSpPr>".len();
    let end = xml.find("</p:spTree>").unwrap();
    common::pretty(&xml[start..end])
}

#[test]
fn shapes_deck_roundtrips() {
    let deck = shapes_deck::shapes_deck();
    deck.validate().unwrap();
    let shapes = all_shapes(&deck);
    for preset in Preset::ALL {
        assert!(
            shapes.iter().any(
                |s| matches!(&s.kind, ShapeKind::Auto { geometry, .. } if *geometry == preset)
            ),
            "{preset:?}"
        );
    }
    for kind in [
        ConnectorKind::Straight,
        ConnectorKind::Elbow,
        ConnectorKind::Curved,
    ] {
        assert!(shapes.iter().any(|s| s
            .connector()
            .is_some_and(|c| c.kind == kind && c.start.is_some())));
    }

    let bytes = fmt_pptx::write(&deck).unwrap();
    assert_eq!(bytes, fmt_pptx::write(&deck).unwrap(), "deterministic");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    back.validate().unwrap();
    common::assert_same("shapes deck", &deck, &back);
    assert_eq!(fmt_pptx::write(&back).unwrap(), bytes, "fixpoint");

    // connectors were routed before writing: rerouting the read deck
    // changes nothing
    let mut again = back.clone();
    for id in again.slides.iter().map(|s| s.id).collect::<Vec<_>>() {
        assert!(again.reroute_connectors(id).unwrap().is_empty());
    }

    let s1 = part(&bytes, "/ppt/slides/slide1.xml");
    assert!(s1.contains(r#"<a:prstGeom prst="wedgeEllipseCallout"><a:avLst/></a:prstGeom>"#));
    assert!(s1.contains("<a:custGeom>"));
    let s4 = part(&bytes, "/ppt/slides/slide4.xml");
    assert!(
        s4.contains(r#"<a:gd name="adj1" fmla="val 30000"/><a:gd name="adj2" fmla="val 80000"/>"#)
    );
    assert!(
        s4.contains(r#"<a:headEnd type="diamond" w="lg" len="sm"/>"#),
        "{s4}"
    );
}

#[test]
fn flowchart_slide_snapshot() {
    let bytes = fmt_pptx::write(&shapes_deck::shapes_deck()).unwrap();
    insta::assert_snapshot!("flowchart_slide_xml", tree(&bytes, 2));
}

#[test]
fn table_slide_snapshot() {
    let bytes = fmt_pptx::write(&shapes_deck::shapes_deck()).unwrap();
    insta::assert_snapshot!("table_slide_xml", tree(&bytes, 3));
}

#[test]
fn table_styles_part_snapshot() {
    let bytes = fmt_pptx::write(&shapes_deck::shapes_deck()).unwrap();
    let xml = part(&bytes, "/ppt/tableStyles.xml");
    // tables reference their style by GUID; the part defines the default
    // and the styles the tables use
    let slide = part(&bytes, "/ppt/slides/slide3.xml");
    assert!(
        slide.contains("<a:tableStyleId>{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}</a:tableStyleId>")
    );
    assert!(xml.contains(r#"styleId="{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}""#));
    insta::assert_snapshot!("table_styles_xml", xml.replace("><", ">\n<"));
}

#[test]
fn unknown_table_styles_are_interpreted() {
    use core_model::ThemeColorSlot;
    use model_show::{Color, Emu, Fill, Line, TableStyleDef};
    let mut deck = shapes_deck::shapes_deck();
    let mut own = TableStyleDef::new("{12345678-1234-1234-1234-123456789ABC}", "My Style");
    own.whole.fill = Some(Fill::Solid(Color::theme(ThemeColorSlot::Accent6)));
    own.whole.inside_h = Some(Line::solid(
        Color::theme(ThemeColorSlot::Light1),
        Emu(25_400),
    ));
    own.first_row.bold = Some(true);
    deck.table_styles.push(own.clone());
    let t = deck.slides[2]
        .shapes
        .iter_mut()
        .find_map(|s| s.table_mut())
        .unwrap();
    t.style_id = Some(own.id.clone());
    let bytes = fmt_pptx::write(&deck).unwrap();
    assert!(part(&bytes, "/ppt/tableStyles.xml").contains("styleName=\"My Style\""));
    let back = fmt_pptx::read(&bytes).unwrap();
    assert_eq!(back.table_styles, [own]);
    let t = back.slides[2]
        .shapes
        .iter()
        .find_map(|s| s.table_data())
        .unwrap();
    let cell = t.style_cell_with(&back.table_styles, 1, 1);
    assert_eq!(
        cell.fill,
        Fill::Solid(Color::theme(ThemeColorSlot::Accent6))
    );
    assert_eq!(cell.borders.top.map(|l| l.width), Some(Emu(25_400)));
}

#[test]
fn connectors_moved_by_their_shapes() {
    let mut deck = shapes_deck::shapes_deck();
    let slide = &mut deck.slides[1];
    // move "Work" down: the straight connector from the decision follows
    let work = slide
        .shapes
        .iter()
        .find(|s| s.text().is_some_and(|t| t.plain_text() == "Work"))
        .unwrap()
        .id;
    slide.find_shape_mut(work).unwrap().transform.y.0 += 1_000_000;
    let changed = slide.reroute_connectors();
    assert_eq!(changed.len(), 2, "into and out of Work");
    let bytes = fmt_pptx::write(&deck).unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    common::assert_same("moved", &deck, &back);
}
