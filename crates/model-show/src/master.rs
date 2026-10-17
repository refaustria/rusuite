//! The slide master (`p:sldMaster`): background, placeholders, decorative
//! shapes, text styles per level, colour map and header/footer settings.
//!
//! The master's placeholders and every layout's placeholders store
//! *effective* text defaults: the master text style of their class (title,
//! body or other, level 1) overlaid with what the master's and the
//! layout's own list styles change. `fmt-pptx` writes only the
//! differences, so PowerPoint's inheritance keeps working.

use core_model::{Color, FontFace, FontSize, RunProperties, ThemeColorSlot, ThemeFontSlot};
use serde::{Deserialize, Serialize};

use crate::layout::{PlaceholderDef, PlaceholderKind};
use crate::presentation::SlideSize;
use crate::shape::{Shape, Transform};
use crate::text::{Alignment, Anchor, Autofit, BodyProps, Bullet, TextParagraphProps, TextSpacing};
use crate::theme::Background;
use crate::Emu;

/// Formatting of one outline level of a text style (`a:lvlNpPr`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct LevelStyle {
    /// Paragraph formatting (`level` unused).
    #[serde(skip_serializing_if = "TextParagraphProps::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TextParagraphProps>"))]
    pub paragraph: TextParagraphProps,
    /// Run formatting (`a:defRPr`).
    #[serde(skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(
        feature = "ts",
        ts(optional, as = "Option<app_common::wire::RunProperties>")
    )]
    pub run: RunProperties,
    /// Left margin (`marL`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, type = "number"))]
    pub margin_left: Option<Emu>,
    /// First-line indent (`indent`; negative = hanging).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, type = "number"))]
    pub indent: Option<Emu>,
}

impl LevelStyle {
    /// Whether the level states nothing (everything inherits).
    pub fn is_empty(&self) -> bool {
        self.paragraph.is_empty()
            && self.run.is_empty()
            && self.margin_left.is_none()
            && self.indent.is_none()
    }

    /// `self` overlaid with what `over` states (margins, paragraph and run
    /// formatting).
    #[must_use]
    pub fn merged_with(&self, over: &LevelStyle) -> LevelStyle {
        LevelStyle {
            paragraph: self.paragraph.merged_with(&over.paragraph),
            run: self.run.merged_with(&over.run),
            margin_left: over.margin_left.or(self.margin_left),
            indent: over.indent.or(self.indent),
        }
    }
}

/// The master's text styles (`p:txStyles`): nine levels each for titles,
/// body placeholders and other text (shapes, text boxes, date/footer/slide
/// number placeholders).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextStyles {
    /// `p:titleStyle`.
    pub title: Vec<LevelStyle>,
    /// `p:bodyStyle`.
    pub body: Vec<LevelStyle>,
    /// `p:otherStyle`.
    pub other: Vec<LevelStyle>,
}

impl Default for TextStyles {
    fn default() -> Self {
        Self::office()
    }
}

/// Which text style a placeholder kind uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum TextClass {
    /// Titles.
    Title,
    /// Body, subtitle, content and picture placeholders.
    Body,
    /// Everything else.
    Other,
}

fn theme_font(slot: ThemeFontSlot) -> Option<FontFace> {
    Some(FontFace::Theme(slot))
}

impl TextStyles {
    /// PowerPoint's Office master styles: titles 44 pt major font, 90 %
    /// line spacing, no bullets; body levels 1–9 with `•` (Arial),
    /// 0.25" + 0.5" per level, hanging 0.25", 28/24/20/18 pt minor font,
    /// 90 % line spacing, 10 pt (level 1) / 5 pt before; other text 18 pt
    /// minor font, 0.5" per level. All text is Dark 1.
    pub fn office() -> Self {
        let tx1 = Some(Color::theme(ThemeColorSlot::Dark1));
        let run = |pt: f64, slot: ThemeFontSlot| RunProperties {
            font: theme_font(slot),
            size: Some(FontSize::from_pt(pt)),
            color: tx1,
            ..RunProperties::default()
        };
        let title = LevelStyle {
            paragraph: TextParagraphProps {
                alignment: Some(Alignment::Left),
                bullet: Some(Bullet::None),
                line_spacing: Some(TextSpacing::Percent(90_000)),
                spacing_before: Some(TextSpacing::Percent(0)),
                ..TextParagraphProps::default()
            },
            run: run(44.0, ThemeFontSlot::MajorLatin),
            margin_left: None,
            indent: None,
        };
        let mut titles = vec![title.clone()];
        for _ in 1..9 {
            // PowerPoint repeats level 1 for the unused title levels.
            titles.push(title.clone());
        }
        let body = (0..9i64)
            .map(|lvl| LevelStyle {
                paragraph: TextParagraphProps {
                    alignment: Some(Alignment::Left),
                    bullet: Some(Bullet::Char("•".to_owned())),
                    line_spacing: Some(TextSpacing::Percent(90_000)),
                    spacing_before: Some(TextSpacing::Points(if lvl == 0 { 1000 } else { 500 })),
                    ..TextParagraphProps::default()
                },
                run: run(
                    match lvl {
                        0 => 28.0,
                        1 => 24.0,
                        2 => 20.0,
                        _ => 18.0,
                    },
                    ThemeFontSlot::MinorLatin,
                ),
                margin_left: Some(Emu(228_600 + lvl * 457_200)),
                indent: Some(Emu(-228_600)),
            })
            .collect();
        let other = (0..9i64)
            .map(|lvl| LevelStyle {
                paragraph: TextParagraphProps {
                    alignment: Some(Alignment::Left),
                    ..TextParagraphProps::default()
                },
                run: run(18.0, ThemeFontSlot::MinorLatin),
                margin_left: Some(Emu(lvl * 457_200)),
                indent: None,
            })
            .collect();
        TextStyles {
            title: titles,
            body,
            other,
        }
    }

    /// The level list of `class`.
    pub fn of(&self, class: TextClass) -> &[LevelStyle] {
        match class {
            TextClass::Title => &self.title,
            TextClass::Body => &self.body,
            TextClass::Other => &self.other,
        }
    }

    /// Mutable level list of `class`.
    pub fn of_mut(&mut self, class: TextClass) -> &mut Vec<LevelStyle> {
        match class {
            TextClass::Title => &mut self.title,
            TextClass::Body => &mut self.body,
            TextClass::Other => &mut self.other,
        }
    }

    /// Level `level` (0-based) of `class`; missing levels repeat the last
    /// one, an empty list gives the defaults.
    pub fn level(&self, class: TextClass, level: u8) -> LevelStyle {
        let list = self.of(class);
        list.get(usize::from(level))
            .or(list.last())
            .cloned()
            .unwrap_or_default()
    }
}

/// The master's colour map (`p:clrMap`): which scheme slots the
/// background/text names `bg1`/`tx1`/`bg2`/`tx2` stand for (accents and
/// hyperlinks map to themselves).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ColorMap {
    /// `bg1` (standard: `lt1`).
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::ThemeColorSlot"))]
    pub bg1: ThemeColorSlot,
    /// `tx1` (standard: `dk1`).
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::ThemeColorSlot"))]
    pub tx1: ThemeColorSlot,
    /// `bg2` (standard: `lt2`).
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::ThemeColorSlot"))]
    pub bg2: ThemeColorSlot,
    /// `tx2` (standard: `dk2`).
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::ThemeColorSlot"))]
    pub tx2: ThemeColorSlot,
}

impl Default for ColorMap {
    fn default() -> Self {
        ColorMap {
            bg1: ThemeColorSlot::Light1,
            tx1: ThemeColorSlot::Dark1,
            bg2: ThemeColorSlot::Light2,
            tx2: ThemeColorSlot::Dark2,
        }
    }
}

/// The date of the header/footer settings.
///
/// Serializes as `{"kind":"off"}`, `{"kind":"auto","value":{"format":1}}`
/// or `{"kind":"fixed","value":{"text":"…"}}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum HfDate {
    /// No date.
    #[default]
    Off,
    /// Updated automatically: a `datetimeN` field (`format` 1–13, see
    /// [`crate::text::date_format_pattern`]).
    Auto {
        /// The `datetimeN` number.
        format: u8,
    },
    /// Fixed text.
    Fixed {
        /// The text.
        text: String,
    },
}

/// Header/footer settings of the master (PowerPoint's Insert › Header &
/// Footer › Apply to All): new slides get these placeholders.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct HeaderFooter {
    /// Date and time.
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<HfDate>"))]
    pub date: HfDate,
    /// Footer text (`None` = no footer).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub footer: Option<String>,
    /// Slide number.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub slide_number: bool,
    /// Not on slides with the Title Slide layout.
    #[serde(skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub not_on_title: bool,
}

fn is_false(v: &bool) -> bool {
    !*v
}

impl HeaderFooter {
    /// Whether nothing is shown.
    pub fn is_off(&self) -> bool {
        self.date == HfDate::Off && self.footer.is_none() && !self.slide_number
    }
}

/// The slide master.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct SlideMaster {
    /// Name (`p:cSld/@name`; empty = none).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<String>"))]
    pub name: String,
    /// Background of every slide that sets none.
    #[serde(default)]
    pub background: Background,
    /// Placeholders (title, body, date, footer, slide number), bottom to
    /// top, with effective text defaults (level 1).
    #[serde(default)]
    pub placeholders: Vec<PlaceholderDef>,
    /// Decorative shapes drawn below every slide's shapes (unless a layout
    /// or slide hides master shapes).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Shape>>"))]
    pub shapes: Vec<Shape>,
    /// Text styles per level.
    #[serde(default)]
    pub text_styles: TextStyles,
    /// Colour map.
    #[serde(default)]
    pub color_map: ColorMap,
    /// Header/footer settings.
    #[serde(default)]
    pub header_footer: HeaderFooter,
    /// Drawing guides of the Slide Master view (`p15:sldGuideLst`; P9-S3),
    /// also shown on the slides.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<crate::view::Guide>>"))]
    pub guides: Vec<crate::view::Guide>,
}

/// PowerPoint's master boxes (16:9 and 4:3) `(x, y, w, h)`.
pub(crate) mod boxes {
    pub type Box4 = (i64, i64, i64, i64);
    pub const WIDE_TITLE: Box4 = (838_200, 365_125, 10_515_600, 1_325_563);
    pub const WIDE_BODY: Box4 = (838_200, 1_825_625, 10_515_600, 4_351_338);
    pub const WIDE_DATE: Box4 = (838_200, 6_356_350, 2_743_200, 365_125);
    pub const WIDE_FOOTER: Box4 = (4_038_600, 6_356_350, 4_114_800, 365_125);
    pub const WIDE_NUMBER: Box4 = (8_610_600, 6_356_350, 2_743_200, 365_125);
    pub const STD_TITLE: Box4 = (628_650, 365_125, 7_886_700, 1_325_563);
    pub const STD_BODY: Box4 = (628_650, 1_825_625, 7_886_700, 4_351_338);
    pub const STD_DATE: Box4 = (628_650, 6_356_350, 2_057_400, 365_125);
    pub const STD_FOOTER: Box4 = (3_028_950, 6_356_350, 3_086_100, 365_125);
    pub const STD_NUMBER: Box4 = (6_457_950, 6_356_350, 2_057_400, 365_125);
}

/// `v * num / den`, rounded to nearest.
pub(crate) fn scale(v: i64, num: i64, den: i64) -> i64 {
    if den == 0 {
        return v;
    }
    let p = i128::from(v) * i128::from(num);
    let d = i128::from(den);
    ((2 * p + d).div_euclid(2 * d)) as i64
}

/// A box for slides of `size`: 4:3 uses `standard`, other sizes scale the
/// 16:9 box proportionally.
pub(crate) fn place(size: SlideSize, wide: boxes::Box4, standard: boxes::Box4) -> Transform {
    let (x, y, w, h) = if size == SlideSize::standard() {
        standard
    } else {
        let sx = |v: i64| scale(v, size.width.0, SlideSize::widescreen().width.0);
        let sy = |v: i64| scale(v, size.height.0, SlideSize::widescreen().height.0);
        (sx(wide.0), sy(wide.1), sx(wide.2), sy(wide.3))
    };
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

impl Default for SlideMaster {
    fn default() -> Self {
        Self::builtin(SlideSize::widescreen())
    }
}

impl SlideMaster {
    /// PowerPoint's Office master for slides of `size`: theme background
    /// style 1, title and body placeholders, date (left), footer (centre)
    /// and slide number (right) placeholders in 12 pt Dark 1 at 75 %
    /// along the bottom edge, the Office text styles.
    pub fn builtin(size: SlideSize) -> Self {
        use boxes::*;
        let styles = TextStyles::office();
        let body_props = |anchor: Anchor, autofit: Autofit| BodyProps {
            anchor,
            autofit,
            ..BodyProps::default()
        };
        let base = |kind: PlaceholderKind, idx: u32, transform: Transform, body: BodyProps| {
            let lvl = styles.level(kind.text_class(), 0);
            PlaceholderDef {
                kind,
                idx,
                transform,
                body_defaults: body,
                run_defaults: lvl.run,
                paragraph_defaults: lvl.paragraph,
                text_only: kind == PlaceholderKind::Body,
                vertical: false,
                prompt: None,
                levels: Vec::new(),
            }
        };
        let hf = |kind: PlaceholderKind, idx: u32, transform: Transform, algn: Alignment| {
            let mut d = base(
                kind,
                idx,
                transform,
                body_props(Anchor::Middle, Autofit::None),
            );
            d.paragraph_defaults.alignment = Some(algn);
            d.run_defaults.size = Some(FontSize::from_pt(12.0));
            d.run_defaults.color = Some(Color::Theme {
                slot: ThemeColorSlot::Dark1,
                tint: 0.25,
            });
            d
        };
        let placeholders = vec![
            base(
                PlaceholderKind::Title,
                0,
                place(size, WIDE_TITLE, STD_TITLE),
                body_props(Anchor::Middle, Autofit::Shrink),
            ),
            base(
                PlaceholderKind::Body,
                1,
                place(size, WIDE_BODY, STD_BODY),
                body_props(Anchor::Top, Autofit::Shrink),
            ),
            hf(
                PlaceholderKind::DateTime,
                2,
                place(size, WIDE_DATE, STD_DATE),
                Alignment::Left,
            ),
            hf(
                PlaceholderKind::Footer,
                3,
                place(size, WIDE_FOOTER, STD_FOOTER),
                Alignment::Center,
            ),
            hf(
                PlaceholderKind::SlideNumber,
                4,
                place(size, WIDE_NUMBER, STD_NUMBER),
                Alignment::Right,
            ),
        ];
        SlideMaster {
            name: String::new(),
            background: Background::default(),
            placeholders,
            shapes: Vec::new(),
            text_styles: styles,
            color_map: ColorMap::default(),
            header_footer: HeaderFooter::default(),
            guides: Vec::new(),
        }
    }

    /// The master placeholder a layout or slide placeholder of `kind`
    /// inherits from (same kind; centred title → title; subtitle and
    /// picture → body).
    pub fn placeholder_for(&self, kind: PlaceholderKind) -> Option<&PlaceholderDef> {
        let base = match kind {
            PlaceholderKind::CenteredTitle => PlaceholderKind::Title,
            PlaceholderKind::Subtitle
            | PlaceholderKind::Picture
            | PlaceholderKind::Chart
            | PlaceholderKind::Table => PlaceholderKind::Body,
            k => k,
        };
        self.placeholders.iter().find(|d| d.kind == base)
    }

    /// Level 1 of the text style of `kind` as a placeholder definition
    /// base (for placeholders the master does not have).
    pub fn style_defaults(&self, kind: PlaceholderKind) -> (TextParagraphProps, RunProperties) {
        let l = self.text_styles.level(kind.text_class(), 0);
        (l.paragraph, l.run)
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn level_style_merge() {
        let base = TextStyles::office().level(TextClass::Body, 1);
        assert!(!base.is_empty());
        assert!(LevelStyle::default().is_empty());
        let over = LevelStyle {
            margin_left: Some(Emu(1)),
            run: RunProperties {
                bold: Some(true),
                ..RunProperties::default()
            },
            ..LevelStyle::default()
        };
        let m = base.merged_with(&over);
        assert_eq!(m.margin_left, Some(Emu(1)));
        assert_eq!(m.indent, base.indent);
        assert_eq!(m.run.bold, Some(true));
        assert_eq!(m.run.size, base.run.size);
        assert_eq!(m.paragraph.bullet, base.paragraph.bullet);
    }

    use super::*;

    #[test]
    fn office_master() {
        let m = SlideMaster::builtin(SlideSize::widescreen());
        let kinds: Vec<_> = m.placeholders.iter().map(|p| p.kind).collect();
        assert_eq!(
            kinds,
            [
                PlaceholderKind::Title,
                PlaceholderKind::Body,
                PlaceholderKind::DateTime,
                PlaceholderKind::Footer,
                PlaceholderKind::SlideNumber
            ]
        );
        let title = m.placeholder_for(PlaceholderKind::CenteredTitle).unwrap();
        assert_eq!(title.run_defaults.size, Some(FontSize::from_pt(44.0)));
        assert_eq!(
            m.placeholder_for(PlaceholderKind::Picture).unwrap().kind,
            PlaceholderKind::Body
        );
        let n = m.placeholder_for(PlaceholderKind::SlideNumber).unwrap();
        assert_eq!(n.paragraph_defaults.alignment, Some(Alignment::Right));
        assert_eq!(n.transform.x, Emu(8_610_600));
        let std = SlideMaster::builtin(SlideSize::standard());
        assert_eq!(std.placeholders[3].transform.x, Emu(3_028_950));
        // body levels: sizes and indents
        let s = &m.text_styles;
        assert_eq!(s.body.len(), 9);
        assert_eq!(
            s.level(TextClass::Body, 1).run.size,
            Some(FontSize::from_pt(24.0))
        );
        assert_eq!(
            s.level(TextClass::Body, 8).margin_left,
            Some(Emu(3_886_200))
        );
        assert_eq!(
            s.level(TextClass::Other, 20).margin_left,
            Some(Emu(3_657_600))
        );
        assert!(m.header_footer.is_off());
    }
}
