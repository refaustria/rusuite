//! DrawingML-shaped text: [`TextBody`] → [`TextParagraph`] → [`TextRun`].

use core_model::units::Emu;
use core_model::RunProperties;
use serde::{Deserialize, Serialize};

/// Vertical anchoring of the text inside its shape (`a:bodyPr/@anchor`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Anchor {
    /// Top (`t`).
    #[default]
    Top,
    /// Middle (`ctr`).
    Middle,
    /// Bottom (`b`).
    Bottom,
}

/// Text autofit behaviour (`a:noAutofit` / `a:normAutofit` / `a:spAutoFit`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Autofit {
    /// Text may overflow the shape.
    #[default]
    None,
    /// Shrink text on overflow (`a:normAutofit`).
    Shrink,
    /// Resize the shape to fit the text (`a:spAutoFit`).
    Resize,
}

/// Inner margins of a text body (`a:bodyPr/@lIns` …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Insets {
    /// Left inset.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub left: Emu,
    /// Top inset.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub top: Emu,
    /// Right inset.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub right: Emu,
    /// Bottom inset.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub bottom: Emu,
}

impl Default for Insets {
    /// DrawingML defaults: 0.1" left/right, 0.05" top/bottom.
    fn default() -> Self {
        Self {
            left: Emu(91_440),
            top: Emu(45_720),
            right: Emu(91_440),
            bottom: Emu(45_720),
        }
    }
}

/// Text body properties (`a:bodyPr`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct BodyProps {
    /// Vertical anchoring.
    pub anchor: Anchor,
    /// Wrap lines at the shape width (`wrap="square"`); `false` = `none`.
    pub wrap: bool,
    /// Inner margins.
    pub insets: Insets,
    /// Autofit behaviour.
    pub autofit: Autofit,
}

impl Default for BodyProps {
    /// Top anchored, wrapping, default insets, no autofit.
    fn default() -> Self {
        Self {
            anchor: Anchor::Top,
            wrap: true,
            insets: Insets::default(),
            autofit: Autofit::None,
        }
    }
}

/// Horizontal paragraph alignment (`a:pPr/@algn`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Alignment {
    /// Left (`l`).
    Left,
    /// Centered (`ctr`).
    Center,
    /// Right (`r`).
    Right,
    /// Justified (`just`).
    Justify,
}

/// Auto-numbering scheme of a numbered paragraph (`a:buAutoNum/@type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum AutoNumScheme {
    /// `1.` (`arabicPeriod`).
    ArabicPeriod,
    /// `1)` (`arabicParenR`).
    ArabicParenR,
    /// `a.` (`alphaLcPeriod`).
    AlphaLcPeriod,
    /// `A.` (`alphaUcPeriod`).
    AlphaUcPeriod,
    /// `i.` (`romanLcPeriod`).
    RomanLcPeriod,
    /// `I.` (`romanUcPeriod`).
    RomanUcPeriod,
}

/// Bullet of a paragraph.
///
/// Serializes as `{"kind":"none"}`, `{"kind":"char","value":"•"}` or
/// `{"kind":"autoNum","value":"arabicPeriod"}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Bullet {
    /// Explicitly no bullet (`a:buNone`).
    None,
    /// A bullet character (`a:buChar`).
    Char(String),
    /// Automatic numbering (`a:buAutoNum`).
    AutoNum(AutoNumScheme),
}

/// A spacing value (`a:spcPct` or `a:spcPts`).
///
/// Serializes as `{"kind":"percent","value":100000}` or
/// `{"kind":"points","value":1200}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum TextSpacing {
    /// Relative to the font size, in thousandths of a percent
    /// (`100000` = single line).
    Percent(u32),
    /// Absolute, in hundredths of a point.
    Points(u32),
}

/// Paragraph properties (`a:pPr`). `None` fields inherit from the layout.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextParagraphProps {
    /// Horizontal alignment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<Alignment>,
    /// Outline level, `0..=8` (`a:pPr/@lvl`).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub level: u8,
    /// Bullet; `None` inherits, [`Bullet::None`] turns bullets off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bullet: Option<Bullet>,
    /// Space before the paragraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacing_before: Option<TextSpacing>,
    /// Space after the paragraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacing_after: Option<TextSpacing>,
    /// Line spacing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_spacing: Option<TextSpacing>,
}

fn is_zero(v: &u8) -> bool {
    *v == 0
}

impl TextParagraphProps {
    /// Whether nothing is set (level 0, everything inherits).
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with the fields `over` sets (the level is
    /// `self`'s).
    #[must_use]
    pub fn merged_with(&self, over: &TextParagraphProps) -> TextParagraphProps {
        TextParagraphProps {
            alignment: over.alignment.or(self.alignment),
            level: self.level,
            bullet: over.bullet.clone().or_else(|| self.bullet.clone()),
            spacing_before: over.spacing_before.or(self.spacing_before),
            spacing_after: over.spacing_after.or(self.spacing_after),
            line_spacing: over.line_spacing.or(self.line_spacing),
        }
    }

    /// The fields of `self` that differ from `base` (level 0): what a
    /// list style must state so that `base` overlaid with it gives `self`.
    #[must_use]
    pub fn diff_from(&self, base: &TextParagraphProps) -> TextParagraphProps {
        fn d<T: PartialEq + Clone>(v: &Option<T>, b: &Option<T>) -> Option<T> {
            if v == b {
                None
            } else {
                v.clone()
            }
        }
        TextParagraphProps {
            alignment: d(&self.alignment, &base.alignment),
            level: 0,
            bullet: d(&self.bullet, &base.bullet),
            spacing_before: d(&self.spacing_before, &base.spacing_before),
            spacing_after: d(&self.spacing_after, &base.spacing_after),
            line_spacing: d(&self.line_spacing, &base.line_spacing),
        }
    }
}

/// The fields of `value` that differ from `base` (see
/// [`TextParagraphProps::diff_from`]).
#[allow(clippy::needless_update)] // stays correct when RunProperties grows
pub fn run_diff(value: &RunProperties, base: &RunProperties) -> RunProperties {
    fn d<T: PartialEq + Clone>(v: &Option<T>, b: &Option<T>) -> Option<T> {
        if v == b {
            None
        } else {
            v.clone()
        }
    }
    RunProperties {
        font: d(&value.font, &base.font),
        size: d(&value.size, &base.size),
        bold: d(&value.bold, &base.bold),
        italic: d(&value.italic, &base.italic),
        underline: d(&value.underline, &base.underline),
        strike: d(&value.strike, &base.strike),
        color: d(&value.color, &base.color),
        highlight: d(&value.highlight, &base.highlight),
        vertical_align: d(&value.vertical_align, &base.vertical_align),
        ..RunProperties::default()
    }
}

/// A run of text with uniform formatting (`a:r`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextRun {
    /// Direct formatting (same type as Write's runs).
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub props: RunProperties,
    /// The text (for a field: its current text, e.g. `"3"` or `"‹#›"`).
    pub text: String,
    /// A field (`a:fld`) whose text the application fills in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub field: Option<TextField>,
    /// A hyperlink (`a:rPr/a:hlinkClick`; drawn underlined in the
    /// theme's hyperlink colour).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub hyperlink: Option<crate::link::Hyperlink>,
}

impl TextRun {
    /// An unformatted run.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            props: RunProperties::default(),
            text: text.into(),
            field: None,
            hyperlink: None,
        }
    }

    /// A field run with its current text.
    pub fn field(field: TextField, text: impl Into<String>) -> Self {
        Self {
            props: RunProperties::default(),
            text: text.into(),
            field: Some(field),
            hyperlink: None,
        }
    }
}

/// A text field (`a:fld/@type`).
///
/// Serializes as `{"kind":"slideNumber"}`,
/// `{"kind":"dateTime","value":{"format":1}}` or
/// `{"kind":"other","value":{"type":"datetimeFigureOut"}}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum TextField {
    /// The slide number (`slidenum`).
    SlideNumber,
    /// The current date/time (`datetime` = format 0, `datetime1` …
    /// `datetime13`, see [`date_format_pattern`]).
    #[serde(rename_all = "camelCase")]
    DateTime {
        /// The format number.
        format: u8,
    },
    /// Any other field type, kept as is.
    #[serde(rename_all = "camelCase")]
    Other {
        /// `a:fld/@type`.
        #[serde(rename = "type")]
        #[cfg_attr(feature = "ts", ts(rename = "type"))]
        kind: String,
    },
}

impl TextField {
    /// The field from `a:fld/@type`.
    pub fn from_ooxml(ty: &str) -> TextField {
        if ty == "slidenum" {
            return TextField::SlideNumber;
        }
        if let Some(n) = ty.strip_prefix("datetime") {
            if n.is_empty() {
                return TextField::DateTime { format: 0 };
            }
            if let Ok(f) = n.parse::<u8>() {
                if (1..=13).contains(&f) {
                    return TextField::DateTime { format: f };
                }
            }
        }
        TextField::Other {
            kind: ty.to_owned(),
        }
    }

    /// `a:fld/@type`.
    pub fn ooxml_type(&self) -> String {
        match self {
            TextField::SlideNumber => "slidenum".to_owned(),
            TextField::DateTime { format: 0 } => "datetime".to_owned(),
            TextField::DateTime { format } => format!("datetime{format}"),
            TextField::Other { kind } => kind.clone(),
        }
    }
}

/// The (US English) pattern of PowerPoint's date/time format `n`
/// (`datetimeN`; 0 and unknown numbers = 1), in Unicode date pattern
/// syntax.
pub fn date_format_pattern(n: u8) -> &'static str {
    match n {
        2 => "EEEE, MMMM d, yyyy",
        3 => "d MMMM yyyy",
        4 => "MMMM d, yyyy",
        5 => "d-MMM-yy",
        6 => "MMMM yy",
        7 => "MMM-yy",
        8 => "M/d/yyyy h:mm a",
        9 => "M/d/yyyy h:mm:ss a",
        10 => "H:mm",
        11 => "H:mm:ss",
        12 => "h:mm a",
        13 => "h:mm:ss a",
        _ => "M/d/yyyy",
    }
}

/// A paragraph (`a:p`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextParagraph {
    /// Paragraph formatting.
    #[serde(default, skip_serializing_if = "TextParagraphProps::is_empty")]
    pub props: TextParagraphProps,
    /// Runs in order.
    #[serde(default)]
    pub runs: Vec<TextRun>,
}

impl TextParagraph {
    /// An empty paragraph without formatting.
    pub fn new() -> Self {
        Self::default()
    }

    /// A paragraph holding one unformatted run (none if `text` is empty).
    pub fn plain(text: &str) -> Self {
        let mut p = Self::new();
        if !text.is_empty() {
            p.runs.push(TextRun::new(text));
        }
        p
    }

    /// An empty paragraph at outline `level` with a `•` bullet.
    pub fn bulleted(level: u8) -> Self {
        Self {
            props: TextParagraphProps {
                level,
                bullet: Some(Bullet::Char("•".to_owned())),
                ..TextParagraphProps::default()
            },
            runs: Vec::new(),
        }
    }

    /// Adds an unformatted run (builder style).
    #[must_use]
    pub fn with_text(mut self, text: &str) -> Self {
        self.runs.push(TextRun::new(text));
        self
    }

    /// The paragraph's text (runs concatenated).
    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }
}

/// The text of a shape (`p:txBody`): body properties and paragraphs.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextBody {
    /// Body properties.
    #[serde(default)]
    pub props: BodyProps,
    /// Paragraphs; [`crate::Presentation::normalize`] keeps at least one.
    #[serde(default)]
    pub paragraphs: Vec<TextParagraph>,
}

impl TextBody {
    /// Default body properties and one unformatted paragraph per line of
    /// `text` (split at `'\n'`; an empty `text` gives one empty paragraph).
    pub fn plain(text: &str) -> Self {
        Self {
            props: BodyProps::default(),
            paragraphs: text.split('\n').map(TextParagraph::plain).collect(),
        }
    }

    /// The text: paragraphs joined by `'\n'`.
    pub fn plain_text(&self) -> String {
        self.paragraphs
            .iter()
            .map(TextParagraph::text)
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Whether the body holds no text.
    pub fn is_empty(&self) -> bool {
        self.paragraphs
            .iter()
            .all(|p| p.runs.iter().all(|r| r.text.is_empty()))
    }

    /// Ensures at least one paragraph (an empty one is added if needed).
    pub fn normalize(&mut self) {
        if self.paragraphs.is_empty() {
            self.paragraphs.push(TextParagraph::new());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_roundtrips_text() {
        let b = TextBody::plain("one\ntwo\n");
        assert_eq!(b.paragraphs.len(), 3);
        assert_eq!(b.plain_text(), "one\ntwo\n");
        assert!(b.paragraphs[2].runs.is_empty());
        let e = TextBody::plain("");
        assert_eq!(e.paragraphs.len(), 1);
        assert!(e.is_empty());
        assert!(!b.is_empty());
    }

    #[test]
    fn bulleted_props() {
        let p = TextParagraph::bulleted(1).with_text("x");
        assert_eq!(p.props.level, 1);
        assert_eq!(p.props.bullet, Some(Bullet::Char("•".into())));
        assert_eq!(p.text(), "x");
        assert!(TextParagraphProps::default().is_empty());
    }

    #[test]
    fn serde_shapes() {
        let p = TextParagraph::bulleted(2).with_text("a");
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"props":{"level":2,"bullet":{"kind":"char","value":"•"}},"runs":[{"text":"a"}]}"#
        );
        assert_eq!(
            serde_json::to_string(&Bullet::None).unwrap(),
            r#"{"kind":"none"}"#
        );
        assert_eq!(
            serde_json::to_string(&TextSpacing::Percent(100_000)).unwrap(),
            r#"{"kind":"percent","value":100000}"#
        );
        // empty props and missing fields round-trip
        let p: TextParagraph = serde_json::from_str("{}").unwrap();
        assert_eq!(p, TextParagraph::new());
        let f = TextRun::field(TextField::DateTime { format: 3 }, "1 May 2026");
        assert_eq!(
            serde_json::to_string(&f).unwrap(),
            r#"{"text":"1 May 2026","field":{"kind":"dateTime","value":{"format":3}}}"#
        );
        assert_eq!(
            serde_json::to_string(&TextField::from_ooxml("datetimeFigureOut")).unwrap(),
            r#"{"kind":"other","value":{"type":"datetimeFigureOut"}}"#
        );
        for t in ["slidenum", "datetime", "datetime13", "datetime14", "x"] {
            assert_eq!(TextField::from_ooxml(t).ooxml_type(), t);
        }
        assert_eq!(date_format_pattern(10), "H:mm");
        let b: TextBody = serde_json::from_str(r#"{"props":{"anchor":"middle"}}"#).unwrap();
        assert_eq!(b.props.anchor, Anchor::Middle);
        assert!(b.props.wrap);
        assert_eq!(b.props.insets, Insets::default());
    }
}
