//! Block-level content: paragraphs, tables and tables of contents.

use serde::{Deserialize, Serialize};

use crate::inline::{Inline, Run};
use crate::props::{CellProperties, ParagraphProperties, RowProperties, TableProperties, VMerge};

/// Document-unique id of a paragraph, table, row or cell.
///
/// Allocated by [`crate::Document::alloc_id`], persisted in snapshots, never
/// written to docx. Serializes as a plain number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct NodeId(#[cfg_attr(feature = "ts", ts(type = "number"))] pub u64);

/// A block: paragraph, table or table of contents.
///
/// Serializes as `{"kind":"paragraph","value":{…}}`,
/// `{"kind":"table","value":{…}}` or `{"kind":"toc","value":{…}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum Block {
    /// A paragraph (also headings and list items).
    Paragraph(Paragraph),
    /// A table.
    Table(Table),
    /// A table of contents generated from the headings.
    Toc(Toc),
}

impl Block {
    /// The block's id.
    pub fn id(&self) -> NodeId {
        match self {
            Block::Paragraph(p) => p.id,
            Block::Table(t) => t.id,
            Block::Toc(t) => t.id,
        }
    }

    /// The paragraph, if this block is one.
    pub fn as_paragraph(&self) -> Option<&Paragraph> {
        match self {
            Block::Paragraph(p) => Some(p),
            _ => None,
        }
    }

    /// The table, if this block is one.
    pub fn as_table(&self) -> Option<&Table> {
        match self {
            Block::Table(t) => Some(t),
            _ => None,
        }
    }

    /// The table of contents, if this block is one.
    pub fn as_toc(&self) -> Option<&Toc> {
        match self {
            Block::Toc(t) => Some(t),
            _ => None,
        }
    }
}

/// A paragraph: a sequence of inlines with paragraph formatting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Paragraph {
    /// Node id.
    pub id: NodeId,
    /// Direct paragraph formatting (including the style reference).
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub props: ParagraphProperties,
    /// Content.
    #[serde(default)]
    pub inlines: Vec<Inline>,
    /// The computed list label (`1.`, `1.1`, `a)`, `•`) of a numbered
    /// paragraph. Derived data: filled by `write-core` in the documents
    /// and patches it sends (see [`crate::Document::list_numbers`]),
    /// ignored on input and never written to docx.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub list_label: Option<String>,
}

impl Paragraph {
    /// An empty paragraph without formatting.
    pub fn new(id: NodeId) -> Self {
        Self {
            id,
            props: ParagraphProperties::default(),
            inlines: Vec::new(),
            list_label: None,
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

    /// The paragraph's text: runs verbatim (tabs kept), images, drawings
    /// and fields as U+FFFC, line breaks as U+000B, page breaks as U+000C, note
    /// references as U+0002 (as Word's `Range.Text`), column breaks as
    /// U+000E and comment/bookmark markers as U+FEFF. One char per position (see [`Paragraph::len`]).
    pub fn text(&self) -> String {
        let mut out = String::new();
        self.push_text(&mut out);
        out
    }

    /// Number of positions in the paragraph: characters (Unicode scalar
    /// values) of the runs plus one per image, break, field, note
    /// reference or comment marker, i.e. the char length of [`Paragraph::text`]. Offsets into a paragraph (ADR 0007)
    /// range over `0..=len()`.
    pub fn len(&self) -> usize {
        self.inlines
            .iter()
            .map(|i| match i {
                Inline::Run(run) => run.text.chars().count(),
                _ => 1,
            })
            .sum()
    }

    /// Whether the paragraph has no content.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Merges adjacent runs with equal formatting and drops empty runs
    /// (the paragraph part of [`crate::Document::normalize`]).
    pub fn normalize(&mut self) {
        crate::document::merge_runs(&mut self.inlines);
    }

    /// The drawings (shapes, text boxes) of the paragraph.
    pub fn drawings(&self) -> impl Iterator<Item = &crate::drawing::Drawing> {
        self.inlines.iter().filter_map(|i| match i {
            Inline::Drawing(d) => Some(&**d),
            _ => None,
        })
    }

    /// Mutable [`Paragraph::drawings`].
    pub fn drawings_mut(&mut self) -> impl Iterator<Item = &mut crate::drawing::Drawing> {
        self.inlines.iter_mut().filter_map(|i| match i {
            Inline::Drawing(d) => Some(&mut **d),
            _ => None,
        })
    }

    pub(crate) fn push_text(&self, out: &mut String) {
        for inline in &self.inlines {
            match inline {
                Inline::Run(run) => out.push_str(&run.text),
                Inline::Image(_) | Inline::Drawing(_) => out.push('\u{FFFC}'),
                Inline::Break(crate::BreakKind::Line) => out.push('\u{000B}'),
                Inline::Break(crate::BreakKind::Page) => out.push('\u{000C}'),
                Inline::Break(crate::BreakKind::Column) => out.push('\u{000E}'),
                Inline::Field(_) => out.push('\u{FFFC}'),
                Inline::NoteRef(_) => out.push('\u{0002}'),
                Inline::CommentStart { .. }
                | Inline::CommentEnd { .. }
                | Inline::BookmarkStart { .. }
                | Inline::BookmarkEnd { .. } => out.push('\u{FEFF}'),
            }
        }
    }

    /// The text a reader sees: runs (tabs kept), field results, line
    /// breaks as spaces; images, note references and comment markers
    /// omitted. Used for
    /// headings in a table of contents and the plain text of headers.
    pub fn display_text(&self) -> String {
        let mut out = String::new();
        for inline in &self.inlines {
            match inline {
                Inline::Run(run) => out.push_str(&run.text),
                Inline::Field(f) => out.push_str(&f.cached),
                Inline::Break(_) => out.push(' '),
                Inline::Image(_)
                | Inline::Drawing(_)
                | Inline::NoteRef(_)
                | Inline::CommentStart { .. }
                | Inline::CommentEnd { .. }
                | Inline::BookmarkStart { .. }
                | Inline::BookmarkEnd { .. } => {}
            }
        }
        out
    }
}

/// A table. Rows hold cells left to right; with merged cells
/// ([`TableCell::grid_span`], [`TableCell::v_merge`]) every row should
/// cover the same number of grid columns (see [`Table::merge_cells`],
/// [`Table::split_cell`] and the other helpers in `crate::table`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
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
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
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
///
/// Merged cells follow docx: a horizontally merged cell spans
/// `grid_span` grid columns; a vertically merged region is a
/// [`VMerge::Restart`] cell followed, in the rows below at the same grid
/// column and span, by [`VMerge::Continue`] cells (see [`Table`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TableCell {
    /// Node id.
    pub id: NodeId,
    /// Cell formatting.
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub props: CellProperties,
    /// Number of grid columns the cell spans (docx `w:gridSpan`, ≥ 1).
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub grid_span: u16,
    /// Vertical merge state (docx `w:vMerge`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub v_merge: Option<VMerge>,
    /// Content.
    pub blocks: Vec<Block>,
}

fn one() -> u16 {
    1
}

fn is_one(v: &u16) -> bool {
    *v == 1
}

impl TableCell {
    /// A cell spanning one column, not merged.
    pub fn new(id: NodeId, props: CellProperties, blocks: Vec<Block>) -> Self {
        Self {
            id,
            props,
            grid_span: 1,
            v_merge: None,
            blocks,
        }
    }

    /// The span, at least 1.
    pub fn span(&self) -> usize {
        usize::from(self.grid_span.max(1))
    }
}

/// One entry of a [`Toc`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TocEntry {
    /// The heading text.
    pub text: String,
    /// Outline level, 1-based (Heading 1 = 1).
    pub level: u8,
    /// Page number of the heading; `None` until the UI's pagination
    /// fills it in (or as read from the file's cached TOC).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub page: Option<u32>,
    /// The heading paragraph.
    pub target: NodeId,
}

/// A table of contents: entries generated from the headings of the
/// outline levels `from_level..=to_level` (docx: the `TOC \o "1-3"`
/// field with its cached result, inside a "Table of Contents" `w:sdt`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Toc {
    /// Node id.
    pub id: NodeId,
    /// Shallowest outline level included (1 = Heading 1).
    pub from_level: u8,
    /// Deepest outline level included.
    pub to_level: u8,
    /// A title paragraph shown above the entries ("Contents").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub title: Option<String>,
    /// The entries in document order.
    #[serde(default)]
    pub entries: Vec<TocEntry>,
    /// A table of figures: the sequence identifier (`Figure`, `Table`)
    /// whose captions are listed instead of headings (docx `TOC \c
    /// "Figure"`); the levels are then ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub caption: Option<String>,
}

impl Toc {
    /// An empty table of contents over Heading 1–3 without title.
    pub fn new(id: NodeId) -> Self {
        Self {
            id,
            from_level: 1,
            to_level: 3,
            title: None,
            entries: Vec::new(),
            caption: None,
        }
    }
}
