//! The [`Document`]: body, styles, numbering, sections, notes and media.

use std::collections::HashMap;

use core_model::RunProperties;
use serde::{Deserialize, Serialize};

use crate::block::{Block, NodeId, Paragraph, TocEntry};
use crate::comment::Comment;
use crate::inline::{Field, FieldKind, Inline, Run};
use crate::media::MediaStore;
use crate::numbering::{ListCounter, Numbering};
use crate::page::{PageSetup, PAGE_FIELD};
use crate::properties::{CoreProperties, DocumentSettings};
use crate::props::{NumberingRef, ParagraphProperties};
use crate::section::{HeaderSlot, Note, Section, SectionId};
use crate::style::{StyleKind, StyleSheet};

/// Counts of [`Document::statistics`] (docx `app.xml` `Words`,
/// `Characters`, `CharactersWithSpaces`, `Paragraphs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct DocumentStatistics {
    /// Words.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub words: usize,
    /// Characters without spaces.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub characters: usize,
    /// Characters with spaces.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub characters_with_spaces: usize,
    /// Paragraphs that contain text.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub paragraphs: usize,
}

/// A Write document.
///
/// Serializes with all node ids; the id counter is not serialized but
/// recomputed on load as the largest id + 1 (see [`crate::snapshot`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "crate::snapshot::DocumentData")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Document {
    /// Top-level blocks in order.
    pub body: Vec<Block>,
    /// Styles and document defaults.
    pub styles: StyleSheet,
    /// List definitions.
    pub numbering: Numbering,
    /// Page size and margins of the last section (mirrored into
    /// `sections`' last entry by [`Document::sync_sections`]); its
    /// `header_text`/`footer_text` are the derived plain text of the last
    /// section's default header/footer.
    pub page: PageSetup,
    /// Sections in order (at least one after [`Document::normalize`]); see
    /// [`crate::section`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Section>>"))]
    pub sections: Vec<Section>,
    /// Footnotes and endnotes (ids unique across both kinds).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Note>>"))]
    pub notes: Vec<Note>,
    /// Comments and replies (see [`crate::comment`]), in file order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Comment>>"))]
    pub comments: Vec<Comment>,
    /// Images and other binary parts.
    #[cfg_attr(feature = "ts", ts(as = "Vec<crate::media::MediaItem>"))]
    pub media: MediaStore,
    /// Document properties (File › Info).
    #[serde(default, skip_serializing_if = "CoreProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<CoreProperties>"))]
    pub properties: CoreProperties,
    /// Document settings (hyphenation).
    #[serde(default, skip_serializing_if = "DocumentSettings::is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<DocumentSettings>"))]
    pub settings: DocumentSettings,
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
    /// one A4 section without headers, no lists, notes or media.
    pub fn new() -> Self {
        let mut doc = Self::empty(StyleSheet::office_defaults(), PageSetup::a4());
        let id = doc.alloc_id();
        doc.body.push(Block::Paragraph(Paragraph::new(id)));
        doc.sync_sections();
        doc
    }

    /// A document with an empty body and no sections (not normalized),
    /// e.g. for importers.
    pub fn empty(styles: StyleSheet, page: PageSetup) -> Self {
        Self {
            body: Vec::new(),
            styles,
            numbering: Numbering::default(),
            page,
            sections: Vec::new(),
            notes: Vec::new(),
            comments: Vec::new(),
            media: MediaStore::new(),
            properties: CoreProperties::default(),
            settings: DocumentSettings::default(),
            next_id: 1,
        }
    }

    /// Every block container: the body, then each note's blocks, then the
    /// headers and footers of each section, then each comment's content.
    pub fn containers(&self) -> impl Iterator<Item = &Vec<Block>> {
        self.text_containers()
            .chain(self.comments.iter().map(|c| &c.content))
    }

    /// Mutable [`Document::containers`].
    pub fn containers_mut(&mut self) -> impl Iterator<Item = &mut Vec<Block>> {
        std::iter::once(&mut self.body)
            .chain(self.notes.iter_mut().map(|n| &mut n.blocks))
            .chain(
                self.sections
                    .iter_mut()
                    .flat_map(|s| s.headers.blocks_mut().chain(s.footers.blocks_mut())),
            )
            .chain(self.comments.iter_mut().map(|c| &mut c.content))
    }

    /// Allocates a fresh, document-unique node id.
    pub fn alloc_id(&mut self) -> NodeId {
        let id = NodeId(self.next_id);
        self.next_id += 1;
        id
    }

    /// Makes sure [`alloc_id`](Self::alloc_id) never returns `id` (for
    /// callers that place nodes with ids chosen outside the document, e.g.
    /// restored by undo).
    pub fn reserve_id(&mut self, id: NodeId) {
        self.next_id = self.next_id.max(id.0.saturating_add(1));
    }

    /// The block with id `id`, searching inside tables, notes, headers
    /// and footers.
    pub fn find_block(&self, id: NodeId) -> Option<&Block> {
        self.containers().find_map(|c| find_in(c, id))
    }

    /// Mutable access to the block with id `id` (see
    /// [`find_block`](Self::find_block)).
    pub fn find_block_mut(&mut self, id: NodeId) -> Option<&mut Block> {
        self.containers_mut().find_map(|c| find_in_mut(c, id))
    }

    /// The drawing (shape or text box) with id `id`, anywhere.
    pub fn find_drawing(&self, id: NodeId) -> Option<&crate::drawing::Drawing> {
        self.containers().find_map(|c| find_drawing_in(c, id))
    }

    /// Mutable [`find_drawing`](Self::find_drawing).
    pub fn find_drawing_mut(&mut self, id: NodeId) -> Option<&mut crate::drawing::Drawing> {
        self.containers_mut()
            .find_map(|c| find_drawing_in_mut(c, id))
    }

    /// For a block inside the text of a drawing (or the drawing itself):
    /// the paragraph holding the drawing and the drawing's id. `None` for
    /// blocks outside drawings.
    pub fn drawing_host(&self, id: NodeId) -> Option<(NodeId, NodeId)> {
        self.containers().find_map(|c| drawing_host_in(c, id))
    }

    /// The note whose content holds the block `id` (at any depth).
    pub fn note_of_block(&self, id: NodeId) -> Option<&Note> {
        self.notes.iter().find(|n| find_in(&n.blocks, id).is_some())
    }

    /// The section (index) whose header or footer holds the block `id`.
    pub fn header_of_block(&self, id: NodeId) -> Option<usize> {
        self.sections.iter().position(|s| {
            s.headers
                .slots()
                .chain(s.footers.slots())
                .any(|(_, b)| find_in(b, id).is_some())
        })
    }

    /// The paragraph with id `id` (see [`find_block`](Self::find_block)).
    pub fn find_paragraph(&self, id: NodeId) -> Option<&Paragraph> {
        self.find_block(id).and_then(Block::as_paragraph)
    }

    /// All paragraphs of the body in document order, including those in
    /// table cells (not those of notes, headers and footers).
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
                    .split(|c: char| c.is_whitespace() || matches!(c, '\u{FFFC}' | '\u{2}'))
                    .filter(|w| !w.is_empty())
                    .count()
            })
            .sum()
    }

    /// File › Info statistics (Word's Word Count dialog): words, characters
    /// without spaces, characters with spaces and non-empty paragraphs of
    /// the body (table cells included).
    pub fn statistics(&self) -> DocumentStatistics {
        let mut out = DocumentStatistics {
            words: self.word_count(),
            ..Default::default()
        };
        for p in self.paragraphs() {
            let text: String = p
                .text()
                .chars()
                .filter(|c| !matches!(c, '\u{FFFC}' | '\u{2}'))
                .collect();
            if text.trim().is_empty() {
                continue;
            }
            out.paragraphs += 1;
            out.characters_with_spaces += text.chars().count();
            out.characters += text.chars().filter(|c| !c.is_whitespace()).count();
        }
        out
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
        out.strip_cleared_tabs();
        out
    }

    /// Effective character formatting of `run` in `p`: document defaults →
    /// paragraph style chain → the run's character style chain (toggle
    /// properties switch, see [`apply_character_style`](crate::style::apply_character_style))
    /// → direct formatting (absolute).
    pub fn resolve_run_props(&self, p: &Paragraph, run: &Run) -> RunProperties {
        let mut base = match self.effective_style(p) {
            Some(id) => self.styles.resolve_run(id),
            None => self.styles.defaults.run.clone(),
        };
        if let Some(cs) = &run.style {
            crate::style::apply_character_style(&mut base, &self.styles.resolve_character(cs));
        }
        base.merged_with(&run.props)
    }

    /// Canonicalizes the content: merges adjacent runs with equal
    /// formatting, drops empty runs, and makes the body, every note,
    /// header, footer and table cell non-empty and end with a paragraph
    /// (adding an empty one if needed, as Word requires); resolves the
    /// numbering levels ([`Numbering::resolve`]), the sections
    /// ([`Document::sync_sections`]) and the comment invariants
    /// ([`Document::fix_comments`]) and bookmarks
    /// ([`Document::fix_bookmarks`]). Text is preserved.
    pub fn normalize(&mut self) {
        self.fix_comments();
        self.fix_bookmarks();
        let mut next_id = self.next_id;
        for c in self.containers_mut() {
            normalize_blocks(c, &mut next_id);
        }
        self.next_id = next_id;
        self.numbering.resolve();
        self.sync_sections();
    }

    /// Largest node id in use (0 if none).
    pub(crate) fn max_node_id(&self) -> u64 {
        fn walk(blocks: &[Block], max: &mut u64) {
            for b in blocks {
                *max = (*max).max(b.id().0);
                match b {
                    Block::Table(t) => {
                        for row in &t.rows {
                            *max = (*max).max(row.id.0);
                            for cell in &row.cells {
                                *max = (*max).max(cell.id.0);
                                walk(&cell.blocks, max);
                            }
                        }
                    }
                    Block::Paragraph(p) => {
                        for d in p.drawings() {
                            *max = (*max).max(d.id.0);
                            walk(d.blocks(), max);
                        }
                    }
                    Block::Toc(_) => {}
                }
            }
        }
        let mut max = 0;
        for c in self.containers() {
            walk(c, &mut max);
        }
        max
    }

    // ----- lists ---------------------------------------------------------

    /// The effective numbering of `p` (direct, else from its style chain);
    /// `None` when not numbered (`num_id == 0` included).
    pub fn numbering_of(&self, p: &Paragraph) -> Option<NumberingRef> {
        let n = match p.props.numbering {
            Some(n) => Some(n),
            None => self
                .effective_style(p)
                .and_then(|s| self.styles.resolve_paragraph(s).numbering),
        };
        n.filter(|n| n.num_id != 0)
    }

    /// The list label of every numbered body paragraph (table cells
    /// included) in document order, computed with Word's counting rules:
    /// lists sharing an abstract definition share a counter; a level
    /// restarts after a shallower level (or the level given by
    /// `lvlRestart`) was used; a start override restarts a level the first
    /// time its list uses it; `%n` placeholders show level n's current
    /// number in that level's format (decimal throughout with `isLgl`), an
    /// unused level showing its start value. Bullets give their character;
    /// paragraphs with dangling references are left out.
    pub fn list_numbers(&self) -> Vec<(NodeId, String)> {
        let mut counter = ListCounter::default();
        let mut style_nums: HashMap<&str, Option<NumberingRef>> = HashMap::new();
        let mut out = Vec::new();
        for p in self.paragraphs() {
            let num = match p.props.numbering {
                Some(n) => Some(n),
                None => match self.effective_style(p) {
                    Some(s) => *style_nums
                        .entry(s)
                        .or_insert_with(|| self.styles.resolve_paragraph(s).numbering),
                    None => None,
                },
            };
            let Some(num) = num.filter(|n| n.num_id != 0) else {
                continue;
            };
            if let Some(label) = counter.next(&self.numbering, num) {
                out.push((p.id, label));
            }
        }
        out
    }

    // ----- table of contents ---------------------------------------------

    /// The outline level (1-based) of `p`: its outline level (docx
    /// `w:outlineLvl`, direct or from its style chain; body text = `None`),
    /// else N for a paragraph whose style, or a style it is based on, is
    /// the built-in `Heading N` (id `HeadingN` or name `heading N`,
    /// N = 1..9).
    pub fn outline_level(&self, p: &Paragraph) -> Option<u8> {
        let direct = p.props.outline_level.or_else(|| {
            let style = self.effective_style(p)?;
            self.styles.resolve_paragraph(style).outline_level
        });
        if let Some(l) = direct {
            return (l < 9).then_some(l + 1);
        }
        let mut id = self.effective_style(p)?.to_owned();
        for _ in 0..16 {
            let style = self.styles.get(&id)?;
            let level = heading_level(&style.id).or_else(|| {
                let name = style.name.to_ascii_lowercase();
                name.strip_prefix("heading ").and_then(heading_number)
            });
            if level.is_some() {
                return level;
            }
            id = style.based_on.clone()?;
        }
        None
    }

    /// Entries for a table of contents over outline levels
    /// `from..=to`: every non-empty heading of the body (table cells
    /// included) in document order, `page: None`. A numbered heading's
    /// entry starts with its number (`1.1 Scope`, as in Word; bullets are
    /// left out).
    pub fn build_toc(&self, from: u8, to: u8) -> Vec<TocEntry> {
        let mut labels: Option<HashMap<NodeId, String>> = None;
        self.paragraphs()
            .filter_map(|p| {
                let level = self.outline_level(p)?;
                if level < from || level > to {
                    return None;
                }
                let mut text = p.display_text().replace('\t', " ").trim().to_owned();
                if text.is_empty() {
                    return None;
                }
                let labels =
                    labels.get_or_insert_with(|| self.list_numbers().into_iter().collect());
                if let Some(label) = labels
                    .get(&p.id)
                    .filter(|l| l.chars().any(char::is_alphanumeric))
                {
                    text = format!("{} {text}", label.trim());
                }
                Some(TocEntry {
                    text,
                    level,
                    page: None,
                    target: p.id,
                })
            })
            .collect()
    }

    /// The entries of table of contents `t`: [`Document::build_toc`] over
    /// its levels, or for a table of figures every caption of its
    /// sequence (text as shown, level 1).
    pub fn toc_entries(&self, t: &crate::block::Toc) -> Vec<TocEntry> {
        let Some(id) = t.caption.as_deref() else {
            return self.build_toc(t.from_level, t.to_level);
        };
        self.captions(id)
            .into_iter()
            .filter_map(|p| {
                let text = p.display_text().replace('\t', " ").trim().to_owned();
                (!text.is_empty()).then_some(TocEntry {
                    text,
                    level: 1,
                    page: None,
                    target: p.id,
                })
            })
            .collect()
    }

    // ----- sections ------------------------------------------------------

    /// The index of the section holding the top-level body block that is
    /// or contains `id`.
    pub fn section_index_of(&self, id: NodeId) -> Option<usize> {
        let mut idx = 0;
        for b in &self.body {
            if b.id() == id || find_in(std::slice::from_ref(b), id).is_some() {
                return Some(idx.min(self.sections.len().saturating_sub(1)));
            }
            if let Block::Paragraph(p) = b {
                if p.props.section_end.is_some()
                    && p.props.section_end == self.sections.get(idx).map(|s| s.id)
                    && idx + 1 < self.sections.len()
                {
                    idx += 1;
                }
            }
        }
        None
    }

    /// An unused section id.
    pub fn next_section_id(&self) -> SectionId {
        SectionId(self.sections.iter().map(|s| s.id.0).max().unwrap_or(0) + 1)
    }

    /// The effective header (`footer == false`) or footer of section
    /// `index` in `slot`: its own, else the nearest previous section's
    /// (Word's inheritance).
    pub fn effective_header_footer(
        &self,
        index: usize,
        footer: bool,
        slot: HeaderSlot,
    ) -> Option<&Vec<Block>> {
        self.sections
            .get(..=index)?
            .iter()
            .rev()
            .find_map(|s| s.header_footer(footer).get(slot))
    }

    /// Replaces the default header (`footer == false`) or footer of the
    /// last section by plain text (`{PAGE}` = page number field, one
    /// paragraph per line, style `Header`/`Footer` when defined); `None`
    /// or an empty string removes it. Updates
    /// [`PageSetup::header_text`]/[`footer_text`](PageSetup::footer_text).
    pub fn set_header_text(&mut self, footer: bool, text: Option<&str>) {
        self.sync_sections();
        let text = text.filter(|t| !t.is_empty());
        let last = self.sections.len() - 1;
        let blocks = match text {
            Some(t) => Some(self.text_blocks(t, footer)),
            None => {
                let inherited = last > 0
                    && self
                        .effective_header_footer(last - 1, footer, HeaderSlot::Default)
                        .is_some();
                // An empty header stops the inheritance from the previous
                // section.
                inherited.then(|| vec![Block::Paragraph(Paragraph::new(self.alloc_id()))])
            }
        };
        *self.sections[last]
            .header_footer_mut(footer)
            .get_mut(HeaderSlot::Default) = blocks;
        self.sync_sections();
    }

    /// Header/footer blocks for plain `text` (see
    /// [`set_header_text`](Self::set_header_text)).
    pub fn text_blocks(&mut self, text: &str, footer: bool) -> Vec<Block> {
        let style = if footer { "Footer" } else { "Header" };
        let style = self.styles.get(style).map(|s| s.id.clone());
        text.split('\n')
            .map(|line| {
                let mut p = Paragraph::new(self.alloc_id());
                p.props.style.clone_from(&style);
                for (i, piece) in line.split(PAGE_FIELD).enumerate() {
                    if i > 0 {
                        p.inlines.push(Inline::Field(Field {
                            cached: "1".into(),
                            ..Field::new(FieldKind::Page)
                        }));
                    }
                    if !piece.is_empty() {
                        p.inlines.push(Inline::Run(Run::new(piece)));
                    }
                }
                Block::Paragraph(p)
            })
            .collect()
    }

    /// Restores the section invariants: at least one section (built from
    /// [`Document::page`], its `header_text`/`footer_text` becoming the
    /// default header/footer, when there is none); sections ordered as
    /// their section-end paragraphs; sections other than the last whose
    /// end paragraph is gone are dropped (their content joins the next
    /// section, as when a section break is deleted in Word); the last
    /// section's page setup is [`Document::page`]; every section's
    /// `page.header_text`/`footer_text` and `Document::page`'s are the
    /// plain text of the effective default header/footer. Section-end
    /// marks that name no section (or a section already ended) are
    /// ignored. Returns whether anything changed.
    pub fn sync_sections(&mut self) -> bool {
        let before = (self.sections.clone(), self.page.clone());
        if self.sections.is_empty() {
            let id = SectionId(1);
            let page = self.page.clone();
            let mut section = Section::new(id, page.clone());
            for (text, footer) in [(&page.header_text, false), (&page.footer_text, true)] {
                if let Some(t) = text.as_deref().filter(|t| !t.is_empty()) {
                    *section
                        .header_footer_mut(footer)
                        .get_mut(HeaderSlot::Default) = Some(self.text_blocks(t, footer));
                }
            }
            self.sections.push(section);
        }
        let Some(last) = self.sections.pop() else {
            return true;
        };
        let mut rest = std::mem::take(&mut self.sections);
        for b in &self.body {
            let Some(id) = b.as_paragraph().and_then(|p| p.props.section_end) else {
                continue;
            };
            if let Some(i) = rest.iter().position(|s| s.id == id) {
                self.sections.push(rest.remove(i));
            }
        }
        self.sections.push(last);
        let n = self.sections.len();
        let page = self.page.clone();
        self.sections[n - 1].page = page;
        for i in 0..n {
            let header = self.header_text_of(i, false);
            let footer = self.header_text_of(i, true);
            let p = &mut self.sections[i].page;
            p.header_text = header;
            p.footer_text = footer;
        }
        self.page = self.sections[n - 1].page.clone();
        before != (self.sections.clone(), self.page.clone())
    }

    /// Plain text of the effective default header/footer of section `i`:
    /// paragraphs joined by `\n` (trailing empty ones dropped), the page
    /// number field as [`PAGE_FIELD`], other fields as their result;
    /// `None` if there is none or it is empty.
    fn header_text_of(&self, i: usize, footer: bool) -> Option<String> {
        let blocks = self.effective_header_footer(i, footer, HeaderSlot::Default)?;
        let mut lines = Vec::new();
        for p in paragraphs_in(blocks) {
            let mut line = String::new();
            for inline in &p.inlines {
                match inline {
                    Inline::Run(r) => line.push_str(&r.text),
                    Inline::Field(f) if f.kind == FieldKind::Page => line.push_str(PAGE_FIELD),
                    Inline::Field(f) => line.push_str(&f.cached),
                    Inline::Break(_) => line.push(' '),
                    Inline::Image(_)
                    | Inline::Drawing(_)
                    | Inline::NoteRef(_)
                    | Inline::CommentStart { .. }
                    | Inline::CommentEnd { .. }
                    | Inline::BookmarkStart { .. }
                    | Inline::BookmarkEnd { .. } => {}
                }
            }
            lines.push(line);
        }
        while lines.last().is_some_and(String::is_empty) {
            lines.pop();
        }
        (!lines.is_empty()).then(|| lines.join("\n"))
    }

    // ----- notes ---------------------------------------------------------

    /// The note with id `id`.
    pub fn note(&self, id: u32) -> Option<&Note> {
        self.notes.iter().find(|n| n.id == id)
    }

    /// An unused note id (at least 2, so it never collides with the
    /// separator ids `-1/0` (Word) or `0/1` (LibreOffice) in the file).
    pub fn next_note_id(&self) -> u32 {
        self.notes
            .iter()
            .map(|n| n.id + 1)
            .max()
            .unwrap_or(2)
            .max(2)
    }
}

/// `N` of a `HeadingN` style id.
fn heading_level(id: &str) -> Option<u8> {
    id.strip_prefix("Heading").and_then(heading_number)
}

fn heading_number(n: &str) -> Option<u8> {
    match n.parse::<u8>() {
        Ok(v @ 1..=9) if n.len() == 1 => Some(v),
        _ => None,
    }
}

/// The block `id` in `blocks`, searching inside table cells and the text of
/// drawings.
pub(crate) fn find_in(blocks: &[Block], id: NodeId) -> Option<&Block> {
    for b in blocks {
        if b.id() == id {
            return Some(b);
        }
        match b {
            Block::Table(t) => {
                for cell in t.rows.iter().flat_map(|r| &r.cells) {
                    if let Some(found) = find_in(&cell.blocks, id) {
                        return Some(found);
                    }
                }
            }
            Block::Paragraph(p) => {
                for d in p.drawings() {
                    if let Some(found) = find_in(d.blocks(), id) {
                        return Some(found);
                    }
                }
            }
            Block::Toc(_) => {}
        }
    }
    None
}

fn find_in_mut(blocks: &mut [Block], id: NodeId) -> Option<&mut Block> {
    for b in blocks {
        if b.id() == id {
            return Some(b);
        }
        match b {
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    if let Some(found) = find_in_mut(&mut cell.blocks, id) {
                        return Some(found);
                    }
                }
            }
            Block::Paragraph(p) => {
                for d in p.drawings_mut() {
                    if let Some(found) = d.blocks_mut().and_then(|b| find_in_mut(b, id)) {
                        return Some(found);
                    }
                }
            }
            Block::Toc(_) => {}
        }
    }
    None
}

/// The drawing with id `id` in `blocks` (cells included).
pub(crate) fn find_drawing_in(blocks: &[Block], id: NodeId) -> Option<&crate::drawing::Drawing> {
    for b in blocks {
        match b {
            Block::Table(t) => {
                for cell in t.rows.iter().flat_map(|r| &r.cells) {
                    if let Some(found) = find_drawing_in(&cell.blocks, id) {
                        return Some(found);
                    }
                }
            }
            Block::Paragraph(p) => {
                if let Some(d) = p.drawings().find(|d| d.id == id) {
                    return Some(d);
                }
            }
            Block::Toc(_) => {}
        }
    }
    None
}

fn find_drawing_in_mut(blocks: &mut [Block], id: NodeId) -> Option<&mut crate::drawing::Drawing> {
    for b in blocks {
        match b {
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    if let Some(found) = find_drawing_in_mut(&mut cell.blocks, id) {
                        return Some(found);
                    }
                }
            }
            Block::Paragraph(p) => {
                if let Some(d) = p.drawings_mut().find(|d| d.id == id) {
                    return Some(d);
                }
            }
            Block::Toc(_) => {}
        }
    }
    None
}

/// The id of the paragraph (in `blocks`, cells included) holding the drawing
/// whose text contains the block `id`, with the drawing's id.
pub(crate) fn drawing_host_in(blocks: &[Block], id: NodeId) -> Option<(NodeId, NodeId)> {
    for b in blocks {
        match b {
            Block::Table(t) => {
                for cell in t.rows.iter().flat_map(|r| &r.cells) {
                    if let Some(found) = drawing_host_in(&cell.blocks, id) {
                        return Some(found);
                    }
                }
            }
            Block::Paragraph(p) => {
                for d in p.drawings() {
                    if d.id == id || find_in(d.blocks(), id).is_some() {
                        return Some((p.id, d.id));
                    }
                }
            }
            Block::Toc(_) => {}
        }
    }
    None
}

/// The paragraphs of `blocks` in order, including those in table cells.
pub fn paragraphs_in<'a>(blocks: &'a [Block]) -> Box<dyn Iterator<Item = &'a Paragraph> + 'a> {
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
                    Block::Toc(_) => Box::new(std::iter::empty()),
                }
            }),
    )
}

fn normalize_blocks(blocks: &mut Vec<Block>, next_id: &mut u64) {
    for b in blocks.iter_mut() {
        match b {
            Block::Paragraph(p) => {
                merge_runs(&mut p.inlines);
                for d in p.drawings_mut() {
                    if d.kind == crate::drawing::DrawingKind::TextBox && d.text.is_none() {
                        d.text = Some(crate::drawing::DrawingText::new(Vec::new()));
                    }
                    if let Some(blocks) = d.blocks_mut() {
                        normalize_blocks(blocks, next_id);
                    }
                }
            }
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    normalize_blocks(&mut cell.blocks, next_id);
                }
            }
            Block::Toc(_) => {}
        }
    }
    if !matches!(blocks.last(), Some(Block::Paragraph(_))) {
        blocks.push(Block::Paragraph(Paragraph::new(NodeId(*next_id))));
        *next_id += 1;
    }
}

pub(crate) fn merge_runs(inlines: &mut Vec<Inline>) {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    for inline in inlines.drain(..) {
        match (out.last_mut(), inline) {
            (_, Inline::Run(run)) if run.text.is_empty() => {}
            (Some(Inline::Run(prev)), Inline::Run(run)) if prev.same_format(&run) => {
                prev.text.push_str(&run.text);
            }
            (_, other) => out.push(other),
        }
    }
    *inlines = out;
}
