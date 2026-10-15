use core_model::units::{Emu, Twips};
use core_model::{Color, FontSize, Rgb, RunProperties};
use model_text::{
    Alignment, Block, BorderSide, BorderStyle, BreakKind, CellProperties, Document, Indent, Inline,
    InlineImage, LineSpacing, NodeId, NumberingDef, NumberingRef, Paragraph, ParagraphProperties,
    RowProperties, Run, StyleSheet, Table, TableBorders, TableCell, TableProperties, TableRow,
    TableWidth,
};

fn bold() -> RunProperties {
    RunProperties {
        bold: Some(true),
        ..Default::default()
    }
}

fn styled(doc: &mut Document, style: &str, text: &str) -> Paragraph {
    let mut p = Paragraph::with_text(doc.alloc_id(), text);
    p.props.style = Some(style.to_owned());
    p
}

fn list_item(doc: &mut Document, num_id: u32, level: u8, text: &str) -> Paragraph {
    let mut p = styled(doc, "ListParagraph", text);
    p.props.numbering = Some(NumberingRef { num_id, level });
    p
}

fn cell(doc: &mut Document, text: &str, props: CellProperties) -> TableCell {
    let id = doc.alloc_id();
    TableCell {
        id,
        props,
        blocks: vec![Block::Paragraph(Paragraph::with_text(doc.alloc_id(), text))],
    }
}

/// Heading + bulleted list (levels 0/1) + 2×2 table with a shaded header
/// row + a paragraph with an inline image.
fn sample() -> Document {
    let mut doc = Document::new();
    doc.body.clear();
    let num_id = doc.numbering.next_id();
    doc.numbering.insert(NumberingDef::bullet_default(num_id));

    let heading = styled(&mut doc, "Heading1", "Report");
    let item1 = list_item(&mut doc, num_id, 0, "First item");
    let item2 = list_item(&mut doc, num_id, 1, "Nested item");

    let shade = CellProperties {
        shading: Some(Color::Rgb(Rgb::new(0xD9, 0xE2, 0xF3))),
        ..Default::default()
    };
    let header = TableRow {
        id: doc.alloc_id(),
        props: RowProperties {
            header: true,
            ..Default::default()
        },
        cells: vec![
            cell(&mut doc, "Name", shade),
            cell(&mut doc, "Value", shade),
        ],
    };
    let body_row = TableRow {
        id: doc.alloc_id(),
        props: RowProperties::default(),
        cells: vec![
            cell(&mut doc, "Alpha", CellProperties::default()),
            cell(&mut doc, "42", CellProperties::default()),
        ],
    };
    let table = Table {
        id: doc.alloc_id(),
        props: TableProperties {
            width: Some(TableWidth::Pct(5000)),
            col_widths: vec![Twips(4513), Twips(4513)],
            borders: Some(TableBorders::all(BorderSide {
                style: BorderStyle::Single,
                width: BorderSide::width_from_eighths(4),
                color: Color::Auto,
            })),
            cell_margins: None,
        },
        rows: vec![header, body_row],
    };

    let media = doc
        .media
        .insert("image/png", b"\x89PNG\r\n\x1a\nfake".to_vec());
    let mut image_par = Paragraph::with_text(doc.alloc_id(), "Logo: ");
    image_par.inlines.push(Inline::Image(InlineImage {
        media,
        width: Emu::from_cm(2.0),
        height: Emu::from_cm(1.0),
        alt: Some("Company logo".into()),
        name: Some("Picture 1".into()),
    }));

    doc.body = vec![
        Block::Paragraph(heading),
        Block::Paragraph(item1),
        Block::Paragraph(item2),
        Block::Table(table),
        Block::Paragraph(image_par),
    ];
    doc
}

#[test]
fn new_document_snapshot() {
    let doc = Document::new();
    assert_eq!(doc.body.len(), 1);
    assert_eq!(doc.plain_text(), "");
    insta::assert_json_snapshot!(serde_json::to_value(&doc).unwrap());
}

#[test]
fn office_defaults_snapshot() {
    insta::assert_json_snapshot!(serde_json::to_value(StyleSheet::office_defaults()).unwrap());
}

#[test]
fn sample_snapshot_and_roundtrip() {
    let mut doc = sample();
    insta::assert_json_snapshot!(serde_json::to_value(&doc).unwrap());

    let json = doc.to_json().unwrap();
    let mut back = Document::from_json(&json).unwrap();
    assert_eq!(back, doc);
    // The id counter continues after the largest loaded id.
    let a = doc.alloc_id();
    let b = back.alloc_id();
    assert_eq!(a, b);
    assert!(back.find_block(b).is_none());
    assert!(Document::from_json("{\"body\":7}").is_err());
}

#[test]
fn id_counter_after_load_uses_max_id() {
    let json = r#"{"body":[
        {"kind":"paragraph","value":{"id":7,"inlines":[]}},
        {"kind":"paragraph","value":{"id":3,"inlines":[{"kind":"run","value":{"text":"x"}}]}}
    ]}"#;
    let mut doc = Document::from_json(json).unwrap();
    assert_eq!(doc.alloc_id(), NodeId(8));
    assert_eq!(doc.plain_text(), "\nx");
    // missing parts take their defaults
    assert!(doc.styles.styles.is_empty());
    assert_eq!(doc.page, model_text::PageSetup::a4());
}

#[test]
fn find_and_iterate() {
    let mut doc = sample();
    let texts: Vec<String> = doc.paragraphs().map(Paragraph::text).collect();
    assert_eq!(
        texts,
        [
            "Report",
            "First item",
            "Nested item",
            "Name",
            "Value",
            "Alpha",
            "42",
            "Logo: \u{FFFC}"
        ]
    );
    let in_cell = doc.paragraphs().nth(5).unwrap().id;
    assert_eq!(
        doc.find_paragraph(in_cell).map(Paragraph::text).as_deref(),
        Some("Alpha")
    );
    let table_id = doc.body[3].id();
    assert!(doc.find_block(table_id).unwrap().as_table().is_some());
    assert!(doc.find_block(NodeId(9999)).is_none());

    if let Some(Block::Paragraph(p)) = doc.find_block_mut(in_cell) {
        p.inlines.push(Inline::Run(Run::new("!")));
    }
    assert_eq!(doc.find_paragraph(in_cell).unwrap().text(), "Alpha!");
    assert_eq!(doc.word_count(), 10);
}

#[test]
fn plain_text_with_image_break_and_tab() {
    let mut doc = Document::new();
    let media = doc.media.insert("image/png", vec![1]);
    let mut p = Paragraph::with_text(doc.alloc_id(), "a\tb");
    p.inlines.push(Inline::Break(BreakKind::Line));
    p.inlines.push(Inline::Run(Run::with_props("c", bold())));
    p.inlines.push(Inline::Image(InlineImage {
        media,
        width: Emu(1),
        height: Emu(1),
        alt: None,
        name: None,
    }));
    p.inlines.push(Inline::Break(BreakKind::Page));
    doc.body.push(Block::Paragraph(p));
    let end = Paragraph::with_text(doc.alloc_id(), "end");
    doc.body.push(Block::Paragraph(end));
    assert_eq!(doc.plain_text(), "\na\tb\u{000B}c\u{FFFC}\u{000C}\nend");
    assert_eq!(doc.word_count(), 4);
}

#[test]
fn normalize_merges_runs_and_keeps_text() {
    let mut doc = Document::new();
    let id = doc.body[0].id();
    let Some(Block::Paragraph(p)) = doc.find_block_mut(id) else {
        panic!()
    };
    p.inlines = vec![
        Inline::Run(Run::new("Hel")),
        Inline::Run(Run::new("")),
        Inline::Run(Run::new("lo ")),
        Inline::Run(Run::with_props("big", bold())),
        Inline::Run(Run::with_props(" bold", bold())),
        Inline::Break(BreakKind::Line),
        Inline::Run(Run::new("x")),
        Inline::Run(Run::with_props("", bold())),
        Inline::Run(Run::new("y")),
    ];
    let before = doc.plain_text();
    doc.normalize();
    assert_eq!(doc.plain_text(), before);
    let p = doc.find_paragraph(id).unwrap();
    assert_eq!(
        p.inlines,
        vec![
            Inline::Run(Run::new("Hello ")),
            Inline::Run(Run::with_props("big bold", bold())),
            Inline::Break(BreakKind::Line),
            Inline::Run(Run::new("xy")),
        ]
    );
    // idempotent
    let snapshot = doc.clone();
    doc.normalize();
    assert_eq!(doc, snapshot);
}

#[test]
fn normalize_fills_empty_body_and_cells() {
    let mut doc = Document::new();
    doc.body.clear();
    doc.normalize();
    assert_eq!(doc.body.len(), 1);
    assert!(doc.body[0].as_paragraph().unwrap().inlines.is_empty());

    let cell = TableCell {
        id: doc.alloc_id(),
        props: CellProperties::default(),
        blocks: vec![],
    };
    let row = TableRow {
        id: doc.alloc_id(),
        props: RowProperties::default(),
        cells: vec![cell],
    };
    let table = Table {
        id: doc.alloc_id(),
        props: TableProperties::default(),
        rows: vec![row],
    };
    doc.body = vec![Block::Table(table)];
    doc.normalize();
    // body ends with a paragraph after the table; the cell got one too
    assert_eq!(doc.body.len(), 2);
    let ids: Vec<NodeId> = doc.paragraphs().map(|p| p.id).collect();
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    let next = doc.alloc_id();
    assert!(ids.iter().all(|id| *id < next));
}

#[test]
fn resolve_layers_defaults_style_numbering_direct() {
    let doc = sample();
    let heading = doc.body[0].as_paragraph().unwrap();
    let props = doc.resolve_paragraph_props(heading);
    assert_eq!(props.style.as_deref(), Some("Heading1"));
    assert_eq!(props.keep_next, Some(true));
    assert_eq!(props.spacing.unwrap().before, Some(Twips(240)));
    let Inline::Run(run) = &heading.inlines[0] else {
        panic!()
    };
    let rp = doc.resolve_run_props(heading, run);
    assert_eq!(rp.size, Some(FontSize::from_pt(16.0)));

    // list item: ListParagraph indent 720 replaced by level 1 (1440/360)
    let nested = doc.body[2].as_paragraph().unwrap();
    let props = doc.resolve_paragraph_props(nested);
    assert_eq!(
        props.indent,
        Some(Indent {
            left: Some(Twips(1440)),
            right: None,
            first_line: None,
            hanging: Some(Twips(360)),
        })
    );

    // direct formatting wins over style and numbering
    let mut direct = nested.clone();
    direct.props.indent = Some(Indent {
        left: Some(Twips(100)),
        ..Default::default()
    });
    direct.props.alignment = Some(Alignment::Right);
    direct.props.spacing = Some(model_text::Spacing {
        line: Some(LineSpacing::Exact(Twips(300))),
        ..Default::default()
    });
    let props = doc.resolve_paragraph_props(&direct);
    let indent = props.indent.unwrap();
    assert_eq!(indent.left, Some(Twips(100)));
    assert_eq!(indent.hanging, Some(Twips(360)));
    assert_eq!(props.alignment, Some(Alignment::Right));
    let spacing = props.spacing.unwrap();
    assert_eq!(spacing.line, Some(LineSpacing::Exact(Twips(300))));
    assert_eq!(spacing.after, Some(Twips(160)));

    // num_id 0 switches numbering off: no level indent
    let mut off = nested.clone();
    off.props.numbering = Some(NumberingRef {
        num_id: 0,
        level: 0,
    });
    let props = doc.resolve_paragraph_props(&off);
    assert_eq!(props.indent.unwrap().left, Some(Twips(720)));

    // run: direct formatting wins over the style
    let h_run = Run::with_props(
        "x",
        RunProperties {
            size: Some(FontSize::from_pt(20.0)),
            bold: Some(true),
            ..Default::default()
        },
    );
    let rp = doc.resolve_run_props(heading, &h_run);
    assert_eq!(rp.size, Some(FontSize::from_pt(20.0)));
    assert_eq!(rp.bold, Some(true));
    assert!(rp.color.is_some());

    // unknown style falls back to Normal (defaults)
    let mut unknown = Paragraph::new(NodeId(1));
    unknown.props = ParagraphProperties {
        style: Some("NoSuchStyle".into()),
        ..Default::default()
    };
    let props = doc.resolve_paragraph_props(&unknown);
    assert_eq!(props.style.as_deref(), Some("Normal"));
    let rp = doc.resolve_run_props(&unknown, &Run::new("x"));
    assert_eq!(rp.size, Some(FontSize::from_pt(11.0)));
}

#[test]
fn paragraph_len_normalize_and_reserved_ids() {
    let mut doc = Document::new();
    let mut p = Paragraph::new(doc.alloc_id());
    p.inlines = vec![
        Inline::Run(Run::new("é😀")),
        Inline::Run(Run::new("")),
        Inline::Run(Run::new("a")),
        Inline::Break(BreakKind::Line),
    ];
    assert_eq!(p.len(), 4);
    assert!(!p.is_empty());
    p.normalize();
    assert_eq!(
        p.inlines,
        vec![
            Inline::Run(Run::new("é😀a")),
            Inline::Break(BreakKind::Line)
        ]
    );
    assert!(Paragraph::new(NodeId(9)).is_empty());
    doc.reserve_id(NodeId(41));
    assert_eq!(doc.alloc_id(), NodeId(42));
    doc.reserve_id(NodeId(5));
    assert_eq!(doc.alloc_id(), NodeId(43));
}
