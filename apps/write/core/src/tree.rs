//! Navigation in the block tree: containers (the body or a table cell),
//! positions and ancestors of nodes.

use std::collections::HashSet;

use model_text::{Block, Document, NodeId, Table, TableCell};

/// A block's place: the containing cell or drawing (`None` = body) and its
/// index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Pos {
    pub parent: Option<NodeId>,
    pub index: usize,
}

/// The blocks of the body (`None`), of the cell `parent` or of the text of
/// the drawing `parent` (anywhere: body, notes, headers).
pub(crate) fn container(doc: &Document, parent: Option<NodeId>) -> Option<&Vec<Block>> {
    match parent {
        None => Some(&doc.body),
        Some(id) => match find_cell(&doc.body, id) {
            Some(c) => Some(&c.blocks),
            None => doc.find_drawing(id)?.text.as_ref().map(|t| &t.blocks),
        },
    }
}

/// Mutable [`container`].
pub(crate) fn container_mut(doc: &mut Document, parent: Option<NodeId>) -> Option<&mut Vec<Block>> {
    match parent {
        None => Some(&mut doc.body),
        Some(id) => {
            if find_cell(&doc.body, id).is_some() {
                return find_cell_mut(&mut doc.body, id).map(|c| &mut c.blocks);
            }
            doc.find_drawing_mut(id)?.blocks_mut()
        }
    }
}

/// The cell with id `id`.
pub(crate) fn find_cell(blocks: &[Block], id: NodeId) -> Option<&TableCell> {
    for b in blocks {
        if let Block::Table(t) = b {
            for cell in t.rows.iter().flat_map(|r| &r.cells) {
                if cell.id == id {
                    return Some(cell);
                }
                if let Some(c) = find_cell(&cell.blocks, id) {
                    return Some(c);
                }
            }
        }
    }
    None
}

/// Mutable [`find_cell`].
pub(crate) fn find_cell_mut(blocks: &mut [Block], id: NodeId) -> Option<&mut TableCell> {
    for b in blocks {
        if let Block::Table(t) = b {
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                if cell.id == id {
                    return Some(cell);
                }
                if let Some(c) = find_cell_mut(&mut cell.blocks, id) {
                    return Some(c);
                }
            }
        }
    }
    None
}

/// The table with id `id`.
pub(crate) fn find_table_mut(doc: &mut Document, id: NodeId) -> Option<&mut Table> {
    match doc.find_block_mut(id) {
        Some(Block::Table(t)) => Some(t),
        _ => None,
    }
}

/// The position of the block `id` (paragraph or table) in the body, a
/// cell or the text of a drawing (drawings also in notes and headers).
pub(crate) fn position(doc: &Document, id: NodeId) -> Option<Pos> {
    fn walk(blocks: &[Block], parent: Option<NodeId>, id: NodeId) -> Option<Pos> {
        for (index, b) in blocks.iter().enumerate() {
            if b.id() == id {
                return Some(Pos { parent, index });
            }
            match b {
                Block::Table(t) => {
                    for cell in t.rows.iter().flat_map(|r| &r.cells) {
                        if let Some(p) = walk(&cell.blocks, Some(cell.id), id) {
                            return Some(p);
                        }
                    }
                }
                Block::Paragraph(p) => {
                    for d in p.drawings() {
                        if let Some(p) = walk(d.blocks(), Some(d.id), id) {
                            return Some(p);
                        }
                    }
                }
                Block::Toc(_) => {}
            }
        }
        None
    }
    if let Some(p) = walk(&doc.body, None, id) {
        return Some(p);
    }
    // Text boxes in notes, headers and footers.
    let (_, drawing) = doc.drawing_host(id)?;
    let d = doc.find_drawing(drawing)?;
    walk(d.blocks(), Some(d.id), id)
}

/// The ids enclosing node `id` (any node: block, row or cell), outermost
/// first: tables, rows and cells. `None` if `id` does not exist.
pub(crate) fn ancestors(doc: &Document, id: NodeId) -> Option<Vec<NodeId>> {
    fn walk(blocks: &[Block], id: NodeId, path: &mut Vec<NodeId>) -> bool {
        for b in blocks {
            if b.id() == id {
                return true;
            }
            if let Block::Table(t) = b {
                path.push(t.id);
                for row in &t.rows {
                    if row.id == id {
                        return true;
                    }
                    path.push(row.id);
                    for cell in &row.cells {
                        if cell.id == id {
                            return true;
                        }
                        path.push(cell.id);
                        if walk(&cell.blocks, id, path) {
                            return true;
                        }
                        path.pop();
                    }
                    path.pop();
                }
                path.pop();
            }
        }
        false
    }
    let mut path = Vec::new();
    walk(&doc.body, id, &mut path).then_some(path)
}

/// The innermost table containing node `id` (a row, a cell or a block
/// inside a cell). `None` for top-level blocks and unknown ids.
pub(crate) fn enclosing_table(doc: &Document, id: NodeId) -> Option<NodeId> {
    let path = ancestors(doc, id)?;
    // Paths alternate table, row, cell, table, row, cell, …
    path.chunks(3).last().map(|c| c[0])
}

/// Pushes the ids of `block` and everything inside it (drawings and their
/// text included).
pub(crate) fn collect_ids(block: &Block, out: &mut Vec<NodeId>) {
    out.push(block.id());
    match block {
        Block::Table(t) => {
            for row in &t.rows {
                out.push(row.id);
                for cell in &row.cells {
                    out.push(cell.id);
                    for b in &cell.blocks {
                        collect_ids(b, out);
                    }
                }
            }
        }
        Block::Paragraph(p) => {
            for d in p.drawings() {
                out.push(d.id);
                for b in d.blocks() {
                    collect_ids(b, out);
                }
            }
        }
        Block::Toc(_) => {}
    }
}

/// Every node id of the document (body, notes, headers and footers).
pub(crate) fn all_ids(doc: &Document) -> HashSet<NodeId> {
    let mut v = Vec::new();
    for c in doc.containers() {
        for b in c {
            collect_ids(b, &mut v);
        }
    }
    v.into_iter().collect()
}

/// Calls `f` on every paragraph inside `block` (including itself and the
/// paragraphs of its drawings' text).
pub(crate) fn for_each_paragraph_mut(
    block: &mut Block,
    f: &mut impl FnMut(&mut model_text::Paragraph),
) {
    match block {
        Block::Paragraph(p) => {
            f(p);
            for d in p.drawings_mut() {
                for b in d.blocks_mut().into_iter().flatten() {
                    for_each_paragraph_mut(b, f);
                }
            }
        }
        Block::Table(t) => {
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                for b in &mut cell.blocks {
                    for_each_paragraph_mut(b, f);
                }
            }
        }
        Block::Toc(_) => {}
    }
}
