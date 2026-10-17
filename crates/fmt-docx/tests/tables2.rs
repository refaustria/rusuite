//! P9-W5: floating tables (`w:tblpPr`, `w:tblOverlap`), table layout,
//! width and look, table style text formatting (`w:tblStylePr`),
//! special characters and unequal text columns — written and read back.

use std::io::Cursor;

use core_model::units::Twips;
use fmt_ooxml::{Package, PartName};
use model_text::{
    Block, CellProperties, ColumnWidth, Columns, Document, Inline, NodeId, Paragraph, Run,
    StyleKind, Table, TableAnchor, TableCell, TableLayout, TableLook, TablePosSpec, TablePosition,
    TableProperties, TableRow, TableWidth,
};

fn reread(doc: &Document) -> Document {
    let bytes = fmt_docx::write(doc).unwrap();
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    out.document
}

fn document_xml(bytes: &[u8]) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let main = PartName::new("/word/document.xml").unwrap();
    String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap()
}

/// A document with one 2 × 2 table with `props` after a paragraph.
fn table_doc(props: TableProperties) -> Document {
    let mut doc = Document::new();
    let mut ids = 100;
    let mut next = || {
        ids += 1;
        NodeId(ids)
    };
    let rows = (0..2)
        .map(|r| TableRow {
            id: next(),
            props: Default::default(),
            cells: (0..2)
                .map(|c| {
                    TableCell::new(
                        next(),
                        CellProperties::default(),
                        vec![Block::Paragraph(Paragraph::with_text(
                            next(),
                            &format!("{r}{c}"),
                        ))],
                    )
                })
                .collect(),
        })
        .collect();
    doc.body = vec![
        Block::Paragraph(Paragraph::with_text(NodeId(1), "before")),
        Block::Table(Table {
            id: NodeId(2),
            props: TableProperties {
                col_widths: vec![Twips(2000), Twips(3000)],
                ..props
            },
            rows,
        }),
        Block::Paragraph(Paragraph::with_text(NodeId(3), "after")),
    ];
    doc.normalize();
    doc
}

fn table_props(doc: &Document) -> TableProperties {
    match &doc.body[1] {
        Block::Table(t) => t.props.clone(),
        b => panic!("not a table: {b:?}"),
    }
}

#[test]
fn floating_table_position_roundtrips() {
    let pos = TablePosition {
        left_from_text: Twips(180),
        right_from_text: Twips(180),
        top_from_text: Twips(57),
        bottom_from_text: Twips(57),
        horz_anchor: Some(TableAnchor::Margin),
        vert_anchor: Some(TableAnchor::Page),
        x: Twips(0),
        x_spec: Some(TablePosSpec::Center),
        y: Twips(1440),
        y_spec: None,
        overlap: false,
    };
    let doc = table_doc(TableProperties {
        floating: Some(pos),
        ..Default::default()
    });
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = document_xml(&bytes);
    assert!(xml.contains(r#"<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:topFromText="57" w:bottomFromText="57" w:vertAnchor="page" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="1440"/>"#), "{xml}");
    assert!(xml.contains(r#"<w:tblOverlap w:val="never"/>"#));
    // Word's order: tblStyle, tblpPr, tblOverlap, …, tblW
    assert!(xml.find("w:tblpPr").unwrap() < xml.find("w:tblOverlap").unwrap());
    assert_eq!(table_props(&reread(&doc)).floating, Some(pos));

    // Word's "Around" default and a bottom-aligned position
    let around = TablePosition {
        y_spec: Some(TablePosSpec::End),
        ..TablePosition::word_around()
    };
    let doc = table_doc(TableProperties {
        floating: Some(around),
        ..Default::default()
    });
    let back = table_props(&reread(&doc)).floating.unwrap();
    assert_eq!(back, around);
    assert!(back.overlap);
    assert!(document_xml(&fmt_docx::write(&doc).unwrap()).contains(r#"w:tblpYSpec="bottom""#));
}

#[test]
fn table_layout_width_and_look_roundtrip() {
    for (layout, width) in [
        (TableLayout::Fixed, TableWidth::Twips(Twips(5000))),
        (TableLayout::Autofit, TableWidth::Pct(5000)),
        (TableLayout::Autofit, TableWidth::Auto),
    ] {
        let look = TableLook {
            first_row: true,
            last_row: true,
            banded_cols: true,
            ..Default::default()
        };
        let doc = table_doc(TableProperties {
            layout: Some(layout),
            width: Some(width),
            look: Some(look),
            ..Default::default()
        });
        let xml = document_xml(&fmt_docx::write(&doc).unwrap());
        assert!(xml.contains("w:tblLayout"));
        let back = table_props(&reread(&doc));
        assert_eq!(back.layout, Some(layout));
        assert_eq!(back.width, Some(width));
        assert_eq!(back.look, Some(look));
        assert_eq!(back.col_widths, vec![Twips(2000), Twips(3000)]);
    }
}

#[test]
fn table_style_text_formatting_roundtrips() {
    let mut doc = table_doc(TableProperties {
        style: Some("GridTable4-Accent1".into()),
        look: Some(TableLook::word_default()),
        ..Default::default()
    });
    let defaults = model_text::StyleSheet::office_defaults();
    for id in ["TableNormal", "GridTable4-Accent1"] {
        if doc.styles.get(id).is_none() {
            doc.styles.styles.push(defaults.get(id).unwrap().clone());
        }
    }
    let bytes = fmt_docx::write(&doc).unwrap();
    let back = reread(&doc);
    let s = back.styles.get("GridTable4-Accent1").unwrap();
    assert_eq!(s.kind, StyleKind::Table);
    let Block::Table(t) = &back.body[1] else {
        panic!()
    };
    // the header row is bold through tblStylePr/firstRow, also after the round trip
    let Block::Paragraph(p) = &t.rows[0].cells[1].blocks[0] else {
        panic!()
    };
    let run = p.inlines[0].as_run().unwrap();
    assert_eq!(
        back.resolve_run_props_in_cell(t, 0, 1, p, run).bold,
        Some(true)
    );
    let Block::Paragraph(body) = &t.rows[1].cells[1].blocks[0] else {
        panic!()
    };
    assert_ne!(
        back.resolve_run_props_in_cell(t, 1, 1, body, body.inlines[0].as_run().unwrap())
            .bold,
        Some(true)
    );
    let pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let styles = String::from_utf8(
        pkg.part(&PartName::new("/word/styles.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap();
    assert!(styles.contains(r#"<w:tblStylePr w:type="firstRow">"#));
}

#[test]
fn special_characters_are_written_as_word_does() {
    let mut doc = Document::new();
    let mut p = Paragraph::new(NodeId(1));
    p.inlines.push(Inline::Run(Run::new(
        "non\u{2011}breaking soft\u{AD}hyphen a\u{A0}b \u{2014} \u{2013} \u{A9}\u{AE}\u{2122}\u{2026}",
    )));
    doc.body = vec![Block::Paragraph(p)];
    doc.normalize();
    let xml = document_xml(&fmt_docx::write(&doc).unwrap());
    assert!(
        xml.contains("<w:t>non</w:t><w:noBreakHyphen/><w:t>breaking soft</w:t><w:softHyphen/>"),
        "{xml}"
    );
    // a non-breaking space stays a character (U+00A0), as Word writes it
    assert!(xml.contains("a\u{A0}b"));
    assert_eq!(reread(&doc).plain_text(), doc.plain_text());
}

#[test]
fn unequal_columns_roundtrip() {
    let mut doc = Document::new();
    doc.body = vec![Block::Paragraph(Paragraph::with_text(NodeId(1), "text"))];
    doc.normalize();
    let cols = Columns {
        count: 2,
        spacing: None,
        equal: false,
        widths: vec![
            ColumnWidth {
                width: Twips(2880),
                space: Twips(720),
            },
            ColumnWidth {
                width: Twips(5426),
                space: Twips(0),
            },
        ],
        separator: true,
    };
    doc.sections[0].columns = cols.clone();
    let xml = document_xml(&fmt_docx::write(&doc).unwrap());
    assert!(
        xml.contains(r#"<w:cols w:num="2" w:sep="1" w:equalWidth="0"><w:col w:w="2880" w:space="720"/><w:col w:w="5426"/></w:cols>"#)
            || xml.contains(r#"w:equalWidth="0""#),
        "{xml}"
    );
    assert_eq!(reread(&doc).sections[0].columns, cols);
}
