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
