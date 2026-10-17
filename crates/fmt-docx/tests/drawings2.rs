//! P9-W4: groups (`wpg:wgp`), linked text boxes (`wps:linkedTxbx`),
//! drawing canvases (`wpc:wpc`), picture effects, links on shapes and
//! HYPERLINK fields, anchor options — written and read back.

use std::io::Cursor;

use core_model::units::Emu;
use fmt_ooxml::{Package, PartName};
use model_text::{
    Anchor, Block, Document, Drawing, DrawingKind, Inline, NodeId, Paragraph, Run, TextChain,
    WrapKind,
};

/// `doc` written and read back (the reader's warnings must be empty).
fn reread(doc: &Document) -> Document {
    let bytes = fmt_docx::write(doc).unwrap();
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    out.document
}

/// The main document part of a written file.
fn document_xml(bytes: &[u8]) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let main = PartName::new("/word/document.xml").unwrap();
    String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap()
}

/// `bytes` with `f` applied to `word/document.xml`.
fn patched(bytes: &[u8], f: impl FnOnce(String) -> String) -> Vec<u8> {
    let mut pkg = Package::open(Cursor::new(bytes)).unwrap();
    let main = PartName::new("/word/document.xml").unwrap();
    let xml = String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap();
    pkg.part_mut(&main).unwrap().data = f(xml).into_bytes();
    pkg.write(Cursor::new(Vec::new())).unwrap().into_inner()
}

/// A document whose first paragraph holds `inlines`.
fn doc_with(inlines: Vec<Inline>) -> Document {
    let mut doc = Document::new();
    let mut p = Paragraph::new(doc.alloc_id());
    p.inlines = inlines;
    doc.body = vec![Block::Paragraph(p)];
    doc.normalize();
    doc
}

fn para_text(doc: &mut Document, s: &str) -> Vec<Block> {
    vec![Block::Paragraph(Paragraph::with_text(doc.alloc_id(), s))]
}

/// The drawings of the first paragraph.
fn drawings(doc: &Document) -> Vec<Drawing> {
    doc.body[0]
        .as_paragraph()
        .unwrap()
        .drawings()
        .cloned()
        .collect()
}

fn got_anchor(d: &Drawing) -> Option<Anchor> {
    d.anchor
}

/// `d` without node ids (ids are not written to docx).
fn no_ids(mut d: Drawing) -> Drawing {
    d.walk_mut(&mut |d| {
        d.id = NodeId(0);
        if let Some(t) = d.text.as_mut() {
            for b in &mut t.blocks {
                if let Block::Paragraph(p) = b {
                    p.id = NodeId(0);
                }
            }
        }
    });
    d
}

#[test]
fn groups_roundtrip_with_nested_groups_pictures_and_text_boxes() {
    let mut doc = Document::new();
    let png = doc.media.insert("image/png", vec![0x89, b'P', b'N', b'G']);
    let mut shape = Drawing::shape(doc.alloc_id(), "ellipse", Emu(914_400), Emu(457_200));
    shape.rotation = 30.0;
    shape.name = Some("Oval 1".into());
    let blocks = para_text(&mut doc, "Inside the group");
    let mut tb = Drawing::text_box(doc.alloc_id(), Emu(914_400), Emu(457_200), blocks);
    tb.x = Emu(914_400);
    tb.y = Emu(457_200);
    let mut pic = Drawing::picture(doc.alloc_id(), png, Emu(457_200), Emu(457_200));
    pic.x = Emu(100);
    let mut inner = Drawing::group(doc.alloc_id(), Emu(914_400), Emu(457_200), vec![pic]);
    inner.y = Emu(914_400);
    let mut g = Drawing::group(
        doc.alloc_id(),
        Emu(1_828_800),
        Emu(1_371_600),
        vec![shape, tb, inner],
    );
    g.anchor = Some(Anchor::new(WrapKind::Square));
    let doc = {
        let mut d = doc_with(vec![Inline::Drawing(Box::new(g.clone()))]);
        d.media = doc.media.clone();
        d
    };
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"<mc:Choice Requires="wpg">"#), "{xml}");
    assert!(xml.contains("<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"1828800\" cy=\"1371600\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"1828800\" cy=\"1371600\"/>"), "{xml}");
    assert!(xml.contains("<wpg:grpSp><wpg:cNvPr "), "{xml}");
    assert!(xml.contains("<pic:pic><pic:nvPicPr><pic:cNvPr "), "{xml}");
    assert!(xml.contains(r#"<a:off x="914400" y="457200"/>"#), "{xml}");
    let back = reread(&doc);
    let d = drawings(&back);
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].kind, DrawingKind::Group);
    assert_eq!(no_ids(d[0].clone()).children.len(), 3);
    let mut want = no_ids(g);
    want.name = Some("Group 1".into());
    // The z-order Word reads back (`relativeHeight`, written from the document order).
    if let (Some(w), Some(g)) = (want.anchor.as_mut(), got_anchor(&d[0])) {
        w.z = g.z;
    }
    // Unnamed members get Word's default names.
    let got = no_ids(d[0].clone());
    want.children[1].name = got.children[1].name.clone();
    want.children[2].name = got.children[2].name.clone();
    want.children[2].children[0].name = got.children[2].children[0].name.clone();
    assert_eq!(got, want);
}

#[test]
fn group_child_coordinates_are_mapped_into_the_frame() {
    let mut doc = Document::new();
    let a = Drawing::shape(doc.alloc_id(), "rect", Emu(100), Emu(100));
    let g = Drawing::group(doc.alloc_id(), Emu(200), Emu(200), vec![a]);
    let doc = doc_with(vec![Inline::Drawing(Box::new(g))]);
    let bytes = fmt_docx::write(&doc).unwrap();
    // Word's own child coordinate space: chOff 1000/2000, chExt half the extent.
    let bytes = patched(&bytes, |x| {
        x.replace(
            r#"<a:chOff x="0" y="0"/><a:chExt cx="200" cy="200"/>"#,
            r#"<a:chOff x="1000" y="2000"/><a:chExt cx="100" cy="100"/>"#,
        )
        .replace(
            r#"<a:off x="0" y="0"/><a:ext cx="100" cy="100"/>"#,
            r#"<a:off x="1050" y="2025"/><a:ext cx="50" cy="25"/>"#,
        )
    });
    let back = fmt_docx::read(&bytes).unwrap();
    let c = &drawings(&back)[0].children[0];
    assert_eq!(
        (c.x, c.y, c.width, c.height),
        (Emu(100), Emu(50), Emu(100), Emu(50))
    );
}

#[test]
fn linked_text_boxes_roundtrip() {
    let mut doc = Document::new();
    let blocks = para_text(&mut doc, "A story that flows on");
    let mut head = Drawing::text_box(doc.alloc_id(), Emu(914_400), Emu(300_000), blocks);
    head.chain = Some(TextChain { id: 1, seq: 0 });
    let empty = vec![Block::Paragraph(Paragraph::new(doc.alloc_id()))];
    let mut next = Drawing::text_box(doc.alloc_id(), Emu(914_400), Emu(300_000), empty);
    next.chain = Some(TextChain { id: 1, seq: 1 });
    let doc = doc_with(vec![
        Inline::Drawing(Box::new(head)),
        Inline::Run(Run::new(" and ")),
        Inline::Drawing(Box::new(next)),
    ]);
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"<wps:txbx id="1"><w:txbxContent>"#), "{xml}");
    assert!(xml.contains(r#"<wps:linkedTxbx id="1" seq="1"/>"#), "{xml}");
    let back = reread(&doc);
    let d = drawings(&back);
    assert_eq!(d[0].chain, Some(TextChain { id: 1, seq: 0 }));
    assert_eq!(d[1].chain, Some(TextChain { id: 1, seq: 1 }));
    assert_eq!(back.plain_text(), doc.plain_text());
    assert_eq!(back.text_chain(1).len(), 2);
    // A box linked to nothing loses the chain on read.
    let lonely = patched(&bytes, |x| {
        x.replace(r#"<wps:linkedTxbx id="1" seq="1"/>"#, "")
    });
    let back = fmt_docx::read(&lonely).unwrap();
    assert!(drawings(&back).iter().all(|d| d.chain.is_none()));
}

#[test]
fn picture_soft_edges_bevel_and_through_wrapping_roundtrip() {
    let mut doc = Document::new();
    let png = doc.media.insert("image/png", vec![0x89, b'P', b'N', b'G']);
    let mut img = model_text::InlineImage::new(png, Emu(914_400), Emu(457_200));
    img.format.soft_edge = Some(Emu(63_500));
    img.format.bevel = Some(model_text::Bevel {
        preset: "relaxedInset".into(),
        width: Emu(76_200),
        height: Emu(25_400),
    });
    img.format.shadow = true;
    img.anchor = Some(Anchor::new(WrapKind::Through));
    let mut d = doc_with(vec![Inline::Image(img.clone())]);
    d.media = doc.media.clone();
    let bytes = fmt_docx::write(&d).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"<a:effectLst><a:outerShdw "#), "{xml}");
    assert!(
        xml.contains(r#"<a:softEdge rad="63500"/></a:effectLst>"#),
        "{xml}"
    );
    assert!(xml.contains(r#"<a:bevelT w="76200" h="25400" prst="relaxedInset"/>"#));
    assert!(xml.contains(r#"<wp:wrapThrough wrapText="bothSides">"#));
    let back = reread(&d);
    let Inline::Image(got) = &back.body[0].as_paragraph().unwrap().inlines[0] else {
        panic!("no picture")
    };
    assert_eq!(got.format, img.format);
    assert_eq!(got.anchor.unwrap().wrap, WrapKind::Through);
}

#[test]
fn shape_links_and_decorative_marks_roundtrip() {
    let mut doc = Document::new();
    let png = doc.media.insert("image/png", vec![0x89, b'P', b'N', b'G']);
    let mut img = model_text::InlineImage::new(png, Emu(914_400), Emu(457_200));
    img.decorative = true;
    let mut shape = Drawing::shape(doc.alloc_id(), "heart", Emu(914_400), Emu(914_400));
    shape.link = Some(model_text::Hyperlink {
        target: model_text::LinkTarget::Url("https://rusuit.es/".into()),
        tooltip: Some("Rusuite".into()),
        field: false,
    });
    shape.decorative = true;
    let mut d = doc_with(vec![Inline::Image(img), Inline::Drawing(Box::new(shape))]);
    d.media = doc.media.clone();
    let bytes = fmt_docx::write(&d).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"<a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/>"#), "{xml}");
    assert!(xml.contains(r#"tooltip="Rusuite"/>"#), "{xml}");
    let back = reread(&d);
    let p = back.body[0].as_paragraph().unwrap();
    let Inline::Image(i) = &p.inlines[0] else {
        panic!()
    };
    assert!(i.decorative);
    let s = p.drawings().next().unwrap();
    assert!(s.decorative);
    let l = s.link.as_ref().unwrap();
    assert_eq!(
        l.target,
        model_text::LinkTarget::Url("https://rusuit.es/".into())
    );
    assert_eq!(l.tooltip.as_deref(), Some("Rusuite"));
}

#[test]
fn hyperlink_fields_are_read_as_links_and_written_back_as_fields() {
    let doc = doc_with(vec![Inline::Run(Run::new("Before "))]);
    let bytes = fmt_docx::write(&doc).unwrap();
    let bytes = patched(&bytes, |x| {
        x.replace(
            "<w:t xml:space=\"preserve\">Before </w:t></w:r>",
            concat!(
                "<w:t xml:space=\"preserve\">Before </w:t></w:r>",
                "<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>",
                "<w:r><w:instrText xml:space=\"preserve\"> HYPERLINK \"https://example.com/\" \\o \"Example site\" </w:instrText></w:r>",
                "<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r>",
                "<w:r><w:rPr><w:b/></w:rPr><w:t>the</w:t></w:r><w:r><w:t xml:space=\"preserve\"> site</w:t></w:r>",
                "<w:r><w:fldChar w:fldCharType=\"end\"/></w:r>",
                "<w:fldSimple w:instr=\" HYPERLINK \\l &quot;intro&quot; \"><w:r><w:t>back</w:t></w:r></w:fldSimple>",
            ),
        )
    });
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let p = out.document.body[0].as_paragraph().unwrap().clone();
    assert_eq!(p.text(), "Before the siteback");
    let runs: Vec<&Run> = p.inlines.iter().filter_map(Inline::as_run).collect();
    let link = runs[1].link.as_ref().unwrap();
    assert!(link.field);
    assert_eq!(link.tooltip.as_deref(), Some("Example site"));
    assert_eq!(runs[2].link, runs[1].link);
    assert_eq!(
        runs[3].link.as_ref().unwrap().target,
        model_text::LinkTarget::Bookmark("intro".into())
    );
    assert!(runs[0].link.is_none());
    // Written back as fields (not w:hyperlink), the result runs keep their formatting.
    let xml = document_xml(&fmt_docx::write(&out.document).unwrap());
    assert!(xml.contains(r#"<w:instrText xml:space="preserve"> HYPERLINK "https://example.com/" \o "Example site" </w:instrText>"#), "{xml}");
    assert!(
        xml.contains(r#"<w:instrText xml:space="preserve"> HYPERLINK \l "intro" </w:instrText>"#),
        "{xml}"
    );
    assert!(!xml.contains("<w:hyperlink"), "{xml}");
    let again = reread(&out.document);
    assert_eq!(again.body[0].as_paragraph().unwrap().inlines, p.inlines);
}

#[test]
fn drawing_canvases_roundtrip() {
    let mut doc = Document::new();
    let mut a = Drawing::shape(doc.alloc_id(), "rect", Emu(914_400), Emu(457_200));
    a.x = Emu(100_000);
    a.y = Emu(200_000);
    let b = Drawing::shape(doc.alloc_id(), "ellipse", Emu(457_200), Emu(457_200));
    let mut inner = Drawing::group(doc.alloc_id(), Emu(457_200), Emu(457_200), vec![b]);
    inner.x = Emu(1_000_000);
    let mut c = Drawing::canvas(
        doc.alloc_id(),
        Emu(3_000_000),
        Emu(1_500_000),
        vec![a, inner],
    );
    c.fill = model_text::ShapeFill::Solid(core_model::Color::Rgb(core_model::Rgb::new(
        0xEE, 0xEE, 0xEE,
    )));
    let d = doc_with(vec![Inline::Drawing(Box::new(c.clone()))]);
    let bytes = fmt_docx::write(&d).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"<mc:Choice Requires="wpc">"#), "{xml}");
    assert!(xml.contains(r#"<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"><wpc:wpc><wpc:bg><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></wpc:bg><wpc:whole>"#), "{xml}");
    assert!(xml.contains("<wpg:wgp><wpg:cNvPr "), "{xml}");
    let back = reread(&d);
    let got = no_ids(drawings(&back)[0].clone());
    let mut want = no_ids(c);
    want.name = got.name.clone();
    want.children[1].name = got.children[1].name.clone();
    want.children[0].name = got.children[0].name.clone();
    want.children[1].children[0].name = got.children[1].children[0].name.clone();
    assert_eq!(got, want);
}

#[test]
fn anchor_positions_options_and_hidden_objects_roundtrip() {
    use model_text::{HPos, HRelative, Placement, VPos, VRelative};
    let mut doc = Document::new();
    let mut s = Drawing::shape(doc.alloc_id(), "rect", Emu(914_400), Emu(914_400));
    let mut a = Anchor::new(WrapKind::Square);
    a.h = HPos {
        relative_to: HRelative::LeftMargin,
        place: Placement::Percent(25_000),
    };
    a.v = VPos {
        relative_to: VRelative::TopMargin,
        place: Placement::Offset(Emu(12_700)),
    };
    a.z = 251_660_000;
    a.locked = true;
    a.layout_in_cell = false;
    a.allow_overlap = false;
    s.anchor = Some(a);
    s.hidden = true;
    let mut s2 = Drawing::shape(doc.alloc_id(), "rect", Emu(914_400), Emu(914_400));
    let mut a2 = Anchor::new(WrapKind::InFront);
    a2.h = HPos {
        relative_to: HRelative::OutsideMargin,
        place: Placement::Align(model_text::HAlign::Right),
    };
    a2.v = VPos {
        relative_to: VRelative::BottomMargin,
        place: Placement::Percent(50_000),
    };
    s2.anchor = Some(a2);
    let d = doc_with(vec![
        Inline::Drawing(Box::new(s)),
        Inline::Drawing(Box::new(s2)),
    ]);
    let bytes = fmt_docx::write(&d).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"relativeHeight="251660000" behindDoc="0" locked="1" layoutInCell="0" allowOverlap="0""#), "{xml}");
    assert!(xml.contains(r#"<mc:AlternateContent><mc:Choice Requires="wp14"><wp:positionH relativeFrom="leftMargin"><wp14:pctPosHOffset>25000</wp14:pctPosHOffset></wp:positionH></mc:Choice><mc:Fallback><wp:positionH relativeFrom="leftMargin"><wp:posOffset>"#), "{xml}");
    assert!(xml.contains(r#"<wp:positionV relativeFrom="topMargin"><wp:posOffset>12700</wp:posOffset></wp:positionV>"#));
    assert!(xml.contains(
        r#"<wp:positionH relativeFrom="outsideMargin"><wp:align>right</wp:align></wp:positionH>"#
    ));
    assert!(xml.contains(r#"hidden="1""#));
    let back = reread(&d);
    let ds = drawings(&back);
    assert_eq!(ds[0].anchor, Some(a));
    assert!(ds[0].hidden);
    assert_eq!(ds[1].anchor.unwrap().v, a2.v);
    assert_eq!(ds[1].anchor.unwrap().h, a2.h);
}
