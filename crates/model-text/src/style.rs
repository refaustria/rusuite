//! Named styles and document defaults.

use core_model::units::Twips;
use core_model::{Color, FontFace, FontSize, RunProperties, ThemeColorSlot, ThemeFontSlot};
use serde::{Deserialize, Serialize};

use crate::props::{Indent, LineSpacing, ParagraphProperties, Spacing};

/// Kind of a style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum StyleKind {
    /// Paragraph style (may also carry run formatting).
    Paragraph,
    /// Character style.
    Character,
    /// Table style.
    Table,
}

/// A named style (docx `w:style`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Style {
    /// Style id, referenced by [`ParagraphProperties::style`] (e.g. `"Heading1"`).
    pub id: String,
    /// Display name (e.g. `"heading 1"`, as Word stores it).
    pub name: String,
    /// Kind.
    pub kind: StyleKind,
    /// Parent style id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub based_on: Option<String>,
    /// Style of the paragraph created after this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// Paragraph formatting of the style.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
    /// Run formatting of the style.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
    /// Whether this is the default style of its kind.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_default: bool,
}

impl Style {
    /// A paragraph style based on `Normal` with `next = Normal`.
    fn paragraph(id: &str, name: &str) -> Self {
        Self {
            id: id.to_owned(),
            name: name.to_owned(),
            kind: StyleKind::Paragraph,
            based_on: Some("Normal".to_owned()),
            next: Some("Normal".to_owned()),
            paragraph: ParagraphProperties::default(),
            run: RunProperties::default(),
            is_default: false,
        }
    }
}

/// Document-wide default formatting (docx `w:docDefaults`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Defaults {
    /// Default run formatting.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
    /// Default paragraph formatting.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
}

/// The document's styles (docx `styles.xml`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct StyleSheet {
    /// Document defaults, applied below every style.
    #[serde(default)]
    pub defaults: Defaults,
    /// Styles in document order; ids are unique.
    #[serde(default)]
    pub styles: Vec<Style>,
}

impl StyleSheet {
    /// The style with id `id`.
    pub fn get(&self, id: &str) -> Option<&Style> {
        self.styles.iter().find(|s| s.id == id)
    }

    /// Mutable access to the style with id `id`.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut Style> {
        self.styles.iter_mut().find(|s| s.id == id)
    }

    /// Inserts `style`, replacing (in place) a style with the same id.
    /// Returns the replaced style.
    pub fn insert(&mut self, style: Style) -> Option<Style> {
        match self.get_mut(&style.id) {
            Some(slot) => Some(std::mem::replace(slot, style)),
            None => {
                self.styles.push(style);
                None
            }
        }
    }

    /// The default style of `kind` (the first with `is_default`).
    pub fn default_style(&self, kind: StyleKind) -> Option<&Style> {
        self.styles.iter().find(|s| s.kind == kind && s.is_default)
    }

    /// The `based_on` chain of `style_id`, root first, ending with the
    /// style itself. Stops at missing parents and at cycles.
    fn chain(&self, style_id: &str) -> Vec<&Style> {
        let mut chain: Vec<&Style> = Vec::new();
        let mut next = self.get(style_id);
        while let Some(style) = next {
            if chain.iter().any(|s| s.id == style.id) {
                break;
            }
            chain.push(style);
            next = style.based_on.as_deref().and_then(|id| self.get(id));
        }
        chain.reverse();
        chain
    }

    /// Effective paragraph formatting of a style: document defaults overlaid
    /// with every style of the `based_on` chain, root first. An unknown id
    /// yields the defaults. Cycles in `based_on` are cut. The result's
    /// `style` field is `style_id` if the style exists.
    pub fn resolve_paragraph(&self, style_id: &str) -> ParagraphProperties {
        let mut out = self.defaults.paragraph.clone();
        let chain = self.chain(style_id);
        for style in &chain {
            out.apply(&style.paragraph);
        }
        out.style = (!chain.is_empty()).then(|| style_id.to_owned());
        out
    }

    /// Effective run formatting of a style: document defaults overlaid with
    /// the run formatting of every style of the `based_on` chain.
    pub fn resolve_run(&self, style_id: &str) -> RunProperties {
        let mut out = self.defaults.run.clone();
        for style in self.chain(style_id) {
            out.apply(&style.run);
        }
        out
    }

    /// Word 2016+ default styles: Normal, Title, Heading 1–6 and
    /// List Paragraph, with Word's document defaults (Calibri 11 pt,
    /// 8 pt after, 1.08 line spacing).
    pub fn office_defaults() -> Self {
        let major = Some(FontFace::Theme(ThemeFontSlot::MajorLatin));
        // themeShade BF / 7F on accent1 = tint -0.25 / -0.5 (2F5496 / 1F3763).
        let accent1_dark = Some(Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: -0.25,
        });
        let accent1_darker = Some(Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: -0.5,
        });
        let heading = |level: u8, before: i32, size: Option<f64>, color: Option<Color>| {
            let mut s = Style::paragraph(&format!("Heading{level}"), &format!("heading {level}"));
            s.paragraph = ParagraphProperties {
                spacing: Some(Spacing {
                    before: Some(Twips(before)),
                    after: Some(Twips(0)),
                    line: None,
                }),
                keep_next: Some(true),
                ..Default::default()
            };
            s.run = RunProperties {
                font: major.clone(),
                size: size.map(FontSize::from_pt),
                color,
                ..Default::default()
            };
            s
        };

        let normal = Style {
            id: "Normal".to_owned(),
            name: "Normal".to_owned(),
            kind: StyleKind::Paragraph,
            based_on: None,
            next: None,
            paragraph: ParagraphProperties::default(),
            run: RunProperties::default(),
            is_default: true,
        };
        let mut title = Style::paragraph("Title", "Title");
        title.paragraph.spacing = Some(Spacing {
            before: None,
            after: Some(Twips(0)),
            line: Some(LineSpacing::Multiple(1.0)),
        });
        title.run = RunProperties {
            font: major.clone(),
            size: Some(FontSize::from_pt(28.0)),
            ..Default::default()
        };
        let mut h4 = heading(4, 40, None, accent1_dark);
        h4.run.italic = Some(true);
        let mut list = Style::paragraph("ListParagraph", "List Paragraph");
        list.next = None;
        list.paragraph.indent = Some(Indent {
            left: Some(Twips(720)),
            ..Default::default()
        });

        Self {
            defaults: Defaults {
                run: RunProperties {
                    font: Some(FontFace::Theme(ThemeFontSlot::MinorLatin)),
                    size: Some(FontSize::from_pt(11.0)),
                    ..Default::default()
                },
                paragraph: ParagraphProperties {
                    spacing: Some(Spacing {
                        before: None,
                        after: Some(Twips(160)),
                        line: Some(LineSpacing::from_240ths(259)),
                    }),
                    ..Default::default()
                },
            },
            styles: vec![
                normal,
                title,
                heading(1, 240, Some(16.0), accent1_dark),
                heading(2, 40, Some(13.0), accent1_dark),
                heading(3, 40, Some(12.0), accent1_darker),
                h4,
                heading(5, 40, None, accent1_dark),
                heading(6, 40, None, accent1_darker),
                list,
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::{ColorScheme, Rgb};

    #[test]
    fn based_on_chain() {
        let sheet = StyleSheet::office_defaults();
        let h1 = sheet.resolve_paragraph("Heading1");
        assert_eq!(h1.style.as_deref(), Some("Heading1"));
        let sp = h1.spacing.unwrap();
        assert_eq!(sp.before, Some(Twips(240)));
        assert_eq!(sp.after, Some(Twips(0)));
        // inherited from the defaults via Normal
        assert_eq!(sp.line, Some(LineSpacing::from_240ths(259)));
        assert_eq!(h1.keep_next, Some(true));

        let run = sheet.resolve_run("Heading1");
        assert_eq!(run.size, Some(FontSize::from_pt(16.0)));
        assert_eq!(run.font, Some(FontFace::Theme(ThemeFontSlot::MajorLatin)));
        let normal = sheet.resolve_run("Normal");
        assert_eq!(normal.size, Some(FontSize::from_pt(11.0)));
        assert_eq!(
            normal.font,
            Some(FontFace::Theme(ThemeFontSlot::MinorLatin))
        );

        // unknown style: defaults only
        let unknown = sheet.resolve_paragraph("Nope");
        assert_eq!(unknown.style, None);
        assert_eq!(unknown.spacing.unwrap().after, Some(Twips(160)));
    }

    #[test]
    fn heading_colors_match_word() {
        let scheme = ColorScheme::default();
        let sheet = StyleSheet::office_defaults();
        let close = |c: Rgb, hex: &str| {
            let e = Rgb::from_hex(hex).unwrap();
            [(c.r, e.r), (c.g, e.g), (c.b, e.b)]
                .iter()
                .all(|&(a, b)| a.abs_diff(b) <= 2)
        };
        let h1 = sheet.resolve_run("Heading1").color.unwrap();
        assert!(close(h1.resolve(&scheme, Rgb::BLACK), "2F5496"));
        let h3 = sheet.resolve_run("Heading3").color.unwrap();
        assert!(close(h3.resolve(&scheme, Rgb::BLACK), "1F3763"));
    }

    #[test]
    fn based_on_cycle_terminates() {
        let mut sheet = StyleSheet::default();
        for (id, parent, size) in [("A", "B", 10.0), ("B", "C", 12.0), ("C", "A", 14.0)] {
            sheet.insert(Style {
                id: id.into(),
                name: id.into(),
                kind: StyleKind::Paragraph,
                based_on: Some(parent.into()),
                next: None,
                paragraph: ParagraphProperties::default(),
                run: RunProperties {
                    size: Some(FontSize::from_pt(size)),
                    ..Default::default()
                },
                is_default: false,
            });
        }
        // A's own value wins over its (cyclic) ancestors.
        assert_eq!(sheet.resolve_run("A").size, Some(FontSize::from_pt(10.0)));
        assert_eq!(sheet.resolve_run("C").size, Some(FontSize::from_pt(14.0)));
        assert_eq!(sheet.resolve_paragraph("B").style.as_deref(), Some("B"));

        // self-reference
        sheet.get_mut("A").unwrap().based_on = Some("A".into());
        assert_eq!(sheet.resolve_run("A").size, Some(FontSize::from_pt(10.0)));
    }

    #[test]
    fn insert_replaces_and_get() {
        let mut sheet = StyleSheet::office_defaults();
        let n = sheet.styles.len();
        assert_eq!(
            sheet
                .default_style(StyleKind::Paragraph)
                .map(|s| s.id.as_str()),
            Some("Normal")
        );
        let mut title = sheet.get("Title").unwrap().clone();
        title.run.bold = Some(true);
        let old = sheet.insert(title).unwrap();
        assert_eq!(old.run.bold, None);
        assert_eq!(sheet.styles.len(), n);
        assert_eq!(sheet.get("Title").unwrap().run.bold, Some(true));
        assert!(sheet.insert(Style::paragraph("Quote", "Quote")).is_none());
        assert_eq!(sheet.styles.len(), n + 1);
        assert!(sheet.get("Heading7").is_none());
    }
}
