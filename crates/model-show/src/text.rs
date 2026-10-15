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
    /// The text.
    pub text: String,
}

impl TextRun {
    /// An unformatted run.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            props: RunProperties::default(),
            text: text.into(),
        }
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
        let b: TextBody = serde_json::from_str(r#"{"props":{"anchor":"middle"}}"#).unwrap();
        assert_eq!(b.props.anchor, Anchor::Middle);
        assert!(b.props.wrap);
        assert_eq!(b.props.insets, Insets::default());
    }
}
