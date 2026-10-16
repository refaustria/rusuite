//! [`WriteDocument`]: a [`model_text::Document`] behind the
//! [`app_common::Document`] trait.

use std::collections::{HashMap, HashSet};

use app_common::{Applied, DispatchError, Document as AppDocument};
use core_model::Color;
use model_text::media::{base64_decode, base64_encode};
use model_text::{marker_of, Comment, CommentId};
use model_text::{valid_bookmark_name, BookmarkId, FieldKind, Hyperlink, LinkTarget};
use model_text::{
    Anchor, Block, BorderSide, BorderStyle, CellProperties, Document, Field, Indent, Inline,
    InlineImage, LevelKind, LevelOverride, LineSpacing, Media, NodeId, Note, NoteKind, NoteRef,
    NumberingDef, NumberingRef, PageSetup, Paragraph, ParagraphProperties, Run, RunProperties,
    Section, SectionId, Spacing, Style, StyleKind, Table, TableBorders, TableCell, TableProperties,
    TableRow, Toc, Twips, VMerge,
};

use crate::command::{
    CommentPoint, FieldRefresh, FindFormat, FindMatch, FindQuery, ListKind, NewBlock, NewCell,
    NewParagraph, NewRow, NewTable, PageSetupPatch, RefShow, RefTarget, SectionPatch, WriteCommand,
};
use crate::find::{find_matches_where, stretches, Wildcard};
use crate::patch::{InsertedBlock, WritePatch};
use crate::text::{
    for_each_run_in, for_each_run_mut_in, inherited_props, inherited_run, inline_len, inlines_len,
    replace_keeping_markers, replace_range, run_format_at, slice,
};
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
/// The matches (`from..to` char offsets) in one paragraph.
type Hits = (NodeId, Vec<(usize, usize)>);
type C = WriteCommand;

fn invalid(msg: impl Into<String>) -> WriteError {
    WriteError::Invalid(msg.into())
}

fn style_err(e: model_text::StyleError) -> WriteError {
    match e {
        model_text::StyleError::Unknown(id) => WriteError::UnknownStyle(id),
        e => invalid(e.to_string()),
    }
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
    /// List labels as last reported (see [`Document::list_numbers`]).
    labels: HashMap<NodeId, String>,
    /// The user comments are written as (`SetUser`; kept with the
    /// document in memory only, never saved apart from the comments).
    pub user: Option<User>,
}

/// The author of new comments: name and initials.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct User {
    pub name: String,
    pub initials: String,
}

/// Word's initials of `name`: the first letter of up to three words.
pub fn initials_of(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|w| w.chars().next())
        .take(3)
        .flat_map(char::to_uppercase)
        .collect()
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
    sections: bool,
    notes: bool,
    comments: bool,
    properties: bool,
    settings: bool,
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
                list_label: None,
            }),
            NewBlock::Toc(t) => Block::Toc(Toc {
                id: self.resolve(doc, ch, Some(t.id))?,
                from_level: t.from_level.clamp(1, 9),
                to_level: t.to_level.clamp(t.from_level.clamp(1, 9), 9),
                title: t.title.clone(),
                entries: t.entries.clone(),
                caption: t.caption.clone(),
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
                            grid_span: c.grid_span.max(1),
                            v_merge: c.v_merge,
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
            labels: HashMap::new(),
            user: None,
        }
    }

    /// Wraps a model document after checking that its node ids are unique,
    /// and normalizes it ([`Document::normalize`]).
    pub fn from_document(mut doc: Document) -> Result<Self, WriteError> {
        let mut seen = HashSet::new();
        for c in doc.containers() {
            for id in subtree_ids(c) {
                if !seen.insert(id) {
                    return Err(WriteError::InvalidDocument(format!(
                        "node id {} is used twice",
                        id.0
                    )));
                }
            }
        }
        doc.normalize();
        let labels = doc.list_numbers().into_iter().collect();
        Ok(WriteDocument {
            doc,
            docx_context: None,
            source_name: None,
            labels,
            user: None,
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

    /// A copy of the document for the UI: every numbered paragraph carries
    /// its `listLabel`.
    pub fn snapshot(&self) -> Document {
        let mut doc = self.doc.clone();
        for c in doc.containers_mut() {
            for b in c.iter_mut() {
                self.fill_labels(b);
            }
        }
        doc
    }

    /// Sets `list_label` on the paragraphs inside `block`.
    fn fill_labels(&self, block: &mut Block) {
        for_each_paragraph_mut(block, &mut |p| {
            p.list_label = self.labels.get(&p.id).cloned();
        });
    }

    /// The model document, consuming the wrapper.
    pub fn into_document(self) -> Document {
        self.doc
    }

    // ----- lookups -------------------------------------------------------

    fn para(&self, id: NodeId) -> R<&Paragraph> {
        match self.doc.find_block(id) {
            Some(Block::Paragraph(p)) => Ok(p),
            Some(_) => Err(invalid(format!("block {} is not a paragraph", id.0))),
            None => Err(WriteError::UnknownBlock(id.0)),
        }
    }

    fn para_mut(&mut self, id: NodeId) -> R<&mut Paragraph> {
        match self.doc.find_block_mut(id) {
            Some(Block::Paragraph(p)) => Ok(p),
            Some(_) => Err(invalid(format!("block {} is not a paragraph", id.0))),
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
                style,
                link,
            } => {
                if text.contains(['\n', '\r']) {
                    return Err(invalid("text must not contain line feeds"));
                }
                let (at, _) = self.range(*block, *offset, *offset)?;
                let p = self.para(*block)?;
                let mut run = match props {
                    Some(props) => {
                        let mut r = Run::styled("", style.clone(), props.clone());
                        r.link.clone_from(link);
                        r
                    }
                    None => {
                        let mut r = inherited_run(p, at);
                        if link.is_some() {
                            r.link.clone_from(link);
                        }
                        r
                    }
                };
                run.style = run
                    .style
                    .filter(|s| !s.is_empty() && self.doc.styles.get(s).is_some());
                run.text.clone_from(text);
                let n = text.chars().count();
                let inline = Inline::Run(run);
                replace_range(self.para_mut(*block)?, at, at, vec![inline]);
                ch.block(*block);
                Ok(C::DeleteText {
                    block: *block,
                    from: *offset,
                    to: to_u32(at + n),
                })
            }
            C::DeleteText { block, from, to } => {
                self.restore_inlines(*block, *from, *to, Vec::new(), true, ch)
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
                let mut run = if f < t {
                    run_format_at(p, f)
                } else {
                    inherited_run(p, f)
                };
                let new = if text.is_empty() {
                    Vec::new()
                } else {
                    run.text.clone_from(text);
                    vec![Inline::Run(run)]
                };
                self.restore_inlines(*block, *from, *to, new, true, ch)
            }
            C::RestoreInlines {
                block,
                from,
                to,
                inlines,
            } => self.restore_inlines(*block, *from, *to, inlines.clone(), false, ch),
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
                self.edit_paragraph_props(blocks, ch, |_, props| {
                    props.apply(patch);
                    // `auto` = no fill (removes the direct shading).
                    if patch.shading == Some(Color::Auto) {
                        props.shading = None;
                    }
                })
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
                    Some(s) if s.kind.is_paragraph() => {}
                    _ => return Err(WriteError::UnknownStyle(style.clone())),
                }
                self.paras(blocks)?;
                let value = (self.default_style().as_deref() != Some(style.as_str()))
                    .then(|| style.clone());
                self.edit_paragraph_props(blocks, ch, |_, props| props.style.clone_from(&value))
            }
            C::ApplyCharacterStyle {
                block,
                from,
                to,
                style,
            } => {
                let style = match style.as_deref().filter(|s| !s.is_empty()) {
                    None => None,
                    Some(id) => match self.doc.styles.get(id) {
                        Some(s) if s.kind == StyleKind::Character => Some(s.id.clone()),
                        Some(s) if s.kind == StyleKind::Linked => {
                            Some(s.link.clone().unwrap_or_else(|| s.id.clone()))
                        }
                        _ => return Err(WriteError::UnknownStyle(id.to_owned())),
                    },
                };
                let (f, t) = self.range(*block, *from, *to)?;
                let old = slice(self.para(*block)?, f, t);
                for_each_run_mut_in(self.para_mut(*block)?, f, t, |r| r.style.clone_from(&style));
                ch.block(*block);
                Ok(C::RestoreInlines {
                    block: *block,
                    from: *from,
                    to: *to,
                    inlines: old,
                })
            }
            C::AddStyle { style } => {
                let old = self.doc.styles.clone();
                self.doc.styles.add(style.clone()).map_err(style_err)?;
                ch.styles = true;
                Ok(C::RestoreStyles { styles: old })
            }
            C::UpdateStyle { id, patch } => {
                let old = self.doc.styles.clone();
                self.doc.styles.update(id, patch).map_err(style_err)?;
                ch.styles = true;
                self.report_style_users(id, ch);
                Ok(C::RestoreStyles { styles: old })
            }
            C::RenameStyle { id, name } => {
                let old = self.doc.styles.clone();
                self.doc.styles.rename(id, name).map_err(style_err)?;
                ch.styles = true;
                Ok(C::RestoreStyles { styles: old })
            }
            C::SetDefaultStyle { kind, id } => {
                let old = self.doc.styles.clone();
                self.doc.styles.set_default(*kind, id).map_err(style_err)?;
                ch.styles = true;
                // Unstyled paragraphs now use the new default.
                self.report_style_users(id, ch);
                if let Some(prev) = old.default_style(*kind) {
                    let prev = prev.id.clone();
                    for b in self.doc.blocks_with_style(&prev) {
                        ch.block(b);
                    }
                }
                Ok(C::RestoreStyles { styles: old })
            }
            C::DeleteStyle { id, replacement } => self.delete_style(id, replacement.as_deref(), ch),
            C::UpdateStyleFromSelection { id, block, offset } => {
                self.update_style_from_selection(id, *block, *offset, ch)
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
                    anchor: None,
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
                t.normalize_merges();
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
                t.normalize_merges();
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
                            margins: match (old.margins, patch.margins) {
                                (Some(a), Some(b)) => Some(a.merged_with(&b)),
                                (a, b) => b.or(a),
                            },
                        };
                        Ok((id, new))
                    })
                    .collect::<R<Vec<_>>>()?;
                self.restore_cell_props(&items, ch)
            }
            C::RestoreCellProps { items } => self.restore_cell_props(items, ch),
            C::SetTableProps { table, patch } => self.set_table_props(*table, patch, ch),
            C::MergeCells {
                table,
                top,
                left,
                bottom,
                right,
            } => {
                let (r0, c0, r1, c1) = (
                    *top as usize,
                    *left as usize,
                    *bottom as usize,
                    *right as usize,
                );
                let mut next = self.doc.alloc_id().0;
                let mut used = 0;
                let inv = self.edit_table(*table, ch, |t| {
                    t.merge_cells(r0, c0, r1, c1, || {
                        used += 1;
                        let id = NodeId(next);
                        next += 1;
                        id
                    })
                    .map_err(|e| invalid(e.to_string()))
                })?;
                if used > 0 {
                    self.doc.reserve_id(NodeId(next - 1));
                }
                Ok(inv)
            }
            C::SplitCell {
                table,
                row,
                col,
                rows,
                cols,
            } => {
                let mut next = self.doc.alloc_id().0;
                let inv = self.edit_table(*table, ch, |t| {
                    t.split_cell(
                        *row as usize,
                        *col as usize,
                        *rows as usize,
                        *cols as usize,
                        || {
                            let id = NodeId(next);
                            next += 1;
                            id
                        },
                    )
                    .map_err(|e| invalid(e.to_string()))
                })?;
                self.doc.reserve_id(NodeId(next));
                Ok(inv)
            }
            C::SetImageAnchor {
                block,
                offset,
                anchor,
            } => {
                let anchor = *anchor;
                self.edit_image(*block, *offset, ch, |img| img.anchor = anchor)
            }
            C::SetImageWrap {
                block,
                offset,
                wrap,
            } => {
                let wrap = *wrap;
                self.edit_image(*block, *offset, ch, |img| match &mut img.anchor {
                    Some(a) => a.wrap = wrap,
                    None => img.anchor = Some(Anchor::new(wrap)),
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
            C::SetPage { patch } => self.set_page(patch, ch),
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
                cant_split,
            } => self.edit_table(*table, ch, |t| {
                for &r in rows {
                    let row = t
                        .rows
                        .get_mut(r as usize)
                        .ok_or_else(|| invalid(format!("row {r} out of range")))?;
                    if let Some(hd) = header {
                        row.props.header = *hd;
                    }
                    if let Some(cs) = cant_split {
                        row.props.cant_split = *cs;
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
                keep_style,
            } => {
                let (f, t) = self.range(*block, *from, *to)?;
                let p = self.para(*block)?;
                let old_inlines = slice(p, f, t);
                let old_props = p.props.clone();
                let p = self.para_mut(*block)?;
                for_each_run_mut_in(p, f, t, |r| {
                    r.props = RunProperties::default();
                    r.style = None;
                });
                if *paragraph && *keep_style {
                    p.props = ParagraphProperties {
                        style: p.props.style.take(),
                        numbering: p.props.numbering,
                        section_end: p.props.section_end,
                        ..Default::default()
                    };
                } else if *paragraph {
                    p.props = ParagraphProperties {
                        section_end: p.props.section_end,
                        ..Default::default()
                    };
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
                wildcards,
                format,
                replace_format,
            } => {
                let query = FindQuery {
                    text: find.clone(),
                    match_case: *match_case,
                    whole_word: *whole_word,
                    wildcards: *wildcards,
                    format: format.clone(),
                };
                self.find_replace(&query, replace, replace_format.as_ref(), *all, ch)
            }
            C::InsertField {
                block,
                offset,
                field,
                cached,
            } => {
                let (at, _) = self.range(*block, *offset, *offset)?;
                let props = inherited_props(self.para(*block)?, at);
                let inline = Inline::Field(Field {
                    kind: field.clone(),
                    cached: cached.clone().unwrap_or_default(),
                    props,
                });
                replace_range(self.para_mut(*block)?, at, at, vec![inline]);
                ch.block(*block);
                Ok(C::DeleteText {
                    block: *block,
                    from: *offset,
                    to: *offset + 1,
                })
            }
            C::InsertFootnote {
                block,
                offset,
                text,
                kind,
            } => self.insert_footnote(*block, *offset, text, *kind, ch),
            C::DeleteFootnote { id } => self.delete_footnote(*id, ch),
            C::ReplaceNote { id, blocks } => {
                let i = self
                    .doc
                    .notes
                    .iter()
                    .position(|n| n.id == *id)
                    .ok_or_else(|| invalid(format!("unknown note {id}")))?;
                let old = self.doc.notes.clone();
                let freed = subtree_ids(&self.doc.notes[i].blocks);
                let mut ids = Ids::new(&self.doc, &freed);
                let mut new = blocks
                    .iter()
                    .map(|b| ids.block(&mut self.doc, ch, b))
                    .collect::<R<Vec<_>>>()?;
                if !matches!(new.last(), Some(Block::Paragraph(_))) {
                    new.push(Block::Paragraph(Paragraph::new(self.doc.alloc_id())));
                }
                self.doc.notes[i].blocks = new;
                ch.notes = true;
                Ok(C::RestoreNotes { notes: old })
            }
            C::RestoreNotes { notes } => {
                let old = std::mem::replace(&mut self.doc.notes, notes.clone());
                self.reserve_all();
                ch.notes = true;
                Ok(C::RestoreNotes { notes: old })
            }
            C::RestoreStyles { styles } => {
                let old = std::mem::replace(&mut self.doc.styles, styles.clone());
                ch.styles = true;
                Ok(C::RestoreStyles { styles: old })
            }
            C::RestoreSections { sections, page } => {
                let old_sections = std::mem::replace(&mut self.doc.sections, sections.clone());
                let old_page = std::mem::replace(&mut self.doc.page, page.clone());
                self.reserve_all();
                ch.sections = true;
                ch.page = true;
                Ok(C::RestoreSections {
                    sections: old_sections,
                    page: old_page,
                })
            }
            C::InsertToc {
                after,
                from_level,
                to_level,
                title,
                new_id,
                caption,
            } => {
                let from = from_level.unwrap_or(1).clamp(1, 9);
                let to = to_level.unwrap_or(3).clamp(from, 9);
                let index = self.insert_index(*after, None)?;
                let old_styles = self.doc.styles.clone();
                let caption = caption.clone().filter(|c| !c.trim().is_empty());
                if caption.is_some() {
                    self.ensure_builtin_style("TableofFigures");
                } else {
                    self.ensure_toc_styles(to);
                }
                let mut ids = Ids::new(&self.doc, &[]);
                let id = ids.resolve(&mut self.doc, ch, *new_id)?;
                let mut toc = Toc {
                    id,
                    from_level: from,
                    to_level: to,
                    title: title.clone().filter(|t| !t.is_empty()),
                    entries: Vec::new(),
                    caption,
                };
                toc.entries = self.doc.toc_entries(&toc);
                self.doc.body.insert(index, Block::Toc(toc));
                ch.structural(&self.doc, None, &[id], &[]);
                Ok(self.with_styles(C::DeleteBlocks { ids: vec![id] }, old_styles, ch))
            }
            C::UpdateToc { id, pages } => {
                let Some(Block::Toc(old)) = self.doc.find_block(*id).cloned() else {
                    return Err(match self.doc.find_block(*id) {
                        Some(_) => invalid(format!("block {} is not a table of contents", id.0)),
                        None => WriteError::UnknownBlock(id.0),
                    });
                };
                let pages: HashMap<NodeId, u32> = pages.iter().copied().collect();
                let mut entries = self.doc.toc_entries(&old);
                for e in &mut entries {
                    e.page = pages.get(&e.target).copied();
                }
                if let Some(Block::Toc(t)) = self.doc.find_block_mut(*id) {
                    t.entries = entries;
                }
                ch.block(*id);
                Ok(C::ReplaceBlocks {
                    ids: vec![*id],
                    blocks: vec![NewBlock::from(&Block::Toc(old))],
                })
            }
            C::RestartList { block, start } => self.restart_list(*block, *start, ch),
            C::ContinueList { block } => self.continue_list(*block, ch),
            C::InsertSectionBreak { block, kind } => self.insert_section_break(*block, *kind, ch),
            C::RemoveSectionBreak { section } => self.remove_section_break(*section, ch),
            C::SetSection { section, patch } => self.set_section(*section, patch, ch),
            C::SetHeaderFooter {
                section,
                footer,
                slot,
                blocks,
            } => {
                let i = self.section_index(*section)?;
                let old = self.sections_state();
                let freed = self.doc.sections[i]
                    .header_footer(*footer)
                    .get(*slot)
                    .map(|b| subtree_ids(b))
                    .unwrap_or_default();
                let new = match blocks {
                    None => None,
                    Some(blocks) => {
                        let mut ids = Ids::new(&self.doc, &freed);
                        let mut new = blocks
                            .iter()
                            .map(|b| ids.block(&mut self.doc, ch, b))
                            .collect::<R<Vec<_>>>()?;
                        if !matches!(new.last(), Some(Block::Paragraph(_))) {
                            new.push(Block::Paragraph(Paragraph::new(self.doc.alloc_id())));
                        }
                        Some(new)
                    }
                };
                *self.doc.sections[i]
                    .header_footer_mut(*footer)
                    .get_mut(*slot) = new;
                ch.sections = true;
                Ok(old)
            }
            C::UpdateFields {
                values,
                refresh: Some(refresh),
            } => self.refresh_fields(values, refresh, ch),
            C::UpdateFields {
                values,
                refresh: None,
            } => {
                // Validate everything first: on error nothing changes.
                for (block, offset, _) in values {
                    let p = self.para(*block)?;
                    if field_index(p, *offset).is_none() {
                        return Err(invalid(format!(
                            "no field at {offset} in block {}",
                            block.0
                        )));
                    }
                }
                let mut old = Vec::with_capacity(values.len());
                for (block, offset, text) in values {
                    let p = self.para_mut(*block)?;
                    if let Some(Inline::Field(f)) =
                        field_index(p, *offset).map(|i| &mut p.inlines[i])
                    {
                        old.push((
                            *block,
                            *offset,
                            std::mem::replace(&mut f.cached, text.clone()),
                        ));
                    }
                    ch.block(*block);
                }
                old.reverse();
                Ok(C::UpdateFields {
                    values: old,
                    refresh: None,
                })
            }
            C::SetHyperlink {
                block,
                from,
                to,
                link,
                text,
            } => self.set_hyperlink(*block, *from, *to, Some(link), text.as_deref(), ch),
            C::RemoveHyperlink { block, from, to } => {
                self.set_hyperlink(*block, *from, *to, None, None, ch)
            }
            C::AddBookmark { name, start, end } => self.add_bookmark(name, *start, *end, ch),
            C::DeleteBookmark { name } => {
                let b = self
                    .doc
                    .bookmark(name)
                    .ok_or_else(|| invalid(format!("no bookmark {name:?}")))?;
                self.remove_bookmark_markers(b.id, ch)
            }
            C::InsertCrossReference {
                block,
                offset,
                target,
                show,
                hyperlink,
                page,
            } => self.insert_cross_reference(*block, *offset, target, *show, *hyperlink, *page, ch),
            C::InsertCaption {
                anchor,
                below,
                label,
                text,
                new_id,
            } => self.insert_caption(*anchor, *below, label, text, *new_id, ch),
            C::SetProperties { patch } => {
                let old = self.doc.properties.clone();
                self.doc.properties.apply(patch);
                ch.properties = true;
                Ok(C::RestoreProperties { properties: old })
            }
            C::RestoreProperties { properties } => {
                let old = std::mem::replace(&mut self.doc.properties, properties.clone());
                ch.properties = true;
                Ok(C::RestoreProperties { properties: old })
            }
            C::SetSettings { settings } => {
                let old = std::mem::replace(&mut self.doc.settings, *settings);
                ch.settings = true;
                Ok(C::SetSettings { settings: old })
            }
            C::AddComment {
                start,
                end,
                text,
                author,
                initials,
                date,
            } => self.add_comment(*start, *end, text, author, initials, date, ch),
            C::ReplyComment {
                parent,
                text,
                author,
                initials,
                date,
            } => {
                self.comment_or_err(*parent)?;
                let root = self.doc.thread_root(*parent);
                let old = self.doc.comments.clone();
                let resolved = self.doc.comment(root).is_some_and(|c| c.resolved);
                let mut c = self.new_comment(text, author, initials, date);
                c.parent = Some(root);
                c.resolved = resolved;
                // After the thread's last comment.
                let at = self
                    .doc
                    .comments
                    .iter()
                    .rposition(|x| x.id == root || x.parent == Some(root))
                    .map_or(self.doc.comments.len(), |i| i + 1);
                self.doc.comments.insert(at, c);
                ch.comments = true;
                Ok(C::RestoreComments { comments: old })
            }
            C::EditComment { id, text } => {
                let style = self
                    .comment_or_err(*id)?
                    .content
                    .first()
                    .and_then(Block::as_paragraph)
                    .and_then(|p| p.props.style.clone())
                    .or_else(|| self.doc.styles.get("CommentText").map(|s| s.id.clone()));
                let old = self.doc.comments.clone();
                let content = self.doc.comment_blocks(text, style.as_deref());
                if let Some(c) = self.doc.comments.iter_mut().find(|c| c.id == *id) {
                    c.content = content;
                }
                ch.comments = true;
                Ok(C::RestoreComments { comments: old })
            }
            C::DeleteComment { id } => {
                let c = self.comment_or_err(*id)?;
                if c.is_reply() {
                    let old = self.doc.comments.clone();
                    self.doc.comments.retain(|c| c.id != *id);
                    ch.comments = true;
                    return Ok(C::RestoreComments { comments: old });
                }
                self.delete_threads(&[*id], ch)
            }
            C::DeleteAllComments { resolved_only } => {
                let roots: Vec<CommentId> = self
                    .doc
                    .comments
                    .iter()
                    .filter(|c| !c.is_reply() && (!*resolved_only || c.resolved))
                    .map(|c| c.id)
                    .collect();
                self.delete_threads(&roots, ch)
            }
            C::ResolveComment { id } | C::ReopenComment { id } => {
                self.comment_or_err(*id)?;
                let done = matches!(cmd, C::ResolveComment { .. });
                let root = self.doc.thread_root(*id);
                let old = self.doc.comments.clone();
                for c in &mut self.doc.comments {
                    if c.id == root || c.parent == Some(root) {
                        c.resolved = done;
                    }
                }
                ch.comments = true;
                Ok(C::RestoreComments { comments: old })
            }
            C::RestoreComments { comments } => {
                let old = std::mem::replace(&mut self.doc.comments, comments.clone());
                self.reserve_all();
                ch.comments = true;
                Ok(C::RestoreComments { comments: old })
            }
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

    // ----- hyperlinks, bookmarks, cross-references, captions -------------

    /// Whether any paragraph holds a bookmark marker.
    fn has_bookmarks(&self) -> bool {
        self.doc
            .containers()
            .flat_map(|c| model_text::document::paragraphs_in(c))
            .any(|p| p.inlines.iter().any(Inline::is_bookmark_marker))
    }

    /// Adds Word's built-in style `id` (from the default style set, or
    /// `table of figures`) when missing.
    fn ensure_builtin_style(&mut self, id: &str) {
        if self.doc.styles.get(id).is_some() {
            return;
        }
        if let Some(s) = model_text::StyleSheet::office_defaults().get(id) {
            let mut s = s.clone();
            if s.based_on
                .as_deref()
                .is_some_and(|b| self.doc.styles.get(b).is_none())
            {
                s.based_on = self.default_style();
            }
            if s.next
                .as_deref()
                .is_some_and(|b| self.doc.styles.get(b).is_none())
            {
                s.next = None;
            }
            self.doc.styles.insert(s);
            return;
        }
        if id == "TableofFigures" {
            let normal = self.default_style();
            let mut s = Style::new("TableofFigures", "table of figures", StyleKind::Paragraph);
            s.based_on.clone_from(&normal);
            s.next = normal;
            s.priority = Some(99);
            s.unhide_when_used = true;
            s.paragraph.spacing = Some(Spacing {
                after: Some(Twips(0)),
                ..Default::default()
            });
            self.doc.styles.insert(s);
        }
    }

    /// The inverse restoring the inlines of `paragraphs` as they were
    /// (`old`), for paragraphs changed in place.
    fn restore_paragraphs(&self, old: Vec<(NodeId, Vec<Inline>)>, ch: &mut Changes) -> R<C> {
        let mut cmds = Vec::with_capacity(old.len());
        for (b, inlines) in old {
            ch.block(b);
            let len = self.para(b)?.len();
            cmds.push(C::RestoreInlines {
                block: b,
                from: 0,
                to: to_u32(len),
                inlines,
            });
        }
        Ok(C::Compound { commands: cmds })
    }

    /// Snapshot of the inlines of `blocks` (distinct, validated).
    fn snapshot_inlines(&self, blocks: &[NodeId]) -> R<Vec<(NodeId, Vec<Inline>)>> {
        let mut out: Vec<(NodeId, Vec<Inline>)> = Vec::new();
        for &b in blocks {
            if !out.iter().any(|(x, _)| *x == b) {
                out.push((b, self.para(b)?.inlines.clone()));
            }
        }
        Ok(out)
    }

    /// `SetHyperlink` (`link` = `Some`) / `RemoveHyperlink`.
    fn set_hyperlink(
        &mut self,
        block: NodeId,
        from: u32,
        to: u32,
        link: Option<&Hyperlink>,
        text: Option<&str>,
        ch: &mut Changes,
    ) -> R<C> {
        let (f, t) = self.range(block, from, to)?;
        if let Some(l) = link {
            let empty = match &l.target {
                LinkTarget::Url(u) => u.trim().is_empty(),
                LinkTarget::Bookmark(b) => b.trim().is_empty(),
                LinkTarget::Email { address, .. } => address.trim().is_empty(),
            };
            if empty {
                return Err(invalid("a hyperlink needs an address"));
            }
        }
        let text = text.filter(|s| !s.is_empty());
        if text.is_some_and(|s| s.contains(['\n', '\r'])) {
            return Err(invalid("text must not contain line feeds"));
        }
        if f == t && text.is_none() {
            return Err(invalid("nothing to link"));
        }
        let old = self.snapshot_inlines(&[block])?;
        let old_styles = self.doc.styles.clone();
        if link.is_some() {
            self.ensure_builtin_style("Hyperlink");
        }
        let (mut s, mut e) = (f, t);
        if let Some(text) = text {
            let p = self.para(block)?;
            let mut run = if f < t {
                run_format_at(p, f)
            } else {
                inherited_run(p, f)
            };
            run.text = text.to_owned();
            let p = self.para_mut(block)?;
            let (_, kept) = replace_keeping_markers(p, f, t, vec![Inline::Run(run)]);
            let lead = kept_ends_before(p, f, kept);
            s = f + lead;
            e = s + text.chars().count();
        }
        let style = self
            .doc
            .styles
            .get("Hyperlink")
            .filter(|s| s.kind == StyleKind::Character)
            .map(|s| s.id.clone());
        for_each_run_mut_in(self.para_mut(block)?, s, e, |r| match link {
            Some(l) => {
                r.link = Some(l.clone());
                if r.style.is_none() {
                    r.style.clone_from(&style);
                }
            }
            None => {
                r.link = None;
                if r.style.as_deref() == Some("Hyperlink") {
                    r.style = None;
                }
            }
        });
        let inverse = self.restore_paragraphs(old, ch)?;
        Ok(self.with_styles(inverse, old_styles, ch))
    }

    /// Document order of the paragraph `id` among the paragraphs of the
    /// text containers (body, notes, headers, footers).
    fn text_order(&self, id: NodeId) -> R<usize> {
        let mut n = 0;
        for c in self.doc.containers() {
            for p in model_text::document::paragraphs_in(c) {
                if p.id == id {
                    if self.doc.comments.iter().any(|cm| {
                        model_text::document::paragraphs_in(&cm.content).any(|x| x.id == id)
                    }) {
                        return Err(invalid("bookmarks cannot be added to comments"));
                    }
                    return Ok(n);
                }
                n += 1;
            }
        }
        self.para(id)?;
        Err(invalid(format!("block {} is not a paragraph", id.0)))
    }

    fn add_bookmark(
        &mut self,
        name: &str,
        start: CommentPoint,
        end: CommentPoint,
        ch: &mut Changes,
    ) -> R<C> {
        if !valid_bookmark_name(name) {
            return Err(invalid(format!("invalid bookmark name {name:?}")));
        }
        let (s, _) = self.range(start.block, start.offset, start.offset)?;
        let (e, _) = self.range(end.block, end.offset, end.offset)?;
        if (self.text_order(start.block)?, s) > (self.text_order(end.block)?, e) {
            return Err(invalid("the bookmark's start is after its end"));
        }
        let existing = self.doc.bookmark(name);
        let mut touched = vec![start.block, end.block];
        if let Some(b) = &existing {
            touched.extend([b.start_block, b.end_block]);
        }
        let old = self.snapshot_inlines(&touched)?;
        let (mut s, mut e) = (s, e);
        if let Some(b) = &existing {
            // Moving an existing bookmark: its markers go first, shifting
            // the new positions behind them.
            for (pid, at) in [(b.start_block, b.start), (b.end_block, b.end)] {
                if pid == start.block && at < s {
                    s -= 1;
                }
                if pid == end.block && at < e {
                    e -= 1;
                }
            }
            for c in self.doc.containers_mut() {
                strip_bookmark(c, b.id);
            }
        }
        let id = self.doc.next_bookmark_id();
        replace_range(
            self.para_mut(end.block)?,
            e,
            e,
            vec![Inline::BookmarkEnd { id }],
        );
        replace_range(
            self.para_mut(start.block)?,
            s,
            s,
            vec![Inline::BookmarkStart {
                id,
                name: name.to_owned(),
            }],
        );
        self.restore_paragraphs(old, ch)
    }

    /// Removes the markers of bookmark `id`.
    fn remove_bookmark_markers(&mut self, id: BookmarkId, ch: &mut Changes) -> R<C> {
        let blocks: Vec<NodeId> = self
            .doc
            .containers()
            .flat_map(|c| model_text::document::paragraphs_in(c))
            .filter(|p| {
                p.inlines
                    .iter()
                    .any(|i| model_text::bookmark_marker_of(i).is_some_and(|(b, _)| b == id))
            })
            .map(|p| p.id)
            .collect();
        let old = self.snapshot_inlines(&blocks)?;
        for c in self.doc.containers_mut() {
            strip_bookmark(c, id);
        }
        self.restore_paragraphs(old, ch)
    }

    /// The hidden `_Ref` bookmark for a cross-reference to `target`
    /// (created if needed) → its name, and the paragraphs it changed.
    fn reference_bookmark(&mut self, target: &RefTarget) -> R<(String, Option<NewMarks>)> {
        let (pid, s, e) = match target {
            RefTarget::Bookmark(name) => {
                let b = self
                    .doc
                    .bookmark(name)
                    .ok_or_else(|| invalid(format!("no bookmark {name:?}")))?;
                return Ok((b.name, None));
            }
            RefTarget::Paragraph(pid) => (*pid, 0, self.para(*pid)?.len()),
            RefTarget::CaptionLabel(pid) => {
                let p = self.para(*pid)?;
                let mut pos = 0;
                let mut end = None;
                for i in &p.inlines {
                    pos += inline_len(i);
                    if matches!(i, Inline::Field(f) if matches!(f.kind, FieldKind::Seq { .. })) {
                        end = Some(pos);
                        break;
                    }
                }
                let end =
                    end.ok_or_else(|| invalid(format!("block {} is not a caption", pid.0)))?;
                (*pid, 0, end)
            }
            RefTarget::Note(id) => {
                let mut found = None;
                for p in self.doc.paragraphs() {
                    let mut pos = 0;
                    for i in &p.inlines {
                        if matches!(i, Inline::NoteRef(r) if r.id == *id) {
                            found = Some((p.id, pos, pos + 1));
                            break;
                        }
                        pos += inline_len(i);
                    }
                    if found.is_some() {
                        break;
                    }
                }
                found.ok_or_else(|| invalid(format!("no reference to note {id}")))?
            }
        };
        // Reuse a hidden bookmark that marks exactly this text.
        let p = self.para(pid)?.clone();
        let want = model_text::link::display_text_of(&p, s, e);
        for b in self.doc.bookmarks() {
            if b.hidden()
                && b.name.starts_with("_Ref")
                && b.start_block == pid
                && b.end_block == pid
                && self.doc.bookmark_text(&b) == want.trim()
                && b.start <= s
                && b.end <= e + 2
            {
                let covers_note = !matches!(target, RefTarget::Note(_)) || b.end == b.start + 2;
                if covers_note {
                    return Ok((b.name, None));
                }
            }
        }
        let name = self.doc.next_ref_name();
        let id = self.doc.next_bookmark_id();
        let para = self.para_mut(pid)?;
        replace_range(para, e, e, vec![Inline::BookmarkEnd { id }]);
        replace_range(
            para,
            s,
            s,
            vec![Inline::BookmarkStart {
                id,
                name: name.clone(),
            }],
        );
        Ok((name, Some((pid, s, e))))
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_cross_reference(
        &mut self,
        block: NodeId,
        offset: u32,
        target: &RefTarget,
        show: RefShow,
        hyperlink: bool,
        page: Option<u32>,
        ch: &mut Changes,
    ) -> R<C> {
        let (mut at, _) = self.range(block, offset, offset)?;
        let mut touched = vec![block];
        match target {
            RefTarget::Paragraph(p) | RefTarget::CaptionLabel(p) => touched.push(*p),
            RefTarget::Note(id) => {
                if let Some(p) = self.doc.paragraphs().find(|p| {
                    p.inlines
                        .iter()
                        .any(|i| matches!(i, Inline::NoteRef(r) if r.id == *id))
                }) {
                    touched.push(p.id);
                }
            }
            RefTarget::Bookmark(_) => {}
        }
        let old = self.snapshot_inlines(&touched)?;
        let (name, added) = self.reference_bookmark(target)?;
        if let Some((pid, s, e)) = added {
            if pid == block {
                at += usize::from(s <= at) + usize::from(e <= at);
            }
        }
        let note = matches!(target, RefTarget::Note(_));
        let kind = match show {
            RefShow::Text => FieldKind::Ref {
                bookmark: name.clone(),
                hyperlink,
                number: false,
            },
            RefShow::Page => FieldKind::PageRef {
                bookmark: name.clone(),
                hyperlink,
            },
            RefShow::Number if !note => FieldKind::Ref {
                bookmark: name.clone(),
                hyperlink,
                number: true,
            },
            RefShow::Number | RefShow::NoteFormatted => FieldKind::NoteRef {
                bookmark: name.clone(),
                hyperlink,
                formatted: show == RefShow::NoteFormatted,
            },
        };
        let mut props = inherited_props(self.para(block)?, at);
        if show == RefShow::NoteFormatted {
            props.vertical_align = Some(core_model::VerticalAlign::Superscript);
        }
        replace_range(
            self.para_mut(block)?,
            at,
            at,
            vec![Inline::Field(Field {
                kind,
                cached: String::new(),
                props,
            })],
        );
        let mut pages = HashMap::new();
        if let (Some(page), Some(b)) = (page, self.doc.bookmark(&name)) {
            pages.insert(b.start_block, page);
        }
        let value = self
            .doc
            .computed_fields(&pages)
            .into_iter()
            .find(|(b, o, _)| *b == block && *o == at)
            .map(|v| v.2);
        if let Some(v) = value {
            self.doc.set_field_results(&[(block, at, v)]);
        }
        self.restore_paragraphs(old, ch)
    }

    fn insert_caption(
        &mut self,
        anchor: NodeId,
        below: bool,
        label: &str,
        text: &str,
        new_id: Option<i64>,
        ch: &mut Changes,
    ) -> R<C> {
        let label = label.trim();
        if label.is_empty() {
            return Err(invalid("a caption needs a label"));
        }
        if text.contains(['\n', '\r']) {
            return Err(invalid("text must not contain line feeds"));
        }
        let pos = self.pos(anchor)?;
        let old_styles = self.doc.styles.clone();
        self.ensure_builtin_style("Caption");
        let mut ids = Ids::new(&self.doc, &[]);
        let id = ids.resolve(&mut self.doc, ch, new_id)?;
        let mut p = Paragraph::new(id);
        p.props.style = self.doc.styles.get("Caption").map(|s| s.id.clone());
        p.inlines.push(Inline::Run(Run::new(format!("{label} "))));
        p.inlines.push(Inline::Field(Field {
            cached: "1".into(),
            ..Field::new(FieldKind::Seq {
                identifier: label.replace(char::is_whitespace, "_"),
                format: None,
                reset: None,
            })
        }));
        if !text.is_empty() {
            p.inlines.push(Inline::Run(Run::new(text)));
        }
        let blocks =
            container_mut(&mut self.doc, pos.parent).ok_or(WriteError::UnknownBlock(anchor.0))?;
        blocks.insert(pos.index + usize::from(below), Block::Paragraph(p));
        ch.structural(&self.doc, pos.parent, &[id], &[]);
        // Renumber every sequence (later captions move up by one).
        let seq: Vec<model_text::FieldValue> = self
            .doc
            .computed_fields(&HashMap::new())
            .into_iter()
            .filter(|(b, o, _)| {
                self.doc
                    .find_paragraph(*b)
                    .and_then(|p| field_index(p, to_u32(*o)).map(|i| &p.inlines[i]))
                    .is_some_and(|i| matches!(i, Inline::Field(f) if matches!(f.kind, FieldKind::Seq { .. })))
            })
            .collect();
        let old = self.doc.set_field_results(&seq);
        let mut old_values = Vec::new();
        for (b, o, v) in old {
            if b != id {
                ch.block(b);
                old_values.push((b, to_u32(o), v));
            }
        }
        let inverse = C::Compound {
            commands: vec![
                C::UpdateFields {
                    values: old_values,
                    refresh: None,
                },
                C::DeleteBlocks { ids: vec![id] },
            ],
        };
        Ok(self.with_styles(inverse, old_styles, ch))
    }

    /// `UpdateFields` with `refresh`: the computed results (in `blocks`
    /// only, if given), then `values` on top.
    fn refresh_fields(
        &mut self,
        values: &[(NodeId, u32, String)],
        refresh: &FieldRefresh,
        ch: &mut Changes,
    ) -> R<C> {
        for (block, offset, _) in values {
            let p = self.para(*block)?;
            if field_index(p, *offset).is_none() {
                return Err(invalid(format!(
                    "no field at {offset} in block {}",
                    block.0
                )));
            }
        }
        let pages: HashMap<NodeId, u32> = refresh.pages.iter().copied().collect();
        let scope: Option<HashSet<NodeId>> =
            refresh.blocks.as_ref().map(|b| b.iter().copied().collect());
        let explicit: HashSet<(NodeId, usize)> =
            values.iter().map(|(b, o, _)| (*b, *o as usize)).collect();
        let mut all: Vec<model_text::FieldValue> = self
            .doc
            .computed_fields(&pages)
            .into_iter()
            .filter(|(b, o, _)| {
                scope.as_ref().map_or(true, |s| s.contains(b)) && !explicit.contains(&(*b, *o))
            })
            .collect();
        all.extend(values.iter().map(|(b, o, v)| (*b, *o as usize, v.clone())));
        let old = self.doc.set_field_results(&all);
        let mut inverse = Vec::with_capacity(old.len());
        for (b, o, v) in old {
            ch.block(b);
            inverse.push((b, to_u32(o), v));
        }
        Ok(C::UpdateFields {
            values: inverse,
            refresh: None,
        })
    }

    /// Records a save in the document properties (not an edit: no undo
    /// step): `modified`, `created` when unset, `lastModifiedBy` and the
    /// author when unset, the page count, revision + 1.
    pub fn stamp_save(&mut self, modified: Option<&str>, user: Option<&str>, pages: Option<u32>) {
        let p = &mut self.doc.properties;
        if let Some(m) = modified.filter(|m| !m.is_empty()) {
            p.modified = Some(m.to_owned());
            if p.created.is_none() {
                p.created = Some(m.to_owned());
            }
        }
        let user = user
            .filter(|u| !u.trim().is_empty())
            .map(str::to_owned)
            .or_else(|| self.user.as_ref().map(|u| u.name.clone()));
        if let Some(u) = user {
            p.last_modified_by = Some(u.clone());
            if p.author.is_none() {
                p.author = Some(u);
            }
        }
        if pages.is_some() {
            p.pages = pages;
        }
        p.revision = Some(p.revision.unwrap_or(0) + 1);
    }

    // ----- comments ------------------------------------------------------

    /// Sets the author of new comments (`SetUser`); empty initials are
    /// derived from the name.
    pub fn set_user(&mut self, name: &str, initials: Option<&str>) {
        let name = name.trim();
        self.user = (!name.is_empty()).then(|| User {
            name: name.to_owned(),
            initials: initials
                .map(str::trim)
                .filter(|i| !i.is_empty())
                .map_or_else(|| initials_of(name), str::to_owned),
        });
    }

    fn comment_or_err(&self, id: CommentId) -> R<&Comment> {
        self.doc
            .comment(id)
            .ok_or_else(|| invalid(format!("unknown comment {}", id.0)))
    }

    /// A comment by the given or the current user, with `text` (style
    /// `CommentText` when defined).
    fn new_comment(
        &mut self,
        text: &str,
        author: &Option<String>,
        initials: &Option<String>,
        date: &Option<String>,
    ) -> Comment {
        let author = author
            .clone()
            .filter(|a| !a.trim().is_empty())
            .or_else(|| self.user.as_ref().map(|u| u.name.clone()))
            .unwrap_or_else(|| "Author".to_owned());
        let initials = initials
            .clone()
            .filter(|i| !i.trim().is_empty())
            .or_else(|| {
                self.user
                    .as_ref()
                    .filter(|u| u.name == author)
                    .map(|u| u.initials.clone())
            })
            .unwrap_or_else(|| initials_of(&author));
        let style = self.doc.styles.get("CommentText").map(|s| s.id.clone());
        let id = self.doc.next_comment_id();
        let mut c = Comment::new(&mut self.doc, id, author, text, style.as_deref());
        c.initials = initials;
        c.date = date.clone().filter(|d| !d.is_empty());
        c
    }

    /// Word's comment text and reference styles, when missing.
    fn ensure_comment_styles(&mut self) {
        let normal = self.default_style();
        self.ensure_style(Style {
            id: "CommentText".into(),
            name: "annotation text".into(),
            kind: StyleKind::Paragraph,
            based_on: normal.clone(),
            next: None,
            paragraph: ParagraphProperties {
                spacing: Some(Spacing {
                    line: Some(LineSpacing::Multiple(1.0)),
                    ..Default::default()
                }),
                ..Default::default()
            },
            run: RunProperties {
                size: Some(core_model::FontSize::from_half_points(20)),
                ..Default::default()
            },
            is_default: false,
            table: None,
            ..Style::new("", "", StyleKind::Paragraph)
        });
        self.ensure_style(Style {
            id: "CommentReference".into(),
            name: "annotation reference".into(),
            kind: StyleKind::Character,
            based_on: None,
            next: None,
            paragraph: ParagraphProperties::default(),
            run: RunProperties {
                size: Some(core_model::FontSize::from_half_points(16)),
                ..Default::default()
            },
            is_default: false,
            table: None,
            ..Style::new("", "", StyleKind::Paragraph)
        });
    }

    /// Index of body paragraph `id` in document order (cells included).
    fn paragraph_order(&self, id: NodeId) -> R<usize> {
        if position(&self.doc, id).is_none() {
            self.para(id)?;
            return Err(invalid("comments can only be added to the body"));
        }
        self.doc
            .paragraphs()
            .position(|p| p.id == id)
            .ok_or_else(|| invalid(format!("block {} is not a paragraph", id.0)))
    }

    #[allow(clippy::too_many_arguments)]
    fn add_comment(
        &mut self,
        start: CommentPoint,
        end: CommentPoint,
        text: &str,
        author: &Option<String>,
        initials: &Option<String>,
        date: &Option<String>,
        ch: &mut Changes,
    ) -> R<C> {
        let (s, _) = self.range(start.block, start.offset, start.offset)?;
        let (e, _) = self.range(end.block, end.offset, end.offset)?;
        let (os, oe) = (
            self.paragraph_order(start.block)?,
            self.paragraph_order(end.block)?,
        );
        if (os, s) > (oe, e) {
            return Err(invalid("the comment's start is after its end"));
        }
        let old_comments = self.doc.comments.clone();
        let old_styles = self.doc.styles.clone();
        self.ensure_comment_styles();
        let blocks: Vec<NodeId> = if start.block == end.block {
            vec![start.block]
        } else {
            vec![start.block, end.block]
        };
        let old: Vec<(NodeId, Vec<Inline>)> = blocks
            .iter()
            .map(|&b| Ok((b, self.para(b)?.inlines.clone())))
            .collect::<R<_>>()?;
        let comment = self.new_comment(text, author, initials, date);
        let id = comment.id;
        replace_range(
            self.para_mut(end.block)?,
            e,
            e,
            vec![Inline::CommentEnd { id }],
        );
        replace_range(
            self.para_mut(start.block)?,
            s,
            s,
            vec![Inline::CommentStart { id }],
        );
        self.doc.comments.push(comment);
        ch.comments = true;
        let mut inverse = Vec::new();
        for (b, inlines) in old {
            ch.block(b);
            let len = self.para(b)?.len();
            inverse.push(C::RestoreInlines {
                block: b,
                from: 0,
                to: to_u32(len),
                inlines,
            });
        }
        inverse.push(C::RestoreComments {
            comments: old_comments,
        });
        Ok(self.with_styles(C::Compound { commands: inverse }, old_styles, ch))
    }

    /// Deletes the threads `roots` and their range markers.
    fn delete_threads(&mut self, roots: &[CommentId], ch: &mut Changes) -> R<C> {
        let old = self.doc.comments.clone();
        let doomed: HashSet<CommentId> = roots.iter().copied().collect();
        let is_doomed = |i: &Inline| marker_of(i).is_some_and(|(id, _)| doomed.contains(&id));
        let mut with_marks: Vec<NodeId> = Vec::new();
        for c in self.doc.containers() {
            for p in model_text::document::paragraphs_in(c) {
                if p.inlines.iter().any(is_doomed) {
                    with_marks.push(p.id);
                }
            }
        }
        let mut inverse = Vec::new();
        for pid in with_marks {
            let p = self.para_mut(pid)?;
            let before = p.inlines.clone();
            p.inlines.retain(|i| !is_doomed(i));
            let len = p.len();
            ch.block(pid);
            inverse.push(C::RestoreInlines {
                block: pid,
                from: 0,
                to: to_u32(len),
                inlines: before,
            });
        }
        self.doc
            .comments
            .retain(|c| !doomed.contains(&c.parent.unwrap_or(c.id)));
        ch.comments = true;
        inverse.push(C::RestoreComments { comments: old });
        Ok(C::Compound { commands: inverse })
    }

    /// Restores the comment invariants after a command
    /// ([`Document::fix_comments`]); returns the inverse of the fix.
    fn fix_comments(&mut self, ch: &mut Changes) -> Option<C> {
        let fix = self.doc.fix_comments();
        let bookmarks = self.doc.fix_bookmarks();
        if fix.is_empty() && bookmarks.is_empty() {
            return None;
        }
        let mut cmds = Vec::new();
        // Restored last-fixed first (the inverse runs in reverse order).
        let mut paragraphs = fix.paragraphs;
        for (pid, old) in bookmarks {
            if !paragraphs.iter().any(|(p, _)| *p == pid) {
                paragraphs.push((pid, old));
            }
        }
        for (pid, old) in paragraphs {
            let len = self.doc.find_paragraph(pid).map_or(0, Paragraph::len);
            ch.block(pid);
            cmds.push(C::RestoreInlines {
                block: pid,
                from: 0,
                to: to_u32(len),
                inlines: old,
            });
        }
        if let Some(old) = fix.comments {
            ch.comments = true;
            cmds.push(C::RestoreComments { comments: old });
        }
        Some(C::Compound { commands: cmds })
    }

    /// Makes sure `alloc_id` never returns an id used anywhere (after
    /// whole notes or sections were put back).
    fn reserve_all(&mut self) {
        let ids: Vec<NodeId> = all_ids(&self.doc).into_iter().collect();
        for id in ids {
            self.doc.reserve_id(id);
        }
    }

    /// `RestoreSections` with the current sections and page setup.
    fn sections_state(&self) -> C {
        C::RestoreSections {
            sections: self.doc.sections.clone(),
            page: self.doc.page.clone(),
        }
    }

    /// The index of section `id`.
    fn section_index(&self, id: SectionId) -> R<usize> {
        self.doc
            .sections
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| invalid(format!("unknown section {}", id.0)))
    }

    /// `inverse`, plus restoring `old` styles if the command changed them.
    fn with_styles(&self, inverse: C, old: model_text::StyleSheet, ch: &mut Changes) -> C {
        if self.doc.styles == old {
            return inverse;
        }
        ch.styles = true;
        C::Compound {
            commands: vec![inverse, C::RestoreStyles { styles: old }],
        }
    }

    /// Adds a style unless one with its id exists.
    fn ensure_style(&mut self, style: Style) {
        if self.doc.styles.get(&style.id).is_none() {
            self.doc.styles.insert(style);
        }
    }

    /// Word's `TOC Heading` and `TOC 1…to` styles, when missing.
    fn ensure_toc_styles(&mut self, to: u8) {
        let normal = self.default_style().unwrap_or_else(|| "Normal".to_owned());
        let based = self.doc.styles.get(&normal).map(|_| normal.clone());
        // TOC Heading looks like Heading 1 (Word bases it on Heading 1 with
        // outline level "body text"; here it copies its formatting).
        let (paragraph, run) = match self.doc.styles.get("Heading1") {
            Some(_) => {
                let mut p = self.doc.styles.resolve_paragraph("Heading1");
                p.style = None;
                p.numbering = None;
                (p, self.doc.styles.resolve_run("Heading1"))
            }
            None => (ParagraphProperties::default(), RunProperties::default()),
        };
        self.ensure_style(Style {
            id: "TOCHeading".into(),
            name: "TOC Heading".into(),
            kind: StyleKind::Paragraph,
            based_on: based.clone(),
            next: based.clone(),
            paragraph,
            run,
            is_default: false,
            table: None,
            ..Style::new("", "", StyleKind::Paragraph)
        });
        for level in 1..=to {
            self.ensure_style(Style {
                id: format!("TOC{level}"),
                name: format!("toc {level}"),
                kind: StyleKind::Paragraph,
                based_on: based.clone(),
                next: based.clone(),
                paragraph: ParagraphProperties {
                    spacing: Some(Spacing {
                        after: Some(Twips(100)),
                        ..Default::default()
                    }),
                    indent: (level > 1).then(|| Indent {
                        left: Some(Twips(220 * (i32::from(level) - 1))),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                run: RunProperties::default(),
                is_default: false,
                table: None,
                ..Style::new("", "", StyleKind::Paragraph)
            });
        }
    }

    /// Word's footnote/endnote text and reference styles, when missing.
    /// Returns the text style id.
    fn ensure_note_styles(&mut self, kind: NoteKind) -> String {
        let (text, text_name, reference, reference_name) = match kind {
            NoteKind::Foot => (
                "FootnoteText",
                "footnote text",
                "FootnoteReference",
                "footnote reference",
            ),
            NoteKind::End => (
                "EndnoteText",
                "endnote text",
                "EndnoteReference",
                "endnote reference",
            ),
        };
        let normal = self.default_style();
        self.ensure_style(Style {
            id: text.into(),
            name: text_name.into(),
            kind: StyleKind::Paragraph,
            based_on: normal.clone(),
            next: None,
            paragraph: ParagraphProperties {
                spacing: Some(Spacing {
                    after: Some(Twips(0)),
                    line: Some(LineSpacing::Multiple(1.0)),
                    ..Default::default()
                }),
                ..Default::default()
            },
            run: RunProperties {
                size: Some(core_model::FontSize::from_half_points(20)),
                ..Default::default()
            },
            is_default: false,
            table: None,
            ..Style::new("", "", StyleKind::Paragraph)
        });
        self.ensure_style(Style {
            id: reference.into(),
            name: reference_name.into(),
            kind: StyleKind::Character,
            based_on: None,
            next: None,
            paragraph: ParagraphProperties::default(),
            run: RunProperties {
                vertical_align: Some(core_model::VerticalAlign::Superscript),
                ..Default::default()
            },
            is_default: false,
            table: None,
            ..Style::new("", "", StyleKind::Paragraph)
        });
        text.to_owned()
    }

    fn insert_footnote(
        &mut self,
        block: NodeId,
        offset: u32,
        text: &str,
        kind: NoteKind,
        ch: &mut Changes,
    ) -> R<C> {
        if text.contains(['\n', '\r']) {
            return Err(invalid("note text must not contain line feeds"));
        }
        let (at, _) = self.range(block, offset, offset)?;
        if position(&self.doc, block).is_none() {
            return Err(invalid("notes can only be referenced from the body"));
        }
        let old_notes = self.doc.notes.clone();
        let old_styles = self.doc.styles.clone();
        let style = self.ensure_note_styles(kind);
        let id = self.doc.next_note_id();
        let mut p = Paragraph::with_text(self.doc.alloc_id(), &format!(" {text}"));
        p.props.style = Some(style);
        self.doc.notes.push(Note {
            id,
            kind,
            blocks: vec![Block::Paragraph(p)],
        });
        let mark = Inline::NoteRef(NoteRef {
            id,
            kind,
            props: RunProperties::default(),
        });
        replace_range(self.para_mut(block)?, at, at, vec![mark]);
        ch.block(block);
        ch.notes = true;
        let inverse = C::Compound {
            commands: vec![
                C::DeleteText {
                    block,
                    from: offset,
                    to: offset + 1,
                },
                C::RestoreNotes { notes: old_notes },
            ],
        };
        Ok(self.with_styles(inverse, old_styles, ch))
    }

    fn delete_footnote(&mut self, id: u32, ch: &mut Changes) -> R<C> {
        if self.doc.note(id).is_none() {
            return Err(invalid(format!("unknown note {id}")));
        }
        let old_notes = self.doc.notes.clone();
        let is_ref = |i: &Inline| matches!(i, Inline::NoteRef(r) if r.id == id);
        let with_refs: Vec<NodeId> = self
            .doc
            .paragraphs()
            .filter(|p| p.inlines.iter().any(is_ref))
            .map(|p| p.id)
            .collect();
        let mut inverse = Vec::new();
        for pid in with_refs {
            let p = self.para_mut(pid)?;
            let old = p.inlines.clone();
            p.inlines.retain(|i| !is_ref(i));
            let len = p.len();
            ch.block(pid);
            inverse.push(C::RestoreInlines {
                block: pid,
                from: 0,
                to: to_u32(len),
                inlines: old,
            });
        }
        self.doc.notes.retain(|n| n.id != id);
        ch.notes = true;
        inverse.push(C::RestoreNotes { notes: old_notes });
        Ok(C::Compound { commands: inverse })
    }

    /// Body paragraphs from `block` on (document order) whose list is
    /// `num_id`.
    fn list_tail(&self, block: NodeId, num_id: u32) -> Vec<(NodeId, u8)> {
        self.doc
            .paragraphs()
            .skip_while(|p| p.id != block)
            .filter_map(|p| {
                let n = self.doc.numbering_of(p)?;
                (n.num_id == num_id).then_some((p.id, n.level))
            })
            .collect()
    }

    /// Moves `items` (paragraph, level) to list `num_id`; the inverse
    /// restores their properties and `old_numbering`.
    fn relist(
        &mut self,
        items: &[(NodeId, u8)],
        num_id: u32,
        old_numbering: model_text::Numbering,
        ch: &mut Changes,
    ) -> R<C> {
        let levels: HashMap<NodeId, u8> = items.iter().copied().collect();
        let ids: Vec<NodeId> = items.iter().map(|(id, _)| *id).collect();
        let restore = self.edit_paragraph_props(&ids, ch, |id, props| {
            props.numbering = Some(NumberingRef {
                num_id,
                level: levels[&id],
            });
        })?;
        if self.doc.numbering == old_numbering {
            return Ok(restore);
        }
        ch.numbering = true;
        Ok(C::Compound {
            commands: vec![
                restore,
                C::RestoreNumbering {
                    numbering: old_numbering,
                },
            ],
        })
    }

    fn restart_list(&mut self, block: NodeId, start: Option<u32>, ch: &mut Changes) -> R<C> {
        let p = self.para(block)?;
        let n = self
            .doc
            .numbering_of(p)
            .ok_or_else(|| invalid(format!("block {} is not numbered", block.0)))?;
        let level = self
            .doc
            .numbering
            .level(n)
            .ok_or_else(|| invalid(format!("list {} has no level {}", n.num_id, n.level)))?;
        let start = start.unwrap_or(level.start);
        let old = self.doc.numbering.clone();
        let items = self.list_tail(block, n.num_id);
        let abstract_id = self
            .doc
            .numbering
            .ensure_abstract(n.num_id)
            .ok_or(WriteError::UnknownBlock(block.0))?;
        let id = self.doc.numbering.next_id();
        self.doc.numbering.insert(NumberingDef {
            id,
            abstract_id: Some(abstract_id),
            overrides: vec![LevelOverride {
                level: n.level,
                start: Some(start),
                definition: None,
            }],
            levels: Vec::new(),
        });
        self.doc.numbering.resolve();
        self.relist(&items, id, old, ch)
    }

    fn continue_list(&mut self, block: NodeId, ch: &mut Changes) -> R<C> {
        let p = self.para(block)?;
        let n = self
            .doc
            .numbering_of(p)
            .ok_or_else(|| invalid(format!("block {} is not numbered", block.0)))?;
        let numbering = &self.doc.numbering;
        let def = numbering.get(n.num_id);
        let bullet = |id: u32| {
            numbering
                .get(id)
                .and_then(|d| d.levels.first())
                .is_some_and(|l| l.kind == LevelKind::Bullet)
        };
        let same_kind = |m: u32| {
            let shared = def.and_then(|d| d.abstract_id).is_some()
                && numbering.get(m).and_then(|d| d.abstract_id) == def.and_then(|d| d.abstract_id);
            shared || bullet(m) == bullet(n.num_id)
        };
        let previous: Vec<u32> = self
            .doc
            .paragraphs()
            .take_while(|q| q.id != block)
            .filter_map(|q| self.doc.numbering_of(q).map(|r| r.num_id))
            .collect();
        let target = previous
            .into_iter()
            .rev()
            .find(|&m| m != n.num_id && same_kind(m))
            .ok_or_else(|| invalid("no previous list to continue"))?;
        let old = self.doc.numbering.clone();
        let items = self.list_tail(block, n.num_id);
        self.relist(&items, target, old, ch)
    }

    fn insert_section_break(
        &mut self,
        block: NodeId,
        kind: model_text::SectionKind,
        ch: &mut Changes,
    ) -> R<C> {
        let pos = self.pos(block)?;
        let p = self.para(block)?;
        if pos.parent.is_some() {
            return Err(invalid("a section break must be in a top-level paragraph"));
        }
        if p.props
            .section_end
            .is_some_and(|id| self.doc.sections.iter().any(|s| s.id == id))
        {
            return Err(invalid(format!("block {} already ends a section", block.0)));
        }
        let old_props = p.props.clone();
        let restore_sections = self.sections_state();
        let index = self
            .doc
            .section_index_of(block)
            .ok_or(WriteError::UnknownBlock(block.0))?;
        let id = self.doc.next_section_id();
        let after = &mut self.doc.sections[index];
        let mut before: Section = after.clone();
        before.id = id;
        // The part after the break starts `kind`, continues the page
        // numbers and links to the headers (moved to the part before).
        after.kind = kind;
        after.page_number_start = None;
        after.headers = Default::default();
        after.footers = Default::default();
        self.doc.sections.insert(index, before);
        self.para_mut(block)?.props.section_end = Some(id);
        ch.block(block);
        ch.sections = true;
        Ok(C::Compound {
            commands: vec![
                C::RestoreParagraphProps {
                    items: vec![(block, old_props)],
                },
                restore_sections,
            ],
        })
    }

    fn remove_section_break(&mut self, section: SectionId, ch: &mut Changes) -> R<C> {
        let i = self.section_index(section)?;
        if i + 1 == self.doc.sections.len() {
            return Err(invalid("the last section has no break"));
        }
        let marker = self
            .doc
            .body
            .iter()
            .filter_map(Block::as_paragraph)
            .find(|p| p.props.section_end == Some(section))
            .map(|p| (p.id, p.props.clone()));
        let restore_sections = self.sections_state();
        let removed = self.doc.sections.remove(i);
        let next = &mut self.doc.sections[i];
        for footer in [false, true] {
            for (slot, blocks) in removed.header_footer(footer).slots() {
                let target = next.header_footer_mut(footer).get_mut(slot);
                if target.is_none() {
                    *target = Some(blocks.clone());
                }
            }
        }
        let mut commands = vec![restore_sections];
        if let Some((pid, props)) = marker {
            self.para_mut(pid)?.props.section_end = None;
            ch.block(pid);
            commands.insert(
                0,
                C::RestoreParagraphProps {
                    items: vec![(pid, props)],
                },
            );
        }
        ch.sections = true;
        Ok(C::Compound { commands })
    }

    /// Applies a page setup patch to `page`; errors if no room for text
    /// remains.
    fn patch_page(page: &mut PageSetup, patch: &PageSetupPatch) -> R<()> {
        if let Some(o) = patch.orientation {
            *page = page.clone().with_orientation(o);
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
        let m = page.margins;
        if page.width.0 <= 0
            || page.height.0 <= 0
            || page.content_width().0 <= 0
            || page.height.0 - m.top.0 - m.bottom.0 <= 0
        {
            return Err(invalid("page setup leaves no room for text"));
        }
        Ok(())
    }

    fn set_page(&mut self, patch: &PageSetupPatch, ch: &mut Changes) -> R<C> {
        if [&patch.header_text, &patch.footer_text]
            .iter()
            .any(|t| t.as_deref().is_some_and(|t| t.contains('\r')))
        {
            return Err(invalid("header/footer text must not contain \\r"));
        }
        let restore = self.sections_state();
        let mut page = self.doc.page.clone();
        Self::patch_page(&mut page, patch)?;
        self.doc.page = page;
        if let Some(t) = &patch.header_text {
            self.doc.set_header_text(false, Some(t));
        }
        if let Some(t) = &patch.footer_text {
            self.doc.set_header_text(true, Some(t));
        }
        self.doc.sync_sections();
        ch.page = true;
        ch.sections = true;
        Ok(restore)
    }

    fn set_section(&mut self, section: SectionId, patch: &SectionPatch, ch: &mut Changes) -> R<C> {
        let i = self.section_index(section)?;
        let restore = self.sections_state();
        let last = i + 1 == self.doc.sections.len();
        let mut page = if last {
            self.doc.page.clone()
        } else {
            self.doc.sections[i].page.clone()
        };
        if let Some(p) = &patch.page {
            Self::patch_page(&mut page, p)?;
        }
        if let Some(c) = &patch.columns {
            if c.count == 0 || c.count > 45 {
                return Err(invalid("columns must be 1..=45"));
            }
            if !c.equal && c.widths.len() != usize::from(c.count) {
                return Err(invalid("unequal columns need one width per column"));
            }
        }
        let s = &mut self.doc.sections[i];
        s.kind = patch.kind.unwrap_or(s.kind);
        if let Some(c) = &patch.columns {
            s.columns = c.clone();
        }
        s.title_page = patch.title_page.unwrap_or(s.title_page);
        match patch.page_number_start {
            Some(0) => s.page_number_start = None,
            Some(n) => s.page_number_start = Some(n),
            None => {}
        }
        if patch.page_number_format.is_some() {
            s.page_number_format = patch.page_number_format;
        }
        if last {
            self.doc.page = page;
            ch.page = true;
        } else {
            self.doc.sections[i].page = page;
        }
        self.doc.sync_sections();
        ch.sections = true;
        Ok(restore)
    }

    /// Replaces `from..to` of paragraph `block` by `inlines`; the inverse
    /// restores the removed inlines. With `keep`, comment markers whose
    /// partner is outside the range stay (see [`replace_keeping_markers`]).
    fn restore_inlines(
        &mut self,
        block: NodeId,
        from: u32,
        to: u32,
        inlines: Vec<Inline>,
        keep: bool,
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
        let (removed, kept) = if keep {
            replace_keeping_markers(self.para_mut(block)?, f, t, inlines)
        } else {
            (replace_range(self.para_mut(block)?, f, t, inlines), 0)
        };
        ch.block(block);
        Ok(C::RestoreInlines {
            block,
            from,
            to: to_u32(f + n + kept),
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
            list_label: None,
        };
        // A section break stays at the end: with the second half.
        self.para_mut(block)?.props.section_end = None;
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
            space: None,
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
                        grid_span: 1,
                        v_merge: None,
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
        self.restore_inlines(block, offset, offset + 1, found, false, ch)
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

    fn set_table_props(
        &mut self,
        table: NodeId,
        patch: &TableProperties,
        ch: &mut Changes,
    ) -> R<C> {
        self.table_mut(table)?;
        let old_styles = self.doc.styles.clone();
        if let Some(id) = patch.style.as_deref().filter(|s| !s.is_empty()) {
            match self.doc.styles.get(id) {
                Some(s) if s.kind == StyleKind::Table => {}
                Some(_) => return Err(WriteError::UnknownStyle(id.to_owned())),
                None => self.ensure_table_style(id)?,
            }
        }
        let t = self.table_mut(table)?;
        let old = t.clone();
        let props = &mut t.props;
        props.width = patch.width.or(props.width);
        if !patch.col_widths.is_empty() {
            props.col_widths.clone_from(&patch.col_widths);
            // The grid decides; fixed cell widths would contradict it.
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                if matches!(cell.props.width, Some(model_text::TableWidth::Twips(_))) {
                    cell.props.width = None;
                }
            }
        }
        let props = &mut t.props;
        props.borders = merge_borders(props.borders, patch.borders);
        props.cell_margins = match (props.cell_margins, patch.cell_margins) {
            (Some(a), Some(b)) => Some(a.merged_with(&b)),
            (a, b) => b.or(a),
        };
        if let Some(s) = &patch.style {
            props.style = (!s.is_empty()).then(|| s.clone());
        }
        props.look = patch.look.or(props.look);
        props.alignment = patch.alignment.or(props.alignment);
        props.indent = patch.indent.or(props.indent);
        props.layout = patch.layout.or(props.layout);
        ch.block(table);
        let inverse = if old.rows == t.rows {
            C::RestoreTableProps {
                table,
                props: old.props,
            }
        } else {
            C::ReplaceBlocks {
                ids: vec![table],
                blocks: vec![NewBlock::Table(NewTable::from(&old))],
            }
        };
        Ok(self.with_styles(inverse, old_styles, ch))
    }

    /// Adds the built-in table style `id` (and its `based_on` parents)
    /// from Word's defaults.
    fn ensure_table_style(&mut self, id: &str) -> R<()> {
        let defaults = model_text::StyleSheet::office_defaults();
        let mut next = Some(id.to_owned());
        let mut found = false;
        while let Some(sid) = next.take() {
            if self.doc.styles.get(&sid).is_some() {
                break;
            }
            let Some(s) = defaults.get(&sid).filter(|s| s.kind == StyleKind::Table) else {
                break;
            };
            found = true;
            let mut s = s.clone();
            // Only the first table style of the document is its default.
            s.is_default &= self.doc.styles.default_style(StyleKind::Table).is_none();
            next = s.based_on.clone();
            self.ensure_style(s);
        }
        if found {
            Ok(())
        } else {
            Err(WriteError::UnknownStyle(id.to_owned()))
        }
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
        let model_row = at.saturating_sub(1).min(t.rows.len() - 1);
        for (k, m) in model.cells.iter().enumerate() {
            let id = ids.resolve(&mut self.doc, ch, layout[1 + k])?;
            let pid = ids.resolve(&mut self.doc, ch, layout[1 + n + k])?;
            // Inside a vertically merged region the new cell extends it.
            let col = t.grid_start(model_row, k).unwrap_or(0);
            let inside = at < t.rows.len()
                && at > 0
                && t.cell_at(at, col)
                    .is_some_and(|i| t.rows[at].cells[i].v_merge == Some(VMerge::Continue));
            cells.push(TableCell {
                id,
                props: m.props,
                grid_span: m.grid_span,
                v_merge: inside.then_some(VMerge::Continue),
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
            t.normalize_merges();
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
            new_cells.push(TableCell::new(
                id,
                model.props,
                vec![Block::Paragraph(Paragraph::new(pid))],
            ));
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

    /// The matches of `q` in the body paragraphs (table cells included),
    /// in document order, as `(paragraph, [(from, to)])`.
    pub(crate) fn find_hits(&self, q: &FindQuery) -> R<Vec<Hits>> {
        let format = q.format.as_ref().filter(|f| !f.is_empty());
        if q.text.is_empty() && format.is_none() {
            return Err(invalid("nothing to find"));
        }
        let wildcard = if q.wildcards && !q.text.is_empty() {
            Some(Wildcard::compile(&q.text).map_err(|e| invalid(format!("wildcards: {}", e.0)))?)
        } else {
            None
        };
        let pattern: Vec<char> = q.text.chars().collect();
        let mut hits = Vec::new();
        for p in self.doc.paragraphs() {
            let full: Vec<char> = p.text().chars().collect();
            let ok_full = match format {
                Some(f) => self.format_mask(p, f, full.len()),
                None => vec![true; full.len()],
            };
            let is_text_full: Vec<bool> = p
                .inlines
                .iter()
                .flat_map(|i| std::iter::repeat(matches!(i, Inline::Run(_))).take(inline_len(i)))
                .collect();
            // Comment markers are invisible: matched across, never part of
            // a match's text.
            let marks = p.inlines.iter().any(Inline::is_marker);
            let idx: Vec<usize> = if marks {
                p.inlines
                    .iter()
                    .flat_map(|i| std::iter::repeat(!i.is_marker()).take(inline_len(i)))
                    .enumerate()
                    .filter_map(|(k, visible)| visible.then_some(k))
                    .collect()
            } else {
                (0..full.len()).collect()
            };
            let text: Vec<char> = idx.iter().map(|&k| full[k]).collect();
            let ok: Vec<bool> = idx.iter().map(|&k| ok_full[k]).collect();
            let is_text: Vec<bool> = idx.iter().map(|&k| is_text_full[k]).collect();
            let accept = |s: usize, e: usize| ok[s..e].iter().all(|&b| b);
            let m = if let Some(w) = &wildcard {
                w.find(&text, accept)
            } else if pattern.is_empty() {
                // Formatting only: the stretches of text (no images) that have it.
                stretches(text.len(), |i| ok[i] && is_text[i])
            } else {
                find_matches_where(&text, &pattern, q.match_case, q.whole_word, accept)
            };
            let m: Vec<(usize, usize)> = if marks {
                m.into_iter()
                    .map(|(s, e)| {
                        let start = idx.get(s).copied().unwrap_or(full.len());
                        let end = if e > s { idx[e - 1] + 1 } else { start };
                        (start, end)
                    })
                    .collect()
            } else {
                m
            };
            if !m.is_empty() {
                hits.push((p.id, m));
            }
        }
        Ok(hits)
    }

    /// The matches of `q` (the `find` request).
    pub fn find(&self, q: &FindQuery) -> Result<Vec<FindMatch>, WriteError> {
        Ok(self
            .find_hits(q)?
            .into_iter()
            .flat_map(|(block, m)| {
                m.into_iter().map(move |(f, t)| FindMatch {
                    block,
                    from: to_u32(f),
                    to: to_u32(t),
                })
            })
            .collect())
    }

    /// Per char position of `p`: whether it has the formatting `f`.
    fn format_mask(&self, p: &Paragraph, f: &FindFormat, len: usize) -> Vec<bool> {
        let pp = self.doc.resolve_paragraph_props(p);
        let para_ok = f.paragraph.as_ref().map_or(true, |want| {
            (want.alignment.is_none() || want.alignment == pp.alignment)
                && want.indent.map_or(true, |w| {
                    let have = pp.indent.unwrap_or_default();
                    (w.left.is_none() || w.left == have.left)
                        && (w.right.is_none() || w.right == have.right)
                        && (w.first_line.is_none() || w.first_line == have.first_line)
                        && (w.hanging.is_none() || w.hanging == have.hanging)
                })
                && want.spacing.map_or(true, |w| {
                    let have = pp.spacing.unwrap_or_default();
                    (w.before.is_none() || w.before == have.before)
                        && (w.after.is_none() || w.after == have.after)
                        && (w.line.is_none() || w.line == have.line)
                })
                && (want.keep_next.is_none()
                    || want.keep_next.unwrap_or(false) == pp.keep_next.unwrap_or(false))
                && (want.page_break_before.is_none()
                    || want.page_break_before.unwrap_or(false)
                        == pp.page_break_before.unwrap_or(false))
        });
        let style = f.style.as_deref().filter(|s| !s.is_empty());
        let style_kind = style.and_then(|s| self.doc.styles.get(s)).map(|s| s.kind);
        // A paragraph style constrains the paragraph; a character style the runs.
        let para_style_ok = match (style, style_kind) {
            (Some(s), Some(StyleKind::Paragraph)) => pp.style.as_deref() == Some(s),
            (Some(s), Some(StyleKind::Linked)) => pp.style.as_deref() == Some(s),
            (Some(_), None) => false,
            _ => true,
        };
        if !para_ok || !para_style_ok {
            return vec![false; len];
        }
        let char_style: Option<Vec<&str>> = match (style, style_kind) {
            (Some(s), Some(StyleKind::Character)) => Some(vec![s]),
            _ => None,
        };
        let mut out = Vec::with_capacity(len);
        for inline in &p.inlines {
            let n = inline_len(inline);
            let good = match inline {
                Inline::Run(r) => {
                    let props = self.doc.resolve_run_props(p, r);
                    run_matches(&props, f)
                        && char_style.as_ref().map_or(true, |ids| {
                            r.style.as_deref().is_some_and(|s| ids.contains(&s))
                        })
                }
                // Atoms only pass when no character constraint applies.
                _ => {
                    f.run.as_ref().map_or(true, RunProperties::is_empty)
                        && f.highlight.is_none()
                        && char_style.is_none()
                }
            };
            out.extend(std::iter::repeat(good).take(n));
        }
        out.resize(len, false);
        out
    }

    fn find_replace(
        &mut self,
        q: &FindQuery,
        replace: &str,
        replace_format: Option<&FindFormat>,
        all: bool,
        ch: &mut Changes,
    ) -> R<C> {
        if replace.contains(['\n', '\r']) {
            return Err(invalid("replacement must not contain line feeds"));
        }
        let rf = replace_format.filter(|f| !f.is_empty());
        if let Some(id) = rf
            .and_then(|f| f.style.as_deref())
            .filter(|s| !s.is_empty())
        {
            if self.doc.styles.get(id).is_none() {
                return Err(WriteError::UnknownStyle(id.to_owned()));
            }
        }
        let mut hits = self.find_hits(q)?;
        if !all {
            hits.truncate(1);
            if let Some((_, m)) = hits.first_mut() {
                m.truncate(1);
            }
        }
        let count: usize = hits.iter().map(|(_, m)| m.len()).sum();
        // Formatting only: keep the matched text.
        let keep_text = replace.is_empty() && rf.is_some();
        let mut inverse = Vec::with_capacity(hits.len());
        for (id, matches) in hits {
            let p = self.para(id)?;
            let (old, old_props) = (p.inlines.clone(), p.props.clone());
            let mut para_style = None;
            for &(s, e) in matches.iter().rev() {
                let p = self.para_mut(id)?;
                let (start, end) = if keep_text {
                    (s, e)
                } else {
                    let mut run = run_format_at(p, s);
                    let new = if replace.is_empty() {
                        Vec::new()
                    } else {
                        run.text = replace.to_owned();
                        vec![Inline::Run(run)]
                    };
                    let (_, kept) = replace_keeping_markers(p, s, e, new);
                    // Kept ends come first: the new text starts after them.
                    let lead = kept_ends_before(p, s, kept);
                    (s + lead, s + lead + replace.chars().count())
                };
                if let Some(f) = rf {
                    para_style = self.apply_format(id, start, end, f)?.or(para_style);
                }
            }
            if let Some(f) = rf.and_then(|f| f.paragraph.as_ref()) {
                let p = self.para_mut(id)?;
                let mut patch = f.clone();
                patch.style = None;
                patch.numbering = None;
                patch.section_end = None;
                p.props.apply(&patch);
            }
            if let Some(style) = para_style {
                self.para_mut(id)?.props.style = style;
            }
            let p = self.para(id)?;
            let len = p.len();
            let props_changed = p.props != old_props;
            ch.block(id);
            inverse.push(C::RestoreInlines {
                block: id,
                from: 0,
                to: to_u32(len),
                inlines: old,
            });
            if props_changed {
                inverse.push(C::RestoreParagraphProps {
                    items: vec![(id, old_props)],
                });
            }
        }
        inverse.reverse();
        ch.info = Some(match count {
            1 => "1 replacement".to_owned(),
            n => format!("{n} replacements"),
        });
        Ok(C::Compound { commands: inverse })
    }

    /// Applies a replacement format to `from..to` of paragraph `id`: run
    /// properties and highlight merge into the runs, a character style is
    /// set on them. Returns the paragraph style to set (`Some(None)` = the
    /// default), if the format names a paragraph style.
    fn apply_format(
        &mut self,
        id: NodeId,
        from: usize,
        to: usize,
        f: &FindFormat,
    ) -> R<Option<Option<String>>> {
        let style = f.style.as_deref().filter(|s| !s.is_empty());
        let kind = style.and_then(|s| self.doc.styles.get(s)).map(|s| s.kind);
        let default = self.default_style();
        let char_style = match (style, kind) {
            (Some(s), Some(StyleKind::Character)) => Some(s.to_owned()),
            _ => None,
        };
        let mut patch = f.run.clone().unwrap_or_default();
        match f.highlight {
            Some(true) if patch.highlight.is_none() => {
                patch.highlight = Some(Color::Rgb(core_model::Rgb::new(0xFF, 0xFF, 0)));
            }
            Some(false) => patch.highlight = Some(Color::Auto),
            _ => {}
        }
        for_each_run_mut_in(self.para_mut(id)?, from, to, |r| {
            r.props.apply(&patch);
            if r.props.highlight == Some(Color::Auto) {
                r.props.highlight = None;
            }
            if char_style.is_some() {
                r.style.clone_from(&char_style);
            }
        });
        Ok(match (style, kind) {
            (Some(s), Some(k)) if k.is_paragraph() => {
                Some((default.as_deref() != Some(s)).then(|| s.to_owned()))
            }
            _ => None,
        })
    }

    // ----- styles --------------------------------------------------------

    /// Reports every paragraph that uses `id` or a style based on it.
    fn report_style_users(&self, id: &str, ch: &mut Changes) {
        for s in &self.doc.styles.styles {
            if self.doc.styles.ancestors(&s.id).iter().any(|a| a == id) {
                for b in self.doc.blocks_with_style(&s.id) {
                    ch.block(b);
                }
            }
        }
    }

    /// `RestoreInlines` + `RestoreParagraphProps` for paragraph `id` as it
    /// is now (taken before changing it).
    fn paragraph_state(&self, id: NodeId) -> R<Vec<C>> {
        let p = self.para(id)?;
        Ok(vec![
            C::RestoreInlines {
                block: id,
                from: 0,
                to: to_u32(p.len()),
                inlines: p.inlines.clone(),
            },
            C::RestoreParagraphProps {
                items: vec![(id, p.props.clone())],
            },
        ])
    }

    fn delete_style(&mut self, id: &str, replacement: Option<&str>, ch: &mut Changes) -> R<C> {
        let old_styles = self.doc.styles.clone();
        let users = self.doc.blocks_with_style(id);
        let mut doc = self.doc.clone();
        let changed = doc.delete_style(id, replacement).map_err(style_err)?;
        // Inverses from the state before (paragraph text and props, tables).
        let mut inverse = Vec::new();
        for &b in &changed {
            match self.doc.find_block(b) {
                Some(Block::Paragraph(_)) => {
                    // The lengths do not change: restoring 0..len is exact.
                    inverse.extend(self.paragraph_state(b)?);
                }
                Some(Block::Table(t)) => inverse.push(C::RestoreTableProps {
                    table: b,
                    props: t.props.clone(),
                }),
                _ => {}
            }
        }
        self.doc = doc;
        for b in changed.iter().chain(&users) {
            ch.block(*b);
        }
        ch.styles = true;
        inverse.push(C::RestoreStyles { styles: old_styles });
        inverse.reverse();
        Ok(C::Compound { commands: inverse })
    }

    fn update_style_from_selection(
        &mut self,
        id: &str,
        block: NodeId,
        offset: u32,
        ch: &mut Changes,
    ) -> R<C> {
        let style = self
            .doc
            .styles
            .get(id)
            .ok_or_else(|| WriteError::UnknownStyle(id.to_owned()))?
            .clone();
        if !matches!(
            style.kind,
            StyleKind::Paragraph | StyleKind::Linked | StyleKind::Character
        ) {
            return Err(WriteError::UnknownStyle(id.to_owned()));
        }
        let (at, _) = self.range(block, offset, offset)?;
        let p = self.para(block)?.clone();
        let sample = {
            let r = if at >= p.len() {
                inherited_run(&p, at)
            } else {
                run_format_at(&p, at)
            };
            self.doc.resolve_run_props(&p, &r)
        };
        let old_styles = self.doc.styles.clone();
        let mut inverse = self.paragraph_state(block)?;
        inverse.push(C::RestoreStyles {
            styles: old_styles.clone(),
        });
        let mut patch = model_text::StylePatch::default();
        if style.kind == StyleKind::Character {
            // What the character style must add on top of the paragraph.
            let mut base = self.doc.resolve_run_props(&p, &Run::default());
            base.apply(&self.doc.styles.resolve_character(id));
            patch.run = Some(run_diff(&sample, &base));
        } else {
            let mut probe = p.clone();
            probe.props = ParagraphProperties {
                style: Some(id.to_owned()),
                numbering: p.props.numbering,
                ..Default::default()
            };
            let have = self.doc.resolve_paragraph_props(&p);
            let target = self.doc.resolve_paragraph_props(&probe);
            patch.paragraph = Some(para_diff(&have, &target));
            let base = self.doc.resolve_run_props(&probe, &Run::default());
            patch.run = Some(run_diff(&sample, &base));
        }
        self.doc.styles.update(id, &patch).map_err(style_err)?;
        ch.styles = true;
        // The paragraph takes the style; formatting now in the style goes.
        let default = self.default_style();
        let styles = self.doc.styles.clone();
        let doc = &self.doc;
        let mut np = p.clone();
        if style.kind != StyleKind::Character {
            np.props = ParagraphProperties {
                style: (default.as_deref() != Some(id)).then(|| id.to_owned()),
                numbering: p.props.numbering,
                section_end: p.props.section_end,
                ..Default::default()
            };
        }
        let mut probe = np.clone();
        for inline in &mut probe.inlines {
            if let Inline::Run(r) = inline {
                let char_style = if style.kind == StyleKind::Character {
                    // The sample run (and runs like it) take the character style.
                    let resolved = doc.resolve_run_props(&p, r);
                    (resolved == sample)
                        .then(|| id.to_owned())
                        .or(r.style.clone())
                } else {
                    r.style.clone()
                };
                let bare = Run::styled("", char_style.clone(), RunProperties::default());
                let base = resolve_with(&styles, &np, &bare);
                r.props = strip_same(&r.props, &base);
                r.style = char_style;
            }
        }
        let new_inlines = probe.inlines;
        let p = self.para_mut(block)?;
        p.props = np.props;
        p.inlines = new_inlines;
        ch.block(block);
        self.report_style_users(id, ch);
        inverse.reverse();
        Ok(C::Compound { commands: inverse })
    }

    // ----- patch ---------------------------------------------------------

    /// Recomputes the list labels; paragraphs whose label changed are
    /// reported as replaced.
    fn relabel(&mut self, ch: &mut Changes) {
        let new: HashMap<NodeId, String> = self.doc.list_numbers().into_iter().collect();
        for (id, label) in &new {
            if self.labels.get(id) != Some(label) {
                ch.block(*id);
            }
        }
        for id in self.labels.keys() {
            if !new.contains_key(id) && self.doc.find_paragraph(*id).is_some() {
                ch.block(*id);
            }
        }
        self.labels = new;
    }

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
        let (mut notes, mut sections) = (ch.notes, ch.sections);
        let mut with_paths: Vec<(NodeId, Vec<NodeId>)> = Vec::new();
        for id in candidates {
            match ancestors(&self.doc, id) {
                Some(a) => with_paths.push((id, a)),
                None if self.doc.note_of_block(id).is_some() => notes = true,
                None if self.doc.header_of_block(id).is_some() => sections = true,
                None => {}
            }
        }
        let replaced_set: HashSet<NodeId> = with_paths.iter().map(|(id, _)| *id).collect();
        with_paths.retain(|(_, path)| {
            !path
                .iter()
                .any(|a| replaced_set.contains(a) || inserted_set.contains(a))
        });

        let mut take = |id: NodeId| -> Option<Block> {
            let b = self.doc.find_block_mut(id)?;
            for_each_paragraph_mut(b, &mut Paragraph::normalize);
            let mut b = b.clone();
            for_each_paragraph_mut(&mut b, &mut |p| {
                p.list_label = self.labels.get(&p.id).cloned();
            });
            Some(b)
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
            sections: sections.then(|| self.doc.sections.clone()),
            notes: notes.then(|| self.doc.notes.clone()),
            comments: ch.comments.then(|| self.doc.comments.clone()),
            properties: ch.properties.then(|| self.doc.properties.clone()),
            settings: ch.settings.then_some(self.doc.settings),
            info: ch.info,
        }
    }
}

/// Whether `cmd` can change list labels (anything but text, run
/// formatting, images, fields and notes).
fn affects_labels(cmd: &WriteCommand) -> bool {
    match cmd {
        C::Compound { commands } => commands.iter().any(affects_labels),
        C::InsertText { .. }
        | C::DeleteText { .. }
        | C::ReplaceText { .. }
        | C::RestoreInlines { .. }
        | C::SetRunProps { .. }
        | C::InsertImage { .. }
        | C::SetImageSize { .. }
        | C::SetImageAlt { .. }
        | C::SetImageAnchor { .. }
        | C::SetImageWrap { .. }
        | C::RemoveMedia { .. }
        | C::RestoreMedia { .. }
        | C::FindReplace { .. }
        | C::InsertField { .. }
        | C::InsertFootnote { .. }
        | C::DeleteFootnote { .. }
        | C::ReplaceNote { .. }
        | C::RestoreNotes { .. }
        | C::SetPage { .. }
        | C::SetSection { .. }
        | C::SetHeaderFooter { .. }
        | C::RestoreSections { .. }
        | C::UpdateToc { .. }
        | C::UpdateFields { .. }
        | C::SetCellProps { .. }
        | C::RestoreCellProps { .. }
        | C::SetTableProps { .. }
        | C::RestoreTableProps { .. }
        | C::SetRowProps { .. }
        | C::ApplyCharacterStyle { .. }
        | C::RenameStyle { .. }
        | C::ReplyComment { .. }
        | C::EditComment { .. }
        | C::DeleteComment { .. }
        | C::DeleteAllComments { .. }
        | C::ResolveComment { .. }
        | C::ReopenComment { .. }
        | C::RestoreComments { .. }
        | C::SetHyperlink { .. }
        | C::RemoveHyperlink { .. }
        | C::AddBookmark { .. }
        | C::DeleteBookmark { .. }
        | C::InsertCrossReference { .. }
        | C::SetProperties { .. }
        | C::RestoreProperties { .. }
        | C::SetSettings { .. } => false,
        _ => true,
    }
}

/// Whether `cmd` can remove, move or add comment markers (what the
/// comment fix-up after a command must look at). Typing, formatting and
/// most structure commands cannot.
fn may_touch_markers(cmd: &WriteCommand) -> bool {
    match cmd {
        C::Compound { commands } => commands.iter().any(may_touch_markers),
        C::InsertText { .. }
        | C::SetRunProps { .. }
        | C::SplitParagraph { .. }
        | C::JoinWithPrevious { .. }
        | C::SetParagraphProps { .. }
        | C::RestoreParagraphProps { .. }
        | C::SetStyle { .. }
        | C::ApplyCharacterStyle { .. }
        | C::ApplyList { .. }
        | C::IndentList { .. }
        | C::InsertImage { .. }
        | C::SetImageSize { .. }
        | C::SetImageAlt { .. }
        | C::SetImageAnchor { .. }
        | C::SetImageWrap { .. }
        | C::InsertField { .. }
        | C::UpdateFields { .. }
        | C::UpdateToc { .. }
        | C::SetPage { .. }
        | C::SetCellProps { .. }
        | C::RestoreCellProps { .. }
        | C::SetTableProps { .. }
        | C::RestoreTableProps { .. }
        | C::SetRowProps { .. }
        | C::AddStyle { .. }
        | C::UpdateStyle { .. }
        | C::RenameStyle { .. }
        | C::SetDefaultStyle { .. }
        | C::RestoreStyles { .. }
        | C::RestoreNumbering { .. }
        | C::RemoveMedia { .. }
        | C::RestoreMedia { .. }
        | C::RemoveHyperlink { .. }
        | C::SetProperties { .. }
        | C::RestoreProperties { .. }
        | C::SetSettings { .. } => false,
        _ => true,
    }
}

/// Whether the inlines or blocks `cmd` carries contain comment markers
/// (they may introduce markers into a document without comments).
fn carries_markers(cmd: &WriteCommand) -> bool {
    fn in_blocks(blocks: &[NewBlock]) -> bool {
        blocks.iter().any(|b| match b {
            NewBlock::Paragraph(p) => p.inlines.iter().any(Inline::is_marker),
            NewBlock::Table(t) => t
                .rows
                .iter()
                .flat_map(|r| &r.cells)
                .any(|c| in_blocks(&c.blocks)),
            NewBlock::Toc(_) => false,
        })
    }
    match cmd {
        C::Compound { commands } => commands.iter().any(carries_markers),
        C::RestoreInlines { inlines, .. } => inlines.iter().any(Inline::is_marker),
        C::AddBookmark { .. } | C::InsertCrossReference { .. } | C::InsertCaption { .. } => true,
        C::InsertBlocks { blocks, .. }
        | C::ReplaceBlocks { blocks, .. }
        | C::ReplaceNote { blocks, .. } => in_blocks(blocks),
        C::SetHeaderFooter {
            blocks: Some(blocks),
            ..
        } => in_blocks(blocks),
        C::RestoreNotes { .. } | C::RestoreSections { .. } => true,
        _ => false,
    }
}

/// The number of comment ends among the first `kept` markers at `at` in
/// `p` (a replacement puts kept ends before the new text).
fn kept_ends_before(p: &Paragraph, at: usize, kept: usize) -> usize {
    if kept == 0 {
        return 0;
    }
    let mut pos = 0;
    let mut n = 0;
    for inline in &p.inlines {
        if pos >= at {
            match inline {
                Inline::CommentEnd { .. } | Inline::BookmarkEnd { .. } if n < kept => n += 1,
                _ => break,
            }
        }
        pos += inline_len(inline);
    }
    n
}

/// A bookmark added for a cross-reference: paragraph, start and end
/// offset (before the markers were inserted).
type NewMarks = (NodeId, usize, usize);

/// Removes the markers of bookmark `id` from `blocks` (cells included).
fn strip_bookmark(blocks: &mut [Block], id: BookmarkId) {
    for b in blocks {
        match b {
            Block::Paragraph(p) => p
                .inlines
                .retain(|i| model_text::bookmark_marker_of(i).map_or(true, |(b, _)| b != id)),
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    strip_bookmark(&mut cell.blocks, id);
                }
            }
            Block::Toc(_) => {}
        }
    }
}

/// Index in `p.inlines` of the field at char position `offset`.
fn field_index(p: &Paragraph, offset: u32) -> Option<usize> {
    let mut pos = 0usize;
    for (i, inline) in p.inlines.iter().enumerate() {
        let len = match inline {
            Inline::Run(r) => r.text.chars().count(),
            _ => 1,
        };
        if len == 0 {
            continue;
        }
        if pos == offset as usize {
            return matches!(inline, Inline::Field(_)).then_some(i);
        }
        if pos + len > offset as usize {
            return None;
        }
        pos += len;
    }
    None
}

/// Whether resolved run properties satisfy the run part of a find format.
fn run_matches(have: &RunProperties, f: &FindFormat) -> bool {
    let highlighted = have.highlight.is_some_and(|c| c != Color::Auto);
    if f.highlight.is_some_and(|want| want != highlighted) {
        return false;
    }
    let Some(want) = &f.run else {
        return true;
    };
    let toggle = |w: Option<bool>, h: Option<bool>| w.map_or(true, |w| w == h.unwrap_or(false));
    toggle(want.bold, have.bold)
        && toggle(want.italic, have.italic)
        && toggle(want.strike, have.strike)
        && want.underline.map_or(true, |w| {
            w == have.underline.unwrap_or(core_model::Underline::None)
        })
        && (want.font.is_none() || want.font == have.font)
        && (want.size.is_none() || want.size == have.size)
        && (want.color.is_none() || want.color == have.color)
        && (want.highlight.is_none() || want.highlight == have.highlight)
        && (want.vertical_align.is_none() || want.vertical_align == have.vertical_align)
}

/// The fields of `want` that differ from `have` (for "update style to
/// match": what the style must say so that it gives `want`).
fn run_diff(want: &RunProperties, have: &RunProperties) -> RunProperties {
    macro_rules! d {
        ($($f:ident),*) => {
            RunProperties { $($f: if want.$f != have.$f { want.$f.clone() } else { None },)* }
        };
    }
    d!(
        font,
        size,
        bold,
        italic,
        underline,
        strike,
        color,
        highlight,
        vertical_align
    )
}

/// `p` without the fields equal to `base` (direct formatting the style
/// now provides).
fn strip_same(p: &RunProperties, base: &RunProperties) -> RunProperties {
    macro_rules! s {
        ($($f:ident),*) => {
            RunProperties { $($f: if p.$f == base.$f { None } else { p.$f.clone() },)* }
        };
    }
    s!(
        font,
        size,
        bold,
        italic,
        underline,
        strike,
        color,
        highlight,
        vertical_align
    )
}

/// The paragraph fields of `want` that differ from `have`.
fn para_diff(want: &ParagraphProperties, have: &ParagraphProperties) -> ParagraphProperties {
    ParagraphProperties {
        alignment: want.alignment.filter(|_| want.alignment != have.alignment),
        // "Not set" means 0 / single here, which must be said explicitly
        // when the style has a value.
        indent: (want.indent != have.indent).then(|| {
            let (w, h) = (
                want.indent.unwrap_or_default(),
                have.indent.unwrap_or_default(),
            );
            let zero = |w: Option<Twips>, h: Option<Twips>| w.or(h.map(|_| Twips(0)));
            model_text::Indent {
                left: zero(w.left, h.left),
                right: zero(w.right, h.right),
                first_line: zero(w.first_line, h.first_line.filter(|_| w.hanging.is_none())),
                hanging: zero(w.hanging, h.hanging.filter(|_| w.first_line.is_none())),
            }
        }),
        spacing: (want.spacing != have.spacing).then(|| {
            let (w, h) = (
                want.spacing.unwrap_or_default(),
                have.spacing.unwrap_or_default(),
            );
            Spacing {
                before: w.before.or(h.before.map(|_| Twips(0))),
                after: w.after.or(h.after.map(|_| Twips(0))),
                line: w.line.or(h.line.map(|_| LineSpacing::Multiple(1.0))),
            }
        }),
        keep_next: want.keep_next.filter(|_| want.keep_next != have.keep_next),
        page_break_before: want
            .page_break_before
            .filter(|_| want.page_break_before != have.page_break_before),
        borders: want.borders.filter(|_| want.borders != have.borders),
        shading: want.shading.filter(|_| want.shading != have.shading),
        tabs: if want.tabs != have.tabs {
            want.tabs.clone()
        } else {
            Vec::new()
        },
        ..Default::default()
    }
}

/// Run formatting of `run` in `p` against the style sheet `styles` (the
/// document's, possibly already changed).
fn resolve_with(styles: &model_text::StyleSheet, p: &Paragraph, run: &Run) -> RunProperties {
    let style = p
        .props
        .style
        .as_deref()
        .filter(|s| styles.get(s).is_some())
        .map(str::to_owned)
        .or_else(|| {
            styles
                .default_style(StyleKind::Paragraph)
                .map(|s| s.id.clone())
        });
    let mut base = match style {
        Some(id) => styles.resolve_run(&id),
        None => styles.defaults.run.clone(),
    };
    if let Some(cs) = &run.style {
        base.apply(&styles.resolve_character(cs));
    }
    base.merged_with(&run.props)
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
        let before = self.sections_state();
        let mut inverse = self.exec(cmd, &mut ch)?;
        let added = self.fix_containers(&mut ch);
        if !added.is_empty() {
            inverse = C::Compound {
                commands: vec![inverse, C::DeleteBlocks { ids: added }],
            };
        }
        // Sections follow their end paragraphs (e.g. a deleted break).
        if self.doc.sync_sections() {
            inverse = C::Compound {
                commands: vec![inverse, before],
            };
            ch.sections = true;
            ch.page = true;
        }
        // Comments follow their markers (a deleted range, a lone marker).
        if may_touch_markers(cmd)
            && (!self.doc.comments.is_empty() || carries_markers(cmd) || self.has_bookmarks())
        {
            if let Some(fix) = self.fix_comments(&mut ch) {
                inverse = C::Compound {
                    commands: vec![fix, inverse],
                };
            }
        }
        if affects_labels(cmd) {
            self.relabel(&mut ch);
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
