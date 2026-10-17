//! P9-W5: grid-aware column and row commands across merged cells, Split
//! Table, joining tables, Convert Text to Table / Table to Text, AutoFit,
//! text wrapping around tables and special characters (undo identity,
//! patches, `.docx` round trips).

use std::io::Cursor;

use app_common::Host;
use fmt_ooxml::{Package, PartName};
use model_text::{
    Block, Document, Inline, NodeId, Paragraph, Run, Table, TableLayout, TablePosSpec,
    TablePosition, TableWidth, Twips, VMerge,
};
use serde_json::Value as Json;
use write_core::{
    AutoFitMode, TextSeparator, WriteCommand as C, WriteDocument, WriteHost, WritePatch,
};

fn host_with(doc: Document) -> WriteHost {
    Host::new(WriteDocument::from_document(doc).unwrap())
}

/// Paragraphs with `texts`, ids 1, 2, …
fn host_paras(texts: &[&str]) -> WriteHost {
    let mut doc = Document::new();
    doc.body = texts
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let mut p = Paragraph::new(NodeId(i as u64 + 1));
            if !t.is_empty() {
                p.inlines.push(Inline::Run(Run::new(*t)));
            }
            Block::Paragraph(p)
        })
        .collect();
    doc.reserve_id(NodeId(texts.len() as u64));
    host_with(doc)
}

fn json_of(h: &WriteHost) -> Json {
    serde_json::to_value(h.doc().document()).unwrap()
}

/// Applies `cmd`, checks undo → before and redo → after.
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

fn err_code(h: &mut WriteHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before, "failed command changed the document");
    e.code()
}

/// A `rows × cols` table after paragraph 1, cell (r, c) holding "r,c".
fn table_host(rows: u32, cols: u32) -> (WriteHost, NodeId) {
    let mut h = host_paras(&["a"]);
    apply(
        &mut h,
        C::InsertTable {
            after: Some(NodeId(1)),
            parent: None,
            rows,
            cols,
            new_ids: vec![],
        },
    );
    let t = h.doc().document().body[1].id();
    let cells: Vec<(NodeId, String)> = table_of(&h, t)
        .rows
        .iter()
        .enumerate()
        .flat_map(|(r, row)| {
            row.cells
                .iter()
                .enumerate()
                .map(move |(c, cell)| (cell.blocks[0].id(), format!("{r},{c}")))
        })
        .collect();
    for (p, text) in cells {
        h.apply(C::InsertText {
            block: p,
            offset: 0,
            text,
            props: None,
            style: None,
            link: None,
        })
        .unwrap();
    }
    (h, t)
}

fn table_of(h: &WriteHost, t: NodeId) -> Table {
    h.doc()
        .document()
        .find_block(t)
        .unwrap()
        .as_table()
        .unwrap()
        .clone()
}

fn texts(t: &Table) -> Vec<Vec<String>> {
    t.rows
        .iter()
        .map(|r| {
            r.cells
                .iter()
                .map(|c| {
                    let tag = match c.v_merge {
                        Some(VMerge::Restart) => "^",
                        Some(VMerge::Continue) => "|",
                        None => "",
                    };
                    let p: Vec<String> = c
                        .blocks
                        .iter()
                        .filter_map(Block::as_paragraph)
                        .map(Paragraph::text)
                        .collect();
                    format!("{tag}{}x{}", p.join("/"), c.grid_span)
                })
                .collect()
        })
        .collect()
}

fn body_texts(h: &WriteHost) -> Vec<String> {
    h.doc()
        .document()
        .body
        .iter()
        .map(|b| match b {
            Block::Paragraph(p) => p.text(),
            Block::Table(t) => format!("<table {}x{}>", t.rows.len(), t.grid_cols()),
            Block::Toc(_) => "<toc>".into(),
        })
        .collect()
}

fn reopen(h: &WriteHost) -> Document {
    let bytes = h.doc().save_docx().unwrap();
    let (doc, warnings) = WriteDocument::open_docx(&bytes, "t.docx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    doc.document().clone()
}

fn document_xml(h: &WriteHost) -> String {
    let bytes = h.doc().save_docx().unwrap();
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let main = PartName::new("/word/document.xml").unwrap();
    String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap()
}

fn merge(h: &mut WriteHost, t: NodeId, top: u32, left: u32, bottom: u32, right: u32) {
    apply(
        h,
        C::MergeCells {
            table: t,
            top,
            left,
            bottom,
            right,
        },
    );
}

#[test]
fn insert_column_inside_a_merged_header_grows_it_and_saves_grid_span() {
    let (mut h, t) = table_host(3, 3);
    merge(&mut h, t, 0, 0, 0, 1);
    apply(
        &mut h,
        C::InsertTableCol {
            table: t,
            at: 1,
            new_ids: vec![],
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(texts(&tb)[0], ["0,0/0,1x3", "0,2x1"]);
    assert_eq!(texts(&tb)[1], ["1,0x1", "x1", "1,1x1", "1,2x1"]);
    assert_eq!(tb.props.col_widths.len(), 4);
    let back = reopen(&h);
    let bt = back.body[1].as_table().unwrap();
    assert_eq!(bt.rows[0].cells[0].grid_span, 3);
    assert!(document_xml(&h).contains(r#"<w:gridSpan w:val="3"/>"#));
    // at the span's edge a new cell is inserted beside it
    apply(
        &mut h,
        C::InsertTableCol {
            table: t,
            at: 0,
            new_ids: vec![],
        },
    );
    assert_eq!(texts(&table_of(&h, t))[0], ["x1", "0,0/0,1x3", "0,2x1"]);
}

#[test]
fn delete_column_inside_a_span_shrinks_it_and_keeps_vertical_merges() {
    let (mut h, t) = table_host(3, 3);
    merge(&mut h, t, 0, 0, 0, 2); // header over three columns
    merge(&mut h, t, 1, 2, 2, 2); // column 2 merged over rows 1–2
    apply(&mut h, C::DeleteTableCol { table: t, at: 1 });
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(
        texts(&tb),
        [
            vec!["0,0/0,1/0,2x2"],
            vec!["1,0x1", "^1,2/2,2x1"],
            vec!["2,0x1", "|x1"]
        ]
    );
    // deleting the merged column removes the region
    apply(&mut h, C::DeleteTableCol { table: t, at: 1 });
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(texts(&tb), [["0,0/0,1/0,2x1"], ["1,0x1"], ["2,0x1"]]);
}

#[test]
fn ragged_rows_are_padded_on_column_insert() {
    let (h0, t) = table_host(2, 3);
    let mut doc = h0.doc().document().clone();
    if let Block::Table(tb) = &mut doc.body[1] {
        tb.rows[1].cells.pop(); // a row covering 2 of 3 grid columns
    }
    let mut h = host_with(doc);
    apply(
        &mut h,
        C::InsertTableCol {
            table: t,
            at: 3,
            new_ids: vec![],
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(tb.grid_cols(), 4);
    assert_eq!(texts(&tb)[1], ["1,0x1", "1,1x1", "x1", "x1"]);
}

#[test]
fn insert_row_copies_merges() {
    let (mut h, t) = table_host(3, 3);
    merge(&mut h, t, 1, 0, 1, 1); // row 1: a cell over two columns
    merge(&mut h, t, 0, 2, 2, 2); // column 2 over all rows
    apply(
        &mut h,
        C::InsertTableRow {
            table: t,
            at: 2,
            new_ids: vec![],
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    // the new row copies row 1's horizontal merge and continues the vertical one
    assert_eq!(texts(&tb)[2], ["x2", "|x1"]);
    assert_eq!(tb.row_span(0, 2), 4);
    // appending below the table: no vertical continuation past the end
    apply(
        &mut h,
        C::InsertTableRow {
            table: t,
            at: 4,
            new_ids: vec![],
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(texts(&tb)[4], ["x1", "x1", "x1"]);
}

#[test]
fn split_table_and_join_again() {
    let (mut h, t) = table_host(4, 2);
    let p = apply(
        &mut h,
        C::SplitTable {
            table: t,
            at: 2,
            new_ids: vec![-5, -6],
        },
    );
    assert_eq!(body_texts(&h), ["a", "<table 2x2>", "", "<table 2x2>", ""]);
    let para = p.id_map.iter().find(|(tmp, _)| *tmp == -5).unwrap().1;
    let second = p.id_map.iter().find(|(tmp, _)| *tmp == -6).unwrap().1;
    assert_eq!(h.doc().document().body[2].id(), para);
    assert_eq!(texts(&table_of(&h, second))[0], ["2,0x1", "2,1x1"]);
    // the rows keep their ids
    assert_eq!(
        err_code(
            &mut h,
            C::SplitTable {
                table: t,
                at: 0,
                new_ids: vec![]
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SplitTable {
                table: t,
                at: 2,
                new_ids: vec![]
            }
        ),
        "invalid_command"
    );
    // deleting the paragraph between them joins the tables
    apply(&mut h, C::MergeTables { paragraph: para });
    assert_eq!(body_texts(&h), ["a", "<table 4x2>", ""]);
    assert_eq!(texts(&table_of(&h, t))[3], ["3,0x1", "3,1x1"]);
    assert_eq!(
        err_code(
            &mut h,
            C::MergeTables {
                paragraph: NodeId(1)
            }
        ),
        "invalid_command"
    );
    let back = reopen(&h);
    assert_eq!(back.body[1].as_table().unwrap().rows.len(), 4);
}

#[test]
fn split_table_with_vertical_merge_across_the_cut() {
    let (mut h, t) = table_host(3, 2);
    merge(&mut h, t, 0, 1, 2, 1);
    apply(
        &mut h,
        C::SplitTable {
            table: t,
            at: 1,
            new_ids: vec![],
        },
    );
    let second = h.doc().document().body[3].id();
    let a = table_of(&h, t);
    let b = table_of(&h, second);
    a.check_grid().unwrap();
    b.check_grid().unwrap();
    assert_eq!(texts(&a), [["0,0x1", "0,1/1,1/2,1x1"]]);
    assert_eq!(texts(&b), [["1,0x1", "^x1"], ["2,0x1", "|x1"]]);
}

#[test]
fn join_tables_requires_an_empty_paragraph() {
    let (mut h, t) = table_host(2, 2);
    // a one-row piece is fine, a split at the edges is not
    assert_eq!(
        err_code(
            &mut h,
            C::SplitTable {
                table: t,
                at: 2,
                new_ids: vec![]
            }
        ),
        "invalid_command"
    );
    apply(
        &mut h,
        C::SplitTable {
            table: t,
            at: 1,
            new_ids: vec![],
        },
    );
    let para = h.doc().document().body[2].id();
    h.apply(C::InsertText {
        block: para,
        offset: 0,
        text: "x".into(),
        props: None,
        style: None,
        link: None,
    })
    .unwrap();
    assert_eq!(
        err_code(&mut h, C::MergeTables { paragraph: para }),
        "invalid_command"
    );
}

#[test]
fn convert_text_to_table_with_tabs_commas_and_paragraphs() {
    let mut h = host_paras(&["Name\tCity\tAge", "Ann\tGraz", "Bob\tWien\t42\textra"]);
    let mut doc = h.doc().document().clone();
    if let Block::Paragraph(p) = &mut doc.body[0] {
        p.inlines = vec![
            Inline::Run(Run {
                props: model_text::RunProperties {
                    bold: Some(true),
                    ..Default::default()
                },
                ..Run::new("Name\tCi")
            }),
            Inline::Run(Run::new("ty\tAge")),
        ];
    }
    h = host_with(doc);
    apply(
        &mut h,
        C::ConvertTextToTable {
            blocks: vec![NodeId(1), NodeId(2), NodeId(3)],
            separator: TextSeparator::Tab,
            cols: None,
        },
    );
    let t = h.doc().document().body[0].as_table().unwrap().clone();
    t.check_grid().unwrap();
    assert_eq!(
        texts(&t),
        [
            vec!["Namex1", "Cityx1", "Agex1", "x1"],
            vec!["Annx1", "Grazx1", "x1", "x1"],
            vec!["Bobx1", "Wienx1", "42x1", "extrax1"],
        ]
    );
    // the first cell keeps the paragraph's id and formatting
    let first = t.rows[0].cells[0].blocks[0].as_paragraph().unwrap();
    assert_eq!(first.id, NodeId(1));
    assert_eq!(first.inlines[0].as_run().unwrap().props.bold, Some(true));
    assert_eq!(t.props.style.as_deref(), Some("TableGrid"));
    // two columns: longer rows wrap
    let mut h = host_paras(&["a,b,c"]);
    apply(
        &mut h,
        C::ConvertTextToTable {
            blocks: vec![NodeId(1)],
            separator: TextSeparator::Comma,
            cols: Some(2),
        },
    );
    let t = h.doc().document().body[0].as_table().unwrap().clone();
    assert_eq!(texts(&t), [["ax1", "bx1"], ["cx1", "x1"]]);
    // paragraphs: one cell each
    let mut h = host_paras(&["one", "two", "three"]);
    apply(
        &mut h,
        C::ConvertTextToTable {
            blocks: vec![NodeId(1), NodeId(2), NodeId(3)],
            separator: TextSeparator::Paragraph,
            cols: Some(2),
        },
    );
    let t = h.doc().document().body[0].as_table().unwrap().clone();
    assert_eq!(texts(&t), [["onex1", "twox1"], ["threex1", "x1"]]);
    // another character
    let mut h = host_paras(&["x;y"]);
    apply(
        &mut h,
        C::ConvertTextToTable {
            blocks: vec![NodeId(1)],
            separator: TextSeparator::Other(";".into()),
            cols: None,
        },
    );
    assert_eq!(
        texts(h.doc().document().body[0].as_table().unwrap()),
        [["xx1", "yx1"]]
    );
    assert_eq!(
        err_code(
            &mut h,
            C::ConvertTextToTable {
                blocks: vec![NodeId(99)],
                separator: TextSeparator::Tab,
                cols: None,
            }
        ),
        "unknown_block"
    );
    let back = reopen(&h);
    assert!(back.body[0].as_table().is_some());
}

#[test]
fn convert_table_to_text() {
    let (mut h, t) = table_host(2, 3);
    merge(&mut h, t, 0, 2, 1, 2);
    apply(
        &mut h,
        C::ConvertTableToText {
            table: t,
            separator: TextSeparator::Tab,
        },
    );
    // a merged cell's text appears once (its second paragraph follows the row)
    assert_eq!(
        body_texts(&h),
        ["a", "0,0\t0,1\t0,2", "1,2", "1,0\t1,1\t", ""]
    );
    let (mut h, t) = table_host(2, 2);
    apply(
        &mut h,
        C::ConvertTableToText {
            table: t,
            separator: TextSeparator::Paragraph,
        },
    );
    assert_eq!(body_texts(&h), ["a", "0,0", "0,1", "1,0", "1,1", ""]);
    let (mut h, t) = table_host(1, 2);
    apply(
        &mut h,
        C::ConvertTableToText {
            table: t,
            separator: TextSeparator::Comma,
        },
    );
    assert_eq!(body_texts(&h), ["a", "0,0,0,1", ""]);
    assert_eq!(
        err_code(
            &mut h,
            C::ConvertTableToText {
                table: NodeId(1),
                separator: TextSeparator::Tab
            }
        ),
        "invalid_command"
    );
}

#[test]
fn convert_table_with_nested_table_and_round_trip_text_table_text() {
    let mut h = host_paras(&["p\tq", "r\ts"]);
    apply(
        &mut h,
        C::ConvertTextToTable {
            blocks: vec![NodeId(1), NodeId(2)],
            separator: TextSeparator::Tab,
            cols: None,
        },
    );
    let t = h.doc().document().body[0].id();
    // a nested table in the last cell
    let inner_cell = table_of(&h, t).rows[1].cells[1].id;
    let anchor = table_of(&h, t).rows[1].cells[1].blocks[0].id();
    apply(
        &mut h,
        C::InsertTable {
            after: Some(anchor),
            parent: Some(inner_cell),
            rows: 1,
            cols: 2,
            new_ids: vec![],
        },
    );
    apply(
        &mut h,
        C::ConvertTableToText {
            table: t,
            separator: TextSeparator::Tab,
        },
    );
    assert_eq!(body_texts(&h), ["p\tq", "r\ts", "\t", "", ""]);
}

#[test]
fn autofit_window_contents_and_fixed() {
    let (mut h, t) = table_host(2, 2);
    apply(
        &mut h,
        C::SetTableProps {
            table: t,
            patch: model_text::TableProperties {
                col_widths: vec![Twips(1000), Twips(3000)],
                ..Default::default()
            },
        },
    );
    apply(
        &mut h,
        C::AutoFitTable {
            table: t,
            mode: AutoFitMode::Window,
            col_widths: vec![],
        },
    );
    let tb = table_of(&h, t);
    let content = h.doc().document().page.content_width().0;
    assert_eq!(tb.props.width, Some(TableWidth::Pct(5000)));
    assert_eq!(tb.props.layout, Some(TableLayout::Autofit));
    assert_eq!(
        tb.props.col_widths.iter().map(|w| w.0).sum::<i32>(),
        content
    );
    assert_eq!(tb.props.col_widths[0].0 * 3, content / 4 * 3);
    apply(
        &mut h,
        C::AutoFitTable {
            table: t,
            mode: AutoFitMode::Contents,
            col_widths: vec![Twips(800), Twips(900)],
        },
    );
    let tb = table_of(&h, t);
    assert_eq!(tb.props.width, Some(TableWidth::Auto));
    assert_eq!(tb.props.col_widths, [Twips(800), Twips(900)]);
    apply(
        &mut h,
        C::AutoFitTable {
            table: t,
            mode: AutoFitMode::Fixed,
            col_widths: vec![],
        },
    );
    assert_eq!(table_of(&h, t).props.layout, Some(TableLayout::Fixed));
    let xml = document_xml(&h);
    assert!(xml.contains(r#"<w:tblLayout w:type="fixed"/>"#));
    assert!(xml.contains(r#"<w:tblW w:w="0" w:type="auto"/>"#), "{xml}");
    assert_eq!(
        err_code(
            &mut h,
            C::AutoFitTable {
                table: t,
                mode: AutoFitMode::Contents,
                col_widths: vec![Twips(1)],
            }
        ),
        "invalid_command"
    );
}

#[test]
fn table_wrap_around_and_none() {
    let (mut h, t) = table_host(2, 2);
    let pos = TablePosition {
        x_spec: Some(TablePosSpec::Center),
        ..TablePosition::word_around()
    };
    apply(
        &mut h,
        C::SetTableWrap {
            table: t,
            floating: Some(pos),
        },
    );
    assert_eq!(table_of(&h, t).props.floating, Some(pos));
    assert!(document_xml(&h).contains("<w:tblpPr "));
    assert_eq!(
        reopen(&h).body[1].as_table().unwrap().props.floating,
        Some(pos)
    );
    apply(
        &mut h,
        C::SetTableWrap {
            table: t,
            floating: None,
        },
    );
    assert_eq!(table_of(&h, t).props.floating, None);
    assert!(!document_xml(&h).contains("tblpPr"));
}

#[test]
fn special_characters_are_saved_as_word_elements() {
    let mut h = host_paras(&[""]);
    apply(
        &mut h,
        C::InsertText {
            block: NodeId(1),
            offset: 0,
            text: "\u{A9} a\u{A0}b non\u{2011}stop co\u{AD}operate \u{2014}\u{2013}\u{2026}".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    let xml = document_xml(&h);
    assert!(xml.contains("<w:noBreakHyphen/>"));
    assert!(xml.contains("<w:softHyphen/>"));
    assert!(xml.contains("a\u{A0}b"));
    let back = reopen(&h);
    assert_eq!(
        back.body[0].as_paragraph().unwrap().text(),
        "\u{A9} a\u{A0}b non\u{2011}stop co\u{AD}operate \u{2014}\u{2013}\u{2026}"
    );
}
