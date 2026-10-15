//! [`ShowCommand`]: every edit the UI can send.
//!
//! Slides and shapes are addressed by [`NodeId`]. Shapes created by the
//! UI carry *temporary* negative ids; the patch's `idMap` lists
//! `[temp, real]` for each of them (non-negative ids are taken as given
//! and must be unused).
//!
//! Transforms of group children are relative to the group (ADR 0008), so
//! the UI sends them in the group's coordinate space. Text positions are
//! char offsets inside one paragraph: Unicode scalar values of the runs'
//! text, `0..=len`.

use core_model::media::MediaId;
use core_model::RunProperties;
use model_show::{
    AlignMode, Alignment, Axis, Bullet, Fill, Layout, LayoutKind, Line, NodeId, PlaceholderKind,
    Preset, Shape, ShapeKind, Slide, SlideSize, TextBody, TextSpacing, Transform,
};
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// Deserializes a present field (even `null`) as `Some(..)`, so that
/// `Option<Option<T>>` distinguishes "absent" (`None`, via
/// `#[serde(default)]`) from `null` (`Some(None)`).
fn double_option<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Z-order operation of [`ShowCommand::ZOrder`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum ZOp {
    /// One step up (past the next unselected shape).
    BringForward,
    /// One step down.
    SendBackward,
    /// To the top (selected shapes keep their relative order).
    BringToFront,
    /// To the bottom.
    SendToBack,
}

/// Reference box of [`ShowCommand::Align`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum AlignTarget {
    /// The slide.
    Slide,
    /// The bounds of the selected shapes (a single shape aligns to the
    /// slide, as in PowerPoint).
    Selection,
}

/// Paragraph properties to change for [`ShowCommand::SetParagraphProps`].
/// Absent fields keep their value; `null` resets an optional property to
/// "inherit from the layout".
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct TextParagraphPatch {
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Alignment>")]
    pub alignment: Option<Option<Alignment>>,
    /// Outline level, clamped to `0..=8`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub level: Option<u8>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Bullet>")]
    pub bullet: Option<Option<Bullet>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<TextSpacing>")]
    pub spacing_before: Option<Option<TextSpacing>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<TextSpacing>")]
    pub spacing_after: Option<Option<TextSpacing>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<TextSpacing>")]
    pub line_spacing: Option<Option<TextSpacing>>,
}

impl TextParagraphPatch {
    /// Applies the patch to `props`.
    pub fn apply_to(&self, props: &mut model_show::TextParagraphProps) {
        if let Some(v) = self.alignment {
            props.alignment = v;
        }
        if let Some(v) = self.level {
            props.level = v.min(8);
        }
        if let Some(v) = &self.bullet {
            props.bullet.clone_from(v);
        }
        if let Some(v) = self.spacing_before {
            props.spacing_before = v;
        }
        if let Some(v) = self.spacing_after {
            props.spacing_after = v;
        }
        if let Some(v) = self.line_spacing {
            props.line_spacing = v;
        }
    }
}

/// A presentation edit. JSON: `{"type":"setName","shape":7,"name":"Logo"}`.
///
/// The variants after [`Compound`](Self::Compound) are **internal**: the
/// document produces them as inverses for undo/redo. They are
/// serializable (the undo stack holds commands) but the UI never needs to
/// send them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum ShowCommand {
    /// Inserts a slide with `layout` after slide `after` (absent = first),
    /// holding one empty shape per layout placeholder. `newIds`: empty, or
    /// the slide id followed by one id per placeholder shape.
    AddSlide {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<NodeId>,
        layout: LayoutKind,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(type = "Array<number>")]
        new_ids: Vec<i64>,
    },
    /// Deletes slides (a presentation may end up without slides).
    DeleteSlides { ids: Vec<NodeId> },
    /// Inserts a deep copy of slide `id` right after it. `newIds`: empty,
    /// or the copy's id followed by one id per shape in depth-first order
    /// (a group before its children).
    DuplicateSlide {
        id: NodeId,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(type = "Array<number>")]
        new_ids: Vec<i64>,
    },
    /// Moves slide `id` to position `toIndex` (`0..slides`).
    MoveSlide { id: NodeId, to_index: u32 },
    /// Sets (or, with `null`, clears) the slide's background.
    SetSlideBackground {
        slide: NodeId,
        #[serde(default)]
        fill: Option<Fill>,
    },
    /// Adds `shape` (temporary ids, also for group children; empty names
    /// get defaults) to the slide at z-index `index` (absent = on top).
    AddShape {
        slide: NodeId,
        #[ts(as = "Shape")]
        shape: NewShape,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        index: Option<u32>,
    },
    /// Deletes shapes (also inside groups; a group left empty is removed).
    DeleteShapes { ids: Vec<NodeId> },
    /// Sets transforms (in the parent's coordinate space). Resizing a group
    /// scales its children.
    SetTransform { shapes: Vec<(NodeId, Transform)> },
    /// Changes fill and/or outline. Absent = unchanged, `null` = none
    /// (no fill / no outline). Applied to the leaves of groups.
    SetShapeStyle {
        shapes: Vec<NodeId>,
        #[serde(
            default,
            deserialize_with = "double_option",
            skip_serializing_if = "Option::is_none"
        )]
        #[ts(optional = nullable, as = "Option<Fill>")]
        fill: Option<Option<Fill>>,
        #[serde(
            default,
            deserialize_with = "double_option",
            skip_serializing_if = "Option::is_none"
        )]
        #[ts(optional = nullable, as = "Option<Line>")]
        line: Option<Option<Line>>,
    },
    /// Replaces the text of an auto shape (the overlay editor's result).
    SetTextBody { shape: NodeId, body: TextBody },
    /// Merges `patch` into the formatting of chars `from..to` of
    /// paragraph `paragraph`, splitting runs at the boundaries.
    SetRunProps {
        shape: NodeId,
        paragraph: u32,
        from: u32,
        to: u32,
        #[ts(as = "app_common::wire::RunProperties")]
        patch: RunProperties,
    },
    /// Changes the properties of paragraphs (by index) of a shape's text.
    SetParagraphProps {
        shape: NodeId,
        paragraphs: Vec<u32>,
        patch: TextParagraphPatch,
    },
    /// Renames a shape.
    SetName { shape: NodeId, name: String },
    /// Changes the z-order of shapes within their container (slide or
    /// group).
    ZOrder { shapes: Vec<NodeId>, op: ZOp },
    /// Aligns top-level shapes of one slide.
    Align {
        shapes: Vec<NodeId>,
        mode: AlignMode,
        to: AlignTarget,
    },
    /// Spaces top-level shapes of one slide evenly (three or more).
    Distribute { shapes: Vec<NodeId>, axis: Axis },
    /// Groups two or more top-level shapes of one slide; the group takes
    /// the z-position of the topmost of them. Absolute positions are
    /// preserved.
    Group {
        shapes: Vec<NodeId>,
        #[ts(type = "number")]
        new_id: i64,
    },
    /// Dissolves a group into its parent; children keep their absolute
    /// positions (group rotation and flips are folded into them).
    Ungroup { group: NodeId },
    /// Adds an image (bytes as standard base64) on top of the slide.
    /// `transform` absent = natural size (96 dpi), scaled down to fit the
    /// slide, centered.
    InsertPicture {
        slide: NodeId,
        content_type: String,
        bytes_base64: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transform: Option<Transform>,
        #[ts(type = "number")]
        new_id: i64,
    },
    /// Changes the slide size; the built-in layouts follow, shapes stay.
    SetSlideSize { size: SlideSize },
    /// Applies the commands in order as one undo step; all or nothing.
    Compound { commands: Vec<ShowCommand> },
    /// *Internal.* Inserts slides at the given indices (ascending).
    RestoreSlides { slides: Vec<(u32, Slide)> },
    /// *Internal.* Replaces existing slides (by id) wholesale.
    RestoreSlideContent { slides: Vec<Slide> },
    /// *Internal.* Sets slide size and layouts.
    RestoreSlideSize {
        size: SlideSize,
        layouts: Box<[Layout; 3]>,
    },
    /// *Internal.* Removes a media item.
    RemoveMedia {
        #[ts(as = "model_show::ts::MediaId")]
        id: MediaId,
    },
    /// *Internal.* Puts a media item back under its old id.
    RestoreMedia {
        #[ts(as = "model_show::ts::MediaId")]
        id: MediaId,
        content_type: String,
        bytes_base64: String,
    },
}

/// A shape sent by the UI: the JSON shape of [`Shape`], but ids (also of
/// group children) may be temporary negative numbers. TypeScript sees it
/// as `Shape`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewShape {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    pub transform: Transform,
    pub kind: NewShapeKind,
    #[serde(default)]
    pub fill: Fill,
    #[serde(default)]
    pub line: Line,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<PlaceholderKind>,
}

/// [`ShapeKind`] with [`NewShape`] children.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum NewShapeKind {
    #[serde(rename_all = "camelCase")]
    Auto {
        geometry: Preset,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<TextBody>,
    },
    #[serde(rename_all = "camelCase")]
    Picture { media: MediaId },
    #[serde(rename_all = "camelCase")]
    Group { children: Vec<NewShape> },
}

impl From<&Shape> for NewShape {
    /// The same shape with its real ids.
    fn from(s: &Shape) -> Self {
        NewShape {
            id: i64::try_from(s.id.0).unwrap_or(i64::MAX),
            name: s.name.clone(),
            transform: s.transform,
            kind: match &s.kind {
                ShapeKind::Auto { geometry, text } => NewShapeKind::Auto {
                    geometry: *geometry,
                    text: text.clone(),
                },
                ShapeKind::Picture { media } => NewShapeKind::Picture { media: *media },
                ShapeKind::Group { children } => NewShapeKind::Group {
                    children: children.iter().map(NewShape::from).collect(),
                },
            },
            fill: s.fill,
            line: s.line,
            placeholder: s.placeholder,
        }
    }
}
