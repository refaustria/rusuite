//! Slide transitions and shape animations (`p:transition`, `p:timing`).
//!
//! A [`Slide`](crate::Slide) has an optional [`Transition`] (how it
//! appears in the slide show and when it advances) and a list of
//! [`Animation`]s in play order. Animations address shapes of their slide
//! by [`NodeId`]; [`Slide::validate`](crate::Slide::validate) checks that
//! every target exists.
//!
//! Durations and delays are milliseconds. Directions use one enum,
//! [`Direction`], whose meaning depends on the effect (see there).

use core_model::media::MediaId;
use serde::{Deserialize, Serialize};

use crate::NodeId;

/// The visual effect of a slide transition.
///
/// The first eight are ECMA-376 transitions (`p:fade`, `p:push`, …); the
/// others are PowerPoint 2010+ extensions written inside
/// `mc:AlternateContent` with a `p:fade` fallback: `p14:*` (Vortex …
/// Reveal), `p15:prstTrans prst="…"` (Fall Over … Origami) and
/// `p159:morph`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum TransitionKind {
    /// No visual effect (only the advance settings apply; a
    /// `p:transition` without an effect element).
    None,
    /// Cross-fade (`p:fade`).
    Fade,
    /// The new slide pushes the old one out (`p:push`; 4 directions).
    Push,
    /// A wipe edge reveals the new slide (`p:wipe`; 4 directions).
    Wipe,
    /// The new slide slides in over the old one (`p:cover`; 8 directions).
    Cover,
    /// The old slide splits open (`p:split`; horizontal/vertical × in/out).
    Split,
    /// Instant switch (`p:cut`).
    Cut,
    /// Zoom in or out (`p:zoom`).
    Zoom,
    /// `p14:vortex` (4 directions).
    Vortex,
    /// `p14:ripple` (center or a corner).
    Ripple,
    /// `p14:honeycomb`.
    Honeycomb,
    /// `p14:glitter` (4 directions × diamonds/hexagons).
    Glitter,
    /// `p14:shred` (strips/particles × in/out).
    Shred,
    /// `p14:switch` (left/right).
    Switch,
    /// `p14:flip` (left/right).
    Flip,
    /// `p14:gallery` (left/right).
    Gallery,
    /// `p14:prism` (4 directions).
    Cube,
    /// `p14:doors` (vertical/horizontal).
    Doors,
    /// `p14:prism isInverted="1"` (4 directions).
    Box,
    /// `p14:reveal` (left/right × smoothly/through black).
    Reveal,
    /// `p15:prstTrans prst="fallOver"` (left/right).
    FallOver,
    /// `p15:prstTrans prst="drape"` (left/right).
    Drape,
    /// `p15:prstTrans prst="curtains"`.
    Curtains,
    /// `p15:prstTrans prst="wind"` (left/right).
    Wind,
    /// `p15:prstTrans prst="prestige"`.
    Prestige,
    /// `p15:prstTrans prst="fracture"`.
    Fracture,
    /// `p15:prstTrans prst="crush"`.
    Crush,
    /// `p15:prstTrans prst="peelOff"` (left/right).
    PeelOff,
    /// `p15:prstTrans prst="pageCurlDouble"` / `"pageCurlSingle"`
    /// (left/right × double/single).
    PageCurl,
    /// `p15:prstTrans prst="airplane"` (left/right).
    Airplane,
    /// `p15:prstTrans prst="origami"` (left/right).
    Origami,
    /// `p159:morph` (objects/words/characters); played as a fade.
    Morph,
}

impl TransitionKind {
    /// Every kind, in menu order.
    pub const ALL: [TransitionKind; 32] = [
        TransitionKind::None,
        TransitionKind::Fade,
        TransitionKind::Push,
        TransitionKind::Wipe,
        TransitionKind::Cover,
        TransitionKind::Split,
        TransitionKind::Cut,
        TransitionKind::Zoom,
        TransitionKind::Morph,
        TransitionKind::Reveal,
        TransitionKind::Shred,
        TransitionKind::FallOver,
        TransitionKind::Drape,
        TransitionKind::Curtains,
        TransitionKind::Wind,
        TransitionKind::Prestige,
        TransitionKind::Fracture,
        TransitionKind::Crush,
        TransitionKind::PeelOff,
        TransitionKind::PageCurl,
        TransitionKind::Airplane,
        TransitionKind::Origami,
        TransitionKind::Honeycomb,
        TransitionKind::Glitter,
        TransitionKind::Vortex,
        TransitionKind::Ripple,
        TransitionKind::Switch,
        TransitionKind::Flip,
        TransitionKind::Gallery,
        TransitionKind::Cube,
        TransitionKind::Doors,
        TransitionKind::Box,
    ];

    /// PowerPoint's default duration of the effect, in milliseconds.
    pub const fn default_duration_ms(self) -> u32 {
        use TransitionKind::*;
        match self {
            None | Cut => 0,
            Fade => 700,
            Push | Wipe | Cover | Flip | PeelOff | PageCurl | Cube => 1000,
            Split => 1500,
            Zoom => 500,
            Switch => 1250,
            Ripple | Doors | Reveal => 1400,
            Gallery | Box => 1600,
            Glitter | Shred | FallOver | Drape | Wind | Prestige | Fracture | Crush | Airplane
            | Origami | Morph => 2000,
            Curtains => 2750,
            Vortex | Honeycomb => 3000,
        }
    }

    /// The directions this kind accepts (empty: none).
    pub const fn directions(self) -> &'static [Direction] {
        use Direction::*;
        use TransitionKind as K;
        match self {
            K::Push | K::Wipe | K::Vortex | K::Glitter | K::Cube | K::Box => {
                &[Left, Up, Right, Down]
            }
            K::Cover => &[Left, Up, Right, Down, LeftUp, RightUp, LeftDown, RightDown],
            K::Split => &[HorizontalOut, HorizontalIn, VerticalOut, VerticalIn],
            K::Zoom | K::Shred => &[In, Out],
            K::Ripple => &[Center, LeftUp, RightUp, LeftDown, RightDown],
            K::Doors => &[Vertical, Horizontal],
            K::Switch
            | K::Flip
            | K::Gallery
            | K::Reveal
            | K::FallOver
            | K::Drape
            | K::Wind
            | K::PeelOff
            | K::PageCurl
            | K::Airplane
            | K::Origami => &[Left, Right],
            K::None
            | K::Fade
            | K::Cut
            | K::Honeycomb
            | K::Curtains
            | K::Prestige
            | K::Fracture
            | K::Crush
            | K::Morph => &[],
        }
    }

    /// The direction used when [`Transition::direction`] is `None` (the
    /// file format's default; `None` for kinds without directions).
    pub const fn default_direction(self) -> Option<Direction> {
        use TransitionKind as K;
        match self {
            K::Push | K::Wipe | K::Cover | K::Vortex | K::Glitter | K::Cube | K::Box => {
                Some(Direction::Left)
            }
            K::Split => Some(Direction::HorizontalOut),
            K::Zoom => Some(Direction::Out),
            K::Shred => Some(Direction::In),
            K::Ripple => Some(Direction::Center),
            K::Doors => Some(Direction::Vertical),
            // `dir="l"`; p15:prstTrans: `invX="0"`
            K::Switch
            | K::Flip
            | K::Gallery
            | K::Reveal
            | K::FallOver
            | K::Drape
            | K::Wind
            | K::PeelOff
            | K::PageCurl
            | K::Airplane
            | K::Origami => Some(Direction::Left),
            _ => None,
        }
    }

    /// PowerPoint's Effect Options pick when the kind is chosen in the
    /// gallery, where it differs from [`Self::default_direction`] (Push
    /// From Bottom, Split Vertical Out, Zoom In, Switch/Flip Right).
    pub const fn gallery_direction(self) -> Option<Direction> {
        use TransitionKind as K;
        match self {
            K::Push => Some(Direction::Up),
            K::Split => Some(Direction::VerticalOut),
            K::Zoom => Some(Direction::In),
            K::Switch | K::Flip => Some(Direction::Right),
            _ => self.default_direction(),
        }
    }

    /// The variants ([`TransitionOption`]) this kind accepts (empty: none).
    pub const fn options(self) -> &'static [TransitionOption] {
        use TransitionOption::*;
        match self {
            TransitionKind::Glitter => &[Diamonds, Hexagons],
            TransitionKind::Shred => &[Strips, Particles],
            TransitionKind::Reveal => &[Smoothly, ThroughBlack],
            TransitionKind::PageCurl => &[Double, Single],
            TransitionKind::Morph => &[Objects, Words, Characters],
            _ => &[],
        }
    }

    /// The option used when [`Transition::option`] is `None`.
    pub const fn default_option(self) -> Option<TransitionOption> {
        match self.options() {
            [first, ..] => Some(*first),
            [] => None,
        }
    }

    /// Whether the kind is a PowerPoint 2010+ extension (`p14`, `p15`,
    /// `p159`), written in `mc:AlternateContent` with a fade fallback.
    pub const fn is_extension(self) -> bool {
        !matches!(
            self,
            TransitionKind::None
                | TransitionKind::Fade
                | TransitionKind::Push
                | TransitionKind::Wipe
                | TransitionKind::Cover
                | TransitionKind::Split
                | TransitionKind::Cut
                | TransitionKind::Zoom
        )
    }
}

/// A variant of a transition other than its direction (Effect Options).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum TransitionOption {
    /// Glitter: diamonds (`pattern="diamond"`).
    Diamonds,
    /// Glitter: hexagons (`pattern="hexagon"`).
    Hexagons,
    /// Shred: strips (`pattern="strip"`).
    Strips,
    /// Shred: particles (`pattern="rectangle"`).
    Particles,
    /// Reveal: smoothly.
    Smoothly,
    /// Reveal: through black (`thruBlk="1"`).
    ThroughBlack,
    /// Page Curl: double (`pageCurlDouble`).
    Double,
    /// Page Curl: single (`pageCurlSingle`).
    Single,
    /// Morph: objects (`option="byObject"`).
    Objects,
    /// Morph: words (`option="byWord"`).
    Words,
    /// Morph: characters (`option="byChar"`).
    Characters,
}

/// A direction of a transition or animation.
///
/// - Transitions (`Push`, `Wipe`, `Cover`, …): the direction the motion
///   goes (the OOXML `dir`): `Left` = the new slide moves toward the left,
///   which PowerPoint's menu calls "From Right". `Split` uses the
///   `Horizontal*`/`Vertical*` values, `Zoom`/`Shred` use `In`/`Out`,
///   `Doors` `Vertical`/`Horizontal`, `Ripple` `Center` or a corner.
/// - Animations (`FlyIn`, `Wipe`): the side of the shape's box the effect
///   comes from (entrance) or goes to (exit): `Down` = PowerPoint's "From
///   Bottom" / "To Bottom". Diagonals only for `FlyIn`. Shapes (Circle,
///   Box, …) use `In`/`Out`, Random Bars and Swivel
///   `Horizontal`/`Vertical`, Zoom `ObjectCenter`/`SlideCenter`, motion
///   paths the way they go.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Direction {
    /// Left.
    Left,
    /// Up (top).
    Up,
    /// Right.
    Right,
    /// Down (bottom).
    Down,
    /// Up and left (top-left).
    LeftUp,
    /// Up and right (top-right).
    RightUp,
    /// Down and left (bottom-left).
    LeftDown,
    /// Down and right (bottom-right).
    RightDown,
    /// Split: horizontal, from the center outward.
    HorizontalOut,
    /// Split: horizontal, from the edges inward.
    HorizontalIn,
    /// Split: vertical, from the center outward.
    VerticalOut,
    /// Split: vertical, from the edges inward.
    VerticalIn,
    /// Zoom in.
    In,
    /// Zoom out.
    Out,
    /// Horizontal (Random Bars, Swivel, Doors).
    Horizontal,
    /// Vertical (Random Bars, Swivel, Doors).
    Vertical,
    /// From the center (Ripple).
    Center,
    /// Zoom: from the object's center.
    ObjectCenter,
    /// Zoom: from the slide's center.
    SlideCenter,
}

/// A sound played with a transition (`p:sndAc`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum TransitionSound {
    /// "[Stop Previous Sound]" (`p:endSnd`).
    StopPrevious,
    /// A sound (`p:stSnd`; the file in the media store).
    #[serde(rename_all = "camelCase")]
    Play {
        /// The sound file (audio in the media store).
        #[cfg_attr(feature = "ts", ts(as = "crate::ts::MediaId"))]
        media: MediaId,
        /// "Loop Until Next Sound" (`p:stSnd loop="1"`).
        #[serde(default, rename = "loop", skip_serializing_if = "is_false")]
        #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
        loop_until_next: bool,
    },
}

/// How a slide appears in the slide show and when it advances
/// (`p:transition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Transition {
    /// The effect.
    pub kind: TransitionKind,
    /// The effect's direction; `None` = the kind's default
    /// ([`TransitionKind::default_direction`]). Must be one of
    /// [`TransitionKind::directions`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub direction: Option<Direction>,
    /// The effect's variant; `None` = the kind's default
    /// ([`TransitionKind::default_option`]). Must be one of
    /// [`TransitionKind::options`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub option: Option<TransitionOption>,
    /// Duration of the effect in milliseconds.
    pub duration_ms: u32,
    /// Advance to the next slide on a click (`advClick`, default on).
    #[serde(default = "yes")]
    pub advance_on_click: bool,
    /// Advance automatically after this many milliseconds (`advTm`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub advance_after_ms: Option<u32>,
    /// The transition's sound.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub sound: Option<TransitionSound>,
}

fn yes() -> bool {
    true
}

fn is_false(v: &bool) -> bool {
    !*v
}

impl Transition {
    /// The longest Duration PowerPoint accepts (59.00 s).
    pub const MAX_DURATION_MS: u32 = 59_000;

    /// A transition of `kind` with PowerPoint's defaults: default
    /// direction and duration, advance on click, no timer.
    pub const fn new(kind: TransitionKind) -> Self {
        Self {
            kind,
            direction: None,
            option: None,
            duration_ms: kind.default_duration_ms(),
            advance_on_click: true,
            advance_after_ms: None,
            sound: None,
        }
    }

    /// The effective direction (the explicit one, else the kind's default).
    pub fn effective_direction(&self) -> Option<Direction> {
        self.direction.or(self.kind.default_direction())
    }

    /// The effective option (the explicit one, else the kind's default).
    pub fn effective_option(&self) -> Option<TransitionOption> {
        self.option.or(self.kind.default_option())
    }

    /// Whether the transition changes nothing (no effect, advance on click
    /// only, no sound): equivalent to no transition. Readers and editors
    /// store `None` instead, and writers skip it.
    pub fn is_noop(&self) -> bool {
        self.kind == TransitionKind::None
            && self.advance_on_click
            && self.advance_after_ms.is_none()
            && self.sound.is_none()
    }

    /// Checks that direction and option fit the kind.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(d) = self.direction {
            if !self.kind.directions().contains(&d) {
                return Err(format!(
                    "direction {d:?} does not apply to transition {:?}",
                    self.kind
                ));
            }
        }
        if let Some(o) = self.option {
            if !self.kind.options().contains(&o) {
                return Err(format!(
                    "option {o:?} does not apply to transition {:?}",
                    self.kind
                ));
            }
        }
        Ok(())
    }
}

/// Whether an animation makes its shape appear, emphasizes it, makes it
/// disappear, moves it along a path, or controls a media clip
/// (`presetClass` `entr` / `emph` / `exit` / `path` / `mediacall`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum AnimationKind {
    /// The shape appears (hidden before).
    Entrance,
    /// The shape stays visible and is emphasized.
    Emphasis,
    /// The shape disappears (hidden after).
    Exit,
    /// The shape moves along a motion path (and stays at its end).
    Path,
    /// Play / pause / stop of an audio or video clip.
    Media,
}

/// The effect of an animation (a PowerPoint preset).
///
/// Entrance and exit (exit names in brackets): Appear (Disappear), Fade,
/// Fly In (Fly Out), Float In (Float Out), Split, Wipe, the Shape effects
/// Circle/Box/Diamond/Plus, Wheel, Random Bars, Grow & Turn (Shrink &
/// Turn), Zoom, Swivel, Bounce. Emphasis: Pulse … Wave. Motion paths:
/// Lines, Arcs, Turns, Shapes, Loops, Custom Path. Media: Play, Pause,
/// Stop. The `presetID` of each is documented in `docs/ooxml-subset.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Effect {
    /// Appear / Disappear (instant; `presetID` 1).
    Appear,
    /// Fade in / out (`presetID` 10).
    Fade,
    /// Fly in / out from a side (`presetID` 2; 8 directions).
    FlyIn,
    /// Float In / Float Out (`presetID` 42 up, 47 down).
    Float,
    /// Split (`presetID` 16; horizontal/vertical × in/out).
    Split,
    /// Wipe from a side (`presetID` 22; 4 directions).
    Wipe,
    /// Shape: circle (`presetID` 6; in/out).
    Circle,
    /// Shape: box (`presetID` 4; in/out).
    Box,
    /// Shape: diamond (`presetID` 8; in/out).
    Diamond,
    /// Shape: plus (`presetID` 13; in/out).
    Plus,
    /// Wheel (`presetID` 21; [`Animation::amount`] = spokes 1, 2, 3, 4, 8).
    Wheel,
    /// Random Bars (`presetID` 14; horizontal/vertical).
    RandomBars,
    /// Grow & Turn / Shrink & Turn (`presetID` 31).
    GrowTurn,
    /// Zoom from / to the object or slide center (`presetID` 53).
    Zoom,
    /// Swivel (`presetID` 19; horizontal/vertical).
    Swivel,
    /// Bounce (`presetID` 26).
    Bounce,
    /// Emphasis: Pulse (`presetID` 26).
    Pulse,
    /// Emphasis: Color Pulse (`presetID` 27; [`Animation::color`]).
    ColorPulse,
    /// Emphasis: Teeter (`presetID` 32).
    Teeter,
    /// Emphasis: spin ([`Animation::amount`] degrees, default one full
    /// clockwise turn; negative = counterclockwise; `presetID` 8).
    Spin,
    /// Emphasis: grow/shrink to [`Animation::amount`] percent (default
    /// 150 %; `presetID` 6).
    GrowShrink,
    /// Emphasis: Desaturate (`presetID` 25).
    Desaturate,
    /// Emphasis: Darken (`presetID` 24).
    Darken,
    /// Emphasis: Lighten (`presetID` 30).
    Lighten,
    /// Emphasis: Transparency to [`Animation::amount`] percent (default
    /// 50 %; `presetID` 9).
    Transparency,
    /// Emphasis: Object Color (`presetID` 19; [`Animation::color`]).
    ObjectColor,
    /// Emphasis: Line Color (`presetID` 7; [`Animation::color`]).
    LineColor,
    /// Emphasis: Fill Color (`presetID` 1; [`Animation::color`]).
    FillColor,
    /// Emphasis: Brush Color (`presetID` 16; [`Animation::color`]).
    BrushColor,
    /// Emphasis: Font Color (`presetID` 3; [`Animation::color`]).
    FontColor,
    /// Emphasis: Underline (`presetID` 18).
    Underline,
    /// Emphasis: Bold Flash (`presetID` 10).
    BoldFlash,
    /// Emphasis: Bold Reveal (`presetID` 15).
    BoldReveal,
    /// Emphasis: Wave (`presetID` 34).
    Wave,
    /// Motion path: Lines (`presetID` 42 down, 35 left, 64 right, 63 up).
    PathLines,
    /// Motion path: Arcs (`presetID` 37 down, 51 left, 58 right, 44 up).
    PathArcs,
    /// Motion path: Turns (`presetID` 50 down, 36 down right, 43 up, 57
    /// up right).
    PathTurns,
    /// Motion path: Shapes – a circle (`presetID` 1).
    PathShapes,
    /// Motion path: Loops (`presetID` 24).
    PathLoops,
    /// Motion path: Custom Path drawn with the mouse (`presetID` 0).
    PathCustom,
    /// Media: play (`presetClass="mediacall"`, `presetID` 1).
    MediaPlay,
    /// Media: pause (`presetID` 2).
    MediaPause,
    /// Media: stop (`presetID` 3).
    MediaStop,
}

const ENTRANCE_EXIT: &[Effect] = &[
    Effect::Appear,
    Effect::Fade,
    Effect::FlyIn,
    Effect::Float,
    Effect::Split,
    Effect::Wipe,
    Effect::Circle,
    Effect::Box,
    Effect::Diamond,
    Effect::Plus,
    Effect::Wheel,
    Effect::RandomBars,
    Effect::GrowTurn,
    Effect::Zoom,
    Effect::Swivel,
    Effect::Bounce,
];

impl Effect {
    /// Every effect, in menu order.
    pub const ALL: [Effect; 43] = [
        Effect::Appear,
        Effect::Fade,
        Effect::FlyIn,
        Effect::Float,
        Effect::Split,
        Effect::Wipe,
        Effect::Circle,
        Effect::Box,
        Effect::Diamond,
        Effect::Plus,
        Effect::Wheel,
        Effect::RandomBars,
        Effect::GrowTurn,
        Effect::Zoom,
        Effect::Swivel,
        Effect::Bounce,
        Effect::Pulse,
        Effect::ColorPulse,
        Effect::Teeter,
        Effect::Spin,
        Effect::GrowShrink,
        Effect::Desaturate,
        Effect::Darken,
        Effect::Lighten,
        Effect::Transparency,
        Effect::ObjectColor,
        Effect::LineColor,
        Effect::FillColor,
        Effect::BrushColor,
        Effect::FontColor,
        Effect::Underline,
        Effect::BoldFlash,
        Effect::BoldReveal,
        Effect::Wave,
        Effect::PathLines,
        Effect::PathArcs,
        Effect::PathTurns,
        Effect::PathShapes,
        Effect::PathLoops,
        Effect::PathCustom,
        Effect::MediaPlay,
        Effect::MediaPause,
        Effect::MediaStop,
    ];

    /// The kind of animation this effect belongs to (entrance effects are
    /// also exit effects).
    pub fn class(self) -> AnimationKind {
        use Effect::*;
        match self {
            PathLines | PathArcs | PathTurns | PathShapes | PathLoops | PathCustom => {
                AnimationKind::Path
            }
            MediaPlay | MediaPause | MediaStop => AnimationKind::Media,
            e if ENTRANCE_EXIT.contains(&e) => AnimationKind::Entrance,
            _ => AnimationKind::Emphasis,
        }
    }

    /// Whether the effect exists for animations of `kind`.
    pub fn supports(self, kind: AnimationKind) -> bool {
        match self.class() {
            AnimationKind::Entrance => {
                matches!(kind, AnimationKind::Entrance | AnimationKind::Exit)
            }
            c => c == kind,
        }
    }

    /// The directions this effect accepts (empty: none).
    pub const fn directions(self) -> &'static [Direction] {
        use Direction::*;
        match self {
            Effect::FlyIn => &[Down, Left, Right, Up, LeftDown, RightDown, LeftUp, RightUp],
            Effect::Wipe | Effect::PathLines | Effect::PathArcs => &[Down, Left, Right, Up],
            Effect::Float => &[Up, Down],
            Effect::Split => &[HorizontalIn, HorizontalOut, VerticalIn, VerticalOut],
            Effect::Circle | Effect::Box | Effect::Diamond | Effect::Plus => &[In, Out],
            Effect::RandomBars | Effect::Swivel => &[Horizontal, Vertical],
            Effect::Zoom => &[ObjectCenter, SlideCenter],
            Effect::PathTurns => &[Down, RightDown, Up, RightUp],
            _ => &[],
        }
    }

    /// PowerPoint's default duration in milliseconds (0 for `Appear` and
    /// the media commands, which are instant).
    pub const fn default_duration_ms(self) -> u32 {
        use Effect::*;
        match self {
            Appear | MediaPlay | MediaPause | MediaStop => 0,
            Fade | FlyIn | Split | Wipe | Zoom | RandomBars | GrowTurn | Pulse | ColorPulse
            | Teeter | Desaturate | Darken | Lighten | Transparency | BrushColor | Underline
            | BoldFlash | BoldReveal | Wave => 500,
            Float => 1000,
            Circle | Box | Diamond | Plus | Wheel | Swivel | Bounce | Spin | GrowShrink
            | ObjectColor | LineColor | FillColor | FontColor | PathLines | PathArcs
            | PathTurns | PathShapes | PathLoops | PathCustom => 2000,
        }
    }

    /// The direction used when [`Animation::direction`] is `None`.
    pub const fn default_direction(self) -> Option<Direction> {
        match self {
            Effect::FlyIn
            | Effect::Wipe
            | Effect::PathLines
            | Effect::PathArcs
            | Effect::PathTurns => Some(Direction::Down),
            Effect::Float => Some(Direction::Up),
            Effect::Split => Some(Direction::VerticalOut),
            Effect::Circle | Effect::Box | Effect::Diamond | Effect::Plus => Some(Direction::In),
            Effect::RandomBars | Effect::Swivel => Some(Direction::Horizontal),
            Effect::Zoom => Some(Direction::ObjectCenter),
            _ => None,
        }
    }

    /// The value used when [`Animation::amount`] is `None` (`None`: the
    /// effect has no amount): Wheel spokes, Spin degrees, Grow/Shrink and
    /// Transparency percent.
    pub const fn default_amount(self) -> Option<i32> {
        match self {
            Effect::Wheel => Some(1),
            Effect::Spin => Some(360),
            Effect::GrowShrink => Some(150),
            Effect::Transparency => Some(50),
            _ => None,
        }
    }

    /// Whether the effect takes a colour ([`Animation::color`]).
    pub const fn has_color(self) -> bool {
        matches!(
            self,
            Effect::ColorPulse
                | Effect::ObjectColor
                | Effect::LineColor
                | Effect::FillColor
                | Effect::BrushColor
                | Effect::FontColor
        )
    }

    /// The colour used when [`Animation::color`] is `None` (hex `RRGGBB`;
    /// PowerPoint's first gallery pick).
    pub const fn default_color(self) -> Option<&'static str> {
        if self.has_color() {
            Some("FF0000")
        } else {
            None
        }
    }

    /// Whether the effect is a motion path preset.
    pub fn is_path(self) -> bool {
        self.class() == AnimationKind::Path
    }
}

/// When an animation starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Trigger {
    /// On the next click (starts a new click step).
    #[default]
    OnClick,
    /// Together with the previous animation.
    WithPrevious,
    /// When the previous animation has finished.
    AfterPrevious,
}

/// Timing › Triggers: what starts an animation outside the slide's click
/// sequence (an interactive sequence, `nodeType="interactiveSeq"`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum StartOn {
    /// "On Click of" a shape of the slide (`p:cond evt="onClick"`).
    Click(NodeId),
    /// "On Bookmark" of a media clip of the slide
    /// (`p:cond evt="onMediaBookmark"`, `p14:bmkName`).
    #[serde(rename_all = "camelCase")]
    Bookmark {
        /// The media shape.
        shape: NodeId,
        /// The bookmark's name ([`crate::clip::Bookmark::name`]).
        name: String,
    },
}

impl StartOn {
    /// The shape that triggers.
    pub fn shape(&self) -> NodeId {
        match self {
            StartOn::Click(s) => *s,
            StartOn::Bookmark { shape, .. } => *shape,
        }
    }

    /// The same trigger on another shape (slide copies).
    pub fn with_shape(&self, shape: NodeId) -> StartOn {
        match self {
            StartOn::Click(_) => StartOn::Click(shape),
            StartOn::Bookmark { name, .. } => StartOn::Bookmark {
                shape,
                name: name.clone(),
            },
        }
    }
}

/// Timing › Repeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Repeat {
    /// A number of times in 1/1000 (`repeatCount="3000"` = 3 times).
    Times(u32),
    /// "Until Next Click" (`indefinite`, ends on the next click).
    UntilNextClick,
    /// "Until End of Slide" (`indefinite`).
    UntilEndOfSlide,
}

/// Effect Options › Sequence / Text Animation › Group text: how the text
/// of a shape is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextBuild {
    /// `0` = all paragraphs at once (`build="allAtOnce"`); `1..=5` = by
    /// paragraphs of that outline level (`build="p"`, `bldLvl`): every
    /// paragraph of a level up to `level` starts a step, deeper ones go
    /// with their parent.
    pub level: u8,
    /// "In reverse order" (`rev="1"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub reverse: bool,
    /// "Animate attached shape" (`animBg="1"`): the shape itself animates
    /// with the first paragraph.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub animate_background: bool,
}

impl TextBuild {
    /// The deepest level PowerPoint offers (5th level paragraphs).
    pub const MAX_LEVEL: u8 = 5;

    /// By 1st level paragraphs (PowerPoint's default for text placeholders).
    pub const fn by_paragraph() -> Self {
        Self {
            level: 1,
            reverse: false,
            animate_background: false,
        }
    }
}

/// Text Animation › Animate text: by word or letter (`p:iterate`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum IterateUnit {
    /// By word (`type="wd"`).
    Word,
    /// By letter (`type="lt"`).
    Letter,
}

/// By word / letter with a delay between them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Iterate {
    /// Word or letter.
    pub unit: IterateUnit,
    /// The delay between words/letters in 1/1000 percent of the duration
    /// (`p:tmPct`; PowerPoint's default 10 % = `10000`).
    pub delay_pct: u32,
}

/// One animation of a shape on its slide.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Animation {
    /// Node id (presentation-unique, like slides and shapes).
    pub id: NodeId,
    /// The animated shape (on the same slide; may be inside a group).
    pub shape: NodeId,
    /// Entrance, emphasis, exit, motion path or media.
    pub kind: AnimationKind,
    /// The effect; must support `kind` ([`Effect::supports`]).
    pub effect: Effect,
    /// When it starts.
    #[serde(default)]
    pub trigger: Trigger,
    /// Duration in milliseconds (ignored for `Appear`).
    pub duration_ms: u32,
    /// Delay after the trigger, in milliseconds.
    #[serde(default)]
    pub delay_ms: u32,
    /// Direction; `None` = the effect's default
    /// ([`Effect::default_direction`]). Must be one of
    /// [`Effect::directions`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub direction: Option<Direction>,
    /// The effect's amount; `None` = [`Effect::default_amount`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub amount: Option<i32>,
    /// The effect's colour (hex `RRGGBB`); `None` = [`Effect::default_color`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub color: Option<String>,
    /// A motion path's path ([`crate::motion`]); `None` = the preset's
    /// default path ([`crate::motion::default_path`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub path: Option<String>,
    /// Emphasis and paths: play forward, then backward (`autoRev="1"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub auto_reverse: bool,
    /// Timing › Repeat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub repeat: Option<Repeat>,
    /// Timing › "Rewind when done playing" (`fill="remove"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub rewind: bool,
    /// Text built by paragraphs (`p:bldP build="p"`); `None` = as one
    /// object.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub build: Option<TextBuild>,
    /// By word / letter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub iterate: Option<Iterate>,
    /// Triggered by a click on a shape or a media bookmark instead of the
    /// click sequence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub start_on: Option<StartOn>,
}

impl Animation {
    /// The shortest Duration PowerPoint accepts (0.01 s).
    pub const MIN_DURATION_MS: u32 = 10;
    /// The longest Duration and Delay PowerPoint accepts (59.00 s; longer
    /// values from files are kept).
    pub const MAX_TIME_MS: u32 = 59_000;

    /// An on-click animation of `shape` with the effect's default duration
    /// and direction (id 0: the caller assigns one).
    pub const fn new(shape: NodeId, kind: AnimationKind, effect: Effect) -> Self {
        Self {
            id: NodeId(0),
            shape,
            kind,
            effect,
            trigger: Trigger::OnClick,
            duration_ms: effect.default_duration_ms(),
            delay_ms: 0,
            direction: None,
            amount: None,
            color: None,
            path: None,
            auto_reverse: false,
            repeat: None,
            rewind: false,
            build: None,
            iterate: None,
            start_on: None,
        }
    }

    /// The effective direction (the explicit one, else the effect's
    /// default).
    pub fn effective_direction(&self) -> Option<Direction> {
        self.direction.or(self.effect.default_direction())
    }

    /// The effective amount.
    pub fn effective_amount(&self) -> Option<i32> {
        self.amount.or(self.effect.default_amount())
    }

    /// The effective colour (hex `RRGGBB`).
    pub fn effective_color(&self) -> Option<&str> {
        self.color.as_deref().or(self.effect.default_color())
    }

    /// The effective motion path (the explicit one, else the preset's
    /// default; `None` for effects without a path).
    pub fn effective_path(&self) -> Option<String> {
        self.path
            .clone()
            .or_else(|| crate::motion::default_path(self.effect, self.effective_direction()))
    }

    /// Checks that effect, kind, direction and the options fit together
    /// (not the targets: see [`Slide::validate`](crate::Slide::validate)).
    pub fn validate(&self) -> Result<(), String> {
        if !self.effect.supports(self.kind) {
            return Err(format!(
                "effect {:?} is not available for {:?} animations",
                self.effect, self.kind
            ));
        }
        if let Some(d) = self.direction {
            if !self.effect.directions().contains(&d) {
                return Err(format!(
                    "direction {d:?} does not apply to effect {:?}",
                    self.effect
                ));
            }
        }
        if let Some(v) = self.amount {
            let ok = match self.effect {
                Effect::Wheel => matches!(v, 1 | 2 | 3 | 4 | 8),
                Effect::Spin => v != 0,
                Effect::GrowShrink => (1..=1000).contains(&v),
                Effect::Transparency => (0..=100).contains(&v),
                _ => false,
            };
            if !ok {
                return Err(format!(
                    "amount {v} does not apply to effect {:?}",
                    self.effect
                ));
            }
        }
        if let Some(c) = &self.color {
            if !self.effect.has_color() {
                return Err(format!("effect {:?} takes no colour", self.effect));
            }
            if c.len() != 6 || !c.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err(format!("colour {c:?} is not RRGGBB"));
            }
        }
        if let Some(p) = &self.path {
            if !self.effect.is_path() {
                return Err(format!("effect {:?} takes no motion path", self.effect));
            }
            crate::motion::parse_path(p)?;
        }
        if let Some(Repeat::Times(0)) = self.repeat {
            return Err("repeat count must be positive".into());
        }
        if let Some(b) = &self.build {
            if b.level > TextBuild::MAX_LEVEL {
                return Err(format!("text build level {} is above 5", b.level));
            }
            if matches!(self.kind, AnimationKind::Media) {
                return Err("media commands have no text build".into());
            }
        }
        if let Some(it) = &self.iterate {
            if it.delay_pct > 100_000 {
                return Err(format!("letter/word delay {} is above 100 %", it.delay_pct));
            }
        }
        if let Some(StartOn::Bookmark { name, .. }) = &self.start_on {
            if name.is_empty() {
                return Err("a bookmark trigger needs a bookmark name".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_defaults_and_validation() {
        let t = Transition::new(TransitionKind::Fade);
        assert_eq!(t.duration_ms, 700);
        assert!(t.advance_on_click && t.advance_after_ms.is_none());
        assert!(t.validate().is_ok());
        assert!(!t.is_noop());
        let mut none = Transition::new(TransitionKind::None);
        assert!(none.is_noop());
        none.advance_after_ms = Some(1);
        assert!(!none.is_noop());
        let mut snd = Transition::new(TransitionKind::None);
        snd.sound = Some(TransitionSound::StopPrevious);
        assert!(!snd.is_noop());
        for kind in TransitionKind::ALL {
            let mut t = Transition::new(kind);
            assert!(t.validate().is_ok());
            assert_eq!(
                t.effective_direction().is_some(),
                !kind.directions().is_empty(),
                "{kind:?}"
            );
            if let Some(d) = kind.default_direction() {
                assert!(kind.directions().contains(&d), "{kind:?}");
            }
            if let Some(d) = kind.gallery_direction() {
                assert!(kind.directions().contains(&d), "{kind:?}");
            }
            assert_eq!(t.effective_option().is_some(), !kind.options().is_empty());
            for d in kind.directions() {
                t.direction = Some(*d);
                assert!(t.validate().is_ok());
            }
            for o in kind.options() {
                t.option = Some(*o);
                assert!(t.validate().is_ok());
            }
            assert!(kind.default_duration_ms() <= Transition::MAX_DURATION_MS);
        }
        let mut t = Transition::new(TransitionKind::Push);
        t.direction = Some(Direction::LeftUp);
        assert!(t.validate().is_err());
        t.kind = TransitionKind::Fade;
        t.direction = Some(Direction::Left);
        assert!(t.validate().is_err());
        let mut g = Transition::new(TransitionKind::Glitter);
        g.option = Some(TransitionOption::Strips);
        assert!(g.validate().is_err());
        // the gallery's picks differ from the file format's defaults
        assert_eq!(
            TransitionKind::Push.gallery_direction(),
            Some(Direction::Up)
        );
        assert_eq!(
            TransitionKind::Switch.gallery_direction(),
            Some(Direction::Right)
        );
        assert!(TransitionKind::Cube.is_extension() && !TransitionKind::Zoom.is_extension());
    }

    #[test]
    fn effect_tables_are_consistent() {
        for e in Effect::ALL {
            if let Some(d) = e.default_direction() {
                assert!(e.directions().contains(&d), "{e:?}");
            }
            assert_eq!(
                e.directions().is_empty(),
                e.default_direction().is_none(),
                "{e:?}"
            );
            let mut a = Animation::new(NodeId(1), e.class(), e);
            assert!(a.validate().is_ok(), "{e:?}");
            a.amount = e.default_amount();
            assert!(a.validate().is_ok(), "{e:?}");
            if e.has_color() {
                a.color = Some("00B050".into());
                assert!(a.validate().is_ok(), "{e:?}");
            }
        }
        assert_eq!(Effect::Float.class(), AnimationKind::Entrance);
        assert!(Effect::Float.supports(AnimationKind::Exit));
        assert!(!Effect::Pulse.supports(AnimationKind::Entrance));
        assert!(Effect::PathCustom.is_path());
    }

    #[test]
    fn animation_validation() {
        let a = Animation::new(NodeId(3), AnimationKind::Entrance, Effect::FlyIn);
        assert_eq!(a.effective_direction(), Some(Direction::Down));
        assert_eq!(a.duration_ms, 500);
        assert!(a.validate().is_ok());
        let spin = Animation::new(NodeId(3), AnimationKind::Exit, Effect::Spin);
        assert!(spin.validate().is_err());
        let fade = Animation::new(NodeId(3), AnimationKind::Emphasis, Effect::Fade);
        assert!(fade.validate().is_err());
        let mut wipe = Animation::new(NodeId(3), AnimationKind::Exit, Effect::Wipe);
        wipe.direction = Some(Direction::LeftUp);
        assert!(wipe.validate().is_err());
        wipe.direction = Some(Direction::Up);
        assert!(wipe.validate().is_ok());
        let mut w = Animation::new(NodeId(3), AnimationKind::Entrance, Effect::Wheel);
        w.amount = Some(5);
        assert!(w.validate().is_err());
        w.amount = Some(8);
        assert!(w.validate().is_ok());
        let mut c = Animation::new(NodeId(3), AnimationKind::Emphasis, Effect::FillColor);
        assert_eq!(c.effective_color(), Some("FF0000"));
        c.color = Some("red".into());
        assert!(c.validate().is_err());
        let mut p = Animation::new(NodeId(3), AnimationKind::Path, Effect::PathLines);
        assert_eq!(p.effective_path().as_deref(), Some("M 0 0 L 0 0.25 E"));
        p.path = Some("L 1".into());
        assert!(p.validate().is_err());
        p.path = Some("M 0 0 L 0.5 0.5 E".into());
        assert!(p.validate().is_ok());
        p.repeat = Some(Repeat::Times(0));
        assert!(p.validate().is_err());
        let mut t = Animation::new(NodeId(3), AnimationKind::Entrance, Effect::Float);
        t.build = Some(TextBuild {
            level: 6,
            ..TextBuild::by_paragraph()
        });
        assert!(t.validate().is_err());
        t.build = Some(TextBuild::by_paragraph());
        t.start_on = Some(StartOn::Bookmark {
            shape: NodeId(4),
            name: String::new(),
        });
        assert!(t.validate().is_err());
    }

    #[test]
    fn serde_shapes() {
        let mut t = Transition::new(TransitionKind::Push);
        t.direction = Some(Direction::Up);
        t.advance_after_ms = Some(3000);
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"push","direction":"up","durationMs":1000,"advanceOnClick":true,"advanceAfterMs":3000}"#
        );
        assert_eq!(serde_json::from_str::<Transition>(&json).unwrap(), t);
        let short: Transition =
            serde_json::from_str(r#"{"kind":"fade","durationMs":700}"#).unwrap();
        assert_eq!(short, Transition::new(TransitionKind::Fade));
        let mut s = Transition::new(TransitionKind::Glitter);
        s.option = Some(TransitionOption::Hexagons);
        s.sound = Some(TransitionSound::Play {
            media: MediaId(4),
            loop_until_next: true,
        });
        let json = serde_json::to_string(&s).unwrap();
        assert!(
            json.contains(r#""sound":{"kind":"play","value":{"media":4,"loop":true}}"#),
            "{json}"
        );
        assert_eq!(serde_json::from_str::<Transition>(&json).unwrap(), s);

        let mut a = Animation::new(NodeId(4), AnimationKind::Entrance, Effect::FlyIn);
        a.id = NodeId(9);
        a.trigger = Trigger::AfterPrevious;
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(
            json,
            r#"{"id":9,"shape":4,"kind":"entrance","effect":"flyIn","trigger":"afterPrevious","durationMs":500,"delayMs":0}"#
        );
        assert_eq!(serde_json::from_str::<Animation>(&json).unwrap(), a);
        a.start_on = Some(StartOn::Click(NodeId(5)));
        a.repeat = Some(Repeat::UntilNextClick);
        a.build = Some(TextBuild::by_paragraph());
        let json = serde_json::to_string(&a).unwrap();
        assert!(
            json.contains(
                r#""repeat":{"kind":"untilNextClick"},"build":{"level":1},"startOn":{"kind":"click","value":5}"#
            ),
            "{json}"
        );
        assert_eq!(serde_json::from_str::<Animation>(&json).unwrap(), a);
    }
}
