//! Character-run formatting.

use serde::{Deserialize, Serialize};

use crate::color::Color;
use crate::font::{FontFace, FontSize};

/// Underline style of a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Underline {
    /// Explicitly no underline.
    None,
    /// Single line.
    Single,
    /// Double line.
    Double,
    /// Dotted line.
    Dotted,
    /// Dashed line.
    Dashed,
    /// Wavy line.
    Wavy,
}

/// Vertical position of a run relative to the baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VerticalAlign {
    /// Normal position.
    Baseline,
    /// Raised and smaller.
    Superscript,
    /// Lowered and smaller.
    Subscript,
}

/// Character formatting of a run.
///
/// Every field is optional: `None` means "inherit from the style / parent",
/// while `Some(false)` (or e.g. `Some(Underline::None)`) explicitly turns a
/// property off. `None` fields are omitted from the serialized JSON.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProperties {
    /// Font face.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<FontFace>,
    /// Font size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<FontSize>,
    /// Bold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    /// Italic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Underline style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<Underline>,
    /// Single strikethrough.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    /// Text (foreground) color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// Highlight (background) color. [`Color::Auto`] means "no highlight".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<Color>,
    /// Superscript / subscript.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<VerticalAlign>,
}

impl RunProperties {
    /// Returns `true` if no property is set (everything inherits).
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Returns `self` overlaid with `over`: every field that is `Some` in
    /// `over` wins, all others are taken from `self`.
    #[must_use]
    pub fn merged_with(&self, over: &RunProperties) -> RunProperties {
        let mut out = self.clone();
        out.apply(over);
        out
    }

    /// Overlays `over` onto `self` in place: every field that is `Some` in
    /// `over` replaces the corresponding field of `self`.
    pub fn apply(&mut self, over: &RunProperties) {
        // Destructure so that adding a field without handling it fails to compile.
        let RunProperties {
            font,
            size,
            bold,
            italic,
            underline,
            strike,
            color,
            highlight,
            vertical_align,
        } = over;
        if font.is_some() {
            self.font.clone_from(font);
        }
        overlay(&mut self.size, size);
        overlay(&mut self.bold, bold);
        overlay(&mut self.italic, italic);
        overlay(&mut self.underline, underline);
        overlay(&mut self.strike, strike);
        overlay(&mut self.color, color);
        overlay(&mut self.highlight, highlight);
        overlay(&mut self.vertical_align, vertical_align);
    }
}

fn overlay<T: Copy>(base: &mut Option<T>, over: &Option<T>) {
    if over.is_some() {
        *base = *over;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::{Rgb, ThemeColorSlot};

    #[test]
    fn default_is_empty() {
        let p = RunProperties::default();
        assert!(p.is_empty());
        assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
        assert_eq!(serde_json::from_str::<RunProperties>("{}").unwrap(), p);
        let p = RunProperties {
            bold: Some(false),
            ..Default::default()
        };
        assert!(!p.is_empty());
    }

    #[test]
    fn merge_semantics() {
        let base = RunProperties {
            font: Some(FontFace::from("Arial")),
            bold: Some(true),
            italic: Some(true),
            underline: Some(Underline::Single),
            color: Some(Color::Rgb(Rgb::new(1, 2, 3))),
            ..Default::default()
        };
        let over = RunProperties {
            // None: inherit from base
            font: None,
            // Some(false): explicitly off, wins over Some(true)
            bold: Some(false),
            // Some(true) over None
            strike: Some(true),
            underline: Some(Underline::None),
            color: Some(Color::theme(ThemeColorSlot::Accent1)),
            size: Some(FontSize::from_pt(12.0)),
            ..Default::default()
        };
        let m = base.merged_with(&over);
        assert_eq!(m.font, Some(FontFace::from("Arial")));
        assert_eq!(m.bold, Some(false));
        assert_eq!(m.italic, Some(true));
        assert_eq!(m.strike, Some(true));
        assert_eq!(m.underline, Some(Underline::None));
        assert_eq!(m.color, Some(Color::theme(ThemeColorSlot::Accent1)));
        assert_eq!(m.size, Some(FontSize::from_pt(12.0)));
        assert_eq!(m.highlight, None);
        assert_eq!(m.vertical_align, None);

        // merging with empty is identity, both ways
        assert_eq!(base.merged_with(&RunProperties::default()), base);
        assert_eq!(RunProperties::default().merged_with(&base), base);

        let mut applied = base.clone();
        applied.apply(&over);
        assert_eq!(applied, m);
    }

    #[test]
    fn font_override() {
        let base = RunProperties {
            font: Some(FontFace::from("Arial")),
            ..Default::default()
        };
        let over = RunProperties {
            font: Some(FontFace::Theme(crate::font::ThemeFontSlot::MinorLatin)),
            ..Default::default()
        };
        assert_eq!(base.merged_with(&over).font, over.font);
    }
}
