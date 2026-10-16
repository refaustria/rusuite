//! Built-in themes: the Office theme plus seven Rusuite designs (own
//! names, colour palettes, font pairings and format schemes – not copies of
//! Microsoft's named themes, see `docs/legal-notes.md`). Fonts are only
//! named, never shipped.

use core_model::{Color, ColorScheme, FontScheme, Rgb, ThemeColorSlot};
use serde::{Deserialize, Serialize};

use crate::theme::mk::{grad, line, shadow, solid};
use crate::theme::{Background, ColorMod, EffectStyle, FormatScheme, Theme};

/// A built-in theme with the master background it brings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct BuiltinTheme {
    /// Stable id (`"office"`, `"harbor"`, …).
    pub id: String,
    /// The theme (its `name` is the display name).
    pub theme: Theme,
    /// The master background the theme sets when applied.
    pub background: Background,
}

/// The ids of the built-in themes, in gallery order.
pub const BUILTIN_THEME_IDS: [&str; 8] = [
    "office",
    "harbor",
    "meadow",
    "ember",
    "basalt",
    "orchard",
    "lagoon",
    "sandstone",
];

fn hex(s: &str) -> Rgb {
    Rgb::from_hex(s).unwrap_or_default()
}

fn colors(name: &str, c: [&str; 12]) -> ColorScheme {
    ColorScheme {
        name: name.to_owned(),
        colors: c.map(hex),
    }
}

fn fonts(name: &str, major: &str, minor: &str) -> FontScheme {
    FontScheme {
        name: name.to_owned(),
        major_latin: major.to_owned(),
        minor_latin: minor.to_owned(),
        major_east_asian: String::new(),
        minor_east_asian: String::new(),
        major_complex_script: String::new(),
        minor_complex_script: String::new(),
    }
}

/// A format scheme of the Rusuite designs: `soft` gradients (tint/shade
/// strength), line widths and the intense shadow's opacity vary per
/// design.
fn scheme(name: &str, tint: i32, shade: i32, lines: [i64; 3], shadow_alpha: i32) -> FormatScheme {
    use ColorMod::*;
    FormatScheme {
        name: name.to_owned(),
        fill_styles: vec![
            solid(&[]),
            grad(
                90.0,
                &[
                    (0.0, &[Tint(tint), SatMod(105_000)]),
                    (1.0, &[Tint(tint + (100_000 - tint) / 2), SatMod(100_000)]),
                ],
            ),
            grad(
                90.0,
                &[
                    (0.0, &[Shade(100_000), SatMod(110_000)]),
                    (1.0, &[Shade(shade), SatMod(115_000)]),
                ],
            ),
        ],
        line_styles: lines.iter().map(|w| line(*w)).collect(),
        effect_styles: vec![
            EffectStyle::default(),
            EffectStyle::default(),
            shadow(50_800, 25_400, 90.0, shadow_alpha),
        ],
        bg_fill_styles: vec![
            solid(&[]),
            solid(&[Tint(tint), SatMod(120_000)]),
            grad(
                90.0,
                &[
                    (0.0, &[Tint(tint + (100_000 - tint) / 3)]),
                    (
                        1.0,
                        &[Shade(shade + (100_000 - shade) / 2), SatMod(110_000)],
                    ),
                ],
            ),
        ],
    }
}

fn bg(index: u32, slot: ThemeColorSlot) -> Background {
    Background::Style {
        index,
        color: Color::theme(slot),
    }
}

/// The built-in theme `id`.
pub fn builtin_theme(id: &str) -> Option<BuiltinTheme> {
    use ThemeColorSlot::{Light1, Light2};
    let (name, colors, fonts, format, background) = match id {
        "office" => {
            let t = Theme::default();
            return Some(BuiltinTheme {
                id: id.to_owned(),
                theme: t,
                background: Background::default(),
            });
        }
        "harbor" => (
            "Harbor",
            colors(
                "Harbor",
                [
                    "1B1F24", "FFFFFF", "1F3A5F", "E6EEF5", "2E6F9E", "3FA7A3", "F2A541", "D9534F",
                    "6C8EBF", "8BB174", "2E6F9E", "7A5C99",
                ],
            ),
            fonts("Harbor", "Georgia", "Verdana"),
            scheme("Harbor", 60_000, 75_000, [9_525, 15_875, 28_575], 45_000),
            bg(1001, Light1),
        ),
        "meadow" => (
            "Meadow",
            colors(
                "Meadow",
                [
                    "222B1F", "FFFFFF", "36502E", "EEF3E6", "5B8C3A", "A3C14A", "E0B341", "C9663D",
                    "4F8A8B", "9A7AA0", "3B7D3A", "7D6B91",
                ],
            ),
            fonts("Meadow", "Trebuchet MS", "Segoe UI"),
            scheme("Meadow", 50_000, 80_000, [6_350, 12_700, 25_400], 35_000),
            bg(1002, Light2),
        ),
        "ember" => (
            "Ember",
            colors(
                "Ember",
                [
                    "2B1D1A", "FFFFFF", "5A2A1F", "F8EDE6", "C2462B", "E8833A", "F2C14E", "8E5A9A",
                    "3E7CB1", "6B8E4E", "C2462B", "8E5A9A",
                ],
            ),
            fonts("Ember", "Franklin Gothic Medium", "Franklin Gothic Book"),
            scheme("Ember", 45_000, 65_000, [12_700, 19_050, 31_750], 55_000),
            bg(1003, Light2),
        ),
        "basalt" => (
            "Basalt",
            colors(
                "Basalt",
                [
                    "1A1A1A", "FFFFFF", "3A3F44", "ECEDEE", "4A90A4", "A4C639", "F5A623", "D0021B",
                    "7B8D8E", "9B59B6", "4A90A4", "7B8D8E",
                ],
            ),
            fonts("Basalt", "Century Gothic", "Century Gothic"),
            scheme("Basalt", 70_000, 70_000, [9_525, 19_050, 38_100], 60_000),
            bg(1001, Light1),
        ),
        "orchard" => (
            "Orchard",
            colors(
                "Orchard",
                [
                    "2A2133", "FFFFFF", "4B2E5C", "F3EEF6", "8E44AD", "D35D6E", "F0A04B", "5DA271",
                    "3D8EB9", "B8860B", "6C3483", "A569BD",
                ],
            ),
            fonts("Orchard", "Palatino Linotype", "Gill Sans MT"),
            scheme("Orchard", 55_000, 72_000, [6_350, 15_875, 25_400], 40_000),
            bg(1002, Light2),
        ),
        "lagoon" => (
            "Lagoon",
            colors(
                "Lagoon",
                [
                    "102A33", "FFFFFF", "0E4D5C", "E3F4F4", "00A6A6", "FF7F50", "FFD166", "118AB2",
                    "6A4C93", "8AC926", "118AB2", "6A4C93",
                ],
            ),
            fonts("Lagoon", "Segoe UI Light", "Segoe UI"),
            scheme("Lagoon", 40_000, 78_000, [9_525, 12_700, 22_225], 30_000),
            bg(1003, Light1),
        ),
        "sandstone" => (
            "Sandstone",
            colors(
                "Sandstone",
                [
                    "2E2A24", "FFFFFF", "5C4B37", "F4EFE6", "B5835A", "7A9E7E", "D4A373", "8C6E54",
                    "5F7C8A", "C9816B", "7A5B3A", "8C6E54",
                ],
            ),
            fonts("Sandstone", "Book Antiqua", "Garamond"),
            scheme("Sandstone", 65_000, 68_000, [6_350, 12_700, 19_050], 50_000),
            bg(1003, Light2),
        ),
        _ => return None,
    };
    Some(BuiltinTheme {
        id: id.to_owned(),
        theme: Theme {
            name: name.to_owned(),
            colors,
            fonts,
            format,
        },
        background,
    })
}

/// All built-in themes, in gallery order.
pub fn builtin_themes() -> Vec<BuiltinTheme> {
    BUILTIN_THEME_IDS
        .iter()
        .filter_map(|id| builtin_theme(id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::ResolvedFill;

    #[test]
    fn eight_distinct_themes() {
        let all = builtin_themes();
        assert_eq!(all.len(), 8);
        let mut names: Vec<_> = all.iter().map(|t| t.theme.name.clone()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 8);
        let mut accents: Vec<_> = all
            .iter()
            .map(|t| t.theme.colors.get(ThemeColorSlot::Accent1))
            .collect();
        accents.sort_by_key(|c| c.to_hex());
        accents.dedup();
        assert_eq!(accents.len(), 8);
        for t in &all {
            let f = &t.theme.format;
            assert_eq!(
                (
                    f.fill_styles.len(),
                    f.line_styles.len(),
                    f.effect_styles.len(),
                    f.bg_fill_styles.len()
                ),
                (3, 3, 3, 3),
                "{}",
                t.id
            );
            // every background resolves to something visible
            assert_ne!(
                t.theme.resolve_background(&t.background),
                ResolvedFill::None,
                "{}",
                t.id
            );
            assert!(!t.theme.fonts.major_latin.is_empty());
        }
        assert_eq!(builtin_theme("office").unwrap().theme, Theme::default());
        assert!(builtin_theme("facet").is_none());
        let lagoon = builtin_theme("lagoon").unwrap();
        assert_eq!(
            lagoon.theme.resolve(&Color::theme(ThemeColorSlot::Accent2)),
            hex("FF7F50")
        );
    }
}
