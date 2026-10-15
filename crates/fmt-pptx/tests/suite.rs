//! Reads the reference decks under `testdata/pptx/`, checks the features
//! listed in `manifest.json` against the model, round-trips every file and
//! snapshots our `slide1.xml` for a few of them plus `slideLayout2.xml`.

mod common;

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::PathBuf;

use core_model::{Color, Rgb, Underline};
use fmt_ooxml::{Package, PartName};
use model_show::{
    Alignment, Anchor, Bullet, Fill, LayoutKind, LineDash, Presentation, Preset, Shape, ShapeKind,
    TextBody,
};

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/pptx")
}

fn load(name: &str) -> Vec<u8> {
    std::fs::read(dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn files() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "pptx"))
        .collect();
    v.sort();
    assert!(v.len() >= 28, "{v:?}");
    v
}

struct Entry {
    file: String,
    features: Vec<String>,
}

fn manifest() -> Vec<Entry> {
    let json: serde_json::Value =
        serde_json::from_slice(&load("manifest.json")).expect("manifest.json");
    json.as_array()
        .unwrap()
        .iter()
        .map(|e| Entry {
            file: e["file"].as_str().unwrap().to_owned(),
            features: e["features"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| f.as_str().unwrap().to_owned())
                .collect(),
        })
        .collect()
}

// --- features ------------------------------------------------------------------

/// All shapes of the presentation, depth-first (groups before children).
fn all_shapes(p: &Presentation) -> Vec<&Shape> {
    fn walk<'a>(shapes: &'a [Shape], out: &mut Vec<&'a Shape>) {
        for s in shapes {
            out.push(s);
            walk(s.children(), out);
        }
    }
    let mut out = Vec::new();
    for slide in &p.slides {
        walk(&slide.shapes, &mut out);
    }
    out
}

fn texts(p: &Presentation) -> Vec<&TextBody> {
    all_shapes(p).into_iter().filter_map(Shape::text).collect()
}

fn is_black(c: &Color) -> bool {
    matches!(c, Color::Auto)
        || *c == Color::Rgb(Rgb::new(0, 0, 0))
        || *c == Color::theme(core_model::ThemeColorSlot::Dark1)
}

/// The features of the manifest vocabulary (`docs/pptx-suite.md`) found in
/// `p`. Counted features carry exact counts (`shape:rect:count=7`).
fn features_of(p: &Presentation) -> BTreeMap<String, usize> {
    let mut f: BTreeMap<String, usize> = BTreeMap::new();
    let mut add = |k: String| *f.entry(k).or_insert(0) += 1;
    add(format!("slides:{}", p.slides.len()));
    let (w, h) = (p.slide_size.width.0 as f64, p.slide_size.height.0 as f64);
    if (w / h - 16.0 / 9.0).abs() < 0.01 {
        add("size:16x9".into());
    }
    if (w / h - 4.0 / 3.0).abs() < 0.01 {
        add("size:4x3".into());
    }
    for slide in &p.slides {
        add(match slide.layout {
            LayoutKind::Title => "layout:title".into(),
            LayoutKind::TitleContent => "layout:titleContent".into(),
            LayoutKind::Blank => "layout:blank".into(),
        });
        if matches!(slide.background, Some(Fill::Solid(_))) {
            add("background:solid".into());
        }
        if let Some(t) = &slide.transition {
            add(format!("transition:{}", camel(&format!("{:?}", t.kind))));
            if t.advance_after_ms.is_some() {
                add("transition:advance".into());
            }
        }
        for a in &slide.animations {
            add(format!(
                "animation:{}:{}",
                camel(&format!("{:?}", a.kind)),
                camel(&format!("{:?}", a.effect))
            ));
        }
    }
    for s in all_shapes(p) {
        match &s.kind {
            ShapeKind::Auto { geometry, .. } => {
                let g = match geometry {
                    Preset::Rect => "rect",
                    Preset::RoundRect => "roundRect",
                    Preset::Ellipse => "ellipse",
                    Preset::Line => "line",
                };
                add(format!("shape:{g}"));
            }
            ShapeKind::Picture { .. } => add("picture".into()),
            ShapeKind::Group { .. } => add("group".into()),
        }
        if s.is_text_box() {
            add("shape:textBox".into());
        }
        if matches!(s.fill, Fill::Solid(_)) && !matches!(s.kind, ShapeKind::Group { .. }) {
            add("fill:solid".into());
        }
        if !s.line.is_none() && s.line.dash != LineDash::Solid {
            add("line:dash".into());
        }
        if s.transform.rotation_deg != 0.0 {
            add("rotation".into());
        }
        if s.transform.flip_h || s.transform.flip_v {
            add("flip".into());
        }
    }
    let mut fonts = std::collections::BTreeSet::new();
    let mut max_level = 0;
    let mut all_text = String::new();
    for body in texts(p) {
        let has_text = !body.is_empty();
        if has_text {
            add(format!(
                "text:anchor:{}",
                match body.props.anchor {
                    Anchor::Top => "top",
                    Anchor::Middle => "middle",
                    Anchor::Bottom => "bottom",
                }
            ));
        }
        let mut sizes = std::collections::BTreeSet::new();
        for para in &body.paragraphs {
            let text = para.text();
            if text.is_empty() {
                continue;
            }
            add(format!(
                "text:align:{}",
                match para.props.alignment.unwrap_or(Alignment::Left) {
                    Alignment::Left => "left",
                    Alignment::Center => "center",
                    Alignment::Right => "right",
                    Alignment::Justify => "justify",
                }
            ));
            match &para.props.bullet {
                Some(Bullet::Char(_)) => max_level = max_level.max(para.props.level + 1),
                Some(Bullet::AutoNum(_)) => {
                    max_level = max_level.max(para.props.level + 1);
                    add("numbered".into());
                }
                _ => {}
            }
            all_text.push_str(&text);
            for r in &para.runs {
                let rp = &r.props;
                if rp.bold == Some(true) {
                    add("text:bold".into());
                }
                if rp.italic == Some(true) {
                    add("text:italic".into());
                }
                if rp.underline.is_some_and(|u| u != Underline::None) {
                    add("text:underline".into());
                }
                if rp.color.as_ref().is_some_and(|c| !is_black(c)) {
                    add("text:color".into());
                }
                if let Some(s) = rp.size {
                    sizes.insert(s);
                }
                if let Some(core_model::FontFace::Named(n)) = &rp.font {
                    fonts.insert(n.clone());
                }
            }
        }
        if sizes.len() > 1 {
            add("text:size".into());
        }
    }
    // emoji (beyond the BMP) and CJK ideographs
    if all_text.chars().any(|c| c > '\u{FFFF}')
        && all_text
            .chars()
            .any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c))
    {
        add("text:unicode".into());
    }
    if fonts.len() > 1 {
        add("text:font".into());
    }
    if max_level > 0 {
        add(format!("bullets:levels={max_level}"));
    }
    f
}

/// `FlyIn` → `flyIn` (the manifest's spelling of enum variants).
fn camel(debug: &str) -> String {
    let mut c = debug.chars();
    c.next()
        .map(|f| f.to_lowercase().chain(c).collect())
        .unwrap_or_default()
}

/// Checks one manifest feature against the found features (and warnings,
/// for presets we read as rectangles).
fn has_feature(found: &BTreeMap<String, usize>, warnings: &[String], feature: &str) -> bool {
    if let Some((key, n)) = feature.rsplit_once(":count=") {
        let n: usize = n.parse().unwrap();
        let count = found.get(key).copied().unwrap_or(0);
        return match key {
            // read as rectangles, reported as warnings
            "shape:rightArrow" => warnings
                .iter()
                .any(|w| w.starts_with("preset geometry rightArrow read as rectangle")),
            // exact counts
            "shape:textBox" | "picture" | "group" => count == n,
            // at least (rect also matches text boxes and placeholders)
            _ => count >= n,
        };
    }
    found.contains_key(feature)
}

#[test]
fn manifest_features_are_found() {
    let mut failures = Vec::new();
    let entries = manifest();
    assert_eq!(entries.len(), 27);
    for e in entries {
        let (p, warnings) = fmt_pptx::read_with_warnings(&load(&e.file)).unwrap();
        let found = features_of(&p);
        for feat in &e.features {
            if !has_feature(&found, &warnings, feat) {
                failures.push(format!("{}: {feat} not found in {found:?}", e.file));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn reference_details() {
    // 17: group of a rectangle and an ellipse, children relative to the group
    let p = fmt_pptx::read(&load("provisional-17-group.pptx")).unwrap();
    let g = &p.slides[0].shapes[0];
    assert_eq!(
        (
            g.transform.x.0,
            g.transform.y.0,
            g.transform.w.0,
            g.transform.h.0
        ),
        (1_800_000, 1_440_000, 6_120_000, 3_240_000)
    );
    let kids: Vec<_> = g
        .children()
        .iter()
        .map(|c| (c.transform.x.0, c.transform.y.0))
        .collect();
    assert_eq!(kids, [(0, 0), (2_520_000, 1_080_000)]);

    // 19: 30° counter-clockwise = 330° clockwise
    let p = fmt_pptx::read(&load("provisional-19-rotation.pptx")).unwrap();
    assert_eq!(p.slides[0].shapes[0].transform.rotation_deg, 330.0);

    // 04: bullet levels and characters
    let p = fmt_pptx::read(&load("provisional-04-bullets-3-levels.pptx")).unwrap();
    let slide = &p.slides[0];
    assert_eq!(slide.layout, LayoutKind::TitleContent);
    let body = slide.shapes[1].text().unwrap();
    assert_eq!(
        slide.shapes[1].placeholder,
        Some(model_show::PlaceholderKind::Body)
    );
    let levels: Vec<u8> = body.paragraphs.iter().map(|p| p.props.level).collect();
    assert_eq!(levels, [0, 1, 2, 2, 1, 0, 1]);
    assert_eq!(
        body.paragraphs[2].props.bullet,
        Some(Bullet::Char("▪".into()))
    );

    // 01/02: title slides use the centered title
    let p = fmt_pptx::read(&load("provisional-02-title-subtitle.pptx")).unwrap();
    assert_eq!(p.slides[0].layout, LayoutKind::Title);
    let kinds: Vec<_> = p.slides[0].shapes.iter().map(|s| s.placeholder).collect();
    assert_eq!(
        kinds,
        [
            Some(model_show::PlaceholderKind::CenteredTitle),
            Some(model_show::PlaceholderKind::Subtitle)
        ]
    );

    // 08: LibreOffice writes lines as p:sp with an empty text body
    let p = fmt_pptx::read(&load("provisional-08-line.pptx")).unwrap();
    let line = &p.slides[0].shapes[0];
    assert!(matches!(
        line.kind,
        ShapeKind::Auto {
            geometry: Preset::Line,
            text: None
        }
    ));
    assert_eq!(line.line.width.0, 54_000);

    // 15/16: pictures share the media store
    let p = fmt_pptx::read(&load("provisional-16-two-images.pptx")).unwrap();
    assert_eq!(p.media.len(), 2);
    assert!(p.media.iter().all(|(_, m)| m.content_type == "image/png"));

    // 26: LibreOffice transitions (durations as LibreOffice writes them)
    use model_show::{AnimationKind, Direction, Effect, TransitionKind, Trigger};
    let (p, warnings) =
        fmt_pptx::read_with_warnings(&load("provisional-26-transitions.pptx")).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let t: Vec<_> = p
        .slides
        .iter()
        .map(|s| {
            let t = s.transition.unwrap();
            (t.kind, t.direction, t.advance_after_ms)
        })
        .collect();
    assert_eq!(
        t,
        [
            (TransitionKind::Fade, None, None),
            (TransitionKind::Push, Some(Direction::Left), None),
            (TransitionKind::Wipe, Some(Direction::Right), Some(3000)),
            (TransitionKind::Cover, Some(Direction::Left), None),
            (TransitionKind::Split, Some(Direction::VerticalIn), None),
        ]
    );

    // 27: animations in play order, targets resolved
    let (p, warnings) =
        fmt_pptx::read_with_warnings(&load("provisional-27-animations.pptx")).unwrap();
    assert_eq!(warnings, ["rounded rectangle corner size dropped"]);
    p.validate().unwrap();
    let s1 = &p.slides[0];
    assert_eq!(s1.animations[0].shape, s1.shapes[0].id);
    assert_eq!(
        (s1.animations[1].trigger, s1.animations[1].duration_ms),
        (Trigger::WithPrevious, 1000)
    );
    let s2 = &p.slides[1];
    let seq: Vec<_> = s2
        .animations
        .iter()
        .map(|a| {
            let shape = s2.shapes.iter().position(|s| s.id == a.shape).unwrap();
            (shape, a.kind, a.effect, a.trigger, a.direction)
        })
        .collect();
    use AnimationKind::*;
    use Trigger::*;
    assert_eq!(
        seq,
        [
            (0, Entrance, Effect::Wipe, OnClick, Some(Direction::Left)),
            (1, Entrance, Effect::Zoom, AfterPrevious, None),
            (2, Entrance, Effect::Appear, OnClick, None),
            (0, Emphasis, Effect::Spin, OnClick, None),
            (1, Emphasis, Effect::GrowShrink, AfterPrevious, None),
            (2, Exit, Effect::Fade, OnClick, None),
            (3, Exit, Effect::FlyIn, WithPrevious, Some(Direction::Right)),
            (1, Exit, Effect::Appear, OnClick, None),
        ]
    );
    assert_eq!(s2.animations[3].duration_ms, 2000);

    // 24: 4:3 slides
    let p = fmt_pptx::read(&load("provisional-24-size-4x3.pptx")).unwrap();
    assert_eq!(p.slide_size, model_show::SlideSize::standard());
}

// --- round trip --------------------------------------------------------------------

#[test]
fn every_file_roundtrips() {
    for f in files() {
        let name = f.file_name().unwrap().to_string_lossy().into_owned();
        let first = fmt_pptx::read_with_context(&std::fs::read(&f).unwrap())
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let bytes = fmt_pptx::write_with_context(&first.presentation, &first.context)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let second = fmt_pptx::read_with_context(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            second.warnings.is_empty(),
            "{name}: our output reads with warnings: {:?}",
            second.warnings
        );
        common::assert_same(&name, &first.presentation, &second.presentation);
        assert_eq!(
            first.context.theme_xml, second.context.theme_xml,
            "{name}: theme part kept"
        );
        // writing is deterministic and a fixpoint
        let again = fmt_pptx::write_with_context(&second.presentation, &second.context).unwrap();
        assert_eq!(again, bytes, "{name}: second write differs");
        // without context the theme is generated from the model and reads the same
        let plain = fmt_pptx::read(&fmt_pptx::write(&first.presentation).unwrap()).unwrap();
        common::assert_same(&format!("{name} (no context)"), &first.presentation, &plain);
    }
}

// --- snapshots --------------------------------------------------------------------

/// Part `part` of `bytes`, re-indented for review.
fn pretty_part(bytes: &[u8], part: &str) -> String {
    use quick_xml::events::Event;
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let xml = &pkg.part(&PartName::new(part).unwrap()).unwrap().data;
    let mut reader = quick_xml::Reader::from_reader(xml.as_slice());
    let mut writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 1);
    loop {
        match reader.read_event().unwrap() {
            Event::Eof => break,
            Event::Decl(_) => {}
            ev => writer.write_event(ev).unwrap(),
        }
    }
    String::from_utf8(writer.into_inner()).unwrap()
}

#[test]
fn slide_xml_snapshots() {
    for (n, file) in [
        ("03", "provisional-03-title-content-3-bullets.pptx"),
        ("11", "provisional-11-fill-colour.pptx"),
        ("17", "provisional-17-group.pptx"),
        ("19", "provisional-19-rotation.pptx"),
    ] {
        let out = fmt_pptx::read_with_context(&load(file)).unwrap();
        let bytes = fmt_pptx::write_with_context(&out.presentation, &out.context).unwrap();
        insta::assert_snapshot!(
            format!("slide1_xml_{n}"),
            pretty_part(&bytes, "/ppt/slides/slide1.xml")
        );
    }
}

#[test]
fn layout_xml_snapshot() {
    let bytes = fmt_pptx::write(&Presentation::new()).unwrap();
    insta::assert_snapshot!(
        "slide_layout2_xml",
        pretty_part(&bytes, "/ppt/slideLayouts/slideLayout2.xml")
    );
}

// --- PowerPoint-style input --------------------------------------------------------

/// A hand-built package in PowerPoint's style: slide placeholders without
/// `a:xfrm` (positions from the layout), shapes styled via `p:style`, a
/// connector, a table, speaker notes.
fn powerpoint_style_package() -> Vec<u8> {
    const P: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
    const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    let tree = |body: &str| {
        format!(
            r#"<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{body}</p:spTree></p:cSld>"#
        )
    };
    let ph_sp = |id: u32, ph: &str, xfrm: &str, text: &str| {
        format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Placeholder {id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr>{xfrm}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"#
        )
    };
    let xfrm = |x: i64, y: i64, w: i64, h: i64| {
        format!(r#"<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>"#)
    };
    let master = format!(
        r#"<p:sldMaster {P}>{}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:sldMaster>"#,
        tree(&format!(
            "{}{}",
            ph_sp(2, r#"<p:ph type="title"/>"#, &xfrm(1, 2, 3, 4), "T"),
            ph_sp(3, r#"<p:ph type="body" idx="1"/>"#, &xfrm(5, 6, 7, 8), "B"),
        ))
    );
    let layout = format!(
        r#"<p:sldLayout {P} type="obj">{}</p:sldLayout>"#,
        tree(&ph_sp(
            2,
            r#"<p:ph type="title"/>"#,
            &xfrm(838_200, 365_125, 10_515_600, 1_325_563),
            "T"
        ))
    );
    let styled = r#"<p:sp><p:nvSpPr><p:cNvPr id="4" name="Oval 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="100"/><a:ext cx="1000" cy="500"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>Styled</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let cxn = r#"<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Straight Connector 4"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="2000" cy="1000"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr></p:cxnSp>"#;
    let table = r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Table 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl/></a:graphicData></a:graphic></p:graphicFrame>"#;
    let slide = format!(
        r#"<p:sld {P}>{}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
        tree(&format!(
            "{}{}{styled}{cxn}{table}",
            ph_sp(2, r#"<p:ph type="title"/>"#, "", "Hello"),
            ph_sp(3, r#"<p:ph idx="1"/>"#, "", "Body text"),
        ))
    );
    let pres = format!(
        r#"<p:presentation {P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>"#
    );
    let ct = |kind: &str| {
        format!("application/vnd.openxmlformats-officedocument.presentationml.{kind}+xml")
    };
    let mut pkg = Package::new();
    let pn = |s: &str| PartName::new(s).unwrap();
    let mut add = |name: &str, kind: &str, xml: String, rels: &[(&str, &str)]| {
        pkg.insert_part(pn(name), ct(kind), xml.into_bytes());
        if !rels.is_empty() {
            let mut r = fmt_ooxml::Relationships::new();
            for (t, target) in rels {
                r.add(format!("{REL}/{t}"), *target);
            }
            pkg.set_relationships(pn(name), r);
        }
    };
    add(
        "/ppt/presentation.xml",
        "presentation.main",
        pres,
        &[
            ("slideMaster", "slideMasters/slideMaster1.xml"),
            ("slide", "slides/slide1.xml"),
        ],
    );
    add(
        "/ppt/slideMasters/slideMaster1.xml",
        "slideMaster",
        master,
        &[("slideLayout", "../slideLayouts/slideLayout2.xml")],
    );
    add(
        "/ppt/slideLayouts/slideLayout2.xml",
        "slideLayout",
        layout,
        &[("slideMaster", "../slideMasters/slideMaster1.xml")],
    );
    add(
        "/ppt/slides/slide1.xml",
        "slide",
        slide,
        &[
            ("slideLayout", "../slideLayouts/slideLayout2.xml"),
            ("notesSlide", "../notesSlides/notesSlide1.xml"),
        ],
    );
    add(
        "/ppt/notesSlides/notesSlide1.xml",
        "notesSlide",
        format!("<p:notes {P}/>"),
        &[],
    );
    pkg.package_relationships_mut()
        .add(fmt_ooxml::OFFICE_DOCUMENT_REL, "ppt/presentation.xml");
    pkg.write(Cursor::new(Vec::new())).unwrap().into_inner()
}

#[test]
fn powerpoint_style_inheritance() {
    use model_show::{Emu, PlaceholderKind};
    let (p, warnings) = fmt_pptx::read_with_warnings(&powerpoint_style_package()).unwrap();
    assert_eq!(warnings, ["tables dropped"]);
    // The (empty) notes part is read: no notes text.
    assert_eq!(p.slides[0].notes, None);
    let slide = &p.slides[0];
    assert_eq!(slide.layout, LayoutKind::TitleContent);
    let [title, body, oval, line] = &slide.shapes[..] else {
        panic!("{:?}", slide.shapes)
    };
    // title: position from the layout; body: from the master (by idx/class)
    assert_eq!(title.placeholder, Some(PlaceholderKind::Title));
    assert_eq!(
        (title.transform.x, title.transform.w),
        (Emu(838_200), Emu(10_515_600))
    );
    assert_eq!(body.placeholder, Some(PlaceholderKind::Body));
    assert_eq!(
        (
            body.transform.x,
            body.transform.y,
            body.transform.w,
            body.transform.h
        ),
        (Emu(5), Emu(6), Emu(7), Emu(8))
    );
    // placeholder body props come from the built-in layout when not given
    assert_eq!(title.text().unwrap().props.anchor, Anchor::Middle);
    assert_eq!(
        title.text().unwrap().props.autofit,
        model_show::Autofit::Shrink
    );
    // style references resolve to explicit fill, outline and text color
    use core_model::ThemeColorSlot as S;
    assert_eq!(oval.fill, Fill::Solid(Color::theme(S::Accent1)));
    assert_eq!(oval.line.width, Emu(12_700));
    assert_eq!(
        oval.text().unwrap().paragraphs[0].runs[0].props.color,
        Some(Color::theme(S::Light1))
    );
    // connector → line shape
    assert!(matches!(
        line.kind,
        ShapeKind::Auto {
            geometry: Preset::Line,
            text: None
        }
    ));
    assert!(line.transform.flip_v);
    assert_eq!(line.line.dash, LineDash::Dash);

    // and our output of it reads back the same, without warnings
    let bytes = fmt_pptx::write(&p).unwrap();
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    common::assert_same("powerpoint style", &p, &back);
}
