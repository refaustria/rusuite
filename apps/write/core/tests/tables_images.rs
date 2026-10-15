//! P8-15: merged cells, table styles, floating images, paragraph
//! borders/shading and tab stops through `write-core` commands (undo
//! identity, patches, `.docx` round trips).

use app_common::Host;
use core_model::units::Emu;
use core_model::{Color, Rgb, ThemeColorSlot};
use model_text::media::base64_encode;
use model_text::{
    Anchor, Block, BorderSide, BorderStyle, Document, HAlign, HPos, HRelative, Inline, NodeId,
    Paragraph, ParagraphBorders, ParagraphProperties, Placement, Run, StyleKind, TabKind,
    TabLeader, TabStop, Table, TableAlignment, TableLook, TableProperties, Twips, VMerge, VPos,
    VRelative, WrapKind,
};
use serde_json::{json, Value as Json};
use write_core::{WriteCommand as C, WriteDocument, WriteHost, WritePatch};

fn host_with(doc: Document) -> WriteHost {
    Host::new(WriteDocument::from_document(doc).unwrap())
}

/// One paragraph "a" (id 1).
fn host() -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    let mut p = Paragraph::new(NodeId(1));
    p.inlines.push(Inline::Run(Run::new("a")));
    doc.body.push(Block::Paragraph(p));
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
    let mut h = host();
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

fn reopen(h: &WriteHost) -> Document {
    let bytes = h.doc().save_docx().unwrap();
    let (doc, warnings) = WriteDocument::open_docx(&bytes, "t.docx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    doc.document().clone()
}

#[test]
fn merge_and_split_cells_undo_and_save() {
    let (mut h, t) = table_host(3, 3);
    let p = apply(
        &mut h,
        C::MergeCells {
            table: t,
            top: 0,
            left: 0,
            bottom: 1,
            right: 1,
        },
    );
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(p.replaced[0].id(), t);
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(
        texts(&tb),
        [
            vec!["^0,0/0,1/1,0/1,1x2", "0,2x1"],
            vec!["|x2", "1,2x1"],
            vec!["2,0x1", "2,1x1", "2,2x1"],
        ]
    );
    // The rectangle must not cut the merged cell.
    assert_eq!(
        err_code(
            &mut h,
            C::MergeCells {
                table: t,
                top: 1,
                left: 1,
                bottom: 2,
                right: 2,
            }
        ),
        "invalid_command"
    );
    // Saved and reopened: gridSpan/vMerge survive.
    let doc = reopen(&h);
    let back = doc.body[1].as_table().unwrap();
    assert_eq!(texts(back), texts(&tb));

    // Inserting a row inside the region extends it; deleting the first
    // row of the region keeps the rest merged.
    apply(
        &mut h,
        C::InsertTableRow {
            table: t,
            at: 1,
            new_ids: vec![],
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(texts(&tb)[1], ["|x2", "x1"]);
    apply(&mut h, C::DeleteTableRow { table: t, at: 0 });
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(texts(&tb)[0], ["^x2", "x1"]);
    assert_eq!(texts(&tb)[1], ["|x2", "1,2x1"]);

    // Split the merged cell back into 2 × 2 and one cell into 3 columns.
    let (mut h, t) = table_host(2, 2);
    apply(
        &mut h,
        C::MergeCells {
            table: t,
            top: 0,
            left: 0,
            bottom: 1,
            right: 1,
        },
    );
    apply(
        &mut h,
        C::SplitCell {
            table: t,
            row: 0,
            col: 0,
            rows: 2,
            cols: 2,
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(
        texts(&tb),
        [vec!["0,0/0,1/1,0/1,1x1", "x1"], vec!["x1", "x1"]]
    );
    apply(
        &mut h,
        C::SplitCell {
            table: t,
            row: 1,
            col: 1,
            rows: 1,
            cols: 3,
        },
    );
    let tb = table_of(&h, t);
    tb.check_grid().unwrap();
    assert_eq!(tb.grid_cols(), 4);
    assert_eq!(tb.props.col_widths.len(), 4);
    // fresh ids are unique and not reused
    let mut all = Vec::new();
    for row in &tb.rows {
        all.push(row.id);
        for c in &row.cells {
            all.push(c.id);
            all.extend(c.blocks.iter().map(Block::id));
        }
    }
    let n = all.len();
    all.sort();
    all.dedup();
    assert_eq!(all.len(), n);
    assert_eq!(
        err_code(
            &mut h,
            C::SplitCell {
                table: t,
                row: 0,
                col: 0,
                rows: 0,
                cols: 1,
            }
        ),
        "invalid_command"
    );
    assert_eq!(reopen(&h).body[1].as_table().map(texts), Some(texts(&tb)));
}

#[test]
fn table_style_presets_are_added_on_use() {
    let mut doc = Document::new();
    doc.body.clear();
    doc.body
        .push(Block::Paragraph(Paragraph::with_text(NodeId(1), "a")));
    // A document read from a file without table styles.
    doc.styles.styles.retain(|s| s.kind != StyleKind::Table);
    let mut h = host_with(doc);
    apply(
        &mut h,
        C::InsertTable {
            after: Some(NodeId(1)),
            parent: None,
            rows: 3,
            cols: 2,
            new_ids: vec![],
        },
    );
    let t = h.doc().document().body[1].id();
    let p = apply(
        &mut h,
        C::SetTableProps {
            table: t,
            patch: TableProperties {
                style: Some("GridTable4-Accent2".into()),
                look: Some(TableLook::word_default()),
                alignment: Some(TableAlignment::Center),
                indent: Some(Twips(144)),
                ..Default::default()
            },
        },
    );
    let styles = p.styles.expect("styles reported");
    assert!(styles.get("GridTable4-Accent2").is_some());
    assert!(styles.get("TableNormal").unwrap().is_default);
    let doc = h.doc().document();
    let tb = table_of(&h, t);
    assert_eq!(tb.props.alignment, Some(TableAlignment::Center));
    let header = doc.resolve_cell_props(&tb, 0, 0).unwrap();
    assert_eq!(
        header.shading,
        Some(Color::Theme {
            slot: ThemeColorSlot::Accent2,
            tint: 0.0
        })
    );
    let band = doc.resolve_cell_props(&tb, 1, 1).unwrap();
    assert_eq!(
        band.shading,
        Some(Color::Theme {
            slot: ThemeColorSlot::Accent2,
            tint: 0.8
        })
    );
    assert_eq!(doc.resolve_cell_props(&tb, 2, 1).unwrap().shading, None);
    assert_eq!(
        err_code(
            &mut h,
            C::SetTableProps {
                table: t,
                patch: TableProperties {
                    style: Some("Nope".into()),
                    ..Default::default()
                },
            }
        ),
        "unknown_style"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetTableProps {
                table: t,
                patch: TableProperties {
                    style: Some("Normal".into()),
                    ..Default::default()
                },
            }
        ),
        "unknown_style"
    );
    // Saved: style, look and position survive; the conditional formats
    // resolve the same way after reopening.
    let back = reopen(&h);
    let bt = back.body[1].as_table().unwrap();
    assert_eq!(bt.props.style.as_deref(), Some("GridTable4-Accent2"));
    assert_eq!(bt.props.look, Some(TableLook::word_default()));
    assert_eq!(bt.props.indent, Some(Twips(144)));
    assert_eq!(
        back.resolve_cell_props(bt, 1, 1).unwrap().shading,
        band.shading
    );
    // `""` removes the style.
    apply(
        &mut h,
        C::SetTableProps {
            table: t,
            patch: TableProperties {
                style: Some(String::new()),
                ..Default::default()
            },
        },
    );
    assert_eq!(table_of(&h, t).props.style, None);
}

#[test]
fn column_widths_drop_cell_widths() {
    let (mut h, t) = table_host(1, 2);
    let cell = table_of(&h, t).rows[0].cells[0].id;
    apply(
        &mut h,
        C::SetCellProps {
            cells: vec![cell],
            patch: model_text::CellProperties {
                width: Some(model_text::TableWidth::Twips(Twips(1000))),
                ..Default::default()
            },
        },
    );
    apply(
        &mut h,
        C::SetTableProps {
            table: t,
            patch: TableProperties {
                col_widths: vec![Twips(2000), Twips(7026)],
                ..Default::default()
            },
        },
    );
    let tb = table_of(&h, t);
    assert_eq!(tb.rows[0].cells[0].props.width, None);
    // Reopened: the grid is kept, cell widths are derived from it.
    let back = reopen(&h);
    let bt = back.body[1].as_table().unwrap();
    assert_eq!(bt.props.col_widths, vec![Twips(2000), Twips(7026)]);
    assert_eq!(bt.rows[0].cells[0].props.width, None);
}

/// "a" + an image at offset 1 (paragraph 1).
fn image_host() -> WriteHost {
    let mut h = host();
    apply(
        &mut h,
        C::InsertImage {
            block: NodeId(1),
            offset: 1,
            content_type: "image/png".into(),
            bytes_base64: base64_encode(&[0x89, b'P', b'N', b'G', 9]),
            width: Emu(914_400),
            height: Emu(457_200),
            alt: None,
        },
    );
    h
}

fn image(h: &WriteHost) -> model_text::InlineImage {
    let p = h.doc().document().find_paragraph(NodeId(1)).unwrap();
    p.inlines
        .iter()
        .find_map(|i| match i {
            Inline::Image(img) => Some(img.clone()),
            _ => None,
        })
        .unwrap()
}

#[test]
fn floating_images() {
    let mut h = image_host();
    assert_eq!(image(&h).anchor, None);
    let p = apply(
        &mut h,
        C::SetImageWrap {
            block: NodeId(1),
            offset: 1,
            wrap: WrapKind::Square,
        },
    );
    assert_eq!(p.replaced.len(), 1);
    assert_eq!(image(&h).anchor, Some(Anchor::new(WrapKind::Square)));
    apply(
        &mut h,
        C::SetImageWrap {
            block: NodeId(1),
            offset: 1,
            wrap: WrapKind::Behind,
        },
    );
    assert!(image(&h).anchor.unwrap().behind_text());
    let custom = Anchor {
        h: HPos {
            relative_to: HRelative::Margin,
            place: Placement::Align(HAlign::Right),
        },
        v: VPos {
            relative_to: VRelative::Paragraph,
            place: Placement::Offset(Emu(180_000)),
        },
        ..Anchor::new(WrapKind::Tight)
    };
    apply(
        &mut h,
        C::SetImageAnchor {
            block: NodeId(1),
            offset: 1,
            anchor: Some(custom),
        },
    );
    assert_eq!(image(&h).anchor, Some(custom));
    // Saved as wp:anchor and read back identically.
    let back = reopen(&h);
    let img = back
        .find_paragraph(NodeId(1))
        .and_then(|p| {
            p.inlines.iter().find_map(|i| match i {
                Inline::Image(img) => Some(img.clone()),
                _ => None,
            })
        })
        .unwrap();
    assert_eq!(img.anchor, Some(custom));
    // Back to inline.
    apply(
        &mut h,
        C::SetImageAnchor {
            block: NodeId(1),
            offset: 1,
            anchor: None,
        },
    );
    assert_eq!(image(&h).anchor, None);
    assert_eq!(
        err_code(
            &mut h,
            C::SetImageWrap {
                block: NodeId(1),
                offset: 0,
                wrap: WrapKind::Square,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn paragraph_borders_shading_and_tabs() {
    let mut h = host();
    let side = BorderSide {
        space: Some(1),
        ..BorderSide::new(
            BorderStyle::Single,
            BorderSide::width_from_eighths(6),
            Color::Rgb(Rgb::new(0x44, 0x72, 0xC4)),
        )
    };
    let tab = |pos, kind, leader| TabStop {
        pos: Twips(pos),
        kind,
        leader,
    };
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![NodeId(1)],
            patch: ParagraphProperties {
                borders: Some(ParagraphBorders::boxed(side)),
                shading: Some(Color::Rgb(Rgb::new(0xF2, 0xF2, 0xF2))),
                tabs: vec![
                    tab(4513, TabKind::Center, TabLeader::None),
                    tab(9026, TabKind::Right, TabLeader::Dot),
                ],
                ..Default::default()
            },
        },
    );
    // Merging: one side changes, a tab moves (clear + new), shading stays.
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![NodeId(1)],
            patch: ParagraphProperties {
                borders: Some(ParagraphBorders {
                    left: Some(BorderSide::new(BorderStyle::None, Twips(0), Color::Auto)),
                    ..Default::default()
                }),
                tabs: vec![
                    tab(4513, TabKind::Clear, TabLeader::None),
                    tab(2000, TabKind::Left, TabLeader::Hyphen),
                ],
                ..Default::default()
            },
        },
    );
    let doc = h.doc().document();
    let p = doc.find_paragraph(NodeId(1)).unwrap();
    let b = p.props.borders.unwrap();
    assert_eq!(b.top, Some(side));
    assert_eq!(b.left.unwrap().style, BorderStyle::None);
    let kinds: Vec<(i32, TabKind)> = p.props.tabs.iter().map(|t| (t.pos.0, t.kind)).collect();
    assert_eq!(
        kinds,
        [
            (2000, TabKind::Left),
            (4513, TabKind::Clear),
            (9026, TabKind::Right)
        ]
    );
    // Resolved: the clear entry is gone.
    let resolved = doc.resolve_paragraph_props(p);
    assert_eq!(resolved.tabs.len(), 2);
    assert!(resolved.shading.is_some());
    // Saved and reopened.
    let back = reopen(&h);
    assert_eq!(back.find_paragraph(NodeId(1)).unwrap().props, p.props);
    // `auto` shading removes it.
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![NodeId(1)],
            patch: ParagraphProperties {
                shading: Some(Color::Auto),
                ..Default::default()
            },
        },
    );
    assert_eq!(
        h.doc()
            .document()
            .find_paragraph(NodeId(1))
            .unwrap()
            .props
            .shading,
        None
    );
}

#[test]
fn row_cant_split() {
    let (mut h, t) = table_host(2, 1);
    apply(
        &mut h,
        C::SetRowProps {
            table: t,
            rows: vec![1],
            header: None,
            height: None,
            cant_split: Some(true),
        },
    );
    assert!(table_of(&h, t).rows[1].props.cant_split);
    let back = reopen(&h);
    assert!(back.body[1].as_table().unwrap().rows[1].props.cant_split);
}

#[test]
fn new_commands_json() {
    for c in [
        json!({"type": "mergeCells", "table": 3, "top": 0, "left": 0, "bottom": 1, "right": 2}),
        json!({"type": "splitCell", "table": 3, "row": 0, "col": 1, "rows": 2, "cols": 2}),
        json!({"type": "setImageWrap", "block": 1, "offset": 2, "wrap": "topAndBottom"}),
        json!({"type": "setImageAnchor", "block": 1, "offset": 2, "anchor": null}),
        json!({"type": "setImageAnchor", "block": 1, "offset": 2, "anchor": {
            "h": {"relativeTo": "page", "place": {"kind": "align", "value": "center"}},
            "v": {"relativeTo": "margin", "place": {"kind": "offset", "value": 914400}},
            "wrap": "square", "distance": {"top": 0, "bottom": 0, "left": 114300, "right": 114300},
            "allowOverlap": true}}),
        json!({"type": "setRowProps", "table": 3, "rows": [0], "cantSplit": true}),
        json!({"type": "setParagraphProps", "blocks": [1], "patch": {
            "borders": {"bottom": {"style": "single", "width": 10, "color": {"kind": "auto"}, "space": 1}},
            "shading": {"kind": "rgb", "value": "FFFF00"},
            "tabs": [{"pos": 720, "kind": "right", "leader": "dot"}]}}),
        json!({"type": "setTableProps", "table": 3, "patch": {"style": "TableGrid",
            "look": {"firstRow": true, "bandedRows": true}, "alignment": "center", "indent": 0}}),
    ] {
        let cmd: C = serde_json::from_value(c.clone()).unwrap_or_else(|e| panic!("{c}: {e}"));
        let back = serde_json::to_value(&cmd).unwrap();
        assert_eq!(serde_json::from_value::<C>(back).unwrap(), cmd, "{c}");
    }
}
