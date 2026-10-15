//! The three built-in slide layouts and their placeholders.

use core_model::units::Emu;
use core_model::{FontFace, FontSize, RunProperties, ThemeFontSlot};
use serde::{Deserialize, Serialize};

use crate::presentation::SlideSize;
use crate::shape::{Shape, Transform};
use crate::text::{
    Alignment, Anchor, Autofit, BodyProps, Bullet, TextBody, TextParagraph, TextParagraphProps,
};

/// A built-in slide layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum LayoutKind {
    /// Title slide: centered title and subtitle.
    Title,
    /// Title and content: title and a bulleted body.
    TitleContent,
    /// Blank: no placeholders.
    Blank,
}

impl LayoutKind {
    /// All layouts, in the order of [`crate::Presentation::layouts`].
    pub const ALL: [LayoutKind; 3] = [
        LayoutKind::Title,
        LayoutKind::TitleContent,
        LayoutKind::Blank,
    ];

    /// Position in [`LayoutKind::ALL`].
    pub const fn index(self) -> usize {
        match self {
            LayoutKind::Title => 0,
            LayoutKind::TitleContent => 1,
            LayoutKind::Blank => 2,
        }
    }
}

/// A placeholder type (`p:ph/@type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum PlaceholderKind {
    /// Slide title (`title`).
    Title,
    /// Title of a title slide (`ctrTitle`).
    CenteredTitle,
    /// Subtitle of a title slide (`subTitle`).
    Subtitle,
    /// Content / body text (`body` or no type).
    Body,
}

/// A placeholder of a layout: where it sits and how its text looks unless
/// the slide's shape overrides it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct PlaceholderDef {
    /// Placeholder type.
    pub kind: PlaceholderKind,
    /// Position and size.
    pub transform: Transform,
    /// Body properties of the placeholder's text.
    #[serde(default)]
    pub body_defaults: BodyProps,
    /// Run formatting of the placeholder's text (font, size).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run_defaults: RunProperties,
    /// Paragraph formatting of the placeholder's text (e.g. bullets).
    #[serde(default)]
    pub paragraph_defaults: TextParagraphProps,
}

/// A slide layout: its kind and placeholders.
///
/// Layouts are fixed built-ins ([`Layout::builtin`], ADR 0008); importers
/// may only adjust placeholder positions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Layout {
    /// Which layout.
    pub kind: LayoutKind,
    /// Placeholders, bottom to top.
    #[serde(default)]
    pub placeholders: Vec<PlaceholderDef>,
}

/// PowerPoint's default (Office theme, 2013+) placeholder boxes as
/// `(x, y, w, h)` for 16:9 and 4:3 slides.
mod boxes {
    pub type Box4 = (i64, i64, i64, i64);
    pub const WIDE_CENTERED_TITLE: Box4 = (1_524_000, 1_122_363, 9_144_000, 2_387_600);
    pub const WIDE_SUBTITLE: Box4 = (1_524_000, 3_602_038, 9_144_000, 1_655_762);
    pub const WIDE_TITLE: Box4 = (838_200, 365_125, 10_515_600, 1_325_563);
    pub const WIDE_BODY: Box4 = (838_200, 1_825_625, 10_515_600, 4_351_338);
    pub const STD_CENTERED_TITLE: Box4 = (685_800, 1_122_363, 7_772_400, 2_387_600);
    pub const STD_SUBTITLE: Box4 = (1_143_000, 3_602_038, 6_858_000, 1_655_762);
    pub const STD_TITLE: Box4 = (628_650, 365_125, 7_886_700, 1_325_563);
    pub const STD_BODY: Box4 = (628_650, 1_825_625, 7_886_700, 4_351_338);
}

impl Layout {
    /// The built-in layout `kind` for slides of `size`.
    ///
    /// Positions are PowerPoint's defaults for 16:9
    /// ([`SlideSize::widescreen`]) and 4:3 ([`SlideSize::standard`]);
    /// other sizes scale the 16:9 boxes proportionally. Text defaults
    /// follow the Office theme: titles 44 pt (title slide: 60 pt) in the
    /// major font, subtitle 24 pt centered without bullets, body 28 pt in
    /// the minor font with `•` bullets; all placeholders shrink text on
    /// overflow.
    pub fn builtin(kind: LayoutKind, size: SlideSize) -> Layout {
        use boxes::*;
        let std = size == SlideSize::standard();
        let place = |wide: Box4, standard: Box4| -> Transform {
            let (x, y, w, h) = if std {
                standard
            } else {
                let sx = |v: i64| scale(v, size.width.0, SlideSize::widescreen().width.0);
                let sy = |v: i64| scale(v, size.height.0, SlideSize::widescreen().height.0);
                (sx(wide.0), sy(wide.1), sx(wide.2), sy(wide.3))
            };
            Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
        };
        let title_font = |pt: f64| RunProperties {
            font: Some(FontFace::Theme(ThemeFontSlot::MajorLatin)),
            size: Some(FontSize::from_pt(pt)),
            ..RunProperties::default()
        };
        let body_font = |pt: f64| RunProperties {
            font: Some(FontFace::Theme(ThemeFontSlot::MinorLatin)),
            size: Some(FontSize::from_pt(pt)),
            ..RunProperties::default()
        };
        let body = |anchor: Anchor| BodyProps {
            anchor,
            autofit: Autofit::Shrink,
            ..BodyProps::default()
        };
        let placeholders = match kind {
            LayoutKind::Title => vec![
                PlaceholderDef {
                    kind: PlaceholderKind::CenteredTitle,
                    transform: place(WIDE_CENTERED_TITLE, STD_CENTERED_TITLE),
                    body_defaults: body(Anchor::Bottom),
                    run_defaults: title_font(60.0),
                    paragraph_defaults: TextParagraphProps {
                        alignment: Some(Alignment::Center),
                        ..TextParagraphProps::default()
                    },
                },
                PlaceholderDef {
                    kind: PlaceholderKind::Subtitle,
                    transform: place(WIDE_SUBTITLE, STD_SUBTITLE),
                    body_defaults: body(Anchor::Top),
                    run_defaults: body_font(24.0),
                    paragraph_defaults: TextParagraphProps {
                        alignment: Some(Alignment::Center),
                        bullet: Some(Bullet::None),
                        ..TextParagraphProps::default()
                    },
                },
            ],
            LayoutKind::TitleContent => vec![
                PlaceholderDef {
                    kind: PlaceholderKind::Title,
                    transform: place(WIDE_TITLE, STD_TITLE),
                    body_defaults: body(Anchor::Middle),
                    run_defaults: title_font(44.0),
                    paragraph_defaults: TextParagraphProps {
                        alignment: Some(Alignment::Left),
                        ..TextParagraphProps::default()
                    },
                },
                PlaceholderDef {
                    kind: PlaceholderKind::Body,
                    transform: place(WIDE_BODY, STD_BODY),
                    body_defaults: body(Anchor::Top),
                    run_defaults: body_font(28.0),
                    paragraph_defaults: TextParagraphProps {
                        alignment: Some(Alignment::Left),
                        bullet: Some(Bullet::Char("•".to_owned())),
                        ..TextParagraphProps::default()
                    },
                },
            ],
            LayoutKind::Blank => Vec::new(),
        };
        Layout { kind, placeholders }
    }

    /// One empty shape per placeholder, bottom to top: a text box at the
    /// placeholder's position with its body properties, one empty
    /// paragraph and [`Shape::placeholder`] set. Ids are 0 and names empty
    /// (see [`crate::Presentation::assign_ids`]).
    pub fn placeholder_shapes(&self) -> Vec<Shape> {
        self.placeholders
            .iter()
            .map(|def| {
                let mut shape = Shape::text_box(def.transform, "");
                if let Some(body) = shape.text_mut() {
                    *body = TextBody {
                        props: def.body_defaults,
                        paragraphs: vec![TextParagraph::new()],
                    };
                }
                shape.placeholder = Some(def.kind);
                shape
            })
            .collect()
    }

    /// The placeholder of type `kind`, if the layout has one.
    pub fn placeholder(&self, kind: PlaceholderKind) -> Option<&PlaceholderDef> {
        self.placeholders.iter().find(|p| p.kind == kind)
    }
}

/// `v * num / den`, rounded to nearest.
fn scale(v: i64, num: i64, den: i64) -> i64 {
    if den == 0 {
        return v;
    }
    let p = i128::from(v) * i128::from(num);
    let d = i128::from(den);
    ((2 * p + d).div_euclid(2 * d)) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxes(l: &Layout) -> Vec<(PlaceholderKind, [i64; 4])> {
        l.placeholders
            .iter()
            .map(|p| {
                let t = p.transform;
                (p.kind, [t.x.0, t.y.0, t.w.0, t.h.0])
            })
            .collect()
    }

    #[test]
    fn widescreen_reference_positions() {
        let size = SlideSize::widescreen();
        assert_eq!(
            boxes(&Layout::builtin(LayoutKind::Title, size)),
            [
                (
                    PlaceholderKind::CenteredTitle,
                    [1_524_000, 1_122_363, 9_144_000, 2_387_600]
                ),
                (
                    PlaceholderKind::Subtitle,
                    [1_524_000, 3_602_038, 9_144_000, 1_655_762]
                ),
            ]
        );
        assert_eq!(
            boxes(&Layout::builtin(LayoutKind::TitleContent, size)),
            [
                (
                    PlaceholderKind::Title,
                    [838_200, 365_125, 10_515_600, 1_325_563]
                ),
                (
                    PlaceholderKind::Body,
                    [838_200, 1_825_625, 10_515_600, 4_351_338]
                ),
            ]
        );
        assert!(Layout::builtin(LayoutKind::Blank, size)
            .placeholders
            .is_empty());
    }

    #[test]
    fn standard_and_scaled_positions() {
        let l = Layout::builtin(LayoutKind::TitleContent, SlideSize::standard());
        assert_eq!(
            boxes(&l)[1],
            (
                PlaceholderKind::Body,
                [628_650, 1_825_625, 7_886_700, 4_351_338]
            )
        );
        // half-size custom slide scales the 16:9 boxes
        let half = SlideSize {
            width: Emu(6_096_000),
            height: Emu(3_429_000),
        };
        let l = Layout::builtin(LayoutKind::Title, half);
        assert_eq!(boxes(&l)[0].1, [762_000, 561_182, 4_572_000, 1_193_800]);
    }

    #[test]
    fn text_defaults() {
        let l = Layout::builtin(LayoutKind::TitleContent, SlideSize::widescreen());
        let title = l.placeholder(PlaceholderKind::Title).unwrap();
        assert_eq!(title.run_defaults.size, Some(FontSize::from_pt(44.0)));
        assert_eq!(
            title.run_defaults.font,
            Some(FontFace::Theme(ThemeFontSlot::MajorLatin))
        );
        let body = l.placeholder(PlaceholderKind::Body).unwrap();
        assert_eq!(body.run_defaults.size, Some(FontSize::from_pt(28.0)));
        assert_eq!(
            body.paragraph_defaults.bullet,
            Some(Bullet::Char("•".into()))
        );
        assert!(l.placeholder(PlaceholderKind::Subtitle).is_none());
        for k in LayoutKind::ALL {
            assert_eq!(LayoutKind::ALL[k.index()], k);
        }
    }
}
