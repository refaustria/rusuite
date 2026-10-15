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
    /// Number of text columns (1 = no columns).
    #[serde(default = "one")]
    pub columns: u8,
    /// Space between columns (docx `w:cols/@w:space`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<i32>"))]
    pub column_space: Option<Twips>,
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
}

fn one() -> u8 {
    1
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
            columns: 1,
            column_space: None,
            title_page: false,
            page_number_start: None,
            page_number_format: None,
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
