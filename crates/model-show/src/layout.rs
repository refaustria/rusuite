//! Slide layouts (`p:sldLayout`) and their placeholders.
//!
//! A presentation has one master and a list of layouts; a layout is
//! identified by its [`LayoutKind`] (the eleven PowerPoint standard
//! layouts once each, plus custom layouts by name). [`Layout::builtin`]
//! gives PowerPoint's Office layouts.

use std::fmt;

use core_model::{Color, FontSize, RunProperties, ThemeColorSlot};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::master::{boxes, place, LevelStyle, SlideMaster, TextClass};
use crate::presentation::SlideSize;
use crate::shape::{Shape, Transform};
use crate::text::{
    Alignment, Anchor, BodyProps, Bullet, TextBody, TextParagraph, TextParagraphProps,
};
use crate::theme::Background;

/// A slide layout: one of PowerPoint's standard layouts or a custom one.
///
/// Serializes as a string: `"title"`, `"titleContent"`, `"sectionHeader"`,
/// `"twoContent"`, `"comparison"`, `"titleOnly"`, `"blank"`,
/// `"contentWithCaption"`, `"pictureWithCaption"`, `"verticalText"`,
/// `"verticalTitleText"`, or `"custom:<name>"`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(
        export,
        export_to = "apps/show/src/generated/",
        type = r#""title" | "titleContent" | "sectionHeader" | "twoContent" | "comparison" | "titleOnly" | "blank" | "contentWithCaption" | "pictureWithCaption" | "verticalText" | "verticalTitleText" | `custom:${string}`"#
    )
)]
pub enum LayoutKind {
    /// Title Slide (`title`): centred title and subtitle.
    Title,
    /// Title and Content (`obj`).
    TitleContent,
    /// Section Header (`secHead`).
    SectionHeader,
    /// Two Content (`twoObj`).
    TwoContent,
    /// Comparison (`twoTxTwoObj`): two headings, two contents.
    Comparison,
    /// Title Only (`titleOnly`).
    TitleOnly,
    /// Blank (`blank`).
    Blank,
    /// Content with Caption (`objTx`).
    ContentWithCaption,
    /// Picture with Caption (`picTx`).
    PictureWithCaption,
    /// Title and Vertical Text (`vertTx`).
    VerticalText,
    /// Vertical Title and Text (`vertTitleAndTx`).
    VerticalTitleText,
    /// A custom layout (`cust`, or a second layout of a standard type),
    /// identified by its name.
    Custom(String),
}

impl LayoutKind {
    /// The standard layouts in PowerPoint's order (Office theme).
    pub const STANDARD: [LayoutKind; 11] = [
        LayoutKind::Title,
        LayoutKind::TitleContent,
        LayoutKind::SectionHeader,
        LayoutKind::TwoContent,
        LayoutKind::Comparison,
        LayoutKind::TitleOnly,
        LayoutKind::Blank,
        LayoutKind::ContentWithCaption,
        LayoutKind::PictureWithCaption,
        LayoutKind::VerticalText,
        LayoutKind::VerticalTitleText,
    ];

    /// The serialized key (`"title"`, …, `"custom:<name>"`).
    pub fn key(&self) -> String {
        match self {
            LayoutKind::Custom(n) => format!("custom:{n}"),
            k => k.standard_key().to_owned(),
        }
    }

    fn standard_key(&self) -> &'static str {
        match self {
            LayoutKind::Title => "title",
            LayoutKind::TitleContent => "titleContent",
            LayoutKind::SectionHeader => "sectionHeader",
            LayoutKind::TwoContent => "twoContent",
            LayoutKind::Comparison => "comparison",
            LayoutKind::TitleOnly => "titleOnly",
            LayoutKind::Blank => "blank",
            LayoutKind::ContentWithCaption => "contentWithCaption",
            LayoutKind::PictureWithCaption => "pictureWithCaption",
            LayoutKind::VerticalText => "verticalText",
            LayoutKind::VerticalTitleText => "verticalTitleText",
            LayoutKind::Custom(_) => "custom",
        }
    }

    /// Parses a key written by [`key`](Self::key).
    pub fn from_key(key: &str) -> Option<LayoutKind> {
        if let Some(name) = key.strip_prefix("custom:") {
            return Some(LayoutKind::Custom(name.to_owned()));
        }
        LayoutKind::STANDARD
            .iter()
            .find(|k| k.standard_key() == key)
            .cloned()
    }

    /// `p:sldLayout/@type`.
    pub fn ooxml_type(&self) -> &'static str {
        match self {
            LayoutKind::Title => "title",
            LayoutKind::TitleContent => "obj",
            LayoutKind::SectionHeader => "secHead",
            LayoutKind::TwoContent => "twoObj",
            LayoutKind::Comparison => "twoTxTwoObj",
            LayoutKind::TitleOnly => "titleOnly",
            LayoutKind::Blank => "blank",
            LayoutKind::ContentWithCaption => "objTx",
            LayoutKind::PictureWithCaption => "picTx",
            LayoutKind::VerticalText => "vertTx",
            LayoutKind::VerticalTitleText => "vertTitleAndTx",
            LayoutKind::Custom(_) => "cust",
        }
    }

    /// The standard layout of a `p:sldLayout/@type` (`tx` = Title and
    /// Content); `None` for `cust` and the rarely used other types.
    pub fn from_ooxml_type(ty: &str) -> Option<LayoutKind> {
        Some(match ty {
            "title" => LayoutKind::Title,
            "obj" | "tx" => LayoutKind::TitleContent,
            "secHead" => LayoutKind::SectionHeader,
            "twoObj" => LayoutKind::TwoContent,
            "twoTxTwoObj" => LayoutKind::Comparison,
            "titleOnly" => LayoutKind::TitleOnly,
            "blank" => LayoutKind::Blank,
            "objTx" => LayoutKind::ContentWithCaption,
            "picTx" => LayoutKind::PictureWithCaption,
            "vertTx" => LayoutKind::VerticalText,
            "vertTitleAndTx" => LayoutKind::VerticalTitleText,
            _ => return None,
        })
    }

    /// PowerPoint's English name (`p:cSld/@name`); a custom layout's own.
    pub fn display_name(&self) -> &str {
        match self {
            LayoutKind::Title => "Title Slide",
            LayoutKind::TitleContent => "Title and Content",
            LayoutKind::SectionHeader => "Section Header",
            LayoutKind::TwoContent => "Two Content",
            LayoutKind::Comparison => "Comparison",
            LayoutKind::TitleOnly => "Title Only",
            LayoutKind::Blank => "Blank",
            LayoutKind::ContentWithCaption => "Content with Caption",
            LayoutKind::PictureWithCaption => "Picture with Caption",
            LayoutKind::VerticalText => "Title and Vertical Text",
            LayoutKind::VerticalTitleText => "Vertical Title and Text",
            LayoutKind::Custom(n) => n,
        }
    }

    /// Whether this is one of the standard layouts.
    pub fn is_standard(&self) -> bool {
        !matches!(self, LayoutKind::Custom(_))
    }
}

impl fmt::Display for LayoutKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.key())
    }
}

impl Serialize for LayoutKind {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.key())
    }
}

impl<'de> Deserialize<'de> for LayoutKind {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let key = String::deserialize(d)?;
        LayoutKind::from_key(&key)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown layout {key:?}")))
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
    /// Content (`obj` / no type, also `dgm`, `media`, …) or text (`body`,
    /// see [`PlaceholderDef::text_only`]).
    Body,
    /// Picture (`pic`).
    Picture,
    /// Chart (`chart`; Slide Master › Insert Placeholder › Chart).
    Chart,
    /// Table (`tbl`; Slide Master › Insert Placeholder › Table).
    Table,
    /// Date and time (`dt`).
    DateTime,
    /// Footer (`ftr`).
    Footer,
    /// Slide number (`sldNum`).
    SlideNumber,
}

impl PlaceholderKind {
    /// The master text style the placeholder uses.
    pub fn text_class(self) -> TextClass {
        match self {
            PlaceholderKind::Title | PlaceholderKind::CenteredTitle => TextClass::Title,
            PlaceholderKind::Subtitle
            | PlaceholderKind::Body
            | PlaceholderKind::Picture
            | PlaceholderKind::Chart
            | PlaceholderKind::Table => TextClass::Body,
            _ => TextClass::Other,
        }
    }

    /// Date, footer or slide number.
    pub fn is_header_footer(self) -> bool {
        matches!(
            self,
            PlaceholderKind::DateTime | PlaceholderKind::Footer | PlaceholderKind::SlideNumber
        )
    }

    /// Placeholders that may stand in for each other when a slide changes
    /// layout: titles; subtitle/body/picture; each header/footer kind on
    /// its own.
    pub fn same_class(self, other: PlaceholderKind) -> bool {
        if self.is_header_footer() || other.is_header_footer() {
            return self == other;
        }
        self.text_class() == other.text_class()
    }

    /// The `idx` PowerPoint's layouts use (0 = none: titles).
    pub fn default_idx(self) -> u32 {
        match self {
            PlaceholderKind::Title | PlaceholderKind::CenteredTitle => 0,
            PlaceholderKind::Subtitle
            | PlaceholderKind::Body
            | PlaceholderKind::Picture
            | PlaceholderKind::Chart
            | PlaceholderKind::Table => 1,
            PlaceholderKind::DateTime => 10,
            PlaceholderKind::Footer => 11,
            PlaceholderKind::SlideNumber => 12,
        }
    }
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn is_true(v: &bool) -> bool {
    *v
}

fn yes() -> bool {
    true
}

/// A placeholder of a layout or of the master: where it sits and how its
/// text looks unless the slide's shape overrides it. The text defaults
/// are effective values (the master's text style overlaid with the
/// layout's own changes).
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
    /// `p:ph/@idx` (0 = none) – slide placeholders find their layout
    /// placeholder by it.
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub idx: u32,
    /// Position and size.
    pub transform: Transform,
    /// Body properties of the placeholder's text.
    #[serde(default)]
    pub body_defaults: BodyProps,
    /// Run formatting of the placeholder's text (level 1).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run_defaults: RunProperties,
    /// Paragraph formatting of the placeholder's text (level 1).
    #[serde(default)]
    pub paragraph_defaults: TextParagraphProps,
    /// A text placeholder (`type="body"`) rather than a content
    /// placeholder (no type, `obj`); only for [`PlaceholderKind::Body`].
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub text_only: bool,
    /// Vertical text (`orient="vert"`, `a:bodyPr vert="eaVert"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub vertical: bool,
    /// Custom prompt text (`p:ph/@hasCustomPrompt` + the placeholder's
    /// text; paragraphs separated by `\n`): what empty slide placeholders
    /// show instead of "Click to add title" (`None`: the standard prompt).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub prompt: Option<String>,
    /// Outline levels 2–9 of the placeholder's own list style
    /// (`a:lstStyle/a:lvl2pPr` … `a:lvl9pPr`; index 0 = level 2): what the
    /// placeholder changes on the master's text style for those levels
    /// (unset fields and missing levels inherit). Level 1 is
    /// `run_defaults`/`paragraph_defaults`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<LevelStyle>>"))]
    pub levels: Vec<LevelStyle>,
}

impl PlaceholderDef {
    /// The placeholder's own changes of outline level `level` (0-based,
    /// `1..=8`; level 0 and missing levels: none).
    pub fn level_override(&self, level: u8) -> Option<&LevelStyle> {
        usize::from(level)
            .checked_sub(1)
            .and_then(|i| self.levels.get(i))
    }

    /// Mutable own changes of outline level `level` (`1..=8`), created
    /// (with the levels before it) when missing; `None` for level 0.
    pub fn level_override_mut(&mut self, level: u8) -> Option<&mut LevelStyle> {
        let i = usize::from(level).checked_sub(1)?;
        if i >= 8 {
            return None;
        }
        while self.levels.len() <= i {
            self.levels.push(LevelStyle::default());
        }
        self.levels.get_mut(i)
    }

    /// Drops trailing empty level overrides.
    pub fn trim_levels(&mut self) {
        while self.levels.last().is_some_and(LevelStyle::is_empty) {
            self.levels.pop();
        }
    }
}

/// A slide layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Layout {
    /// Which layout (unique within the presentation).
    pub kind: LayoutKind,
    /// Display name when it differs from the kind's standard name (e.g.
    /// LibreOffice's "Default"); empty otherwise.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<String>"))]
    pub name: String,
    /// Placeholders, bottom to top.
    #[serde(default)]
    pub placeholders: Vec<PlaceholderDef>,
    /// Background override (`None` = the master's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub background: Option<Background>,
    /// Draw the master's shapes below this layout's (`showMasterSp`).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub show_master_shapes: bool,
    /// Decorative shapes of the layout (drawn below the slide's shapes).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Shape>>"))]
    pub shapes: Vec<Shape>,
}

/// PowerPoint's Office layout boxes for 16:9 slides that differ from the
/// master's.
mod wide {
    use super::boxes::Box4;
    pub const CENTERED_TITLE: Box4 = (1_524_000, 1_122_363, 9_144_000, 2_387_600);
    pub const SUBTITLE: Box4 = (1_524_000, 3_602_038, 9_144_000, 1_655_762);
    pub const SECTION_TITLE: Box4 = (831_850, 1_709_738, 10_515_600, 2_852_737);
    pub const SECTION_TEXT: Box4 = (831_850, 4_589_463, 10_515_600, 1_500_187);
    pub const LEFT_CONTENT: Box4 = (838_200, 1_825_625, 5_181_600, 4_351_338);
    pub const RIGHT_CONTENT: Box4 = (6_172_200, 1_825_625, 5_181_600, 4_351_338);
    pub const CMP_TITLE: Box4 = (839_788, 365_125, 10_515_600, 1_325_563);
    pub const CMP_LEFT_HEAD: Box4 = (839_788, 1_681_163, 5_157_787, 823_912);
    pub const CMP_LEFT: Box4 = (839_788, 2_505_075, 5_157_787, 3_684_588);
    pub const CMP_RIGHT_HEAD: Box4 = (6_172_200, 1_681_163, 5_183_188, 823_912);
    pub const CMP_RIGHT: Box4 = (6_172_200, 2_505_075, 5_183_188, 3_684_588);
    pub const CAPTION_TITLE: Box4 = (839_788, 457_200, 3_932_237, 1_600_200);
    pub const CAPTION_CONTENT: Box4 = (5_183_188, 987_425, 6_172_200, 4_873_625);
    pub const CAPTION_TEXT: Box4 = (839_788, 2_057_400, 3_932_237, 3_811_588);
    pub const VERT_TITLE: Box4 = (8_724_900, 365_125, 2_628_900, 5_811_838);
    pub const VERT_BODY: Box4 = (838_200, 365_125, 7_734_300, 5_811_838);
}

/// The matching 4:3 box: the 16:9 box mapped onto the 4:3 content area
/// (0.6875" … 9.3125").
fn standard_of(b: boxes::Box4) -> boxes::Box4 {
    let (wl, ww) = (838_200i64, 10_515_600i64);
    let (sl, sw) = (628_650i64, 7_886_700i64);
    let x = sl + crate::master::scale(b.0 - wl, sw, ww);
    let w = crate::master::scale(b.2, sw, ww);
    (x, b.1, w, b.3)
}

impl Layout {
    /// An empty layout `kind` (no placeholders, master background, master
    /// shapes shown).
    pub fn new(kind: LayoutKind) -> Self {
        Layout {
            kind,
            name: String::new(),
            placeholders: Vec::new(),
            background: None,
            show_master_shapes: true,
            shapes: Vec::new(),
        }
    }

    /// The display name (`name`, else the kind's).
    pub fn display_name(&self) -> &str {
        if self.name.is_empty() {
            self.kind.display_name()
        } else {
            &self.name
        }
    }

    /// The built-in layout `kind` for slides of `size` with the Office
    /// master ([`SlideMaster::builtin`]): PowerPoint's placeholders and
    /// text defaults (titles 44 pt major font – title slide and section
    /// header 60 pt –, subtitle 24 pt centred without bullets, body 28 pt
    /// with `•` bullets, …) and the date/footer/slide-number placeholders
    /// at the master's positions. Custom layouts get a title.
    pub fn builtin(kind: LayoutKind, size: SlideSize) -> Layout {
        Self::from_master(kind, &SlideMaster::builtin(size), size)
    }

    /// The standard layout `kind` built on `master` (positions of the
    /// title/body/footer placeholders and text styles from it).
    pub fn from_master(kind: LayoutKind, master: &SlideMaster, size: SlideSize) -> Layout {
        use PlaceholderKind as K;
        let at = |b: boxes::Box4| {
            let std = if b == wide::CENTERED_TITLE {
                (685_800, 1_122_363, 7_772_400, 2_387_600)
            } else if b == wide::SUBTITLE {
                (1_143_000, 3_602_038, 6_858_000, 1_655_762)
            } else {
                standard_of(b)
            };
            place(size, b, std)
        };
        let office = SlideMaster::builtin(size);
        let from_master = |k: K, idx: u32| -> PlaceholderDef {
            let mut d = match master.placeholder_for(k) {
                Some(m) => m.clone(),
                None => {
                    let (p, r) = master.style_defaults(k);
                    PlaceholderDef {
                        kind: k,
                        idx,
                        transform: office.placeholder_for(k).map_or_else(
                            || place(size, boxes::WIDE_BODY, boxes::STD_BODY),
                            |d| d.transform,
                        ),
                        body_defaults: office
                            .placeholder_for(k)
                            .map_or_else(BodyProps::default, |d| d.body_defaults),
                        run_defaults: r,
                        paragraph_defaults: p,
                        text_only: false,
                        vertical: false,
                        prompt: None,
                        levels: Vec::new(),
                    }
                }
            };
            d.kind = k;
            d.idx = idx;
            d.text_only = false;
            d
        };
        let title = || from_master(K::Title, 0);
        let content = |idx: u32, b: Option<boxes::Box4>| {
            let mut d = from_master(K::Body, idx);
            if let Some(b) = b {
                d.transform = at(b);
            }
            d
        };
        let size_pt =
            |d: &mut PlaceholderDef, pt: f64| d.run_defaults.size = Some(FontSize::from_pt(pt));
        let no_bullets = |d: &mut PlaceholderDef| d.paragraph_defaults.bullet = Some(Bullet::None);
        let text = |idx: u32, b: boxes::Box4| {
            let mut d = content(idx, Some(b));
            d.text_only = true;
            d
        };
        let mut phs = match &kind {
            LayoutKind::Title => {
                let mut t = from_master(K::CenteredTitle, 0);
                t.transform = at(wide::CENTERED_TITLE);
                t.body_defaults.anchor = Anchor::Bottom;
                t.paragraph_defaults.alignment = Some(Alignment::Center);
                size_pt(&mut t, 60.0);
                let mut s = from_master(K::Subtitle, 1);
                s.transform = at(wide::SUBTITLE);
                s.paragraph_defaults.alignment = Some(Alignment::Center);
                no_bullets(&mut s);
                size_pt(&mut s, 24.0);
                vec![t, s]
            }
            LayoutKind::TitleContent => vec![title(), content(1, None)],
            LayoutKind::SectionHeader => {
                let mut t = title();
                t.transform = at(wide::SECTION_TITLE);
                t.body_defaults.anchor = Anchor::Bottom;
                size_pt(&mut t, 60.0);
                let mut b = text(1, wide::SECTION_TEXT);
                no_bullets(&mut b);
                size_pt(&mut b, 24.0);
                b.run_defaults.color = Some(Color::Theme {
                    slot: ThemeColorSlot::Dark1,
                    tint: 0.25,
                });
                vec![t, b]
            }
            LayoutKind::TwoContent => vec![
                title(),
                content(1, Some(wide::LEFT_CONTENT)),
                content(2, Some(wide::RIGHT_CONTENT)),
            ],
            LayoutKind::Comparison => {
                let mut t = title();
                t.transform = at(wide::CMP_TITLE);
                let head = |idx: u32, b: boxes::Box4| {
                    let mut h = text(idx, b);
                    h.body_defaults.anchor = Anchor::Bottom;
                    no_bullets(&mut h);
                    size_pt(&mut h, 24.0);
                    h.run_defaults.bold = Some(true);
                    h
                };
                vec![
                    t,
                    head(1, wide::CMP_LEFT_HEAD),
                    content(2, Some(wide::CMP_LEFT)),
                    head(3, wide::CMP_RIGHT_HEAD),
                    content(4, Some(wide::CMP_RIGHT)),
                ]
            }
            LayoutKind::TitleOnly | LayoutKind::Custom(_) => vec![title()],
            LayoutKind::Blank => Vec::new(),
            LayoutKind::ContentWithCaption | LayoutKind::PictureWithCaption => {
                let mut t = title();
                t.transform = at(wide::CAPTION_TITLE);
                t.body_defaults.anchor = Anchor::Bottom;
                size_pt(&mut t, 32.0);
                let mut c = if kind == LayoutKind::PictureWithCaption {
                    let mut p = from_master(K::Picture, 1);
                    p.transform = at(wide::CAPTION_CONTENT);
                    no_bullets(&mut p);
                    p
                } else {
                    content(1, Some(wide::CAPTION_CONTENT))
                };
                size_pt(&mut c, 32.0);
                let mut cap = text(2, wide::CAPTION_TEXT);
                no_bullets(&mut cap);
                size_pt(&mut cap, 16.0);
                vec![t, c, cap]
            }
            LayoutKind::VerticalText => {
                let mut b = content(1, None);
                b.text_only = true;
                b.vertical = true;
                vec![title(), b]
            }
            LayoutKind::VerticalTitleText => {
                let mut t = title();
                t.transform = at(wide::VERT_TITLE);
                t.vertical = true;
                let mut b = text(1, wide::VERT_BODY);
                b.vertical = true;
                vec![t, b]
            }
        };
        for (k, idx) in [(K::DateTime, 10), (K::Footer, 11), (K::SlideNumber, 12)] {
            phs.push(from_master(k, idx));
        }
        Layout {
            placeholders: phs,
            ..Layout::new(kind)
        }
    }

    /// One empty shape per placeholder except date, footer and slide
    /// number, bottom to top: a text box at the placeholder's position
    /// with its body properties, one empty paragraph,
    /// [`Shape::placeholder`] and [`Shape::placeholder_idx`] set. Ids are 0
    /// and names empty (see [`crate::Presentation::assign_ids`]).
    pub fn placeholder_shapes(&self) -> Vec<Shape> {
        self.placeholders
            .iter()
            .filter(|d| !d.kind.is_header_footer())
            .map(PlaceholderDef::empty_shape)
            .collect()
    }

    /// The first placeholder of type `kind`, if the layout has one.
    pub fn placeholder(&self, kind: PlaceholderKind) -> Option<&PlaceholderDef> {
        self.placeholders.iter().find(|p| p.kind == kind)
    }

    /// The placeholder a slide placeholder `kind`/`idx` inherits from:
    /// same `idx` (and a compatible kind), else the first of the same
    /// kind, else the first of the same class.
    pub fn find(&self, kind: PlaceholderKind, idx: Option<u32>) -> Option<&PlaceholderDef> {
        idx.and_then(|i| {
            self.placeholders
                .iter()
                .find(|d| d.idx == i && d.kind.same_class(kind))
        })
        .or_else(|| self.placeholder(kind))
        .or_else(|| self.placeholders.iter().find(|d| d.kind.same_class(kind)))
    }
}

impl PlaceholderDef {
    /// An empty slide shape filling this placeholder (id 0, no name).
    pub fn empty_shape(&self) -> Shape {
        let mut shape = Shape::text_box(self.transform, "");
        if let Some(body) = shape.text_mut() {
            *body = TextBody {
                props: self.body_defaults,
                paragraphs: vec![TextParagraph::new()],
            };
        }
        shape.placeholder = Some(self.kind);
        shape.placeholder_idx = (self.idx != 0).then_some(self.idx);
        shape
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::units::Emu;
    use core_model::{FontFace, ThemeFontSlot};

    fn boxes(l: &Layout) -> Vec<(PlaceholderKind, [i64; 4])> {
        l.placeholders
            .iter()
            .filter(|p| !p.kind.is_header_footer())
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
        assert!(boxes(&Layout::builtin(LayoutKind::Blank, size)).is_empty());
        let two = Layout::builtin(LayoutKind::TwoContent, size);
        assert_eq!(
            two.placeholders.iter().map(|p| p.idx).collect::<Vec<_>>(),
            [0, 1, 2, 10, 11, 12]
        );
        assert_eq!(
            boxes(&two)[2].1,
            [6_172_200, 1_825_625, 5_181_600, 4_351_338]
        );
        let cmp = Layout::builtin(LayoutKind::Comparison, size);
        assert_eq!(cmp.placeholders.len(), 8);
        assert!(cmp.placeholders[1].text_only);
        assert_eq!(cmp.placeholders[1].run_defaults.bold, Some(true));
        let pic = Layout::builtin(LayoutKind::PictureWithCaption, size);
        assert_eq!(pic.placeholders[1].kind, PlaceholderKind::Picture);
        let vert = Layout::builtin(LayoutKind::VerticalTitleText, size);
        assert!(vert.placeholders[0].vertical && vert.placeholders[1].vertical);
        // every standard layout has the date/footer/number placeholders
        for k in LayoutKind::STANDARD {
            let l = Layout::builtin(k.clone(), size);
            let hf: Vec<_> = l
                .placeholders
                .iter()
                .filter(|p| p.kind.is_header_footer())
                .map(|p| p.idx)
                .collect();
            assert_eq!(hf, [10, 11, 12], "{k:?}");
            assert!(l
                .placeholder_shapes()
                .iter()
                .all(|s| !s.placeholder.unwrap().is_header_footer()));
        }
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
        let two = Layout::builtin(LayoutKind::TwoContent, SlideSize::standard());
        assert_eq!(boxes(&two)[1].1, [628_650, 1_825_625, 3_886_200, 4_351_338]);
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
        assert_eq!(title.body_defaults.anchor, Anchor::Middle);
        let body = l.placeholder(PlaceholderKind::Body).unwrap();
        assert_eq!(body.run_defaults.size, Some(FontSize::from_pt(28.0)));
        assert_eq!(
            body.paragraph_defaults.bullet,
            Some(Bullet::Char("•".into()))
        );
        assert!(l.placeholder(PlaceholderKind::Subtitle).is_none());
        let t = Layout::builtin(LayoutKind::Title, SlideSize::widescreen());
        assert_eq!(
            t.placeholders[0].run_defaults.size,
            Some(FontSize::from_pt(60.0))
        );
        assert_eq!(
            t.placeholders[1].paragraph_defaults.bullet,
            Some(Bullet::None)
        );
    }

    #[test]
    fn keys_and_lookup() {
        for k in LayoutKind::STANDARD {
            assert_eq!(LayoutKind::from_key(&k.key()), Some(k.clone()));
            assert_eq!(LayoutKind::from_ooxml_type(k.ooxml_type()), Some(k.clone()));
        }
        let c = LayoutKind::Custom("My: Layout".into());
        assert_eq!(serde_json::to_string(&c).unwrap(), r#""custom:My: Layout""#);
        assert_eq!(
            serde_json::from_str::<LayoutKind>(r#""custom:My: Layout""#).unwrap(),
            c
        );
        assert_eq!(
            serde_json::to_string(&LayoutKind::Title).unwrap(),
            r#""title""#
        );
        assert!(serde_json::from_str::<LayoutKind>(r#""nope""#).is_err());
        let cmp = Layout::builtin(LayoutKind::Comparison, SlideSize::widescreen());
        assert_eq!(cmp.find(PlaceholderKind::Body, Some(4)).unwrap().idx, 4);
        assert_eq!(cmp.find(PlaceholderKind::Body, Some(9)).unwrap().idx, 1);
        assert_eq!(cmp.find(PlaceholderKind::Subtitle, None).unwrap().idx, 1);
        assert_eq!(
            cmp.find(PlaceholderKind::CenteredTitle, None).unwrap().kind,
            PlaceholderKind::Title
        );
        // a picture placeholder falls back to the first body-class one
        assert_eq!(cmp.find(PlaceholderKind::Picture, Some(12)).unwrap().idx, 1);
        assert!(cmp
            .find(PlaceholderKind::Footer, Some(1))
            .is_some_and(|d| d.idx == 11));
        let blank = Layout::builtin(LayoutKind::Blank, SlideSize::widescreen());
        assert!(blank.find(PlaceholderKind::Title, None).is_none());
    }
}
