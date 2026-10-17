use app_common::Host;
use core_model::units::Emu;
use model_text::media::base64_encode;
use model_text::{
    Block, BreakKind, CellProperties, Document, Inline, InlineImage, LevelKind, NodeId,
    NumberingDef, NumberingRef, Orientation, Paragraph, ParagraphProperties, Run, RunProperties,
    Style, StyleKind, Twips,
};
use serde_json::{json, Value as Json};
use write_core::{
    dispatch_with, ListKind, NewBlock, NewParagraph, PageSetupPatch, WriteCommand as C,
    WriteDocument, WriteHost, WritePatch,
};

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];

fn bold() -> RunProperties {
    RunProperties {
        bold: Some(true),
        ..Default::default()
    }
}

fn italic() -> RunProperties {
    RunProperties {
        italic: Some(true),
        ..Default::default()
    }
}

/// A document whose body holds one paragraph per entry (ids 1, 2, …);
/// a `|` in the text starts a bold run.
fn doc_with(texts: &[&str]) -> Document {
    let mut doc = Document::new();
    doc.body.clear();
    let mut first = true;
    for t in texts {
        let id = if first {
            first = false;
            NodeId(1)
        } else {
            doc.alloc_id()
        };
        let mut p = Paragraph::new(id);
        let mut parts = t.splitn(2, '|');
        let plain = parts.next().unwrap_or_default();
        if !plain.is_empty() {
            p.inlines.push(Inline::Run(Run::new(plain)));
        }
        if let Some(b) = parts.next() {
            p.inlines.push(Inline::Run(Run::with_props(b, bold())));
        }
        doc.body.push(Block::Paragraph(p));
    }
    doc
}

fn host(texts: &[&str]) -> WriteHost {
    Host::new(WriteDocument::from_document(doc_with(texts)).unwrap())
}

fn json_of(h: &WriteHost) -> Json {
    serde_json::to_value(h.doc().document()).unwrap()
}

fn para(h: &WriteHost, id: u64) -> &Paragraph {
    h.doc().document().find_paragraph(NodeId(id)).unwrap()
}

fn text(h: &WriteHost, id: u64) -> String {
    para(h, id).text()
}

fn body_ids(h: &WriteHost) -> Vec<u64> {
    h.doc().document().body.iter().map(|b| b.id().0).collect()
}

/// Applies `cmd`, checks undo → before, redo → after, and leaves the
/// command applied. Returns the patch of the first application.
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

fn id(n: u64) -> NodeId {
    NodeId(n)
}

fn new_para(id: i64, text: &str) -> NewBlock {
    NewBlock::Paragraph(NewParagraph {
        id,
        props: ParagraphProperties::default(),
        inlines: if text.is_empty() {
            vec![]
        } else {
            vec![Inline::Run(Run::new(text))]
        },
    })
}

fn image_para(h: &mut WriteHost) {
    // "aé" [image] "😀b" [line break] "c"
    apply(
        h,
        C::InsertImage {
            block: id(1),
            offset: 2,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(PNG),
            width: Emu(9525),
            height: Emu(9525),
            alt: Some("dot".into()),
        },
    );
    apply(
        h,
        C::RestoreInlines {
            block: id(1),
            from: 5,
            to: 5,
            inlines: vec![Inline::Break(BreakKind::Line), Inline::Run(Run::new("c"))],
        },
    );
}

#[test]
fn insert_text_counts_scalars_and_atoms() {
    let mut h = host(&["aé😀b"]);
    image_para(&mut h);
    assert_eq!(text(&h, 1), "aé\u{FFFC}😀b\u{000B}c");
    assert_eq!(para(&h, 1).len(), 7);
    apply(
        &mut h,
        C::InsertText {
            block: id(1),
            offset: 4,
            text: "ñ".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    apply(
        &mut h,
        C::InsertText {
            block: id(1),
            offset: 8,
            text: "Z".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    assert_eq!(text(&h, 1), "aé\u{FFFC}😀ñb\u{000B}cZ");
    let p = apply(
        &mut h,
        C::DeleteText {
            block: id(1),
            from: 1,
            to: 4,
        },
    );
    assert_eq!(text(&h, 1), "añb\u{000B}cZ");
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.replaced[0].id(), id(1));
    assert!(p.inserted.is_empty() && p.deleted.is_empty());
    assert_eq!(
        err_code(
            &mut h,
            C::InsertText {
                block: id(1),
                offset: 8,
                text: "x".into(),
                props: None,
                style: None,
                link: None,
            }
        ),
        "bad_offset"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::DeleteText {
                block: id(1),
                from: 3,
                to: 2
            }
        ),
        "bad_offset"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::DeleteText {
                block: id(99),
                from: 0,
                to: 0
            }
        ),
        "unknown_block"
    );
}

#[test]
fn insert_text_inherits_formatting() {
    let mut h = host(&["ab|cd"]);
    for (offset, t) in [(4, "X"), (2, "Y"), (0, "W")] {
        apply(
            &mut h,
            C::InsertText {
                block: id(1),
                offset,
                text: t.into(),
                props: None,
                style: None,
                link: None,
            },
        );
    }
    // "Wab" + "Y" plain (inherits 'b'), "cXd" bold → runs merge.
    let runs: Vec<(String, bool)> = para(&h, 1)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .map(|r| (r.text.clone(), r.props.bold == Some(true)))
        .collect();
    assert_eq!(runs, [("WabY".to_owned(), false), ("cdX".to_owned(), true)]);
    apply(
        &mut h,
        C::InsertText {
            block: id(1),
            offset: 0,
            text: "I".into(),
            props: Some(italic()),
            style: None,
            link: None,
        },
    );
    assert_eq!(
        para(&h, 1).inlines[0],
        Inline::Run(Run::with_props("I", italic()))
    );
}

#[test]
fn replace_text_keeps_first_char_props() {
    let mut h = host(&["ab|cd"]);
    apply(
        &mut h,
        C::ReplaceText {
            block: id(1),
            from: 2,
            to: 4,
            text: "ZZZ".into(),
        },
    );
    assert_eq!(
        para(&h, 1).inlines,
        vec![
            Inline::Run(Run::new("ab")),
            Inline::Run(Run::with_props("ZZZ", bold())),
        ]
    );
}

#[test]
fn set_run_props_splits_runs_and_clears_toggles() {
    let mut h = host(&["héllo wörld"]);
    apply(
        &mut h,
        C::SetRunProps {
            block: id(1),
            from: 1,
            to: 4,
            patch: bold(),
        },
    );
    assert_eq!(
        para(&h, 1).inlines,
        vec![
            Inline::Run(Run::new("h")),
            Inline::Run(Run::with_props("éll", bold())),
            Inline::Run(Run::new("o wörld")),
        ]
    );
    // Unbolding where the style is not bold removes the direct value…
    let off = RunProperties {
        bold: Some(false),
        ..Default::default()
    };
    apply(
        &mut h,
        C::SetRunProps {
            block: id(1),
            from: 0,
            to: 11,
            patch: off.clone(),
        },
    );
    assert_eq!(
        para(&h, 1).inlines,
        vec![Inline::Run(Run::new("héllo wörld"))]
    );
    // …but stays explicit under a bold style.
    let mut doc = doc_with(&["x"]);
    let mut strong = doc.styles.get("Heading1").unwrap().clone();
    strong.id = "Strong".into();
    strong.name = "Strong".into();
    strong.run.bold = Some(true);
    doc.styles.insert(strong);
    let mut h = Host::new(WriteDocument::from_document(doc).unwrap());
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(1)],
            style: "Strong".into(),
        },
    );
    apply(
        &mut h,
        C::SetRunProps {
            block: id(1),
            from: 0,
            to: 1,
            patch: off.clone(),
        },
    );
    assert_eq!(
        para(&h, 1).inlines,
        vec![Inline::Run(Run::with_props("x", off))]
    );
}

#[test]
fn split_and_join() {
    let mut h = host(&["Title text", "body"]);
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(1)],
            style: "Heading1".into(),
        },
    );
    let p = apply(
        &mut h,
        C::SplitParagraph {
            block: id(1),
            offset: 5,
            new_id: -1,
        },
    );
    let new = p.id_map[0].1;
    assert_eq!(p.id_map, vec![(-1, new)]);
    assert_eq!(body_ids(&h), vec![1, new.0, 2]);
    assert_eq!(text(&h, 1), "Title");
    assert_eq!(text(&h, new.0), " text");
    assert_eq!(
        para(&h, 1).props.style.as_deref(),
        Some("Heading1"),
        "the first half keeps the heading"
    );
    assert_eq!(
        para(&h, new.0).props.style,
        None,
        "the new paragraph is Normal"
    );
    insta::assert_json_snapshot!("split_heading_patch", p);
    // Split at the start and at the end: empty paragraphs.
    let p0 = apply(
        &mut h,
        C::SplitParagraph {
            block: id(2),
            offset: 0,
            new_id: -2,
        },
    );
    let p1 = apply(
        &mut h,
        C::SplitParagraph {
            block: id(2),
            offset: 0,
            new_id: -3,
        },
    );
    let (a, b) = (p0.id_map[0].1, p1.id_map[0].1);
    assert_eq!(text(&h, 2), "");
    assert_eq!(text(&h, b.0), "");
    assert_eq!(text(&h, a.0), "body");
    // Join back.
    let pj = apply(&mut h, C::JoinWithPrevious { block: a });
    assert_eq!(pj.deleted, vec![a]);
    assert_eq!(text(&h, b.0), "body");
    insta::assert_json_snapshot!("join_patch", pj);
    assert_eq!(
        err_code(&mut h, C::JoinWithPrevious { block: id(1) }),
        "invalid_command"
    );
}

#[test]
fn lists_reuse_adjacent_definitions() {
    let mut h = host(&["a", "b", "c", "d", "e"]);
    let p = apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1), id(2)],
            kind: ListKind::Bullet,
        },
    );
    let num = |h: &WriteHost, n: u64| para(h, n).props.numbering;
    let first = num(&h, 1).unwrap();
    assert_eq!(first.level, 0);
    assert_eq!(num(&h, 2), Some(first));
    let defs = p.numbering.unwrap();
    assert_eq!(defs.defs.len(), 1);
    assert_eq!(defs.defs[0].levels[0].kind, LevelKind::Bullet);
    // Adjacent bullet list → same numId, no new definition.
    let p = apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(3)],
            kind: ListKind::Bullet,
        },
    );
    assert!(p.numbering.is_none());
    assert_eq!(num(&h, 3), Some(first));
    // A numbered list after it does not reuse the bullet definition.
    let p = apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(4)],
            kind: ListKind::Decimal,
        },
    );
    let decimal = num(&h, 4).unwrap();
    assert_ne!(decimal.num_id, first.num_id);
    assert_eq!(p.numbering.unwrap().defs.len(), 2);
    // The next paragraph reuses its successor's definition.
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(5)],
            kind: ListKind::Decimal,
        },
    );
    assert_eq!(num(&h, 5), Some(decimal));
    // Indent with bounds.
    for _ in 0..10 {
        apply(
            &mut h,
            C::IndentList {
                blocks: vec![id(1), id(2)],
                delta: 1,
            },
        );
    }
    assert_eq!(num(&h, 1).unwrap().level, 8);
    apply(
        &mut h,
        C::IndentList {
            blocks: vec![id(1)],
            delta: -3,
        },
    );
    assert_eq!(num(&h, 1).unwrap().level, 5);
    apply(
        &mut h,
        C::IndentList {
            blocks: vec![id(2)],
            delta: -100,
        },
    );
    assert_eq!(num(&h, 2).unwrap().level, 0);
    // Removing.
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1), id(2), id(3)],
            kind: ListKind::None,
        },
    );
    assert_eq!(num(&h, 1), None);
    // IndentList ignores paragraphs without numbering.
    let before = json_of(&h);
    h.apply(C::IndentList {
        blocks: vec![id(1)],
        delta: 1,
    })
    .unwrap();
    assert_eq!(json_of(&h), before);
}

#[test]
fn list_none_overrides_style_numbering() {
    let mut doc = doc_with(&["a"]);
    doc.numbering.insert(NumberingDef::bullet_default(4));
    doc.styles.insert(Style {
        id: "ListBullet".into(),
        name: "List Bullet".into(),
        kind: StyleKind::Paragraph,
        based_on: Some("Normal".into()),
        next: None,
        paragraph: ParagraphProperties {
            numbering: Some(NumberingRef {
                num_id: 4,
                level: 0,
            }),
            ..Default::default()
        },
        run: RunProperties::default(),
        is_default: false,
        table: None,
        ..Style::new("", "", StyleKind::Paragraph)
    });
    if let Block::Paragraph(p) = &mut doc.body[0] {
        p.props.style = Some("ListBullet".into());
    }
    let mut h = Host::new(WriteDocument::from_document(doc).unwrap());
    apply(
        &mut h,
        C::IndentList {
            blocks: vec![id(1)],
            delta: 2,
        },
    );
    assert_eq!(
        para(&h, 1).props.numbering,
        Some(NumberingRef {
            num_id: 4,
            level: 2
        })
    );
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1)],
            kind: ListKind::None,
        },
    );
    assert_eq!(
        para(&h, 1).props.numbering,
        Some(NumberingRef {
            num_id: 0,
            level: 0
        })
    );
}

#[test]
fn styles_and_paragraph_props() {
    let mut h = host(&["a", "b"]);
    assert_eq!(
        err_code(
            &mut h,
            C::SetStyle {
                blocks: vec![id(1)],
                style: "Nope".into()
            }
        ),
        "unknown_style"
    );
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(1), id(2)],
            style: "Title".into(),
        },
    );
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(2)],
            style: "Normal".into(),
        },
    );
    assert_eq!(para(&h, 1).props.style.as_deref(), Some("Title"));
    assert_eq!(para(&h, 2).props.style, None);
    let patch = ParagraphProperties {
        alignment: Some(model_text::Alignment::Center),
        ..Default::default()
    };
    let p = apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![id(1), id(2)],
            patch,
        },
    );
    assert_eq!(p.replaced.len(), 2);
    assert_eq!(
        para(&h, 2).props.alignment,
        Some(model_text::Alignment::Center)
    );
}

#[test]
fn block_insert_delete_replace() {
    let mut h = host(&["a", "b", "c"]);
    let p = apply(
        &mut h,
        C::InsertBlocks {
            after: Some(id(1)),
            parent: None,
            blocks: vec![new_para(-1, "x"), new_para(-2, "y")],
        },
    );
    let (x, y) = (p.id_map[0].1, p.id_map[1].1);
    assert_eq!(body_ids(&h), vec![1, x.0, y.0, 2, 3]);
    assert_eq!(p.inserted.len(), 2);
    assert_eq!(p.inserted[0].after, Some(id(1)));
    assert_eq!(p.inserted[1].after, Some(x));
    let p = apply(
        &mut h,
        C::ReplaceBlocks {
            ids: vec![x, y],
            blocks: vec![new_para(x.0 as i64, "x2"), new_para(-5, "z")],
        },
    );
    let z = p.id_map[0].1;
    assert_eq!(p.id_map, vec![(-5, z)]);
    assert_eq!(body_ids(&h), vec![1, x.0, z.0, 2, 3]);
    assert_eq!(text(&h, x.0), "x2");
    insta::assert_json_snapshot!("replace_blocks_patch", p);
    assert_eq!(
        err_code(
            &mut h,
            C::ReplaceBlocks {
                ids: vec![id(1), z],
                blocks: vec![new_para(-1, "")]
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::ReplaceBlocks {
                ids: vec![id(2)],
                blocks: vec![new_para(3, "dup")]
            }
        ),
        "invalid_command"
    );
    let p = apply(
        &mut h,
        C::DeleteBlocks {
            ids: vec![x, id(3)],
        },
    );
    assert_eq!(p.deleted, vec![x, id(3)]);
    assert_eq!(body_ids(&h), vec![1, z.0, 2]);
    // Deleting everything leaves one empty paragraph.
    let p = apply(
        &mut h,
        C::DeleteBlocks {
            ids: vec![id(1), z, id(2)],
        },
    );
    assert_eq!(h.doc().document().body.len(), 1);
    assert_eq!(p.inserted.len(), 1);
    assert_eq!(p.deleted.len(), 3);
    assert_eq!(h.doc().document().plain_text(), "");
}

#[test]
fn tables_stay_rectangular() {
    let mut h = host(&["a"]);
    let mut ids: Vec<i64> = (1..=1 + 2 + 6).map(|n| -n).collect();
    ids.extend((100..106).map(|n| -n));
    let p = apply(
        &mut h,
        C::InsertTable {
            after: Some(id(1)),
            parent: None,
            rows: 2,
            cols: 3,
            new_ids: ids,
        },
    );
    assert_eq!(p.id_map.len(), 15);
    let table = p.id_map[0].1;
    // A trailing paragraph is added after a table at the end of the body.
    assert_eq!(body_ids(&h).len(), 3);
    assert_eq!(p.inserted.len(), 2);
    insta::assert_json_snapshot!("insert_table_patch", p);
    let shape = |h: &WriteHost| -> (usize, Vec<usize>, usize) {
        let t = h
            .doc()
            .document()
            .find_block(table)
            .unwrap()
            .as_table()
            .unwrap();
        (
            t.rows.len(),
            t.rows.iter().map(|r| r.cells.len()).collect(),
            t.props.col_widths.len(),
        )
    };
    assert_eq!(shape(&h), (2, vec![3, 3], 3));
    let p = apply(
        &mut h,
        C::InsertTableRow {
            table,
            at: 2,
            new_ids: vec![-1, -2, -3, -4],
        },
    );
    assert_eq!(p.id_map.len(), 4);
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(shape(&h), (3, vec![3, 3, 3], 3));
    apply(
        &mut h,
        C::InsertTableCol {
            table,
            at: 0,
            new_ids: vec![],
        },
    );
    assert_eq!(shape(&h), (3, vec![4, 4, 4], 4));
    apply(&mut h, C::DeleteTableCol { table, at: 3 });
    apply(&mut h, C::DeleteTableRow { table, at: 0 });
    assert_eq!(shape(&h), (2, vec![3, 3], 3));
    assert_eq!(
        err_code(&mut h, C::DeleteTableRow { table, at: 5 }),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::InsertTableRow {
                table,
                at: 0,
                new_ids: vec![-1]
            }
        ),
        "invalid_command"
    );
    apply(&mut h, C::DeleteTableRow { table, at: 0 });
    assert_eq!(
        err_code(&mut h, C::DeleteTableRow { table, at: 0 }),
        "invalid_command"
    );
    // Editing a paragraph inside a cell reports just that paragraph;
    // cell properties report the table.
    let t = h
        .doc()
        .document()
        .find_block(table)
        .unwrap()
        .as_table()
        .unwrap()
        .clone();
    let cell = &t.rows[0].cells[1];
    let cp = cell.blocks[0].id();
    let p = apply(
        &mut h,
        C::InsertText {
            block: cp,
            offset: 0,
            text: "in cell".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.replaced[0].id(), cp);
    let p = apply(
        &mut h,
        C::SetCellProps {
            cells: vec![cell.id],
            patch: CellProperties {
                shading: Some(core_model::Color::Rgb(core_model::Rgb::new(255, 0, 0))),
                ..Default::default()
            },
        },
    );
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.replaced[0].id(), table);
    // Splitting inside a cell sends the table.
    let p = apply(
        &mut h,
        C::SplitParagraph {
            block: cp,
            offset: 2,
            new_id: -9,
        },
    );
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.replaced[0].id(), table);
    assert!(p.inserted.is_empty());
    // Deleting the only paragraph of a cell keeps an empty one.
    let first_cell = t.rows[0].cells[0].clone();
    apply(
        &mut h,
        C::DeleteBlocks {
            ids: vec![first_cell.blocks[0].id()],
        },
    );
    let t2 = h
        .doc()
        .document()
        .find_block(table)
        .unwrap()
        .as_table()
        .unwrap();
    assert_eq!(t2.rows[0].cells[0].blocks.len(), 1);
    // A nested table in a cell.
    let p = apply(
        &mut h,
        C::InsertTable {
            after: None,
            parent: Some(first_cell.id),
            rows: 1,
            cols: 1,
            new_ids: vec![],
        },
    );
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.replaced[0].id(), table);
    apply(
        &mut h,
        C::SetTableProps {
            table,
            patch: model_text::TableProperties {
                col_widths: vec![Twips(1000), Twips(2000), Twips(3000)],
                ..Default::default()
            },
        },
    );
}

#[test]
fn find_replace_across_runs() {
    let mut h = host(&["The ca|t sat", "cat Cat concat", "category CAT"]);
    let p = apply(
        &mut h,
        C::FindReplace {
            find: "cat".into(),
            replace: "dog".into(),
            match_case: false,
            whole_word: true,
            all: true,
            wildcards: false,
            format: None,
            replace_format: None,
        },
    );
    assert_eq!(p.info.as_deref(), Some("4 replacements"));
    assert_eq!(text(&h, 1), "The dog sat");
    assert_eq!(text(&h, 2), "dog dog concat");
    assert_eq!(text(&h, 3), "category dog");
    // The match spanning "ca" + bold "t" takes the first char's (plain) props.
    assert_eq!(
        para(&h, 1).inlines,
        vec![
            Inline::Run(Run::new("The dog")),
            Inline::Run(Run::with_props(" sat", bold())),
        ]
    );
    let p = apply(
        &mut h,
        C::FindReplace {
            find: "dog".into(),
            replace: "".into(),
            match_case: true,
            whole_word: false,
            all: false,
            wildcards: false,
            format: None,
            replace_format: None,
        },
    );
    assert_eq!(p.info.as_deref(), Some("1 replacement"));
    assert_eq!(text(&h, 1), "The  sat");
    let p = apply(
        &mut h,
        C::FindReplace {
            find: "CAT".into(),
            replace: "x".into(),
            match_case: true,
            whole_word: false,
            all: true,
            wildcards: false,
            format: None,
            replace_format: None,
        },
    );
    assert_eq!(p.info.as_deref(), Some("0 replacements"));
    assert_eq!(
        err_code(
            &mut h,
            C::FindReplace {
                find: "".into(),
                replace: "x".into(),
                match_case: true,
                whole_word: false,
                all: true,
                wildcards: false,
                format: None,
                replace_format: None,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn images_and_media_undo() {
    let mut h = host(&["ab"]);
    let p = h
        .apply(C::InsertImage {
            block: id(1),
            offset: 1,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(PNG),
            width: Emu(100),
            height: Emu(200),
            alt: None,
        })
        .unwrap()
        .patch;
    let Inline::Image(InlineImage { media, .. }) = &para(&h, 1).inlines[1] else {
        panic!("no image: {:?}", p.replaced);
    };
    let media = *media;
    assert_eq!(h.doc().document().media.len(), 1);
    h.undo().unwrap();
    assert_eq!(h.doc().document().media.len(), 0);
    h.redo().unwrap();
    assert_eq!(h.doc().document().media.get(media).unwrap().data, PNG);
    let reply: Json = serde_json::from_str(&dispatch_with(
        &mut h,
        &json!({"type": "getMedia", "id": media.0}).to_string(),
    ))
    .unwrap();
    assert_eq!(reply["ok"]["contentType"], "image/png");
    assert_eq!(reply["ok"]["bytesBase64"], base64_encode(PNG));
    assert_eq!(
        err_code(
            &mut h,
            C::InsertImage {
                block: id(1),
                offset: 0,
                content_type: "image/png".into(),
                bytes_base64: "!!".into(),
                width: Emu(1),
                height: Emu(1),
                alt: None
            }
        ),
        "bad_request"
    );
}

#[test]
fn page_setup() {
    let mut h = host(&["a"]);
    let p = apply(
        &mut h,
        C::SetPage {
            patch: PageSetupPatch {
                orientation: Some(Orientation::Landscape),
                margins: Some(write_core::MarginsPatch {
                    left: Some(Twips(720)),
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
    );
    let page = p.page.unwrap();
    assert_eq!(page.width, Twips(16838));
    assert_eq!(page.margins.left, Twips(720));
    assert_eq!(
        err_code(
            &mut h,
            C::SetPage {
                patch: PageSetupPatch {
                    width: Some(Twips(100)),
                    ..Default::default()
                }
            }
        ),
        "invalid_command"
    );
}

#[test]
fn compound_is_atomic() {
    let mut h = host(&["abc"]);
    let ok = C::InsertText {
        block: id(1),
        offset: 3,
        text: "d".into(),
        props: None,
        style: None,
        link: None,
    };
    let bad = C::DeleteText {
        block: id(1),
        from: 0,
        to: 10,
    };
    assert_eq!(
        err_code(
            &mut h,
            C::Compound {
                commands: vec![ok.clone(), ok.clone(), bad]
            }
        ),
        "bad_offset"
    );
    let p = apply(
        &mut h,
        C::Compound {
            commands: vec![
                ok,
                C::SplitParagraph {
                    block: id(1),
                    offset: 2,
                    new_id: -1,
                },
                C::InsertText {
                    block: id(1),
                    offset: 2,
                    text: "!".into(),
                    props: None,
                    style: None,
                    link: None,
                },
            ],
        },
    );
    assert_eq!(text(&h, 1), "ab!");
    assert_eq!(text(&h, p.id_map[0].1 .0), "cd");
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.inserted.len(), 1);
}

/// A scripted session over every command kind: each step undoes and
/// redoes exactly; at the end, undoing everything restores the start and
/// redoing everything the end.
#[test]
fn scripted_session_undo_redo() {
    let mut h = host(&["Heading here", "Some text with cat|bold", "third"]);
    let start = json_of(&h);
    let script = vec![
        C::SetStyle {
            blocks: vec![id(1)],
            style: "Heading1".into(),
        },
        C::InsertText {
            block: id(2),
            offset: 4,
            text: "é😀".into(),
            props: None,
            style: None,
            link: None,
        },
        C::SetRunProps {
            block: id(2),
            from: 2,
            to: 12,
            patch: italic(),
        },
        C::SplitParagraph {
            block: id(1),
            offset: 7,
            new_id: -1,
        },
        C::ApplyList {
            blocks: vec![id(2), id(3)],
            kind: ListKind::Decimal,
        },
        C::IndentList {
            blocks: vec![id(3)],
            delta: 1,
        },
        C::InsertImage {
            block: id(3),
            offset: 2,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(PNG),
            width: Emu(500),
            height: Emu(500),
            alt: None,
        },
        C::InsertTable {
            after: Some(id(3)),
            parent: None,
            rows: 2,
            cols: 2,
            new_ids: vec![],
        },
        C::FindReplace {
            find: "e".into(),
            replace: "E".into(),
            match_case: true,
            whole_word: false,
            all: true,
            wildcards: false,
            format: None,
            replace_format: None,
        },
        C::JoinWithPrevious { block: id(3) },
        C::DeleteText {
            block: id(2),
            from: 0,
            to: 3,
        },
        C::ReplaceBlocks {
            ids: vec![id(1)],
            blocks: vec![new_para(-7, "replaced"), new_para(1, "kept id")],
        },
        C::SetPage {
            patch: PageSetupPatch {
                orientation: Some(Orientation::Landscape),
                ..Default::default()
            },
        },
        C::DeleteBlocks { ids: vec![id(2)] },
    ];
    let n = script.len();
    for cmd in script {
        apply(&mut h, cmd);
    }
    let end = json_of(&h);
    for _ in 0..n {
        h.undo().unwrap().unwrap();
    }
    assert_eq!(json_of(&h), start);
    assert!(!h.is_dirty());
    for _ in 0..n {
        h.redo().unwrap().unwrap();
    }
    assert_eq!(json_of(&h), end);
}

#[test]
fn dispatch_roundtrip() {
    let mut h = WriteHost::new(WriteDocument::new());
    let call = |h: &mut WriteHost, req: Json| -> Json {
        serde_json::from_str(&dispatch_with(h, &req.to_string())).unwrap()
    };
    // Load a document JSON (ids kept) and read it back.
    let doc = doc_with(&["one", "two|bold"]);
    let r = call(&mut h, json!({"type": "load", "document": doc}));
    assert_eq!(r["ok"]["type"], "document");
    assert_eq!(r["ok"]["envelope"]["revision"], 1);
    assert_eq!(r["ok"]["doc"], serde_json::to_value(&doc).unwrap());
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "insertText", "block": 2, "offset": 3, "text": "!"}}),
    );
    let env = &r["ok"]["envelope"];
    assert_eq!(r["ok"]["type"], "patch");
    assert_eq!(env["revision"], 2);
    assert_eq!(env["canUndo"], true);
    assert_eq!(env["dirty"], true);
    assert_eq!(env["patch"]["replaced"][0]["value"]["id"], 2);
    assert_eq!(env["patch"]["idMap"], json!([]));
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "splitParagraph", "block": 2, "offset": 1, "newId": -4}}),
    );
    assert_eq!(r["ok"]["envelope"]["patch"]["idMap"], json!([[-4, 3]]));
    let r = call(&mut h, json!({"type": "undo"}));
    // Undo replaces [2, 3] by the old 2: 2 is removed and re-inserted.
    let patch = &r["ok"]["envelope"]["patch"];
    assert_eq!(patch["deleted"], json!([2, 3]));
    assert_eq!(patch["inserted"][0]["after"], 1);
    assert_eq!(patch["inserted"][0]["block"]["value"]["id"], 2);
    // Errors.
    let r = call(
        &mut h,
        json!({"type": "apply", "command": {"type": "deleteText", "block": 77, "from": 0, "to": 1}}),
    );
    assert_eq!(r["err"]["code"], "unknown_block");
    let r = call(&mut h, json!({"type": "nope"}));
    assert_eq!(r["err"]["code"], "bad_request");
    let mut dup = doc_with(&["a", "b"]);
    if let Block::Paragraph(p) = &mut dup.body[1] {
        p.id = NodeId(1);
    }
    let r = call(&mut h, json!({"type": "load", "document": dup}));
    assert_eq!(r["err"]["code"], "invalid_document");
    // State and saving.
    let r = call(&mut h, json!({"type": "markSaved", "name": "a.docx"}));
    assert_eq!(r["ok"]["type"], "documentState");
    assert_eq!(r["ok"]["dirty"], false);
    assert_eq!(r["ok"]["name"], "a.docx");
    let r = call(&mut h, json!({"type": "redo"}));
    assert_eq!(r["ok"]["envelope"]["dirty"], true);
    let r = call(&mut h, json!({"type": "redo"}));
    assert_eq!(r["ok"]["envelope"]["patch"]["replaced"], json!([]));
    let r = call(&mut h, json!({"type": "getDocument"}));
    assert_eq!(r["ok"]["doc"]["body"].as_array().unwrap().len(), 3);
    let r = call(&mut h, json!({"type": "newDocument"}));
    assert_eq!(r["ok"]["envelope"]["canUndo"], false);
    assert_eq!(r["ok"]["doc"]["body"].as_array().unwrap().len(), 1);
    let r = call(&mut h, json!({"type": "documentState"}));
    assert_eq!(r["ok"]["dirty"], false);
    let r = call(&mut h, json!({"type": "getMedia", "id": 9}));
    assert_eq!(r["err"]["code"], "unknown_media");
}

#[test]
fn request_types_roundtrip_through_json() {
    use write_core::Request;
    let cmds = vec![
        C::InsertBlocks {
            after: None,
            parent: Some(id(4)),
            blocks: vec![new_para(-1, "x")],
        },
        C::ApplyList {
            blocks: vec![id(1)],
            kind: ListKind::Bullet,
        },
        C::SetPage {
            patch: PageSetupPatch::default(),
        },
    ];
    for c in cmds {
        let req = Request::Apply {
            command: Box::new(c),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(serde_json::from_str::<Request>(&json).unwrap(), req);
    }
    // NewBlock has the JSON shape of Block.
    let block = Block::Paragraph(Paragraph::with_text(id(5), "hi"));
    let nb = NewBlock::from(&block);
    assert_eq!(
        serde_json::to_value(&nb).unwrap(),
        serde_json::to_value(&block).unwrap()
    );
}

// ----- P6-4: editing ergonomics ---------------------------------------------------

fn image_at(h: &WriteHost, block: u64, at: usize) -> InlineImage {
    let p = para(h, block);
    let mut pos = 0;
    for i in &p.inlines {
        let len = match i {
            Inline::Run(r) => r.text.chars().count(),
            _ => 1,
        };
        if pos == at {
            if let Inline::Image(img) = i {
                return img.clone();
            }
        }
        pos += len;
    }
    panic!("no image at {at}")
}

#[test]
fn set_image_size_and_alt() {
    let mut h = host(&["aé😀b"]);
    image_para(&mut h);
    let p = apply(
        &mut h,
        C::SetImageSize {
            block: id(1),
            offset: 2,
            width: Emu(190_500),
            height: Emu(95_250),
        },
    );
    assert_eq!(p.replaced.len(), 1);
    let img = image_at(&h, 1, 2);
    assert_eq!((img.width, img.height), (Emu(190_500), Emu(95_250)));
    assert_eq!(img.alt.as_deref(), Some("dot"));
    assert_eq!(text(&h, 1), "aé\u{FFFC}😀b\u{000B}c");
    apply(
        &mut h,
        C::SetImageAlt {
            block: id(1),
            offset: 2,
            alt: Some("A red dot".into()),
            decorative: None,
        },
    );
    assert_eq!(image_at(&h, 1, 2).alt.as_deref(), Some("A red dot"));
    apply(
        &mut h,
        C::SetImageAlt {
            block: id(1),
            offset: 2,
            alt: Some(String::new()),
            decorative: Some(true),
        },
    );
    assert_eq!(image_at(&h, 1, 2).alt, None);
    // P9-W4: Mark as decorative.
    assert!(image_at(&h, 1, 2).decorative);
}

#[test]
fn set_image_size_rejects_text_and_bad_sizes() {
    let mut h = host(&["aé😀b"]);
    image_para(&mut h);
    let size = |offset, w| C::SetImageSize {
        block: id(1),
        offset,
        width: Emu(w),
        height: Emu(10),
    };
    assert_eq!(err_code(&mut h, size(1, 10)), "invalid_command");
    assert_eq!(err_code(&mut h, size(2, 0)), "invalid_command");
    assert_eq!(err_code(&mut h, size(7, 10)), "invalid_command");
    assert_eq!(err_code(&mut h, size(9, 10)), "bad_offset");
}

fn table_host() -> (WriteHost, NodeId) {
    let mut h = host(&["a"]);
    apply(
        &mut h,
        C::InsertTable {
            after: Some(id(1)),
            parent: None,
            rows: 2,
            cols: 2,
            new_ids: vec![],
        },
    );
    let table = h.doc().document().body[1].id();
    (h, table)
}

fn table_of(h: &WriteHost, t: NodeId) -> model_text::Table {
    h.doc()
        .document()
        .find_block(t)
        .unwrap()
        .as_table()
        .unwrap()
        .clone()
}

#[test]
fn set_row_props_header_and_height() {
    let (mut h, t) = table_host();
    let p = apply(
        &mut h,
        C::SetRowProps {
            table: t,
            rows: vec![0],
            header: Some(true),
            height: Some(model_text::RowHeight {
                value: Twips(720),
                rule: model_text::HeightRule::AtLeast,
            }),
            cant_split: None,
        },
    );
    assert_eq!(p.replaced.len(), 1);
    let tb = table_of(&h, t);
    assert!(tb.rows[0].props.header);
    assert_eq!(tb.rows[0].props.height.unwrap().value, Twips(720));
    assert!(!tb.rows[1].props.header);
    // A zero height means automatic; header untouched.
    apply(
        &mut h,
        C::SetRowProps {
            table: t,
            rows: vec![0, 1],
            header: None,
            height: Some(model_text::RowHeight {
                value: Twips(0),
                rule: model_text::HeightRule::Exact,
            }),
            cant_split: None,
        },
    );
    let tb = table_of(&h, t);
    assert_eq!(tb.rows[0].props.height, None);
    assert!(tb.rows[0].props.header);
    assert_eq!(
        err_code(
            &mut h,
            C::SetRowProps {
                table: t,
                rows: vec![5],
                header: Some(false),
                height: None,
                cant_split: None,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn row_and_column_ops_like_word() {
    let (mut h, t) = table_host();
    // Insert above row 0, below row 0, left of column 0, right of column 1.
    apply(
        &mut h,
        C::InsertTableRow {
            table: t,
            at: 0,
            new_ids: vec![],
        },
    );
    apply(
        &mut h,
        C::InsertTableRow {
            table: t,
            at: 1,
            new_ids: vec![],
        },
    );
    apply(
        &mut h,
        C::InsertTableCol {
            table: t,
            at: 0,
            new_ids: vec![],
        },
    );
    apply(
        &mut h,
        C::InsertTableCol {
            table: t,
            at: 3,
            new_ids: vec![],
        },
    );
    let tb = table_of(&h, t);
    assert_eq!(tb.rows.len(), 4);
    assert!(tb.rows.iter().all(|r| r.cells.len() == 4));
    assert_eq!(tb.props.col_widths.len(), 4);
    // Delete the whole table.
    let p = apply(&mut h, C::DeleteBlocks { ids: vec![t] });
    assert_eq!(p.deleted, vec![t]);
    assert!(h.doc().document().find_block(t).is_none());
}

#[test]
fn column_widths_resize() {
    let (mut h, t) = table_host();
    apply(
        &mut h,
        C::SetTableProps {
            table: t,
            patch: model_text::TableProperties {
                col_widths: vec![Twips(3000), Twips(6026)],
                ..Default::default()
            },
        },
    );
    assert_eq!(
        table_of(&h, t).props.col_widths,
        vec![Twips(3000), Twips(6026)]
    );
}

#[test]
fn cell_shading_auto_removes_the_fill() {
    let (mut h, t) = table_host();
    let cell = table_of(&h, t).rows[0].cells[0].id;
    let fill = CellProperties {
        shading: Some(core_model::Color::Rgb(core_model::Rgb::new(255, 255, 0))),
        ..Default::default()
    };
    apply(
        &mut h,
        C::SetCellProps {
            cells: vec![cell],
            patch: fill,
        },
    );
    assert!(table_of(&h, t).rows[0].cells[0].props.shading.is_some());
    let none = CellProperties {
        shading: Some(core_model::Color::Auto),
        ..Default::default()
    };
    apply(
        &mut h,
        C::SetCellProps {
            cells: vec![cell],
            patch: none,
        },
    );
    assert_eq!(table_of(&h, t).rows[0].cells[0].props.shading, None);
}

#[test]
fn table_borders_none_and_outline() {
    use model_text::{BorderSide, BorderStyle, TableBorders};
    let (mut h, t) = table_host();
    let none = BorderSide {
        style: BorderStyle::None,
        width: Twips(0),
        color: core_model::Color::Auto,
        space: None,
    };
    apply(
        &mut h,
        C::SetTableProps {
            table: t,
            patch: model_text::TableProperties {
                borders: Some(TableBorders {
                    inside_h: Some(none),
                    inside_v: Some(none),
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
    );
    // New tables are "Table Grid" (Word): the outline comes from the style.
    assert_eq!(table_of(&h, t).props.style.as_deref(), Some("TableGrid"));
    let b = table_of(&h, t).props.borders.unwrap();
    assert!(b.top.is_none());
    assert_eq!(b.inside_h.unwrap().style, BorderStyle::None);
}

#[test]
fn clear_formatting_runs_and_paragraph() {
    let mut h = host(&["plain|bold"]);
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![id(1)],
            patch: ParagraphProperties {
                alignment: Some(model_text::Alignment::Center),
                ..Default::default()
            },
        },
    );
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(1)],
            style: "Heading1".into(),
        },
    );
    // Character formatting only (Ctrl+Space) of "ld".
    apply(
        &mut h,
        C::ClearFormatting {
            block: id(1),
            from: 7,
            to: 9,
            paragraph: false,
            keep_style: false,
        },
    );
    let p = para(&h, 1);
    assert_eq!(p.text(), "plainbold");
    assert_eq!(p.inlines.len(), 3);
    assert_eq!(p.props.style.as_deref(), Some("Heading1"));
    // Clear all formatting.
    apply(
        &mut h,
        C::ClearFormatting {
            block: id(1),
            from: 0,
            to: 9,
            paragraph: true,
            keep_style: false,
        },
    );
    let p = para(&h, 1);
    assert_eq!(p.inlines, vec![Inline::Run(Run::new("plainbold"))]);
    assert!(p.props.is_empty());
}

#[test]
fn header_footer_via_set_page() {
    let mut h = host(&["a"]);
    let p = apply(
        &mut h,
        C::SetPage {
            patch: PageSetupPatch {
                header_text: Some("Report".into()),
                footer_text: Some("Page {PAGE}".into()),
                ..Default::default()
            },
        },
    );
    let page = p.page.unwrap();
    assert_eq!(page.header_text.as_deref(), Some("Report"));
    assert_eq!(page.footer_text.as_deref(), Some("Page {PAGE}"));
    // Saved and reopened.
    let bytes = h.doc().save_docx().unwrap();
    let (back, warnings) = WriteDocument::open_docx(&bytes, "h.docx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(
        back.document().page.footer_text.as_deref(),
        Some("Page {PAGE}")
    );
    // An empty string removes; other fields stay.
    apply(
        &mut h,
        C::SetPage {
            patch: PageSetupPatch {
                header_text: Some(String::new()),
                ..Default::default()
            },
        },
    );
    let page = &h.doc().document().page;
    assert_eq!(page.header_text, None);
    assert_eq!(page.footer_text.as_deref(), Some("Page {PAGE}"));
}

#[test]
fn letter_landscape_with_narrow_margins() {
    let mut h = host(&["a"]);
    apply(
        &mut h,
        C::SetPage {
            patch: PageSetupPatch {
                width: Some(Twips(12240)),
                height: Some(Twips(15840)),
                ..Default::default()
            },
        },
    );
    let p = apply(
        &mut h,
        C::SetPage {
            patch: PageSetupPatch {
                orientation: Some(Orientation::Landscape),
                margins: Some(write_core::MarginsPatch {
                    top: Some(Twips(720)),
                    right: Some(Twips(720)),
                    bottom: Some(Twips(720)),
                    left: Some(Twips(720)),
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
    );
    let page = p.page.unwrap();
    assert_eq!((page.width, page.height), (Twips(15840), Twips(12240)));
    assert_eq!(page.content_width(), Twips(14400));
}

#[test]
fn new_commands_roundtrip_through_json() {
    let cmds = vec![
        json!({"type": "setImageSize", "block": 1, "offset": 2, "width": 100, "height": 50}),
        json!({"type": "setImageAlt", "block": 1, "offset": 2, "alt": null}),
        json!({"type": "setRowProps", "table": 3, "rows": [0], "header": true}),
        json!({"type": "clearFormatting", "block": 1, "from": 0, "to": 3}),
        json!({"type": "setPage", "patch": {"headerText": "x"}}),
    ];
    for c in cmds {
        let cmd: C = serde_json::from_value(c.clone()).unwrap();
        let back = serde_json::to_value(&cmd).unwrap();
        assert_eq!(serde_json::from_value::<C>(back).unwrap(), cmd, "{c}");
    }
}

/// P8-38 (W-05): characters typed in a row are one undo step, as in Word;
/// Backspaces in a row are another; Redo restores the whole run.
#[test]
fn typing_run_is_one_undo_step() {
    let mut h = host(&["", "other"]);
    let send = |h: &mut WriteHost, v: Json| -> Json {
        serde_json::from_str(&dispatch_with(h, &v.to_string())).unwrap()
    };
    let text = |h: &WriteHost| match &h.doc().document().body[0] {
        Block::Paragraph(p) => p.text(),
        _ => unreachable!(),
    };
    for (i, c) in "Hello".chars().enumerate() {
        let cmd = json!({"type":"insertText","block":1,"offset":i,"text":c.to_string()});
        send(&mut h, json!({"type":"apply","command":cmd}));
    }
    for at in [5, 4] {
        let cmd = json!({"type":"deleteText","block":1,"from":at - 1,"to":at});
        send(&mut h, json!({"type":"apply","command":cmd}));
    }
    assert_eq!(text(&h), "Hel");
    let r = send(&mut h, json!({"type":"undo"}));
    assert_eq!(text(&h), "Hello");
    // One reply carrying the paragraph as it is now.
    let replaced = &r["ok"]["envelope"]["patch"]["replaced"];
    assert!(replaced.to_string().contains("Hello"), "{replaced}");
    send(&mut h, json!({"type":"undo"}));
    assert_eq!(text(&h), "");
    assert_eq!(
        send(&mut h, json!({"type":"undo"}))["ok"]["envelope"]["canUndo"],
        json!(false)
    );
    send(&mut h, json!({"type":"redo"}));
    assert_eq!(text(&h), "Hello");
    send(&mut h, json!({"type":"redo"}));
    assert_eq!(text(&h), "Hel");
}

#[test]
fn new_lists_use_list_paragraph_with_contextual_spacing() {
    let mut h = host(&["a", "b", "c"]);
    // A heading stays a heading; Normal paragraphs become List Paragraph (Word, W-03).
    let mut hp = Host::new(WriteDocument::from_document(doc_with(&["x"])).unwrap());
    apply(
        &mut hp,
        C::SetStyle {
            blocks: vec![id(1)],
            style: "Heading1".into(),
        },
    );
    apply(
        &mut hp,
        C::ApplyList {
            blocks: vec![id(1)],
            kind: ListKind::Bullet,
        },
    );
    assert_eq!(para(&hp, 1).props.style.as_deref(), Some("Heading1"));

    let p = apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1), id(2)],
            kind: ListKind::Bullet,
        },
    );
    assert!(p.numbering.is_some());
    for n in [1, 2] {
        assert_eq!(para(&h, n).props.style.as_deref(), Some("ListParagraph"));
    }
    assert_eq!(para(&h, 3).props.style, None);
    let style = h.doc().document().styles.get("ListParagraph").unwrap();
    assert_eq!(style.paragraph.contextual_spacing, Some(true));
    // Bullets → numbering keeps the style; bullets off keeps it too (Word keeps the indent).
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1), id(2)],
            kind: ListKind::Decimal,
        },
    );
    assert_eq!(para(&h, 1).props.style.as_deref(), Some("ListParagraph"));
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(2)],
            kind: ListKind::None,
        },
    );
    assert_eq!(para(&h, 2).props.numbering, None);
    assert_eq!(para(&h, 2).props.style.as_deref(), Some("ListParagraph"));

    // Saved: the item has pStyle ListParagraph, the style w:contextualSpacing.
    let (doc, _) = WriteDocument::open_docx(&h.doc().save_docx().unwrap(), "t.docx").unwrap();
    let back = doc.document();
    let item = back
        .body
        .iter()
        .find_map(|b| match b {
            Block::Paragraph(p) if p.text() == "a" => Some(p),
            _ => None,
        })
        .unwrap();
    assert_eq!(item.props.style.as_deref(), Some("ListParagraph"));
    assert!(item.props.numbering.is_some());
    assert_eq!(
        back.styles
            .get("ListParagraph")
            .unwrap()
            .paragraph
            .contextual_spacing,
        Some(true)
    );
}

#[test]
fn list_paragraph_style_is_added_when_missing_and_undone() {
    let mut doc = doc_with(&["a"]);
    doc.styles.styles.retain(|s| s.id != "ListParagraph");
    let mut h = Host::new(WriteDocument::from_document(doc).unwrap());
    assert!(h.doc().document().styles.get("ListParagraph").is_none());
    let p = apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1)],
            kind: ListKind::Decimal,
        },
    );
    assert!(p.styles.is_some(), "the patch carries the new style");
    assert_eq!(para(&h, 1).props.style.as_deref(), Some("ListParagraph"));
    h.undo().unwrap();
    assert!(h.doc().document().styles.get("ListParagraph").is_none());
    assert_eq!(para(&h, 1).props.style, None);
}

#[test]
fn backspace_at_a_list_item_start_keeps_the_indent() {
    let mut h = host(&["a", "b", "c"]);
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![id(1), id(2), id(3)],
            kind: ListKind::Bullet,
        },
    );
    apply(
        &mut h,
        C::IndentList {
            blocks: vec![id(3)],
            delta: 1,
        },
    );
    // First Backspace: the bullet goes, the text stays at the level's indent (W-28).
    apply(&mut h, C::ListBackspace { block: id(2) });
    let p = para(&h, 2);
    assert_eq!(p.props.numbering, None);
    let ind = p.props.indent.unwrap();
    assert_eq!(ind.left, Some(Twips(720)));
    assert_eq!(ind.first_line, Some(Twips(0)));
    assert_eq!(ind.hanging, None);
    let eff = h.doc().document().resolve_paragraph_props(p);
    assert_eq!(eff.indent.unwrap().left, Some(Twips(720)));
    // A level-2 item keeps its deeper indent.
    apply(&mut h, C::ListBackspace { block: id(3) });
    assert_eq!(para(&h, 3).props.indent.unwrap().left, Some(Twips(1440)));
    // Second Backspace: an ordinary join with the previous paragraph.
    apply(&mut h, C::JoinWithPrevious { block: id(2) });
    assert_eq!(text(&h, 1), "ab");
    // Not a list item: refused.
    assert_eq!(
        err_code(&mut h, C::ListBackspace { block: id(3) }),
        "invalid_command"
    );
}
