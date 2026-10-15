//! The [`Document`]: body, styles, numbering, page setup and media.

use core_model::RunProperties;
use serde::{Deserialize, Serialize};

use crate::block::{Block, NodeId, Paragraph};
use crate::inline::{Inline, Run};
use crate::media::MediaStore;
use crate::numbering::Numbering;
use crate::page::PageSetup;
use crate::props::ParagraphProperties;
use crate::style::{StyleKind, StyleSheet};

/// A Write document.
///
/// Serializes with all node ids; the id counter is not serialized but
/// recomputed on load as the largest id + 1 (see [`crate::snapshot`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "crate::snapshot::DocumentData")]
pub struct Document {
    /// Top-level blocks in order.
    pub body: Vec<Block>,
    /// Styles and document defaults.
    pub styles: StyleSheet,
    /// List definitions.
    pub numbering: Numbering,
    /// Page size and margins.
    pub page: PageSetup,
    /// Images and other binary parts.
    pub media: MediaStore,
    #[serde(skip)]
    pub(crate) next_id: u64,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Document {
    /// A new document: one empty Normal paragraph, Word's default styles,
    /// A4 page, no lists, no media.
    pub fn new() -> Self {
        let mut doc = Self::empty(StyleSheet::office_defaults(), PageSetup::a4());
        let id = doc.alloc_id();
        doc.body.push(Block::Paragraph(Paragraph::new(id)));
        doc
    }

    /// A document with an empty body (not normalized), e.g. for importers.
    pub fn empty(styles: StyleSheet, page: PageSetup) -> Self {
        Self {
            body: Vec::new(),
            styles,
            numbering: Numbering::default(),
            page,
            media: MediaStore::new(),
            next_id: 1,
        }
    }

    /// Allocates a fresh, document-unique node id.
    pub fn alloc_id(&mut self) -> NodeId {
        let id = NodeId(self.next_id);
        self.next_id += 1;
        id
    }

    /// The paragraph or table with id `id`, searching inside tables.
    pub fn find_block(&self, id: NodeId) -> Option<&Block> {
        find_in(&self.body, id)
    }

    /// Mutable access to the paragraph or table with id `id`.
    pub fn find_block_mut(&mut self, id: NodeId) -> Option<&mut Block> {
        find_in_mut(&mut self.body, id)
    }

    /// The paragraph with id `id`, searching inside tables.
    pub fn find_paragraph(&self, id: NodeId) -> Option<&Paragraph> {
        self.find_block(id).and_then(Block::as_paragraph)
    }

    /// All paragraphs in document order, including those in table cells.
    pub fn paragraphs(&self) -> impl Iterator<Item = &Paragraph> {
        paragraphs_in(&self.body)
    }

    /// The document text: paragraphs joined by `'\n'` (see
    /// [`Paragraph::text`] for tabs, images and breaks).
    pub fn plain_text(&self) -> String {
        let mut out = String::new();
        for (i, p) in self.paragraphs().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            p.push_text(&mut out);
        }
        out
    }

    /// Number of words: maximal runs of characters that are neither
    /// whitespace nor images, across run boundaries within a paragraph.
    pub fn word_count(&self) -> usize {
        self.paragraphs()
            .map(|p| {
                p.text()
                    .split(|c: char| c.is_whitespace() || c == '\u{FFFC}')
                    .filter(|w| !w.is_empty())
                    .count()
            })
            .sum()
    }

    /// The id of the style that applies to `p`: its own style if it exists,
    /// otherwise the default paragraph style.
    fn effective_style<'a>(&'a self, p: &'a Paragraph) -> Option<&'a str> {
        p.props
            .style
            .as_deref()
            .filter(|id| self.styles.get(id).is_some())
            .or_else(|| {
                self.styles
                    .default_style(StyleKind::Paragraph)
                    .map(|s| s.id.as_str())
            })
    }

    /// Effective paragraph formatting of `p`: document defaults → style
    /// chain → numbering level indent → direct formatting. The result's
    /// `style` is the effective style id (unknown ids fall back to the
    /// default paragraph style).
    pub fn resolve_paragraph_props(&self, p: &Paragraph) -> ParagraphProperties {
        let style = self.effective_style(p);
        let mut out = match style {
            Some(id) => self.styles.resolve_paragraph(id),
            None => self.styles.defaults.paragraph.clone(),
        };
        let num = p.props.numbering.or(out.numbering);
        if let Some(indent) = num.and_then(|n| self.numbering.level(n)?.indent) {
            out.indent = Some(out.indent.unwrap_or_default().merged_with(&indent));
        }
        out.apply(&p.props);
        out.style = style.map(str::to_owned);
        out
    }

    /// Effective character formatting of `run` in `p`: document defaults →
    /// paragraph style chain → direct formatting. (Character styles are not
    /// part of the MVP.)
    pub fn resolve_run_props(&self, p: &Paragraph, run: &Run) -> RunProperties {
        let base = match self.effective_style(p) {
            Some(id) => self.styles.resolve_run(id),
            None => self.styles.defaults.run.clone(),
        };
        base.merged_with(&run.props)
    }

    /// Canonicalizes the content: merges adjacent runs with equal
    /// formatting, drops empty runs, and makes the body and every table
    /// cell non-empty and end with a paragraph (adding an empty one if
    /// needed, as Word requires). Text is preserved.
    pub fn normalize(&mut self) {
        let mut next_id = self.next_id;
        normalize_blocks(&mut self.body, &mut next_id);
        self.next_id = next_id;
    }

    /// Largest node id in use (0 if none).
    pub(crate) fn max_node_id(&self) -> u64 {
        fn walk(blocks: &[Block], max: &mut u64) {
            for b in blocks {
                *max = (*max).max(b.id().0);
                if let Block::Table(t) = b {
                    for row in &t.rows {
                        *max = (*max).max(row.id.0);
                        for cell in &row.cells {
                            *max = (*max).max(cell.id.0);
                            walk(&cell.blocks, max);
                        }
                    }
                }
            }
        }
        let mut max = 0;
        walk(&self.body, &mut max);
        max
    }
}

fn find_in(blocks: &[Block], id: NodeId) -> Option<&Block> {
    for b in blocks {
        if b.id() == id {
            return Some(b);
        }
        if let Block::Table(t) = b {
            for cell in t.rows.iter().flat_map(|r| &r.cells) {
                if let Some(found) = find_in(&cell.blocks, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn find_in_mut(blocks: &mut [Block], id: NodeId) -> Option<&mut Block> {
    for b in blocks {
        if b.id() == id {
            return Some(b);
        }
        if let Block::Table(t) = b {
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                if let Some(found) = find_in_mut(&mut cell.blocks, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn paragraphs_in<'a>(blocks: &'a [Block]) -> Box<dyn Iterator<Item = &'a Paragraph> + 'a> {
    Box::new(
        blocks
            .iter()
            .flat_map(|b| -> Box<dyn Iterator<Item = &'a Paragraph> + 'a> {
                match b {
                    Block::Paragraph(p) => Box::new(std::iter::once(p)),
                    Block::Table(t) => Box::new(
                        t.rows
                            .iter()
                            .flat_map(|r| &r.cells)
                            .flat_map(|c| paragraphs_in(&c.blocks)),
                    ),
                }
            }),
    )
}

fn normalize_blocks(blocks: &mut Vec<Block>, next_id: &mut u64) {
    for b in blocks.iter_mut() {
        match b {
            Block::Paragraph(p) => merge_runs(&mut p.inlines),
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    normalize_blocks(&mut cell.blocks, next_id);
                }
            }
        }
    }
    if !matches!(blocks.last(), Some(Block::Paragraph(_))) {
        blocks.push(Block::Paragraph(Paragraph::new(NodeId(*next_id))));
        *next_id += 1;
    }
}

fn merge_runs(inlines: &mut Vec<Inline>) {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    for inline in inlines.drain(..) {
        match (out.last_mut(), inline) {
            (_, Inline::Run(run)) if run.text.is_empty() => {}
            (Some(Inline::Run(prev)), Inline::Run(run)) if prev.props == run.props => {
                prev.text.push_str(&run.text);
            }
            (_, other) => out.push(other),
        }
    }
    *inlines = out;
}
