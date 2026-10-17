//! Sections (docx `w:sectPr`), their headers and footers, and notes
//! (footnotes and endnotes).
//!
//! A document has at least one [`Section`]. Every section but the last
//! ends at a body paragraph whose [`ParagraphProperties::section_end`]
//! names it (docx: a `w:sectPr` inside that paragraph's `w:pPr`); the
//! last section is the body-level `w:sectPr` and its page setup is
//! mirrored in [`crate::Document::page`] (see
//! [`crate::Document::sync_sections`]).
//!
//! [`ParagraphProperties::section_end`]: crate::ParagraphProperties::section_end

use core_model::units::Twips;
use serde::{Deserialize, Serialize};

use crate::block::Block;
use crate::inline::NoteKind;
use crate::numbering::LevelKind;
use crate::page::PageSetup;

/// Document-unique id of a [`Section`]. Serializes as a plain number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct SectionId(pub u32);

/// Where a section starts (docx `w:type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum SectionKind {
    /// On a new page (Word's default).
    #[default]
    NextPage,
    /// On the same page.
    Continuous,
    /// On the next even page.
    EvenPage,
    /// On the next odd page.
    OddPage,
}

/// The headers (or footers) of a section. `None` = inherited from the
/// previous section (as in Word); the first section inherits nothing.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct HeaderFooterSet {
    /// Used on every page without a more specific one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub default: Option<Vec<Block>>,
    /// The first page of the section (only with [`Section::title_page`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub first: Option<Vec<Block>>,
    /// Even pages (only when the document uses different odd and even
    /// headers, docx `w:evenAndOddHeaders` in the settings).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub even: Option<Vec<Block>>,
}

impl HeaderFooterSet {
    /// Whether no slot is set.
    pub fn is_empty(&self) -> bool {
        self.default.is_none() && self.first.is_none() && self.even.is_none()
    }

    /// The slots that are set, as `(slot, blocks)`.
    pub fn slots(&self) -> impl Iterator<Item = (HeaderSlot, &Vec<Block>)> {
        [
            (HeaderSlot::Default, self.default.as_ref()),
            (HeaderSlot::First, self.first.as_ref()),
            (HeaderSlot::Even, self.even.as_ref()),
        ]
        .into_iter()
        .filter_map(|(s, b)| Some((s, b?)))
    }

    /// Mutable access to every set slot's blocks.
    pub fn blocks_mut(&mut self) -> impl Iterator<Item = &mut Vec<Block>> {
        [&mut self.default, &mut self.first, &mut self.even]
            .into_iter()
            .flatten()
    }

    /// The slot `slot`.
    pub fn get(&self, slot: HeaderSlot) -> Option<&Vec<Block>> {
        match slot {
            HeaderSlot::Default => self.default.as_ref(),
            HeaderSlot::First => self.first.as_ref(),
            HeaderSlot::Even => self.even.as_ref(),
        }
    }

    /// Mutable slot `slot`.
    pub fn get_mut(&mut self, slot: HeaderSlot) -> &mut Option<Vec<Block>> {
        match slot {
            HeaderSlot::Default => &mut self.default,
            HeaderSlot::First => &mut self.first,
            HeaderSlot::Even => &mut self.even,
        }
    }
}

/// Which header/footer of a section (docx `headerReference/@type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum HeaderSlot {
    /// `default`.
    Default,
    /// `first`.
    First,
    /// `even`.
    Even,
}

/// A section: page setup, headers/footers, columns and page numbering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Section {
    /// Id referenced by the section-end paragraph.
    pub id: SectionId,
    /// Page size and margins. `header_text`/`footer_text` are derived
    /// (the plain text of the effective default header/footer).
    pub page: PageSetup,
    /// Where the section starts.
    #[serde(default)]
    pub kind: SectionKind,
    /// Headers.
    #[serde(default, skip_serializing_if = "HeaderFooterSet::is_empty")]
    pub headers: HeaderFooterSet,
    /// Footers.
    #[serde(default, skip_serializing_if = "HeaderFooterSet::is_empty")]
    pub footers: HeaderFooterSet,
    /// Text columns (docx `w:cols`). Also reads the older plain number.
    #[serde(
        default,
        skip_serializing_if = "Columns::is_single",
        deserialize_with = "columns_compat"
    )]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Columns>"))]
    pub columns: Columns,
    /// The first page has its own header/footer (docx `w:titlePg`).
    #[serde(default)]
    pub title_page: bool,
    /// Page numbering restarts at this number (docx `pgNumType/@start`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub page_number_start: Option<u32>,
    /// Format of page numbers (docx `pgNumType/@fmt`; `None` = decimal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub page_number_format: Option<LevelKind>,
    /// Footnote numbering of the section (docx `w:sectPr/w:footnotePr`:
    /// `w:numFmt`, `w:numStart`, `w:numRestart`; References › Footnote and
    /// Endnote). `None` = continuous Arabic numbers from 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub footnote_numbering: Option<NoteNumbering>,
    /// Endnote numbering of the section (docx `w:sectPr/w:endnotePr`).
    /// `None` = continuous lower-case Roman numbers from i.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub endnote_numbering: Option<NoteNumbering>,
}

/// Where note numbers start again (docx `w:numRestart`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum NoteRestart {
    /// Numbers run on through the document (`continuous`, the default).
    #[default]
    Continuous,
    /// Every section starts again (`eachSect`).
    EachSection,
    /// Every page starts again (`eachPage`; footnotes only).
    EachPage,
}

/// The number format, start and restart of footnotes or endnotes in a
/// section (the Footnote and Endnote dialog's Format group).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct NoteNumbering {
    /// Number format (`w:numFmt`; `None` = the note kind's default:
    /// decimal for footnotes, lower-case Roman for endnotes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub format: Option<LevelKind>,
    /// First number (`w:numStart`; `None` = 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub start: Option<u32>,
    /// Where the numbers restart (`w:numRestart`).
    #[serde(default, skip_serializing_if = "is_continuous")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<NoteRestart>"))]
    pub restart: NoteRestart,
}

fn is_continuous(r: &NoteRestart) -> bool {
    *r == NoteRestart::Continuous
}

impl NoteNumbering {
    /// Whether everything has its default (stored as no numbering).
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// `Some(self)` unless it is the default.
    pub fn non_default(self) -> Option<Self> {
        (!self.is_default()).then_some(self)
    }
}

/// One column of unequal-width columns: its width and the space after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct ColumnWidth {
    /// Width (docx `w:col/@w:w`).
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub width: Twips,
    /// Space to the next column (`w:space`; 0 for the last).
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub space: Twips,
}

/// The text columns of a section (Layout › Columns).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Columns {
    /// Number of columns (1 = no columns, at most 45; docx `w:num`).
    pub count: u8,
    /// Space between equal columns (docx `w:space`; `None` = Word's 0.5").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<i32>"))]
    pub spacing: Option<Twips>,
    /// Equal column width (docx `w:equalWidth`; unequal columns take
    /// `widths`).
    #[serde(default = "yes")]
    pub equal: bool,
    /// Width and following space of each column when not `equal`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub widths: Vec<ColumnWidth>,
    /// A line between the columns (docx `w:sep`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub separator: bool,
}

fn yes() -> bool {
    true
}

impl Default for Columns {
    fn default() -> Self {
        Self::equal(1)
    }
}

/// Word's default space between columns: 0.5" (720 twips).
pub const DEFAULT_COLUMN_SPACE: Twips = Twips(720);

impl Columns {
    /// `count` equal columns with the default spacing.
    pub fn equal(count: u8) -> Self {
        Self {
            count: count.max(1),
            spacing: None,
            equal: true,
            widths: Vec::new(),
            separator: false,
        }
    }

    /// One column, nothing else set (the docx default).
    pub fn is_single(&self) -> bool {
        *self == Self::default()
    }

    /// The width and following space of every column for a text width of
    /// `content` twips: equal columns share what is left after the
    /// spacing; unequal ones use `widths` (scaled to fit `content`).
    pub fn layout(&self, content: Twips) -> Vec<ColumnWidth> {
        let n = i32::from(self.count.max(1));
        if !self.equal && self.widths.len() == n as usize {
            let total: i32 = self.widths.iter().map(|c| c.width.0 + c.space.0).sum();
            if total > 0 && total != content.0 {
                let k = f64::from(content.0) / f64::from(total);
                return self
                    .widths
                    .iter()
                    .map(|c| ColumnWidth {
                        width: Twips((f64::from(c.width.0) * k).round() as i32),
                        space: Twips((f64::from(c.space.0) * k).round() as i32),
                    })
                    .collect();
            }
            return self.widths.clone();
        }
        let space = self.spacing.unwrap_or(DEFAULT_COLUMN_SPACE).0.max(0);
        let width = ((content.0 - space * (n - 1)) / n).max(0);
        (0..n)
            .map(|i| ColumnWidth {
                width: Twips(width),
                space: Twips(if i + 1 < n { space } else { 0 }),
            })
            .collect()
    }
}

/// Reads [`Columns`] or the older plain column count.
fn columns_compat<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Columns, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Compat {
        Count(u8),
        Full(Columns),
    }
    Ok(match Compat::deserialize(d)? {
        Compat::Count(n) => Columns::equal(n),
        Compat::Full(c) => c,
    })
}

impl Section {
    /// A next-page section with `page`, one column and no headers.
    pub fn new(id: SectionId, page: PageSetup) -> Self {
        Self {
            id,
            page,
            kind: SectionKind::NextPage,
            headers: HeaderFooterSet::default(),
            footers: HeaderFooterSet::default(),
            columns: Columns::default(),
            title_page: false,
            page_number_start: None,
            page_number_format: None,
            footnote_numbering: None,
            endnote_numbering: None,
        }
    }

    /// The header (`footer == false`) or footer set.
    pub fn header_footer(&self, footer: bool) -> &HeaderFooterSet {
        if footer {
            &self.footers
        } else {
            &self.headers
        }
    }

    /// Mutable [`Section::header_footer`].
    pub fn header_footer_mut(&mut self, footer: bool) -> &mut HeaderFooterSet {
        if footer {
            &mut self.footers
        } else {
            &mut self.headers
        }
    }
}

/// A footnote or endnote: its content. Referenced from the text by an
/// [`Inline::NoteRef`](crate::Inline::NoteRef) with the same id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Note {
    /// Id, unique across foot- and endnotes, at least 1.
    pub id: u32,
    /// Footnote or endnote.
    pub kind: NoteKind,
    /// Content (paragraphs carry node ids and can be edited with the
    /// ordinary text commands).
    pub blocks: Vec<Block>,
}

/// A footnote or endnote separator (Word's View › Draft › Footnotes pane:
/// "Footnote Separator", "Footnote Continuation Separator").
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind",
    content = "value"
)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum NoteSeparator {
    /// Word's line (a short one for the separator, the text width for the
    /// continuation separator; docx `w:separator`/`w:continuationSeparator`).
    #[default]
    Line,
    /// Own text instead of the line (empty = no separator).
    Text { text: String },
}

impl NoteSeparator {
    /// Whether this is Word's line.
    pub fn is_line(&self) -> bool {
        matches!(self, NoteSeparator::Line)
    }
}

/// The separators of the notes areas (docx: the `separator` and
/// `continuationSeparator` notes of `footnotes.xml`/`endnotes.xml`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct NoteSeparators {
    /// Above the footnotes of a page.
    #[serde(default, skip_serializing_if = "NoteSeparator::is_line")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<NoteSeparator>"))]
    pub footnote: NoteSeparator,
    /// Above a footnote continued from the previous page.
    #[serde(default, skip_serializing_if = "NoteSeparator::is_line")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<NoteSeparator>"))]
    pub footnote_continuation: NoteSeparator,
    /// Above the endnotes.
    #[serde(default, skip_serializing_if = "NoteSeparator::is_line")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<NoteSeparator>"))]
    pub endnote: NoteSeparator,
    /// Above an endnote continued from the previous page.
    #[serde(default, skip_serializing_if = "NoteSeparator::is_line")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<NoteSeparator>"))]
    pub endnote_continuation: NoteSeparator,
}

impl NoteSeparators {
    /// Whether all four are Word's lines.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// The separator of `kind` (`continuation` = the continuation one).
    pub fn get(&self, kind: NoteKind, continuation: bool) -> &NoteSeparator {
        match (kind, continuation) {
            (NoteKind::Foot, false) => &self.footnote,
            (NoteKind::Foot, true) => &self.footnote_continuation,
            (NoteKind::End, false) => &self.endnote,
            (NoteKind::End, true) => &self.endnote_continuation,
        }
    }

    /// Mutable [`NoteSeparators::get`].
    pub fn get_mut(&mut self, kind: NoteKind, continuation: bool) -> &mut NoteSeparator {
        match (kind, continuation) {
            (NoteKind::Foot, false) => &mut self.footnote,
            (NoteKind::Foot, true) => &mut self.footnote_continuation,
            (NoteKind::End, false) => &mut self.endnote,
            (NoteKind::End, true) => &mut self.endnote_continuation,
        }
    }
}
