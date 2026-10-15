//! Cell styles and the deduplicating [`StyleTable`].
//!
//! # Equality and hashing
//!
//! [`CellStyle`] contains `f64`s (the tint of [`Color::Theme`]), so it
//! cannot derive `Eq`/`Hash`. Both are implemented by hand over a borrowed
//! key in which every color is replaced by a [`ColorKey`] that compares
//! tints by bit pattern (`f64::to_bits`). This makes equality reflexive
//! (a `NaN` tint equals itself) and consistent with hashing; the price is
//! that `0.0` and `-0.0` tints are distinct styles, which is harmless
//! (they render identically and only cost one extra table entry).

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use core_model::{
    Color, FontFace, FontSize, Rgb, RunProperties, ThemeColorSlot, Underline, VerticalAlign,
};
use serde::{Deserialize, Serialize};

/// Index into a [`StyleTable`]. `StyleId(0)` is the default style.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct StyleId(pub u32);

impl StyleId {
    /// The default (all-inherit) style.
    pub const DEFAULT: StyleId = StyleId(0);

    pub fn is_default(self) -> bool {
        self == Self::DEFAULT
    }
}

/// Cell background.
///
/// Serializes as `{"kind":"none"}` or
/// `{"kind":"solid","color":{"kind":"rgb","value":"FF0000"}}`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "color")]
pub enum Fill {
    /// Explicitly no fill.
    None,
    /// A solid fill.
    Solid(Color),
}

/// Line style of a cell border side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BorderStyle {
    Thin,
    Medium,
    Thick,
    Dashed,
    Dotted,
    Double,
    Hair,
}

/// One side of a cell border.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderSide {
    pub style: BorderStyle,
    pub color: Color,
}

/// Cell borders; `None` = inherit / no border.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Borders {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSide>,
}

impl Borders {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with `patch`, side by side.
    #[must_use]
    pub fn merged_with(&self, patch: &Borders) -> Borders {
        Borders {
            left: patch.left.or(self.left),
            right: patch.right.or(self.right),
            top: patch.top.or(self.top),
            bottom: patch.bottom.or(self.bottom),
        }
    }
}

/// Horizontal alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HAlign {
    General,
    Left,
    Center,
    Right,
    Fill,
    Justify,
}

/// Vertical alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VAlign {
    Top,
    Center,
    Bottom,
}

/// Cell alignment; every field `None` = inherit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alignment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<HAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical: Option<VAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent: Option<u8>,
}

impl Alignment {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with `patch`, field by field.
    #[must_use]
    pub fn merged_with(&self, patch: &Alignment) -> Alignment {
        Alignment {
            horizontal: patch.horizontal.or(self.horizontal),
            vertical: patch.vertical.or(self.vertical),
            wrap_text: patch.wrap_text.or(self.wrap_text),
            indent: patch.indent.or(self.indent),
        }
    }
}

/// The formatting of a cell. Every part is optional: `None` (or an empty
/// sub-struct) means "inherit / default". `Default` is all-inherit.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    pub font: RunProperties,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Borders::is_default")]
    pub borders: Borders,
    #[serde(default, skip_serializing_if = "Alignment::is_default")]
    pub alignment: Alignment,
    /// Number format code (see [`crate::numfmt`]); `None` = `General`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

impl CellStyle {
    /// Whether every property inherits.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// `self` overlaid with `patch`: every `Some` in `patch` wins; the font
    /// merges via [`RunProperties::merged_with`], borders side by side and
    /// alignment field by field.
    #[must_use]
    pub fn merged_with(&self, patch: &CellStyle) -> CellStyle {
        CellStyle {
            font: self.font.merged_with(&patch.font),
            fill: patch.fill.or(self.fill),
            borders: self.borders.merged_with(&patch.borders),
            alignment: self.alignment.merged_with(&patch.alignment),
            number_format: patch
                .number_format
                .clone()
                .or_else(|| self.number_format.clone()),
        }
    }

    fn key(&self) -> StyleKey<'_> {
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
        } = &self.font;
        let side = |s: &Option<BorderSide>| s.map(|s| (s.style, ColorKey::from(s.color)));
        StyleKey {
            font: font.as_ref(),
            size: *size,
            flags: [*bold, *italic, *strike],
            underline: *underline,
            color: color.map(ColorKey::from),
            highlight: highlight.map(ColorKey::from),
            vertical_align: *vertical_align,
            fill: self.fill.map(|f| match f {
                Fill::None => None,
                Fill::Solid(c) => Some(ColorKey::from(c)),
            }),
            borders: [
                side(&self.borders.left),
                side(&self.borders.right),
                side(&self.borders.top),
                side(&self.borders.bottom),
            ],
            alignment: self.alignment,
            number_format: self.number_format.as_deref(),
        }
    }
}

/// [`Color`] with the tint compared by bit pattern.
#[derive(PartialEq, Eq, Hash)]
enum ColorKey {
    Auto,
    Rgb(Rgb),
    Theme(ThemeColorSlot, u64),
}

impl From<Color> for ColorKey {
    fn from(c: Color) -> Self {
        match c {
            Color::Auto => ColorKey::Auto,
            Color::Rgb(rgb) => ColorKey::Rgb(rgb),
            Color::Theme { slot, tint } => ColorKey::Theme(slot, tint.to_bits()),
        }
    }
}

/// Borrowed, hashable view of a [`CellStyle`] (see the module docs).
#[derive(PartialEq, Eq, Hash)]
struct StyleKey<'a> {
    font: Option<&'a FontFace>,
    size: Option<FontSize>,
    flags: [Option<bool>; 3],
    underline: Option<Underline>,
    color: Option<ColorKey>,
    highlight: Option<ColorKey>,
    vertical_align: Option<VerticalAlign>,
    fill: Option<Option<ColorKey>>,
    borders: [Option<(BorderStyle, ColorKey)>; 4],
    alignment: Alignment,
    number_format: Option<&'a str>,
}

impl PartialEq for CellStyle {
    fn eq(&self, other: &Self) -> bool {
        self.key() == other.key()
    }
}

impl Eq for CellStyle {}

impl Hash for CellStyle {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.key().hash(state);
    }
}

/// Deduplicated list of cell styles. `StyleId(0)` is always
/// [`CellStyle::default()`].
///
/// Serializes as the plain list of styles; deserializing rejects a list
/// whose first entry is not the default style or that contains duplicates
/// (ids would not be stable).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(into = "Vec<CellStyle>", try_from = "Vec<CellStyle>")]
pub struct StyleTable {
    styles: Vec<CellStyle>,
    index: HashMap<CellStyle, StyleId>,
}

impl Default for StyleTable {
    fn default() -> Self {
        Self::new()
    }
}

impl StyleTable {
    /// A table holding only the default style.
    pub fn new() -> Self {
        let mut t = StyleTable {
            styles: Vec::new(),
            index: HashMap::new(),
        };
        t.intern(&CellStyle::default());
        t
    }

    /// The id of `style`, adding it if it is new.
    pub fn intern(&mut self, style: &CellStyle) -> StyleId {
        if let Some(&id) = self.index.get(style) {
            return id;
        }
        let id = StyleId(self.styles.len() as u32);
        self.styles.push(style.clone());
        self.index.insert(style.clone(), id);
        id
    }

    /// The style `id`; unknown ids yield the default style.
    pub fn get(&self, id: StyleId) -> &CellStyle {
        self.styles.get(id.0 as usize).unwrap_or(&self.styles[0])
    }

    pub fn contains(&self, id: StyleId) -> bool {
        (id.0 as usize) < self.styles.len()
    }

    /// Number of distinct styles (at least 1).
    pub fn len(&self) -> usize {
        self.styles.len()
    }

    /// Always `false` (the default style is always present).
    pub fn is_empty(&self) -> bool {
        self.styles.is_empty()
    }

    /// All styles in id order.
    pub fn iter(&self) -> impl Iterator<Item = (StyleId, &CellStyle)> {
        self.styles
            .iter()
            .enumerate()
            .map(|(i, s)| (StyleId(i as u32), s))
    }

    /// Builds a table from an arbitrary list, returning the id each list
    /// entry maps to (duplicates and default entries are merged).
    pub fn from_list(list: &[CellStyle]) -> (StyleTable, Vec<StyleId>) {
        let mut t = StyleTable::new();
        let ids = list.iter().map(|s| t.intern(s)).collect();
        (t, ids)
    }
}

impl From<StyleTable> for Vec<CellStyle> {
    fn from(t: StyleTable) -> Self {
        t.styles
    }
}

impl TryFrom<Vec<CellStyle>> for StyleTable {
    type Error = String;

    fn try_from(list: Vec<CellStyle>) -> Result<Self, Self::Error> {
        let (t, ids) = StyleTable::from_list(&list);
        let canonical = ids.iter().enumerate().all(|(i, id)| id.0 as usize == i);
        if canonical && !list.is_empty() {
            Ok(t)
        } else {
            Err("style table must start with the default style and hold no duplicates".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side(style: BorderStyle) -> BorderSide {
        BorderSide {
            style,
            color: Color::Auto,
        }
    }

    #[test]
    fn interning_dedups() {
        let mut t = StyleTable::new();
        assert_eq!(t.len(), 1);
        assert_eq!(t.intern(&CellStyle::default()), StyleId::DEFAULT);
        let tinted = |tint| CellStyle {
            fill: Some(Fill::Solid(Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint,
            })),
            ..Default::default()
        };
        let a = t.intern(&tinted(0.4));
        assert_eq!(a, StyleId(1));
        assert_eq!(t.intern(&tinted(0.4)), a);
        let b = t.intern(&tinted(-0.25));
        assert_ne!(a, b);
        assert_eq!(t.len(), 3);
        assert_eq!(t.get(b), &tinted(-0.25));
        // NaN tints are reflexive under the bit-pattern key.
        let n = t.intern(&tinted(f64::NAN));
        assert_eq!(t.intern(&tinted(f64::NAN)), n);
        assert_eq!(t.get(StyleId(99)), &CellStyle::default());
    }

    #[test]
    fn merge_per_field() {
        let base = CellStyle {
            font: RunProperties {
                bold: Some(true),
                italic: Some(true),
                ..Default::default()
            },
            fill: Some(Fill::Solid(Color::Rgb(Rgb::new(1, 2, 3)))),
            borders: Borders {
                left: Some(side(BorderStyle::Thin)),
                top: Some(side(BorderStyle::Thin)),
                ..Default::default()
            },
            alignment: Alignment {
                horizontal: Some(HAlign::Center),
                ..Default::default()
            },
            number_format: Some("0.00".into()),
        };
        let patch = CellStyle {
            font: RunProperties {
                bold: Some(false),
                ..Default::default()
            },
            borders: Borders {
                top: Some(side(BorderStyle::Double)),
                bottom: Some(side(BorderStyle::Hair)),
                ..Default::default()
            },
            alignment: Alignment {
                wrap_text: Some(true),
                ..Default::default()
            },
            ..Default::default()
        };
        let m = base.merged_with(&patch);
        assert_eq!(m.font.bold, Some(false));
        assert_eq!(m.font.italic, Some(true));
        assert_eq!(m.fill, base.fill);
        assert_eq!(m.borders.left, Some(side(BorderStyle::Thin)));
        assert_eq!(m.borders.top, Some(side(BorderStyle::Double)));
        assert_eq!(m.borders.right, None);
        assert_eq!(m.borders.bottom, Some(side(BorderStyle::Hair)));
        assert_eq!(m.alignment.horizontal, Some(HAlign::Center));
        assert_eq!(m.alignment.wrap_text, Some(true));
        assert_eq!(m.number_format.as_deref(), Some("0.00"));

        let nf = CellStyle {
            fill: Some(Fill::None),
            number_format: Some("@".into()),
            ..Default::default()
        };
        let m = base.merged_with(&nf);
        assert_eq!(m.fill, Some(Fill::None));
        assert_eq!(m.number_format.as_deref(), Some("@"));
        assert_eq!(base.merged_with(&CellStyle::default()), base);
        assert_eq!(CellStyle::default().merged_with(&base), base);
        assert!(CellStyle::default().is_default() && !base.is_default());
    }

    #[test]
    fn serde_shape() {
        assert_eq!(serde_json::to_string(&CellStyle::default()).unwrap(), "{}");
        let s = CellStyle {
            fill: Some(Fill::Solid(Color::Rgb(Rgb::new(255, 0, 0)))),
            alignment: Alignment {
                wrap_text: Some(true),
                ..Default::default()
            },
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(
            json,
            r#"{"fill":{"kind":"solid","color":{"kind":"rgb","value":"FF0000"}},"alignment":{"wrapText":true}}"#
        );
        assert_eq!(serde_json::from_str::<CellStyle>(&json).unwrap(), s);

        let mut t = StyleTable::new();
        t.intern(&s);
        let json = serde_json::to_string(&t).unwrap();
        let back: StyleTable = serde_json::from_str(&json).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back.get(StyleId(1)), &s);
        assert!(serde_json::from_str::<StyleTable>("[]").is_err());
        assert!(serde_json::from_str::<StyleTable>(&format!(
            "[{json_s},{{}}]",
            json_s = serde_json::to_string(&s).unwrap()
        ))
        .is_err());
    }
}
