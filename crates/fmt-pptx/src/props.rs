//! `ppt/viewProps.xml` (guides, grid, snapping, last view) and
//! `ppt/presProps.xml` (Set Up Slide Show) ↔ [`ViewProps`] /
//! [`ShowSettings`].
//!
//! Guide positions are written in PowerPoint's unit, 1/8 pt (1587.5 EMU).
//! What PresentationML has no attribute for (grid and ruler display,
//! smart guides, guide colours, Reading View) goes into a Rusuite
//! extension of `p:viewPr` that other readers ignore.

use model_show::{Emu, Guide, GuideOrient, ShowSettings, SlideRange, ViewKind, ViewProps};

use crate::parts::ROOT_NS;
use crate::xml::{parse_bool, parse_i64, parse_u32, El, XmlOut};

/// URI of the Rusuite extension of `p:viewPr`.
pub const VIEW_EXT_URI: &str = "{6F1B7E4C-2A35-4C8E-9D3B-5E2A7C1D4F90}";
/// Namespace of the Rusuite extension elements.
pub const NS_RS: &str = "urn:rusuite:show:view";

/// EMU per 1/8 pt (the unit of `p:guide/@pos`).
const EMU_PER_GUIDE_UNIT: f64 = 12_700.0 / 8.0;

/// `p:guide/@pos` of a guide position.
pub fn guide_units(pos: Emu) -> i64 {
    (pos.0 as f64 / EMU_PER_GUIDE_UNIT).round() as i64
}

/// The guide position of `p:guide/@pos`.
pub fn guide_emu(units: i64) -> Emu {
    Emu((units as f64 * EMU_PER_GUIDE_UNIT).round() as i64)
}

fn last_view_attr(v: ViewKind) -> &'static str {
    match v {
        ViewKind::Normal | ViewKind::Reading => "sldView",
        ViewKind::Outline => "outlineView",
        ViewKind::SlideSorter => "sldSorterView",
        ViewKind::NotesPage => "notesView",
    }
}

const fn flag(b: bool) -> &'static str {
    if b {
        "1"
    } else {
        "0"
    }
}

/// `ppt/viewProps.xml`.
pub fn view_props_xml(v: &ViewProps) -> Vec<u8> {
    let mut x = XmlOut::new();
    let mut root: Vec<(&str, &str)> = ROOT_NS.to_vec();
    if v.last_view != ViewKind::Normal {
        root.push(("lastView", last_view_attr(v.last_view)));
    }
    x.start("p:viewPr", &root);
    x.start("p:normalViewPr", &[]);
    x.empty("p:restoredLeft", &[("sz", "15620")]);
    x.empty("p:restoredTop", &[("sz", "94660")]);
    x.end("p:normalViewPr");
    x.start("p:slideViewPr", &[]);
    let mut c = vec![("snapToGrid", flag(v.snap_to_grid))];
    if v.show_guides {
        c.push(("showGuides", "1"));
    }
    x.start("p:cSldViewPr", &c);
    x.start("p:cViewPr", &[("varScale", "1")]);
    x.start("p:scale", &[]);
    x.empty("a:sx", &[("n", "100"), ("d", "100")]);
    x.empty("a:sy", &[("n", "100"), ("d", "100")]);
    x.end("p:scale");
    x.empty("p:origin", &[("x", "0"), ("y", "0")]);
    x.end("p:cViewPr");
    if v.guides.is_empty() {
        x.empty("p:guideLst", &[]);
    } else {
        x.start("p:guideLst", &[]);
        for g in &v.guides {
            let pos = guide_units(g.pos).to_string();
            match g.orient {
                GuideOrient::Horizontal => x.empty("p:guide", &[("orient", "horz"), ("pos", &pos)]),
                GuideOrient::Vertical => x.empty("p:guide", &[("pos", &pos)]),
            }
        }
        x.end("p:guideLst");
    }
    x.end("p:cSldViewPr");
    x.end("p:slideViewPr");
    let grid = v.grid_spacing.0.to_string();
    x.empty("p:gridSpacing", &[("cx", &grid), ("cy", &grid)]);
    // display settings PresentationML does not store
    x.start("p:extLst", &[]);
    x.start("p:ext", &[("uri", VIEW_EXT_URI)]);
    let mut attrs = vec![
        ("xmlns:rs", NS_RS),
        ("showGrid", flag(v.show_grid)),
        ("showRuler", flag(v.show_ruler)),
        ("smartGuides", flag(v.snap_to_shapes)),
    ];
    if v.last_view == ViewKind::Reading {
        attrs.push(("lastView", "reading"));
    }
    let colored: Vec<(String, &str)> = v
        .guides
        .iter()
        .enumerate()
        .filter_map(|(i, g)| g.color.as_deref().map(|c| (i.to_string(), c)))
        .collect();
    if colored.is_empty() {
        x.empty("rs:view", &attrs);
    } else {
        x.start("rs:view", &attrs);
        for (i, c) in &colored {
            x.empty("rs:guideClr", &[("idx", i), ("val", c)]);
        }
        x.end("rs:view");
    }
    x.end("p:ext");
    x.end("p:extLst");
    x.end("p:viewPr");
    x.finish()
}

/// [`ViewProps`] of a `p:viewPr` root (absent values: PresentationML's
/// defaults, `snapToGrid` on).
pub fn read_view_props(root: &El) -> ViewProps {
    let mut v = ViewProps {
        last_view: match root.attr("lastView") {
            Some("outlineView") => ViewKind::Outline,
            Some("sldSorterView") | Some("sldThumbnailView") => ViewKind::SlideSorter,
            Some("notesView") => ViewKind::NotesPage,
            _ => ViewKind::Normal,
        },
        ..ViewProps::default()
    };
    if let Some(c) = root
        .child("slideViewPr")
        .and_then(|s| s.child("cSldViewPr"))
    {
        v.snap_to_grid = c.attr("snapToGrid").and_then(parse_bool).unwrap_or(true);
        v.show_guides = c.attr("showGuides").and_then(parse_bool).unwrap_or(false);
        if let Some(list) = c.child("guideLst") {
            v.guides = list
                .elements()
                .filter(|e| e.name == "guide")
                .map(|g| Guide {
                    orient: if g.attr("orient") == Some("horz") {
                        GuideOrient::Horizontal
                    } else {
                        GuideOrient::Vertical
                    },
                    pos: guide_emu(g.attr("pos").and_then(parse_i64).unwrap_or(0)),
                    color: None,
                })
                .collect();
        }
    }
    if let Some(cx) = root
        .child("gridSpacing")
        .and_then(|g| g.attr("cx"))
        .and_then(parse_i64)
    {
        v.grid_spacing = Emu(cx.clamp(18_000, 1_800_000));
    }
    let ext = root.child("extLst").and_then(|l| {
        l.elements()
            .find(|e| e.name == "ext" && e.attr("uri") == Some(VIEW_EXT_URI))
    });
    if let Some(rs) = ext.and_then(|e| e.child("view")) {
        v.show_grid = rs.attr("showGrid").and_then(parse_bool).unwrap_or(false);
        v.show_ruler = rs.attr("showRuler").and_then(parse_bool).unwrap_or(false);
        v.snap_to_shapes = rs.attr("smartGuides").and_then(parse_bool).unwrap_or(true);
        if rs.attr("lastView") == Some("reading") {
            v.last_view = ViewKind::Reading;
        }
        for c in rs.elements().filter(|e| e.name == "guideClr") {
            let idx = c.attr("idx").and_then(parse_u32).map(|i| i as usize);
            let val = c
                .attr("val")
                .filter(|s| s.len() == 6 && s.chars().all(|ch| ch.is_ascii_hexdigit()));
            if let (Some(i), Some(val)) = (idx, val) {
                if let Some(g) = v.guides.get_mut(i) {
                    g.color = Some(val.to_ascii_uppercase());
                }
            }
        }
    }
    v
}

/// `ppt/presProps.xml`: `p:showPr` when the settings differ from the
/// defaults.
pub fn pres_props_xml(s: &ShowSettings) -> Vec<u8> {
    let mut x = XmlOut::new();
    if *s == ShowSettings::default() {
        x.empty("p:presentationPr", &ROOT_NS);
        return x.finish();
    }
    x.start("p:presentationPr", &ROOT_NS);
    let mut attrs = Vec::new();
    if s.loop_show {
        attrs.push(("loop", "1"));
    }
    if s.without_narration {
        attrs.push(("showNarration", "0"));
    }
    if s.without_animation {
        attrs.push(("showAnimation", "0"));
    }
    if !s.use_timings {
        attrs.push(("useTimings", "0"));
    }
    x.start("p:showPr", &attrs);
    x.empty("p:present", &[]);
    match s.range {
        Some(r) => {
            let (st, end) = (r.start.to_string(), r.end.to_string());
            x.empty("p:sldRg", &[("st", &st), ("end", &end)]);
        }
        None => x.empty("p:sldAll", &[]),
    }
    x.end("p:showPr");
    x.end("p:presentationPr");
    x.finish()
}

/// [`ShowSettings`] of a `p:presentationPr` root.
pub fn read_pres_props(root: &El) -> ShowSettings {
    let Some(sp) = root.child("showPr") else {
        return ShowSettings::default();
    };
    let b = |name: &str, default: bool| sp.attr(name).and_then(parse_bool).unwrap_or(default);
    ShowSettings {
        loop_show: b("loop", false),
        // PresentationML's default is false ("show narration" off), but
        // PowerPoint writes `showNarration="1"` whenever it is on.
        without_narration: sp.attr("showNarration").and_then(parse_bool) == Some(false),
        without_animation: !b("showAnimation", true),
        use_timings: b("useTimings", true),
        range: sp.child("sldRg").and_then(|r| {
            let st = r.attr("st").and_then(parse_u32)?;
            let end = r.attr("end").and_then(parse_u32)?;
            (st >= 1 && end >= st).then_some(SlideRange { start: st, end })
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    #[test]
    fn guide_units_are_eighth_points() {
        // the centre of a 16:9 slide: 6.667" = 480 pt
        assert_eq!(guide_units(Emu(6_096_000)), 3840);
        assert_eq!(guide_emu(2160), Emu(3_429_000));
    }

    #[test]
    fn view_props_roundtrip() {
        let v = ViewProps {
            guides: vec![
                Guide {
                    orient: GuideOrient::Vertical,
                    pos: Emu(6_096_000),
                    color: None,
                },
                Guide {
                    orient: GuideOrient::Horizontal,
                    pos: Emu(3_429_000),
                    color: Some("FF0000".into()),
                },
            ],
            grid_spacing: Emu(360_000),
            snap_to_grid: true,
            snap_to_shapes: false,
            show_grid: true,
            show_guides: true,
            show_ruler: true,
            last_view: ViewKind::SlideSorter,
        };
        let xml = view_props_xml(&v);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(
            text.contains(r#"<p:guide orient="horz" pos="2160"/>"#),
            "{text}"
        );
        assert!(text.contains(r#"lastView="sldSorterView""#));
        let back = read_view_props(&parse(&xml, "viewProps").unwrap());
        assert_eq!(back, v);
        let reading = ViewProps {
            last_view: ViewKind::Reading,
            ..ViewProps::default()
        };
        let back = read_view_props(&parse(&view_props_xml(&reading), "v").unwrap());
        assert_eq!(back, reading);
    }

    #[test]
    fn powerpoint_view_props() {
        let xml = br#"<p:viewPr xmlns:p="p" xmlns:a="a"><p:slideViewPr><p:cSldViewPr showGuides="1"><p:cViewPr/><p:guideLst><p:guide orient="horz" pos="2160"/><p:guide pos="3840"/></p:guideLst></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>"#;
        let v = read_view_props(&parse(xml, "v").unwrap());
        assert!(v.snap_to_grid, "absent snapToGrid = on");
        assert!(v.show_guides);
        assert_eq!(v.guides.len(), 2);
        assert_eq!(v.guides[1].orient, GuideOrient::Vertical);
        assert_eq!(v.grid_spacing, Emu(72_008));
        assert!(v.snap_to_shapes);
    }

    #[test]
    fn pres_props_roundtrip() {
        let empty = String::from_utf8(pres_props_xml(&ShowSettings::default())).unwrap();
        assert!(!empty.contains("showPr"));
        let s = ShowSettings {
            loop_show: true,
            without_narration: true,
            without_animation: true,
            range: Some(SlideRange { start: 2, end: 4 }),
            use_timings: false,
        };
        let xml = pres_props_xml(&s);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(text.contains(r#"<p:sldRg st="2" end="4"/>"#), "{text}");
        assert_eq!(read_pres_props(&parse(&xml, "p").unwrap()), s);
        let none = parse(br#"<p:presentationPr xmlns:p="p"/>"#, "p").unwrap();
        assert_eq!(read_pres_props(&none), ShowSettings::default());
    }
}
