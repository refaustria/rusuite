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

use core_model::chart::{Chart, ChartKind};
use core_model::media::{MediaId, MediaStore};
use core_model::{ColorScheme, FontScheme, RunProperties};
use model_show::{
    Action, Adjust, AlignMode, Alignment, Anchor, Animation, AnimationKind, ArrowEnd, Axis,
    Background, BodyProps, Bullet, ChartData, ChartShape, Connector, ConnectorKind, Crop,
    Direction, Effect, Fill, HfDate, Hyperlink, Insets, Layout, LayoutKind, Line, MediaClip,
    MediaStart, NodeId, PictureProps, PlaceholderKind, Preset, Recolor, Section, Shadow, Shape,
    ShapeKind, ShowSettings, Slide, SlideMaster, SlideSize, Table, TableLook, TextBody, TextClass,
    TextSpacing, Theme, Transform, Transition, Trigger, ViewProps,
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

/// Animation properties to change for [`ShowCommand::UpdateAnimation`].
/// Absent fields keep their value; `direction: null` resets to the
/// effect's default. When the effect changes and the old direction does
/// not fit the new effect (and no direction is given), it is reset.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct AnimationPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<AnimationKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effect: Option<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub trigger: Option<Trigger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub delay_ms: Option<u32>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Direction>")]
    pub direction: Option<Option<Direction>>,
}

impl AnimationPatch {
    /// Applies the patch to `a` (see the type docs for the direction
    /// rule); the result still has to be validated.
    pub fn apply_to(&self, a: &mut Animation) {
        if let Some(v) = self.kind {
            a.kind = v;
        }
        if let Some(v) = self.effect {
            a.effect = v;
        }
        if let Some(v) = self.trigger {
            a.trigger = v;
        }
        if let Some(v) = self.duration_ms {
            a.duration_ms = v;
        }
        if let Some(v) = self.delay_ms {
            a.delay_ms = v;
        }
        match self.direction {
            Some(d) => a.direction = d,
            None => {
                if a.direction
                    .is_some_and(|d| !a.effect.directions().contains(&d))
                {
                    a.direction = None;
                }
            }
        }
    }
}

/// Cell properties to change for [`ShowCommand::SetTableCellProps`].
/// Absent fields keep their value; `null` fill or border = as the table
/// style draws it.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct TableCellPatch {
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Fill>")]
    pub fill: Option<Option<Fill>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Line>")]
    pub left: Option<Option<Line>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Line>")]
    pub right: Option<Option<Line>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Line>")]
    pub top: Option<Option<Line>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Line>")]
    pub bottom: Option<Option<Line>>,
    /// Diagonal border from the top-left corner (`a:lnTlToBr`).
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Line>")]
    pub diag_down: Option<Option<Line>>,
    /// Diagonal border from the bottom-left corner (`a:lnBlToTr`).
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Line>")]
    pub diag_up: Option<Option<Line>>,
    /// Text direction (`a:tcPr/@vert`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub vert: Option<model_show::TextDirection>,
    /// Vertical alignment of the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub anchor: Option<Anchor>,
    /// Cell margins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub margins: Option<Insets>,
}

impl TableCellPatch {
    /// Applies the patch to `cell`.
    pub fn apply_to(&self, cell: &mut model_show::TableCell) {
        if let Some(v) = self.fill {
            cell.fill = v;
        }
        let b = &mut cell.borders;
        for (patch, slot) in [
            (self.left, &mut b.left),
            (self.right, &mut b.right),
            (self.top, &mut b.top),
            (self.bottom, &mut b.bottom),
            (self.diag_down, &mut b.diag_down),
            (self.diag_up, &mut b.diag_up),
        ] {
            if let Some(v) = patch {
                *slot = v;
            }
        }
        if let Some(a) = self.anchor {
            cell.text.props.anchor = a;
        }
        if let Some(m) = self.margins {
            cell.text.props.insets = m;
        }
        if let Some(v) = self.vert {
            cell.text.props.vert = v;
        }
    }
}

/// Connector properties to change for [`ShowCommand::SetConnector`].
/// Absent fields keep their value; `start`/`end` `null` detaches the end.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct ConnectorPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<ConnectorKind>,
    /// Turns of an elbow or curved connector (1–4); rerouting may change
    /// it again when the connector is glued at both ends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bends: Option<u8>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<model_show::Attach>")]
    pub start: Option<Option<model_show::Attach>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<model_show::Attach>")]
    pub end: Option<Option<model_show::Attach>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub head: Option<ArrowEnd>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tail: Option<ArrowEnd>,
    /// Adjust values (`adj1`: where an elbow's middle segment runs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<std::collections::HashMap<String, f64>>")]
    pub adjust: Option<Adjust>,
}

impl ConnectorPatch {
    /// Applies the patch to `c`.
    pub fn apply_to(&self, c: &mut Connector) {
        if let Some(k) = self.kind {
            c.kind = k;
        }
        if let Some(b) = self.bends {
            c.bends = b.clamp(1, 4);
        }
        if let Some(a) = self.start {
            c.start = a;
        }
        if let Some(a) = self.end {
            c.end = a;
        }
        if let Some(h) = self.head {
            c.head = h;
        }
        if let Some(t) = self.tail {
            c.tail = t;
        }
        if let Some(a) = &self.adjust {
            c.adjust.clone_from(a);
        }
    }
}

/// Which theme [`ShowCommand::ApplyTheme`] applies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum ThemeChoice {
    /// A built-in theme by id (`model_show::BUILTIN_THEME_IDS`); it also
    /// sets the master background.
    Builtin(String),
    /// A theme given in full (e.g. taken from another presentation).
    Custom(Box<Theme>),
}

/// How [`ShowCommand::SetSlideSize`] treats slide content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum SlideScale {
    /// Shapes keep their position and size.
    #[default]
    None,
    /// Ensure Fit: scale by the smaller ratio, everything stays on the
    /// slide.
    Fit,
    /// Maximize: scale by the larger ratio (content may run off the slide).
    Maximize,
}

impl SlideScale {
    /// Whether shapes stay as they are.
    pub fn is_none(&self) -> bool {
        *self == SlideScale::None
    }
}

/// The master or one layout (target of design commands).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum DesignTarget {
    /// The slide master.
    Master,
    /// A layout.
    Layout(LayoutKind),
}

/// What [`ShowCommand::SetBackground`] changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum BackgroundTarget {
    /// These slides.
    Slides(Vec<NodeId>),
    /// A layout.
    Layout(LayoutKind),
    /// The master.
    Master,
}

/// Slides [`ShowCommand::SetHeaderFooter`] applies to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub enum HfTarget {
    /// Every slide, and the master's settings for new slides ("Apply to
    /// All").
    All,
    /// These slides ("Apply").
    Slides(Vec<NodeId>),
}

/// Placeholder properties to change for
/// [`ShowCommand::SetMasterPlaceholderProps`]. Absent fields keep their
/// value.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct PlaceholderPatch {
    /// Position and size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transform: Option<Transform>,
    /// Body properties (anchor, insets, autofit, wrap).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body: Option<BodyProps>,
    /// Run formatting merged into the level-1 defaults (set fields win).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<app_common::wire::RunProperties>")]
    pub run: Option<RunProperties>,
    /// Paragraph formatting of level 1 (of `level` when set).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub paragraph: Option<TextParagraphPatch>,
    /// The outline level (0–8) `run`, `paragraph`, `margin_left` and
    /// `indent` change; absent = 0 (level 1). Deeper levels of a layout
    /// placeholder change its own list style (`a:lvl2pPr` …); of a master
    /// placeholder the master text style of its class.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub level: Option<u8>,
    /// Left margin of the level's paragraphs (`marL`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub margin_left: Option<model_show::Emu>,
    /// First-line indent of the level's paragraphs (`indent`; negative =
    /// hanging).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub indent: Option<model_show::Emu>,
}

/// Picture adjustments to change for [`ShowCommand::SetPictureProps`].
/// Absent fields keep their value; `geometry`/`shadow` `null` removes.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct PicturePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub crop: Option<Crop>,
    /// `-1..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub brightness: Option<f64>,
    /// `-1..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub contrast: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recolor: Option<Recolor>,
    /// `0..=1`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transparency: Option<f64>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Preset>")]
    pub geometry: Option<Option<Preset>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional = nullable, as = "Option<Shadow>")]
    pub shadow: Option<Option<Shadow>>,
}

impl PicturePatch {
    /// Applies the patch to `p` (values clamped to their ranges).
    pub fn apply_to(&self, p: &mut PictureProps) {
        if let Some(c) = self.crop {
            p.crop = c;
        }
        if let Some(v) = self.brightness {
            p.brightness = v.clamp(-1.0, 1.0);
        }
        if let Some(v) = self.contrast {
            p.contrast = v.clamp(-1.0, 1.0);
        }
        if let Some(r) = self.recolor {
            p.recolor = r;
        }
        if let Some(v) = self.transparency {
            p.transparency = v.clamp(0.0, 1.0);
        }
        if let Some(g) = &self.geometry {
            p.geometry.clone_from(g);
        }
        if let Some(s) = self.shadow {
            p.shadow = s;
        }
    }
}

/// Playback settings to change for [`ShowCommand::SetMediaProps`]
/// (absent = unchanged).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/show/src/generated/")]
pub struct MediaPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start: Option<MediaStart>,
    #[serde(default, rename = "loop", skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub loop_playback: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hide_when_not_playing: Option<bool>,
    /// `0..=100000` (1/1000 percent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub volume: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub muted: Option<bool>,
}

impl MediaPatch {
    /// Applies the patch to `c`.
    pub fn apply_to(&self, c: &mut MediaClip) {
        if let Some(v) = self.start {
            c.start = v;
        }
        if let Some(v) = self.loop_playback {
            c.loop_playback = v;
        }
        if let Some(v) = self.hide_when_not_playing {
            c.hide_when_not_playing = v;
        }
        if let Some(v) = self.volume {
            c.volume = v.min(MediaClip::VOLUME_HIGH);
        }
        if let Some(v) = self.muted {
            c.muted = v;
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
    /// Changes the slide size; master and layout placeholders and shapes
    /// scale with it (the Office master and layouts are replaced by the
    /// ones for the new size). Slide shapes stay (`scale` absent / `none`)
    /// or scale proportionally about the slide centre (PowerPoint's
    /// "Ensure Fit": by the smaller of the width and height ratios;
    /// "Maximize": by the larger).
    SetSlideSize {
        size: SlideSize,
        #[serde(default, skip_serializing_if = "SlideScale::is_none")]
        #[ts(optional, as = "Option<SlideScale>")]
        scale: SlideScale,
    },
    /// Changes the layout of a slide (PowerPoint's Home › Layout):
    /// placeholders map to the new layout's by type and `idx` (else type,
    /// else class: title ↔ centered title, body ↔ subtitle ↔ picture;
    /// unmoved ones take the new position, text is kept), missing ones
    /// are added empty (fresh ids), empty ones without a counterpart are
    /// removed; other shapes stay.
    SetSlideLayout { slide: NodeId, layout: LayoutKind },
    /// Hides slides in (or shows them again in) the slide show.
    SetSlidesHidden { slides: Vec<NodeId>, hidden: bool },
    /// Sets the speaker notes of a slide (plain text, `\n` between
    /// paragraphs; `null` or empty = none).
    SetNotes {
        slide: NodeId,
        #[serde(default)]
        notes: Option<String>,
    },
    /// Sets the alternative text of a shape (`null` or empty = none).
    SetAltText {
        shape: NodeId,
        #[serde(default)]
        alt: Option<String>,
    },
    /// Replaces the image of a picture (bytes as standard base64). The new
    /// image is fitted into the old box keeping its aspect ratio, centered.
    ReplacePicture {
        shape: NodeId,
        content_type: String,
        bytes_base64: String,
    },
    /// Gives pictures their natural size (96 dpi, scaled down to fit the
    /// slide), keeping the top-left corner.
    ResetPictureSize { shapes: Vec<NodeId> },
    /// Sets (or, with `null`, removes) the transition of slides. A
    /// transition without effect that only advances on click is stored as
    /// none.
    SetTransition {
        slides: Vec<NodeId>,
        #[serde(default)]
        transition: Option<Transition>,
    },
    /// Gives every slide the transition of slide `from` (PowerPoint's
    /// "Apply To All"; none when `from` has none).
    ApplyTransitionToAll { from: NodeId },
    /// Inserts `animation` into the play order of `slide` at `index`
    /// (absent = last). Its shape must be on the slide; `animation.id` is
    /// ignored (send 0) – the animation gets `newId` (temporary negative
    /// or an unused id).
    AddAnimation {
        slide: NodeId,
        animation: Animation,
        #[ts(type = "number")]
        new_id: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        index: Option<u32>,
    },
    /// Changes properties of an animation.
    UpdateAnimation { id: NodeId, patch: AnimationPatch },
    /// Removes an animation.
    RemoveAnimation { id: NodeId },
    /// Moves an animation to position `index` of its slide's play order.
    ReorderAnimation { id: NodeId, index: u32 },
    /// Changes the geometry of auto shapes: the preset (absent =
    /// unchanged) and/or its adjust values (absent = unchanged; `{}` =
    /// the preset's defaults). Changing the preset without `adjust`
    /// resets the adjust values.
    SetGeometry {
        shapes: Vec<NodeId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        geometry: Option<Preset>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<std::collections::HashMap<String, f64>>")]
        adjust: Option<Adjust>,
    },
    /// Changes a connector: kind, attachments (to shapes on its slide;
    /// attached ends move onto their sites), arrowheads, adjust values.
    SetConnector {
        shape: NodeId,
        patch: ConnectorPatch,
    },
    /// Adds a `rows` × `cols` table (PowerPoint's default style, header
    /// row and banded rows) on top of the slide. `transform` absent = two
    /// thirds of the slide wide, 0.4" per row, centered.
    InsertTable {
        slide: NodeId,
        rows: u32,
        cols: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transform: Option<Transform>,
        #[ts(type = "number")]
        new_id: i64,
    },
    /// Replaces the text of a table cell (covered cells cannot hold text).
    SetTableCellText {
        shape: NodeId,
        row: u32,
        col: u32,
        body: TextBody,
    },
    /// Inserts an empty row at `index` (`0..=rows`) formatted like the
    /// row above it; the table grows by the row's height.
    InsertTableRow { shape: NodeId, index: u32 },
    /// Inserts an empty column at `index` (`0..=cols`) as wide as the one
    /// left of it; the table grows by its width.
    InsertTableCol { shape: NodeId, index: u32 },
    /// Deletes row `index` (not the last one); the table shrinks.
    DeleteTableRow { shape: NodeId, index: u32 },
    /// Deletes column `index` (not the last one); the table shrinks.
    DeleteTableCol { shape: NodeId, index: u32 },
    /// Merges the `rowSpan` × `colSpan` cells at `row`, `col` (texts are
    /// joined into the top-left cell).
    MergeTableCells {
        shape: NodeId,
        row: u32,
        col: u32,
        row_span: u32,
        col_span: u32,
    },
    /// Splits the merged cell anchored at `row`, `col` into single cells.
    SplitTableCell { shape: NodeId, row: u32, col: u32 },
    /// Splits cell `row`, `col` into `rows` × `cols` cells (PowerPoint's
    /// Split Cells dialog; see `Table::split_grid`).
    SplitTableCellGrid {
        shape: NodeId,
        row: u32,
        col: u32,
        rows: u32,
        cols: u32,
    },
    /// Changes fill, borders, alignment or margins of the cells in the
    /// `rowSpan` × `colSpan` range at `row`, `col` (default 1 × 1).
    SetTableCellProps {
        shape: NodeId,
        row: u32,
        col: u32,
        #[serde(default = "one", skip_serializing_if = "is_one")]
        #[ts(optional, as = "Option<u32>")]
        row_span: u32,
        #[serde(default = "one", skip_serializing_if = "is_one")]
        #[ts(optional, as = "Option<u32>")]
        col_span: u32,
        patch: TableCellPatch,
    },
    /// Sets the table style (`null` = no style) and its options.
    SetTableStyle {
        shape: NodeId,
        #[serde(default)]
        style_id: Option<String>,
        look: TableLook,
    },
    /// Sets column widths and/or row heights (absent = unchanged; lengths
    /// must match the grid); the table's box follows their sums.
    SetTableGrid {
        shape: NodeId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<Vec<f64>>")]
        col_widths: Option<Vec<model_show::Emu>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<Vec<f64>>")]
        row_heights: Option<Vec<model_show::Emu>>,
    },
    /// Applies a theme: colours, fonts and format styles (a built-in
    /// theme also sets the master background); placeholders keep their
    /// positions.
    ApplyTheme { theme: ThemeChoice },
    /// Replaces the theme's colour scheme.
    SetThemeColors {
        #[ts(as = "model_show::ts::ColorScheme")]
        colors: ColorScheme,
    },
    /// Replaces the theme's font scheme.
    SetThemeFonts {
        #[ts(as = "model_show::ts::FontScheme")]
        fonts: FontScheme,
    },
    /// Adds a custom layout `name` (title plus date/footer/slide number,
    /// as PowerPoint's Insert Layout) after the last layout.
    AddLayout { name: String },
    /// Copies a layout (with its shapes) as custom layout `"1_<name>"`
    /// (the next free number) right after it.
    DuplicateLayout { layout: LayoutKind },
    /// Deletes a layout no slide uses.
    DeleteLayout { layout: LayoutKind },
    /// Renames a layout (Slide Master › Rename): a standard layout keeps
    /// its kind and shows `name` (empty = PowerPoint's standard name); a
    /// custom layout becomes `custom:<name>` and its slides follow.
    RenameLayout { layout: LayoutKind, name: String },
    /// Adds a placeholder of `kind` at `transform` to the master (one per
    /// kind) or to a layout (Slide Master › Insert Placeholder; the next
    /// free `idx`, text defaults from the master).
    AddPlaceholder {
        target: DesignTarget,
        kind: PlaceholderKind,
        transform: Transform,
    },
    /// Removes a placeholder of the master or a layout (slides keep their
    /// placeholder shapes).
    RemovePlaceholder {
        target: DesignTarget,
        placeholder: PlaceholderKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        idx: Option<u32>,
    },
    /// Changes outline level `level` (0–8) of a master text style
    /// (`p:titleStyle`/`p:bodyStyle`/`p:otherStyle`): run formatting
    /// merged in, paragraph formatting patched, margins set. Level 1 of the title and
    /// body styles also changes the master placeholders' text defaults
    /// (and the layouts' that still inherit them).
    SetMasterTextStyle {
        which: TextClass,
        level: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<app_common::wire::RunProperties>")]
        run: Option<RunProperties>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        paragraph: Option<TextParagraphPatch>,
        /// Left margin (`marL`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "number")]
        margin_left: Option<model_show::Emu>,
        /// First-line indent (`indent`; negative = hanging).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "number")]
        indent: Option<model_show::Emu>,
    },
    /// Sets (or, with `null`, removes) the custom prompt text of a master
    /// or layout placeholder (what typing into it in the Slide Master view
    /// stores; slides show it in empty placeholders).
    SetPlaceholderPrompt {
        target: DesignTarget,
        placeholder: PlaceholderKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        idx: Option<u32>,
        #[serde(default)]
        prompt: Option<String>,
    },
    /// A picture background from a file (Format Background › Picture or
    /// texture fill › Insert): adds the image to the media store and sets
    /// it as the background of the target (stretched, or tiled).
    SetBackgroundPicture {
        target: BackgroundTarget,
        content_type: String,
        bytes_base64: String,
        #[serde(default)]
        tile: bool,
        #[serde(default)]
        transparency: f64,
    },
    /// Changes a placeholder of the master or a layout. Master changes of
    /// position, body properties or text defaults flow to the layout
    /// placeholders (and their slides' placeholders) that still had the
    /// master's values; layout changes flow to the slides' placeholders
    /// that still had the layout's position/body properties. Changing a
    /// master title/body placeholder's text also changes level 1 of the
    /// title/body text style.
    SetMasterPlaceholderProps {
        target: DesignTarget,
        placeholder: PlaceholderKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        idx: Option<u32>,
        patch: PlaceholderPatch,
    },
    /// Sets (or, with `null`, resets) the background of slides (explicit
    /// fills only; `null` = the layout's), a layout (`null` = the
    /// master's) or the master (`null` = theme background style 1);
    /// `hideMasterShapes` (slides, layouts) hides the master's (and
    /// layout's) graphics.
    SetBackground {
        target: BackgroundTarget,
        #[serde(default)]
        fill: Option<Background>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        hide_master_shapes: Option<bool>,
    },
    /// Resets slides' placeholders to their layout (position, size, body
    /// properties, text formatting; missing placeholders are added).
    ResetSlide { slides: Vec<NodeId> },
    /// Sets date, footer and slide number (PowerPoint's Header & Footer):
    /// the target slides' date/footer/number placeholders are replaced (a
    /// moved placeholder keeps its position); `notOnTitle` skips slides
    /// with the Title Slide layout. `all` also sets the master's settings
    /// for new slides.
    SetHeaderFooter {
        date: HfDate,
        #[serde(default)]
        footer: Option<String>,
        slide_number: bool,
        apply_to: HfTarget,
        #[serde(default)]
        not_on_title: bool,
    },
    /// Adds a section starting at slide `firstSlide` (the rest of that
    /// slide's section moves into it; the slides before go into "Default
    /// Section" when there were no sections) or, without `firstSlide`, an
    /// empty section at the end.
    AddSection {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        first_slide: Option<NodeId>,
    },
    /// Renames section `index`.
    RenameSection { index: u32, name: String },
    /// Removes section `index`; with `keepSlides` its slides join the
    /// previous (first: next) section, else they are deleted.
    RemoveSection { index: u32, keep_slides: bool },
    /// Moves section `index` with its slides to position `toIndex`.
    MoveSection { index: u32, to_index: u32 },
    /// Changes picture adjustments (crop, corrections, recolour,
    /// transparency, shape, shadow) of pictures.
    SetPictureProps {
        shapes: Vec<NodeId>,
        patch: PicturePatch,
    },
    /// Crops a picture. `transform` absent = the box follows the crop
    /// (PowerPoint: cropping an edge moves that edge, the image stays put).
    CropPicture {
        shape: NodeId,
        crop: Crop,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        transform: Option<Transform>,
    },
    /// Removes all picture adjustments (the box grows back to the uncropped
    /// image); with `size` the picture also gets its natural size.
    ResetPicture {
        shapes: Vec<NodeId>,
        #[serde(default)]
        size: bool,
    },
    /// Inserts a chart of `kind` on PowerPoint's sample data (three
    /// series × four categories; scatter: one series of three points;
    /// pie/doughnut: the first series) with PowerPoint's default look.
    /// `transform` absent = 2/3 of the slide, centered.
    InsertChart {
        slide: NodeId,
        #[ts(type = "import(\"@rusuite/ui-shared\").ChartKindModel")]
        kind: ChartKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transform: Option<Transform>,
        #[ts(type = "number")]
        new_id: i64,
    },
    /// Replaces a chart's data (Edit Data, Switch Row/Column): the
    /// chart's series follow the table (new ones with default
    /// formatting); the file's embedded workbook is dropped (a new one is
    /// written on save). Not for unsupported charts.
    SetChartData { shape: NodeId, data: ChartData },
    /// Replaces a chart's formatting and type (the same `Chart` model as
    /// Calc's); its series references are reset to the data table. Not for
    /// unsupported charts.
    UpdateChart {
        shape: NodeId,
        #[ts(type = "import(\"@rusuite/ui-shared\").ChartModel")]
        chart: Box<Chart>,
    },
    /// Sets (or, with `null`, removes) the hyperlink of chars
    /// `from..to` of paragraph `paragraph`, splitting runs at the
    /// boundaries (Insert › Link on selected text).
    SetHyperlink {
        shape: NodeId,
        paragraph: u32,
        from: u32,
        to: u32,
        #[serde(default)]
        link: Option<Hyperlink>,
    },
    /// Sets (or, with `null`, removes) the mouse-click action of shapes
    /// (Insert › Action; Insert › Link on a selected shape).
    SetClickAction {
        shapes: Vec<NodeId>,
        #[serde(default)]
        action: Option<Action>,
    },
    /// Adds an audio or video clip (bytes as standard base64; the kind
    /// from the MIME type: `audio/*` → audio). `transform` absent =
    /// video: half the slide width at 16:9, centered; audio: a 1.27 cm
    /// square in the centre.
    InsertMedia {
        slide: NodeId,
        content_type: String,
        bytes_base64: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transform: Option<Transform>,
        #[ts(type = "number")]
        new_id: i64,
    },
    /// Changes playback settings of audio/video shapes.
    SetMediaProps {
        shapes: Vec<NodeId>,
        patch: MediaPatch,
    },
    /// Sets the poster frame of a clip from an image (bytes as standard
    /// base64); without bytes the poster is reset (the placeholder).
    SetMediaPoster {
        shape: NodeId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bytes_base64: Option<String>,
    },
    /// Inserts slides of another presentation after slide `after`
    /// (absent = first), as one undo step (Reuse Slides). `slides`,
    /// `layouts` (the source layouts they use) and `media` (the source
    /// media they reference) come from `peekPresentation`; every id is
    /// renewed, media are added (identical ones shared). With
    /// `keepSourceFormatting` each source layout becomes a custom layout
    /// (`custom:<name>`, made unique); without, slides move to this
    /// presentation's layout of the same kind (custom ones: inferred from
    /// their placeholders), their placeholders re-mapped like
    /// `setSlideLayout`. Links to slides that are not inserted are dropped.
    InsertSlides {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<NodeId>,
        slides: Vec<Slide>,
        #[serde(default)]
        layouts: Vec<Layout>,
        #[serde(default)]
        #[ts(as = "Vec<model_show::ts::MediaItem>")]
        media: MediaStore,
        #[serde(default)]
        keep_source_formatting: bool,
    },
    /// Sets the view settings: guides, grid, snapping, ruler, last view
    /// (stored in `viewProps.xml`; undoable like PowerPoint's guide moves).
    SetViewProps { view: ViewProps },
    /// Sets the Set Up Slide Show options (`presProps.xml`).
    SetShowSettings { settings: ShowSettings },
    /// Hides shapes on their slide or shows them again (Selection pane).
    SetShapesHidden { shapes: Vec<NodeId>, hidden: bool },
    /// Replaces the text body properties (Format Shape › Text Box:
    /// alignment, direction, autofit with its scale, wrap, margins,
    /// columns) of auto shapes; a shape without text gets an empty body.
    SetBodyProps {
        shapes: Vec<NodeId>,
        props: BodyProps,
    },
    /// Locks or unlocks the aspect ratio of shapes (Format Shape › Size ›
    /// Lock aspect ratio; `noChangeAspect`).
    SetLockAspect { shapes: Vec<NodeId>, locked: bool },
    /// Applies the commands in order as one undo step; all or nothing.
    Compound { commands: Vec<ShowCommand> },
    /// *Internal.* Inserts slides at the given indices (ascending).
    RestoreSlides { slides: Vec<(u32, Slide)> },
    /// *Internal.* Replaces existing slides (by id) wholesale.
    RestoreSlideContent { slides: Vec<Slide> },
    /// *Internal.* Sets slide size, master and layouts.
    RestoreSlideSize {
        size: SlideSize,
        master: Box<SlideMaster>,
        layouts: Vec<Layout>,
    },
    /// *Internal.* Puts theme, master and layouts back.
    RestoreDesign {
        theme: Box<Theme>,
        master: Box<SlideMaster>,
        layouts: Vec<Layout>,
    },
    /// *Internal.* Puts the sections back.
    RestoreSections { sections: Vec<Section> },
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

fn one() -> u32 {
    1
}

fn two() -> u8 {
    2
}

fn is_two(v: &u8) -> bool {
    *v == 2
}

impl Default for NewConnector {
    fn default() -> Self {
        NewConnector::from(&Connector::default())
    }
}

impl From<&Connector> for NewConnector {
    /// The same connector with its real attachment ids.
    fn from(c: &Connector) -> Self {
        let attach = |a: &Option<model_show::Attach>| {
            a.map(|a| NewAttach {
                shape: i64::try_from(a.shape.0).unwrap_or(i64::MAX),
                site: a.site,
            })
        };
        NewConnector {
            kind: c.kind,
            bends: c.bends,
            start: attach(&c.start),
            end: attach(&c.end),
            head: c.head,
            tail: c.tail,
            adjust: c.adjust.clone(),
        }
    }
}

fn is_one(v: &u32) -> bool {
    *v == 1
}

/// A shape sent by the UI: the JSON shape of [`Shape`], but ids (also of
/// group children and of the shapes a connector is attached to) may be
/// temporary negative numbers of shapes created earlier in the same
/// command. TypeScript sees it as `Shape`.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder_idx: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click_action: Option<Action>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub lock_aspect: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<core_model::Color>,
}

/// [`ShapeKind`] with [`NewShape`] children.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum NewShapeKind {
    #[serde(rename_all = "camelCase")]
    Auto {
        geometry: Preset,
        #[serde(default, skip_serializing_if = "Adjust::is_empty")]
        adjust: Adjust,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<TextBody>,
    },
    #[serde(rename_all = "camelCase")]
    Picture {
        media: MediaId,
        #[serde(default, skip_serializing_if = "PictureProps::is_default")]
        props: PictureProps,
    },
    #[serde(rename_all = "camelCase")]
    Group {
        children: Vec<NewShape>,
    },
    Connector(NewConnector),
    Table(Table),
    Chart(Box<ChartShape>),
    Media(MediaClip),
}

/// An attachment whose shape id may be temporary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAttach {
    pub shape: i64,
    pub site: u32,
}

/// [`Connector`] with [`NewAttach`]es.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnector {
    #[serde(default)]
    pub kind: ConnectorKind,
    #[serde(default = "two", skip_serializing_if = "is_two")]
    pub bends: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<NewAttach>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<NewAttach>,
    #[serde(default, skip_serializing_if = "ArrowEnd::is_none")]
    pub head: ArrowEnd,
    #[serde(default, skip_serializing_if = "ArrowEnd::is_none")]
    pub tail: ArrowEnd,
    #[serde(default, skip_serializing_if = "Adjust::is_empty")]
    pub adjust: Adjust,
}

impl From<&Shape> for NewShape {
    /// The same shape with its real ids.
    fn from(s: &Shape) -> Self {
        NewShape {
            id: i64::try_from(s.id.0).unwrap_or(i64::MAX),
            name: s.name.clone(),
            transform: s.transform,
            kind: match &s.kind {
                ShapeKind::Auto {
                    geometry,
                    adjust,
                    text,
                } => NewShapeKind::Auto {
                    geometry: geometry.clone(),
                    adjust: adjust.clone(),
                    text: text.clone(),
                },
                ShapeKind::Picture { media, props } => NewShapeKind::Picture {
                    media: *media,
                    props: props.clone(),
                },
                ShapeKind::Group { children } => NewShapeKind::Group {
                    children: children.iter().map(NewShape::from).collect(),
                },
                ShapeKind::Connector(c) => NewShapeKind::Connector(NewConnector::from(c)),
                ShapeKind::Table(t) => NewShapeKind::Table(t.clone()),
                ShapeKind::Chart(c) => NewShapeKind::Chart(c.clone()),
                ShapeKind::Media(m) => NewShapeKind::Media(m.clone()),
            },
            fill: s.fill,
            line: s.line,
            placeholder: s.placeholder,
            placeholder_idx: s.placeholder_idx,
            alt: s.alt.clone(),
            click_action: s.click_action.clone(),
            hidden: s.hidden,
            lock_aspect: s.lock_aspect,
            text_color: s.text_color,
        }
    }
}
