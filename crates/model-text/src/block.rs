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
    /// The field's other switches (default: Word's `\\o \\h \\z \\u`).
    #[serde(default, skip_serializing_if = "TocSwitches::is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TocSwitches>"))]
    pub switches: TocSwitches,
}

/// A style listed in a `TOC \\t "Style,level"` switch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TocStyleLevel {
    /// The style's name (as written in the switch).
    pub style: String,
    /// The TOC level its paragraphs get (1–9).
    pub level: u8,
}

/// Switches of a `TOC` field beyond the levels and the caption. The
/// default is what Word inserts (`\\o "a-b" \\h \\z \\u`); the flags are
/// negated so that the default is all `false`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TocSwitches {
    /// No `\\o`: the heading styles do not make entries (only `\\u`/`\\t`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub no_headings: bool,
    /// No `\\h`: the entries are not links.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub no_links: bool,
    /// No `\\z`: tab leaders and page numbers also in Web view.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub no_hide_web: bool,
    /// No `\\u`: a paragraph's own outline level does not make an entry.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub no_outline_levels: bool,
    /// `\\n "a-b"`: the levels shown without page numbers (`\\n` alone:
    /// all, `[1, 9]`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub omit_pages: Option<[u8; 2]>,
    /// `\\t "Style,level,…"`: more styles and their levels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<TocStyleLevel>>"))]
    pub styles: Vec<TocStyleLevel>,
}

impl TocSwitches {
    /// Whether these are Word's defaults.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// Whether entries of `level` show their page number.
    pub fn shows_page(&self, level: u8) -> bool {
        !self
            .omit_pages
            .is_some_and(|[a, b]| (a..=b).contains(&level))
    }

    /// Parses the switches of a `TOC` instruction (`\\o`, `\\h`, `\\z`,
    /// `\\u`, `\\n "a-b"`, `\\t "Style,1,Other,2"`).
    pub fn parse(instr: &str) -> Self {
        let words = switch_words(instr);
        let has = |c: &str| words.iter().any(|(w, _)| w.eq_ignore_ascii_case(c));
        let arg = |c: &str| {
            words
                .iter()
                .find(|(w, _)| w.eq_ignore_ascii_case(c))
                .and_then(|(_, a)| a.clone())
        };
        let omit_pages = has("n").then(|| arg("n").and_then(|a| parse_range(&a)).unwrap_or([1, 9]));
        let mut styles = Vec::new();
        if let Some(t) = arg("t") {
            let parts: Vec<&str> = t.split([',', ';']).map(str::trim).collect();
            for pair in parts.chunks(2) {
                let style = pair[0];
                if style.is_empty() {
                    continue;
                }
                let level = pair
                    .get(1)
                    .and_then(|l| l.parse::<u8>().ok())
                    .unwrap_or(1)
                    .clamp(1, 9);
                styles.push(TocStyleLevel {
                    style: style.to_owned(),
                    level,
                });
            }
        }
        Self {
            no_headings: !has("o") && (!styles.is_empty() || has("u")),
            no_links: !has("h"),
            no_hide_web: !has("z"),
            no_outline_levels: !has("u"),
            omit_pages,
            styles,
        }
    }

    /// The switches after `\\o "a-b"` as written to docx (`\\h \\z \\u`
    /// for the default), each with a leading space.
    pub fn instruction(&self) -> String {
        let mut s = String::new();
        if !self.styles.is_empty() {
            let list: Vec<String> = self
                .styles
                .iter()
                .map(|t| format!("{},{}", t.style, t.level))
                .collect();
            s.push_str(&format!(" \\t \"{}\"", list.join(",")));
        }
        if !self.no_links {
            s.push_str(" \\h");
        }
        if !self.no_hide_web {
            s.push_str(" \\z");
        }
        if !self.no_outline_levels {
            s.push_str(" \\u");
        }
        if let Some([a, b]) = self.omit_pages {
            if (a, b) == (1, 9) {
                s.push_str(" \\n");
            } else {
                s.push_str(&format!(" \\n \"{a}-{b}\""));
            }
        }
        s
    }
}

/// `(switch letter, argument)` of every `\\x` in a field instruction; the
/// argument is the next word or quoted string unless that is a switch.
fn switch_words(instr: &str) -> Vec<(String, Option<String>)> {
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    let mut chars = instr.chars().peekable();
    let mut tokens: Vec<(bool, String)> = Vec::new();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c == '"' {
            chars.next();
            let mut t = String::new();
            for c in chars.by_ref() {
                if c == '"' {
                    break;
                }
                t.push(c);
            }
            tokens.push((false, t));
        } else if c == '\\' {
            chars.next();
            let mut t = String::new();
            if let Some(c) = chars.next() {
                t.push(c);
            }
            tokens.push((true, t));
        } else {
            let mut t = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() || c == '"' {
                    break;
                }
                t.push(c);
                chars.next();
            }
            tokens.push((false, t));
        }
    }
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i].0 {
            let arg = tokens.get(i + 1).filter(|t| !t.0).map(|t| t.1.clone());
            if arg.is_some() {
                i += 1;
            }
            out.push((tokens[i - usize::from(arg.is_some())].1.clone(), arg));
        }
        i += 1;
    }
    out
}

/// `"a-b"` → `[a, b]` (1–9, `b ≥ a`).
fn parse_range(s: &str) -> Option<[u8; 2]> {
    let (a, b) = s.split_once('-').unwrap_or((s, s));
    let a: u8 = a.trim().parse().ok()?;
    let b: u8 = b.trim().parse().ok()?;
    let a = a.clamp(1, 9);
    Some([a, b.clamp(a, 9)])
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
            switches: TocSwitches::default(),
        }
    }
}
