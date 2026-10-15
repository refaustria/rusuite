//! [`WriteDocument`]: a [`model_text::Document`] behind the
//! [`app_common::Document`] trait.

use std::collections::{HashMap, HashSet};

use app_common::{Applied, DispatchError, Document as AppDocument};
use core_model::Color;
use model_text::media::{base64_decode, base64_encode};
use model_text::{
    Block, BorderSide, BorderStyle, CellProperties, Document, Inline, InlineImage, Media, NodeId,
    NumberingDef, NumberingRef, Paragraph, ParagraphProperties, Run, RunProperties, StyleKind,
    Table, TableBorders, TableCell, TableProperties, TableRow, Twips,
};

use crate::command::{ListKind, NewBlock, NewCell, NewParagraph, NewRow, NewTable, WriteCommand};
use crate::find::find_matches;
use crate::patch::{InsertedBlock, WritePatch};
use crate::text::{for_each_run_in, inherited_props, inlines_len, props_at, replace_range, slice};
use crate::tree::{
    all_ids, ancestors, collect_ids, container, container_mut, enclosing_table, find_cell,
    find_cell_mut, find_table_mut, for_each_paragraph_mut, position, Pos,
};

/// Errors of [`WriteDocument`]; [`code`](Self::code) is the stable
/// [`DispatchError::code`].
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum WriteError {
    /// No paragraph, table, row or cell has this id.
    #[error("unknown block {0}")]
    UnknownBlock(u64),
    /// An offset outside `0..=len` or a reversed range.
    #[error("offset {from}..{to} out of range 0..={len} in block {block}")]
    BadOffset {
        block: u64,
        from: u32,
        to: u32,
        len: usize,
    },
    /// The style does not exist or is not a paragraph style.
    #[error("unknown paragraph style {0:?}")]
    UnknownStyle(String),
    /// No media item has this id.
    #[error("unknown media {0}")]
    UnknownMedia(u32),
    /// A well-formed command that cannot be applied.
    #[error("invalid command: {0}")]
    Invalid(String),
    /// Undecodable payload (e.g. base64).
    #[error("bad request: {0}")]
    BadRequest(String),
    /// A loaded document violates the model's invariants.
    #[error("invalid document: {0}")]
    InvalidDocument(String),
    /// The bytes are not a readable `.docx` file.
    #[error("cannot read .docx: {0}")]
    ReadDocx(String),
    /// Writing the `.docx` file failed.
    #[error("cannot write .docx: {0}")]
    WriteDocx(String),
}

impl WriteError {
    /// Machine-readable error code sent to the UI.
    pub fn code(&self) -> &'static str {
        match self {
            WriteError::UnknownBlock(_) => "unknown_block",
            WriteError::BadOffset { .. } => "bad_offset",
            WriteError::UnknownStyle(_) => "unknown_style",
            WriteError::UnknownMedia(_) => "unknown_media",
            WriteError::Invalid(_) => "invalid_command",
            WriteError::BadRequest(_) => "bad_request",
            WriteError::InvalidDocument(_) => "invalid_document",
            WriteError::ReadDocx(_) => "invalid_file",
            WriteError::WriteDocx(_) => "internal",
        }
    }
}

impl From<WriteError> for DispatchError {
    fn from(e: WriteError) -> Self {
        DispatchError::new(e.code(), e.to_string())
    }
}

type R<T> = Result<T, WriteError>;
type C = WriteCommand;

fn invalid(msg: impl Into<String>) -> WriteError {
    WriteError::Invalid(msg.into())
}

/// The Write document: owns a [`Document`] and applies [`WriteCommand`]s.
#[derive(Debug, Clone, PartialEq)]
pub struct WriteDocument {
    doc: Document,
    /// File-level `.docx` data (theme, settings, numbering layout) kept
    /// from [`open_docx`](Self::open_docx) for [`save_docx`](Self::save_docx).
    pub docx_context: Option<fmt_docx::DocxContext>,
    /// The file name the document was opened from (no directory).
    pub source_name: Option<String>,
}

impl Default for WriteDocument {
    fn default() -> Self {
        Self::new()
    }
}

/// A top-level structural event, for the patch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ev {
    Inserted,
    Deleted,
}

/// What one command touched; turned into a [`WritePatch`] at the end.
#[derive(Debug, Default)]
struct Changes {
    events: Vec<(Ev, NodeId)>,
    replaced: Vec<NodeId>,
    containers: Vec<Option<NodeId>>,
    id_map: Vec<(i64, NodeId)>,
    styles: bool,
    numbering: bool,
    page: bool,
    info: Option<String>,
}

impl Changes {
    /// A paragraph or table changed in place.
    fn block(&mut self, id: NodeId) {
        self.replaced.push(id);
    }

    /// Blocks were removed from / added to the container `parent`.
    fn structural(
        &mut self,
        doc: &Document,
        parent: Option<NodeId>,
        inserted: &[NodeId],
        deleted: &[NodeId],
    ) {
        self.containers.push(parent);
        match parent {
            None => {
                self.events
                    .extend(deleted.iter().map(|&id| (Ev::Deleted, id)));
                self.events
                    .extend(inserted.iter().map(|&id| (Ev::Inserted, id)));
            }
            Some(cell) => self.replaced.extend(enclosing_table(doc, cell)),
        }
    }
}

/// Resolves the ids of blocks sent by the UI: negative = temporary
/// (allocated, reported in the id map), non-negative = explicit (must be
/// unused or freed by the command).
struct Ids {
    used: HashSet<NodeId>,
    seen: HashSet<NodeId>,
    temps: HashMap<i64, NodeId>,
}

impl Ids {
    fn new(doc: &Document, freed: &[NodeId]) -> Self {
        let mut used = all_ids(doc);
        for id in freed {
            used.remove(id);
        }
        Ids {
            used,
            seen: HashSet::new(),
            temps: HashMap::new(),
        }
    }

    fn resolve(&mut self, doc: &mut Document, ch: &mut Changes, id: Option<i64>) -> R<NodeId> {
        let real = match id {
            None => doc.alloc_id(),
            Some(t) if t < 0 => {
                if self.temps.contains_key(&t) {
                    return Err(invalid(format!("temporary id {t} used twice")));
                }
                let real = doc.alloc_id();
                self.temps.insert(t, real);
                ch.id_map.push((t, real));
                real
            }
            Some(n) => {
                let real = NodeId(n as u64);
                if self.used.contains(&real) || self.seen.contains(&real) {
                    return Err(invalid(format!("id {n} is already in use")));
                }
                doc.reserve_id(real);
                real
            }
        };
        self.seen.insert(real);
        Ok(real)
    }

    fn block(&mut self, doc: &mut Document, ch: &mut Changes, b: &NewBlock) -> R<Block> {
        Ok(match b {
            NewBlock::Paragraph(p) => Block::Paragraph(Paragraph {
                id: self.resolve(doc, ch, Some(p.id))?,
                props: p.props.clone(),
                inlines: p.inlines.clone(),
            }),
            NewBlock::Table(t) => {
                let id = self.resolve(doc, ch, Some(t.id))?;
                if t.rows.is_empty() {
                    return Err(invalid("a table needs at least one row"));
                }
                let mut rows = Vec::with_capacity(t.rows.len());
                for r in &t.rows {
                    let row_id = self.resolve(doc, ch, Some(r.id))?;
                    if r.cells.is_empty() {
                        return Err(invalid("a table row needs at least one cell"));
                    }
                    let mut cells = Vec::with_capacity(r.cells.len());
                    for c in &r.cells {
                        let cell_id = self.resolve(doc, ch, Some(c.id))?;
                        let mut blocks = c
                            .blocks
                            .iter()
                            .map(|b| self.block(doc, ch, b))
                            .collect::<R<Vec<_>>>()?;
                        if !matches!(blocks.last(), Some(Block::Paragraph(_))) {
                            blocks.push(Block::Paragraph(Paragraph::new(doc.alloc_id())));
                        }
                        cells.push(TableCell {
                            id: cell_id,
                            props: c.props,
                            blocks,
                        });
                    }
                    rows.push(TableRow {
                        id: row_id,
                        props: r.props,
                        cells,
                    });
                }
                Block::Table(Table {
                    id,
                    props: t.props.clone(),
                    rows,
                })
            }
        })
    }
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Ids of the blocks in `blocks` and everything inside them.
fn subtree_ids(blocks: &[Block]) -> Vec<NodeId> {
    let mut out = Vec::new();
    for b in blocks {
        collect_ids(b, &mut out);
    }
    out
}

/// `new_ids` laid out as `base` mandatory ids optionally followed by
/// `extra` ids: `None` entries mean "allocate".
fn id_layout(new_ids: &[i64], base: usize, extra: usize) -> R<Vec<Option<i64>>> {
    let n = new_ids.len();
    if n != 0 && n != base && n != base + extra {
        return Err(invalid(format!(
            "expected 0, {base} or {} new ids, got {n}",
            base + extra
        )));
    }
    let mut out: Vec<Option<i64>> = new_ids.iter().copied().map(Some).collect();
    out.resize(base + extra, None);
    Ok(out)
}

impl WriteDocument {
    /// A new document: one empty paragraph, Word's default styles, A4.
    pub fn new() -> Self {
        WriteDocument {
            doc: Document::new(),
            docx_context: None,
            source_name: None,
        }
    }

    /// Wraps a model document after checking that its node ids are unique,
    /// and normalizes it ([`Document::normalize`]).
    pub fn from_document(mut doc: Document) -> Result<Self, WriteError> {
        let mut seen = HashSet::new();
        for id in subtree_ids(&doc.body) {
            if !seen.insert(id) {
                return Err(WriteError::InvalidDocument(format!(
                    "node id {} is used twice",
                    id.0
                )));
            }
        }
        doc.normalize();
        Ok(WriteDocument {
            doc,
            docx_context: None,
            source_name: None,
        })
    }

    /// Reads a `.docx` file; `name` is the file name shown to the user.
    /// Returns the document and the reader's warnings about content that
    /// was dropped or approximated. The file's [`fmt_docx::DocxContext`]
    /// is kept for [`save_docx`](Self::save_docx).
    pub fn open_docx(bytes: &[u8], name: &str) -> Result<(Self, Vec<String>), WriteError> {
        let out =
            fmt_docx::read_with_context(bytes).map_err(|e| WriteError::ReadDocx(e.to_string()))?;
        let mut doc = Self::from_document(out.document)?;
        doc.docx_context = Some(out.context);
        doc.source_name = Some(name.to_owned());
        Ok((doc, out.warnings))
    }

    /// Writes the document as `.docx`, with the file-level data it was
    /// opened with (if any).
    pub fn save_docx(&self) -> Result<Vec<u8>, WriteError> {
        let default_ctx = fmt_docx::DocxContext::default();
        let ctx = self.docx_context.as_ref().unwrap_or(&default_ctx);
        fmt_docx::write_with_context(&self.doc, ctx)
            .map_err(|e| WriteError::WriteDocx(e.to_string()))
    }

    /// The file name to offer when saving: the source name with a `.docx`
    /// extension, else `Untitled.docx`.
    pub fn suggested_name(&self) -> String {
        match self.source_name.as_deref() {
            None | Some("") => "Untitled.docx".to_owned(),
            Some(n) if n.to_ascii_lowercase().ends_with(".docx") => n.to_owned(),
            Some(n) => {
                let stem = n.rsplit_once('.').map_or(n, |(stem, _)| stem);
                format!("{stem}.docx")
            }
        }
    }

    /// The model document.
    pub fn document(&self) -> &Document {
        &self.doc
    }

    /// The model document, consuming the wrapper.
    pub fn into_document(self) -> Document {
        self.doc
    }

    // ----- lookups -------------------------------------------------------

    fn para(&self, id: NodeId) -> R<&Paragraph> {
        match self.doc.find_block(id) {
            Some(Block::Paragraph(p)) => Ok(p),
            Some(Block::Table(_)) => Err(invalid(format!("block {} is not a paragraph", id.0))),
            None => Err(WriteError::UnknownBlock(id.0)),
        }
    }

    fn para_mut(&mut self, id: NodeId) -> R<&mut Paragraph> {
        match self.doc.find_block_mut(id) {
            Some(Block::Paragraph(p)) => Ok(p),
            Some(Block::Table(_)) => Err(invalid(format!("block {} is not a paragraph", id.0))),
            None => Err(WriteError::UnknownBlock(id.0)),
        }
    }

    /// Checks `from <= to <= len` for paragraph `id`.
    fn range(&self, id: NodeId, from: u32, to: u32) -> R<(usize, usize)> {
        let len = self.para(id)?.len();
        let (f, t) = (from as usize, to as usize);
        if f > t || t > len {
            return Err(WriteError::BadOffset {
                block: id.0,
                from,
                to,
                len,
            });
        }
        Ok((f, t))
    }

    fn pos(&self, id: NodeId) -> R<Pos> {
        position(&self.doc, id).ok_or(WriteError::UnknownBlock(id.0))
    }

    fn table_mut(&mut self, id: NodeId) -> R<&mut Table> {
        if self.doc.find_block(id).is_none() {
            return Err(WriteError::UnknownBlock(id.0));
        }
        find_table_mut(&mut self.doc, id)
            .ok_or_else(|| invalid(format!("block {} is not a table", id.0)))
    }

    /// The paragraphs `ids`, validated (all exist, all paragraphs).
    fn paras(&self, ids: &[NodeId]) -> R<()> {
        ids.iter().try_for_each(|&id| self.para(id).map(drop))
    }

    /// Effective list numbering of `p` (direct, else from its style);
    /// `None` when not numbered.
    fn numbering_of(&self, p: &Paragraph) -> Option<NumberingRef> {
        let n = match p.props.numbering {
            Some(n) => Some(n),
            None => self.style_numbering(p),
        };
        n.filter(|n| n.num_id != 0)
    }

    fn style_numbering(&self, p: &Paragraph) -> Option<NumberingRef> {
        let style = p.props.style.clone().or_else(|| self.default_style())?;
        self.doc.styles.resolve_paragraph(&style).numbering
    }

    fn default_style(&self) -> Option<String> {
        self.doc
            .styles
            .default_style(StyleKind::Paragraph)
            .map(|s| s.id.clone())
    }

    // ----- execution -----------------------------------------------------

    /// Applies `cmd` and returns its inverse. On error the document is
    /// unchanged (compound commands roll back).
    fn exec(&mut self, cmd: &WriteCommand, ch: &mut Changes) -> R<WriteCommand> {
        match cmd {
            C::InsertText {
                block,
                offset,
                text,
                props,
            } => {
                if text.contains(['\n', '\r']) {
                    return Err(invalid("text must not contain line feeds"));
                }
                let (at, _) = self.range(*block, *offset, *offset)?;
                let p = self.para(*block)?;
                let props = props.clone().unwrap_or_else(|| inherited_props(p, at));
                let n = text.chars().count();
                let inline = Inline::Run(Run::with_props(text.clone(), props));
                replace_range(self.para_mut(*block)?, at, at, vec![inline]);
                ch.block(*block);
                Ok(C::DeleteText {
                    block: *block,
                    from: *offset,
                    to: to_u32(at + n),
                })
            }
            C::DeleteText { block, from, to } => {
                self.restore_inlines(*block, *from, *to, Vec::new(), ch)
            }
            C::ReplaceText {
                block,
                from,
                to,
                text,
            } => {
                if text.contains(['\n', '\r']) {
                    return Err(invalid("text must not contain line feeds"));
                }
                let (f, t) = self.range(*block, *from, *to)?;
                let p = self.para(*block)?;
                let props = if f < t {
                    props_at(p, f)
                } else {
                    inherited_props(p, f)
                };
                let new = if text.is_empty() {
                    Vec::new()
                } else {
                    vec![Inline::Run(Run::with_props(text.clone(), props))]
                };
                self.restore_inlines(*block, *from, *to, new, ch)
            }
            C::RestoreInlines {
                block,
                from,
                to,
                inlines,
            } => self.restore_inlines(*block, *from, *to, inlines.clone(), ch),
            C::SetRunProps {
                block,
                from,
                to,
                patch,
            } => {
                let (f, t) = self.range(*block, *from, *to)?;
                let p = self.para(*block)?;
                let old = slice(p, f, t);
                let base = self.doc.resolve_run_props(p, &Run::default());
                // `false` clears a toggle unless the style turns it on.
                let clear = |patch: Option<bool>, base: Option<bool>| {
                    patch == Some(false) && base != Some(true)
                };
                let (cb, ci, cs) = (
                    clear(patch.bold, base.bold),
                    clear(patch.italic, base.italic),
                    clear(patch.strike, base.strike),
                );
                for_each_run_in(self.para_mut(*block)?, f, t, |props| {
                    props.apply(patch);
                    if cb {
                        props.bold = None;
                    }
                    if ci {
                        props.italic = None;
                    }
                    if cs {
                        props.strike = None;
                    }
                });
                ch.block(*block);
                Ok(C::RestoreInlines {
                    block: *block,
                    from: *from,
                    to: *to,
                    inlines: old,
                })
            }
            C::SplitParagraph {
                block,
                offset,
                new_id,
            } => self.split(*block, *offset, *new_id, ch),
            C::JoinWithPrevious { block } => self.join(*block, ch),
            C::SetParagraphProps { blocks, patch } => {
                self.paras(blocks)?;
                self.edit_paragraph_props(blocks, ch, |_, props| props.apply(patch))
            }
            C::RestoreParagraphProps { items } => {
                let ids: Vec<NodeId> = items.iter().map(|(id, _)| *id).collect();
                self.paras(&ids)?;
                let mut inverse = Vec::with_capacity(items.len());
                for (id, props) in items {
                    let p = self.para_mut(*id)?;
                    inverse.push((*id, std::mem::replace(&mut p.props, props.clone())));
                    ch.block(*id);
                }
                inverse.reverse();
                Ok(C::RestoreParagraphProps { items: inverse })
            }
            C::SetStyle { blocks, style } => {
                match self.doc.styles.get(style) {
                    Some(s) if s.kind == StyleKind::Paragraph => {}
                    _ => return Err(WriteError::UnknownStyle(style.clone())),
                }
                self.paras(blocks)?;
                let value = (self.default_style().as_deref() != Some(style.as_str()))
                    .then(|| style.clone());
                self.edit_paragraph_props(blocks, ch, |_, props| props.style.clone_from(&value))
            }
            C::ApplyList { blocks, kind } => self.apply_list(blocks, *kind, ch),
            C::IndentList { blocks, delta } => {
                self.paras(blocks)?;
                let mut levels = Vec::new();
                for &id in blocks {
                    if let Some(n) = self.numbering_of(self.para(id)?) {
                        let level = (i16::from(n.level) + i16::from(*delta)).clamp(0, 8) as u8;
                        levels.push((id, NumberingRef { level, ..n }));
                    }
                }
                let ids: Vec<NodeId> = levels.iter().map(|(id, _)| *id).collect();
                let map: HashMap<NodeId, NumberingRef> = levels.into_iter().collect();
                self.edit_paragraph_props(&ids, ch, |id, props| {
                    props.numbering = map.get(&id).copied();
                })
            }
            C::RestoreNumbering { numbering } => {
                let old = std::mem::replace(&mut self.doc.numbering, numbering.clone());
                ch.numbering = true;
                Ok(C::RestoreNumbering { numbering: old })
            }
            C::InsertBlocks {
                after,
                parent,
                blocks,
            } => self.insert_blocks(*after, *parent, blocks, ch),
            C::DeleteBlocks { ids } => self.delete_blocks(ids, ch),
            C::ReplaceBlocks { ids, blocks } => self.replace_blocks(ids, blocks, ch),
            C::InsertImage {
                block,
                offset,
                content_type,
                bytes_base64,
                width,
                height,
                alt,
            } => {
                let (at, _) = self.range(*block, *offset, *offset)?;
                if content_type.is_empty() {
                    return Err(invalid("missing content type"));
                }
                if width.0 <= 0 || height.0 <= 0 {
                    return Err(invalid("image size must be positive"));
                }
                let bytes = base64_decode(bytes_base64)
                    .map_err(|e| WriteError::BadRequest(format!("invalid base64: {e}")))?;
                let count = self.doc.media.len();
                let media = self.doc.media.insert(content_type.clone(), bytes);
                let added = self.doc.media.len() > count;
                let image = Inline::Image(InlineImage {
                    media,
                    width: *width,
                    height: *height,
                    alt: alt.clone(),
                    name: None,
                });
                replace_range(self.para_mut(*block)?, at, at, vec![image]);
                ch.block(*block);
                let delete = C::DeleteText {
                    block: *block,
                    from: *offset,
                    to: *offset + 1,
                };
                Ok(if added {
                    C::Compound {
                        commands: vec![delete, C::RemoveMedia { id: media }],
                    }
                } else {
                    delete
                })
            }
            C::RemoveMedia { id } => {
                let media = self
                    .doc
                    .media
                    .remove(*id)
                    .ok_or(WriteError::UnknownMedia(id.0))?;
                Ok(C::RestoreMedia {
                    id: *id,
                    content_type: media.content_type,
                    bytes_base64: base64_encode(&media.data),
                })
            }
            C::RestoreMedia {
                id,
                content_type,
                bytes_base64,
            } => {
                let data = base64_decode(bytes_base64)
                    .map_err(|e| WriteError::BadRequest(format!("invalid base64: {e}")))?;
                self.doc.media.insert_with_id(
                    *id,
                    Media {
                        content_type: content_type.clone(),
                        data,
                    },
                );
                Ok(C::RemoveMedia { id: *id })
            }
            C::InsertTable {
                after,
                parent,
                rows,
                cols,
                new_ids,
            } => self.insert_table(*after, *parent, *rows, *cols, new_ids, ch),
            C::InsertTableRow { table, at, new_ids } => self.insert_row(*table, *at, new_ids, ch),
            C::DeleteTableRow { table, at } => self.edit_table(*table, ch, |t| {
                let at = *at as usize;
                if at >= t.rows.len() {
                    return Err(invalid(format!("row {at} out of range")));
                }
                if t.rows.len() == 1 {
                    return Err(invalid("cannot delete the only row of a table"));
                }
                t.rows.remove(at);
                Ok(())
            }),
            C::InsertTableCol { table, at, new_ids } => self.insert_col(*table, *at, new_ids, ch),
            C::DeleteTableCol { table, at } => self.edit_table(*table, ch, |t| {
                let at = *at as usize;
                if t.rows.iter().any(|r| at >= r.cells.len()) {
                    return Err(invalid(format!("column {at} out of range")));
                }
                if t.rows.iter().any(|r| r.cells.len() == 1) {
                    return Err(invalid("cannot delete the only column of a table"));
                }
                for row in &mut t.rows {
                    row.cells.remove(at);
                }
                if at < t.props.col_widths.len() {
                    t.props.col_widths.remove(at);
                }
                Ok(())
            }),
            C::SetCellProps { cells, patch } => {
                let items = cells
                    .iter()
                    .map(|&id| {
                        let cell =
                            find_cell(&self.doc.body, id).ok_or(WriteError::UnknownBlock(id.0))?;
                        let old = cell.props;
                        let new = CellProperties {
                            width: patch.width.or(old.width),
                            // `auto` = no fill (removes the shading).
                            shading: match patch.shading {
                                Some(Color::Auto) => None,
                                p => p.or(old.shading),
                            },
                            borders: merge_borders(old.borders, patch.borders),
                            vertical_align: patch.vertical_align.or(old.vertical_align),
                        };
                        Ok((id, new))
                    })
                    .collect::<R<Vec<_>>>()?;
                self.restore_cell_props(&items, ch)
            }
            C::RestoreCellProps { items } => self.restore_cell_props(items, ch),
            C::SetTableProps { table, patch } => {
                let t = self.table_mut(*table)?;
                let old = t.props.clone();
                let props = &mut t.props;
                props.width = patch.width.or(props.width);
                if !patch.col_widths.is_empty() {
                    props.col_widths.clone_from(&patch.col_widths);
                }
                props.borders = merge_borders(props.borders, patch.borders);
                props.cell_margins = match (props.cell_margins, patch.cell_margins) {
                    (Some(a), Some(b)) => Some(model_text::CellMargins {
                        top: b.top.or(a.top),
                        left: b.left.or(a.left),
                        bottom: b.bottom.or(a.bottom),
                        right: b.right.or(a.right),
                    }),
                    (a, b) => b.or(a),
                };
                ch.block(*table);
                Ok(C::RestoreTableProps {
                    table: *table,
                    props: old,
                })
            }
            C::RestoreTableProps { table, props } => {
                let t = self.table_mut(*table)?;
                let old = std::mem::replace(&mut t.props, props.clone());
                ch.block(*table);
                Ok(C::RestoreTableProps {
                    table: *table,
                    props: old,
                })
            }
            C::SetPage { patch } => {
                let old = self.doc.page.clone();
                let mut page = old.clone();
                if let Some(o) = patch.orientation {
                    page = page.with_orientation(o);
                }
                page.width = patch.width.unwrap_or(page.width);
                page.height = patch.height.unwrap_or(page.height);
                if let Some(m) = patch.margins {
                    let pm = &mut page.margins;
                    pm.top = m.top.unwrap_or(pm.top);
                    pm.right = m.right.unwrap_or(pm.right);
                    pm.bottom = m.bottom.unwrap_or(pm.bottom);
                    pm.left = m.left.unwrap_or(pm.left);
                    pm.header = m.header.unwrap_or(pm.header);
                    pm.footer = m.footer.unwrap_or(pm.footer);
                }
                if let Some(t) = &patch.header_text {
                    page.header_text = Some(t.clone()).filter(|t| !t.is_empty());
                }
                if let Some(t) = &patch.footer_text {
                    page.footer_text = Some(t.clone()).filter(|t| !t.is_empty());
                }
                if [&page.header_text, &page.footer_text]
                    .iter()
                    .any(|t| t.as_deref().is_some_and(|t| t.contains('\r')))
                {
                    return Err(invalid("header/footer text must not contain \\r"));
                }
                let m = page.margins;
                if page.width.0 <= 0
                    || page.height.0 <= 0
                    || page.content_width().0 <= 0
                    || page.height.0 - m.top.0 - m.bottom.0 <= 0
                {
                    return Err(invalid("page setup leaves no room for text"));
                }
                self.doc.page = page;
                ch.page = true;
                Ok(C::SetPage {
                    patch: crate::command::PageSetupPatch {
                        orientation: Some(old.orientation),
                        width: Some(old.width),
                        height: Some(old.height),
                        margins: Some(crate::command::MarginsPatch {
                            top: Some(old.margins.top),
                            right: Some(old.margins.right),
                            bottom: Some(old.margins.bottom),
                            left: Some(old.margins.left),
                            header: Some(old.margins.header),
                            footer: Some(old.margins.footer),
                        }),
                        header_text: Some(old.header_text.unwrap_or_default()),
                        footer_text: Some(old.footer_text.unwrap_or_default()),
                    },
                })
            }
            C::SetImageSize {
                block,
                offset,
                width,
                height,
            } => {
                if width.0 <= 0 || height.0 <= 0 {
                    return Err(invalid("image size must be positive"));
                }
                let (w, h) = (*width, *height);
                self.edit_image(*block, *offset, ch, |img| {
                    img.width = w;
                    img.height = h;
                })
            }
            C::SetImageAlt { block, offset, alt } => {
                let alt = alt.clone().filter(|a| !a.is_empty());
                self.edit_image(*block, *offset, ch, |img| img.alt = alt)
            }
            C::SetRowProps {
                table,
                rows,
                header,
                height,
            } => self.edit_table(*table, ch, |t| {
                for &r in rows {
                    let row = t
                        .rows
                        .get_mut(r as usize)
                        .ok_or_else(|| invalid(format!("row {r} out of range")))?;
                    if let Some(hd) = header {
                        row.props.header = *hd;
                    }
                    if let Some(h) = height {
                        row.props.height = (h.value.0 > 0).then_some(*h);
                    }
                }
                Ok(())
            }),
            C::ClearFormatting {
                block,
                from,
                to,
                paragraph,
            } => {
                let (f, t) = self.range(*block, *from, *to)?;
                let p = self.para(*block)?;
                let old_inlines = slice(p, f, t);
                let old_props = p.props.clone();
                let p = self.para_mut(*block)?;
                for_each_run_in(p, f, t, |props| *props = RunProperties::default());
                if *paragraph {
                    p.props = ParagraphProperties::default();
                }
                ch.block(*block);
                let restore = C::RestoreInlines {
                    block: *block,
                    from: *from,
                    to: *to,
                    inlines: old_inlines,
                };
                Ok(if *paragraph {
                    C::Compound {
                        commands: vec![
                            restore,
                            C::RestoreParagraphProps {
                                items: vec![(*block, old_props)],
                            },
                        ],
                    }
                } else {
                    restore
                })
            }
            C::FindReplace {
                find,
                replace,
                match_case,
                whole_word,
                all,
            } => self.find_replace(find, replace, *match_case, *whole_word, *all, ch),
            C::Compound { commands } => {
                let mut inverses = Vec::with_capacity(commands.len());
                for cmd in commands {
                    match self.exec(cmd, ch) {
                        Ok(inv) => inverses.push(inv),
                        Err(e) => {
                            // Roll back what was applied.
                            let mut scratch = Changes::default();
                            for inv in inverses.iter().rev() {
                                let _ = self.exec(inv, &mut scratch);
                            }
                            return Err(e);
                        }
                    }
                }
                inverses.reverse();
                Ok(C::Compound { commands: inverses })
            }
        }
    }

    /// Replaces `from..to` of paragraph `block` by `inlines`; the inverse
    /// restores the removed inlines.
    fn restore_inlines(
        &mut self,
        block: NodeId,
        from: u32,
        to: u32,
        inlines: Vec<Inline>,
        ch: &mut Changes,
    ) -> R<WriteCommand> {
        let (f, t) = self.range(block, from, to)?;
        for i in &inlines {
            if let Inline::Image(img) = i {
                if self.doc.media.get(img.media).is_none() {
                    return Err(WriteError::UnknownMedia(img.media.0));
                }
            }
        }
        let n = inlines_len(&inlines);
        let removed = replace_range(self.para_mut(block)?, f, t, inlines);
        ch.block(block);
        Ok(C::RestoreInlines {
            block,
            from,
            to: to_u32(f + n),
            inlines: removed,
        })
    }

    /// Edits the direct properties of the (validated) paragraphs `ids`.
    fn edit_paragraph_props(
        &mut self,
        ids: &[NodeId],
        ch: &mut Changes,
        mut f: impl FnMut(NodeId, &mut ParagraphProperties),
    ) -> R<WriteCommand> {
        let mut items = Vec::with_capacity(ids.len());
        let mut done = HashSet::new();
        for &id in ids {
            if !done.insert(id) {
                continue;
            }
            let p = self.para_mut(id)?;
            items.push((id, p.props.clone()));
            f(id, &mut p.props);
            ch.block(id);
        }
        Ok(C::RestoreParagraphProps { items })
    }

    fn split(&mut self, block: NodeId, offset: u32, new_id: i64, ch: &mut Changes) -> R<C> {
        let (at, _) = self.range(block, offset, offset)?;
        let pos = self.pos(block)?;
        let old = self.para(block)?.clone();
        let mut props = old.props.clone();
        let style = props.style.clone().or_else(|| self.default_style());
        if let Some(next) = style
            .as_deref()
            .and_then(|s| self.doc.styles.get(s))
            .and_then(|s| s.next.clone())
            .filter(|n| Some(n) != style.as_ref() && self.doc.styles.get(n).is_some())
        {
            props.style = (self.default_style().as_ref() != Some(&next)).then_some(next);
        }
        let mut ids = Ids::new(&self.doc, &[]);
        let id = ids.resolve(&mut self.doc, ch, Some(new_id))?;
        let tail = replace_range(self.para_mut(block)?, at, old.len(), Vec::new());
        let new = Paragraph {
            id,
            props,
            inlines: tail,
        };
        let blocks =
            container_mut(&mut self.doc, pos.parent).ok_or(WriteError::UnknownBlock(block.0))?;
        blocks.insert(pos.index + 1, Block::Paragraph(new));
        ch.block(block);
        ch.structural(&self.doc, pos.parent, &[id], &[]);
        Ok(C::ReplaceBlocks {
            ids: vec![block, id],
            blocks: vec![NewBlock::Paragraph(NewParagraph::from(&old))],
        })
    }

    fn join(&mut self, block: NodeId, ch: &mut Changes) -> R<C> {
        let cur = self.para(block)?.clone();
        let pos = self.pos(block)?;
        if pos.index == 0 {
            return Err(invalid(format!(
                "block {} is the first of its container",
                block.0
            )));
        }
        let blocks =
            container_mut(&mut self.doc, pos.parent).ok_or(WriteError::UnknownBlock(block.0))?;
        let Block::Paragraph(prev) = &mut blocks[pos.index - 1] else {
            return Err(invalid(format!("block {} follows a table", block.0)));
        };
        let old_prev = prev.clone();
        prev.inlines.extend(cur.inlines.iter().cloned());
        let prev_id = prev.id;
        blocks.remove(pos.index);
        ch.block(prev_id);
        ch.structural(&self.doc, pos.parent, &[], &[block]);
        Ok(C::ReplaceBlocks {
            ids: vec![prev_id],
            blocks: vec![
                NewBlock::Paragraph(NewParagraph::from(&old_prev)),
                NewBlock::Paragraph(NewParagraph::from(&cur)),
            ],
        })
    }

    fn apply_list(&mut self, blocks: &[NodeId], kind: ListKind, ch: &mut Changes) -> R<C> {
        self.paras(blocks)?;
        let old_numbering = self.doc.numbering.clone();
        let target: Option<u32> = match kind {
            ListKind::None => None,
            ListKind::Bullet | ListKind::Decimal => {
                let bullet = kind == ListKind::Bullet;
                let matches = |n: NumberingRef| {
                    self.doc
                        .numbering
                        .level(n)
                        .is_some_and(|l| (l.kind == model_text::LevelKind::Bullet) == bullet)
                };
                let mut candidates = Vec::new();
                if let Some(&first) = blocks.first() {
                    candidates.push(first);
                    let pos = self.pos(first)?;
                    if pos.index > 0 {
                        candidates.extend(
                            container(&self.doc, pos.parent)
                                .and_then(|c| c.get(pos.index - 1))
                                .map(Block::id),
                        );
                    }
                }
                if let Some(&last) = blocks.last() {
                    let pos = self.pos(last)?;
                    candidates.extend(
                        container(&self.doc, pos.parent)
                            .and_then(|c| c.get(pos.index + 1))
                            .map(Block::id),
                    );
                }
                let reuse = candidates.into_iter().find_map(|id| {
                    let p = self.doc.find_paragraph(id)?;
                    self.numbering_of(p)
                        .filter(|&n| matches(n))
                        .map(|n| n.num_id)
                });
                Some(match reuse {
                    Some(id) => id,
                    None => {
                        let id = self.doc.numbering.next_id();
                        self.doc.numbering.insert(if bullet {
                            NumberingDef::bullet_default(id)
                        } else {
                            NumberingDef::decimal_default(id)
                        });
                        ch.numbering = true;
                        id
                    }
                })
            }
        };
        let mut values = HashMap::new();
        for &id in blocks {
            let p = self.para(id)?;
            let value = match target {
                None => self
                    .style_numbering(p)
                    .filter(|n| n.num_id != 0)
                    .map(|_| NumberingRef {
                        num_id: 0,
                        level: 0,
                    }),
                Some(num_id) => Some(NumberingRef {
                    num_id,
                    level: self.numbering_of(p).map_or(0, |n| n.level),
                }),
            };
            values.insert(id, value);
        }
        let restore =
            self.edit_paragraph_props(blocks, ch, |id, props| props.numbering = values[&id])?;
        Ok(if self.doc.numbering != old_numbering {
            C::Compound {
                commands: vec![
                    restore,
                    C::RestoreNumbering {
                        numbering: old_numbering,
                    },
                ],
            }
        } else {
            restore
        })
    }

    /// Index in container `parent` after which to insert (`after`).
    fn insert_index(&self, after: Option<NodeId>, parent: Option<NodeId>) -> R<usize> {
        let blocks = container(&self.doc, parent)
            .ok_or_else(|| WriteError::UnknownBlock(parent.map_or(0, |p| p.0)))?;
        match after {
            None => Ok(0),
            Some(a) => blocks
                .iter()
                .position(|b| b.id() == a)
                .map(|i| i + 1)
                .ok_or(WriteError::UnknownBlock(a.0)),
        }
    }

    fn insert_blocks(
        &mut self,
        after: Option<NodeId>,
        parent: Option<NodeId>,
        blocks: &[NewBlock],
        ch: &mut Changes,
    ) -> R<C> {
        if blocks.is_empty() {
            return Err(invalid("no blocks to insert"));
        }
        let index = self.insert_index(after, parent)?;
        let mut ids = Ids::new(&self.doc, &[]);
        let new = blocks
            .iter()
            .map(|b| ids.block(&mut self.doc, ch, b))
            .collect::<R<Vec<_>>>()?;
        let top: Vec<NodeId> = new.iter().map(Block::id).collect();
        let c = container_mut(&mut self.doc, parent).ok_or(invalid("container vanished"))?;
        c.splice(index..index, new);
        ch.structural(&self.doc, parent, &top, &[]);
        Ok(C::DeleteBlocks { ids: top })
    }

    fn delete_blocks(&mut self, ids: &[NodeId], ch: &mut Changes) -> R<C> {
        for &id in ids {
            self.pos(id)?;
        }
        let mut restore = Vec::new();
        for &id in ids {
            // Already gone with a deleted ancestor (or listed twice).
            let Some(pos) = position(&self.doc, id) else {
                continue;
            };
            let blocks =
                container_mut(&mut self.doc, pos.parent).ok_or(invalid("container vanished"))?;
            let after = pos.index.checked_sub(1).map(|i| blocks[i].id());
            let block = blocks.remove(pos.index);
            restore.push(C::InsertBlocks {
                after,
                parent: pos.parent,
                blocks: vec![NewBlock::from(&block)],
            });
            ch.structural(&self.doc, pos.parent, &[], &[id]);
        }
        restore.reverse();
        Ok(C::Compound { commands: restore })
    }

    fn replace_blocks(&mut self, ids: &[NodeId], blocks: &[NewBlock], ch: &mut Changes) -> R<C> {
        let Some(&first) = ids.first() else {
            return Err(invalid("no blocks to replace"));
        };
        if blocks.is_empty() {
            return self.delete_blocks(ids, ch);
        }
        let pos = self.pos(first)?;
        let siblings = container(&self.doc, pos.parent).ok_or(invalid("container vanished"))?;
        for (k, &id) in ids.iter().enumerate() {
            if siblings.get(pos.index + k).map(Block::id) != Some(id) {
                self.pos(id)?;
                return Err(invalid(
                    "replaced blocks must be consecutive siblings in order",
                ));
            }
        }
        let range = pos.index..pos.index + ids.len();
        let freed = subtree_ids(&siblings[range.clone()]);
        let mut resolver = Ids::new(&self.doc, &freed);
        let new = blocks
            .iter()
            .map(|b| resolver.block(&mut self.doc, ch, b))
            .collect::<R<Vec<_>>>()?;
        let top: Vec<NodeId> = new.iter().map(Block::id).collect();
        let c = container_mut(&mut self.doc, pos.parent).ok_or(invalid("container vanished"))?;
        let old: Vec<NewBlock> = c.splice(range, new).map(|b| NewBlock::from(&b)).collect();
        ch.structural(&self.doc, pos.parent, &top, ids);
        Ok(C::ReplaceBlocks {
            ids: top,
            blocks: old,
        })
    }

    fn insert_table(
        &mut self,
        after: Option<NodeId>,
        parent: Option<NodeId>,
        rows: u32,
        cols: u32,
        new_ids: &[i64],
        ch: &mut Changes,
    ) -> R<C> {
        if rows == 0 || cols == 0 || rows > 1000 || cols > 63 {
            return Err(invalid("a table needs 1..=1000 rows and 1..=63 columns"));
        }
        self.insert_index(after, parent)?;
        let (r, c) = (rows as usize, cols as usize);
        let layout = id_layout(new_ids, 1 + r + r * c, r * c)?;
        // Placeholders for "allocate": fresh ids are unused by definition.
        let id =
            |k: usize, doc: &mut Document| layout[k].unwrap_or_else(|| doc.alloc_id().0 as i64);
        let col_width = self.doc.page.content_width().0 / cols as i32;
        let side = BorderSide {
            style: BorderStyle::Single,
            width: BorderSide::width_from_eighths(4),
            color: Color::Auto,
        };
        let table_id = id(0, &mut self.doc);
        let mut new_rows = Vec::with_capacity(r);
        for ri in 0..r {
            let row_id = id(1 + ri, &mut self.doc);
            let cells = (0..c)
                .map(|ci| {
                    let k = ri * c + ci;
                    NewCell {
                        id: id(1 + r + k, &mut self.doc),
                        props: CellProperties::default(),
                        blocks: vec![NewBlock::Paragraph(NewParagraph {
                            id: id(1 + r + r * c + k, &mut self.doc),
                            props: ParagraphProperties::default(),
                            inlines: Vec::new(),
                        })],
                    }
                })
                .collect();
            new_rows.push(NewRow {
                id: row_id,
                props: Default::default(),
                cells,
            });
        }
        let table = NewBlock::Table(NewTable {
            id: table_id,
            props: TableProperties {
                col_widths: vec![Twips(col_width); c],
                borders: Some(TableBorders::all(side)),
                ..Default::default()
            },
            rows: new_rows,
        });
        self.insert_blocks(after, parent, &[table], ch)
    }

    /// Edits the inline image at position `offset` of paragraph `block`;
    /// the inverse restores the old image.
    fn edit_image(
        &mut self,
        block: NodeId,
        offset: u32,
        ch: &mut Changes,
        f: impl FnOnce(&mut InlineImage),
    ) -> R<C> {
        let (at, _) = self.range(block, offset, offset)?;
        let p = self.para(block)?;
        if at >= p.len() {
            return Err(invalid(format!(
                "no image at {offset} in block {}",
                block.0
            )));
        }
        let mut found = slice(p, at, at + 1);
        let Some(Inline::Image(img)) = found.first_mut() else {
            return Err(invalid(format!(
                "no image at {offset} in block {}",
                block.0
            )));
        };
        f(img);
        self.restore_inlines(block, offset, offset + 1, found, ch)
    }

    /// Edits a table in place; the inverse restores the whole table.
    fn edit_table(
        &mut self,
        table: NodeId,
        ch: &mut Changes,
        f: impl FnOnce(&mut Table) -> R<()>,
    ) -> R<C> {
        let t = self.table_mut(table)?;
        let old = t.clone();
        if let Err(e) = f(t) {
            *t = old;
            return Err(e);
        }
        ch.block(table);
        Ok(C::ReplaceBlocks {
            ids: vec![table],
            blocks: vec![NewBlock::Table(NewTable::from(&old))],
        })
    }

    fn insert_row(&mut self, table: NodeId, at: u32, new_ids: &[i64], ch: &mut Changes) -> R<C> {
        let t = self.table_mut(table)?.clone();
        let at = at as usize;
        if at > t.rows.len() {
            return Err(invalid(format!("row {at} out of range")));
        }
        let model = &t.rows[at.saturating_sub(1).min(t.rows.len() - 1)];
        let n = model.cells.len();
        let layout = id_layout(new_ids, 1 + n, n)?;
        let mut ids = Ids::new(&self.doc, &[]);
        let row_id = ids.resolve(&mut self.doc, ch, layout[0])?;
        let mut cells = Vec::with_capacity(n);
        for (k, m) in model.cells.iter().enumerate() {
            let id = ids.resolve(&mut self.doc, ch, layout[1 + k])?;
            let pid = ids.resolve(&mut self.doc, ch, layout[1 + n + k])?;
            cells.push(TableCell {
                id,
                props: m.props,
                blocks: vec![Block::Paragraph(Paragraph::new(pid))],
            });
        }
        let row = TableRow {
            id: row_id,
            props: model_text::RowProperties {
                header: false,
                ..model.props
            },
            cells,
        };
        self.edit_table(table, ch, |t| {
            t.rows.insert(at, row);
            Ok(())
        })
    }

    fn insert_col(&mut self, table: NodeId, at: u32, new_ids: &[i64], ch: &mut Changes) -> R<C> {
        let t = self.table_mut(table)?.clone();
        let at = at as usize;
        if t.rows.iter().any(|r| at > r.cells.len()) {
            return Err(invalid(format!("column {at} out of range")));
        }
        let r = t.rows.len();
        let layout = id_layout(new_ids, r, r)?;
        let mut ids = Ids::new(&self.doc, &[]);
        let mut new_cells = Vec::with_capacity(r);
        for (k, row) in t.rows.iter().enumerate() {
            let id = ids.resolve(&mut self.doc, ch, layout[k])?;
            let pid = ids.resolve(&mut self.doc, ch, layout[r + k])?;
            let model = &row.cells[at.saturating_sub(1).min(row.cells.len() - 1)];
            new_cells.push(TableCell {
                id,
                props: model.props,
                blocks: vec![Block::Paragraph(Paragraph::new(pid))],
            });
        }
        self.edit_table(table, ch, |t| {
            for (row, cell) in t.rows.iter_mut().zip(new_cells) {
                row.cells.insert(at, cell);
            }
            let w = &mut t.props.col_widths;
            if !w.is_empty() && at <= w.len() {
                let model = w[at.saturating_sub(1).min(w.len() - 1)];
                w.insert(at, model);
            }
            Ok(())
        })
    }

    fn restore_cell_props(&mut self, items: &[(NodeId, CellProperties)], ch: &mut Changes) -> R<C> {
        for (id, _) in items {
            find_cell(&self.doc.body, *id).ok_or(WriteError::UnknownBlock(id.0))?;
        }
        let mut inverse = Vec::with_capacity(items.len());
        for (id, props) in items {
            let cell =
                find_cell_mut(&mut self.doc.body, *id).ok_or(WriteError::UnknownBlock(id.0))?;
            inverse.push((*id, std::mem::replace(&mut cell.props, *props)));
            let table = enclosing_table(&self.doc, *id);
            ch.replaced.extend(table);
        }
        inverse.reverse();
        Ok(C::RestoreCellProps { items: inverse })
    }

    fn find_replace(
        &mut self,
        find: &str,
        replace: &str,
        match_case: bool,
        whole_word: bool,
        all: bool,
        ch: &mut Changes,
    ) -> R<C> {
        if find.is_empty() {
            return Err(invalid("nothing to find"));
        }
        if replace.contains(['\n', '\r']) {
            return Err(invalid("replacement must not contain line feeds"));
        }
        let pattern: Vec<char> = find.chars().collect();
        let mut hits: Vec<(NodeId, Vec<(usize, usize)>)> = Vec::new();
        for p in self.doc.paragraphs() {
            let text: Vec<char> = p.text().chars().collect();
            let mut m = find_matches(&text, &pattern, match_case, whole_word);
            if m.is_empty() {
                continue;
            }
            if !all {
                m.truncate(1);
                hits.push((p.id, m));
                break;
            }
            hits.push((p.id, m));
        }
        let count: usize = hits.iter().map(|(_, m)| m.len()).sum();
        let mut inverse = Vec::with_capacity(hits.len());
        for (id, matches) in hits {
            let p = self.para_mut(id)?;
            let old = p.inlines.clone();
            for &(s, e) in matches.iter().rev() {
                let props = props_at(p, s);
                let new = if replace.is_empty() {
                    Vec::new()
                } else {
                    vec![Inline::Run(Run::with_props(replace, props))]
                };
                replace_range(p, s, e, new);
            }
            let len = p.len();
            ch.block(id);
            inverse.push(C::RestoreInlines {
                block: id,
                from: 0,
                to: to_u32(len),
                inlines: old,
            });
        }
        inverse.reverse();
        ch.info = Some(match count {
            1 => "1 replacement".to_owned(),
            n => format!("{n} replacements"),
        });
        Ok(C::Compound { commands: inverse })
    }

    // ----- patch ---------------------------------------------------------

    /// Restores the container invariant (non-empty, ends with a paragraph)
    /// in every container the command touched; returns the paragraphs
    /// added.
    fn fix_containers(&mut self, ch: &mut Changes) -> Vec<NodeId> {
        let mut added = Vec::new();
        let mut done = HashSet::new();
        let parents = std::mem::take(&mut ch.containers);
        for parent in parents {
            if !done.insert(parent) {
                continue;
            }
            let needs = match container(&self.doc, parent) {
                Some(c) => !matches!(c.last(), Some(Block::Paragraph(_))),
                None => false, // the cell itself was removed
            };
            if needs {
                let id = self.doc.alloc_id();
                if let Some(c) = container_mut(&mut self.doc, parent) {
                    c.push(Block::Paragraph(Paragraph::new(id)));
                }
                ch.structural(&self.doc, parent, &[id], &[]);
                added.push(id);
            }
        }
        added
    }

    /// Normalizes the touched blocks and builds the patch.
    fn finish(&mut self, ch: Changes) -> WritePatch {
        let mut first: HashMap<NodeId, Ev> = HashMap::new();
        let mut order: Vec<NodeId> = Vec::new();
        let mut reinserted: HashSet<NodeId> = HashSet::new();
        for &(ev, id) in &ch.events {
            first.entry(id).or_insert_with(|| {
                order.push(id);
                ev
            });
            if ev == Ev::Inserted {
                reinserted.insert(id);
            }
        }
        let body_ids: Vec<u64> = self.doc.body.iter().map(|b| b.id().0).collect();
        let top: HashMap<NodeId, usize> = self
            .doc
            .body
            .iter()
            .enumerate()
            .map(|(i, b)| (b.id(), i))
            .collect();
        let deleted: Vec<NodeId> = order
            .iter()
            .copied()
            .filter(|id| first[id] == Ev::Deleted)
            .collect();
        let mut inserted: Vec<(usize, NodeId)> = order
            .iter()
            .filter(|id| reinserted.contains(id))
            .filter_map(|id| top.get(id).map(|&i| (i, *id)))
            .collect();
        inserted.sort_unstable();
        let inserted_set: HashSet<NodeId> = inserted.iter().map(|(_, id)| *id).collect();

        let mut seen = HashSet::new();
        let candidates: Vec<NodeId> = ch
            .replaced
            .iter()
            .copied()
            .filter(|id| seen.insert(*id) && !inserted_set.contains(id))
            .collect();
        let mut with_paths: Vec<(NodeId, Vec<NodeId>)> = candidates
            .into_iter()
            .filter_map(|id| ancestors(&self.doc, id).map(|a| (id, a)))
            .collect();
        let replaced_set: HashSet<NodeId> = with_paths.iter().map(|(id, _)| *id).collect();
        with_paths.retain(|(_, path)| {
            !path
                .iter()
                .any(|a| replaced_set.contains(a) || inserted_set.contains(a))
        });

        let mut take = |id: NodeId| -> Option<Block> {
            let b = self.doc.find_block_mut(id)?;
            for_each_paragraph_mut(b, &mut Paragraph::normalize);
            Some(b.clone())
        };
        let replaced: Vec<Block> = with_paths.iter().filter_map(|(id, _)| take(*id)).collect();
        let inserted: Vec<InsertedBlock> = inserted
            .iter()
            .filter_map(|&(i, id)| {
                let block = take(id)?;
                Some(InsertedBlock {
                    after: i.checked_sub(1).map(|j| NodeId(body_ids[j])),
                    parent: None,
                    block,
                })
            })
            .collect();
        WritePatch {
            replaced,
            inserted,
            deleted,
            id_map: ch.id_map,
            styles: ch.styles.then(|| self.doc.styles.clone()),
            numbering: ch.numbering.then(|| self.doc.numbering.clone()),
            page: ch.page.then(|| self.doc.page.clone()),
            info: ch.info,
        }
    }
}

/// `base` overlaid with `over`, side by side.
fn merge_borders(base: Option<TableBorders>, over: Option<TableBorders>) -> Option<TableBorders> {
    match (base, over) {
        (Some(a), Some(b)) => Some(a.merged_with(&b)),
        (a, b) => b.or(a),
    }
}

impl AppDocument for WriteDocument {
    type Command = WriteCommand;
    type Patch = WritePatch;
    type Error = WriteError;

    fn apply(
        &mut self,
        cmd: &WriteCommand,
    ) -> Result<Applied<WriteCommand, WritePatch>, WriteError> {
        let mut ch = Changes::default();
        let mut inverse = self.exec(cmd, &mut ch)?;
        let added = self.fix_containers(&mut ch);
        if !added.is_empty() {
            inverse = C::Compound {
                commands: vec![inverse, C::DeleteBlocks { ids: added }],
            };
        }
        let patch = self.finish(ch);
        Ok(Applied {
            patch,
            inverse: Some(inverse),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_names() {
        let named = |n: &str| WriteDocument {
            source_name: Some(n.into()),
            ..WriteDocument::new()
        };
        assert_eq!(WriteDocument::new().suggested_name(), "Untitled.docx");
        assert_eq!(named("a.docx").suggested_name(), "a.docx");
        assert_eq!(named("b.DOCX").suggested_name(), "b.DOCX");
        assert_eq!(named("c.doc").suggested_name(), "c.docx");
        assert_eq!(named("d").suggested_name(), "d.docx");
    }

    #[test]
    fn open_rejects_garbage() {
        let err = WriteDocument::open_docx(b"not a zip", "x.docx").unwrap_err();
        assert_eq!(err.code(), "invalid_file");
    }

    #[test]
    fn new_document_saves_and_reopens() {
        let bytes = WriteDocument::new().save_docx().unwrap();
        let (doc, _) = WriteDocument::open_docx(&bytes, "n.docx").unwrap();
        assert_eq!(doc.source_name.as_deref(), Some("n.docx"));
        assert!(doc.docx_context.is_some());
    }
}
