//! The presentation theme (`a:theme`): colour scheme, font scheme and
//! format scheme, plus colour resolution for the UI.
//!
//! Colours in the model are [`Color`]s (`schemeClr` + `lumMod`/`lumOff`/
//! `tint`/`shade` are folded into a tint when a file is read, see
//! `fmt-pptx`); [`Theme::resolve`] turns them into RGB. The format scheme
//! (`a:fmtScheme`) keeps its own colour description, [`StyleColor`]: a base
//! (the placeholder colour `phClr`, a scheme slot or RGB) and the DrawingML
//! colour modifiers in file units, so theme style lists round-trip exactly.

use core_model::{Color, ColorScheme, FontScheme, Rgb, ThemeColorSlot};
use serde::{Deserialize, Serialize};

use crate::shape::{Fill, LineDash};
use crate::Emu;

/// A presentation theme.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Theme {
    /// Theme name (`a:theme/@name`), e.g. `"Office"`.
    pub name: String,
    /// The 12 theme colours.
    #[cfg_attr(feature = "ts", ts(as = "crate::ts::ColorScheme"))]
    pub colors: ColorScheme,
    /// Major (headings) and minor (body) fonts.
    #[cfg_attr(feature = "ts", ts(as = "crate::ts::FontScheme"))]
    pub fonts: FontScheme,
    /// Fill, line, effect and background style lists (`a:fmtScheme`).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<FormatScheme>"))]
    pub format: FormatScheme,
}

impl Default for Theme {
    /// The Office theme (Office 2013–2022 colours, Calibri Light /
    /// Calibri, Office format scheme).
    fn default() -> Self {
        Self {
            name: "Office".to_owned(),
            colors: ColorScheme::default(),
            fonts: FontScheme::default(),
            format: FormatScheme::default(),
        }
    }
}

impl From<core_model::Theme> for Theme {
    /// Colours and fonts of `t` with the Office format scheme.
    fn from(t: core_model::Theme) -> Self {
        Self {
            name: t.name,
            colors: t.colors,
            fonts: t.fonts,
            format: FormatScheme::default(),
        }
    }
}

impl Theme {
    /// Colours and fonts only (the `core-model` view of the theme).
    pub fn core(&self) -> core_model::Theme {
        core_model::Theme {
            name: self.name.clone(),
            colors: self.colors.clone(),
            fonts: self.fonts.clone(),
        }
    }

    /// The RGB value of `color`; [`Color::Auto`] is Dark 1 (text colour).
    pub fn resolve(&self, color: &Color) -> Rgb {
        color.resolve(&self.colors, self.colors.get(ThemeColorSlot::Dark1))
    }

    /// The RGB value and opacity (`0..=1`) of a format-scheme colour;
    /// `placeholder` stands for `phClr`.
    pub fn resolve_style_color(&self, c: &StyleColor, placeholder: Rgb) -> (Rgb, f64) {
        let base = match c.base {
            ColorBase::Placeholder => placeholder,
            ColorBase::Scheme(slot) => self.colors.get(slot),
            ColorBase::Rgb(rgb) => rgb,
        };
        apply_mods(base, &c.mods)
    }

    /// A style fill resolved to RGB (`placeholder` = the colour of the
    /// style reference, e.g. `bg1` for `p:bgRef idx="1001"`).
    pub fn resolve_style_fill(&self, f: &StyleFill, placeholder: Rgb) -> ResolvedFill {
        match f {
            StyleFill::None => ResolvedFill::None,
            StyleFill::Solid(c) => {
                let (rgb, alpha) = self.resolve_style_color(c, placeholder);
                ResolvedFill::Solid { color: rgb, alpha }
            }
            StyleFill::Gradient(g) => ResolvedFill::Gradient {
                angle_deg: g.angle_deg,
                shape: g.shape,
                stops: g
                    .stops
                    .iter()
                    .map(|s| {
                        let (color, alpha) = self.resolve_style_color(&s.color, placeholder);
                        ResolvedStop {
                            pos: s.pos,
                            color,
                            alpha,
                        }
                    })
                    .collect(),
            },
        }
    }

    /// A model fill resolved to RGB.
    pub fn resolve_fill(&self, f: &Fill) -> ResolvedFill {
        match f {
            Fill::None => ResolvedFill::None,
            Fill::Solid(c) => ResolvedFill::Solid {
                color: self.resolve(c),
                alpha: 1.0,
            },
        }
    }

    /// A slide/layout/master background resolved to RGB: a style
    /// reference `idx` 1001… picks `bg_fill_styles[idx − 1001]`, 1…999
    /// `fill_styles[idx − 1]` (out of range: the last style), filled with
    /// the reference's colour.
    pub fn resolve_background(&self, bg: &Background) -> ResolvedFill {
        match bg {
            Background::Fill(f) => self.resolve_fill(f),
            Background::Style { index, color } => {
                let ph = self.resolve(color);
                let list = if *index >= 1001 {
                    &self.format.bg_fill_styles
                } else {
                    &self.format.fill_styles
                };
                let i = if *index >= 1001 {
                    index - 1001
                } else {
                    index.saturating_sub(1)
                } as usize;
                match list.get(i).or(list.last()) {
                    Some(f) => self.resolve_style_fill(f, ph),
                    None => ResolvedFill::Solid {
                        color: ph,
                        alpha: 1.0,
                    },
                }
            }
        }
    }
}

/// A background (`p:bg`): an explicit fill (`p:bgPr`) or a reference to
/// the theme's background fill styles (`p:bgRef`).
///
/// Serializes as `{"kind":"fill","value":<Fill>}` or
/// `{"kind":"style","value":{"index":1001,"color":<Color>}}`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Background {
    /// An explicit fill.
    Fill(Fill),
    /// A theme style: `index` 1001–1003 = background fill styles 1–3
    /// (1–999 = fill styles), coloured with `color` (`phClr`).
    #[serde(rename_all = "camelCase")]
    Style {
        /// `p:bgRef/@idx`.
        index: u32,
        /// The placeholder colour.
        #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Color"))]
        color: Color,
    },
}

impl Default for Background {
    /// PowerPoint's master default: background style 1 in Light 1
    /// (`p:bgRef idx="1001"` + `bg1`).
    fn default() -> Self {
        Background::Style {
            index: 1001,
            color: Color::theme(ThemeColorSlot::Light1),
        }
    }
}

/// A fill resolved to concrete colours (for rendering).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ResolvedFill {
    /// Transparent.
    None,
    /// One colour with opacity.
    #[serde(rename_all = "camelCase")]
    Solid {
        /// Colour.
        #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Rgb"))]
        color: Rgb,
        /// Opacity `0..=1`.
        alpha: f64,
    },
    /// A gradient.
    #[serde(rename_all = "camelCase")]
    Gradient {
        /// Direction of a linear gradient, clockwise from left → right.
        angle_deg: f64,
        /// Linear or path gradient.
        shape: GradientShape,
        /// Stops by position.
        stops: Vec<ResolvedStop>,
    },
}

/// A resolved gradient stop.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ResolvedStop {
    /// Position `0..=1`.
    pub pos: f64,
    /// Colour.
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Rgb"))]
    pub color: Rgb,
    /// Opacity `0..=1`.
    pub alpha: f64,
}

// --- format scheme ------------------------------------------------------------

/// The base of a format-scheme colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ColorBase {
    /// `a:schemeClr val="phClr"`: the colour of the style reference.
    Placeholder,
    /// A scheme colour.
    Scheme(#[cfg_attr(feature = "ts", ts(as = "app_common::wire::ThemeColorSlot"))] ThemeColorSlot),
    /// An RGB colour (`a:srgbClr`, `a:sysClr/@lastClr`, `a:prstClr`).
    Rgb(#[cfg_attr(feature = "ts", ts(as = "app_common::wire::Rgb"))] Rgb),
}

/// A DrawingML colour modifier with its value in file units (100000 =
/// 100 %).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ColorMod {
    /// `a:tint`: towards white (100000 = unchanged).
    Tint(i32),
    /// `a:shade`: towards black (100000 = unchanged).
    Shade(i32),
    /// `a:satMod`: saturation × value.
    SatMod(i32),
    /// `a:satOff`: saturation + value.
    SatOff(i32),
    /// `a:lumMod`: luminance × value.
    LumMod(i32),
    /// `a:lumOff`: luminance + value.
    LumOff(i32),
    /// `a:hueMod`: hue × value.
    HueMod(i32),
    /// `a:alpha`: opacity.
    Alpha(i32),
}

impl ColorMod {
    /// The DrawingML element name (`tint`, `lumMod`, …).
    pub const fn ooxml_name(&self) -> &'static str {
        match self {
            ColorMod::Tint(_) => "tint",
            ColorMod::Shade(_) => "shade",
            ColorMod::SatMod(_) => "satMod",
            ColorMod::SatOff(_) => "satOff",
            ColorMod::LumMod(_) => "lumMod",
            ColorMod::LumOff(_) => "lumOff",
            ColorMod::HueMod(_) => "hueMod",
            ColorMod::Alpha(_) => "alpha",
        }
    }

    /// The modifier for element `name` with value `val`.
    pub fn from_ooxml(name: &str, val: i32) -> Option<Self> {
        Some(match name {
            "tint" => ColorMod::Tint(val),
            "shade" => ColorMod::Shade(val),
            "satMod" => ColorMod::SatMod(val),
            "satOff" => ColorMod::SatOff(val),
            "lumMod" => ColorMod::LumMod(val),
            "lumOff" => ColorMod::LumOff(val),
            "hueMod" => ColorMod::HueMod(val),
            "alpha" => ColorMod::Alpha(val),
            _ => return None,
        })
    }

    /// The value in file units.
    pub const fn value(&self) -> i32 {
        match *self {
            ColorMod::Tint(v)
            | ColorMod::Shade(v)
            | ColorMod::SatMod(v)
            | ColorMod::SatOff(v)
            | ColorMod::LumMod(v)
            | ColorMod::LumOff(v)
            | ColorMod::HueMod(v)
            | ColorMod::Alpha(v) => v,
        }
    }
}

/// A format-scheme colour: base plus modifiers (applied in order).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct StyleColor {
    /// Base colour.
    pub base: ColorBase,
    /// Modifiers in file order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<ColorMod>>"))]
    pub mods: Vec<ColorMod>,
}

impl StyleColor {
    /// `phClr` with `mods`.
    pub fn placeholder(mods: &[ColorMod]) -> Self {
        Self {
            base: ColorBase::Placeholder,
            mods: mods.to_vec(),
        }
    }

    /// An RGB colour with `mods`.
    pub fn rgb(rgb: Rgb, mods: &[ColorMod]) -> Self {
        Self {
            base: ColorBase::Rgb(rgb),
            mods: mods.to_vec(),
        }
    }
}

/// Linear or path gradient (`a:lin` / `a:path path=…`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum GradientShape {
    /// Along a line at `angle_deg`.
    #[default]
    Linear,
    /// Radial from the centre (`path="circle"`).
    Circle,
    /// Rectangular from the centre (`path="rect"`).
    Rect,
    /// Following the shape (`path="shape"`).
    Shape,
}

/// A gradient stop of a style fill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct GradientStop {
    /// Position `0..=1` (`a:gs/@pos` / 100000).
    pub pos: f64,
    /// Colour.
    pub color: StyleColor,
}

/// A gradient of a style fill (`a:gradFill`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Gradient {
    /// Stops in order.
    pub stops: Vec<GradientStop>,
    /// Linear direction in degrees, clockwise (`a:lin/@ang` / 60000).
    #[serde(default)]
    pub angle_deg: f64,
    /// Linear or path.
    #[serde(default)]
    pub shape: GradientShape,
    /// `rotWithShape`.
    #[serde(default)]
    pub rotate_with_shape: bool,
}

/// A fill of the format scheme's style lists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum StyleFill {
    /// `a:noFill`.
    None,
    /// `a:solidFill`.
    Solid(StyleColor),
    /// `a:gradFill`.
    Gradient(Gradient),
}

/// A line of the format scheme (`a:lnStyleLst/a:ln`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct StyleLine {
    /// Width.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Fill of the line.
    pub fill: StyleFill,
    /// Dash.
    #[serde(default)]
    pub dash: LineDash,
}

/// An outer shadow (`a:outerShdw`) of an effect style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct StyleShadow {
    /// Blur radius.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub blur: Emu,
    /// Offset distance.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub distance: Emu,
    /// Offset direction, degrees clockwise from the x axis.
    pub direction_deg: f64,
    /// Shadow colour.
    pub color: StyleColor,
}

/// An effect style (`a:effectStyle`): only outer shadows are modelled.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct EffectStyle {
    /// Outer shadow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub shadow: Option<StyleShadow>,
}

/// The format scheme (`a:fmtScheme`): three (or more) styles per list,
/// referenced by `p:style` and `p:bgRef` indexes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct FormatScheme {
    /// Scheme name.
    pub name: String,
    /// `a:fillStyleLst` (subtle, moderate, intense).
    pub fill_styles: Vec<StyleFill>,
    /// `a:lnStyleLst`.
    pub line_styles: Vec<StyleLine>,
    /// `a:effectStyleLst`.
    pub effect_styles: Vec<EffectStyle>,
    /// `a:bgFillStyleLst` (`p:bgRef idx` 1001–1003).
    pub bg_fill_styles: Vec<StyleFill>,
}

impl Default for FormatScheme {
    /// The Office format scheme (Office 2013+).
    fn default() -> Self {
        Self::office()
    }
}

/// Shorthands for the scheme definitions.
pub(crate) mod mk {
    use super::*;

    pub fn ph(mods: &[ColorMod]) -> StyleColor {
        StyleColor::placeholder(mods)
    }

    pub fn solid(mods: &[ColorMod]) -> StyleFill {
        StyleFill::Solid(ph(mods))
    }

    pub fn grad(angle_deg: f64, stops: &[(f64, &[ColorMod])]) -> StyleFill {
        StyleFill::Gradient(Gradient {
            stops: stops
                .iter()
                .map(|(pos, mods)| GradientStop {
                    pos: *pos,
                    color: ph(mods),
                })
                .collect(),
            angle_deg,
            shape: GradientShape::Linear,
            rotate_with_shape: true,
        })
    }

    pub fn line(width: i64) -> StyleLine {
        StyleLine {
            width: Emu(width),
            fill: solid(&[]),
            dash: LineDash::Solid,
        }
    }

    pub fn shadow(blur: i64, dist: i64, dir: f64, alpha: i32) -> EffectStyle {
        EffectStyle {
            shadow: Some(StyleShadow {
                blur: Emu(blur),
                distance: Emu(dist),
                direction_deg: dir,
                color: StyleColor::rgb(Rgb::BLACK, &[ColorMod::Alpha(alpha)]),
            }),
        }
    }
}

impl FormatScheme {
    /// PowerPoint's Office format scheme (2013+): a solid and two subtle
    /// gradient fills, 0.5/1/1.5 pt lines, no effects but a soft shadow
    /// on the intense style, and solid / tinted / gradient backgrounds.
    pub fn office() -> Self {
        use mk::*;
        use ColorMod::*;
        FormatScheme {
            name: "Office".to_owned(),
            fill_styles: vec![
                solid(&[]),
                grad(
                    90.0,
                    &[
                        (0.0, &[LumMod(110_000), SatMod(105_000), Tint(67_000)]),
                        (0.5, &[LumMod(105_000), SatMod(103_000), Tint(73_000)]),
                        (1.0, &[LumMod(105_000), SatMod(109_000), Tint(81_000)]),
                    ],
                ),
                grad(
                    90.0,
                    &[
                        (0.0, &[SatMod(103_000), LumMod(102_000), Tint(94_000)]),
                        (0.5, &[SatMod(110_000), LumMod(100_000), Shade(100_000)]),
                        (1.0, &[LumMod(99_000), SatMod(120_000), Shade(78_000)]),
                    ],
                ),
            ],
            line_styles: vec![line(6_350), line(12_700), line(19_050)],
            effect_styles: vec![
                EffectStyle::default(),
                EffectStyle::default(),
                shadow(57_150, 19_050, 90.0, 63_000),
            ],
            bg_fill_styles: vec![
                solid(&[]),
                solid(&[Tint(95_000), SatMod(170_000)]),
                grad(
                    90.0,
                    &[
                        (
                            0.0,
                            &[
                                Tint(93_000),
                                SatMod(150_000),
                                Shade(98_000),
                                LumMod(102_000),
                            ],
                        ),
                        (
                            0.5,
                            &[
                                Tint(98_000),
                                SatMod(130_000),
                                Shade(90_000),
                                LumMod(103_000),
                            ],
                        ),
                        (1.0, &[Shade(63_000), SatMod(120_000)]),
                    ],
                ),
            ],
        }
    }
}

// --- colour arithmetic ---------------------------------------------------------

/// RGB → (hue, saturation, lightness), all in `0..=1` (Python's
/// `colorsys`, as `core_model::apply_tint`).
fn to_hsl(c: Rgb) -> (f64, f64, f64) {
    let r = f64::from(c.r) / 255.0;
    let g = f64::from(c.g) / 255.0;
    let b = f64::from(c.b) / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l <= 0.5 {
        d / (max + min)
    } else {
        d / (2.0 - max - min)
    };
    let (rc, gc, bc) = ((max - r) / d, (max - g) / d, (max - b) / d);
    let h = if r == max {
        bc - gc
    } else if g == max {
        2.0 + rc - bc
    } else {
        4.0 + gc - rc
    };
    ((h / 6.0).rem_euclid(1.0), s, l)
}

/// (hue, saturation, lightness) → RGB, inverse of [`to_hsl`], rounded.
fn from_hsl(h: f64, s: f64, l: f64) -> Rgb {
    let to_u8 = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
    if s == 0.0 {
        let v = to_u8(l);
        return Rgb::new(v, v, v);
    }
    let m2 = if l <= 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let m1 = 2.0 * l - m2;
    let v = |hue: f64| {
        let hue = hue.rem_euclid(1.0);
        if hue < 1.0 / 6.0 {
            m1 + (m2 - m1) * hue * 6.0
        } else if hue < 0.5 {
            m2
        } else if hue < 2.0 / 3.0 {
            m1 + (m2 - m1) * (2.0 / 3.0 - hue) * 6.0
        } else {
            m1
        }
    };
    Rgb::new(
        to_u8(v(h + 1.0 / 3.0)),
        to_u8(v(h)),
        to_u8(v(h - 1.0 / 3.0)),
    )
}

/// Applies DrawingML colour modifiers to `base`, returning the colour and
/// its opacity. `tint`/`shade` mix towards white/black in sRGB, the
/// `sat*`/`lum*`/`hueMod` modifiers work in HSL (an approximation of
/// PowerPoint, which uses linear RGB for tint and shade).
pub fn apply_mods(base: Rgb, mods: &[ColorMod]) -> (Rgb, f64) {
    let mut c = base;
    // consecutive HSL modifiers work on unrounded HSL values
    let mut hsl: Option<(f64, f64, f64)> = None;
    let mut alpha = 1.0;
    for m in mods {
        let v = f64::from(m.value()) / 100_000.0;
        match m {
            ColorMod::Tint(_) | ColorMod::Shade(_) => {
                if let Some((h, s, l)) = hsl.take() {
                    c = from_hsl(h, s, l);
                }
                let k = v.clamp(0.0, 1.0);
                let f = |x: u8| {
                    let x = f64::from(x);
                    let y = if matches!(m, ColorMod::Tint(_)) {
                        255.0 - (255.0 - x) * k
                    } else {
                        x * k
                    };
                    y.round() as u8
                };
                c = Rgb::new(f(c.r), f(c.g), f(c.b));
            }
            ColorMod::Alpha(_) => alpha = v.clamp(0.0, 1.0),
            _ => {
                let (mut h, mut s, mut l) = hsl.unwrap_or_else(|| to_hsl(c));
                match m {
                    ColorMod::SatMod(_) => s *= v,
                    ColorMod::SatOff(_) => s += v,
                    ColorMod::LumMod(_) => l *= v,
                    ColorMod::LumOff(_) => l += v,
                    ColorMod::HueMod(_) => h = (h * v).rem_euclid(1.0),
                    _ => {}
                }
                hsl = Some((h, s.clamp(0.0, 1.0), l.clamp(0.0, 1.0)));
            }
        }
    }
    if let Some((h, s, l)) = hsl {
        c = from_hsl(h, s, l);
    }
    (c, alpha)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_known_colours() {
        let t = Theme::default();
        let s = |slot| Color::theme(slot);
        assert_eq!(t.resolve(&s(ThemeColorSlot::Accent1)).to_hex(), "4472C4");
        assert_eq!(t.resolve(&Color::Auto), Rgb::BLACK);
        // PowerPoint's "Accent 1, Lighter 40%" = lumMod 60000 lumOff 40000
        // (tint 0.4) and "Darker 25%" = lumMod 75000 (tint -0.25)
        let lighter = Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: 0.4,
        };
        assert_eq!(t.resolve(&lighter).to_hex(), "8FAADC");
        let darker = Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: -0.25,
        };
        assert_eq!(t.resolve(&darker).to_hex(), "2F5597");
        // the same through the format-scheme modifiers
        let (rgb, a) = apply_mods(
            Rgb::new(0x44, 0x72, 0xC4),
            &[ColorMod::LumMod(60_000), ColorMod::LumOff(40_000)],
        );
        assert_eq!((rgb.to_hex().as_str(), a), ("8FAADC", 1.0));
        let (rgb, _) = apply_mods(Rgb::new(0x44, 0x72, 0xC4), &[ColorMod::LumMod(75_000)]);
        assert_eq!(rgb.to_hex(), "2F5597");
        let (rgb, a) = apply_mods(
            Rgb::WHITE,
            &[ColorMod::Shade(50_000), ColorMod::Alpha(40_000)],
        );
        assert_eq!((rgb.to_hex().as_str(), a), ("808080", 0.4));
        let (rgb, _) = apply_mods(Rgb::BLACK, &[ColorMod::Tint(25_000)]);
        assert_eq!(rgb.to_hex(), "BFBFBF");
    }

    #[test]
    fn backgrounds_resolve_through_the_style_lists() {
        let t = Theme::default();
        assert_eq!(
            t.resolve_background(&Background::default()),
            ResolvedFill::Solid {
                color: Rgb::WHITE,
                alpha: 1.0
            }
        );
        let grad = t.resolve_background(&Background::Style {
            index: 1003,
            color: Color::theme(ThemeColorSlot::Accent1),
        });
        let ResolvedFill::Gradient { stops, .. } = grad else {
            panic!("{grad:?}")
        };
        assert_eq!(stops.len(), 3);
        assert!(stops[2].color.r < stops[0].color.r);
        assert_eq!(
            t.resolve_background(&Background::Fill(Fill::None)),
            ResolvedFill::None
        );
    }

    #[test]
    fn serde_shapes() {
        let t = Theme::default();
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["format"]["fillStyles"][0]["kind"], "solid");
        assert_eq!(
            json["format"]["fillStyles"][1]["value"]["stops"][0]["color"]["mods"][0],
            serde_json::json!({"kind": "lumMod", "value": 110000})
        );
        let back: Theme = serde_json::from_value(json).unwrap();
        assert_eq!(back, t);
        // a theme without format (older snapshots) gets the Office one
        let core = serde_json::to_value(core_model::Theme::default()).unwrap();
        let t2: Theme = serde_json::from_value(core).unwrap();
        assert_eq!(t2, t);
        assert_eq!(
            serde_json::to_string(&Background::default()).unwrap(),
            r#"{"kind":"style","value":{"index":1001,"color":{"kind":"theme","value":{"slot":"light1","tint":0.0}}}}"#
        );
    }
}
