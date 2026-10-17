//! `ppt/viewProps.xml` (guides, grid, snapping, last view) and
//! `ppt/presProps.xml` (Set Up Slide Show) ↔ [`ViewProps`] /
//! [`ShowSettings`].
//!
//! Guide positions are written in PowerPoint's unit, 1/8 pt (1587.5 EMU).
//! What PresentationML has no attribute for (grid and ruler display,
//! smart guides, guide colours, Reading View) goes into a Rusuite
//! extension of `p:viewPr` that other readers ignore.

use model_show::{
    Emu, Guide, GuideOrient, ShowSettings, ShowType, SlideRange, ViewKind, ViewProps,
};

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
    x.empty("p:restoredLeft", &[("sz", &v.restored_left.to_string())]);
    x.empty("p:restoredTop", &[("sz", &v.restored_top.to_string())]);
    x.end("p:normalViewPr");
    x.start("p:slideViewPr", &[]);
    let mut c = vec![("snapToGrid", flag(v.snap_to_grid))];
    if v.show_guides {
        c.push(("showGuides", "1"));
    }
    x.start("p:cSldViewPr", &c);
    // fit (`varScale`) or a fixed zoom
    let zoom = v.zoom.unwrap_or(100).to_string();
    let c_view: &[(&str, &str)] = if v.zoom.is_none() {
        &[("varScale", "1")]
    } else {
        &[]
    };
    x.start("p:cViewPr", c_view);
    write_scale(&mut x, &zoom);
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
    x.start("p:sorterViewPr", &[]);
    x.start("p:cViewPr", &[]);
    write_scale(&mut x, &v.sorter_zoom.to_string());
    x.empty("p:origin", &[("x", "0"), ("y", "0")]);
    x.end("p:cViewPr");
    x.end("p:sorterViewPr");
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

/// `p:scale` of `n` %.
fn write_scale(x: &mut XmlOut, n: &str) {
    x.start("p:scale", &[]);
    x.empty("a:sx", &[("n", n), ("d", "100")]);
    x.empty("a:sy", &[("n", n), ("d", "100")]);
    x.end("p:scale");
}

/// The zoom in % of a `p:cViewPr` (`a:sx n/d`), clamped to 10…400.
fn read_scale(c_view: Option<&El>) -> Option<u32> {
    let sx = c_view?.child("scale")?.child("sx")?;
    let n = sx.attr("n").and_then(parse_i64)?;
    let d = sx.attr("d").and_then(parse_i64).filter(|d| *d > 0)?;
    Some(((n * 100 + d / 2) / d).clamp(10, 400) as u32)
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
    if let Some(n) = root.child("normalViewPr") {
        let sz = |name: &str| {
            n.child(name)
                .and_then(|e| e.attr("sz"))
                .and_then(parse_i64)
                .map(|v| v.clamp(0, 100_000) as u32)
        };
        v.restored_left = sz("restoredLeft").unwrap_or(ViewProps::DEFAULT_LEFT);
        v.restored_top = sz("restoredTop").unwrap_or(ViewProps::DEFAULT_TOP);
    }
    if let Some(z) = read_scale(root.child("sorterViewPr").and_then(|s| s.child("cViewPr"))) {
        v.sorter_zoom = z;
    }
    if let Some(c) = root
        .child("slideViewPr")
        .and_then(|s| s.child("cSldViewPr"))
    {
        let c_view = c.child("cViewPr");
        let var = c_view.and_then(|c| c.attr("varScale")).and_then(parse_bool) == Some(true);
        v.zoom = if var { None } else { read_scale(c_view) };
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

/// PowerPoint 2012 main namespace (`p15:`).
pub const NS_P15: &str = "http://schemas.microsoft.com/office/powerpoint/2012/main";
/// `p:ext/@uri` of the guides of a slide master (`p15:sldGuideLst`).
pub const MASTER_GUIDES_URI: &str = "{27BBF7A9-308A-43DC-89C8-2F10F3537804}";
/// `p:ext/@uri` of the guides of a slide layout (`p15:sldGuideLst`).
pub const LAYOUT_GUIDES_URI: &str = "{DCECCB84-F9BA-43D5-87BE-67443E8EF086}";
/// `p:ext/@uri` of the notes page guides in `presentation.xml`
/// (`p15:notesGuideLst`).
pub const NOTES_GUIDES_URI: &str = "{2D200454-40CA-4A62-9FC3-DE9A4176ACB9}";
/// The colour PowerPoint gives master and layout guides (`None` in the
/// model).
pub const DESIGN_GUIDE_COLOR: &str = "FBAE40";

/// Writes `p:ext uri=… / p15:<list>` with `guides` (nothing when empty);
/// the caller has opened `p:extLst`.
pub fn write_p15_guides(x: &mut XmlOut, uri: &str, list: &str, guides: &[Guide]) {
    if guides.is_empty() {
        return;
    }
    x.start("p:ext", &[("uri", uri)]);
    x.start(list, &[("xmlns:p15", NS_P15)]);
    for (i, g) in guides.iter().enumerate() {
        let id = (i + 1).to_string();
        let pos = guide_units(g.pos).to_string();
        let mut attrs = vec![("id", id.as_str())];
        if g.orient == GuideOrient::Horizontal {
            attrs.push(("orient", "horz"));
        }
        attrs.push(("pos", &pos));
        attrs.push(("userDrawn", "1"));
        x.start("p15:guide", &attrs);
        x.start("p15:clr", &[]);
        x.empty(
            "a:srgbClr",
            &[("val", g.color.as_deref().unwrap_or(DESIGN_GUIDE_COLOR))],
        );
        x.end("p15:clr");
        x.end("p15:guide");
    }
    x.end(list);
    x.end("p:ext");
}

/// The guides of a `p15:sldGuideLst` / `p15:notesGuideLst` (`list`, local
/// name) in an `p:extLst` of `parent` (any `p:ext`); PowerPoint's guide
/// colour reads as the default.
pub fn read_p15_guides(parent: &El, list: &str) -> Vec<Guide> {
    let Some(l) = parent
        .child("extLst")
        .into_iter()
        .flat_map(|e| e.elements())
        .filter(|e| e.name == "ext")
        .find_map(|e| e.child(list))
    else {
        return Vec::new();
    };
    l.elements()
        .filter(|e| e.name == "guide")
        .map(|g| Guide {
            orient: if g.attr("orient") == Some("horz") {
                GuideOrient::Horizontal
            } else {
                GuideOrient::Vertical
            },
            pos: guide_emu(g.attr("pos").and_then(parse_i64).unwrap_or(0)),
            color: g
                .child("clr")
                .and_then(|c| c.child("srgbClr"))
                .and_then(|c| c.attr("val"))
                .map(str::to_ascii_uppercase)
                .filter(|v| model_show::view::is_rrggbb(v) && v != DESIGN_GUIDE_COLOR),
        })
        .collect()
}

/// `p:ext/@uri` of `p14:showMediaCtrls` (Slide Show › Show Media Controls).
pub const MEDIA_CONTROLS_URI: &str = "{2FDB2607-1784-4EEB-B798-7EB5836EED8A}";

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
    match s.show_type {
        ShowType::Speaker => x.empty("p:present", &[]),
        ShowType::Window => x.empty("p:browse", &[("showScrollbar", flag(s.show_scrollbar))]),
        ShowType::Kiosk => x.empty("p:kiosk", &[]),
    }
    match (s.custom_show, s.range) {
        (Some(id), _) => x.empty("p:custShow", &[("id", &id.to_string())]),
        (None, Some(r)) => {
            let (st, end) = (r.start.to_string(), r.end.to_string());
            x.empty("p:sldRg", &[("st", &st), ("end", &end)]);
        }
        (None, None) => x.empty("p:sldAll", &[]),
    }
    if let Some(c) = &s.pen_color {
        x.start("p:penClr", &[]);
        x.empty("a:srgbClr", &[("val", c)]);
        x.end("p:penClr");
    }
    if !s.show_media_controls {
        x.start("p:extLst", &[]);
        x.start("p:ext", &[("uri", MEDIA_CONTROLS_URI)]);
        x.empty(
            "p14:showMediaCtrls",
            &[("xmlns:p14", crate::parts::NS_P14), ("val", "0")],
        );
        x.end("p:ext");
        x.end("p:extLst");
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
        show_type: if sp.child("kiosk").is_some() {
            ShowType::Kiosk
        } else if sp.child("browse").is_some() {
            ShowType::Window
        } else {
            ShowType::Speaker
        },
        show_scrollbar: sp
            .child("browse")
            .and_then(|b| b.attr("showScrollbar"))
            .and_then(parse_bool)
            .unwrap_or(true),
        custom_show: sp
            .child("custShow")
            .and_then(|c| c.attr("id"))
            .and_then(parse_u32),
        pen_color: sp
            .child("penClr")
            .and_then(|c| c.child("srgbClr").or_else(|| c.child("prstClr")))
            .and_then(|c| match c.name.as_str() {
                "srgbClr" => c.attr("val").map(str::to_ascii_uppercase),
                _ => preset_rgb(c.attr("val")?),
            })
            .filter(|v| model_show::view::is_rrggbb(v)),
        show_media_controls: sp
            .child("extLst")
            .into_iter()
            .flat_map(|l| l.elements())
            .filter_map(|e| e.child("showMediaCtrls"))
            .find_map(|c| c.attr("val").and_then(parse_bool))
            .unwrap_or(true),
    }
}

/// `RRGGBB` of the preset colours PowerPoint writes for pens.
fn preset_rgb(name: &str) -> Option<String> {
    Some(
        match name {
            "red" => "FF0000",
            "black" => "000000",
            "white" => "FFFFFF",
            "blue" => "0000FF",
            "green" => "008000",
            "yellow" => "FFFF00",
            _ => return None,
        }
        .to_owned(),
    )
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
            zoom: Some(150),
            sorter_zoom: 120,
            restored_left: 21_000,
            restored_top: 80_000,
            notes_guides: Vec::new(),
        };
        let xml = view_props_xml(&v);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(
            text.contains(r#"<p:guide orient="horz" pos="2160"/>"#),
            "{text}"
        );
        assert!(text.contains(r#"lastView="sldSorterView""#));
        assert!(text.contains(r#"<p:restoredLeft sz="21000"/>"#), "{text}");
        assert!(
            text.contains(r#"<p:cViewPr><p:scale><a:sx n="150" d="100"/>"#),
            "{text}"
        );
        assert!(
            text.contains(r#"<p:sorterViewPr><p:cViewPr><p:scale><a:sx n="120" d="100"/>"#),
            "{text}"
        );
        let back = read_view_props(&parse(&xml, "viewProps").unwrap());
        assert_eq!(back, v);
        // fit: varScale, the scale is ignored on reading
        let fit = String::from_utf8(view_props_xml(&ViewProps::default())).unwrap();
        assert!(fit.contains(r#"<p:cViewPr varScale="1">"#), "{fit}");
        let reading = ViewProps {
            last_view: ViewKind::Reading,
            ..ViewProps::default()
        };
        let back = read_view_props(&parse(&view_props_xml(&reading), "v").unwrap());
        assert_eq!(back, reading);
    }

    #[test]
    fn p15_guides_roundtrip() {
        let guides = vec![
            Guide {
                orient: GuideOrient::Horizontal,
                pos: Emu(3_429_000),
                color: None,
            },
            Guide {
                orient: GuideOrient::Vertical,
                pos: Emu(914_400),
                color: Some("00B050".into()),
            },
        ];
        let mut x = XmlOut::new();
        x.start("p:sldLayout", &ROOT_NS);
        x.start("p:extLst", &[]);
        write_p15_guides(&mut x, LAYOUT_GUIDES_URI, "p15:sldGuideLst", &guides);
        x.end("p:extLst");
        x.end("p:sldLayout");
        let xml = x.finish();
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(
            text.contains(r#"<p15:guide id="1" orient="horz" pos="2160" userDrawn="1"><p15:clr><a:srgbClr val="FBAE40"/></p15:clr></p15:guide>"#),
            "{text}"
        );
        let back = read_p15_guides(&parse(&xml, "l").unwrap(), "sldGuideLst");
        assert_eq!(back, guides);
        assert!(read_p15_guides(&parse(&xml, "l").unwrap(), "notesGuideLst").is_empty());
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
    fn show_pr_toggles_media_controls_narration_timings() {
        // Slide Show › Play Narrations / Use Timings / Show Media Controls (P9-S5)
        let s = ShowSettings {
            without_narration: true,
            use_timings: false,
            show_media_controls: false,
            ..ShowSettings::default()
        };
        let xml = pres_props_xml(&s);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(
            text.contains(r#"<p:showPr showNarration="0" useTimings="0">"#),
            "{text}"
        );
        assert!(
            text.contains(r#"<p:extLst><p:ext uri="{2FDB2607-1784-4EEB-B798-7EB5836EED8A}"><p14:showMediaCtrls xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="0"/></p:ext></p:extLst></p:showPr>"#),
            "{text}"
        );
        assert_eq!(read_pres_props(&parse(&xml, "p").unwrap()), s);
        // PowerPoint's file: controls on (written as val="1"), absent = on
        let ppt = br#"<p:presentationPr xmlns:p="p" xmlns:a="a" xmlns:p14="x"><p:showPr showNarration="1"><p:present/><p:sldAll/><p:extLst><p:ext uri="{EC167BDD-8182-4AB7-AECC-EB403E3ABB37}"><p14:laserClr><a:srgbClr val="FF0000"/></p14:laserClr></p:ext><p:ext uri="{2FDB2607-1784-4EEB-B798-7EB5836EED8A}"><p14:showMediaCtrls val="1"/></p:ext></p:extLst></p:showPr></p:presentationPr>"#;
        let read = read_pres_props(&parse(ppt, "p").unwrap());
        assert!(read.show_media_controls);
        assert!(!read.without_narration);
        let off = String::from_utf8_lossy(ppt)
            .replace(r#"showMediaCtrls val="1""#, r#"showMediaCtrls val="0""#)
            .into_bytes();
        assert!(!read_pres_props(&parse(&off, "p").unwrap()).show_media_controls);
        assert!(!String::from_utf8(pres_props_xml(&ShowSettings::default()))
            .unwrap()
            .contains("showMediaCtrls"));
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
            ..ShowSettings::default()
        };
        let xml = pres_props_xml(&s);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(text.contains(r#"<p:sldRg st="2" end="4"/>"#), "{text}");
        assert_eq!(read_pres_props(&parse(&xml, "p").unwrap()), s);
        let kiosk = ShowSettings {
            show_type: ShowType::Kiosk,
            custom_show: Some(2),
            pen_color: Some("00B050".into()),
            ..ShowSettings::default()
        };
        let xml = pres_props_xml(&kiosk);
        let text = String::from_utf8(xml.clone()).unwrap();
        assert!(
            text.contains(
                r#"<p:kiosk/><p:custShow id="2"/><p:penClr><a:srgbClr val="00B050"/></p:penClr>"#
            ),
            "{text}"
        );
        assert_eq!(read_pres_props(&parse(&xml, "p").unwrap()), kiosk);
        let window = ShowSettings {
            show_type: ShowType::Window,
            show_scrollbar: false,
            ..ShowSettings::default()
        };
        assert_eq!(
            read_pres_props(&parse(&pres_props_xml(&window), "p").unwrap()),
            window
        );
        let ppt = br#"<p:presentationPr xmlns:p="p" xmlns:a="a"><p:showPr showNarration="1"><p:present/><p:sldAll/><p:penClr><a:prstClr val="red"/></p:penClr></p:showPr></p:presentationPr>"#;
        assert_eq!(
            read_pres_props(&parse(ppt, "p").unwrap())
                .pen_color
                .as_deref(),
            Some("FF0000")
        );
        let none = parse(br#"<p:presentationPr xmlns:p="p"/>"#, "p").unwrap();
        assert_eq!(read_pres_props(&none), ShowSettings::default());
    }
}
