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

use serde::{Deserialize, Serialize};

use crate::NodeId;

/// The visual effect of a slide transition.
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
}

impl TransitionKind {
    /// Every kind, in menu order.
    pub const ALL: [TransitionKind; 8] = [
        TransitionKind::None,
        TransitionKind::Fade,
        TransitionKind::Push,
        TransitionKind::Wipe,
        TransitionKind::Cover,
        TransitionKind::Split,
        TransitionKind::Cut,
        TransitionKind::Zoom,
    ];

    /// PowerPoint's default duration of the effect, in milliseconds.
    pub const fn default_duration_ms(self) -> u32 {
        match self {
            TransitionKind::None | TransitionKind::Cut => 0,
            TransitionKind::Fade => 700,
            TransitionKind::Push | TransitionKind::Wipe | TransitionKind::Cover => 1000,
            TransitionKind::Split => 1500,
            TransitionKind::Zoom => 500,
        }
    }

    /// The directions this kind accepts (empty: none).
    pub const fn directions(self) -> &'static [Direction] {
        use Direction::*;
        match self {
            TransitionKind::Push | TransitionKind::Wipe => &[Left, Up, Right, Down],
            TransitionKind::Cover => &[Left, Up, Right, Down, LeftUp, RightUp, LeftDown, RightDown],
            TransitionKind::Split => &[HorizontalOut, HorizontalIn, VerticalOut, VerticalIn],
            TransitionKind::Zoom => &[In, Out],
            TransitionKind::None | TransitionKind::Fade | TransitionKind::Cut => &[],
        }
    }

    /// The direction used when [`Transition::direction`] is `None` (the
    /// file format's default; `None` for kinds without directions).
    pub const fn default_direction(self) -> Option<Direction> {
        match self {
            TransitionKind::Push | TransitionKind::Wipe | TransitionKind::Cover => {
                Some(Direction::Left)
            }
            TransitionKind::Split => Some(Direction::HorizontalOut),
            TransitionKind::Zoom => Some(Direction::Out),
            TransitionKind::None | TransitionKind::Fade | TransitionKind::Cut => None,
        }
    }
}

/// A direction of a transition or animation.
///
/// - Transitions (`Push`, `Wipe`, `Cover`): the direction the motion goes
///   (the OOXML `dir`): `Left` = the new slide moves toward the left,
///   which PowerPoint's menu calls "From Right". `Split` uses the
///   `Horizontal*`/`Vertical*` values, `Zoom` uses `In`/`Out`.
/// - Animations (`FlyIn`, `Wipe`): the side of the shape's box the effect
///   comes from (entrance) or goes to (exit): `Down` = PowerPoint's "From
///   Bottom" / "To Bottom". Diagonals only for `FlyIn`.
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
    /// Duration of the effect in milliseconds.
    pub duration_ms: u32,
    /// Advance to the next slide on a click (`advClick`, default on).
    #[serde(default = "yes")]
    pub advance_on_click: bool,
    /// Advance automatically after this many milliseconds (`advTm`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub advance_after_ms: Option<u32>,
}

fn yes() -> bool {
    true
}

impl Transition {
    /// A transition of `kind` with PowerPoint's defaults: default
    /// direction and duration, advance on click, no timer.
    pub const fn new(kind: TransitionKind) -> Self {
        Self {
            kind,
            direction: None,
            duration_ms: kind.default_duration_ms(),
            advance_on_click: true,
            advance_after_ms: None,
        }
    }

    /// The effective direction (the explicit one, else the kind's default).
    pub fn effective_direction(&self) -> Option<Direction> {
        self.direction.or(self.kind.default_direction())
    }

    /// Whether the transition changes nothing (no effect, advance on click
    /// only): equivalent to no transition. Readers and editors store `None`
    /// instead, and writers skip it.
    pub fn is_noop(&self) -> bool {
        self.kind == TransitionKind::None
            && self.advance_on_click
            && self.advance_after_ms.is_none()
    }

    /// Checks that the direction fits the kind.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(d) = self.direction {
            if !self.kind.directions().contains(&d) {
                return Err(format!(
                    "direction {d:?} does not apply to transition {:?}",
                    self.kind
                ));
            }
        }
        Ok(())
    }
}

/// Whether an animation makes its shape appear, emphasizes it, or makes it
/// disappear (`presetClass` `entr` / `emph` / `exit`).
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
}

/// The effect of an animation (a PowerPoint preset).
///
/// Entrance and exit: `Appear` (exit: Disappear), `Fade`, `FlyIn` (exit:
/// Fly Out), `Wipe`, `Zoom`. Emphasis: `Spin` (one full turn) and
/// `GrowShrink` (to 150 %).
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
    /// Wipe from a side (`presetID` 22; 4 directions).
    Wipe,
    /// Zoom from / to the object center (`presetID` 53).
    Zoom,
    /// Emphasis: one full clockwise turn (`presetID` 8).
    Spin,
    /// Emphasis: grow to 150 % (`presetID` 6).
    GrowShrink,
}

impl Effect {
    /// Every effect, in menu order.
    pub const ALL: [Effect; 7] = [
        Effect::Appear,
        Effect::Fade,
        Effect::FlyIn,
        Effect::Wipe,
        Effect::Zoom,
        Effect::Spin,
        Effect::GrowShrink,
    ];

    /// Whether the effect exists for animations of `kind`.
    pub const fn supports(self, kind: AnimationKind) -> bool {
        match self {
            Effect::Spin | Effect::GrowShrink => matches!(kind, AnimationKind::Emphasis),
            _ => !matches!(kind, AnimationKind::Emphasis),
        }
    }

    /// The directions this effect accepts (empty: none).
    pub const fn directions(self) -> &'static [Direction] {
        use Direction::*;
        match self {
            Effect::FlyIn => &[Down, Left, Right, Up, LeftDown, RightDown, LeftUp, RightUp],
            Effect::Wipe => &[Down, Left, Right, Up],
            _ => &[],
        }
    }

    /// PowerPoint's default duration in milliseconds (0 for `Appear`,
    /// which is instant).
    pub const fn default_duration_ms(self) -> u32 {
        match self {
            Effect::Appear => 0,
            Effect::Fade | Effect::FlyIn | Effect::Wipe | Effect::Zoom => 500,
            Effect::Spin | Effect::GrowShrink => 2000,
        }
    }

    /// The direction used when [`Animation::direction`] is `None`.
    pub const fn default_direction(self) -> Option<Direction> {
        match self {
            Effect::FlyIn | Effect::Wipe => Some(Direction::Down),
            _ => None,
        }
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

/// One animation of a shape on its slide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Entrance, emphasis or exit.
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
}

impl Animation {
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
        }
    }

    /// The effective direction (the explicit one, else the effect's
    /// default).
    pub fn effective_direction(&self) -> Option<Direction> {
        self.direction.or(self.effect.default_direction())
    }

    /// Checks that effect, kind and direction fit together (not the
    /// target: see [`Slide::validate`](crate::Slide::validate)).
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
        for kind in TransitionKind::ALL {
            let mut t = Transition::new(kind);
            assert!(t.validate().is_ok());
            assert_eq!(
                t.effective_direction().is_some(),
                !kind.directions().is_empty()
            );
            if let Some(d) = kind.default_direction() {
                assert!(kind.directions().contains(&d), "{kind:?}");
            }
            for d in kind.directions() {
                t.direction = Some(*d);
                assert!(t.validate().is_ok());
            }
        }
        let mut t = Transition::new(TransitionKind::Push);
        t.direction = Some(Direction::LeftUp);
        assert!(t.validate().is_err());
        t.kind = TransitionKind::Fade;
        t.direction = Some(Direction::Left);
        assert!(t.validate().is_err());
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
        for e in Effect::ALL {
            if let Some(d) = e.default_direction() {
                assert!(e.directions().contains(&d));
            }
        }
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

        let mut a = Animation::new(NodeId(4), AnimationKind::Entrance, Effect::FlyIn);
        a.id = NodeId(9);
        a.trigger = Trigger::AfterPrevious;
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(
            json,
            r#"{"id":9,"shape":4,"kind":"entrance","effect":"flyIn","trigger":"afterPrevious","durationMs":500,"delayMs":0}"#
        );
        assert_eq!(serde_json::from_str::<Animation>(&json).unwrap(), a);
    }
}
