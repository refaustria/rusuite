//! [`WriteCommand`]: every edit the UI can send (ADR 0007 §3).
//!
//! Blocks are addressed by [`NodeId`]; positions inside a paragraph by a
//! char offset: Unicode scalar values of the runs' text, where an image or
//! a break counts as one position (the char length of
//! [`Paragraph::text`](model_text::Paragraph::text)). Offsets range over
//! `0..=len`.
//!
//! Blocks created by the UI carry *temporary* negative ids; the patch's
//! `idMap` lists `[temp, real]` for each of them.

use core_model::units::Emu;
use model_text::{
    Block, CellProperties, Inline, MediaId, NodeId, Numbering, Orientation, Paragraph,
    ParagraphProperties, RowProperties, RunProperties, Table, TableCell, TableProperties, TableRow,
    Twips,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// List kind for [`WriteCommand::ApplyList`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub enum ListKind {
    /// Bulleted list.
    Bullet,
    /// Numbered list (`1.`, `a.`, `i.` by level).
    Decimal,
    /// Removes the numbering.
    None,
}

/// Page margins to change; absent fields keep their value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct MarginsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub top: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub right: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub bottom: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub left: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub header: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub footer: Option<Twips>,
}

/// Page setup changes for [`WriteCommand::SetPage`]. `orientation` is
/// applied first (swapping width and height when it changes), then the
/// explicit `width`/`height`, then the margins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct PageSetupPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<Orientation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub width: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub height: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margins: Option<MarginsPatch>,
}

/// A document edit. JSON: `{"type":"insertText","block":7,"offset":3,"text":"é"}`.
///
/// The variants after [`Compound`](Self::Compound) are **internal**: the
/// document produces them as inverses for undo/redo. They are
/// serializable (the undo stack holds commands) but the UI never needs to
/// send them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/write/src/generated/")]
pub enum WriteCommand {
    /// Inserts `text` at `offset`. `props` absent = the formatting of the
    /// run containing the character before `offset` (or of the first run).
    /// `text` must not contain `\n`/`\r` (split the paragraph instead).
    InsertText {
        block: NodeId,
        offset: u32,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(as = "Option<app_common::wire::RunProperties>")]
        props: Option<RunProperties>,
    },
    /// Deletes positions `from..to` (text, images and breaks).
    DeleteText { block: NodeId, from: u32, to: u32 },
    /// Replaces `from..to` by `text`, formatted like the first replaced
    /// character (like [`InsertText`](Self::InsertText) when `from == to`).
    ReplaceText {
        block: NodeId,
        from: u32,
        to: u32,
        text: String,
    },
    /// Merges `patch` into the formatting of `from..to`, splitting runs at
    /// the boundaries. `false` for bold/italic/strike removes the direct
    /// value unless the paragraph style turns it on (then it stays an
    /// explicit `false`).
    SetRunProps {
        block: NodeId,
        from: u32,
        to: u32,
        #[ts(as = "app_common::wire::RunProperties")]
        patch: RunProperties,
    },
    /// Splits `block` at `offset`; the second half becomes a new paragraph
    /// (id `newId`, normally a temporary negative id) after it, with the
    /// same properties except that a style with a `next` style (headings,
    /// title) switches to it (like Word's Enter). `0` and the end are
    /// allowed (an empty paragraph results).
    SplitParagraph {
        block: NodeId,
        offset: u32,
        #[ts(type = "number")]
        new_id: i64,
    },
    /// The previous sibling paragraph absorbs the inlines of `block`, which
    /// is removed (Backspace at the start of a paragraph). Errors when
    /// `block` is the first block of its container or follows a table.
    JoinWithPrevious { block: NodeId },
    /// Merges `patch` into the direct properties of each paragraph.
    SetParagraphProps {
        blocks: Vec<NodeId>,
        patch: ParagraphProperties,
    },
    /// Sets the paragraph style (must be a paragraph style of the document).
    SetStyle { blocks: Vec<NodeId>, style: String },
    /// Makes the paragraphs list items of `kind` (reusing the list of an
    /// adjacent paragraph of the same kind, else creating a new list) or
    /// removes their numbering (`none`).
    ApplyList { blocks: Vec<NodeId>, kind: ListKind },
    /// Changes the list level of numbered paragraphs by `delta`, clamped to
    /// `0..=8`; paragraphs without numbering are left alone.
    IndentList { blocks: Vec<NodeId>, delta: i8 },
    /// Inserts `blocks` (temporary or unused ids) after the block `after`
    /// of the body (`parent` absent) or of the table cell `parent`;
    /// `after` absent = at the start.
    InsertBlocks {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<NodeId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent: Option<NodeId>,
        #[ts(as = "Vec<model_text::Block>")]
        blocks: Vec<NewBlock>,
    },
    /// Deletes blocks (paragraphs or tables, anywhere). A container that
    /// becomes empty gets an empty paragraph.
    DeleteBlocks { ids: Vec<NodeId> },
    /// Replaces the consecutive sibling blocks `ids` by `blocks` (the
    /// always-correct fallback of ADR 0007 §3). New blocks may carry
    /// temporary ids, reuse the replaced ids, or use unused ids.
    ReplaceBlocks {
        ids: Vec<NodeId>,
        #[ts(as = "Vec<model_text::Block>")]
        blocks: Vec<NewBlock>,
    },
    /// Inserts an inline image (bytes as standard base64) at `offset`.
    InsertImage {
        block: NodeId,
        offset: u32,
        content_type: String,
        bytes_base64: String,
        #[ts(type = "number")]
        width: Emu,
        #[ts(type = "number")]
        height: Emu,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        alt: Option<String>,
    },
    /// Inserts a `rows × cols` table with grid borders and equal column
    /// widths (positioned like [`InsertBlocks`](Self::InsertBlocks)).
    /// `newIds`: empty, or the temporary ids of the table, its rows, its
    /// cells (row-major), optionally followed by one id per cell for the
    /// cell's paragraph (row-major).
    InsertTable {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<NodeId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent: Option<NodeId>,
        rows: u32,
        cols: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(type = "Array<number>")]
        new_ids: Vec<i64>,
    },
    /// Inserts a row before row `at` (`at == rows` appends), formatted like
    /// its neighbour. `newIds`: empty, or the row id and one id per cell,
    /// optionally followed by one id per cell paragraph.
    InsertTableRow {
        table: NodeId,
        at: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(type = "Array<number>")]
        new_ids: Vec<i64>,
    },
    /// Deletes row `at` (not the only row).
    DeleteTableRow { table: NodeId, at: u32 },
    /// Inserts a column before column `at`. `newIds`: empty, or one cell id
    /// per row, optionally followed by one paragraph id per row.
    InsertTableCol {
        table: NodeId,
        at: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(type = "Array<number>")]
        new_ids: Vec<i64>,
    },
    /// Deletes column `at` (not the only column).
    DeleteTableCol { table: NodeId, at: u32 },
    /// Merges `patch` into each cell's properties (borders side by side).
    SetCellProps {
        cells: Vec<NodeId>,
        patch: CellProperties,
    },
    /// Merges `patch` into the table's properties (non-empty `colWidths`
    /// replace the grid; borders and cell margins merge side by side).
    SetTableProps {
        table: NodeId,
        patch: TableProperties,
    },
    /// Changes the page setup.
    SetPage { patch: PageSetupPatch },
    /// Replaces matches of `find` in the text of every paragraph (a match
    /// may span runs; the replacement takes the formatting of the first
    /// matched character). `all == false` replaces only the first match.
    /// The patch's `info` reports the count (`"3 replacements"`).
    FindReplace {
        find: String,
        replace: String,
        match_case: bool,
        whole_word: bool,
        all: bool,
    },
    /// Applies the commands in order as one undo step; all or nothing.
    Compound { commands: Vec<WriteCommand> },
    /// *Internal.* Replaces positions `from..to` of `block` by `inlines`.
    RestoreInlines {
        block: NodeId,
        from: u32,
        to: u32,
        inlines: Vec<Inline>,
    },
    /// *Internal.* Sets the direct properties of paragraphs.
    RestoreParagraphProps {
        items: Vec<(NodeId, ParagraphProperties)>,
    },
    /// *Internal.* Sets the properties of cells.
    RestoreCellProps {
        items: Vec<(NodeId, CellProperties)>,
    },
    /// *Internal.* Sets the properties of a table.
    RestoreTableProps {
        table: NodeId,
        props: TableProperties,
    },
    /// *Internal.* Replaces all list definitions.
    RestoreNumbering { numbering: Numbering },
    /// *Internal.* Removes a media item.
    RemoveMedia { id: MediaId },
    /// *Internal.* Puts a media item back under its old id.
    RestoreMedia {
        id: MediaId,
        content_type: String,
        bytes_base64: String,
    },
}

/// A block sent by the UI: the shape of [`Block`] (identical JSON), but
/// ids may be temporary negative numbers. TypeScript sees it as `Block`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum NewBlock {
    Paragraph(NewParagraph),
    Table(NewTable),
}

/// [`Paragraph`] with a possibly temporary id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewParagraph {
    pub id: i64,
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub props: ParagraphProperties,
    #[serde(default)]
    pub inlines: Vec<Inline>,
}

/// [`Table`] with possibly temporary ids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTable {
    pub id: i64,
    #[serde(default, skip_serializing_if = "TableProperties::is_empty")]
    pub props: TableProperties,
    pub rows: Vec<NewRow>,
}

/// [`TableRow`] with possibly temporary ids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRow {
    pub id: i64,
    #[serde(default, skip_serializing_if = "RowProperties::is_empty")]
    pub props: RowProperties,
    pub cells: Vec<NewCell>,
}

/// [`TableCell`] with possibly temporary ids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCell {
    pub id: i64,
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub props: CellProperties,
    #[serde(default)]
    pub blocks: Vec<NewBlock>,
}

fn wire_id(id: NodeId) -> i64 {
    i64::try_from(id.0).unwrap_or(i64::MAX)
}

impl From<&Block> for NewBlock {
    /// The same block with its real ids (used for inverses).
    fn from(block: &Block) -> Self {
        match block {
            Block::Paragraph(p) => NewBlock::Paragraph(NewParagraph::from(p)),
            Block::Table(t) => NewBlock::Table(NewTable::from(t)),
        }
    }
}

impl From<&Paragraph> for NewParagraph {
    fn from(p: &Paragraph) -> Self {
        NewParagraph {
            id: wire_id(p.id),
            props: p.props.clone(),
            inlines: p.inlines.clone(),
        }
    }
}

impl From<&Table> for NewTable {
    fn from(t: &Table) -> Self {
        NewTable {
            id: wire_id(t.id),
            props: t.props.clone(),
            rows: t.rows.iter().map(NewRow::from).collect(),
        }
    }
}

impl From<&TableRow> for NewRow {
    fn from(r: &TableRow) -> Self {
        NewRow {
            id: wire_id(r.id),
            props: r.props,
            cells: r.cells.iter().map(NewCell::from).collect(),
        }
    }
}

impl From<&TableCell> for NewCell {
    fn from(c: &TableCell) -> Self {
        NewCell {
            id: wire_id(c.id),
            props: c.props,
            blocks: c.blocks.iter().map(NewBlock::from).collect(),
        }
    }
}

impl NewBlock {
    /// The block's (possibly temporary) id.
    pub fn id(&self) -> i64 {
        match self {
            NewBlock::Paragraph(p) => p.id,
            NewBlock::Table(t) => t.id,
        }
    }
}
