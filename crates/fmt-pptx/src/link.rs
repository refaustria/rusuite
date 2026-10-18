//! Hyperlinks and click actions (`a:hlinkClick` on runs and on
//! `p:cNvPr`): URLs as external `hyperlink` relationships, slide jumps as
//! `ppaction://hlinksldjump` + a `slide` relationship, relative jumps and
//! "end show" as `ppaction://hlinkshowjump?jump=…` with an empty `r:id`.
//!
//! Reading happens in two passes: the text/shape readers turn links whose
//! target needs a relationship into placeholders ([`read_hlink`]); the
//! slide reader resolves them against the part's relationships
//! ([`resolve_part_links`]) and, once every slide is read, slide parts
//! become slide ids ([`resolve_slide_links`]).

use std::collections::HashMap;

use fmt_ooxml::{rel, Relationships, TargetMode};
use model_show::{Hyperlink, LinkTarget, NodeId, Presentation, Shape, ShapeKind, SlideRef};

use crate::warn::note;
use crate::xml::{El, XmlOut};
use crate::Warnings;

/// `action` of a relative jump.
const SHOW_JUMP: &str = "ppaction://hlinkshowjump?jump=";
/// `action` of a jump to a slide relationship.
pub const SLIDE_JUMP: &str = "ppaction://hlinksldjump";
/// `action` of a jump to a custom show (`id=N`, `&return=true`).
const CUSTOM_SHOW: &str = "ppaction://customshow?";
/// `action` PowerPoint puts on media shapes.
pub const MEDIA_ACTION: &str = "ppaction://media";

/// Placeholder prefix of a link waiting for its relationship `r:id`.
const RID: &str = "\u{0}rid:";
/// Placeholder prefix of a slide link waiting for its slide id (the
/// slide's part name follows).
const PART: &str = "\u{0}part:";

/// `a:hlinkClick` → a hyperlink; links that need a relationship carry a
/// placeholder until [`resolve_part_links`]. `None`: no link (empty,
/// media play actions) or an unsupported action (warning).
pub fn read_hlink(h: &El, w: &mut Warnings) -> Option<Hyperlink> {
    let action = h.attr("action").unwrap_or("");
    let rid = h.attr("id").unwrap_or("");
    let tooltip = h
        .attr("tooltip")
        .filter(|t| !t.is_empty())
        .map(str::to_owned);
    let target = if let Some(jump) = action.strip_prefix(SHOW_JUMP) {
        if jump == "endshow" {
            LinkTarget::EndShow
        } else if let Some(r) = SlideRef::from_jump_name(jump) {
            LinkTarget::Slide(r)
        } else {
            w.add(note!("pptx.link.jump", jump = jump));
            return None;
        }
    } else if let Some(query) = action.strip_prefix(CUSTOM_SHOW) {
        let mut id = None;
        let mut return_after = false;
        for kv in query.split('&') {
            match kv.split_once('=') {
                Some(("id", v)) => id = v.parse::<u32>().ok(),
                Some(("return", v)) => return_after = v.eq_ignore_ascii_case("true"),
                _ => {}
            }
        }
        let Some(id) = id else {
            w.add(note!("pptx.link.customShowNoId"));
            return None;
        };
        LinkTarget::CustomShow { id, return_after }
    } else if action.is_empty() || action == SLIDE_JUMP {
        if rid.is_empty() {
            return None;
        }
        LinkTarget::Url(format!("{RID}{rid}"))
    } else if action.starts_with(MEDIA_ACTION) || action == "ppaction://noaction" {
        return None;
    } else {
        w.add(note!("pptx.link.actions"));
        return None;
    };
    Some(Hyperlink { target, tooltip })
}

/// Calls `f` on every hyperlink slot of `shapes`: click actions and the
/// links of text runs (also in groups and table cells).
pub fn links_mut(shapes: &mut [Shape], f: &mut dyn FnMut(&mut Option<Hyperlink>)) {
    for s in shapes {
        f(&mut s.click_action);
        match &mut s.kind {
            ShapeKind::Auto {
                text: Some(body), ..
            } => {
                for r in body.paragraphs.iter_mut().flat_map(|p| p.runs.iter_mut()) {
                    f(&mut r.hyperlink);
                }
            }
            ShapeKind::Table(t) => {
                for r in t
                    .cells
                    .iter_mut()
                    .flatten()
                    .flat_map(|c| c.text.paragraphs.iter_mut())
                    .flat_map(|p| p.runs.iter_mut())
                {
                    f(&mut r.hyperlink);
                }
            }
            ShapeKind::Group { children } => links_mut(children, f),
            _ => {}
        }
    }
}

/// A resolved relationship: (type's last segment, target, external).
pub type RelInfo = (String, String, bool);

/// Resolves the relationship placeholders of `shapes` with `rel_of`
/// (`r:id` → `(relationship type, target, external)`, target already
/// resolved to a part name for internal ones): external targets become
/// URLs, slide parts slide placeholders; anything else is dropped
/// (warning).
pub fn resolve_part_links(
    shapes: &mut [Shape],
    rel_of: &dyn Fn(&str) -> Option<RelInfo>,
    w: &mut Warnings,
) {
    links_mut(shapes, &mut |slot| {
        let Some(rid) = slot.as_ref().and_then(|h| match &h.target {
            LinkTarget::Url(u) => u.strip_prefix(RID).map(str::to_owned),
            _ => None,
        }) else {
            return;
        };
        let resolved = match rel_of(&rid) {
            Some((_, target, true)) => Some(LinkTarget::Url(target)),
            Some((kind, part, false)) if kind == "slide" => {
                Some(LinkTarget::Url(format!("{PART}{part}")))
            }
            Some(_) => {
                w.add(note!("pptx.link.otherParts"));
                None
            }
            None => {
                w.add(note!("pptx.link.dangling"));
                None
            }
        };
        match (resolved, slot.as_mut()) {
            (Some(t), Some(h)) => h.target = t,
            _ => *slot = None,
        }
    });
}

/// Turns slide placeholders into slide ids (`parts`: slide part name →
/// id) in every slide, the master and the layouts; links to slides that
/// were not read are dropped (warning).
pub fn resolve_slide_links(
    p: &mut Presentation,
    parts: &HashMap<String, NodeId>,
    w: &mut Warnings,
) {
    let mut fix = |slot: &mut Option<Hyperlink>| {
        let Some(part) = slot.as_ref().and_then(|h| match &h.target {
            LinkTarget::Url(u) => u.strip_prefix(PART).map(str::to_owned),
            _ => None,
        }) else {
            return;
        };
        match (parts.get(&part), slot.as_mut()) {
            (Some(&id), Some(h)) => h.target = LinkTarget::Slide(SlideRef::Id(id)),
            _ => {
                w.add(note!("pptx.link.missingSlide"));
                *slot = None;
            }
        }
    };
    for s in &mut p.slides {
        links_mut(&mut s.shapes, &mut fix);
    }
    links_mut(&mut p.master.shapes, &mut fix);
    for l in &mut p.layouts {
        links_mut(&mut l.shapes, &mut fix);
    }
}

/// An `a:hlinkClick` to write.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkXml {
    /// `r:id` (empty for relative jumps).
    pub rid: String,
    pub action: Option<String>,
    pub tooltip: Option<String>,
}

/// Where the writers get relationship ids for links.
pub trait LinkSink {
    /// The XML of `link`; `None` drops it (e.g. a jump to a slide that
    /// does not exist).
    fn link(&mut self, link: &Hyperlink) -> Option<LinkXml>;
}

/// Drops every link (parts that cannot hold any).
#[cfg_attr(not(test), allow(dead_code))]
pub struct NoLinks;

impl LinkSink for NoLinks {
    fn link(&mut self, _: &Hyperlink) -> Option<LinkXml> {
        None
    }
}

/// Writes `a:hlinkClick`.
pub fn write_hlink(x: &mut XmlOut, l: &LinkXml) {
    let mut attrs: Vec<(&str, &str)> = vec![("r:id", &l.rid)];
    if let Some(a) = &l.action {
        attrs.push(("action", a));
    }
    if let Some(t) = &l.tooltip {
        attrs.push(("tooltip", t));
    }
    x.empty("a:hlinkClick", &attrs);
}

/// Links of one part: external hyperlink and slide relationships are
/// added to `rels` (one per distinct target).
pub struct PartLinks<'a> {
    pub rels: &'a mut Relationships,
    /// Slide id → 1-based slide part number.
    pub slide_number: &'a dyn Fn(NodeId) -> Option<usize>,
    /// Relative path of the slides folder from this part (`""` for
    /// slides, `"../slides/"` for masters and layouts).
    pub slides_dir: &'a str,
    pub cache: &'a mut HashMap<String, String>,
}

impl LinkSink for PartLinks<'_> {
    fn link(&mut self, link: &Hyperlink) -> Option<LinkXml> {
        let mut rel_id = |kind: &str, target: String, mode: TargetMode| {
            let key = format!("{kind} {target}");
            if let Some(r) = self.cache.get(&key) {
                return r.clone();
            }
            let id = self.rels.add_with_mode(kind, target, mode).id.clone();
            self.cache.insert(key, id.clone());
            id
        };
        let (rid, action) = match &link.target {
            LinkTarget::Url(u) if u.trim().is_empty() => return None,
            LinkTarget::Url(u) => (
                rel_id(rel::HYPERLINK, u.clone(), TargetMode::External),
                None,
            ),
            LinkTarget::Slide(SlideRef::Id(id)) => {
                let n = (self.slide_number)(*id)?;
                (
                    rel_id(
                        rel::SLIDE,
                        format!("{}slide{n}.xml", self.slides_dir),
                        TargetMode::Internal,
                    ),
                    Some(SLIDE_JUMP.to_owned()),
                )
            }
            LinkTarget::Slide(r) => (
                String::new(),
                Some(format!(
                    "{SHOW_JUMP}{}",
                    r.jump_name().unwrap_or("nextslide")
                )),
            ),
            LinkTarget::EndShow => (String::new(), Some(format!("{SHOW_JUMP}endshow"))),
            LinkTarget::CustomShow { id, return_after } => (
                String::new(),
                Some(if *return_after {
                    format!("{CUSTOM_SHOW}id={id}&return=true")
                } else {
                    format!("{CUSTOM_SHOW}id={id}")
                }),
            ),
        };
        Some(LinkXml {
            rid,
            action,
            tooltip: link.tooltip.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    fn hl(xml: &str) -> Option<Hyperlink> {
        let el = parse(xml.as_bytes(), "t").unwrap();
        read_hlink(&el, &mut Warnings::default())
    }

    #[test]
    fn reads_actions() {
        let x =
            |a: &str| format!(r#"<a:hlinkClick xmlns:a="a" xmlns:r="r" r:id="" action="{a}"/>"#);
        assert_eq!(
            hl(&x("ppaction://hlinkshowjump?jump=nextslide")),
            Some(Hyperlink::slide(SlideRef::Next))
        );
        assert_eq!(
            hl(&x("ppaction://hlinkshowjump?jump=endshow"))
                .unwrap()
                .target,
            LinkTarget::EndShow
        );
        assert_eq!(hl(&x("ppaction://media")), None);
        assert_eq!(
            hl(&x("ppaction://customshow?id=3&amp;return=true")).map(|h| h.target),
            Some(LinkTarget::CustomShow {
                id: 3,
                return_after: true
            })
        );
        assert_eq!(
            hl(&x("ppaction://customshow?id=0")).map(|h| h.target),
            Some(LinkTarget::CustomShow {
                id: 0,
                return_after: false
            })
        );
        assert_eq!(hl(&x("ppaction://program")), None);
        let url = hl(r#"<a:hlinkClick xmlns:r="r" r:id="rId4" tooltip="Tip"/>"#).unwrap();
        assert_eq!(url.tooltip.as_deref(), Some("Tip"));
        let mut shapes = vec![Shape::text_box(model_show::Transform::default(), "x")];
        shapes[0].click_action = Some(url);
        let mut w = Warnings::default();
        resolve_part_links(
            &mut shapes,
            &|rid| (rid == "rId4").then(|| ("hyperlink".into(), "https://a.example/".into(), true)),
            &mut w,
        );
        assert_eq!(
            shapes[0].click_action.as_ref().unwrap().target,
            LinkTarget::Url("https://a.example/".into())
        );
    }

    #[test]
    fn writes_relationships_once() {
        let mut rels = Relationships::new();
        let mut cache = HashMap::new();
        let number = |id: NodeId| (id == NodeId(5)).then_some(2);
        let mut sink = PartLinks {
            rels: &mut rels,
            slide_number: &number,
            slides_dir: "",
            cache: &mut cache,
        };
        let a = sink.link(&Hyperlink::url("https://x.example")).unwrap();
        let b = sink.link(&Hyperlink::url("https://x.example")).unwrap();
        assert_eq!(a, b);
        let s = sink
            .link(&Hyperlink::slide(SlideRef::Id(NodeId(5))))
            .unwrap();
        assert_eq!(s.action.as_deref(), Some(SLIDE_JUMP));
        assert!(sink
            .link(&Hyperlink::slide(SlideRef::Id(NodeId(6))))
            .is_none());
        let n = sink.link(&Hyperlink::slide(SlideRef::Previous)).unwrap();
        assert_eq!(n.rid, "");
        assert_eq!(
            n.action.as_deref(),
            Some("ppaction://hlinkshowjump?jump=previousslide")
        );
        assert_eq!(rels.len(), 2);
        assert_eq!(rels.get(&a.rid).unwrap().target_mode, TargetMode::External);
        assert_eq!(rels.get(&s.rid).unwrap().target, "slide2.xml");
    }
}
