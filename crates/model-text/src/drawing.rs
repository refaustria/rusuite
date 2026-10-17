//! Drawings in the text: shapes and text boxes (docx `wps:wsp` inside
//! `w:drawing`, inline `wp:inline` or floating `wp:anchor`), and the
//! formatting of pictures (crop, border, outline shape, shadow, colour
//! corrections; `pic:pic` → `a:srcRect`, `a:ln`, `a:prstGeom`,
//! `a:effectLst`, `a:blip` effects).
//!
//! A [`Drawing`] is an inline (one position in its paragraph, like an
//! image) whose optional [`DrawingText`] holds ordinary [`Block`]s with
//! document-unique ids: the text of a shape or text box is a nested block
//! container, addressed by the same text commands as the body (the
//! drawing's own [`Drawing::id`] names the container). Text boxes do not
//! nest: blocks inside a drawing hold no drawings.
//!
//! Geometry is a DrawingML preset name (`rect`, `roundRect`, `ellipse`, …,
//! kept verbatim so that every preset round-trips) with its adjust values;
//! outlines are computed by the shared preset path code (Show's
//! `model_show::geometry`, asked through write-core). A custom geometry
//! (`a:custGeom`) is kept as XML and drawn as its bounding box.
//!
//! Groups (`wpg:wgp`, [`DrawingKind::Group`]) hold their members in
//! [`Drawing::children`]: shapes, text boxes, pictures
//! ([`DrawingKind::Picture`]) and nested groups, each placed by
//! [`Drawing::x`]/[`Drawing::y`] in the group's own frame (EMU from its
//! top-left corner, the group's `chOff`/`chExt` resolved on read). Linked
//! text boxes ([`TextChain`]) keep the whole story in the first box of the
//! chain (`seq` 0, `wps:txbx id`); the others (`wps:linkedTxbx id seq`)
//! show what overflows.

use std::collections::BTreeMap;

use core_model::units::Emu;
use core_model::Color;
use serde::{Deserialize, Serialize};

use crate::block::{Block, NodeId};
use crate::inline::{Anchor, Insets, VAlignPos};

/// A fill (`a:noFill` / `a:solidFill`).
///
/// Serializes as `{"kind":"none"}` or `{"kind":"solid","value":<Color>}`.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum ShapeFill {
    /// Transparent.
    #[default]
    None,
    /// A solid colour.
    Solid(#[cfg_attr(feature = "ts", ts(as = "app_common::wire::Color"))] Color),
}

/// Dash style of an outline (`a:prstDash`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum LineDash {
    /// Solid (`solid`).
    #[default]
    Solid,
    /// Round dots (`sysDot`).
    Dot,
    /// Square dots (`sysDash`).
    SquareDot,
    /// Dashes (`dash`).
    Dash,
    /// Dash dot (`dashDot`).
    DashDot,
    /// Long dashes (`lgDash`).
    LongDash,
    /// Long dash dot (`lgDashDot`).
    LongDashDot,
}

impl LineDash {
    /// The `a:prstDash` value.
    pub fn prst(self) -> &'static str {
        match self {
            LineDash::Solid => "solid",
            LineDash::Dot => "sysDot",
            LineDash::SquareDot => "sysDash",
            LineDash::Dash => "dash",
            LineDash::DashDot => "dashDot",
            LineDash::LongDash => "lgDash",
            LineDash::LongDashDot => "lgDashDot",
        }
    }

    /// Parses an `a:prstDash` value (unknown values: dashes).
    pub fn from_prst(v: &str) -> LineDash {
        match v {
            "solid" => LineDash::Solid,
            "sysDot" | "dot" => LineDash::Dot,
            "sysDash" => LineDash::SquareDot,
            "dashDot" | "sysDashDot" | "sysDashDotDot" => LineDash::DashDot,
            "lgDash" => LineDash::LongDash,
            "lgDashDot" | "lgDashDotDot" => LineDash::LongDashDot,
            _ => LineDash::Dash,
        }
    }
}

/// An outline (`a:ln`): colour (none = no outline), width and dashes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct ShapeLine {
    /// Line colour; [`ShapeFill::None`] = no outline.
    pub fill: ShapeFill,
    /// Width (EMU; 12700 = 1 pt).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Dashes.
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<LineDash>"))]
    pub dash: LineDash,
}

impl Default for ShapeLine {
    /// No outline (0.75 pt once coloured).
    fn default() -> Self {
        ShapeLine {
            fill: ShapeFill::None,
            width: Emu(9525),
            dash: LineDash::Solid,
        }
    }
}

impl ShapeLine {
    /// A solid outline.
    pub fn solid(color: Color, width: Emu) -> Self {
        ShapeLine {
            fill: ShapeFill::Solid(color),
            width,
            dash: LineDash::Solid,
        }
    }

    /// Whether the outline is invisible.
    pub fn is_none(&self) -> bool {
        self.fill == ShapeFill::None
    }
}

fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

/// Shape or text box (docx: a text box is a `wps:wsp` with
/// `wps:cNvSpPr txBox="1"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum DrawingKind {
    /// An auto shape (its text is optional).
    #[default]
    Shape,
    /// A text box.
    TextBox,
    /// A group of drawings (`wpg:wgp`; members in [`Drawing::children`]).
    Group,
    /// A picture inside a group (`pic:pic`; [`Drawing::picture`]).
    Picture,
}

impl DrawingKind {
    /// Whether the drawing holds members ([`Drawing::children`]).
    pub fn is_container(self) -> bool {
        matches!(self, DrawingKind::Group)
    }
}

/// Membership of a text box in a chain of linked text boxes (Shape Format ›
/// Create Link): `id` names the chain (`wps:txbx/@id` of its first box,
/// `wps:linkedTxbx/@id` of the others), `seq` the order (0 = the first
/// box, which holds the text).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TextChain {
    /// Chain id.
    pub id: u32,
    /// Position in the chain (0 = first).
    pub seq: u32,
}

/// The picture of a [`DrawingKind::Picture`] group member.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct DrawingPicture {
    /// The image data in the document's [`crate::MediaStore`].
    #[cfg_attr(feature = "ts", ts(as = "crate::media::MediaIdTs"))]
    pub media: crate::media::MediaId,
    /// Crop, border and effects.
    #[serde(default, skip_serializing_if = "PictureFormat::is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<PictureFormat>"))]
    pub format: PictureFormat,
}

/// How the text box fits its text (`wps:bodyPr` children).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum Autofit {
    /// Fixed size (`a:noAutofit`, or nothing).
    #[default]
    None,
    /// The shape grows to fit the text (`a:spAutoFit`, Word's "Resize shape
    /// to fit text").
    Resize,
}

/// Word's default text insets of shapes and text boxes: 0.25 cm left and
/// right, 0.13 cm top and bottom (`lIns=91440 tIns=45720`).
pub fn default_text_insets() -> Insets {
    Insets {
        top: Emu(45_720),
        bottom: Emu(45_720),
        left: Emu(91_440),
        right: Emu(91_440),
    }
}

fn is_default_insets(v: &Insets) -> bool {
    *v == default_text_insets()
}

fn yes() -> bool {
    true
}

fn is_true(v: &bool) -> bool {
    *v
}

/// The text of a shape or text box (`wps:txbx/w:txbxContent` with the
/// layout of `wps:bodyPr`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct DrawingText {
    /// The content: at least one block, the last a paragraph
    /// ([`crate::Document::normalize`]); no drawings inside.
    pub blocks: Vec<Block>,
    /// Distance of the text from the shape's edges (`lIns tIns rIns bIns`).
    #[serde(
        default = "default_text_insets",
        skip_serializing_if = "is_default_insets"
    )]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Insets>"))]
    pub insets: Insets,
    /// Vertical alignment (`anchor="t|ctr|b"`).
    #[serde(default = "top", skip_serializing_if = "is_top")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<VAlignPos>"))]
    pub vertical_align: VAlignPos,
    /// Autofit.
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Autofit>"))]
    pub autofit: Autofit,
    /// Wrap text in the shape (`wrap="square"`; `none` = one line).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub wrap: bool,
}

fn top() -> VAlignPos {
    VAlignPos::Top
}

fn is_top(v: &VAlignPos) -> bool {
    *v == VAlignPos::Top
}

impl DrawingText {
    /// Text with Word's defaults (top aligned, default insets, fixed size).
    pub fn new(blocks: Vec<Block>) -> Self {
        DrawingText {
            blocks,
            insets: default_text_insets(),
            vertical_align: VAlignPos::Top,
            autofit: Autofit::None,
            wrap: true,
        }
    }
}

/// A shape or text box in the text (see the module docs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Drawing {
    /// Node id of the drawing (the container id of its text blocks).
    pub id: NodeId,
    /// Shape or text box.
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<DrawingKind>"))]
    pub kind: DrawingKind,
    /// Width (`wp:extent cx`).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Height (`wp:extent cy`).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub height: Emu,
    /// Floating placement (`wp:anchor`); `None` = inline (`wp:inline`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub anchor: Option<Anchor>,
    /// Object name (`wp:docPr/@name`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub name: Option<String>,
    /// Alternative text (`wp:docPr/@descr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub alt: Option<String>,
    /// Rotation in degrees clockwise (`a:xfrm/@rot` / 60000).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<f64>"))]
    pub rotation: f64,
    /// Flipped horizontally (`flipH`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub flip_h: bool,
    /// Flipped vertically (`flipV`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub flip_v: bool,
    /// DrawingML preset geometry name (`a:prstGeom/@prst`: `rect`,
    /// `roundRect`, `ellipse`, `rightArrow`, …).
    pub preset: String,
    /// Adjust values by guide name (`a:avLst/a:gd fmla="val N"`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<BTreeMap<String, f64>>"))]
    pub adjust: BTreeMap<String, i64>,
    /// A custom geometry (`a:custGeom`) as XML, written back verbatim
    /// (drawn as the bounding box; `preset` is then `rect`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub custom_geometry: Option<String>,
    /// Fill.
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ShapeFill>"))]
    pub fill: ShapeFill,
    /// Outline.
    #[serde(default, skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ShapeLine>"))]
    pub line: ShapeLine,
    /// Default text colour of the shape's text (`wps:style/a:fontRef`; Word
    /// shapes use white text on the accent fill).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<app_common::wire::Color>"))]
    pub text_color: Option<Color>,
    /// The text (always present for text boxes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub text: Option<DrawingText>,
    /// The linked text box chain this text box belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub chain: Option<TextChain>,
    /// Members of a group, in z-order (first = bottom).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Drawing>>"))]
    pub children: Vec<Drawing>,
    /// Left edge inside the parent group (EMU; 0 outside groups).
    #[serde(default, skip_serializing_if = "is_zero_emu")]
    #[cfg_attr(feature = "ts", ts(optional, type = "number"))]
    pub x: Emu,
    /// Top edge inside the parent group (EMU; 0 outside groups).
    #[serde(default, skip_serializing_if = "is_zero_emu")]
    #[cfg_attr(feature = "ts", ts(optional, type = "number"))]
    pub y: Emu,
    /// The picture of a [`DrawingKind::Picture`] member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub picture: Option<DrawingPicture>,
    /// The hyperlink of the shape (`wp:docPr/a:hlinkClick`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub link: Option<crate::link::Hyperlink>,
    /// Marked as decorative (Alt Text › Mark as decorative; the
    /// `adec:decorative` extension of `wp:docPr`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub decorative: bool,
}

fn is_zero_emu(v: &Emu) -> bool {
    v.0 == 0
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

impl Drawing {
    /// Word's default look of a new shape (Insert › Shapes): Office theme
    /// accent 1 fill, a darker 1 pt outline, white text, centred.
    pub fn shape(id: NodeId, preset: &str, width: Emu, height: Emu) -> Self {
        Drawing {
            id,
            kind: DrawingKind::Shape,
            width,
            height,
            anchor: None,
            name: None,
            alt: None,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            preset: preset.to_owned(),
            adjust: BTreeMap::new(),
            custom_geometry: None,
            fill: ShapeFill::Solid(Color::theme(core_model::ThemeColorSlot::Accent1)),
            line: ShapeLine::solid(
                Color::Theme {
                    slot: core_model::ThemeColorSlot::Accent1,
                    tint: -0.5,
                },
                Emu(12_700),
            ),
            text_color: Some(Color::theme(core_model::ThemeColorSlot::Light1)),
            text: None,
            chain: None,
            children: Vec::new(),
            x: Emu(0),
            y: Emu(0),
            picture: None,
            link: None,
            decorative: false,
        }
    }

    /// A group of `children` (placed in a `width` × `height` frame).
    pub fn group(id: NodeId, width: Emu, height: Emu, children: Vec<Drawing>) -> Self {
        Drawing {
            kind: DrawingKind::Group,
            fill: ShapeFill::None,
            line: ShapeLine::default(),
            text_color: None,
            children,
            ..Drawing::shape(id, "rect", width, height)
        }
    }

    /// A picture member of a group.
    pub fn picture(id: NodeId, media: crate::media::MediaId, width: Emu, height: Emu) -> Self {
        Drawing {
            kind: DrawingKind::Picture,
            fill: ShapeFill::None,
            line: ShapeLine::default(),
            text_color: None,
            picture: Some(DrawingPicture {
                media,
                format: PictureFormat::default(),
            }),
            ..Drawing::shape(id, "rect", width, height)
        }
    }

    /// This drawing and all its members (depth first, the drawing first).
    pub fn walk(&self) -> Vec<&Drawing> {
        let mut out = vec![self];
        for c in &self.children {
            out.extend(c.walk());
        }
        out
    }

    /// Calls `f` on this drawing and every member (depth first).
    pub fn walk_mut(&mut self, f: &mut dyn FnMut(&mut Drawing)) {
        f(self);
        for c in &mut self.children {
            c.walk_mut(f);
        }
    }

    /// Scales the members' frames to a new group size (Word: resizing a
    /// group resizes and moves its members proportionally).
    pub fn scale_children(&mut self, width: Emu, height: Emu) {
        let sx = width.0 as f64 / self.width.0.max(1) as f64;
        let sy = height.0 as f64 / self.height.0.max(1) as f64;
        fn scale(d: &mut Drawing, sx: f64, sy: f64) {
            d.x = Emu((d.x.0 as f64 * sx).round() as i64);
            d.y = Emu((d.y.0 as f64 * sy).round() as i64);
            let (w, h) = (
                Emu(((d.width.0 as f64 * sx).round() as i64).max(1)),
                Emu(((d.height.0 as f64 * sy).round() as i64).max(1)),
            );
            let (ox, oy) = (d.width.0 as f64, d.height.0 as f64);
            d.width = w;
            d.height = h;
            let (csx, csy) = (w.0 as f64 / ox.max(1.0), h.0 as f64 / oy.max(1.0));
            for c in &mut d.children {
                scale(c, csx, csy);
            }
        }
        for c in &mut self.children {
            scale(c, sx, sy);
        }
        self.width = width;
        self.height = height;
    }

    /// Word's Simple Text Box: white fill, black 0.75 pt outline, `blocks`
    /// as its text.
    pub fn text_box(id: NodeId, width: Emu, height: Emu, blocks: Vec<Block>) -> Self {
        Drawing {
            kind: DrawingKind::TextBox,
            fill: ShapeFill::Solid(Color::Rgb(core_model::Rgb::WHITE)),
            line: ShapeLine::solid(Color::Rgb(core_model::Rgb::BLACK), Emu(9525)),
            text_color: None,
            text: Some(DrawingText::new(blocks)),
            ..Drawing::shape(id, "rect", width, height)
        }
    }

    /// The text blocks (empty without text).
    pub fn blocks(&self) -> &[Block] {
        self.text.as_ref().map_or(&[], |t| t.blocks.as_slice())
    }

    /// Mutable text blocks, if the drawing has text.
    pub fn blocks_mut(&mut self) -> Option<&mut Vec<Block>> {
        self.text.as_mut().map(|t| &mut t.blocks)
    }
}

/// Crop of a picture: the parts cut off each edge in 1/1000 % of the
/// image (`a:srcRect l t r b`; 25000 = a quarter). Negative values pad.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Crop {
    /// Left edge.
    pub left: i32,
    /// Top edge.
    pub top: i32,
    /// Right edge.
    pub right: i32,
    /// Bottom edge.
    pub bottom: i32,
}

impl Crop {
    /// Whether nothing is cropped.
    pub fn is_none(&self) -> bool {
        *self == Crop::default()
    }
}

/// Recolouring of a picture (Picture Format › Color).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum Recolor {
    /// Original colours.
    #[default]
    None,
    /// Grayscale (`a:grayscl`).
    Grayscale,
    /// Sepia (`a:duotone` black → `D9C3A5`).
    Sepia,
    /// Washout (`a:lum bright="70000" contrast="-70000"`, Word's Washout).
    Washout,
    /// Black and white (`a:biLevel thresh="50000"`).
    BlackWhite,
}

/// A bevel of a picture (Picture Effects › Bevel; `a:sp3d/a:bevelT`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Bevel {
    /// DrawingML bevel preset (`circle`, `relaxedInset`, `cross`,
    /// `coolSlant`, `angle`, `softRound`, `convex`, `slope`, `divot`,
    /// `riblet`, `hardEdge`, `artDeco`), kept verbatim.
    pub preset: String,
    /// Width (EMU; Word's default 76200 = 6 pt).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Height (EMU).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub height: Emu,
}

/// Formatting of a picture: crop, border, outline shape, shadow and
/// corrections. Brightness and contrast follow Word's Picture Corrections
/// (`a:lum bright contrast`, 1/1000 %, `-100000..=100000`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct PictureFormat {
    /// Crop (`a:srcRect`).
    #[serde(skip_serializing_if = "Crop::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Crop>"))]
    pub crop: Crop,
    /// Picture Border (`pic:spPr/a:ln`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub border: Option<ShapeLine>,
    /// Outline shape (`pic:spPr/a:prstGeom`, `None` = `rect`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub geometry: Option<String>,
    /// Outer shadow (`a:effectLst/a:outerShdw`, Word's "Offset: Bottom
    /// Right").
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(as = "Option<bool>", optional))]
    pub shadow: bool,
    /// Brightness.
    #[serde(skip_serializing_if = "is_zero_i")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<i32>"))]
    pub brightness: i32,
    /// Contrast.
    #[serde(skip_serializing_if = "is_zero_i")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<i32>"))]
    pub contrast: i32,
    /// Recolouring.
    #[serde(skip_serializing_if = "is_default")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Recolor>"))]
    pub recolor: Recolor,
    /// Soft edges: the radius of the feathered border (`a:softEdge/@rad`,
    /// EMU).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, type = "number"))]
    pub soft_edge: Option<Emu>,
    /// Bevel (`a:scene3d` + `a:sp3d/a:bevelT`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bevel: Option<Bevel>,
}

fn is_zero_i(v: &i32) -> bool {
    *v == 0
}

impl PictureFormat {
    /// Whether nothing is set (Reset Picture).
    pub fn is_default(&self) -> bool {
        *self == PictureFormat::default()
    }
}

/// Calls `f` on every drawing in `blocks` (cells included, group members
/// included).
pub fn for_each_drawing_mut(blocks: &mut [Block], f: &mut dyn FnMut(&mut Drawing)) {
    for b in blocks {
        match b {
            Block::Paragraph(p) => {
                for d in p.drawings_mut() {
                    d.walk_mut(f);
                }
            }
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    for_each_drawing_mut(&mut cell.blocks, f);
                }
            }
            Block::Toc(_) => {}
        }
    }
}

impl crate::Document {
    /// Restores the invariants of linked text boxes: chains only on text
    /// boxes, every chain has one first box (`seq` 0) and at least one
    /// other box (else the chain is dropped), and the other boxes hold no
    /// text of their own (one empty paragraph). Returns whether anything
    /// changed.
    pub fn fix_text_chains(&mut self) -> bool {
        let mut members: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        let mut changed = false;
        for c in self.containers_mut() {
            for_each_drawing_mut(c, &mut |d| {
                if d.chain.is_some() && d.kind != DrawingKind::TextBox {
                    d.chain = None;
                    changed = true;
                }
                if let Some(ch) = d.chain {
                    members.entry(ch.id).or_default().push(ch.seq);
                }
            });
        }
        let valid: std::collections::BTreeSet<u32> = members
            .iter()
            .filter(|(_, seqs)| seqs.iter().filter(|s| **s == 0).count() == 1 && seqs.len() > 1)
            .map(|(id, _)| *id)
            .collect();
        for c in self.containers_mut() {
            for_each_drawing_mut(c, &mut |d| {
                let Some(ch) = d.chain else { return };
                if !valid.contains(&ch.id) {
                    d.chain = None;
                    changed = true;
                    return;
                }
                if ch.seq == 0 {
                    return;
                }
                if let Some(t) = d.text.as_mut() {
                    let empty = matches!(t.blocks.as_slice(), [Block::Paragraph(p)] if p.inlines.is_empty());
                    if !empty {
                        let first = t.blocks.iter().find_map(|b| match b {
                            Block::Paragraph(p) => Some(p.id),
                            _ => None,
                        });
                        t.blocks = first
                            .map(|id| vec![Block::Paragraph(crate::Paragraph::new(id))])
                            .unwrap_or_default();
                        changed = true;
                    }
                }
            });
        }
        changed
    }

    /// The text boxes of chain `id` in `seq` order, as (seq, drawing id).
    pub fn text_chain(&self, id: u32) -> Vec<(u32, NodeId)> {
        let mut out = Vec::new();
        for c in self.containers() {
            for p in crate::document::paragraphs_in(c) {
                for d in p.drawings().flat_map(|d| d.walk()) {
                    if let Some(ch) = d.chain.filter(|ch| ch.id == id) {
                        out.push((ch.seq, d.id));
                    }
                }
            }
        }
        out.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_scaling_moves_and_resizes_members() {
        let mut a = Drawing::shape(NodeId(2), "rect", Emu(100), Emu(50));
        a.x = Emu(100);
        let mut inner = Drawing::group(
            NodeId(4),
            Emu(100),
            Emu(100),
            vec![Drawing::shape(NodeId(5), "ellipse", Emu(50), Emu(100))],
        );
        inner.y = Emu(50);
        let mut g = Drawing::group(NodeId(1), Emu(200), Emu(150), vec![a, inner]);
        g.scale_children(Emu(400), Emu(300));
        assert_eq!((g.width, g.height), (Emu(400), Emu(300)));
        let c = &g.children;
        assert_eq!(
            (c[0].x, c[0].width, c[0].height),
            (Emu(200), Emu(200), Emu(100))
        );
        assert_eq!(
            (c[1].y, c[1].width, c[1].height),
            (Emu(100), Emu(200), Emu(200))
        );
        assert_eq!(c[1].children[0].width, Emu(100));
        assert_eq!(c[1].children[0].height, Emu(200));
        assert_eq!(g.walk().len(), 4);
        let json = serde_json::to_value(&g).unwrap();
        assert_eq!(json["kind"], "group");
        assert_eq!(json["children"][0]["x"], 200);
        assert!(json["children"][1].get("x").is_none());
        let back: Drawing = serde_json::from_value(json).unwrap();
        assert_eq!(back, g);
        let mut tb = Drawing::text_box(NodeId(9), Emu(1), Emu(1), Vec::new());
        tb.chain = Some(TextChain { id: 3, seq: 1 });
        let json = serde_json::to_value(&tb).unwrap();
        assert_eq!(json["chain"], serde_json::json!({"id": 3, "seq": 1}));
    }

    #[test]
    fn text_chains_are_repaired() {
        use crate::{Inline, Paragraph, Run};
        let mut doc = crate::Document::new();
        let text = |id: u64, s: &str| {
            let mut p = Paragraph::new(NodeId(id));
            if !s.is_empty() {
                p.inlines.push(Inline::Run(Run::new(s)));
            }
            vec![Block::Paragraph(p)]
        };
        let mut head = Drawing::text_box(NodeId(100), Emu(10), Emu(10), text(101, "story"));
        head.chain = Some(TextChain { id: 1, seq: 0 });
        let mut next = Drawing::text_box(NodeId(102), Emu(10), Emu(10), text(103, "own text"));
        next.chain = Some(TextChain { id: 1, seq: 1 });
        let mut lonely = Drawing::text_box(NodeId(104), Emu(10), Emu(10), text(105, "x"));
        lonely.chain = Some(TextChain { id: 2, seq: 0 });
        let mut shape = Drawing::shape(NodeId(106), "rect", Emu(10), Emu(10));
        shape.chain = Some(TextChain { id: 1, seq: 2 });
        let mut p = Paragraph::new(NodeId(99));
        for d in [head, next, lonely, shape] {
            p.inlines.push(Inline::Drawing(Box::new(d)));
        }
        doc.body = vec![Block::Paragraph(p)];
        assert!(doc.fix_text_chains());
        let ds: Vec<&Drawing> = doc.body[0].as_paragraph().unwrap().drawings().collect();
        assert_eq!(ds[0].chain, Some(TextChain { id: 1, seq: 0 }));
        assert_eq!(ds[1].chain, Some(TextChain { id: 1, seq: 1 }));
        assert!(
            matches!(ds[1].blocks(), [Block::Paragraph(p)] if p.inlines.is_empty() && p.id == NodeId(103))
        );
        assert_eq!(ds[2].chain, None);
        assert_eq!(ds[3].chain, None);
        assert_eq!(doc.text_chain(1), vec![(0, NodeId(100)), (1, NodeId(102))]);
        assert!(!doc.fix_text_chains());
    }

    #[test]
    fn json_defaults_are_omitted() {
        let d = Drawing::text_box(NodeId(5), Emu(100), Emu(50), Vec::new());
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["kind"], "textBox");
        assert!(json.get("rotation").is_none());
        assert!(json.get("flipH").is_none());
        assert!(json["text"].get("insets").is_none());
        assert!(json["text"].get("wrap").is_none());
        let back: Drawing = serde_json::from_value(json).unwrap();
        assert_eq!(back, d);
        let f = PictureFormat::default();
        assert_eq!(serde_json::to_string(&f).unwrap(), "{}");
        for d in [
            LineDash::Solid,
            LineDash::Dot,
            LineDash::SquareDot,
            LineDash::Dash,
            LineDash::DashDot,
            LineDash::LongDash,
            LineDash::LongDashDot,
        ] {
            assert_eq!(LineDash::from_prst(d.prst()), d);
        }
    }
}
