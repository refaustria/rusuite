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
    Anchor, Block, CellProperties, FieldKind, HeaderSlot, Inline, LevelKind, MediaId, NodeId, Note,
    NoteKind, Numbering, Orientation, PageSetup, Paragraph, ParagraphProperties, RowHeight,
    RowProperties, RunProperties, Section, SectionId, SectionKind, Style, StyleKind, StylePatch,
    StyleSheet, Table, TableCell, TableProperties, TableRow, Toc, TocEntry, Twips, VMerge,
    WrapKind,
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
/// explicit `width`/`height`, then the margins. `headerText`/`footerText`
/// replace the default header/footer text (`{PAGE}` = page number); an
/// empty string removes the header/footer.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer_text: Option<String>,
}

/// Section changes for [`WriteCommand::SetSection`]; absent fields keep
/// their value. `pageNumberStart: 0` removes the restart. `page` changes
/// size, orientation and margins like [`WriteCommand::SetPage`] (its
/// header/footer text fields are ignored; use `setHeaderFooter`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct SectionPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<SectionKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<i32>")]
    pub column_space: Option<Twips>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_page: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_number_start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_number_format: Option<LevelKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageSetupPatch>,
}

/// Formatting a find (or replace) is restricted to (Word's Find › Format):
/// every matched character must have these effective run properties
/// (paragraph style → character style → direct), its paragraph these
/// effective paragraph properties (only `alignment`, `indent`, `spacing`,
/// `keepNext`, `pageBreakBefore` are compared), and `style` must be the
/// paragraph's style or the run's character style. `highlight: true` =
/// any highlight, `false` = none. As a replacement format the same fields
/// are applied to the replaced text (a paragraph style to its paragraph).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct FindFormat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<app_common::wire::RunProperties>", optional)]
    pub run: Option<RunProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub paragraph: Option<ParagraphProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub highlight: Option<bool>,
}

impl FindFormat {
    /// Whether nothing is constrained.
    pub fn is_empty(&self) -> bool {
        self.run.as_ref().map_or(true, RunProperties::is_empty)
            && self
                .paragraph
                .as_ref()
                .map_or(true, ParagraphProperties::is_empty)
            && self.style.as_deref().map_or(true, str::is_empty)
            && self.highlight.is_none()
    }
}

/// A search (Find and Replace dialog). `text` empty with a `format` finds
/// the stretches of text with that formatting. `wildcards` (Word's "Use
/// wildcards", always case-sensitive, whole words ignored): `?` any
/// character, `*` any run of characters (shortest), `[abc]` / `[a-z]` /
/// `[!a-z]` a character (not) in the set, `{n}` / `{n,}` / `{n,m}` and `@`
/// (one or more) repeat the previous item, `<` / `>` start / end of a
/// word, `\` escapes; parentheses group without capturing.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct FindQuery {
    pub text: String,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub wildcards: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub format: Option<FindFormat>,
}

/// One match: char offsets `from..to` of paragraph `block`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct FindMatch {
    pub block: NodeId,
    pub from: u32,
    pub to: u32,
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
    /// Inserts `text` at `offset`. `props` absent = the formatting (and
    /// character style) of the run containing the character before
    /// `offset` (or of the first run); with `props`, `style` is the
    /// character style of the new text. `text` must not contain `\n`/`\r`
    /// (split the paragraph instead).
    InsertText {
        block: NodeId,
        offset: u32,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(as = "Option<app_common::wire::RunProperties>")]
        props: Option<RunProperties>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        style: Option<String>,
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
    /// Merges `patch` into the direct properties of each paragraph
    /// (borders side by side, tab stops by position — a `clear` stop
    /// removes one; `shading: auto` removes the direct shading).
    SetParagraphProps {
        blocks: Vec<NodeId>,
        patch: ParagraphProperties,
    },
    /// Sets the paragraph style (must be a paragraph or linked style of the
    /// document).
    SetStyle { blocks: Vec<NodeId>, style: String },
    /// Gives the runs of `from..to` the character style `style` (a
    /// character style, or a linked style — its character half is used;
    /// `null` / `""` removes the character style), splitting runs at the
    /// boundaries.
    ApplyCharacterStyle {
        block: NodeId,
        from: u32,
        to: u32,
        #[serde(default)]
        style: Option<String>,
    },
    /// Adds a style (Word's "Create a Style" / "New Style"; see
    /// `model_text::StyleSheet::add`).
    AddStyle { style: Style },
    /// Changes a style (Word's "Modify Style"; `StyleSheet::update`). The
    /// patch reports the styles and every paragraph using the style or a
    /// style based on it.
    UpdateStyle { id: String, patch: StylePatch },
    /// Changes a style's display name.
    RenameStyle { id: String, name: String },
    /// Deletes a user-defined style; paragraphs using it get `replacement`
    /// (default: the default paragraph style), runs lose it
    /// (`Document::delete_style`).
    DeleteStyle {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        replacement: Option<String>,
    },
    /// Makes `id` the default style of `kind` (`StyleSheet::set_default`).
    SetDefaultStyle { kind: StyleKind, id: String },
    /// Word's "Update `X` to Match Selection": the effective paragraph
    /// formatting of `block` and the effective run formatting at `offset`
    /// become the style's (where they differ from what the style gives),
    /// the paragraph gets the style (a character style: the run at
    /// `offset` is the sample and the style's run formatting changes
    /// only), and the paragraph's direct paragraph formatting and the
    /// direct run formatting now covered by the style are removed.
    UpdateStyleFromSelection {
        id: String,
        block: NodeId,
        offset: u32,
    },
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
    /// replace the grid and drop the cells' fixed widths; borders and
    /// cell margins merge side by side; `style: ""` removes the table
    /// style, a built-in table style missing from the document — Table
    /// Grid, Plain Table 1, List Table 3, Grid Table 4 Accent 1–3 — is
    /// added to it with Word's definition).
    SetTableProps {
        table: NodeId,
        patch: TableProperties,
    },
    /// Changes the page setup.
    SetPage { patch: PageSetupPatch },
    /// Resizes the inline image at position `offset` of `block` (Word's
    /// drag handles; both extents must be positive).
    SetImageSize {
        block: NodeId,
        offset: u32,
        #[ts(type = "number")]
        width: Emu,
        #[ts(type = "number")]
        height: Emu,
    },
    /// Sets (or with `null`/empty, removes) the alternative text of the
    /// inline image at position `offset` of `block`.
    SetImageAlt {
        block: NodeId,
        offset: u32,
        #[serde(default)]
        alt: Option<String>,
    },
    /// Changes rows `rows` (indices) of `table`: `header` sets "repeat as
    /// header row", `height` sets the row height (a value `<= 0` makes it
    /// automatic), `cantSplit` keeps the row on one page. Absent fields
    /// keep their value.
    SetRowProps {
        table: NodeId,
        rows: Vec<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        header: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<RowHeight>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        cant_split: Option<bool>,
    },
    /// Merges the cells of rows `top..=bottom` and grid columns
    /// `left..=right` of `table` (Word's "Merge Cells": the top-left cell
    /// receives the content of all non-empty cells; see
    /// `model_text::Table::merge_cells`). The rectangle must not cut a
    /// merged cell. The patch replaces the table.
    MergeCells {
        table: NodeId,
        top: u32,
        left: u32,
        bottom: u32,
        right: u32,
    },
    /// Splits the cell covering grid column `col` of row `row` (or its
    /// merged region) into `rows × cols` cells (Word's "Split Cells"; see
    /// `model_text::Table::split_cell`). New cells get fresh ids; the
    /// patch replaces the table.
    SplitCell {
        table: NodeId,
        row: u32,
        col: u32,
        rows: u32,
        cols: u32,
    },
    /// Makes the image at position `offset` of `block` floating with
    /// `anchor`, or (`null`) inline again.
    SetImageAnchor {
        block: NodeId,
        offset: u32,
        #[serde(default)]
        anchor: Option<Anchor>,
    },
    /// Sets the text wrapping of the image at position `offset` of
    /// `block`; an inline image becomes floating at Word's default
    /// position (offset 0 from its column and paragraph).
    SetImageWrap {
        block: NodeId,
        offset: u32,
        wrap: WrapKind,
    },
    /// Removes the direct character formatting and character styles of
    /// `from..to` (Word's Ctrl+Space); with `paragraph`, also the
    /// paragraph's direct formatting, list numbering and style (Word's
    /// "Clear All Formatting": the paragraph becomes Normal) — with
    /// `keepStyle` the paragraph keeps its style and numbering and only its
    /// direct paragraph formatting goes.
    ClearFormatting {
        block: NodeId,
        from: u32,
        to: u32,
        #[serde(default)]
        paragraph: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        keep_style: bool,
    },
    /// Replaces matches of `find` in the text of every body paragraph (a
    /// match may span runs; the replacement takes the formatting of the
    /// first matched character). `all == false` replaces only the first
    /// match. `wildcards` and `format` restrict the search like
    /// [`FindQuery`]; `replaceFormat` is applied to the replacement. With
    /// an empty `replace` and a `replaceFormat` the matched text is kept
    /// and only reformatted (Word's "replace formatting"). The patch's
    /// `info` reports the count (`"3 replacements"`). One undo step.
    FindReplace {
        find: String,
        replace: String,
        match_case: bool,
        whole_word: bool,
        all: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        wildcards: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        format: Option<FindFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        replace_format: Option<FindFormat>,
    },
    /// Inserts a field (page number, date, …) at `offset`, formatted like
    /// typed text there. `cached` is the result shown until the UI
    /// recomputes it (default empty).
    InsertField {
        block: NodeId,
        offset: u32,
        field: FieldKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cached: Option<String>,
    },
    /// Inserts a footnote (or endnote) reference at `offset` of the body
    /// paragraph `block` and a new note holding `text` (one paragraph of
    /// style `FootnoteText`/`EndnoteText`; these styles and the reference
    /// styles are added with Word's definitions when missing). The note
    /// and its paragraph id are in the patch's `notes`.
    InsertFootnote {
        block: NodeId,
        offset: u32,
        text: String,
        #[serde(default)]
        kind: NoteKind,
    },
    /// Deletes note `id` and every reference to it.
    DeleteFootnote { id: u32 },
    /// Replaces the content of note `id` (the coarse fallback for edits the
    /// text commands cannot express; new blocks may use temporary ids).
    ReplaceNote {
        id: u32,
        #[ts(as = "Vec<model_text::Block>")]
        blocks: Vec<NewBlock>,
    },
    /// Inserts a table of contents over outline levels
    /// `fromLevel..=toLevel` (default 1–3) after the body block `after`
    /// (absent = at the start), built from the headings with `page: null`.
    /// Adds the `TOCHeading`/`TOC1…` styles when missing. `newId`: a
    /// temporary id for the block.
    InsertToc {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<NodeId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_level: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_level: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(type = "number")]
        new_id: Option<i64>,
    },
    /// Rebuilds the entries of table of contents `id` from the headings;
    /// `pages` (`[heading, page]`, from the UI's pagination) fills in page
    /// numbers.
    UpdateToc {
        id: NodeId,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(type = "Array<[NodeId, number]>")]
        pages: Vec<(NodeId, u32)>,
    },
    /// Word's "Restart numbering": `block` and the following paragraphs of
    /// its list get a new list sharing the definition, whose level of
    /// `block` restarts at `start` (default: the level's start value).
    RestartList {
        block: NodeId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<u32>,
    },
    /// Word's "Continue numbering": `block` and the following paragraphs of
    /// its list join the nearest previous list of the same kind (sharing
    /// its definition or, failing that, bulleted vs numbered).
    ContinueList { block: NodeId },
    /// Makes the top-level body paragraph `block` the last paragraph of a
    /// new section: the section containing it is split; the part before
    /// keeps its properties and headers, the part after starts `kind`
    /// (next page, continuous, …) and links to the previous headers.
    InsertSectionBreak { block: NodeId, kind: SectionKind },
    /// Removes the break ending section `section` (not the last): its text
    /// joins the following section (which inherits its headers where it
    /// had none).
    RemoveSectionBreak { section: SectionId },
    /// Changes section `section`.
    SetSection {
        section: SectionId,
        patch: SectionPatch,
    },
    /// Sets (or with `null`, removes) a header (`footer: false`) or footer
    /// of a section; blocks may use temporary ids.
    SetHeaderFooter {
        section: SectionId,
        footer: bool,
        slot: HeaderSlot,
        #[serde(default)]
        #[ts(as = "Option<Vec<model_text::Block>>")]
        blocks: Option<Vec<NewBlock>>,
    },
    /// Sets the cached results of fields: `[block, offset, text]` for the
    /// field at position `offset` of paragraph `block` (body, cells, notes,
    /// headers and footers). The UI computes them (page numbers from its
    /// pagination, date and time from the clock, the file name from the
    /// document name) before saving.
    UpdateFields {
        #[ts(type = "Array<[NodeId, number, string]>")]
        values: Vec<(NodeId, u32, String)>,
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
    RemoveMedia {
        #[ts(as = "model_text::media::MediaIdTs")]
        id: MediaId,
    },
    /// *Internal.* Replaces all notes.
    RestoreNotes { notes: Vec<Note> },
    /// *Internal.* Replaces the style sheet.
    RestoreStyles { styles: StyleSheet },
    /// *Internal.* Replaces the sections and the page setup.
    RestoreSections {
        sections: Vec<Section>,
        page: PageSetup,
    },
    /// *Internal.* Puts a media item back under its old id.
    RestoreMedia {
        #[ts(as = "model_text::media::MediaIdTs")]
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
    Toc(NewToc),
}

/// [`Toc`] with a possibly temporary id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewToc {
    pub id: i64,
    pub from_level: u8,
    pub to_level: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub entries: Vec<TocEntry>,
}

impl From<&Toc> for NewToc {
    fn from(t: &Toc) -> Self {
        NewToc {
            id: wire_id(t.id),
            from_level: t.from_level,
            to_level: t.to_level,
            title: t.title.clone(),
            entries: t.entries.clone(),
        }
    }
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
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub grid_span: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v_merge: Option<VMerge>,
    #[serde(default)]
    pub blocks: Vec<NewBlock>,
}

fn one() -> u16 {
    1
}

fn is_one(v: &u16) -> bool {
    *v == 1
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
            Block::Toc(t) => NewBlock::Toc(NewToc::from(t)),
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
            grid_span: c.grid_span,
            v_merge: c.v_merge,
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
            NewBlock::Toc(t) => t.id,
        }
    }
}
