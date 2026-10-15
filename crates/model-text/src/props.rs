//! Paragraph and table formatting properties.
//!
//! Every property is optional: `None` means "inherit" (from the style chain
//! or the document defaults). `None` fields are omitted from the JSON.

use core_model::units::Twips;
use core_model::{Color, RunProperties};
use serde::{Deserialize, Serialize};

/// Horizontal paragraph alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum Alignment {
    /// Left (start) aligned.
    Left,
    /// Centered.
    Center,
    /// Right (end) aligned.
    Right,
    /// Justified.
    Justify,
}

/// Paragraph indentation.
///
/// `first_line` and `hanging` are mutually exclusive in Word; they are
/// treated as one value when merging (see [`Indent::merged_with`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Indent {
    /// Left (start) indent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub left: Option<Twips>,
    /// Right (end) indent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub right: Option<Twips>,
    /// Additional indent of the first line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub first_line: Option<Twips>,
    /// Outdent of the first line relative to `left` (lists).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub hanging: Option<Twips>,
}

impl Indent {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with `over`, field by field. If `over` sets either
    /// `first_line` or `hanging`, both are taken from `over` (setting one
    /// clears the other, as in Word).
    #[must_use]
    pub fn merged_with(&self, over: &Indent) -> Indent {
        let (first_line, hanging) = if over.first_line.is_some() || over.hanging.is_some() {
            (over.first_line, over.hanging)
        } else {
            (self.first_line, self.hanging)
        };
        Indent {
            left: over.left.or(self.left),
            right: over.right.or(self.right),
            first_line,
            hanging,
        }
    }
}

/// Line spacing of a paragraph.
///
/// Serializes as `{"kind":"multiple","value":1.15}` or
/// `{"kind":"exact","value":240}` (twips).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum LineSpacing {
    /// A multiple of single line spacing (docx `lineRule="auto"`, stored
    /// there in 240ths of a line).
    Multiple(f64),
    /// Exactly this line height.
    Exact(#[cfg_attr(feature = "ts", ts(as = "i32"))] Twips),
    /// At least this line height.
    AtLeast(#[cfg_attr(feature = "ts", ts(as = "i32"))] Twips),
}

impl LineSpacing {
    /// `Multiple` from docx's `w:line` with `lineRule="auto"` (240ths of a line).
    pub fn from_240ths(value: i32) -> Self {
        Self::Multiple(f64::from(value) / 240.0)
    }
}

/// Spacing around a paragraph.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Spacing {
    /// Space before the paragraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub before: Option<Twips>,
    /// Space after the paragraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub after: Option<Twips>,
    /// Line spacing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineSpacing>,
}

impl Spacing {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with `over`, field by field.
    #[must_use]
    pub fn merged_with(&self, over: &Spacing) -> Spacing {
        Spacing {
            before: over.before.or(self.before),
            after: over.after.or(self.after),
            line: over.line.or(self.line),
        }
    }
}

/// Reference from a paragraph to a numbering definition and level.
///
/// `num_id == 0` means "explicitly not numbered" (as in docx), which lets a
/// paragraph switch off numbering inherited from its style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct NumberingRef {
    /// Id of a [`crate::NumberingDef`].
    pub num_id: u32,
    /// List level, `0..=8`.
    pub level: u8,
}

/// Paragraph formatting.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct ParagraphProperties {
    /// Paragraph style id (`None` = the default paragraph style).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// Horizontal alignment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<Alignment>,
    /// Indentation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent: Option<Indent>,
    /// Spacing before/after and line spacing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacing: Option<Spacing>,
    /// List numbering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub numbering: Option<NumberingRef>,
    /// Keep with the next paragraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_next: Option<bool>,
    /// Start on a new page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_break_before: Option<bool>,
    /// Paragraph borders (docx `w:pBdr`), merged side by side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub borders: Option<ParagraphBorders>,
    /// Background color (docx `w:shd/@w:fill`). In a
    /// `setParagraphProps` patch, `auto` removes the direct shading.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<app_common::wire::Color>", optional))]
    pub shading: Option<Color>,
    /// Custom tab stops (docx `w:tabs`), sorted by position. They merge
    /// with the inherited ones by position; a [`TabKind::Clear`] entry
    /// removes an inherited stop (resolved properties contain no `clear`
    /// entries).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tabs: Vec<TabStop>,
    /// Formatting of the paragraph mark (docx `w:pPr/w:rPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<app_common::wire::RunProperties>"))]
    pub run_defaults: Option<RunProperties>,
    /// This (top-level body) paragraph ends the section with this id
    /// (docx: `w:sectPr` inside the paragraph's `w:pPr`). Never inherited
    /// from styles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub section_end: Option<crate::section::SectionId>,
}

impl ParagraphProperties {
    /// Returns `true` if no property is set (everything inherits).
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Returns `self` overlaid with `over`: every field that is `Some` in
    /// `over` wins; `indent`, `spacing` and `run_defaults` merge field by
    /// field.
    #[must_use]
    pub fn merged_with(&self, over: &ParagraphProperties) -> ParagraphProperties {
        let mut out = self.clone();
        out.apply(over);
        out
    }

    /// Overlays `over` onto `self` in place (see [`Self::merged_with`]).
    pub fn apply(&mut self, over: &ParagraphProperties) {
        // Destructure so that adding a field without handling it fails to compile.
        let ParagraphProperties {
            style,
            alignment,
            indent,
            spacing,
            numbering,
            keep_next,
            page_break_before,
            borders,
            shading,
            tabs,
            run_defaults,
            section_end,
        } = over;
        if style.is_some() {
            self.style.clone_from(style);
        }
        self.alignment = alignment.or(self.alignment);
        self.indent = merge_opt(self.indent, *indent, |a, b| a.merged_with(b));
        self.spacing = merge_opt(self.spacing, *spacing, |a, b| a.merged_with(b));
        self.numbering = numbering.or(self.numbering);
        self.keep_next = keep_next.or(self.keep_next);
        self.page_break_before = page_break_before.or(self.page_break_before);
        self.section_end = section_end.or(self.section_end);
        self.borders = merge_opt(self.borders, *borders, |a, b| a.merged_with(b));
        self.shading = shading.or(self.shading);
        merge_tabs(&mut self.tabs, tabs);
        if let Some(over_run) = run_defaults {
            self.run_defaults = Some(match &self.run_defaults {
                Some(base) => base.merged_with(over_run),
                None => over_run.clone(),
            });
        }
    }
}

impl ParagraphProperties {
    /// Drops the [`TabKind::Clear`] entries (after resolution they have
    /// done their job).
    pub fn strip_cleared_tabs(&mut self) {
        self.tabs.retain(|t| t.kind != TabKind::Clear);
    }
}

/// Overlays the tab stops `over` onto `base`: a stop replaces the one at
/// the same position; the result is sorted by position.
pub fn merge_tabs(base: &mut Vec<TabStop>, over: &[TabStop]) {
    for t in over {
        base.retain(|b| b.pos != t.pos);
        base.push(*t);
    }
    base.sort_by_key(|t| t.pos);
}

/// Alignment of a tab stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum TabKind {
    /// Text starts at the stop.
    Left,
    /// Text is centered on the stop.
    Center,
    /// Text ends at the stop.
    Right,
    /// The decimal separator aligns on the stop.
    Decimal,
    /// A vertical bar at the position (not a stop).
    Bar,
    /// Removes an inherited stop at this position (docx `clear`).
    Clear,
}

/// Fill characters before a tab stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum TabLeader {
    /// No leader.
    #[default]
    None,
    /// Dots (`.....`).
    Dot,
    /// Hyphens (`-----`).
    Hyphen,
    /// Underscores / a line (`_____`).
    Underscore,
}

/// A custom tab stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TabStop {
    /// Position from the left edge of the text column (Word's ruler
    /// origin; docx `w:pos`).
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub pos: Twips,
    /// Alignment.
    pub kind: TabKind,
    /// Leader characters.
    #[serde(default, skip_serializing_if = "is_default")]
    pub leader: TabLeader,
}

fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

/// Paragraph borders; `None` = inherit / no border.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct ParagraphBorders {
    /// Above the paragraph (above a group of paragraphs with equal borders).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSide>,
    /// Below the paragraph (below the group).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSide>,
    /// Left of the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSide>,
    /// Right of the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSide>,
    /// Between paragraphs of a group with equal borders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub between: Option<BorderSide>,
}

impl ParagraphBorders {
    /// Top, bottom, left and right set to `side` (Word's "Box").
    pub fn boxed(side: BorderSide) -> Self {
        Self {
            top: Some(side),
            bottom: Some(side),
            left: Some(side),
            right: Some(side),
            between: None,
        }
    }

    /// Returns `true` if no side is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with `over`, side by side.
    #[must_use]
    pub fn merged_with(&self, over: &ParagraphBorders) -> ParagraphBorders {
        ParagraphBorders {
            top: over.top.or(self.top),
            bottom: over.bottom.or(self.bottom),
            left: over.left.or(self.left),
            right: over.right.or(self.right),
            between: over.between.or(self.between),
        }
    }
}

fn merge_opt<T: Copy>(base: Option<T>, over: Option<T>, f: impl Fn(&T, &T) -> T) -> Option<T> {
    match (base, over) {
        (Some(a), Some(b)) => Some(f(&a, &b)),
        (a, b) => b.or(a),
    }
}

/// A table or cell width.
///
/// Serializes as `{"kind":"auto"}`, `{"kind":"twips","value":4500}` or
/// `{"kind":"pct","value":5000}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum TableWidth {
    /// Determined by the content.
    Auto,
    /// A fixed width.
    Twips(#[cfg_attr(feature = "ts", ts(as = "i32"))] Twips),
    /// A percentage of the available width in fiftieths of a percent
    /// (`5000` = 100 %), as docx `w:type="pct"`.
    Pct(u16),
}

/// Line style of a table border.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum BorderStyle {
    /// Single line.
    Single,
    /// Double line.
    Double,
    /// Dashed line.
    Dashed,
    /// Dotted line.
    Dotted,
    /// Thick single line.
    Thick,
    /// Explicitly no border.
    None,
}

/// One side of a table or cell border.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct BorderSide {
    /// Line style.
    pub style: BorderStyle,
    /// Line width. docx stores eighths of a point; see
    /// [`BorderSide::width_from_eighths`].
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub width: Twips,
    /// Line color.
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Color"))]
    pub color: Color,
    /// Distance from the text in points (docx `w:space`; paragraph
    /// borders); `None` = 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub space: Option<u8>,
}

impl BorderSide {
    /// A border without distance from the text.
    pub fn new(style: BorderStyle, width: Twips, color: Color) -> Self {
        Self {
            style,
            width,
            color,
            space: None,
        }
    }

    /// Converts docx `w:sz` (eighths of a point) to twips (×2.5, rounded).
    pub fn width_from_eighths(eighths: u32) -> Twips {
        Twips((u64::from(eighths) * 5).div_ceil(2).min(i32::MAX as u64) as i32)
    }

    /// The width in eighths of a point (docx `w:sz`), rounded.
    pub fn width_eighths(&self) -> u32 {
        ((i64::from(self.width.0.max(0)) * 2 + 2) / 5) as u32
    }
}

/// Table or cell borders; `None` = inherit / no border.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TableBorders {
    /// Top edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSide>,
    /// Left edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSide>,
    /// Bottom edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSide>,
    /// Right edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSide>,
    /// Horizontal lines between rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inside_h: Option<BorderSide>,
    /// Vertical lines between columns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inside_v: Option<BorderSide>,
}

impl TableBorders {
    /// All six sides set to `side` (Word's "Table Grid" look).
    pub fn all(side: BorderSide) -> Self {
        Self {
            top: Some(side),
            left: Some(side),
            bottom: Some(side),
            right: Some(side),
            inside_h: Some(side),
            inside_v: Some(side),
        }
    }

    /// `self` overlaid with `over`, side by side.
    #[must_use]
    pub fn merged_with(&self, over: &TableBorders) -> TableBorders {
        TableBorders {
            top: over.top.or(self.top),
            left: over.left.or(self.left),
            bottom: over.bottom.or(self.bottom),
            right: over.right.or(self.right),
            inside_h: over.inside_h.or(self.inside_h),
            inside_v: over.inside_v.or(self.inside_v),
        }
    }
}

/// Default cell padding of a table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct CellMargins {
    /// Top padding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub top: Option<Twips>,
    /// Left padding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub left: Option<Twips>,
    /// Bottom padding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub bottom: Option<Twips>,
    /// Right padding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<i32>"))]
    pub right: Option<Twips>,
}

/// Horizontal position of a table between the margins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum TableAlignment {
    /// At the left margin (plus `indent`).
    Left,
    /// Centered.
    Center,
    /// At the right margin.
    Right,
}

/// How column widths are determined (docx `w:tblLayout`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum TableLayout {
    /// Columns adapt to the content (Word's AutoFit, the default).
    Autofit,
    /// The grid widths are used as given.
    Fixed,
}

/// Which conditional formats of the table style apply (docx `w:tblLook`).
/// Word's default for new tables is header row, first column and banded
/// rows ([`TableLook::word_default`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TableLook {
    /// Header row formatting (`firstRow`).
    #[serde(default)]
    pub first_row: bool,
    /// Total row formatting (`lastRow`).
    #[serde(default)]
    pub last_row: bool,
    /// First column formatting.
    #[serde(default)]
    pub first_col: bool,
    /// Last column formatting.
    #[serde(default)]
    pub last_col: bool,
    /// Banded rows (docx `noHBand="0"`).
    #[serde(default)]
    pub banded_rows: bool,
    /// Banded columns (docx `noVBand="0"`).
    #[serde(default)]
    pub banded_cols: bool,
}

impl TableLook {
    /// Word's look for new tables (`w:val="04A0"`): header row, first
    /// column, banded rows.
    pub fn word_default() -> Self {
        Self {
            first_row: true,
            first_col: true,
            banded_rows: true,
            ..Default::default()
        }
    }
}

/// Table formatting.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TableProperties {
    /// Preferred table width.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<TableWidth>,
    /// Grid column widths (docx `w:tblGrid`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Vec<i32>"))]
    pub col_widths: Vec<Twips>,
    /// Table borders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub borders: Option<TableBorders>,
    /// Default cell padding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_margins: Option<CellMargins>,
    /// Table style id (`None` = the default table style).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub style: Option<String>,
    /// Which conditional formats of the style apply (`None` = none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub look: Option<TableLook>,
    /// Horizontal position between the margins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub alignment: Option<TableAlignment>,
    /// Indent from the left margin (docx `w:tblInd`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<i32>"))]
    pub indent: Option<Twips>,
    /// Fixed or automatic column widths (`None` = automatic).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub layout: Option<TableLayout>,
}

impl TableProperties {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// How a row height is interpreted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum HeightRule {
    /// The row grows with its content.
    AtLeast,
    /// The row has exactly this height.
    Exact,
}

/// Row height.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct RowHeight {
    /// The height.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub value: Twips,
    /// How `value` is interpreted.
    pub rule: HeightRule,
}

/// Table row formatting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct RowProperties {
    /// Row height (`None` = automatic).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<RowHeight>,
    /// Repeat as header row on each page.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub header: bool,
    /// The row must not break across pages (docx `w:cantSplit`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cant_split: bool,
}

impl RowProperties {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Vertical alignment of cell content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum VAlign {
    /// Top.
    Top,
    /// Centered.
    Center,
    /// Bottom.
    Bottom,
}

/// Table cell formatting.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct CellProperties {
    /// Preferred cell width.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<TableWidth>,
    /// Background color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<app_common::wire::Color>"))]
    pub shading: Option<Color>,
    /// Cell borders (override the table borders).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub borders: Option<TableBorders>,
    /// Vertical alignment of the content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<VAlign>,
    /// Cell padding (overrides the table's `cellMargins`; docx `w:tcMar`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub margins: Option<CellMargins>,
}

impl CellMargins {
    /// `self` overlaid with `over`, side by side.
    #[must_use]
    pub fn merged_with(&self, over: &CellMargins) -> CellMargins {
        CellMargins {
            top: over.top.or(self.top),
            left: over.left.or(self.left),
            bottom: over.bottom.or(self.bottom),
            right: over.right.or(self.right),
        }
    }
}

/// Vertical merge state of a table cell (docx `w:vMerge`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum VMerge {
    /// The first (top) cell of a vertically merged region; holds the
    /// content.
    Restart,
    /// Covered by the cell above (its content is ignored, normally one
    /// empty paragraph).
    Continue,
}

impl CellProperties {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::Rgb;

    #[test]
    fn paragraph_merge_semantics() {
        let base = ParagraphProperties {
            style: Some("Normal".into()),
            alignment: Some(Alignment::Left),
            indent: Some(Indent {
                left: Some(Twips(720)),
                hanging: Some(Twips(360)),
                ..Default::default()
            }),
            spacing: Some(Spacing {
                after: Some(Twips(160)),
                line: Some(LineSpacing::from_240ths(259)),
                ..Default::default()
            }),
            keep_next: Some(true),
            ..Default::default()
        };
        let over = ParagraphProperties {
            alignment: Some(Alignment::Center),
            indent: Some(Indent {
                first_line: Some(Twips(200)),
                ..Default::default()
            }),
            spacing: Some(Spacing {
                before: Some(Twips(240)),
                ..Default::default()
            }),
            keep_next: Some(false),
            run_defaults: Some(RunProperties {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        let m = base.merged_with(&over);
        assert_eq!(m.style.as_deref(), Some("Normal"));
        assert_eq!(m.alignment, Some(Alignment::Center));
        assert_eq!(
            m.indent,
            Some(Indent {
                left: Some(Twips(720)),
                right: None,
                first_line: Some(Twips(200)),
                hanging: None,
            })
        );
        let sp = m.spacing.unwrap();
        assert_eq!(sp.before, Some(Twips(240)));
        assert_eq!(sp.after, Some(Twips(160)));
        assert_eq!(sp.line, Some(LineSpacing::Multiple(259.0 / 240.0)));
        assert_eq!(m.keep_next, Some(false));
        assert_eq!(m.run_defaults.unwrap().bold, Some(true));

        assert_eq!(base.merged_with(&ParagraphProperties::default()), base);
        assert_eq!(ParagraphProperties::default().merged_with(&base), base);
        assert!(ParagraphProperties::default().is_empty());
        assert!(!base.is_empty());
        assert_eq!(
            serde_json::to_string(&ParagraphProperties::default()).unwrap(),
            "{}"
        );
    }

    #[test]
    fn border_width_eighths() {
        assert_eq!(BorderSide::width_from_eighths(4), Twips(10));
        assert_eq!(BorderSide::width_from_eighths(8), Twips(20));
        assert_eq!(BorderSide::width_from_eighths(12), Twips(30));
        assert_eq!(BorderSide::width_from_eighths(1), Twips(3));
        for sz in [2, 4, 6, 8, 12, 18, 24, 36, 48] {
            let side = BorderSide::new(
                BorderStyle::Single,
                BorderSide::width_from_eighths(sz),
                Color::Rgb(Rgb::BLACK),
            );
            assert_eq!(side.width_eighths(), sz);
        }
    }

    #[test]
    fn tagged_enums_serde() {
        assert_eq!(
            serde_json::to_string(&TableWidth::Pct(5000)).unwrap(),
            r#"{"kind":"pct","value":5000}"#
        );
        assert_eq!(
            serde_json::to_string(&TableWidth::Auto).unwrap(),
            r#"{"kind":"auto"}"#
        );
        assert_eq!(
            serde_json::to_string(&LineSpacing::AtLeast(Twips(300))).unwrap(),
            r#"{"kind":"atLeast","value":300}"#
        );
        let row = RowProperties::default();
        assert_eq!(serde_json::to_string(&row).unwrap(), "{}");
    }
}
