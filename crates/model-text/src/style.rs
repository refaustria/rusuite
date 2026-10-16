//! Named styles and document defaults.
//!
//! A [`StyleSheet`] holds the document defaults (docx `w:docDefaults`) and
//! the named [`Style`]s (`w:style`) in file order. Paragraph, linked,
//! character, table and numbering styles share one id space; `based_on`
//! chains are resolved root first (document defaults → chain → direct
//! formatting, ADR 0006). The sheet's editing operations
//! ([`StyleSheet::add`], [`StyleSheet::update`], [`StyleSheet::rename`],
//! [`StyleSheet::delete`], [`StyleSheet::set_default`]) validate ids,
//! names, kinds and `based_on` cycles; [`Document::delete_style`] also
//! re-points the paragraphs and runs that used a deleted style.

use core_model::units::Twips;
use core_model::{
    Color, FontFace, FontSize, RunProperties, ThemeColorSlot, ThemeFontSlot, Underline,
    VerticalAlign,
};
use serde::{Deserialize, Serialize};

use crate::block::{Block, NodeId};
use crate::document::Document;
use crate::props::{
    Alignment, BorderSide, BorderStyle, CellMargins, CellProperties, Indent, LineSpacing,
    ParagraphBorders, ParagraphProperties, Spacing, TabKind, TabLeader, TabStop, TableBorders,
    TableProperties,
};

/// Kind of a style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum StyleKind {
    /// Paragraph style (may also carry run formatting).
    Paragraph,
    /// Character style.
    Character,
    /// A paragraph style linked to a character style ([`Style::link`]):
    /// applied to whole paragraphs it acts as a paragraph style, to part of
    /// a paragraph as its character style (Word's "Linked (paragraph and
    /// character)"). Written to docx as `w:type="paragraph"` with
    /// `w:link`.
    Linked,
    /// Table style.
    Table,
    /// Numbering (list) style; kept, not applied.
    Numbering,
}

impl StyleKind {
    /// Paragraph and linked styles (applied to paragraphs).
    pub fn is_paragraph(self) -> bool {
        matches!(self, StyleKind::Paragraph | StyleKind::Linked)
    }

    /// The kind whose default style this kind shares and whose styles it
    /// may be based on (linked styles are paragraph styles).
    pub fn family(self) -> StyleKind {
        match self {
            StyleKind::Linked => StyleKind::Paragraph,
            k => k,
        }
    }

    /// The docx `w:type`.
    pub fn docx_type(self) -> &'static str {
        match self {
            StyleKind::Paragraph | StyleKind::Linked => "paragraph",
            StyleKind::Character => "character",
            StyleKind::Table => "table",
            StyleKind::Numbering => "numbering",
        }
    }
}

/// A named style (docx `w:style`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Style {
    /// Style id, referenced by [`ParagraphProperties::style`] (e.g. `"Heading1"`).
    pub id: String,
    /// Display name (e.g. `"heading 1"`, as Word stores it).
    pub name: String,
    /// Kind.
    pub kind: StyleKind,
    /// Parent style id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub based_on: Option<String>,
    /// Style of the paragraph created after this one (`None` = the same).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// The linked style: the character style of a linked paragraph style,
    /// or the paragraph style of such a character style (docx `w:link`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub link: Option<String>,
    /// Paragraph formatting of the style.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
    /// Run formatting of the style.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
    /// Whether this is the default style of its kind.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_default: bool,
    /// Table formatting of a table style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub table: Option<TableStyle>,
    /// Shown in the Styles gallery (docx `w:qFormat`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub quick_format: bool,
    /// Sort priority in the style lists (docx `w:uiPriority`; `None` =
    /// last).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub priority: Option<u32>,
    /// Never shown in the UI (docx `w:hidden`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    /// Shown only in "All styles" lists (docx `w:semiHidden`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub semi_hidden: bool,
    /// `semi_hidden` ends once the style is used (docx `w:unhideWhenUsed`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unhide_when_used: bool,
    /// A user-defined style (docx `w:customStyle`); built-in styles
    /// cannot be deleted.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom: bool,
    /// Word's "Automatically update" (docx `w:autoRedefine`; stored, not
    /// acted on).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub auto_redefine: bool,
}

/// Lower-case names of Word's built-in styles (docx stores built-in names
/// in English whatever the UI language).
const BUILTIN_NAMES: &[&str] = &[
    "normal",
    "no spacing",
    "title",
    "subtitle",
    "quote",
    "intense quote",
    "list paragraph",
    "caption",
    "header",
    "footer",
    "footnote text",
    "footnote reference",
    "endnote text",
    "endnote reference",
    "hyperlink",
    "followedhyperlink",
    "strong",
    "emphasis",
    "subtle emphasis",
    "intense emphasis",
    "subtle reference",
    "intense reference",
    "book title",
    "default paragraph font",
    "no list",
    "normal table",
    "table grid",
    "toc heading",
    "balloon text",
    "plain text",
    "list bullet",
    "list number",
];

/// Whether `name` (any case) is the name of a built-in Word style.
pub fn is_builtin_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    if BUILTIN_NAMES.contains(&n.as_str()) {
        return true;
    }
    let numbered = |prefix: &str| {
        n.strip_prefix(prefix)
            .is_some_and(|d| d.len() == 1 && matches!(d.as_bytes()[0], b'1'..=b'9'))
    };
    numbered("heading ") || numbered("toc ")
}

/// The part of a table to which a [`ConditionalFormat`] applies (docx
/// `w:tblStylePr/@w:type`), in increasing priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum ConditionalKind {
    /// The whole table.
    WholeTable,
    /// Odd column bands.
    Band1Vert,
    /// Even column bands.
    Band2Vert,
    /// Odd row bands.
    Band1Horz,
    /// Even row bands.
    Band2Horz,
    /// The header row.
    FirstRow,
    /// The total row.
    LastRow,
    /// The first column.
    FirstCol,
    /// The last column.
    LastCol,
    /// Top right cell.
    NeCell,
    /// Top left cell.
    NwCell,
    /// Bottom right cell.
    SeCell,
    /// Bottom left cell.
    SwCell,
}

impl ConditionalKind {
    /// The docx name (`firstRow`, `band1Horz`, …).
    pub fn docx_name(self) -> &'static str {
        use ConditionalKind::*;
        match self {
            WholeTable => "wholeTable",
            Band1Vert => "band1Vert",
            Band2Vert => "band2Vert",
            Band1Horz => "band1Horz",
            Band2Horz => "band2Horz",
            FirstCol => "firstCol",
            LastCol => "lastCol",
            FirstRow => "firstRow",
            LastRow => "lastRow",
            NeCell => "neCell",
            NwCell => "nwCell",
            SeCell => "seCell",
            SwCell => "swCell",
        }
    }

    /// Parses a docx name.
    pub fn from_docx(name: &str) -> Option<Self> {
        use ConditionalKind::*;
        [
            WholeTable, Band1Vert, Band2Vert, Band1Horz, Band2Horz, FirstRow, LastRow, FirstCol,
            LastCol, NeCell, NwCell, SeCell, SwCell,
        ]
        .into_iter()
        .find(|k| k.docx_name() == name)
    }
}

/// Formatting a table style applies to one part of the table (docx
/// `w:tblStylePr`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct ConditionalFormat {
    /// The part of the table.
    pub kind: ConditionalKind,
    /// Paragraph formatting of the text in that part.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
    /// Character formatting of the text in that part.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(
        feature = "ts",
        ts(as = "Option<app_common::wire::RunProperties>", optional)
    )]
    pub run: RunProperties,
    /// Cell formatting of that part. Its borders describe the part as a
    /// whole: `top`/`bottom`/`left`/`right` on the part's outer edges,
    /// `insideH`/`insideV` between its cells.
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub cell: CellProperties,
}

/// Table formatting of a table style (docx `w:tblPr`, `w:tcPr` and
/// `w:tblStylePr` of a `w:style w:type="table"`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TableStyle {
    /// Table properties (borders, cell margins, alignment, indent; the
    /// `style`, `look`, widths and grid are not used).
    #[serde(default, skip_serializing_if = "TableProperties::is_empty")]
    pub table: TableProperties,
    /// Cell properties of every cell.
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub cell: CellProperties,
    /// Rows per band (docx `w:tblStyleRowBandSize`, `None` = 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub row_band_size: Option<u8>,
    /// Columns per band (docx `w:tblStyleColBandSize`, `None` = 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub col_band_size: Option<u8>,
    /// Conditional formats, in file order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional: Vec<ConditionalFormat>,
}

impl TableStyle {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// The conditional format of `kind`.
    pub fn conditional(&self, kind: ConditionalKind) -> Option<&ConditionalFormat> {
        self.conditional.iter().find(|c| c.kind == kind)
    }
}

impl Style {
    /// A style of `kind` with nothing set (no parent, no flags).
    pub fn new(id: &str, name: &str, kind: StyleKind) -> Self {
        Self {
            id: id.to_owned(),
            name: name.to_owned(),
            kind,
            based_on: None,
            next: None,
            link: None,
            paragraph: ParagraphProperties::default(),
            run: RunProperties::default(),
            is_default: false,
            table: (kind == StyleKind::Table).then(TableStyle::default),
            quick_format: false,
            priority: None,
            hidden: false,
            semi_hidden: false,
            unhide_when_used: false,
            custom: false,
            auto_redefine: false,
        }
    }

    /// A paragraph style based on `Normal` with `next = Normal`.
    fn paragraph(id: &str, name: &str) -> Self {
        Self {
            based_on: Some("Normal".to_owned()),
            next: Some("Normal".to_owned()),
            ..Self::new(id, name, StyleKind::Paragraph)
        }
    }

    /// A character style based on `Default Paragraph Font`.
    fn character(id: &str, name: &str, priority: u32) -> Self {
        Self {
            based_on: Some("DefaultParagraphFont".to_owned()),
            priority: Some(priority),
            ..Self::new(id, name, StyleKind::Character)
        }
    }

    /// A table style based on `TableNormal`.
    fn table(id: &str, name: &str) -> Self {
        Self {
            based_on: Some("TableNormal".to_owned()),
            ..Self::new(id, name, StyleKind::Table)
        }
    }

    /// Whether this is one of Word's built-in styles (not user-defined and
    /// named like a built-in style). Built-in styles cannot be deleted.
    pub fn is_builtin(&self) -> bool {
        !self.custom && is_builtin_name(&self.name)
    }
}

/// Why a [`StyleSheet`] operation was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StyleError {
    /// No style has this id.
    #[error("unknown style {0:?}")]
    Unknown(String),
    /// The id is already used by another style.
    #[error("a style with id {0:?} already exists")]
    DuplicateId(String),
    /// The display name is already used by another style.
    #[error("a style named {0:?} already exists")]
    DuplicateName(String),
    /// An empty name or id.
    #[error("a style needs a non-empty id and name")]
    EmptyName,
    /// Built-in styles cannot be deleted.
    #[error("the built-in style {0:?} cannot be deleted")]
    BuiltIn(String),
    /// `based_on` would make the style inherit from itself.
    #[error("style {0:?} cannot be based on {1:?}: that would be a loop")]
    Cycle(String, String),
    /// A referenced style has the wrong kind.
    #[error("style {0:?} is not a {1} style")]
    WrongKind(String, &'static str),
}

/// Changes to a style for [`StyleSheet::update`]; absent fields keep their
/// value. In `basedOn`, `next` and `link` an empty string removes the
/// reference. Formatting merges into the style's (field by field, like
/// direct formatting) unless `replaceFormatting` is set, in which case the
/// given `paragraph` / `run` replace the style's.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct StylePatch {
    /// New display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub name: Option<String>,
    /// New parent (`""` = none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub based_on: Option<String>,
    /// New style for the following paragraph (`""` = the same style).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub next: Option<String>,
    /// Paragraph formatting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub paragraph: Option<ParagraphProperties>,
    /// Character formatting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(
        feature = "ts",
        ts(as = "Option<app_common::wire::RunProperties>", optional)
    )]
    pub run: Option<RunProperties>,
    /// Replace instead of merge the given formatting.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replace_formatting: bool,
    /// Show in the Styles gallery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub quick_format: Option<bool>,
    /// Hide from the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub hidden: Option<bool>,
    /// Show only in "All styles".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub semi_hidden: Option<bool>,
    /// Word's "Automatically update".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub auto_redefine: Option<bool>,
    /// Sort priority.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub priority: Option<u32>,
}

impl StylePatch {
    /// Returns `true` if the patch changes nothing.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Document-wide default formatting (docx `w:docDefaults`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Defaults {
    /// Default run formatting.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
    /// Default paragraph formatting.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
}

/// The document's styles (docx `styles.xml`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct StyleSheet {
    /// Document defaults, applied below every style.
    #[serde(default)]
    pub defaults: Defaults,
    /// Styles in document order; ids are unique.
    #[serde(default)]
    pub styles: Vec<Style>,
}

impl StyleSheet {
    /// The style with id `id`.
    pub fn get(&self, id: &str) -> Option<&Style> {
        self.styles.iter().find(|s| s.id == id)
    }

    /// Mutable access to the style with id `id`.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut Style> {
        self.styles.iter_mut().find(|s| s.id == id)
    }

    /// The style named `name` (case-insensitive, as Word compares names).
    pub fn find_by_name(&self, name: &str) -> Option<&Style> {
        self.styles
            .iter()
            .find(|s| s.name.eq_ignore_ascii_case(name.trim()))
    }

    /// Inserts `style`, replacing (in place) a style with the same id.
    /// Returns the replaced style. Unlike [`add`](Self::add) nothing is
    /// validated.
    pub fn insert(&mut self, style: Style) -> Option<Style> {
        match self.get_mut(&style.id) {
            Some(slot) => Some(std::mem::replace(slot, style)),
            None => {
                self.styles.push(style);
                None
            }
        }
    }

    /// The default style of `kind`'s family (the first with `is_default`;
    /// a linked style can be the default paragraph style).
    pub fn default_style(&self, kind: StyleKind) -> Option<&Style> {
        let family = kind.family();
        self.styles
            .iter()
            .find(|s| s.kind.family() == family && s.is_default)
    }

    /// The `based_on` chain of `style_id`, root first, ending with the
    /// style itself. Stops at missing parents and at cycles.
    fn chain(&self, style_id: &str) -> Vec<&Style> {
        let mut chain: Vec<&Style> = Vec::new();
        let mut next = self.get(style_id);
        while let Some(style) = next {
            if chain.iter().any(|s| s.id == style.id) {
                break;
            }
            chain.push(style);
            next = style.based_on.as_deref().and_then(|id| self.get(id));
        }
        chain.reverse();
        chain
    }

    /// The ids of the `based_on` chain of `style_id`, the style itself
    /// first, then its parent, … (for "Based on" displays and cycle
    /// checks).
    pub fn ancestors(&self, style_id: &str) -> Vec<String> {
        self.chain(style_id)
            .into_iter()
            .rev()
            .map(|s| s.id.clone())
            .collect()
    }

    /// Effective paragraph formatting of a style: document defaults overlaid
    /// with every style of the `based_on` chain, root first. An unknown id
    /// yields the defaults. Cycles in `based_on` are cut. The result's
    /// `style` field is `style_id` if the style exists.
    pub fn resolve_paragraph(&self, style_id: &str) -> ParagraphProperties {
        let mut out = self.defaults.paragraph.clone();
        let chain = self.chain(style_id);
        for style in &chain {
            out.apply(&style.paragraph);
        }
        out.style = (!chain.is_empty()).then(|| style_id.to_owned());
        out.strip_cleared_tabs();
        out
    }

    /// Effective run formatting of a style: document defaults overlaid with
    /// the run formatting of every style of the `based_on` chain.
    pub fn resolve_run(&self, style_id: &str) -> RunProperties {
        let mut out = self.defaults.run.clone();
        for style in self.chain(style_id) {
            out.apply(&style.run);
        }
        out
    }

    /// The run formatting a character style adds on top of the paragraph:
    /// its `based_on` chain overlaid root first, without document defaults.
    /// A linked paragraph style contributes through its character style.
    /// Unknown ids add nothing.
    pub fn resolve_character(&self, style_id: &str) -> RunProperties {
        let id = match self.get(style_id) {
            Some(s) if s.kind == StyleKind::Linked => s.link.as_deref().unwrap_or(style_id),
            _ => style_id,
        };
        let mut out = RunProperties::default();
        for style in self.chain(id) {
            out.apply(&style.run);
        }
        out
    }

    /// An unused style id derived from `name` (letters and digits only,
    /// like Word: "My Style" → `MyStyle`, then `MyStyle1`, …).
    pub fn unique_id(&self, name: &str) -> String {
        let base: String = name.chars().filter(|c| c.is_alphanumeric()).collect();
        let base = if base.is_empty() {
            "Style".to_owned()
        } else {
            base
        };
        if self.get(&base).is_none() {
            return base;
        }
        (1..)
            .map(|n| format!("{base}{n}"))
            .find(|id| self.get(id).is_none())
            .unwrap_or(base)
    }

    fn check_name(&self, name: &str, own: Option<&str>) -> Result<(), StyleError> {
        if name.trim().is_empty() {
            return Err(StyleError::EmptyName);
        }
        match self.find_by_name(name) {
            Some(s) if Some(s.id.as_str()) != own => {
                Err(StyleError::DuplicateName(name.to_owned()))
            }
            _ => Ok(()),
        }
    }

    /// Checks that `id` may be based on `parent`: it exists, has the same
    /// family, and does not inherit from `id`.
    fn check_parent(&self, id: &str, kind: StyleKind, parent: &str) -> Result<(), StyleError> {
        let p = self
            .get(parent)
            .ok_or_else(|| StyleError::Unknown(parent.to_owned()))?;
        if p.kind.family() != kind.family() {
            return Err(StyleError::WrongKind(parent.to_owned(), family_name(kind)));
        }
        if self.ancestors(parent).iter().any(|a| a == id) {
            return Err(StyleError::Cycle(id.to_owned(), parent.to_owned()));
        }
        Ok(())
    }

    fn check_next(&self, next: &str) -> Result<(), StyleError> {
        match self.get(next) {
            None => Err(StyleError::Unknown(next.to_owned())),
            Some(s) if !s.kind.is_paragraph() => {
                Err(StyleError::WrongKind(next.to_owned(), "paragraph"))
            }
            Some(_) => Ok(()),
        }
    }

    /// Adds a new style (Word's "Create a Style" / "New Style"): the id and
    /// the name must be unused, `based_on` must be a style of the same
    /// family, `next` a paragraph style (`link` is not checked, so that the
    /// two halves of a linked style can be added one after the other). A style
    /// marked default becomes the only default of its family.
    pub fn add(&mut self, style: Style) -> Result<(), StyleError> {
        if style.id.is_empty() {
            return Err(StyleError::EmptyName);
        }
        if self.get(&style.id).is_some() {
            return Err(StyleError::DuplicateId(style.id.clone()));
        }
        self.check_name(&style.name, None)?;
        if let Some(p) = &style.based_on {
            self.check_parent(&style.id, style.kind, p)?;
        }
        if let Some(n) = style.next.as_deref().filter(|n| *n != style.id) {
            self.check_next(n)?;
        }
        let (id, kind, default) = (style.id.clone(), style.kind, style.is_default);
        self.styles.push(style);
        if default {
            self.set_default(kind, &id)?;
        }
        Ok(())
    }

    /// Changes a style (Word's "Modify Style"). The kind cannot change. A
    /// linked pair keeps its character formatting in step: the run
    /// formatting of one is copied to the other.
    pub fn update(&mut self, id: &str, patch: &StylePatch) -> Result<(), StyleError> {
        let style = self
            .get(id)
            .ok_or_else(|| StyleError::Unknown(id.to_owned()))?;
        let kind = style.kind;
        if let Some(name) = &patch.name {
            self.check_name(name, Some(id))?;
        }
        if let Some(p) = patch.based_on.as_deref().filter(|p| !p.is_empty()) {
            self.check_parent(id, kind, p)?;
        }
        if let Some(n) = patch.next.as_deref().filter(|n| !n.is_empty() && *n != id) {
            self.check_next(n)?;
        }
        let some = |v: &Option<String>| v.clone().filter(|v| !v.is_empty());
        let style = self.get_mut(id).expect("checked");
        if let Some(name) = &patch.name {
            style.name = name.trim().to_owned();
        }
        if patch.based_on.is_some() {
            style.based_on = some(&patch.based_on);
        }
        if patch.next.is_some() {
            style.next = some(&patch.next);
        }
        if let Some(p) = &patch.paragraph {
            let mut p = p.clone();
            p.style = None;
            p.section_end = None;
            if patch.replace_formatting {
                style.paragraph = p;
            } else {
                style.paragraph.apply(&p);
            }
        }
        if let Some(r) = &patch.run {
            if patch.replace_formatting {
                style.run = r.clone();
            } else {
                style.run.apply(r);
            }
        }
        for (flag, value) in [
            (&mut style.quick_format, patch.quick_format),
            (&mut style.hidden, patch.hidden),
            (&mut style.semi_hidden, patch.semi_hidden),
            (&mut style.auto_redefine, patch.auto_redefine),
        ] {
            if let Some(v) = value {
                *flag = v;
            }
        }
        if patch.priority.is_some() {
            style.priority = patch.priority;
        }
        if patch.run.is_some() {
            let (run, link) = (style.run.clone(), style.link.clone());
            if let Some(partner) = link.and_then(|l| self.get_mut(&l)) {
                if partner.link.as_deref() == Some(id) {
                    partner.run = run;
                }
            }
        }
        Ok(())
    }

    /// Changes the display name of a style (the id stays, so paragraphs
    /// keep referring to it). Built-in styles get Word's alias treatment:
    /// they may be renamed too.
    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), StyleError> {
        self.update(
            id,
            &StylePatch {
                name: Some(name.to_owned()),
                ..Default::default()
            },
        )
    }

    /// Makes `id` the default style of its family (the others lose the
    /// flag).
    pub fn set_default(&mut self, kind: StyleKind, id: &str) -> Result<(), StyleError> {
        let style = self
            .get(id)
            .ok_or_else(|| StyleError::Unknown(id.to_owned()))?;
        if style.kind.family() != kind.family() {
            return Err(StyleError::WrongKind(id.to_owned(), family_name(kind)));
        }
        for s in &mut self.styles {
            if s.kind.family() == kind.family() {
                s.is_default = s.id == id;
            }
        }
        Ok(())
    }

    /// Removes a user-defined style (Word: built-in styles cannot be
    /// deleted, nor the default style of a kind). Styles based on it are
    /// re-based on its parent, `next` references to it are dropped, and the
    /// character half of a linked style is removed with it (Word deletes
    /// both halves; deleting just a character half unlinks its paragraph
    /// style). Returns the removed styles, the style itself first.
    /// See [`Document::delete_style`] for re-pointing the content.
    pub fn delete(&mut self, id: &str) -> Result<Vec<Style>, StyleError> {
        let style = self
            .get(id)
            .ok_or_else(|| StyleError::Unknown(id.to_owned()))?;
        if style.is_builtin() || style.is_default {
            return Err(StyleError::BuiltIn(style.name.clone()));
        }
        let mut ids = vec![id.to_owned()];
        if let Some(partner) = style
            .link
            .as_deref()
            .filter(|_| style.kind == StyleKind::Linked)
            .and_then(|l| self.get(l))
            .filter(|p| p.link.as_deref() == Some(id) && !p.is_builtin() && !p.is_default)
        {
            ids.push(partner.id.clone());
        }
        let mut removed = Vec::new();
        for rid in &ids {
            let Some(i) = self.styles.iter().position(|s| &s.id == rid) else {
                continue;
            };
            let gone = self.styles.remove(i);
            for s in &mut self.styles {
                if s.based_on.as_deref() == Some(rid.as_str()) {
                    s.based_on.clone_from(&gone.based_on);
                }
                if s.next.as_deref() == Some(rid.as_str()) {
                    s.next = None;
                }
                if s.link.as_deref() == Some(rid.as_str()) {
                    s.link = None;
                    if s.kind == StyleKind::Linked {
                        s.kind = StyleKind::Paragraph;
                    }
                }
            }
            removed.push(gone);
        }
        Ok(removed)
    }

    /// Word 2016+'s default style set: Normal and the quick-style gallery
    /// (No Spacing, Heading 1–9, Title, Subtitle, Subtle/Intense Emphasis,
    /// Emphasis, Strong, Quote, Intense Quote, Subtle/Intense Reference,
    /// Book Title, List Paragraph), Caption, Hyperlink, Header/Footer,
    /// Footnote Text/Reference, TOC 1–3, the character halves of the
    /// linked styles, Default Paragraph Font, No List and the table styles;
    /// document defaults Calibri (minor theme font) 11 pt, 8 pt after,
    /// 1.08 line spacing. Values follow Word's look with theme fonts and
    /// accent colours.
    pub fn office_defaults() -> Self {
        let major = Some(FontFace::Theme(ThemeFontSlot::MajorLatin));
        let theme_c = |slot, tint| Some(Color::Theme { slot, tint });
        // themeShade BF / 7F on accent1 = tint -0.25 / -0.5 (2F5496 / 1F3763).
        let accent1 = theme_c(ThemeColorSlot::Accent1, 0.0);
        let accent1_dark = theme_c(ThemeColorSlot::Accent1, -0.25);
        let accent1_darker = theme_c(ThemeColorSlot::Accent1, -0.5);
        // text1 lightened: themeTint D8 / BF / A5 (272727 / 404040 / 5A5A5A).
        let text1 = |tint| theme_c(ThemeColorSlot::Dark1, tint);
        let spacing = |before: Option<i32>, after: Option<i32>, line: Option<LineSpacing>| {
            Some(Spacing {
                before: before.map(Twips),
                after: after.map(Twips),
                line,
            })
        };
        let single = Some(LineSpacing::Multiple(1.0));
        let gallery = |mut s: Style, priority: u32| {
            s.priority = Some(priority);
            s.quick_format = true;
            s
        };
        let mut chars: Vec<Style> = Vec::new();
        // A linked paragraph style and its character half ("Heading 1 Char").
        let mut linked = |mut s: Style| {
            let id = format!("{}Char", s.id);
            s.kind = StyleKind::Linked;
            s.link = Some(id.clone());
            let mut c = Style::character(&id, &format!("{} Char", title_case(&s.name)), 0);
            c.priority = s.priority;
            c.link = Some(s.id.clone());
            c.custom = true;
            c.run = s.run.clone();
            c.semi_hidden = s.semi_hidden;
            chars.push(c);
            s
        };

        let mut normal = gallery(Style::new("Normal", "Normal", StyleKind::Paragraph), 0);
        normal.is_default = true;
        normal.priority = None; // Word writes none for Normal (= 0)
        let mut no_spacing = gallery(
            Style::new("NoSpacing", "No Spacing", StyleKind::Paragraph),
            1,
        );
        no_spacing.paragraph.spacing = spacing(None, Some(0), single);

        let heading = |level: u8, before: i32, size: Option<f64>, color: Option<Color>| {
            let mut s = gallery(
                Style::paragraph(&format!("Heading{level}"), &format!("heading {level}")),
                9,
            );
            s.unhide_when_used = level > 1;
            s.paragraph.spacing = spacing(Some(before), Some(0), None);
            s.paragraph.keep_next = Some(true);
            s.run = RunProperties {
                font: major.clone(),
                size: size.map(FontSize::from_pt),
                color,
                ..Default::default()
            };
            s
        };
        let mut headings = vec![
            heading(1, 240, Some(16.0), accent1_dark),
            heading(2, 40, Some(13.0), accent1_dark),
            heading(3, 40, Some(12.0), accent1_darker),
            heading(4, 40, None, accent1_dark),
            heading(5, 40, None, accent1_dark),
            heading(6, 40, None, accent1_darker),
            heading(7, 40, None, accent1_darker),
            heading(8, 40, Some(10.5), text1(0.15)),
            heading(9, 40, Some(10.5), text1(0.15)),
        ];
        for i in [3, 6, 8] {
            headings[i].run.italic = Some(true);
        }
        let headings: Vec<Style> = headings.into_iter().map(&mut linked).collect();

        let mut title = gallery(Style::paragraph("Title", "Title"), 10);
        title.paragraph.spacing = spacing(None, Some(0), single);
        title.run = RunProperties {
            font: major.clone(),
            size: Some(FontSize::from_pt(28.0)),
            ..Default::default()
        };
        let title = linked(title);
        let mut subtitle = gallery(Style::paragraph("Subtitle", "Subtitle"), 11);
        subtitle.run.color = text1(0.35);
        let subtitle = linked(subtitle);

        let char_style = |id: &str, name: &str, priority: u32, run: RunProperties| {
            let mut s = gallery(Style::character(id, name, priority), priority);
            s.run = run;
            s
        };
        let italic = RunProperties {
            italic: Some(true),
            ..Default::default()
        };
        let subtle_emphasis = char_style(
            "SubtleEmphasis",
            "Subtle Emphasis",
            19,
            RunProperties {
                color: text1(0.25),
                ..italic.clone()
            },
        );
        let emphasis = char_style("Emphasis", "Emphasis", 20, italic.clone());
        let intense_emphasis = char_style(
            "IntenseEmphasis",
            "Intense Emphasis",
            21,
            RunProperties {
                color: accent1,
                ..italic.clone()
            },
        );
        let strong = char_style(
            "Strong",
            "Strong",
            22,
            RunProperties {
                bold: Some(true),
                ..Default::default()
            },
        );
        let quote_indent = Some(Indent {
            left: Some(Twips(864)),
            right: Some(Twips(864)),
            ..Default::default()
        });
        let mut quote = gallery(Style::paragraph("Quote", "Quote"), 29);
        quote.paragraph.spacing = spacing(Some(200), Some(160), None);
        quote.paragraph.indent = quote_indent;
        quote.paragraph.alignment = Some(Alignment::Center);
        quote.run = RunProperties {
            color: text1(0.25),
            ..italic.clone()
        };
        let quote = linked(quote);
        let mut intense_quote = gallery(Style::paragraph("IntenseQuote", "Intense Quote"), 30);
        intense_quote.paragraph.spacing = spacing(Some(360), Some(360), None);
        intense_quote.paragraph.indent = quote_indent;
        intense_quote.paragraph.alignment = Some(Alignment::Center);
        let rule = BorderSide {
            space: Some(10),
            ..BorderSide::new(
                BorderStyle::Single,
                BorderSide::width_from_eighths(4),
                theme(ThemeColorSlot::Accent1, 0.0),
            )
        };
        intense_quote.paragraph.borders = Some(ParagraphBorders {
            top: Some(rule),
            bottom: Some(rule),
            ..Default::default()
        });
        intense_quote.run = RunProperties {
            color: accent1,
            ..italic.clone()
        };
        let intense_quote = linked(intense_quote);
        let subtle_reference = char_style(
            "SubtleReference",
            "Subtle Reference",
            31,
            RunProperties {
                color: text1(0.35),
                ..Default::default()
            },
        );
        let intense_reference = char_style(
            "IntenseReference",
            "Intense Reference",
            32,
            RunProperties {
                bold: Some(true),
                color: accent1,
                ..Default::default()
            },
        );
        let book_title = char_style(
            "BookTitle",
            "Book Title",
            33,
            RunProperties {
                bold: Some(true),
                italic: Some(true),
                ..Default::default()
            },
        );
        let mut list = gallery(Style::paragraph("ListParagraph", "List Paragraph"), 34);
        list.next = None;
        list.paragraph.indent = Some(Indent {
            left: Some(Twips(720)),
            ..Default::default()
        });

        let mut caption = gallery(Style::paragraph("Caption", "caption"), 35);
        caption.unhide_when_used = true;
        caption.paragraph.spacing = spacing(None, Some(200), single);
        caption.run = RunProperties {
            italic: Some(true),
            size: Some(FontSize::from_pt(9.0)),
            color: theme_c(ThemeColorSlot::Dark2, 0.0),
            ..Default::default()
        };
        let hidden_until_used = |mut s: Style, priority: u32| {
            s.priority = Some(priority);
            s.semi_hidden = true;
            s.unhide_when_used = true;
            s
        };
        let mut hyperlink = hidden_until_used(Style::character("Hyperlink", "Hyperlink", 99), 99);
        hyperlink.semi_hidden = false;
        hyperlink.run = RunProperties {
            color: theme_c(ThemeColorSlot::Hyperlink, 0.0),
            underline: Some(Underline::Single),
            ..Default::default()
        };
        let header_footer = |id: &str, name: &str| {
            let mut s = hidden_until_used(Style::paragraph(id, name), 99);
            s.semi_hidden = false;
            s.next = None;
            s.paragraph.spacing = spacing(None, Some(0), single);
            s.paragraph.tabs = vec![
                TabStop {
                    pos: Twips(4680),
                    kind: TabKind::Center,
                    leader: TabLeader::None,
                },
                TabStop {
                    pos: Twips(9360),
                    kind: TabKind::Right,
                    leader: TabLeader::None,
                },
            ];
            s
        };
        let header = linked(header_footer("Header", "header"));
        let footer = linked(header_footer("Footer", "footer"));
        let mut footnote_text =
            hidden_until_used(Style::paragraph("FootnoteText", "footnote text"), 99);
        footnote_text.next = None;
        footnote_text.paragraph.spacing = spacing(None, Some(0), single);
        footnote_text.run.size = Some(FontSize::from_half_points(20));
        let footnote_text = linked(footnote_text);
        let mut footnote_ref = hidden_until_used(
            Style::character("FootnoteReference", "footnote reference", 99),
            99,
        );
        footnote_ref.run.vertical_align = Some(VerticalAlign::Superscript);
        let toc = |level: u8| {
            let mut s = hidden_until_used(
                Style::paragraph(&format!("TOC{level}"), &format!("toc {level}")),
                39,
            );
            s.semi_hidden = false;
            s.auto_redefine = true;
            s.paragraph.spacing = spacing(None, Some(100), None);
            s.paragraph.indent = (level > 1).then(|| Indent {
                left: Some(Twips(220 * (i32::from(level) - 1))),
                ..Default::default()
            });
            s
        };
        let mut dpf = hidden_until_used(
            Style::new(
                "DefaultParagraphFont",
                "Default Paragraph Font",
                StyleKind::Character,
            ),
            1,
        );
        dpf.is_default = true;
        let mut no_list =
            hidden_until_used(Style::new("NoList", "No List", StyleKind::Numbering), 99);
        no_list.is_default = true;

        let mut styles = vec![normal];
        styles.extend(headings);
        styles.extend([
            dpf,
            no_spacing,
            title,
            subtitle,
            subtle_emphasis,
            emphasis,
            intense_emphasis,
            strong,
            quote,
            intense_quote,
            subtle_reference,
            intense_reference,
            book_title,
            list,
            caption,
            hyperlink,
            header,
            footer,
            footnote_text,
            footnote_ref,
            toc(1),
            toc(2),
            toc(3),
        ]);
        styles.extend(chars);
        styles.extend(table_styles());
        styles.push(no_list);

        Self {
            defaults: Defaults {
                run: RunProperties {
                    font: Some(FontFace::Theme(ThemeFontSlot::MinorLatin)),
                    size: Some(FontSize::from_pt(11.0)),
                    ..Default::default()
                },
                paragraph: ParagraphProperties {
                    spacing: Some(Spacing {
                        before: None,
                        after: Some(Twips(160)),
                        line: Some(LineSpacing::from_240ths(259)),
                    }),
                    ..Default::default()
                },
            },
            styles,
        }
    }

    /// The effective table formatting of table style `style_id`: the
    /// [`TableStyle`]s of its `based_on` chain overlaid root first
    /// (properties merge field by field, conditional formats of the same
    /// kind merge too). `None` if the style does not exist.
    pub fn resolve_table_style(&self, style_id: &str) -> Option<TableStyle> {
        let chain = self.chain(style_id);
        if chain.is_empty() {
            return None;
        }
        let mut out = TableStyle::default();
        for s in chain {
            let Some(t) = &s.table else { continue };
            out.table = merge_table_props(&out.table, &t.table);
            out.cell = merge_cell_props(&out.cell, &t.cell);
            out.row_band_size = t.row_band_size.or(out.row_band_size);
            out.col_band_size = t.col_band_size.or(out.col_band_size);
            for c in &t.conditional {
                match out.conditional.iter_mut().find(|o| o.kind == c.kind) {
                    Some(o) => {
                        o.paragraph.apply(&c.paragraph);
                        o.run.apply(&c.run);
                        o.cell = merge_cell_props(&o.cell, &c.cell);
                    }
                    None => out.conditional.push(c.clone()),
                }
            }
        }
        Some(out)
    }
}

/// Calls `f` on every paragraph of `blocks` (table cells included).
fn each_paragraph_mut(blocks: &mut [Block], f: &mut impl FnMut(&mut crate::block::Paragraph)) {
    for b in blocks {
        match b {
            Block::Paragraph(p) => f(p),
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    each_paragraph_mut(&mut cell.blocks, f);
                }
            }
            Block::Toc(_) => {}
        }
    }
}

/// Calls `f` on every table of `blocks` (nested ones included).
fn each_table_mut(blocks: &mut [Block], f: &mut impl FnMut(&mut crate::block::Table)) {
    for b in blocks {
        if let Block::Table(t) = b {
            f(t);
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                each_table_mut(&mut cell.blocks, f);
            }
        }
    }
}

impl Document {
    /// Deletes a style ([`StyleSheet::delete`]) and re-points the content:
    /// paragraphs that used it (or its linked half) get `replacement`
    /// (`None` or the default paragraph style = no direct style), runs
    /// lose a deleted character style, tables a deleted table style.
    /// `replacement` must be a paragraph style that survives. Returns the
    /// ids of the changed paragraphs and tables (all containers).
    pub fn delete_style(
        &mut self,
        id: &str,
        replacement: Option<&str>,
    ) -> Result<Vec<NodeId>, StyleError> {
        let replacement = replacement.filter(|r| !r.is_empty());
        if let Some(r) = replacement {
            match self.styles.get(r) {
                None => return Err(StyleError::Unknown(r.to_owned())),
                Some(s) if !s.kind.is_paragraph() => {
                    return Err(StyleError::WrongKind(r.to_owned(), "paragraph"))
                }
                Some(_) if r == id => return Err(StyleError::Unknown(r.to_owned())),
                Some(_) => {}
            }
        }
        let mut sheet = self.styles.clone();
        let removed = sheet.delete(id)?;
        if replacement.is_some_and(|r| removed.iter().any(|s| s.id == r)) {
            return Err(StyleError::Unknown(
                replacement.unwrap_or_default().to_owned(),
            ));
        }
        self.styles = sheet;
        let gone: Vec<&str> = removed.iter().map(|s| s.id.as_str()).collect();
        let default = self
            .styles
            .default_style(StyleKind::Paragraph)
            .map(|s| s.id.clone());
        let new_style = replacement
            .filter(|r| default.as_deref() != Some(*r))
            .map(str::to_owned);
        let mut changed = Vec::new();
        for c in self.containers_mut() {
            each_paragraph_mut(c, &mut |p| {
                let mut hit = false;
                if p.props.style.as_deref().is_some_and(|s| gone.contains(&s)) {
                    p.props.style.clone_from(&new_style);
                    hit = true;
                }
                for inline in &mut p.inlines {
                    if let crate::inline::Inline::Run(r) = inline {
                        if r.style.as_deref().is_some_and(|s| gone.contains(&s)) {
                            r.style = None;
                            hit = true;
                        }
                    }
                }
                if hit {
                    changed.push(p.id);
                }
            });
            each_table_mut(c, &mut |t| {
                if t.props.style.as_deref().is_some_and(|s| gone.contains(&s)) {
                    t.props.style = None;
                    changed.push(t.id);
                }
            });
        }
        Ok(changed)
    }

    /// The paragraphs (all containers, table cells included) that use
    /// style `id`: as their paragraph style (the default paragraph style
    /// also matches paragraphs without a style), or, for a character or
    /// linked style, in one of their runs; for a table style the tables.
    /// In document order (body, notes, headers and footers).
    pub fn blocks_with_style(&self, id: &str) -> Vec<NodeId> {
        let Some(style) = self.styles.get(id) else {
            return Vec::new();
        };
        let default = self
            .styles
            .default_style(StyleKind::Paragraph)
            .map(|s| s.id.as_str());
        let char_ids: Vec<&str> = match style.kind {
            StyleKind::Character => vec![id],
            StyleKind::Linked => style.link.as_deref().into_iter().chain([id]).collect(),
            _ => Vec::new(),
        };
        let mut out = Vec::new();
        fn walk<'a>(blocks: &'a [Block], f: &mut impl FnMut(&'a Block)) {
            for b in blocks {
                f(b);
                if let Block::Table(t) = b {
                    for cell in t.rows.iter().flat_map(|r| &r.cells) {
                        walk(&cell.blocks, f);
                    }
                }
            }
        }
        for c in self.containers() {
            walk(c, &mut |b| match b {
                Block::Paragraph(p) => {
                    let ps = p.props.style.as_deref().or(default);
                    let para_hit = style.kind.is_paragraph() && ps == Some(id);
                    let run_hit = !char_ids.is_empty()
                        && p.inlines.iter().any(|i| {
                            matches!(i, crate::inline::Inline::Run(r)
                                if r.style.as_deref().is_some_and(|s| char_ids.contains(&s)))
                        });
                    if para_hit || run_hit {
                        out.push(p.id);
                    }
                }
                Block::Table(t) => {
                    if style.kind == StyleKind::Table && t.props.style.as_deref() == Some(id) {
                        out.push(t.id);
                    }
                }
                Block::Toc(_) => {}
            });
        }
        out
    }

    /// How often each style is used: paragraphs per paragraph style (the
    /// default style counting unstyled paragraphs), paragraphs with runs
    /// per character style, tables per table style. Styles not in use are
    /// absent.
    pub fn style_usage(&self) -> std::collections::BTreeMap<String, usize> {
        let mut out = std::collections::BTreeMap::new();
        for s in &self.styles.styles {
            let n = self.blocks_with_style(&s.id).len();
            if n > 0 {
                out.insert(s.id.clone(), n);
            }
        }
        out
    }
}

/// The name of a kind's family for error messages.
fn family_name(kind: StyleKind) -> &'static str {
    match kind.family() {
        StyleKind::Paragraph | StyleKind::Linked => "paragraph",
        StyleKind::Character => "character",
        StyleKind::Table => "table",
        StyleKind::Numbering => "numbering",
    }
}

/// "heading 1" → "Heading 1" (Word's names of the character halves of
/// linked styles).
fn title_case(name: &str) -> String {
    name.split(' ')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().chain(c).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `base` overlaid with `over` (the table-style relevant fields).
pub(crate) fn merge_table_props(base: &TableProperties, over: &TableProperties) -> TableProperties {
    TableProperties {
        width: over.width.or(base.width),
        col_widths: if over.col_widths.is_empty() {
            base.col_widths.clone()
        } else {
            over.col_widths.clone()
        },
        borders: merge_with(base.borders, over.borders, TableBorders::merged_with),
        cell_margins: merge_with(
            base.cell_margins,
            over.cell_margins,
            CellMargins::merged_with,
        ),
        style: over.style.clone().or_else(|| base.style.clone()),
        look: over.look.or(base.look),
        alignment: over.alignment.or(base.alignment),
        indent: over.indent.or(base.indent),
        layout: over.layout.or(base.layout),
    }
}

/// `base` overlaid with `over`, field by field (borders and margins side
/// by side).
pub(crate) fn merge_cell_props(base: &CellProperties, over: &CellProperties) -> CellProperties {
    CellProperties {
        width: over.width.or(base.width),
        shading: over.shading.or(base.shading),
        borders: merge_with(base.borders, over.borders, TableBorders::merged_with),
        vertical_align: over.vertical_align.or(base.vertical_align),
        margins: merge_with(base.margins, over.margins, CellMargins::merged_with),
    }
}

fn merge_with<T: Copy>(a: Option<T>, b: Option<T>, f: impl Fn(&T, &T) -> T) -> Option<T> {
    match (a, b) {
        (Some(a), Some(b)) => Some(f(&a, &b)),
        (a, b) => b.or(a),
    }
}

/// A theme border of Word's built-in table styles (`sz="4"`, ½ pt).
fn thin(color: Color) -> BorderSide {
    BorderSide::new(
        BorderStyle::Single,
        BorderSide::width_from_eighths(4),
        color,
    )
}

fn theme(slot: ThemeColorSlot, tint: f64) -> Color {
    Color::Theme { slot, tint }
}

/// Word 2016+'s "Normal Table" and the built-in table styles Rusuite
/// offers: Table Grid, Plain Table 1, List Table 3, Grid Table 4 Accent
/// 1–3 (definitions as Word writes them into `styles.xml`).
fn table_styles() -> Vec<Style> {
    use ConditionalKind::*;
    let cond = |kind: ConditionalKind| ConditionalFormat {
        kind,
        paragraph: ParagraphProperties::default(),
        run: RunProperties::default(),
        cell: CellProperties::default(),
    };
    let bold = RunProperties {
        bold: Some(true),
        ..Default::default()
    };
    let bold_cond = |kind| ConditionalFormat {
        run: bold.clone(),
        ..cond(kind)
    };
    let shade = |kind, color: Color| ConditionalFormat {
        cell: CellProperties {
            shading: Some(color),
            ..Default::default()
        },
        ..cond(kind)
    };
    let edges = |top: Option<BorderSide>, left, bottom, right| TableBorders {
        top,
        left,
        bottom,
        right,
        inside_h: None,
        inside_v: None,
    };
    let compact = ParagraphProperties {
        spacing: Some(Spacing {
            before: None,
            after: Some(Twips(0)),
            line: Some(LineSpacing::Multiple(1.0)),
        }),
        ..Default::default()
    };
    let with_borders = |kind, b: TableBorders| ConditionalFormat {
        cell: CellProperties {
            borders: Some(b),
            ..Default::default()
        },
        ..cond(kind)
    };
    let nil = Some(BorderSide::new(BorderStyle::None, Twips(0), Color::Auto));

    let normal = Style {
        is_default: true,
        table: Some(TableStyle {
            table: TableProperties {
                indent: Some(Twips(0)),
                cell_margins: Some(CellMargins {
                    top: Some(Twips(0)),
                    left: Some(Twips(108)),
                    bottom: Some(Twips(0)),
                    right: Some(Twips(108)),
                }),
                ..Default::default()
            },
            ..Default::default()
        }),
        ..Style::new("TableNormal", "Normal Table", StyleKind::Table)
    };

    let mut grid = Style::table("TableGrid", "Table Grid");
    grid.paragraph = compact.clone();
    grid.table = Some(TableStyle {
        table: TableProperties {
            borders: Some(TableBorders::all(thin(Color::Auto))),
            ..Default::default()
        },
        ..Default::default()
    });

    // background1 shade BF / F2
    let grey_line = theme(ThemeColorSlot::Light1, -0.25);
    let grey_fill = theme(ThemeColorSlot::Light1, -0.05);
    let mut plain1 = Style::table("PlainTable1", "Plain Table 1");
    plain1.paragraph = compact.clone();
    plain1.table = Some(TableStyle {
        table: TableProperties {
            borders: Some(TableBorders::all(thin(grey_line))),
            ..Default::default()
        },
        row_band_size: Some(1),
        col_band_size: Some(1),
        conditional: vec![
            bold_cond(FirstRow),
            ConditionalFormat {
                paragraph: ParagraphProperties {
                    spacing: Some(Spacing {
                        before: Some(Twips(0)),
                        after: Some(Twips(0)),
                        line: Some(LineSpacing::Multiple(1.0)),
                    }),
                    ..Default::default()
                },
                run: bold.clone(),
                cell: CellProperties {
                    borders: Some(edges(
                        Some(BorderSide::new(
                            BorderStyle::Double,
                            BorderSide::width_from_eighths(4),
                            grey_line,
                        )),
                        None,
                        None,
                        None,
                    )),
                    ..Default::default()
                },
                kind: LastRow,
            },
            bold_cond(FirstCol),
            bold_cond(LastCol),
            shade(Band1Vert, grey_fill),
            shade(Band1Horz, grey_fill),
        ],
        ..Default::default()
    });

    let text1 = theme(ThemeColorSlot::Dark1, 0.0);
    let white = theme(ThemeColorSlot::Light1, 0.0);
    let mut list3 = Style::table("ListTable3", "List Table 3");
    list3.paragraph = compact.clone();
    let t1 = Some(thin(text1));
    list3.table = Some(TableStyle {
        table: TableProperties {
            borders: Some(edges(t1, t1, t1, t1)),
            ..Default::default()
        },
        row_band_size: Some(1),
        col_band_size: Some(1),
        conditional: vec![
            ConditionalFormat {
                run: RunProperties {
                    bold: Some(true),
                    color: Some(white),
                    ..Default::default()
                },
                cell: CellProperties {
                    shading: Some(text1),
                    ..Default::default()
                },
                ..cond(FirstRow)
            },
            ConditionalFormat {
                run: bold.clone(),
                ..with_borders(
                    LastRow,
                    edges(
                        Some(BorderSide::new(
                            BorderStyle::Double,
                            BorderSide::width_from_eighths(4),
                            text1,
                        )),
                        None,
                        None,
                        None,
                    ),
                )
            },
            bold_cond(FirstCol),
            ConditionalFormat {
                run: bold.clone(),
                ..with_borders(LastCol, edges(None, nil, None, None))
            },
            with_borders(Band1Vert, edges(None, t1, None, t1)),
            with_borders(Band1Horz, edges(t1, None, t1, None)),
            with_borders(NeCell, edges(None, nil, None, None)),
            with_borders(NwCell, edges(None, None, None, nil)),
        ],
        ..Default::default()
    });

    let grid4 = |n: u8, slot: ThemeColorSlot| {
        let mut s = Style::table(
            &format!("GridTable4-Accent{n}"),
            &format!("Grid Table 4 Accent {n}"),
        );
        s.paragraph = compact.clone();
        let accent = theme(slot, 0.0);
        let a = Some(thin(accent));
        s.table = Some(TableStyle {
            table: TableProperties {
                borders: Some(TableBorders::all(thin(theme(slot, 0.4)))),
                ..Default::default()
            },
            row_band_size: Some(1),
            col_band_size: Some(1),
            conditional: vec![
                ConditionalFormat {
                    run: RunProperties {
                        bold: Some(true),
                        color: Some(white),
                        ..Default::default()
                    },
                    cell: CellProperties {
                        borders: Some(TableBorders {
                            top: a,
                            left: a,
                            bottom: a,
                            right: a,
                            inside_h: nil,
                            inside_v: nil,
                        }),
                        shading: Some(accent),
                        ..Default::default()
                    },
                    ..cond(FirstRow)
                },
                ConditionalFormat {
                    run: bold.clone(),
                    ..with_borders(
                        LastRow,
                        edges(
                            Some(BorderSide::new(
                                BorderStyle::Double,
                                BorderSide::width_from_eighths(4),
                                accent,
                            )),
                            None,
                            None,
                            None,
                        ),
                    )
                },
                bold_cond(FirstCol),
                bold_cond(LastCol),
                shade(Band1Vert, theme(slot, 0.8)),
                shade(Band1Horz, theme(slot, 0.8)),
            ],
            ..Default::default()
        });
        s
    };
    vec![
        normal,
        grid,
        plain1,
        list3,
        grid4(1, ThemeColorSlot::Accent1),
        grid4(2, ThemeColorSlot::Accent2),
        grid4(3, ThemeColorSlot::Accent3),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::{ColorScheme, Rgb};

    #[test]
    fn based_on_chain() {
        let sheet = StyleSheet::office_defaults();
        let h1 = sheet.resolve_paragraph("Heading1");
        assert_eq!(h1.style.as_deref(), Some("Heading1"));
        let sp = h1.spacing.unwrap();
        assert_eq!(sp.before, Some(Twips(240)));
        assert_eq!(sp.after, Some(Twips(0)));
        // inherited from the defaults via Normal
        assert_eq!(sp.line, Some(LineSpacing::from_240ths(259)));
        assert_eq!(h1.keep_next, Some(true));

        let run = sheet.resolve_run("Heading1");
        assert_eq!(run.size, Some(FontSize::from_pt(16.0)));
        assert_eq!(run.font, Some(FontFace::Theme(ThemeFontSlot::MajorLatin)));
        let normal = sheet.resolve_run("Normal");
        assert_eq!(normal.size, Some(FontSize::from_pt(11.0)));
        assert_eq!(
            normal.font,
            Some(FontFace::Theme(ThemeFontSlot::MinorLatin))
        );

        // unknown style: defaults only
        let unknown = sheet.resolve_paragraph("Nope");
        assert_eq!(unknown.style, None);
        assert_eq!(unknown.spacing.unwrap().after, Some(Twips(160)));
    }

    #[test]
    fn heading_colors_match_word() {
        let scheme = ColorScheme::default();
        let sheet = StyleSheet::office_defaults();
        let close = |c: Rgb, hex: &str| {
            let e = Rgb::from_hex(hex).unwrap();
            [(c.r, e.r), (c.g, e.g), (c.b, e.b)]
                .iter()
                .all(|&(a, b)| a.abs_diff(b) <= 2)
        };
        let h1 = sheet.resolve_run("Heading1").color.unwrap();
        assert!(close(h1.resolve(&scheme, Rgb::BLACK), "2F5496"));
        let h3 = sheet.resolve_run("Heading3").color.unwrap();
        assert!(close(h3.resolve(&scheme, Rgb::BLACK), "1F3763"));
    }

    #[test]
    fn based_on_cycle_terminates() {
        let mut sheet = StyleSheet::default();
        for (id, parent, size) in [("A", "B", 10.0), ("B", "C", 12.0), ("C", "A", 14.0)] {
            sheet.insert(Style {
                based_on: Some(parent.into()),
                run: RunProperties {
                    size: Some(FontSize::from_pt(size)),
                    ..Default::default()
                },
                ..Style::new(id, id, StyleKind::Paragraph)
            });
        }
        // A's own value wins over its (cyclic) ancestors.
        assert_eq!(sheet.resolve_run("A").size, Some(FontSize::from_pt(10.0)));
        assert_eq!(sheet.resolve_run("C").size, Some(FontSize::from_pt(14.0)));
        assert_eq!(sheet.resolve_paragraph("B").style.as_deref(), Some("B"));

        // self-reference
        sheet.get_mut("A").unwrap().based_on = Some("A".into());
        assert_eq!(sheet.resolve_run("A").size, Some(FontSize::from_pt(10.0)));
    }

    #[test]
    fn insert_replaces_and_get() {
        let mut sheet = StyleSheet::office_defaults();
        let n = sheet.styles.len();
        assert_eq!(
            sheet
                .default_style(StyleKind::Paragraph)
                .map(|s| s.id.as_str()),
            Some("Normal")
        );
        let mut title = sheet.get("Title").unwrap().clone();
        title.run.bold = Some(true);
        let old = sheet.insert(title).unwrap();
        assert_eq!(old.run.bold, None);
        assert_eq!(sheet.styles.len(), n);
        assert_eq!(sheet.get("Title").unwrap().run.bold, Some(true));
        assert!(sheet
            .insert(Style::paragraph("MyQuote", "My Quote"))
            .is_none());
        assert_eq!(sheet.styles.len(), n + 1);
        assert!(sheet.get("Heading10").is_none());
    }

    fn custom(id: &str, kind: StyleKind, based_on: Option<&str>) -> Style {
        Style {
            based_on: based_on.map(str::to_owned),
            custom: true,
            ..Style::new(id, &format!("My {id}"), kind)
        }
    }

    #[test]
    fn gallery_has_words_quick_styles() {
        let sheet = StyleSheet::office_defaults();
        let quick: Vec<&str> = sheet
            .styles
            .iter()
            .filter(|s| s.quick_format)
            .map(|s| s.id.as_str())
            .collect();
        for id in [
            "Normal",
            "NoSpacing",
            "Heading1",
            "Heading2",
            "Title",
            "Subtitle",
            "SubtleEmphasis",
            "Emphasis",
            "IntenseEmphasis",
            "Strong",
            "Quote",
            "IntenseQuote",
            "SubtleReference",
            "IntenseReference",
            "BookTitle",
            "ListParagraph",
        ] {
            assert!(quick.contains(&id), "{id} not in the gallery");
        }
        for id in [
            "Heading9",
            "Caption",
            "Hyperlink",
            "Header",
            "Footer",
            "FootnoteText",
            "FootnoteReference",
            "TOC1",
            "TOC3",
            "DefaultParagraphFont",
            "NoList",
        ] {
            assert!(sheet.get(id).is_some(), "{id} missing");
        }
        // ids are unique, names too (case-insensitive)
        let mut names: Vec<String> = sheet.styles.iter().map(|s| s.name.to_lowercase()).collect();
        names.sort();
        let n = names.len();
        names.dedup();
        assert_eq!(names.len(), n);
        assert_eq!(sheet.get("Strong").unwrap().kind, StyleKind::Character);
        assert_eq!(sheet.get("NoList").unwrap().kind, StyleKind::Numbering);
        assert_eq!(
            sheet
                .default_style(StyleKind::Character)
                .map(|s| s.id.as_str()),
            Some("DefaultParagraphFont")
        );
    }

    #[test]
    fn linked_pairs_point_at_each_other() {
        let sheet = StyleSheet::office_defaults();
        for id in [
            "Heading1",
            "Heading9",
            "Title",
            "Quote",
            "Header",
            "FootnoteText",
        ] {
            let s = sheet.get(id).unwrap();
            assert_eq!(s.kind, StyleKind::Linked, "{id}");
            let c = sheet.get(s.link.as_deref().unwrap()).unwrap();
            assert_eq!(c.kind, StyleKind::Character);
            assert_eq!(c.link.as_deref(), Some(id));
            assert_eq!(c.run, s.run);
            assert!(c.custom && !s.custom);
        }
        assert_eq!(sheet.get("Heading1Char").unwrap().name, "Heading 1 Char");
        // a linked style is a paragraph style for defaults and parents
        assert!(StyleKind::Linked.is_paragraph());
        assert_eq!(StyleKind::Linked.family(), StyleKind::Paragraph);
        assert_eq!(StyleKind::Linked.docx_type(), "paragraph");
    }

    #[test]
    fn character_resolution_with_link_and_chain() {
        let mut sheet = StyleSheet::office_defaults();
        // Heading 1 used as a character style resolves through its Char half.
        let h1 = sheet.resolve_character("Heading1");
        assert_eq!(h1.size, Some(FontSize::from_pt(16.0)));
        assert_eq!(h1.font, Some(FontFace::Theme(ThemeFontSlot::MajorLatin)));
        // character styles do not include the document defaults
        assert_eq!(sheet.resolve_character("Strong").size, None);
        assert_eq!(sheet.resolve_character("Strong").bold, Some(true));
        let mut red = custom("RedStrong", StyleKind::Character, Some("Strong"));
        red.run.color = Some(Color::Rgb(core_model::Rgb::new(255, 0, 0)));
        sheet.add(red).unwrap();
        let r = sheet.resolve_character("RedStrong");
        assert_eq!(r.bold, Some(true));
        assert!(r.color.is_some());
        assert!(sheet.resolve_character("Nope").is_empty());
    }

    #[test]
    fn next_and_based_on_chains_resolve() {
        let mut sheet = StyleSheet::office_defaults();
        let mut a = custom("A", StyleKind::Paragraph, Some("Heading1"));
        a.next = Some("Quote".into());
        a.paragraph.alignment = Some(Alignment::Right);
        sheet.add(a).unwrap();
        let mut b = custom("B", StyleKind::Paragraph, Some("A"));
        b.run.italic = Some(true);
        sheet.add(b).unwrap();
        let p = sheet.resolve_paragraph("B");
        assert_eq!(p.alignment, Some(Alignment::Right));
        assert_eq!(p.keep_next, Some(true)); // from Heading 1
        assert_eq!(p.spacing.unwrap().line, Some(LineSpacing::from_240ths(259)));
        let r = sheet.resolve_run("B");
        assert_eq!(r.italic, Some(true));
        assert_eq!(r.size, Some(FontSize::from_pt(16.0)));
        assert_eq!(sheet.ancestors("B"), ["B", "A", "Heading1", "Normal"]);
        assert_eq!(sheet.get("A").unwrap().next.as_deref(), Some("Quote"));
    }

    #[test]
    fn add_validates() {
        let mut sheet = StyleSheet::office_defaults();
        assert_eq!(
            sheet.add(Style::new("Normal", "X", StyleKind::Paragraph)),
            Err(StyleError::DuplicateId("Normal".into()))
        );
        assert_eq!(
            sheet.add(Style::new("X", "heading 1", StyleKind::Paragraph)),
            Err(StyleError::DuplicateName("heading 1".into()))
        );
        assert_eq!(
            sheet.add(Style::new("X", " ", StyleKind::Paragraph)),
            Err(StyleError::EmptyName)
        );
        assert!(matches!(
            sheet.add(custom("X", StyleKind::Paragraph, Some("Strong"))),
            Err(StyleError::WrongKind(..))
        ));
        assert!(matches!(
            sheet.add(custom("X", StyleKind::Paragraph, Some("Missing"))),
            Err(StyleError::Unknown(_))
        ));
        let mut bad_next = custom("X", StyleKind::Paragraph, None);
        bad_next.next = Some("Strong".into());
        assert!(matches!(
            sheet.add(bad_next),
            Err(StyleError::WrongKind(..))
        ));
        // a linked style may be based on a plain paragraph style
        sheet
            .add(custom("L", StyleKind::Linked, Some("Normal")))
            .unwrap();
        let mut d = custom("D", StyleKind::Paragraph, Some("Normal"));
        d.is_default = true;
        sheet.add(d).unwrap();
        assert_eq!(sheet.default_style(StyleKind::Paragraph).unwrap().id, "D");
        assert!(!sheet.get("Normal").unwrap().is_default);
    }

    #[test]
    fn update_merges_replaces_and_rejects_cycles() {
        let mut sheet = StyleSheet::office_defaults();
        sheet
            .add(custom("A", StyleKind::Paragraph, Some("Normal")))
            .unwrap();
        sheet
            .add(custom("B", StyleKind::Paragraph, Some("A")))
            .unwrap();
        assert_eq!(
            sheet.update(
                "A",
                &StylePatch {
                    based_on: Some("B".into()),
                    ..Default::default()
                }
            ),
            Err(StyleError::Cycle("A".into(), "B".into()))
        );
        assert!(matches!(
            sheet.update(
                "A",
                &StylePatch {
                    based_on: Some("A".into()),
                    ..Default::default()
                }
            ),
            Err(StyleError::Cycle(..))
        ));
        let bold = RunProperties {
            bold: Some(true),
            ..Default::default()
        };
        sheet
            .update(
                "A",
                &StylePatch {
                    run: Some(bold.clone()),
                    paragraph: Some(ParagraphProperties {
                        alignment: Some(Alignment::Center),
                        style: Some("ignored".into()),
                        ..Default::default()
                    }),
                    next: Some("B".into()),
                    quick_format: Some(true),
                    auto_redefine: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        let a = sheet.get("A").unwrap();
        assert_eq!(a.run.bold, Some(true));
        assert_eq!(a.paragraph.alignment, Some(Alignment::Center));
        assert_eq!(a.paragraph.style, None);
        assert_eq!(a.next.as_deref(), Some("B"));
        assert!(a.quick_format && a.auto_redefine);
        // merge keeps, replace drops
        sheet
            .update(
                "A",
                &StylePatch {
                    run: Some(RunProperties {
                        italic: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(sheet.get("A").unwrap().run.bold, Some(true));
        sheet
            .update(
                "A",
                &StylePatch {
                    run: Some(RunProperties::default()),
                    paragraph: Some(ParagraphProperties::default()),
                    replace_formatting: true,
                    based_on: Some(String::new()),
                    next: Some(String::new()),
                    ..Default::default()
                },
            )
            .unwrap();
        let a = sheet.get("A").unwrap();
        assert!(a.run.is_empty() && a.paragraph.is_empty());
        assert_eq!((a.based_on.as_deref(), a.next.as_deref()), (None, None));
        assert!(matches!(
            sheet.update("Nope", &StylePatch::default()),
            Err(StyleError::Unknown(_))
        ));
    }

    #[test]
    fn updating_a_linked_style_keeps_its_char_half_in_step() {
        let mut sheet = StyleSheet::office_defaults();
        let red = Some(Color::Rgb(core_model::Rgb::new(200, 0, 0)));
        sheet
            .update(
                "Heading1",
                &StylePatch {
                    run: Some(RunProperties {
                        color: red,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(sheet.get("Heading1Char").unwrap().run.color, red);
        assert_eq!(
            sheet.get("Heading1Char").unwrap().run.size,
            Some(FontSize::from_pt(16.0))
        );
        sheet
            .update(
                "Heading1Char",
                &StylePatch {
                    run: Some(RunProperties {
                        bold: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(sheet.get("Heading1").unwrap().run.bold, Some(true));
    }

    #[test]
    fn rename_and_set_default() {
        let mut sheet = StyleSheet::office_defaults();
        sheet.add(custom("A", StyleKind::Paragraph, None)).unwrap();
        sheet.rename("A", "  Fancy  ").unwrap();
        assert_eq!(sheet.get("A").unwrap().name, "Fancy");
        assert_eq!(sheet.find_by_name("FANCY").unwrap().id, "A");
        assert_eq!(
            sheet.rename("A", "Title"),
            Err(StyleError::DuplicateName("Title".into()))
        );
        // its own name (other case) is fine
        sheet.rename("A", "fancy").unwrap();
        sheet.set_default(StyleKind::Paragraph, "A").unwrap();
        assert_eq!(sheet.default_style(StyleKind::Paragraph).unwrap().id, "A");
        assert!(matches!(
            sheet.set_default(StyleKind::Paragraph, "Strong"),
            Err(StyleError::WrongKind(..))
        ));
        assert_eq!(sheet.unique_id("Fancy Style!"), "FancyStyle");
        assert_eq!(sheet.unique_id("Normal"), "Normal1");
        assert_eq!(sheet.unique_id("%%"), "Style");
    }

    #[test]
    fn delete_rebases_children_and_removes_linked_half() {
        let mut sheet = StyleSheet::office_defaults();
        let mut a = custom("A", StyleKind::Linked, Some("Heading2"));
        a.link = Some("AChar".into());
        sheet.add(a).unwrap();
        let mut ac = custom("AChar", StyleKind::Character, Some("DefaultParagraphFont"));
        ac.link = Some("A".into());
        sheet.add(ac).unwrap();
        let mut b = custom("B", StyleKind::Paragraph, Some("A"));
        b.next = Some("A".into());
        sheet.add(b).unwrap();
        let removed = sheet.delete("A").unwrap();
        let ids: Vec<&str> = removed.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["A", "AChar"]);
        let b = sheet.get("B").unwrap();
        assert_eq!(b.based_on.as_deref(), Some("Heading2"));
        assert_eq!(b.next, None);
        for id in [
            "Normal",
            "Heading1",
            "Strong",
            "DefaultParagraphFont",
            "TableGrid",
        ] {
            assert!(
                matches!(sheet.delete(id), Err(StyleError::BuiltIn(_))),
                "{id} must not be deletable"
            );
        }
        assert!(matches!(sheet.delete("Nope"), Err(StyleError::Unknown(_))));
        // deleting only the character half unlinks the paragraph style
        let mut c = custom("C", StyleKind::Linked, None);
        c.link = Some("CChar".into());
        sheet
            .add(Style {
                link: Some("C".into()),
                ..custom("CChar", StyleKind::Character, None)
            })
            .unwrap();
        sheet.add(c).unwrap();
        sheet.delete("CChar").unwrap();
        let c = sheet.get("C").unwrap();
        assert_eq!((c.kind, c.link.as_deref()), (StyleKind::Paragraph, None));
    }

    #[test]
    fn builtin_names() {
        assert!(is_builtin_name("Heading 3"));
        assert!(is_builtin_name("toc 9"));
        assert!(is_builtin_name("NORMAL"));
        assert!(!is_builtin_name("heading 10"));
        assert!(!is_builtin_name("My Heading"));
        let mut s = Style::new("Normal", "Normal", StyleKind::Paragraph);
        assert!(s.is_builtin());
        s.custom = true;
        assert!(!s.is_builtin());
        assert!(!Style::new("X", "Fancy", StyleKind::Paragraph).is_builtin());
    }

    fn doc_with(styles: &[(&str, Option<&str>)]) -> Document {
        use crate::block::Paragraph;
        use crate::inline::{Inline, Run};
        let mut doc = Document::new();
        doc.body.clear();
        for (i, (ps, cs)) in styles.iter().enumerate() {
            let mut p = Paragraph::new(NodeId(100 + i as u64));
            p.props.style = (!ps.is_empty()).then(|| (*ps).to_owned());
            p.inlines = vec![
                Inline::Run(Run::new("plain ")),
                Inline::Run(Run::styled(
                    "styled",
                    cs.map(str::to_owned),
                    RunProperties::default(),
                )),
            ];
            doc.body.push(Block::Paragraph(p));
        }
        doc
    }

    #[test]
    fn document_delete_style_repoints_paragraphs_and_runs() {
        let mut doc = doc_with(&[("Mine", None), ("Heading1", Some("MineChar")), ("", None)]);
        let mut mine = custom("Mine", StyleKind::Linked, Some("Normal"));
        mine.link = Some("MineChar".into());
        doc.styles
            .add(Style {
                link: Some("Mine".into()),
                ..custom("MineChar", StyleKind::Character, None)
            })
            .unwrap();
        doc.styles.add(mine).unwrap();
        assert_eq!(doc.blocks_with_style("Mine"), [NodeId(100), NodeId(101)]);
        assert_eq!(doc.blocks_with_style("Normal"), [NodeId(102)]);
        assert_eq!(doc.style_usage().get("Heading1"), Some(&1));
        assert!(matches!(
            doc.delete_style("Mine", Some("Strong")),
            Err(StyleError::WrongKind(..))
        ));
        assert!(matches!(
            doc.delete_style("Mine", Some("MineChar")),
            Err(StyleError::WrongKind(..))
        ));
        assert!(
            doc.styles.get("Mine").is_some(),
            "failed delete changes nothing"
        );
        let changed = doc.delete_style("Mine", Some("Quote")).unwrap();
        assert_eq!(changed, [NodeId(100), NodeId(101)]);
        let p0 = doc.find_paragraph(NodeId(100)).unwrap();
        assert_eq!(p0.props.style.as_deref(), Some("Quote"));
        let p1 = doc.find_paragraph(NodeId(101)).unwrap();
        assert_eq!(p1.props.style.as_deref(), Some("Heading1"));
        assert!(p1
            .inlines
            .iter()
            .all(|i| i.as_run().unwrap().style.is_none()));
        assert!(doc.styles.get("MineChar").is_none());
    }

    #[test]
    fn delete_style_default_replacement_is_normal() {
        let mut doc = doc_with(&[("Mine", None)]);
        doc.styles
            .add(custom("Mine", StyleKind::Paragraph, Some("Normal")))
            .unwrap();
        doc.delete_style("Mine", Some("Normal")).unwrap();
        assert_eq!(doc.find_paragraph(NodeId(100)).unwrap().props.style, None);
        let mut doc = doc_with(&[("Mine", None)]);
        doc.styles
            .add(custom("Mine", StyleKind::Paragraph, Some("Normal")))
            .unwrap();
        doc.delete_style("Mine", None).unwrap();
        assert_eq!(doc.find_paragraph(NodeId(100)).unwrap().props.style, None);
    }

    #[test]
    fn run_props_layer_character_styles() {
        let doc = doc_with(&[("Heading1", Some("Strong"))]);
        let p = doc.find_paragraph(NodeId(100)).unwrap();
        let styled = p.inlines[1].as_run().unwrap();
        let r = doc.resolve_run_props(p, styled);
        assert_eq!(r.bold, Some(true));
        assert_eq!(r.size, Some(FontSize::from_pt(16.0)));
        let plain = doc.resolve_run_props(p, p.inlines[0].as_run().unwrap());
        assert_eq!(plain.bold, None);
        // direct formatting wins over the character style
        let mut direct = styled.clone();
        direct.props.bold = Some(false);
        assert_eq!(doc.resolve_run_props(p, &direct).bold, Some(false));
    }

    #[test]
    fn style_json_flags_roundtrip() {
        let mut s = custom("A", StyleKind::Linked, Some("Normal"));
        s.link = Some("AChar".into());
        s.quick_format = true;
        s.priority = Some(5);
        s.hidden = true;
        s.semi_hidden = true;
        s.unhide_when_used = true;
        s.auto_redefine = true;
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""kind":"linked""#), "{json}");
        assert!(json.contains(r#""quickFormat":true"#));
        assert_eq!(serde_json::from_str::<Style>(&json).unwrap(), s);
        let bare: Style =
            serde_json::from_str(r#"{"id":"X","name":"X","kind":"numbering"}"#).unwrap();
        assert_eq!(bare, Style::new("X", "X", StyleKind::Numbering));
    }
}
