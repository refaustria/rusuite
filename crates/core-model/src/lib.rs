#![forbid(unsafe_code)]
//! Shared document model (runs, styles, colors, images).
//!
//! Phase 0 covers character-run formatting ([`RunProperties`]), colors
//! ([`Color`], [`Rgb`]), font specification ([`FontFace`], [`FontSize`]) and
//! the document theme ([`Theme`]); binary media ([`MediaStore`]) is shared by
//! Write and Show (ADR 0008). All types are format-agnostic: mapping to
//! and from OOXML specifics happens in the `fmt-*` crates. Every type derives
//! `serde` traits and doubles as an IPC payload (see ADR 0002).

pub mod color;
pub mod font;
pub mod media;
pub mod run;
pub mod theme;
pub mod units;

pub use color::{apply_tint, Color, ColorParseError, ColorScheme, Rgb, ThemeColorSlot};
pub use font::{FontFace, FontScheme, FontSize, ThemeFontSlot};
pub use media::{Media, MediaId, MediaStore};
pub use run::{RunProperties, Underline, VerticalAlign};
pub use theme::Theme;
