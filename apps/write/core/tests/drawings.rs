//! P8-34: shapes and text boxes (nested text addressed by block id, undo
//! identity, `.docx` round trips with the VML fallback), picture
//! formatting and links, character formatting, Change Case, list presets,
//! merge-aware columns, linked style pairs, note run normalization,
//! settings.

use app_common::Host;
use core_model::units::Emu;
use core_model::RunProperties;
use model_text::{
    Anchor, Block, Crop, Document, DocumentSettings, Drawing, DrawingKind, Hyperlink, Inline,
    Level, LevelKind, LinkTarget, NodeId, Paragraph, PictureFormat, Recolor, Run, ShapeFill,
    ShapeLine, Style, StyleKind, Table, TableCell, TableRow, WrapKind,
};
use serde_json::Value as Json;
use write_core::{
    dispatch_with, NewBlock, NewParagraph, ShapePathQuery, TextCase, WriteCommand as C,
    WriteDocument, WriteHost, WritePatch,
};

fn host(texts: &[&str]) -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    for (i, t) in texts.iter().enumerate() {
        let id = NodeId(i as u64 + 1);
        doc.reserve_id(id);
        doc.body.push(Block::Paragraph(Paragraph::with_text(id, t)));
    }
    Host::new(WriteDocument::from_document(doc).unwrap())
}

fn json_of(h: &WriteHost) -> Json {
    serde_json::to_value(h.doc().document()).unwrap()
}

fn doc(h: &WriteHost) -> &Document {
    h.doc().document()
}

/// Applies `cmd`, checks undo → before and redo → after (ids included).
fn apply(h: &mut WriteHost, cmd: C) -> WritePatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn drawing(h: &WriteHost, block: u64) -> Drawing {
    doc(h)
        .find_paragraph(NodeId(block))
        .unwrap()
        .drawings()
        .next()
        .cloned()
        .expect("a drawing")
}

fn reopen(h: &WriteHost) -> Document {
    let bytes = h.doc().save_docx().unwrap();
    WriteDocument::open_docx(&bytes, "x.docx")
        .unwrap()
        .0
        .into_document()
}

fn document_xml(h: &WriteHost) -> String {
    let bytes = h.doc().save_docx().unwrap();
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes)).unwrap();
    let part = fmt_ooxml::PartName::new("/word/document.xml").unwrap();
    String::from_utf8(pkg.part(&part).unwrap().data.clone()).unwrap()
}

fn insert_shape(h: &mut WriteHost, kind: DrawingKind, preset: &str, text: &str) -> WritePatch {
    apply(
        h,
        C::InsertDrawing {
            block: NodeId(1),
            offset: 2,
            kind,
            preset: preset.into(),
            width: Emu(1_828_800),
            height: Emu(914_400),
            anchor: None,
            text: Some(text.into()),
        },
    )
}

#[test]
fn shape_with_text_is_a_nested_container() {
    let mut h = host(&["Hello", "After"]);
    let patch = insert_shape(&mut h, DrawingKind::Shape, "roundRect", "Inside");
    // The patch reports the paragraph holding the drawing.
    assert_eq!(patch.replaced.len(), 1);
    assert_eq!(patch.replaced[0].id(), NodeId(1));
    let d = drawing(&h, 1);
    assert_eq!(d.preset, "roundRect");
    assert_eq!(d.kind, DrawingKind::Shape);
    assert_eq!(
        doc(&h).find_paragraph(NodeId(1)).unwrap().text(),
        "He\u{FFFC}llo"
    );
    let inner = d.blocks()[0].id();
    // The text box paragraph is addressable by id like a cell's.
    assert_eq!(doc(&h).find_paragraph(inner).unwrap().text(), "Inside");
    assert_eq!(doc(&h).drawing_host(inner), Some((NodeId(1), d.id)));
    let p = apply(
        &mut h,
        C::InsertText {
            block: inner,
            offset: 6,
            text: " text".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    assert_eq!(
        p.replaced.iter().map(Block::id).collect::<Vec<_>>(),
        vec![NodeId(1)]
    );
    assert_eq!(doc(&h).find_paragraph(inner).unwrap().text(), "Inside text");
    // Enter inside the text box: a new paragraph in the drawing.
    let p = apply(
        &mut h,
        C::SplitParagraph {
            block: inner,
            offset: 6,
            new_id: -7,
        },
    );
    let real = p.id_map[0].1;
    assert_eq!(
        p.replaced.iter().map(Block::id).collect::<Vec<_>>(),
        vec![NodeId(1)]
    );
    assert!(
        p.inserted.is_empty(),
        "nothing is inserted at the top level"
    );
    let d = drawing(&h, 1);
    assert_eq!(d.blocks().len(), 2);
    assert_eq!(d.blocks()[1].id(), real);
    apply(&mut h, C::JoinWithPrevious { block: real });
    apply(
        &mut h,
        C::SetRunProps {
            block: inner,
            from: 0,
            to: 6,
            patch: RunProperties {
                bold: Some(true),
                ..Default::default()
            },
        },
    );
    // Saved as wps:wsp with txbxContent and a VML fallback; reopened editable.
    let xml = document_xml(&h);
    assert!(
        xml.contains("<mc:AlternateContent><mc:Choice Requires=\"wps\">"),
        "{xml}"
    );
    assert!(xml.contains("<wps:wsp>"));
    assert!(xml.contains("<a:prstGeom prst=\"roundRect\">"));
    assert!(xml.contains("<w:txbxContent>"));
    assert!(xml.contains("<mc:Fallback><w:pict><v:roundrect"));
    assert!(xml.contains("<v:textbox><w:txbxContent>"));
    let back = reopen(&h);
    let p = back.body[0].as_paragraph().unwrap();
    let d2 = p.drawings().next().unwrap();
    assert_eq!(d2.preset, "roundRect");
    assert_eq!(d2.fill, d.fill);
    assert_eq!(d2.line, d.line);
    assert_eq!(d2.text_color, d.text_color);
    let t = d2.blocks()[0].as_paragraph().unwrap();
    assert_eq!(t.text(), "Inside text");
    assert_eq!(t.inlines[0].as_run().unwrap().props.bold, Some(true));
    // The reopened text box text is addressable again.
    let host_id = p.id.0;
    let mut h2 = Host::new(WriteDocument::from_document(back.clone()).unwrap());
    let inner2 = drawing(&h2, host_id).blocks()[0].id();
    apply(
        &mut h2,
        C::InsertText {
            block: inner2,
            offset: 0,
            text: ">".into(),
            props: None,
            style: None,
            link: None,
        },
    );
}

#[test]
fn text_box_floats_and_props_change() {
    let mut h = host(&["Hello"]);
    insert_shape(&mut h, DrawingKind::TextBox, "rect", "Box");
    let mut d = drawing(&h, 1);
    assert_eq!(d.kind, DrawingKind::TextBox);
    assert_eq!(
        d.fill,
        ShapeFill::Solid(core_model::Color::Rgb(core_model::Rgb::WHITE))
    );
    let mut a = Anchor::new(WrapKind::Square);
    a.h.place = model_text::Placement::Align(model_text::HAlign::Right);
    a.h.relative_to = model_text::HRelative::Margin;
    d.anchor = Some(a);
    d.rotation = 15.0;
    d.line = ShapeLine::solid(
        core_model::Color::Rgb(core_model::Rgb::new(255, 0, 0)),
        Emu(25_400),
    );
    d.text.as_mut().unwrap().blocks.clear(); // ignored: the blocks stay
    let id = d.id;
    apply(
        &mut h,
        C::SetDrawingProps {
            block: NodeId(1),
            offset: 2,
            drawing: Box::new(d),
        },
    );
    let d = drawing(&h, 1);
    assert_eq!(d.id, id);
    assert_eq!(d.blocks()[0].as_paragraph().unwrap().text(), "Box");
    assert_eq!(d.anchor.unwrap().wrap, WrapKind::Square);
    let xml = document_xml(&h);
    assert!(xml.contains("<wps:cNvSpPr txBox=\"1\"/>"), "{xml}");
    assert!(xml.contains("<wp:wrapSquare wrapText=\"bothSides\"/>"));
    assert!(xml.contains("<wp:align>right</wp:align>"));
    assert!(xml.contains("rot=\"900000\""));
    let back = reopen(&h);
    let d2 = back.body[0]
        .as_paragraph()
        .unwrap()
        .drawings()
        .next()
        .unwrap()
        .clone();
    assert_eq!(d2.kind, DrawingKind::TextBox);
    assert_eq!(d2.anchor, d.anchor);
    assert_eq!(d2.rotation, 15.0);
    assert_eq!(d2.line, d.line);
    // A text box keeps its text.
    assert_eq!(
        h.apply(C::SetDrawingText {
            block: NodeId(1),
            offset: 2,
            blocks: None
        })
        .unwrap_err()
        .code(),
        "invalid_command"
    );
}

#[test]
fn drawing_text_fallback_with_temporary_ids() {
    let mut h = host(&["Hello"]);
    insert_shape(&mut h, DrawingKind::Shape, "ellipse", "");
    let p = apply(
        &mut h,
        C::SetDrawingText {
            block: NodeId(1),
            offset: 2,
            blocks: Some(vec![
                NewBlock::Paragraph(NewParagraph {
                    id: -1,
                    props: Default::default(),
                    inlines: vec![Inline::Run(Run::new("one"))],
                }),
                NewBlock::Paragraph(NewParagraph {
                    id: -2,
                    props: Default::default(),
                    inlines: vec![Inline::Run(Run::new("two"))],
                }),
            ]),
        },
    );
    assert_eq!(p.id_map.len(), 2);
    let d = drawing(&h, 1);
    assert_eq!(d.blocks().len(), 2);
    assert_eq!(d.blocks()[1].as_paragraph().unwrap().text(), "two");
    // Ids are unique in the document.
    let ids: Vec<u64> = d.blocks().iter().map(|b| b.id().0).collect();
    assert!(!ids.contains(&1) && !ids.contains(&d.id.0));
    // Deleting the shape and undoing restores the same ids.
    apply(
        &mut h,
        C::DeleteText {
            block: NodeId(1),
            from: 2,
            to: 3,
        },
    );
    // A pasted copy (same ids) gets fresh ones.
    let copy = Inline::Drawing(Box::new(d.clone()));
    apply(
        &mut h,
        C::ReplaceBlocks {
            ids: vec![NodeId(1)],
            blocks: vec![NewBlock::Paragraph(NewParagraph {
                id: 1,
                props: Default::default(),
                inlines: vec![
                    Inline::Run(Run::new("He")),
                    copy.clone(),
                    copy,
                    Inline::Run(Run::new("llo")),
                ],
            })],
        },
    );
    let p = doc(&h).find_paragraph(NodeId(1)).unwrap();
    let ds: Vec<&Drawing> = p.drawings().collect();
    assert_eq!(ds.len(), 2);
    assert_ne!(ds[0].id, ds[1].id);
    assert_ne!(ds[0].blocks()[0].id(), ds[1].blocks()[0].id());
}

#[test]
fn drawings_cannot_nest_and_paths_come_from_the_presets() {
    let mut h = host(&["Hello"]);
    insert_shape(&mut h, DrawingKind::TextBox, "rect", "x");
    let inner = drawing(&h, 1).blocks()[0].id();
    let e = h
        .apply(C::InsertDrawing {
            block: inner,
            offset: 0,
            kind: DrawingKind::Shape,
            preset: "rect".into(),
            width: Emu(100_000),
            height: Emu(100_000),
            anchor: None,
            text: None,
        })
        .unwrap_err();
    assert_eq!(e.code(), "invalid_command");
    let q = ShapePathQuery {
        preset: "roundRect".into(),
        w: 1000.0,
        h: 500.0,
        adjust: Default::default(),
    };
    let out = write_core::shape_outline(&q);
    assert_eq!(out.defaults.get("adj"), Some(&16_667));
    assert!(
        out.paths[0].d.starts_with('M') && out.paths[0].d.contains('C'),
        "{:?}",
        out.paths
    );
    let reply = dispatch_with(
        &mut h,
        r#"{"type":"shapePaths","queries":[{"preset":"nope","w":10,"h":10}]}"#,
    );
    assert!(reply.contains(r#""type":"shapePaths""#), "{reply}");
    assert!(
        reply.contains(r#""d":"M0 0 L10 0 L10 10 L0 10 Z""#),
        "{reply}"
    );
}

#[test]
fn picture_format_and_link_roundtrip() {
    let mut h = host(&["Hello"]);
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    apply(
        &mut h,
        C::InsertImage {
            block: NodeId(1),
            offset: 0,
            content_type: "image/png".into(),
            bytes_base64: png.into(),
            width: Emu(952_500),
            height: Emu(952_500),
            alt: None,
        },
    );
    let format = PictureFormat {
        crop: Crop {
            left: 10_000,
            top: 5_000,
            right: 0,
            bottom: 0,
        },
        border: Some(ShapeLine::solid(
            core_model::Color::Rgb(core_model::Rgb::BLACK),
            Emu(38_100),
        )),
        geometry: Some("ellipse".into()),
        shadow: true,
        brightness: 20_000,
        contrast: -10_000,
        recolor: Recolor::Grayscale,
    };
    apply(
        &mut h,
        C::SetImageFormat {
            block: NodeId(1),
            offset: 0,
            format: format.clone(),
        },
    );
    let link = Hyperlink::new(LinkTarget::Url("https://example.com/".into()));
    apply(
        &mut h,
        C::SetImageLink {
            block: NodeId(1),
            offset: 0,
            link: Some(link.clone()),
        },
    );
    let xml = document_xml(&h);
    assert!(xml.contains("<a:srcRect l=\"10000\" t=\"5000\"/>"), "{xml}");
    assert!(xml.contains("<a:hlinkClick"));
    let back = reopen(&h);
    let Inline::Image(img) = &back.body[0].as_paragraph().unwrap().inlines[0] else {
        panic!("image");
    };
    assert_eq!(img.format, format);
    assert_eq!(img.link.as_ref(), Some(&link));
    // A crop leaving nothing is refused.
    let mut bad = format;
    bad.crop.left = 60_000;
    bad.crop.right = 50_000;
    assert_eq!(
        h.apply(C::SetImageFormat {
            block: NodeId(1),
            offset: 0,
            format: bad
        })
        .unwrap_err()
        .code(),
        "invalid_command"
    );
}

#[test]
fn character_formatting_zoo_roundtrips() {
    let mut h = host(&["small caps spaced"]);
    let props = RunProperties {
        small_caps: Some(true),
        char_spacing: Some(40),
        position: Some(6),
        kerning: Some(28),
        scale: Some(150),
        double_strike: Some(true),
        outline: Some(true),
        shadow: Some(true),
        hidden: Some(true),
        all_caps: Some(false),
        emboss: Some(true),
        imprint: Some(false),
        rtl: Some(true),
        ..Default::default()
    };
    apply(
        &mut h,
        C::SetRunProps {
            block: NodeId(1),
            from: 0,
            to: 10,
            patch: props.clone(),
        },
    );
    let xml = document_xml(&h);
    assert!(xml.contains("<w:smallCaps/>"), "{xml}");
    assert!(xml.contains("<w:spacing w:val=\"40\"/>"));
    let back = reopen(&h);
    let r = back.body[0].as_paragraph().unwrap().inlines[0]
        .as_run()
        .unwrap();
    assert_eq!(r.props, props);
}

#[test]
fn change_case_keeps_formatting() {
    let mut h = host(&["hello world. bye"]);
    apply(
        &mut h,
        C::SetRunProps {
            block: NodeId(1),
            from: 6,
            to: 11,
            patch: RunProperties {
                bold: Some(true),
                ..Default::default()
            },
        },
    );
    apply(
        &mut h,
        C::ChangeCase {
            block: NodeId(1),
            from: 0,
            to: 16,
            case: TextCase::Upper,
        },
    );
    let p = doc(&h).find_paragraph(NodeId(1)).unwrap();
    assert_eq!(p.text(), "HELLO WORLD. BYE");
    assert_eq!(p.inlines[1].as_run().unwrap().text, "WORLD");
    assert_eq!(p.inlines[1].as_run().unwrap().props.bold, Some(true));
    apply(
        &mut h,
        C::ChangeCase {
            block: NodeId(1),
            from: 0,
            to: 16,
            case: TextCase::Sentence,
        },
    );
    assert_eq!(
        doc(&h).find_paragraph(NodeId(1)).unwrap().text(),
        "Hello world. Bye"
    );
}

#[test]
fn apply_numbering_creates_one_list() {
    let mut h = host(&["a", "b", "c"]);
    let levels = vec![
        Level::new(LevelKind::UpperRoman, "%1."),
        Level::new(LevelKind::Decimal, "%1.%2"),
    ];
    let p = apply(
        &mut h,
        C::ApplyNumbering {
            levels,
            items: vec![(NodeId(1), 0), (NodeId(2), 1), (NodeId(3), 0)],
        },
    );
    assert!(p.numbering.is_some());
    let labels: Vec<String> = doc(&h).list_numbers().into_iter().map(|(_, l)| l).collect();
    assert_eq!(labels, vec!["I.", "I.1", "II."]);
}

fn merged_table() -> WriteHost {
    // Row 0: one cell spanning both grid columns; row 1: two cells.
    let mut doc = Document::new();
    doc.body.clear();
    let mut next = 100;
    let mut id = || {
        next += 1;
        NodeId(next)
    };
    let mut cell = |span: u16, text: &str| {
        let mut c = TableCell::new(
            id(),
            Default::default(),
            vec![Block::Paragraph(Paragraph::with_text(id(), text))],
        );
        c.grid_span = span;
        c
    };
    let rows = vec![vec![cell(2, "head")], vec![cell(1, "a"), cell(1, "b")]];
    let t = Table {
        id: NodeId(1),
        props: Default::default(),
        rows: rows
            .into_iter()
            .enumerate()
            .map(|(i, cells)| TableRow {
                id: NodeId(50 + i as u64),
                props: Default::default(),
                cells,
            })
            .collect(),
    };
    doc.body.push(Block::Table(t));
    doc.reserve_id(NodeId(200));
    Host::new(WriteDocument::from_document(doc).unwrap())
}

#[test]
fn columns_respect_merged_cells() {
    let mut h = merged_table();
    apply(
        &mut h,
        C::InsertTableCol {
            table: NodeId(1),
            at: 1,
            new_ids: vec![],
        },
    );
    let t = doc(&h).body[0].as_table().unwrap().clone();
    assert_eq!(t.rows[0].cells.len(), 1, "the merged header grows");
    assert_eq!(t.rows[0].cells[0].grid_span, 3);
    assert_eq!(t.rows[1].cells.len(), 3);
    t.check_grid().unwrap();
    apply(
        &mut h,
        C::DeleteTableCol {
            table: NodeId(1),
            at: 0,
        },
    );
    let t = doc(&h).body[0].as_table().unwrap();
    assert_eq!(t.rows[0].cells[0].grid_span, 2);
    assert_eq!(t.rows[1].cells.len(), 2);
    t.check_grid().unwrap();
}

#[test]
fn create_style_makes_a_linked_pair() {
    let mut h = host(&["x"]);
    let mut s = Style::new("Memo", "Memo", StyleKind::Linked);
    s.based_on = Some("Normal".into());
    s.custom = true;
    s.run.bold = Some(true);
    apply(&mut h, C::AddStyle { style: s });
    let st = &doc(&h).styles;
    assert_eq!(st.get("Memo").unwrap().link.as_deref(), Some("MemoChar"));
    let c = st.get("MemoChar").unwrap();
    assert_eq!(c.kind, StyleKind::Character);
    assert_eq!(c.link.as_deref(), Some("Memo"));
    assert_eq!(c.name, "Memo Char");
    assert_eq!(c.run.bold, Some(true));
}

#[test]
fn note_runs_are_normalized_and_settings_roundtrip() {
    let mut h = host(&["Body"]);
    let p = apply(
        &mut h,
        C::InsertFootnote {
            block: NodeId(1),
            offset: 4,
            text: String::new(),
            kind: Default::default(),
        },
    );
    let note = p.notes.unwrap()[0].clone();
    let np = note.blocks[0].id();
    for (i, ch) in "abc".chars().enumerate() {
        h.apply(C::InsertText {
            block: np,
            offset: i as u32,
            text: ch.to_string(),
            props: Some(RunProperties::default()),
            style: None,
            link: None,
        })
        .unwrap();
    }
    let n = doc(&h).note(note.id).unwrap();
    let runs = n.blocks[0]
        .as_paragraph()
        .unwrap()
        .inlines
        .iter()
        .filter(|i| i.as_run().is_some())
        .count();
    assert_eq!(runs, 1, "{:?}", n.blocks[0]);
    apply(
        &mut h,
        C::SetSettings {
            settings: DocumentSettings {
                auto_hyphenation: true,
                hyphenation_zone: Some(425),
                endnotes_at_section_end: true,
            },
        },
    );
    let back = reopen(&h);
    assert_eq!(back.settings.hyphenation_zone, Some(425));
    assert!(back.settings.endnotes_at_section_end);
    assert!(back.settings.auto_hyphenation);
}
