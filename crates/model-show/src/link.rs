//! Hyperlinks of text runs and click actions of shapes (`a:hlinkClick`
//! on `a:rPr` and on `p:cNvPr`), and PowerPoint's action buttons.
//!
//! A [`Hyperlink`] opens a web address, jumps to a slide of the
//! presentation (by id or relative: first, last, next, previous, last
//! viewed) or ends the show. A shape's click action is a [`Hyperlink`]
//! too ([`Action`]): PowerPoint's Insert › Action "Hyperlink to"; "Run
//! program" and "Play sound" are not modelled.

use serde::{Deserialize, Serialize};

use crate::NodeId;

/// A slide a link jumps to.
///
/// Serializes as `{"kind":"id","value":7}`, `{"kind":"next"}` etc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum SlideRef {
    /// A slide of the presentation (`ppaction://hlinksldjump` + a slide
    /// relationship).
    Id(NodeId),
    /// `ppaction://hlinkshowjump?jump=firstslide`.
    First,
    /// `jump=lastslide`.
    Last,
    /// `jump=nextslide`.
    Next,
    /// `jump=previousslide`.
    Previous,
    /// `jump=lastslideviewed` (the action button "Return").
    LastViewed,
}

impl SlideRef {
    /// The `jump=` value of a relative jump (`None` for [`SlideRef::Id`]).
    pub fn jump_name(self) -> Option<&'static str> {
        Some(match self {
            SlideRef::Id(_) => return None,
            SlideRef::First => "firstslide",
            SlideRef::Last => "lastslide",
            SlideRef::Next => "nextslide",
            SlideRef::Previous => "previousslide",
            SlideRef::LastViewed => "lastslideviewed",
        })
    }

    /// The relative jump of a `jump=` value.
    pub fn from_jump_name(name: &str) -> Option<SlideRef> {
        Some(match name {
            "firstslide" => SlideRef::First,
            "lastslide" => SlideRef::Last,
            "nextslide" => SlideRef::Next,
            "previousslide" => SlideRef::Previous,
            "lastslideviewed" => SlideRef::LastViewed,
            _ => return None,
        })
    }
}

/// Where a link goes.
///
/// Serializes as `{"kind":"url","value":"https://…"}`,
/// `{"kind":"slide","value":{"kind":"next"}}` or `{"kind":"endShow"}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum LinkTarget {
    /// A web address, `mailto:` or file URL (an external relationship).
    Url(String),
    /// A slide of this presentation.
    Slide(SlideRef),
    /// Ends the slide show (`ppaction://hlinkshowjump?jump=endshow`).
    EndShow,
}

/// A hyperlink (`a:hlinkClick`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Hyperlink {
    /// Where it goes.
    pub target: LinkTarget,
    /// The ScreenTip (`@tooltip`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub tooltip: Option<String>,
}

/// A shape's mouse-click action (Insert › Action, action buttons).
pub type Action = Hyperlink;

impl Hyperlink {
    /// A link to a web address.
    pub fn url(url: impl Into<String>) -> Self {
        Self {
            target: LinkTarget::Url(url.into()),
            tooltip: None,
        }
    }

    /// A jump to a slide.
    pub fn slide(to: SlideRef) -> Self {
        Self {
            target: LinkTarget::Slide(to),
            tooltip: None,
        }
    }

    /// The slide this link jumps to by id, if any.
    pub fn slide_id(&self) -> Option<NodeId> {
        match self.target {
            LinkTarget::Slide(SlideRef::Id(id)) => Some(id),
            _ => None,
        }
    }

    /// Whether the link is usable: URLs must not be empty.
    pub fn is_valid(&self) -> bool {
        !matches!(&self.target, LinkTarget::Url(u) if u.trim().is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_shapes() {
        let l = Hyperlink {
            target: LinkTarget::Slide(SlideRef::Id(NodeId(7))),
            tooltip: Some("Go".into()),
        };
        let json = serde_json::to_string(&l).unwrap();
        assert_eq!(
            json,
            r#"{"target":{"kind":"slide","value":{"kind":"id","value":7}},"tooltip":"Go"}"#
        );
        assert_eq!(serde_json::from_str::<Hyperlink>(&json).unwrap(), l);
        let u = Hyperlink::url("https://example.com");
        assert_eq!(
            serde_json::to_string(&u).unwrap(),
            r#"{"target":{"kind":"url","value":"https://example.com"}}"#
        );
        assert_eq!(l.slide_id(), Some(NodeId(7)));
        assert!(!Hyperlink::url(" ").is_valid());
    }

    #[test]
    fn jump_names_roundtrip() {
        for r in [
            SlideRef::First,
            SlideRef::Last,
            SlideRef::Next,
            SlideRef::Previous,
            SlideRef::LastViewed,
        ] {
            assert_eq!(SlideRef::from_jump_name(r.jump_name().unwrap()), Some(r));
        }
        assert_eq!(SlideRef::Id(NodeId(1)).jump_name(), None);
        assert_eq!(SlideRef::from_jump_name("endshow"), None);
    }
}
