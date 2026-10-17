//! P9-W4: groups and linked text boxes through the commands the editor
//! sends (`ReplaceBlocks` for grouping, `SetDrawingProps` for the group's
//! members and the chain), with undo identity and `.docx` round trips.

use app_common::Host;
use core_model::units::Emu;
use model_text::{
    Anchor, Block, Document, Drawing, DrawingKind, Inline, NodeId, Paragraph, Run, TextChain,
    WrapKind,
};
use serde_json::Value as Json;
use write_core::{NewBlock, WriteCommand as C, WriteDocument, WriteHost};

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

fn apply(h: &mut WriteHost, cmd: C) {
    let before = json_of(h);
    h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
}

fn para(h: &WriteHost, id: u64) -> Paragraph {
    h.doc()
        .document()
        .find_paragraph(NodeId(id))
        .unwrap()
        .clone()
}

fn drawings(h: &WriteHost, id: u64) -> Vec<Drawing> {
    para(h, id).drawings().cloned().collect()
}

fn text_box(id: u64, pid: u64, text: &str) -> Drawing {
    let mut d = Drawing::text_box(
        NodeId(id),
        Emu(914_400),
        Emu(457_200),
        vec![Block::Paragraph(Paragraph::with_text(NodeId(pid), text))],
    );
    d.anchor = Some(Anchor::new(WrapKind::InFront));
    d
}

/// Paragraph 1 replaced by itself with `inlines` appended (what the
/// editor's fallback sends).
fn with_inlines(h: &mut WriteHost, inlines: Vec<Inline>) {
    let mut p = para(h, 1);
    p.inlines.extend(inlines);
    let b = Block::Paragraph(p);
    apply(
        h,
        C::ReplaceBlocks {
            ids: vec![NodeId(1)],
            blocks: vec![NewBlock::from(&b)],
        },
    );
}

#[test]
fn grouping_editing_members_and_ungrouping() {
    let mut h = host(&["Body ", "Next"]);
    with_inlines(
        &mut h,
        vec![
            Inline::Drawing(Box::new(text_box(100, 101, "first"))),
            Inline::Drawing(Box::new(text_box(102, 103, "second"))),
        ],
    );
    let ds = drawings(&h, 1);
    assert_eq!(ds.len(), 2);
    // Group: the two boxes become members (ids kept) of a new group (id 0 = fresh).
    let mut a = ds[0].clone();
    let mut b = ds[1].clone();
    a.anchor = None;
    b.anchor = None;
    b.x = Emu(914_400);
    let mut g = Drawing::group(NodeId(0), Emu(1_828_800), Emu(457_200), vec![a, b]);
    g.anchor = Some(Anchor::new(WrapKind::Square));
    let mut p = para(&h, 1);
    p.inlines.retain(|i| !matches!(i, Inline::Drawing(_)));
    p.inlines.push(Inline::Drawing(Box::new(g)));
    apply(
        &mut h,
        C::ReplaceBlocks {
            ids: vec![NodeId(1)],
            blocks: vec![NewBlock::from(&Block::Paragraph(p))],
        },
    );
    let g = drawings(&h, 1).remove(0);
    assert_eq!(g.kind, DrawingKind::Group);
    assert_ne!(g.id, NodeId(0));
    assert_eq!(g.children[0].id, NodeId(100));
    assert_eq!(g.children[1].blocks()[0].id(), NodeId(103));
    // Edit a member's text and resize the group (members scale): one SetDrawingProps.
    let mut next = g.clone();
    next.scale_children(Emu(3_657_600), Emu(914_400));
    let Some(Block::Paragraph(p)) = next.children[1].text.as_mut().map(|t| &mut t.blocks[0]) else {
        panic!()
    };
    p.inlines = vec![Inline::Run(Run::new("second, edited"))];
    let offset = 5;
    apply(
        &mut h,
        C::SetDrawingProps {
            block: NodeId(1),
            offset,
            drawing: Box::new(next),
        },
    );
    let g2 = drawings(&h, 1).remove(0);
    assert_eq!(g2.id, g.id);
    assert_eq!(g2.children[1].x, Emu(1_828_800));
    assert_eq!(g2.children[1].width, Emu(1_828_800));
    assert_eq!(g2.children[1].blocks()[0].id(), NodeId(103));
    assert_eq!(
        g2.children[1].blocks()[0].as_paragraph().unwrap().text(),
        "second, edited"
    );
    // A member id taken elsewhere gets a fresh one.
    let mut dup = g2.clone();
    dup.children[0].id = NodeId(2);
    h.apply(C::SetDrawingProps {
        block: NodeId(1),
        offset,
        drawing: Box::new(dup),
    })
    .unwrap();
    let g3 = drawings(&h, 1).remove(0);
    assert_ne!(g3.children[0].id, NodeId(2));
    // Saved and reopened as a group with the edited text.
    let bytes = h.doc().save_docx().unwrap();
    let back = WriteDocument::open_docx(&bytes, "g.docx")
        .unwrap()
        .0
        .into_document();
    let gb: Vec<&Drawing> = back.body[0].as_paragraph().unwrap().drawings().collect();
    assert_eq!(gb[0].kind, DrawingKind::Group);
    assert_eq!(gb[0].children.len(), 2);
    assert!(back.plain_text().contains("Body"));
    // A group stays a group and keeps members.
    let mut empty = g3.clone();
    empty.children.clear();
    assert!(h
        .apply(C::SetDrawingProps {
            block: NodeId(1),
            offset,
            drawing: Box::new(empty),
        })
        .is_err());
}

#[test]
fn linking_text_boxes_empties_the_later_box() {
    let mut h = host(&["Body ", "Next"]);
    with_inlines(
        &mut h,
        vec![
            Inline::Drawing(Box::new(text_box(100, 101, "story"))),
            Inline::Drawing(Box::new(text_box(102, 103, "own"))),
        ],
    );
    let ds = drawings(&h, 1);
    let mut head = ds[0].clone();
    head.chain = Some(TextChain { id: 1, seq: 0 });
    let mut next = ds[1].clone();
    next.chain = Some(TextChain { id: 1, seq: 1 });
    apply(
        &mut h,
        C::Compound {
            commands: vec![
                C::SetDrawingProps {
                    block: NodeId(1),
                    offset: 5,
                    drawing: Box::new(head),
                },
                C::SetDrawingProps {
                    block: NodeId(1),
                    offset: 6,
                    drawing: Box::new(next),
                },
            ],
        },
    );
    let ds = drawings(&h, 1);
    assert_eq!(ds[0].chain, Some(TextChain { id: 1, seq: 0 }));
    assert_eq!(ds[1].chain, Some(TextChain { id: 1, seq: 1 }));
    assert_eq!(ds[1].blocks()[0].as_paragraph().unwrap().text(), "");
    assert_eq!(ds[1].blocks()[0].id(), NodeId(103));
    assert_eq!(h.doc().document().text_chain(1).len(), 2);
    // Only text boxes are linked.
    let mut shape = Drawing::shape(NodeId(0), "rect", Emu(10), Emu(10));
    shape.chain = Some(TextChain { id: 1, seq: 2 });
    assert!(h
        .apply(C::SetDrawingProps {
            block: NodeId(1),
            offset: 6,
            drawing: Box::new(shape),
        })
        .is_err());
}
