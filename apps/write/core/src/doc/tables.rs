//! Table structure commands of P9-W5: Split Table, joining tables,
//! Convert Text to Table / Table to Text, AutoFit and text wrapping
//! around a table.
//!
//! Every command computes the new blocks and swaps them in with
//! `replace_blocks` (or `edit_table`), so the inverse restores the old
//! blocks exactly, ids included. Rows, cells and paragraphs keep their
//! ids where they survive; new nodes get fresh ids (or the UI's
//! temporary ids, reported in the patch's id map).

use model_text::{TablePosition, TableWidth};

use super::*;
use crate::command::{AutoFitMode, TextSeparator};

impl TextSeparator {
    /// The separator character (`None` for paragraphs).
    fn char(&self) -> Option<char> {
        match self {
            TextSeparator::Tab => Some('\t'),
            TextSeparator::Comma => Some(','),
            TextSeparator::Paragraph => None,
            TextSeparator::Other(s) => s.chars().next(),
        }
    }
}

/// An empty cell paragraph block with id `id`.
fn empty_cell(id: NodeId, pid: NodeId) -> TableCell {
    TableCell::new(
        id,
        CellProperties::default(),
        vec![Block::Paragraph(Paragraph::new(pid))],
    )
}

impl WriteDocument {
    pub(super) fn split_table(
        &mut self,
        table: NodeId,
        at: u32,
        new_ids: &[i64],
        ch: &mut Changes,
    ) -> R<C> {
        if !new_ids.is_empty() && new_ids.len() != 2 {
            return Err(invalid("expected 0 or 2 new ids"));
        }
        let mut first = self.table_mut(table)?.clone();
        let placeholder = NodeId(0);
        let second = first
            .split_off_rows(at as usize, placeholder)
            .map_err(|e| invalid(e.to_string()))?;
        let pid = new_ids
            .first()
            .copied()
            .unwrap_or_else(|| self.doc.alloc_id().0 as i64);
        let tid = new_ids
            .get(1)
            .copied()
            .unwrap_or_else(|| self.doc.alloc_id().0 as i64);
        let mut second = NewTable::from(&second);
        second.id = tid;
        let blocks = [
            NewBlock::Table(NewTable::from(&first)),
            NewBlock::Paragraph(NewParagraph {
                id: pid,
                props: ParagraphProperties::default(),
                inlines: Vec::new(),
            }),
            NewBlock::Table(second),
        ];
        self.replace_blocks(&[table], &blocks, ch)
    }

    pub(super) fn merge_tables(&mut self, paragraph: NodeId, ch: &mut Changes) -> R<C> {
        let pos = self.pos(paragraph)?;
        let siblings = container(&self.doc, pos.parent).ok_or(invalid("container vanished"))?;
        let (Some(Block::Table(a)), Some(Block::Paragraph(p)), Some(Block::Table(b))) = (
            pos.index.checked_sub(1).and_then(|i| siblings.get(i)),
            siblings.get(pos.index),
            siblings.get(pos.index + 1),
        ) else {
            return Err(invalid("the paragraph is not between two tables"));
        };
        if p.inlines.iter().any(|i| !i.is_marker()) {
            return Err(invalid("the paragraph between the tables is not empty"));
        }
        let ids = [a.id, p.id, b.id];
        let (mut merged, other) = (a.clone(), b.clone());
        let doc = &mut self.doc;
        merged.append_rows(other, || doc.alloc_id());
        self.replace_blocks(&ids, &[NewBlock::Table(NewTable::from(&merged))], ch)
    }

    pub(super) fn convert_text_to_table(
        &mut self,
        blocks: &[NodeId],
        separator: &TextSeparator,
        cols: Option<u32>,
        ch: &mut Changes,
    ) -> R<C> {
        if blocks.is_empty() {
            return Err(invalid("no paragraphs to convert"));
        }
        let paras: Vec<Paragraph> = blocks
            .iter()
            .map(|&id| self.para(id).cloned())
            .collect::<R<_>>()?;
        if let Some(0) = cols {
            return Err(invalid("a table needs at least one column"));
        }
        // The cells' paragraphs (each paragraph's own id goes to its first cell).
        let mut items: Vec<Vec<Paragraph>> = Vec::new();
        match separator.char() {
            None => items.push(paras.clone()),
            Some(sep) => {
                for p in &paras {
                    let text: Vec<char> = p.text().chars().collect();
                    let mut cuts: Vec<usize> = text
                        .iter()
                        .enumerate()
                        .filter(|(_, &c)| c == sep)
                        .map(|(i, _)| i)
                        .collect();
                    cuts.push(text.len());
                    let mut start = 0;
                    let mut row = Vec::with_capacity(cuts.len());
                    for (k, &end) in cuts.iter().enumerate() {
                        let id = if k == 0 { p.id } else { self.doc.alloc_id() };
                        row.push(Paragraph {
                            id,
                            props: p.props.clone(),
                            inlines: slice(p, start, end),
                            list_label: None,
                        });
                        start = end + 1;
                    }
                    items.push(row);
                }
            }
        }
        let ncols = match (cols, separator.char()) {
            (Some(n), _) => n as usize,
            (None, None) => 1,
            (None, Some(_)) => items.iter().map(Vec::len).max().unwrap_or(1),
        };
        if ncols > 63 {
            return Err(invalid("a table has at most 63 columns"));
        }
        // Rows of `ncols` cells: long rows wrap, short ones are padded.
        let mut rows: Vec<TableRow> = Vec::new();
        for item in items {
            for chunk in item.chunks(ncols) {
                let mut cells: Vec<TableCell> = chunk
                    .iter()
                    .map(|p| {
                        TableCell::new(
                            self.doc.alloc_id(),
                            CellProperties::default(),
                            vec![Block::Paragraph(p.clone())],
                        )
                    })
                    .collect();
                while cells.len() < ncols {
                    let (id, pid) = (self.doc.alloc_id(), self.doc.alloc_id());
                    cells.push(empty_cell(id, pid));
                }
                rows.push(TableRow {
                    id: self.doc.alloc_id(),
                    props: Default::default(),
                    cells,
                });
            }
        }
        if rows.len() > 1000 {
            return Err(invalid("a table has at most 1000 rows"));
        }
        let old_styles = self.doc.styles.clone();
        let grid = match self.doc.styles.get("TableGrid") {
            Some(s) => s.kind == StyleKind::Table,
            None => self.ensure_table_style("TableGrid").is_ok(),
        };
        let side = BorderSide {
            style: BorderStyle::Single,
            width: BorderSide::width_from_eighths(4),
            color: Color::Auto,
            space: None,
        };
        let width = self.doc.page.content_width().0 / ncols as i32;
        let table = Table {
            id: self.doc.alloc_id(),
            props: TableProperties {
                col_widths: vec![Twips(width); ncols],
                borders: (!grid).then(|| TableBorders::all(side)),
                style: grid.then(|| "TableGrid".to_owned()),
                ..Default::default()
            },
            rows,
        };
        let inverse =
            self.replace_blocks(blocks, &[NewBlock::Table(NewTable::from(&table))], ch)?;
        Ok(self.with_styles(inverse, old_styles, ch))
    }

    pub(super) fn convert_table_to_text(
        &mut self,
        table: NodeId,
        separator: &TextSeparator,
        ch: &mut Changes,
    ) -> R<C> {
        let t = self.table_mut(table)?.clone();
        let mut out: Vec<Paragraph> = Vec::new();
        let mut used = HashSet::new();
        self.table_paragraphs(&t, separator, &mut out, &mut used);
        if out.is_empty() {
            out.push(Paragraph::new(self.doc.alloc_id()));
        }
        let blocks: Vec<NewBlock> = out
            .iter()
            .map(|p| NewBlock::from(&Block::Paragraph(p.clone())))
            .collect();
        self.replace_blocks(&[table], &blocks, ch)
    }

    /// The paragraphs of `t` converted to text (rows joined by
    /// `separator`, nested tables converted in place).
    fn table_paragraphs(
        &mut self,
        t: &Table,
        separator: &TextSeparator,
        out: &mut Vec<Paragraph>,
        used: &mut HashSet<NodeId>,
    ) {
        let sep = separator.char();
        for row in &t.rows {
            // The row's line: the first paragraph of every cell, joined.
            let mut line: Option<Paragraph> = None;
            let mut rest: Vec<Paragraph> = Vec::new();
            for (k, cell) in row.cells.iter().enumerate() {
                // A covered cell of a vertical merge holds nothing (its text is above).
                let covered = cell.v_merge == Some(VMerge::Continue);
                let mut paras: Vec<Paragraph> = Vec::new();
                if !covered {
                    for b in &cell.blocks {
                        match b {
                            Block::Paragraph(p) => paras.push(p.clone()),
                            Block::Table(inner) => {
                                let mut nested = Vec::new();
                                self.table_paragraphs(inner, separator, &mut nested, used);
                                paras.extend(nested);
                            }
                            Block::Toc(_) => {}
                        }
                    }
                }
                let Some(sep) = sep else {
                    // Paragraphs: every cell paragraph stays one.
                    out.extend(paras.into_iter().map(|p| self.claim(p, used)));
                    continue;
                };
                let mut it = paras.into_iter();
                let head = it.next();
                match (&mut line, head) {
                    (None, head) => {
                        line = Some(match head {
                            Some(p) => self.claim(p, used),
                            None => Paragraph::new(self.doc.alloc_id()),
                        });
                    }
                    (Some(l), head) => {
                        if k > 0 {
                            l.inlines.push(Inline::Run(Run::new(sep.to_string())));
                        }
                        if let Some(p) = head {
                            l.inlines.extend(p.inlines);
                        }
                    }
                }
                rest.extend(it.map(|p| self.claim(p, used)));
            }
            out.extend(line);
            out.extend(rest);
        }
    }

    /// `p` with its id, or a fresh one when it is taken.
    fn claim(&mut self, mut p: Paragraph, used: &mut HashSet<NodeId>) -> Paragraph {
        if !used.insert(p.id) {
            p.id = self.doc.alloc_id();
            used.insert(p.id);
        }
        p.list_label = None;
        p
    }

    pub(super) fn auto_fit_table(
        &mut self,
        table: NodeId,
        mode: AutoFitMode,
        col_widths: &[Twips],
        ch: &mut Changes,
    ) -> R<C> {
        let content = self.doc.page.content_width().0;
        self.edit_table(table, ch, |t| {
            let cols = t.grid_cols();
            if !col_widths.is_empty() && col_widths.len() != cols {
                return Err(invalid(format!(
                    "expected {cols} column widths, got {}",
                    col_widths.len()
                )));
            }
            if col_widths.iter().any(|w| w.0 <= 0) {
                return Err(invalid("column widths must be positive"));
            }
            match mode {
                AutoFitMode::Contents => {
                    t.props.layout = Some(model_text::TableLayout::Autofit);
                    t.props.width = Some(TableWidth::Auto);
                    if !col_widths.is_empty() {
                        t.props.col_widths = col_widths.to_vec();
                    }
                }
                AutoFitMode::Window => {
                    t.props.layout = Some(model_text::TableLayout::Autofit);
                    t.props.width = Some(TableWidth::Pct(5000));
                    let widths = if col_widths.is_empty() {
                        t.props.col_widths.clone()
                    } else {
                        col_widths.to_vec()
                    };
                    let total: i64 = widths.iter().map(|w| i64::from(w.0)).sum();
                    let avail = i64::from(content - t.props.indent.map_or(0, |i| i.0)).max(1);
                    t.props.col_widths = if total > 0 && widths.len() == cols {
                        let mut acc = 0i64;
                        let mut out = Vec::with_capacity(cols);
                        for (k, w) in widths.iter().enumerate() {
                            // Exact sum: the last column takes the rounding.
                            let v = if k + 1 == cols {
                                avail - acc
                            } else {
                                i64::from(w.0) * avail / total
                            };
                            acc += v;
                            out.push(Twips(i32::try_from(v.max(1)).unwrap_or(i32::MAX)));
                        }
                        out
                    } else {
                        vec![Twips((avail / cols.max(1) as i64) as i32); cols]
                    };
                }
                AutoFitMode::Fixed => {
                    t.props.layout = Some(model_text::TableLayout::Fixed);
                    t.props.width = Some(TableWidth::Auto);
                    if !col_widths.is_empty() {
                        t.props.col_widths = col_widths.to_vec();
                    }
                }
            }
            // The grid decides; fixed cell widths would contradict it.
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                if matches!(cell.props.width, Some(TableWidth::Twips(_))) {
                    cell.props.width = None;
                }
            }
            Ok(())
        })
    }

    pub(super) fn set_table_wrap(
        &mut self,
        table: NodeId,
        floating: Option<TablePosition>,
        ch: &mut Changes,
    ) -> R<C> {
        let t = self.table_mut(table)?;
        let old = t.props.clone();
        t.props.floating = floating;
        ch.block(table);
        Ok(C::RestoreTableProps { table, props: old })
    }
}
