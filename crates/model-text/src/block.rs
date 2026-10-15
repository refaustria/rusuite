//! Block-level content: paragraphs and tables.

use serde::{Deserialize, Serialize};

use crate::inline::{Inline, Run};
use crate::props::{CellProperties, ParagraphProperties, RowProperties, TableProperties};

/// Document-unique id of a paragraph, table, row or cell.
///
/// Allocated by [`crate::Document::alloc_id`], persisted in snapshots, never
/// written to docx. Serializes as a plain number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct NodeId(pub u64);

/// A block: paragraph or table.
///
/// Serializes as `{"kind":"paragraph","value":{…}}` or
/// `{"kind":"table","value":{…}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Block {
    /// A paragraph (also headings and list items).
    Paragraph(Paragraph),
    /// A table.
    Table(Table),
}

impl Block {
    /// The block's id.
    pub fn id(&self) -> NodeId {
        match self {
            Block::Paragraph(p) => p.id,
            Block::Table(t) => t.id,
        }
    }

    /// The paragraph, if this block is one.
    pub fn as_paragraph(&self) -> Option<&Paragraph> {
        match self {
            Block::Paragraph(p) => Some(p),
            Block::Table(_) => None,
        }
    }

    /// The table, if this block is one.
    pub fn as_table(&self) -> Option<&Table> {
        match self {
            Block::Table(t) => Some(t),
            Block::Paragraph(_) => None,
        }
    }
}

/// A paragraph: a sequence of inlines with paragraph formatting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    /// Node id.
    pub id: NodeId,
    /// Direct paragraph formatting (including the style reference).
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub props: ParagraphProperties,
    /// Content.
    #[serde(default)]
    pub inlines: Vec<Inline>,
}

impl Paragraph {
    /// An empty paragraph without formatting.
    pub fn new(id: NodeId) -> Self {
        Self {
            id,
            props: ParagraphProperties::default(),
            inlines: Vec::new(),
        }
    }

    /// A paragraph holding one unformatted run (none if `text` is empty).
    pub fn with_text(id: NodeId, text: &str) -> Self {
        let mut p = Self::new(id);
        if !text.is_empty() {
            p.inlines.push(Inline::Run(Run::new(text)));
        }
        p
    }

    /// The paragraph's text: runs verbatim (tabs kept), images as U+FFFC,
    /// line breaks as U+000B and page breaks as U+000C (as Word's
    /// `Range.Text`).
    pub fn text(&self) -> String {
        let mut out = String::new();
        self.push_text(&mut out);
        out
    }

    pub(crate) fn push_text(&self, out: &mut String) {
        for inline in &self.inlines {
            match inline {
                Inline::Run(run) => out.push_str(&run.text),
                Inline::Image(_) => out.push('\u{FFFC}'),
                Inline::Break(crate::BreakKind::Line) => out.push('\u{000B}'),
                Inline::Break(crate::BreakKind::Page) => out.push('\u{000C}'),
            }
        }
    }
}

/// A table (no merged cells in the MVP).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    /// Node id.
    pub id: NodeId,
    /// Table formatting.
    #[serde(default, skip_serializing_if = "TableProperties::is_empty")]
    pub props: TableProperties,
    /// Rows, top to bottom.
    pub rows: Vec<TableRow>,
}

/// A table row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRow {
    /// Node id.
    pub id: NodeId,
    /// Row formatting.
    #[serde(default, skip_serializing_if = "RowProperties::is_empty")]
    pub props: RowProperties,
    /// Cells, left to right.
    pub cells: Vec<TableCell>,
}

/// A table cell. Holds at least one block, and its last block is a
/// paragraph ([`crate::Document::normalize`] restores this invariant).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCell {
    /// Node id.
    pub id: NodeId,
    /// Cell formatting.
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub props: CellProperties,
    /// Content.
    pub blocks: Vec<Block>,
}
