//! Picture adjustments: crop, brightness/contrast, recolouring,
//! transparency, outline shape and shadow (`p:pic` → `a:srcRect`,
//! `a:blip` effects, `a:prstGeom`, `a:effectLst/a:outerShdw`).

use core_model::{Color, Rgb};
use serde::{Deserialize, Serialize};

use crate::geometry::Preset;
use crate::Emu;

/// Crop of a picture as fractions of the image cut off each edge
/// (`a:srcRect l t r b` / 100000). Negative values pad the image.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Crop {
    /// Left edge.
    pub left: f64,
    /// Top edge.
    pub top: f64,
    /// Right edge.
    pub right: f64,
    /// Bottom edge.
    pub bottom: f64,
}

impl Crop {
    /// Whether nothing is cropped.
    pub fn is_none(&self) -> bool {
        *self == Crop::default()
    }

    /// Fraction of the image width that remains visible.
    pub fn visible_w(&self) -> f64 {
        1.0 - self.left - self.right
    }

    /// Fraction of the image height that remains visible.
    pub fn visible_h(&self) -> f64 {
        1.0 - self.top - self.bottom
    }
}

/// Recolouring of a picture.
///
/// Serializes as `{"kind":"none"}`, `{"kind":"grayscale"}`,
/// `{"kind":"sepia"}`, `{"kind":"blackWhite","value":{"threshold":0.5}}`
/// or `{"kind":"duotone","value":{"dark":"000000","light":"D9C3A5"}}`.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Recolor {
    /// Original colours.
    #[default]
    None,
    /// Grayscale (`a:grayscl`).
    Grayscale,
    /// Sepia (written as `a:duotone` black → [`Recolor::SEPIA_LIGHT`]).
    Sepia,
    /// Black and white (`a:biLevel thresh`): pixels with luminance
    /// below `threshold` (`0..=1`) become black, the others white.
    #[serde(rename_all = "camelCase")]
    BlackWhite {
        /// Threshold `0..=1`.
        threshold: f64,
    },
    /// Two-colour recolouring (`a:duotone`): black → `dark`, white →
    /// `light`.
    #[serde(rename_all = "camelCase")]
    Duotone {
        /// Colour of black.
        #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Rgb"))]
        dark: Rgb,
        /// Colour of white.
        #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Rgb"))]
        light: Rgb,
    },
}

impl Recolor {
    /// The light colour of [`Recolor::Sepia`] (PowerPoint's sepia
    /// duotone, `bg2`-free approximation).
    pub const SEPIA_LIGHT: Rgb = Rgb::new(0xD9, 0xC3, 0xA5);
}

/// An outer shadow of a picture (`a:outerShdw`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Shadow {
    /// Colour.
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::Color"))]
    pub color: Color,
    /// Opacity `0..=1` (`a:alpha`).
    pub alpha: f64,
    /// Blur radius (`blurRad`).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub blur: Emu,
    /// Offset distance (`dist`).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub distance: Emu,
    /// Offset direction in degrees clockwise from the x axis (`dir`).
    pub direction_deg: f64,
}

impl Default for Shadow {
    /// PowerPoint's "Offset: Bottom Right": black at 40 %, 4 pt blur,
    /// 3 pt at 45°.
    fn default() -> Self {
        Shadow {
            color: Color::Rgb(Rgb::BLACK),
            alpha: 0.4,
            blur: Emu(50_800),
            distance: Emu(38_100),
            direction_deg: 45.0,
        }
    }
}

impl Shadow {
    /// Horizontal and vertical offset.
    pub fn offset(&self) -> (f64, f64) {
        let (s, c) = self.direction_deg.to_radians().sin_cos();
        (self.distance.0 as f64 * c, self.distance.0 as f64 * s)
    }
}

/// Adjustments of a picture. Brightness and contrast follow PowerPoint's
/// "Picture Corrections" (`a:lum bright contrast`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct PictureProps {
    /// Crop.
    #[serde(skip_serializing_if = "Crop::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Crop>"))]
    pub crop: Crop,
    /// Brightness `-1..=1` (0 = unchanged).
    #[serde(skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<f64>"))]
    pub brightness: f64,
    /// Contrast `-1..=1` (0 = unchanged).
    #[serde(skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<f64>"))]
    pub contrast: f64,
    /// Recolouring.
    #[serde(skip_serializing_if = "is_no_recolor")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Recolor>"))]
    pub recolor: Recolor,
    /// Transparency `0..=1` (0 = opaque; `a:alphaModFix amt` = 1 − t).
    #[serde(skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<f64>"))]
    pub transparency: f64,
    /// Outline shape of the picture (`None` = rectangle).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub geometry: Option<Preset>,
    /// Outer shadow.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub shadow: Option<Shadow>,
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

fn is_no_recolor(v: &Recolor) -> bool {
    *v == Recolor::None
}

impl PictureProps {
    /// Whether nothing is adjusted.
    pub fn is_default(&self) -> bool {
        *self == PictureProps::default()
    }

    /// The `(slope, intercept)` of the per-channel linear transfer
    /// `out = slope · in + intercept` (channels in `0..=1`) that
    /// brightness and contrast apply: contrast `c` scales around 0.5
    /// (`slope = 1/(1−c)` for `c > 0`, `1 + c` otherwise), brightness `b`
    /// shifts by `b`.
    pub fn transfer(&self) -> (f64, f64) {
        let c = self.contrast.clamp(-1.0, 0.99);
        let slope = if c > 0.0 { 1.0 / (1.0 - c) } else { 1.0 + c };
        (slope, 0.5 - 0.5 * slope + self.brightness.clamp(-1.0, 1.0))
    }

    /// A CSS `filter` value approximating the adjustments (empty when
    /// nothing is set): `grayscale(1)`/`sepia(1)` for recolouring
    /// (black and white and duotone are approximated by
    /// `grayscale(1) contrast(…)` and `sepia(1)`), `brightness()` and
    /// `contrast()` from [`transfer`](Self::transfer), `opacity()` from
    /// the transparency and `drop-shadow()` from the shadow (offsets in
    /// px at 96 dpi). Crop and shape are not filters (see
    /// `docs/pptx-suite.md`).
    pub fn css_filter(&self, resolve: impl Fn(&Color) -> Rgb) -> String {
        let mut out: Vec<String> = Vec::new();
        let num = |v: f64| {
            let s = format!("{:.3}", v);
            s.trim_end_matches('0').trim_end_matches('.').to_owned()
        };
        match self.recolor {
            Recolor::None => {}
            Recolor::Grayscale => out.push("grayscale(1)".into()),
            Recolor::Sepia | Recolor::Duotone { .. } => out.push("sepia(1)".into()),
            Recolor::BlackWhite { .. } => {
                out.push("grayscale(1)".into());
                out.push("contrast(100)".into());
            }
        }
        if self.brightness != 0.0 {
            out.push(format!("brightness({})", num(1.0 + self.brightness)));
        }
        if self.contrast != 0.0 {
            out.push(format!("contrast({})", num(self.transfer().0)));
        }
        if self.transparency != 0.0 {
            out.push(format!(
                "opacity({})",
                num(1.0 - self.transparency.clamp(0.0, 1.0))
            ));
        }
        if let Some(s) = &self.shadow {
            let px = |emu: f64| emu / 9_525.0;
            let (dx, dy) = s.offset();
            let c = resolve(&s.color);
            out.push(format!(
                "drop-shadow({}px {}px {}px rgba({}, {}, {}, {}))",
                num(px(dx)),
                num(px(dy)),
                num(px(s.blur.0 as f64) / 2.0),
                c.r,
                c.g,
                c.b,
                num(s.alpha)
            ));
        }
        out.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_and_transfer() {
        let black = |_: &Color| Rgb::BLACK;
        assert_eq!(PictureProps::default().css_filter(black), "");
        let p = PictureProps {
            brightness: 0.2,
            contrast: 0.5,
            recolor: Recolor::Grayscale,
            transparency: 0.25,
            shadow: Some(Shadow::default()),
            ..PictureProps::default()
        };
        assert_eq!(p.transfer(), (2.0, -0.3));
        assert_eq!(
            p.css_filter(black),
            "grayscale(1) brightness(1.2) contrast(2) opacity(0.75) drop-shadow(2.828px 2.828px 2.667px rgba(0, 0, 0, 0.4))"
        );
        let soft = PictureProps {
            contrast: -0.4,
            ..PictureProps::default()
        };
        assert_eq!(soft.transfer(), (0.6, 0.2));
    }

    #[test]
    fn serde_skips_defaults() {
        assert_eq!(
            serde_json::to_string(&PictureProps::default()).unwrap(),
            "{}"
        );
        let p = PictureProps {
            crop: Crop {
                left: 0.1,
                ..Crop::default()
            },
            recolor: Recolor::BlackWhite { threshold: 0.5 },
            ..PictureProps::default()
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(
            json,
            r#"{"crop":{"left":0.1,"top":0.0,"right":0.0,"bottom":0.0},"recolor":{"kind":"blackWhite","value":{"threshold":0.5}}}"#
        );
        assert_eq!(serde_json::from_str::<PictureProps>(&json).unwrap(), p);
        assert!((p.crop.visible_w() - 0.9).abs() < 1e-12);
    }
}
