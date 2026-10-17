//! Shape geometry. The preset library, custom geometry, the ECMA-376
//! preset evaluator (outlines, adjust handles, text rectangles,
//! connection sites) and the connector geometries live in
//! [`core_model::geometry`] since P9-X1 (Write draws the same presets);
//! this module re-exports them unchanged and adds what only Show knows:
//! the click actions of action buttons ([`PresetActions`]).

pub use core_model::geometry::*;

use crate::link::{Action, Hyperlink, SlideRef};

/// Show-specific behaviour of a [`Preset`].
pub trait PresetActions {
    /// The click action PowerPoint gives a new action button of this
    /// preset (Home and Beginning: first slide, End: last, Back/Forward:
    /// previous/next, Return: last slide viewed; the others: none).
    fn default_action(&self) -> Option<Action>;
}

impl PresetActions for Preset {
    fn default_action(&self) -> Option<Action> {
        let to = match self {
            Preset::ActionButtonHome | Preset::ActionButtonBeginning => SlideRef::First,
            Preset::ActionButtonEnd => SlideRef::Last,
            Preset::ActionButtonBackPrevious => SlideRef::Previous,
            Preset::ActionButtonForwardNext => SlideRef::Next,
            Preset::ActionButtonReturn => SlideRef::LastViewed,
            _ => return None,
        };
        Some(Hyperlink::slide(to))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_button_defaults() {
        assert_eq!(
            Preset::ActionButtonForwardNext.default_action(),
            Some(Hyperlink::slide(SlideRef::Next))
        );
        assert_eq!(
            Preset::ActionButtonReturn.default_action(),
            Some(Hyperlink::slide(SlideRef::LastViewed))
        );
        assert_eq!(Preset::ActionButtonHelp.default_action(), None);
        for p in Preset::ACTION_BUTTONS {
            let none = matches!(
                p,
                Preset::ActionButtonHelp
                    | Preset::ActionButtonInformation
                    | Preset::ActionButtonMovie
                    | Preset::ActionButtonDocument
                    | Preset::ActionButtonSound
                    | Preset::ActionButtonBlank
            );
            assert_eq!(p.default_action().is_none(), none, "{p:?}");
        }
    }
}
