//! Style sets (Word's Design › Document Formatting gallery): the document
//! defaults plus the formatting of Normal, Title, Subtitle and Heading 1–3.
//! Applying one replaces that formatting in the [`StyleSheet`]; the result
//! is ordinary style definitions in `styles.xml` (Word does not record
//! which set was applied). "Save as a New Style Set" is
//! [`StyleSheet::capture_style_set`].
//!
//! The built-in sets approximate Word's visual definitions with theme fonts
//! and accent colours: Word 2013 (the default), Basic, Black & White,
//! Casual, Centered, Elegant, Lines, Minimalist, Modern and Shaded.

use core_model::units::Twips;
use core_model::{Color, FontFace, FontSize, RunProperties, ThemeColorSlot, ThemeFontSlot};
use serde::{Deserialize, Serialize};

use crate::props::{
    Alignment, BorderSide, BorderStyle, LineSpacing, ParagraphBorders, ParagraphProperties, Spacing,
};
use crate::style::{Defaults, Style, StyleKind, StyleSheet};

/// The formatting a style set gives one style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct StyleSetEntry {
    /// Style id (`Normal`, `Title`, `Heading1`, …).
    pub id: String,
    /// The style's name, used when the document lacks the style.
    pub name: String,
    /// Paragraph formatting of the style.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
    /// Run formatting of the style.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
}

/// A style set: document defaults and the formatting of the main styles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct StyleSet {
    /// Identifier: a built-in id (`shaded`, …) or the user's name.
    pub id: String,
    /// The document defaults the set brings.
    pub defaults: Defaults,
    /// The styles it formats.
    pub styles: Vec<StyleSetEntry>,
}

/// The styles a style set formats.
pub const STYLE_SET_IDS: &[&str] = &[
    "Normal", "Title", "Subtitle", "Heading1", "Heading2", "Heading3",
];

/// The ids of the built-in style sets, in gallery order.
pub const BUILTIN_STYLE_SETS: &[&str] = &[
    "word",
    "basic",
    "blackWhite",
    "casual",
    "centered",
    "elegant",
    "lines",
    "minimalist",
    "modern",
    "shaded",
];

fn name_of(id: &str) -> &'static str {
    match id {
        "Normal" => "Normal",
        "Title" => "Title",
        "Subtitle" => "Subtitle",
        "Heading1" => "heading 1",
        "Heading2" => "heading 2",
        _ => "heading 3",
    }
}

/// Small builder for the built-in definitions.
#[derive(Clone, Default)]
struct Look {
    font: Option<FontFace>,
    size: Option<f64>,
    color: Option<Color>,
    bold: bool,
    italic: bool,
    caps: bool,
    small_caps: bool,
    spacing_pt: Option<f64>,
    before: Option<i32>,
    after: Option<i32>,
    line: Option<LineSpacing>,
    align: Option<Alignment>,
    bottom_rule: Option<Color>,
    shading: Option<Color>,
}

impl Look {
    fn run(&self) -> RunProperties {
        RunProperties {
            font: self.font.clone(),
            size: self.size.map(FontSize::from_pt),
            color: self.color,
            bold: self.bold.then_some(true),
            italic: self.italic.then_some(true),
            all_caps: self.caps.then_some(true),
            small_caps: self.small_caps.then_some(true),
            char_spacing: self.spacing_pt.map(|p| (p * 20.0).round() as i32),
            ..Default::default()
        }
    }

    fn paragraph(&self, heading: Option<u8>) -> ParagraphProperties {
        let spacing =
            (self.before.is_some() || self.after.is_some() || self.line.is_some()).then(|| {
                Spacing {
                    before: self.before.map(Twips),
                    after: self.after.map(Twips),
                    line: self.line,
                }
            });
        ParagraphProperties {
            alignment: self.align,
            spacing,
            keep_next: heading.map(|_| true),
            outline_level: heading.map(|l| l - 1),
            borders: self.bottom_rule.map(|c| ParagraphBorders {
                bottom: Some(BorderSide {
                    space: Some(1),
                    ..BorderSide::new(BorderStyle::Single, BorderSide::width_from_eighths(8), c)
                }),
                ..Default::default()
            }),
            shading: self.shading,
            ..Default::default()
        }
    }
}

const fn theme(slot: ThemeColorSlot, tint: f64) -> Color {
    Color::Theme { slot, tint }
}

fn major() -> Option<FontFace> {
    Some(FontFace::Theme(ThemeFontSlot::MajorLatin))
}

fn minor() -> Option<FontFace> {
    Some(FontFace::Theme(ThemeFontSlot::MinorLatin))
}

const ACCENT1: Color = theme(ThemeColorSlot::Accent1, 0.0);
const ACCENT1_DARK: Color = theme(ThemeColorSlot::Accent1, -0.25);
const ACCENT1_DARKER: Color = theme(ThemeColorSlot::Accent1, -0.5);
const ACCENT2: Color = theme(ThemeColorSlot::Accent2, 0.0);
const ACCENT2_DARK: Color = theme(ThemeColorSlot::Accent2, -0.25);
const TEXT1: Color = theme(ThemeColorSlot::Dark1, 0.0);
const TEXT1_LIGHT: Color = theme(ThemeColorSlot::Dark1, 0.35);
const LIGHT1: Color = theme(ThemeColorSlot::Light1, 0.0);

/// Document defaults: minor font, `size` pt, `after` twips after,
/// `line` 240ths.
fn defaults(size: f64, after: i32, line: i32) -> Defaults {
    Defaults {
        run: RunProperties {
            font: minor(),
            size: Some(FontSize::from_pt(size)),
            ..Default::default()
        },
        paragraph: ParagraphProperties {
            spacing: Some(Spacing {
                before: None,
                after: Some(Twips(after)),
                line: Some(LineSpacing::from_240ths(line)),
            }),
            ..Default::default()
        },
    }
}

impl StyleSet {
    /// The built-in set `id` (see [`BUILTIN_STYLE_SETS`]), or `None`.
    pub fn builtin(id: &str) -> Option<StyleSet> {
        let h = |size: f64, color: Color| Look {
            font: major(),
            size: Some(size),
            color: Some(color),
            ..Default::default()
        };
        let title = |size: f64| Look {
            font: major(),
            size: Some(size),
            after: Some(0),
            line: Some(LineSpacing::Multiple(1.0)),
            ..Default::default()
        };
        let subtitle = Look {
            color: Some(TEXT1_LIGHT),
            ..Default::default()
        };
        // (defaults, title, subtitle, heading 1–3)
        let (defs, t, st, h1, h2, h3) = match id {
            "word" => (
                defaults(11.0, 160, 259),
                title(28.0),
                subtitle,
                Look {
                    before: Some(240),
                    after: Some(0),
                    ..h(16.0, ACCENT1_DARK)
                },
                Look {
                    before: Some(40),
                    after: Some(0),
                    ..h(13.0, ACCENT1_DARK)
                },
                Look {
                    before: Some(40),
                    after: Some(0),
                    ..h(12.0, ACCENT1_DARKER)
                },
            ),
            "basic" => (
                defaults(11.0, 200, 276),
                Look {
                    color: Some(ACCENT1),
                    caps: true,
                    ..title(26.0)
                },
                Look {
                    caps: true,
                    spacing_pt: Some(1.0),
                    ..subtitle
                },
                Look {
                    caps: true,
                    before: Some(300),
                    after: Some(40),
                    ..h(14.0, ACCENT1_DARK)
                },
                Look {
                    caps: true,
                    before: Some(120),
                    after: Some(40),
                    ..h(12.0, ACCENT1)
                },
                Look {
                    font: minor(),
                    bold: true,
                    before: Some(120),
                    after: Some(40),
                    ..h(11.0, ACCENT1_DARK)
                },
            ),
            "blackWhite" => (
                defaults(11.0, 160, 259),
                Look {
                    bold: true,
                    color: Some(TEXT1),
                    ..title(28.0)
                },
                Look {
                    italic: true,
                    color: Some(TEXT1),
                    ..Default::default()
                },
                Look {
                    bold: true,
                    before: Some(360),
                    after: Some(120),
                    ..h(16.0, TEXT1)
                },
                Look {
                    bold: true,
                    before: Some(240),
                    after: Some(80),
                    ..h(13.0, TEXT1)
                },
                Look {
                    bold: true,
                    italic: true,
                    before: Some(200),
                    after: Some(40),
                    ..h(12.0, TEXT1)
                },
            ),
            "casual" => (
                defaults(11.0, 200, 276),
                Look {
                    color: Some(ACCENT2_DARK),
                    italic: true,
                    ..title(30.0)
                },
                Look {
                    color: Some(ACCENT2),
                    ..subtitle
                },
                Look {
                    before: Some(360),
                    after: Some(80),
                    ..h(18.0, ACCENT2_DARK)
                },
                Look {
                    italic: true,
                    before: Some(200),
                    after: Some(40),
                    ..h(14.0, ACCENT2)
                },
                Look {
                    before: Some(160),
                    after: Some(40),
                    ..h(12.0, ACCENT2_DARK)
                },
            ),
            "centered" => (
                defaults(11.0, 160, 259),
                Look {
                    caps: true,
                    spacing_pt: Some(2.0),
                    align: Some(Alignment::Center),
                    ..title(26.0)
                },
                Look {
                    align: Some(Alignment::Center),
                    ..subtitle
                },
                Look {
                    caps: true,
                    align: Some(Alignment::Center),
                    before: Some(360),
                    after: Some(120),
                    ..h(14.0, ACCENT1)
                },
                Look {
                    align: Some(Alignment::Center),
                    before: Some(200),
                    after: Some(80),
                    ..h(13.0, ACCENT1_DARK)
                },
                Look {
                    italic: true,
                    align: Some(Alignment::Center),
                    before: Some(160),
                    after: Some(40),
                    ..h(12.0, ACCENT1_DARK)
                },
            ),
            "elegant" => (
                defaults(11.0, 200, 276),
                Look {
                    small_caps: true,
                    spacing_pt: Some(1.0),
                    color: Some(ACCENT1_DARKER),
                    ..title(28.0)
                },
                Look {
                    italic: true,
                    ..subtitle
                },
                Look {
                    small_caps: true,
                    before: Some(400),
                    after: Some(120),
                    ..h(16.0, ACCENT1_DARKER)
                },
                Look {
                    small_caps: true,
                    before: Some(240),
                    after: Some(80),
                    ..h(14.0, ACCENT1_DARK)
                },
                Look {
                    italic: true,
                    before: Some(200),
                    after: Some(40),
                    ..h(12.0, ACCENT1_DARK)
                },
            ),
            "lines" => (
                defaults(11.0, 160, 259),
                Look {
                    bottom_rule: Some(ACCENT1),
                    after: Some(240),
                    ..title(28.0)
                },
                subtitle,
                Look {
                    bottom_rule: Some(ACCENT1),
                    before: Some(360),
                    after: Some(120),
                    ..h(16.0, ACCENT1_DARK)
                },
                Look {
                    bottom_rule: Some(theme(ThemeColorSlot::Accent1, 0.6)),
                    before: Some(240),
                    after: Some(80),
                    ..h(13.0, ACCENT1_DARK)
                },
                Look {
                    before: Some(160),
                    after: Some(40),
                    ..h(12.0, ACCENT1_DARKER)
                },
            ),
            "minimalist" => (
                defaults(10.5, 180, 264),
                Look {
                    spacing_pt: Some(-0.5),
                    color: Some(TEXT1_LIGHT),
                    ..title(24.0)
                },
                Look {
                    caps: true,
                    spacing_pt: Some(1.5),
                    ..subtitle
                },
                Look {
                    caps: true,
                    spacing_pt: Some(1.0),
                    before: Some(360),
                    after: Some(120),
                    ..h(13.0, TEXT1)
                },
                Look {
                    caps: true,
                    spacing_pt: Some(0.5),
                    before: Some(240),
                    after: Some(80),
                    ..h(11.0, ACCENT1)
                },
                Look {
                    font: minor(),
                    bold: true,
                    before: Some(200),
                    after: Some(40),
                    ..h(10.5, TEXT1_LIGHT)
                },
            ),
            "modern" => (
                defaults(11.0, 160, 264),
                Look {
                    bold: true,
                    spacing_pt: Some(-1.0),
                    color: Some(TEXT1),
                    ..title(30.0)
                },
                Look {
                    color: Some(ACCENT1),
                    ..subtitle
                },
                Look {
                    bold: true,
                    before: Some(360),
                    after: Some(80),
                    ..h(15.0, TEXT1)
                },
                Look {
                    bold: true,
                    before: Some(200),
                    after: Some(40),
                    ..h(12.0, ACCENT1)
                },
                Look {
                    before: Some(160),
                    after: Some(40),
                    ..h(12.0, TEXT1_LIGHT)
                },
            ),
            "shaded" => (
                defaults(11.0, 200, 276),
                Look {
                    caps: true,
                    color: Some(ACCENT1_DARK),
                    ..title(28.0)
                },
                Look {
                    caps: true,
                    spacing_pt: Some(1.0),
                    ..subtitle
                },
                Look {
                    caps: true,
                    shading: Some(ACCENT1),
                    before: Some(240),
                    after: Some(0),
                    ..h(14.0, LIGHT1)
                },
                Look {
                    caps: true,
                    shading: Some(theme(ThemeColorSlot::Accent1, 0.8)),
                    before: Some(120),
                    after: Some(0),
                    ..h(12.0, ACCENT1_DARKER)
                },
                Look {
                    caps: true,
                    before: Some(240),
                    after: Some(0),
                    ..h(12.0, ACCENT1_DARKER)
                },
            ),
            _ => return None,
        };
        let entry = |id: &str, look: Option<&Look>, heading: Option<u8>| StyleSetEntry {
            id: id.to_owned(),
            name: name_of(id).to_owned(),
            paragraph: look.map(|l| l.paragraph(heading)).unwrap_or_default(),
            run: look.map(Look::run).unwrap_or_default(),
        };
        Some(StyleSet {
            id: id.to_owned(),
            defaults: defs,
            styles: vec![
                entry("Normal", None, None),
                entry("Title", Some(&t), None),
                entry("Subtitle", Some(&st), None),
                entry("Heading1", Some(&h1), Some(1)),
                entry("Heading2", Some(&h2), Some(2)),
                entry("Heading3", Some(&h3), Some(3)),
            ],
        })
    }

    /// All built-in sets, in gallery order.
    pub fn builtins() -> Vec<StyleSet> {
        BUILTIN_STYLE_SETS
            .iter()
            .filter_map(|id| StyleSet::builtin(id))
            .collect()
    }
}

impl StyleSheet {
    /// Applies a style set (Design › Style Set): the document defaults are
    /// replaced, every listed style gets the set's paragraph and run
    /// formatting (a linked style's character half too); styles the
    /// document lacks are added as linked quick styles based on Normal.
    pub fn apply_style_set(&mut self, set: &StyleSet) {
        self.defaults = set.defaults.clone();
        for e in &set.styles {
            let style = match self.get_mut(&e.id) {
                Some(s) => s,
                None => {
                    let heading = e.id.starts_with("Heading");
                    let mut s = Style::new(&e.id, &e.name, StyleKind::Linked);
                    if e.id != "Normal" {
                        s.based_on = Some("Normal".to_owned());
                        s.next = Some("Normal".to_owned());
                    }
                    s.quick_format = true;
                    s.priority = Some(if heading { 9 } else { 10 });
                    s.link = Some(format!("{}Char", e.id));
                    self.styles.push(s);
                    let mut c = Style::new(
                        &format!("{}Char", e.id),
                        &format!("{} Char", e.name),
                        StyleKind::Character,
                    );
                    c.link = Some(e.id.clone());
                    c.custom = true;
                    self.styles.push(c);
                    self.get_mut(&e.id).expect("just added")
                }
            };
            style.paragraph = e.paragraph.clone();
            style.run = e.run.clone();
            let link = (style.kind == StyleKind::Linked)
                .then(|| style.link.clone())
                .flatten();
            if let Some(c) = link.and_then(|l| self.get_mut(&l)) {
                if c.kind == StyleKind::Character {
                    c.run = e.run.clone();
                }
            }
        }
    }

    /// The current formatting of the style-set styles as a set named
    /// `id` (Design › Save as a New Style Set). Styles the document lacks
    /// are left out.
    pub fn capture_style_set(&self, id: &str) -> StyleSet {
        StyleSet {
            id: id.to_owned(),
            defaults: self.defaults.clone(),
            styles: STYLE_SET_IDS
                .iter()
                .filter_map(|sid| self.get(sid))
                .map(|s| StyleSetEntry {
                    id: s.id.clone(),
                    name: s.name.clone(),
                    paragraph: s.paragraph.clone(),
                    run: s.run.clone(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_builtin_set_formats_the_main_styles() {
        let sets = StyleSet::builtins();
        assert_eq!(sets.len(), BUILTIN_STYLE_SETS.len());
        for set in &sets {
            let ids: Vec<&str> = set.styles.iter().map(|e| e.id.as_str()).collect();
            assert_eq!(ids, STYLE_SET_IDS, "{}", set.id);
            let h1 = &set.styles[3];
            assert_eq!(h1.paragraph.outline_level, Some(0), "{}", set.id);
            assert_eq!(h1.paragraph.keep_next, Some(true));
            assert!(h1.run.size.is_some());
        }
        assert!(StyleSet::builtin("nope").is_none());
    }

    #[test]
    fn word_set_matches_the_office_defaults() {
        let office = StyleSheet::office_defaults();
        let mut sheet = office.clone();
        sheet.apply_style_set(&StyleSet::builtin("word").unwrap());
        assert_eq!(sheet.defaults, office.defaults);
        for id in ["Heading1", "Heading2", "Heading3", "Title", "Subtitle"] {
            assert_eq!(sheet.resolve_run(id), office.resolve_run(id), "{id}");
            assert_eq!(
                sheet.resolve_paragraph(id),
                office.resolve_paragraph(id),
                "{id}"
            );
        }
    }

    #[test]
    fn shaded_set_shades_headings_and_keeps_the_linked_half_in_step() {
        let mut sheet = StyleSheet::office_defaults();
        sheet.apply_style_set(&StyleSet::builtin("shaded").unwrap());
        let h1 = sheet.get("Heading1").unwrap();
        assert_eq!(h1.paragraph.shading, Some(ACCENT1));
        assert_eq!(h1.run.all_caps, Some(true));
        assert_eq!(h1.kind, StyleKind::Linked);
        let half = sheet.get("Heading1Char").unwrap();
        assert_eq!(half.run, h1.run);
        // Flags and structure stay.
        assert!(h1.quick_format);
        assert_eq!(h1.based_on.as_deref(), Some("Normal"));
    }

    #[test]
    fn missing_styles_are_added_and_capture_round_trips() {
        let mut sheet = StyleSheet::default();
        sheet
            .styles
            .push(Style::new("Normal", "Normal", StyleKind::Paragraph));
        let set = StyleSet::builtin("lines").unwrap();
        sheet.apply_style_set(&set);
        assert!(sheet.get("Heading2").is_some());
        assert!(sheet.get("Heading2Char").is_some());
        let captured = sheet.capture_style_set("lines");
        assert_eq!(captured, set);
        // A captured set applied to another sheet reproduces the formatting.
        let mut other = StyleSheet::office_defaults();
        other.apply_style_set(&captured);
        assert_eq!(other.resolve_run("Heading1"), sheet.resolve_run("Heading1"));
        assert_eq!(
            other.get("Heading1").unwrap().paragraph.borders,
            sheet.get("Heading1").unwrap().paragraph.borders
        );
    }
}
