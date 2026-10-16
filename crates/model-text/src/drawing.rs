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
        }
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

#[cfg(test)]
mod tests {
    use super::*;

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
