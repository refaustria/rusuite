//! Wire types shared by every app.
//!
//! * [`DispatchError`]: the one error shape that crosses the IPC/wasm
//!   boundary.
//! * TypeScript-only mirrors of the `core-model` types that appear in app
//!   commands and patches ([`Color`], [`RunProperties`], ...). `core-model`
//!   does not depend on `ts-rs`, so these types copy its serde shape
//!   exactly and exist only to generate the TS definitions; app crates
//!   point at them with `#[ts(as = "...")]`. A test round-trips fully
//!   populated values through both types to catch drift.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An error reply: a stable machine-readable `code` (e.g. `bad_request`,
/// `unknown_sheet`, `invalid_formula`) and a human-readable message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, thiserror::Error)]
#[error("{code}: {message}")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct DispatchError {
    pub code: &'static str,
    pub message: String,
}

impl DispatchError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        DispatchError {
            code,
            message: message.into(),
        }
    }
}

/// Mirror of `core_model::Rgb`: a 6-digit hex string such as `"FF8000"`
/// (a leading `#` and lower case are accepted on input).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct Rgb(pub String);

/// Mirror of `core_model::ThemeColorSlot`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum ThemeColorSlot {
    Dark1,
    Light1,
    Dark2,
    Light2,
    Accent1,
    Accent2,
    Accent3,
    Accent4,
    Accent5,
    Accent6,
    Hyperlink,
    FollowedHyperlink,
}

/// Mirror of `core_model::Color`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum Color {
    Auto,
    Rgb(Rgb),
    #[serde(rename_all = "camelCase")]
    Theme {
        slot: ThemeColorSlot,
        /// `-1.0..=1.0`: negative darkens, positive lightens.
        tint: f64,
    },
}

/// Mirror of `core_model::ThemeFontSlot`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum ThemeFontSlot {
    MajorLatin,
    MinorLatin,
    MajorEastAsian,
    MinorEastAsian,
    MajorComplexScript,
    MinorComplexScript,
}

/// Mirror of `core_model::FontFace`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum FontFace {
    Named(String),
    Theme(ThemeFontSlot),
}

/// Mirror of `core_model::FontSize`: hundredths of a point (11 pt =
/// `1100`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct FontSize(pub u32);

/// Mirror of `core_model::Underline`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum Underline {
    None,
    Single,
    Double,
    Dotted,
    Dashed,
    Wavy,
    Words,
}

/// Mirror of `core_model::VerticalAlign`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum VerticalAlign {
    Baseline,
    Superscript,
    Subscript,
}

/// Mirror of `core_model::RunProperties`: every field optional
/// (absent = inherit).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct RunProperties {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<FontFace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<FontSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<Underline>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<VerticalAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub small_caps: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_caps: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub double_strike: Option<bool>,
    /// Twips (positive = expanded).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub char_spacing: Option<i32>,
    /// Percent (100 = normal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<u16>,
    /// Half-points (0 = off).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kerning: Option<u32>,
    /// Half-points (positive = raised).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emboss: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imprint: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtl: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;

    /// `real` → JSON → mirror → JSON must be identical, and the mirror's
    /// JSON must deserialize back into `real`.
    fn same_shape<R, M>(real: &R)
    where
        R: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
        M: Serialize + DeserializeOwned,
    {
        let json = serde_json::to_value(real).unwrap();
        let mirror: M = serde_json::from_value(json.clone()).unwrap();
        let back = serde_json::to_value(&mirror).unwrap();
        assert_eq!(json, back);
        assert_eq!(&serde_json::from_value::<R>(back).unwrap(), real);
    }

    #[test]
    fn mirrors_match_core_model() {
        use core_model as cm;
        for slot in cm::ThemeColorSlot::ALL {
            same_shape::<_, ThemeColorSlot>(&slot);
            same_shape::<_, Color>(&cm::Color::Theme { slot, tint: -0.25 });
        }
        same_shape::<_, Color>(&cm::Color::Auto);
        same_shape::<_, Color>(&cm::Color::Rgb(cm::Rgb::new(255, 128, 0)));
        let fonts = [
            cm::ThemeFontSlot::MajorLatin,
            cm::ThemeFontSlot::MinorLatin,
            cm::ThemeFontSlot::MajorEastAsian,
            cm::ThemeFontSlot::MinorEastAsian,
            cm::ThemeFontSlot::MajorComplexScript,
            cm::ThemeFontSlot::MinorComplexScript,
        ];
        for f in fonts {
            same_shape::<_, FontFace>(&cm::FontFace::Theme(f));
        }
        let underlines = [
            cm::Underline::None,
            cm::Underline::Single,
            cm::Underline::Double,
            cm::Underline::Dotted,
            cm::Underline::Dashed,
            cm::Underline::Wavy,
            cm::Underline::Words,
        ];
        for u in underlines {
            same_shape::<_, Underline>(&u);
        }
        for v in [
            cm::VerticalAlign::Baseline,
            cm::VerticalAlign::Superscript,
            cm::VerticalAlign::Subscript,
        ] {
            same_shape::<_, VerticalAlign>(&v);
        }
        let full = cm::RunProperties {
            font: Some(cm::FontFace::Named("Arial".into())),
            size: Some(cm::FontSize::from_pt(10.5)),
            bold: Some(true),
            italic: Some(false),
            underline: Some(cm::Underline::Double),
            strike: Some(true),
            color: Some(cm::Color::Rgb(cm::Rgb::new(1, 2, 3))),
            highlight: Some(cm::Color::theme(cm::ThemeColorSlot::Accent2)),
            vertical_align: Some(cm::VerticalAlign::Superscript),
            small_caps: Some(true),
            all_caps: Some(false),
            double_strike: Some(true),
            char_spacing: Some(-20),
            scale: Some(150),
            kerning: Some(28),
            position: Some(-6),
            outline: Some(true),
            shadow: Some(true),
            emboss: Some(false),
            imprint: Some(true),
            hidden: Some(true),
            rtl: Some(true),
        };
        same_shape::<_, RunProperties>(&full);
        same_shape::<_, RunProperties>(&cm::RunProperties::default());
    }

    #[test]
    fn dispatch_error_shape() {
        let e = DispatchError::new("bad_request", "nope");
        assert_eq!(e.to_string(), "bad_request: nope");
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"code":"bad_request","message":"nope"}"#
        );
    }
}
