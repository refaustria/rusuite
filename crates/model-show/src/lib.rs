#![forbid(unsafe_code)]
//! Show presentation model: slides, shapes, layouts and DrawingML-shaped
//! text (ADR 0008).
//!
//! A [`Presentation`] holds [`Slide`]s in order; each slide holds
//! [`Shape`]s whose vector order is the z-order (first = bottom). Shapes are
//! auto shapes (a library of DrawingML presets – rectangles, ellipses,
//! arrows, stars, callouts, flowchart symbols, lines – or custom geometry;
//! text boxes are rectangles without fill and line; see [`geometry`]),
//! pictures, groups whose children are positioned relative to the group,
//! connectors glued to other shapes ([`connector`]) and tables
//! ([`table`]). Text follows DrawingML: a [`TextBody`]
//! of [`TextParagraph`]s (level, bullet, alignment) holding [`TextRun`]s
//! formatted with [`core_model::RunProperties`].
//!
//! Layouts are three fixed built-ins ([`LayoutKind`]); their placeholder
//! positions and text defaults come from [`Layout::builtin`]. Slides and
//! shapes carry presentation-unique [`NodeId`]s (same scheme as
//! `model-text`, ADR 0006). Images live in the presentation's
//! [`core_model::MediaStore`].
//!
//! Slides may carry a [`Transition`] and [`Animation`]s of their shapes
//! (play order = vector order; see [`anim`]).
//!
//! All types derive `serde` traits (camelCase fields; enums with data are
//! tagged `{"kind": …, "value": …}` like `core_model::Color`) and double as
//! IPC payloads. Lengths are [`Emu`].

pub mod anim;
pub mod connector;
pub mod geometry;
pub mod layout;
pub mod presentation;
pub mod shape;
pub mod slide;
pub mod snapshot;
pub mod table;
pub mod text;
#[cfg(feature = "ts")]
pub mod ts;

pub use anim::{Animation, AnimationKind, Direction, Effect, Transition, TransitionKind, Trigger};
pub use connector::{ArrowEnd, ArrowKind, ArrowSize, Attach, Connector};
pub use core_model::media::{Media, MediaId, MediaStore};
pub use core_model::units::Emu;
pub use core_model::{Color, RunProperties, Theme};
pub use geometry::{flatten, Adjust, ConnectorKind, GeomPath, PathCmd, Site, SubPath};
pub use layout::{Layout, LayoutKind, PlaceholderDef, PlaceholderKind};
pub use presentation::{Presentation, SlideSize};
pub use shape::{
    align_shapes, distribute, AlignMode, Axis, Fill, Line, LineDash, Preset, Shape, ShapeKind,
    Transform,
};
pub use slide::Slide;
pub use snapshot::PresentationSnapshot;
pub use table::{CellBorders, ColSpec, RowSpec, StyleCell, Table, TableCell, TableLook};
pub use text::{
    Alignment, Anchor, AutoNumScheme, Autofit, BodyProps, Bullet, Insets, TextBody, TextParagraph,
    TextParagraphProps, TextRun, TextSpacing,
};

use serde::{Deserialize, Serialize};

/// Presentation-unique id of a slide or shape.
///
/// Allocated by [`Presentation::alloc_id`], persisted in snapshots, never
/// written to pptx. Serializes as a plain number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct NodeId(#[cfg_attr(feature = "ts", ts(type = "number"))] pub u64);

/// Errors of the `model-show` crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A snapshot could not be serialized or parsed as JSON.
    #[error("presentation snapshot JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// No slide has this id.
    #[error("unknown slide {0:?}")]
    UnknownSlide(NodeId),
    /// A slide's transition or animations are invalid.
    #[error("invalid slide {slide:?}: {reason}")]
    InvalidSlide {
        /// The slide.
        slide: NodeId,
        /// What is wrong.
        reason: String,
    },
    /// A slide index is past the end of the slide list.
    #[error("slide index {index} out of range (0..{len})")]
    SlideIndexOutOfRange {
        /// The rejected index.
        index: usize,
        /// Number of slides.
        len: usize,
    },
}

/// Result alias with this crate's [`Error`].
pub type Result<T, E = Error> = std::result::Result<T, E>;
