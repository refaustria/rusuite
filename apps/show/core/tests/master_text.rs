//! P9-S1 master and layout text: outline levels 2–9 of layout
//! placeholders (their own `a:lstStyle` levels), level margins (`marL`,
//! `indent`), chart and table placeholders – each command with its
//! undo/redo identity and `.pptx` round trip.

use app_common::Host;
use core_model::{Color, FontSize, RunProperties, ThemeColorSlot};
use model_show::{
    Bullet, Emu, LayoutKind, PlaceholderKind, Presentation, TextClass, TextParagraph, Transform,
};
use serde_json::Value as Json;
use show_core::{
    DesignTarget, PlaceholderPatch, ShowCommand as C, ShowDocument, ShowHost, TextParagraphPatch,
};

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

fn pres(h: &ShowHost) -> &Presentation {
    h.doc().presentation()
}

/// Applies `cmd`, checks undo and redo, leaves it applied.
fn apply(h: &mut ShowHost, cmd: C) {
    let before = json_of(h);
    h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
}

fn err_code(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before);
    e.code()
}

/// Title slide (1), Title and Content (4: title 5, body 6).
fn host() -> ShowHost {
    let mut p = Presentation::new();
    p.add_slide(LayoutKind::TitleContent);
    Host::new(ShowDocument::from_presentation(p).unwrap())
}

fn roundtrip(h: &ShowHost) -> Presentation {
    let bytes = h.doc().save_pptx().unwrap();
    let (p, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    p
}

const TC: LayoutKind = LayoutKind::TitleContent;

fn red() -> Color {
    Color::theme(ThemeColorSlot::Accent2)
}

fn layout_body_level(h: &mut ShowHost, level: u8, patch: PlaceholderPatch) {
    apply(
        h,
        C::SetMasterPlaceholderProps {
            target: DesignTarget::Layout(TC),
            placeholder: PlaceholderKind::Body,
            idx: None,
            patch: PlaceholderPatch {
                level: Some(level),
                ..patch
            },
        },
    );
}

#[test]
fn layout_placeholder_levels_2_to_9() {
    let mut h = host();
    // level 3 of the layout's body: red, 20 pt, a dash bullet
    layout_body_level(
        &mut h,
        2,
        PlaceholderPatch {
            run: Some(RunProperties {
                color: Some(red()),
                size: Some(FontSize::from_pt(20.0)),
                ..RunProperties::default()
            }),
            paragraph: Some(TextParagraphPatch {
                bullet: Some(Some(Bullet::Char("–".into()))),
                ..TextParagraphPatch::default()
            }),
            ..PlaceholderPatch::default()
        },
    );
    let p = pres(&h);
    let def = &p.layout(&TC).unwrap().placeholders[1];
    assert_eq!(def.levels.len(), 2, "levels 2 and 3 stored, 2 empty");
    assert!(def.levels[0].is_empty());
    assert_eq!(def.level_override(2).unwrap().run.color, Some(red()));
    // level 1 is untouched
    assert_ne!(def.run_defaults.color, Some(red()));
    // the slide's level-3 paragraphs resolve to it, level 2 to the master's
    let slide = &p.slides[1];
    let body = &slide.shapes[1];
    let (para, run) = p.resolve_level(slide, body, 2);
    assert_eq!(run.color, Some(red()));
    assert_eq!(run.size, Some(FontSize::from_pt(20.0)));
    assert_eq!(para.bullet, Some(Bullet::Char("–".into())));
    let (_, r1) = p.resolve_level(slide, body, 1);
    assert_eq!(r1.size, Some(FontSize::from_pt(24.0)));
    // written as the layout placeholder's lvl3pPr, read back unchanged
    let back = roundtrip(&h);
    let bdef = &back.layout(&TC).unwrap().placeholders[1];
    assert_eq!(bdef.levels, def.levels);
    assert_eq!(back.master, p.master);
}

#[test]
fn master_placeholder_levels_go_to_the_text_style() {
    let mut h = host();
    apply(
        &mut h,
        C::SetMasterPlaceholderProps {
            target: DesignTarget::Master,
            placeholder: PlaceholderKind::Body,
            idx: None,
            patch: PlaceholderPatch {
                level: Some(4),
                run: Some(RunProperties {
                    bold: Some(true),
                    ..RunProperties::default()
                }),
                ..PlaceholderPatch::default()
            },
        },
    );
    let p = pres(&h);
    assert_eq!(
        p.master.text_styles.level(TextClass::Body, 4).run.bold,
        Some(true)
    );
    assert!(p.master.placeholders[1].levels.is_empty());
    // a level and a new box in one command: one undo step
    let moved = tr(838_200, 2_000_000, 10_515_600, 4_000_000);
    apply(
        &mut h,
        C::SetMasterPlaceholderProps {
            target: DesignTarget::Master,
            placeholder: PlaceholderKind::Body,
            idx: None,
            patch: PlaceholderPatch {
                level: Some(1),
                transform: Some(moved),
                run: Some(RunProperties {
                    italic: Some(true),
                    ..RunProperties::default()
                }),
                ..PlaceholderPatch::default()
            },
        },
    );
    let p = pres(&h);
    assert_eq!(p.master.placeholders[1].transform, moved);
    assert_eq!(
        p.master.text_styles.level(TextClass::Body, 1).run.italic,
        Some(true)
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetMasterPlaceholderProps {
                target: DesignTarget::Master,
                placeholder: PlaceholderKind::Body,
                idx: None,
                patch: PlaceholderPatch {
                    level: Some(9),
                    ..PlaceholderPatch::default()
                },
            }
        ),
        "invalid_command"
    );
}

#[test]
fn level_margins() {
    let mut h = host();
    // master text style: level 2 of the body 1" in, 0.3" hanging
    apply(
        &mut h,
        C::SetMasterTextStyle {
            which: TextClass::Body,
            level: 1,
            run: None,
            paragraph: None,
            margin_left: Some(Emu(914_400)),
            indent: Some(Emu(-274_320)),
        },
    );
    let l = pres(&h).master.text_styles.level(TextClass::Body, 1);
    assert_eq!(
        (l.margin_left, l.indent),
        (Some(Emu(914_400)), Some(Emu(-274_320)))
    );
    // level 1 through the master placeholder: the text style's margins
    apply(
        &mut h,
        C::SetMasterTextStyle {
            which: TextClass::Body,
            level: 0,
            run: None,
            paragraph: None,
            margin_left: Some(Emu(342_900)),
            indent: None,
        },
    );
    assert_eq!(
        pres(&h).master.text_styles.body[0].margin_left,
        Some(Emu(342_900))
    );
    // a layout's level 4 margins
    layout_body_level(
        &mut h,
        3,
        PlaceholderPatch {
            margin_left: Some(Emu(2_000_000)),
            indent: Some(Emu(-200_000)),
            ..PlaceholderPatch::default()
        },
    );
    let p = pres(&h);
    let slide = &p.slides[1];
    let st = p.resolve_level_style(slide, &slide.shapes[1], 3);
    assert_eq!(
        (st.margin_left, st.indent),
        (Some(Emu(2_000_000)), Some(Emu(-200_000)))
    );
    let st1 = p.resolve_level_style(slide, &slide.shapes[1], 1);
    assert_eq!(st1.margin_left, Some(Emu(914_400)));
    let back = roundtrip(&h);
    assert_eq!(back.master.text_styles, p.master.text_styles);
    assert_eq!(
        back.layout(&TC).unwrap().placeholders[1].levels,
        p.layout(&TC).unwrap().placeholders[1].levels
    );
    // level 1 margins of a layout placeholder are the master's; out of range
    for patch in [
        PlaceholderPatch {
            margin_left: Some(Emu(1)),
            ..PlaceholderPatch::default()
        },
        PlaceholderPatch {
            level: Some(2),
            margin_left: Some(Emu(-5)),
            ..PlaceholderPatch::default()
        },
        PlaceholderPatch {
            level: Some(2),
            indent: Some(Emu(60_000_000)),
            ..PlaceholderPatch::default()
        },
    ] {
        assert_eq!(
            err_code(
                &mut h,
                C::SetMasterPlaceholderProps {
                    target: DesignTarget::Layout(TC),
                    placeholder: PlaceholderKind::Body,
                    idx: None,
                    patch,
                }
            ),
            "invalid_command"
        );
    }
}

#[test]
fn chart_and_table_placeholders() {
    let mut h = host();
    let custom = LayoutKind::Custom("Data".into());
    apply(
        &mut h,
        C::AddLayout {
            name: "Data".into(),
        },
    );
    for (kind, at) in [
        (
            PlaceholderKind::Chart,
            tr(500_000, 1_800_000, 5_000_000, 4_000_000),
        ),
        (
            PlaceholderKind::Table,
            tr(6_000_000, 1_800_000, 5_000_000, 4_000_000),
        ),
    ] {
        apply(
            &mut h,
            C::AddPlaceholder {
                target: DesignTarget::Layout(custom.clone()),
                kind,
                transform: at,
            },
        );
    }
    let l = pres(&h).layout(&custom).unwrap();
    let kinds: Vec<_> = l.placeholders.iter().map(|d| (d.kind, d.idx)).collect();
    assert!(kinds.contains(&(PlaceholderKind::Chart, 13)), "{kinds:?}");
    assert!(kinds.contains(&(PlaceholderKind::Table, 14)), "{kinds:?}");
    // body text defaults (level 1 of the body style), the content class
    let chart = l.find(PlaceholderKind::Chart, Some(13)).unwrap();
    assert_eq!(chart.run_defaults.size, Some(FontSize::from_pt(28.0)));
    assert!(PlaceholderKind::Chart.same_class(PlaceholderKind::Body));
    // written as type="chart" / type="tbl", read back as such
    let bytes = h.doc().save_pptx().unwrap();
    let xml = layout_xml(&bytes, "Data");
    assert!(xml.contains(r#"<p:ph type="chart" idx="13"/>"#), "{xml}");
    assert!(xml.contains(r#"<p:ph type="tbl" idx="14"/>"#), "{xml}");
    assert!(xml.contains("Click icon to add chart"), "{xml}");
    let back = roundtrip(&h);
    assert_eq!(
        back.layout(&custom).unwrap(),
        pres(&h).layout(&custom).unwrap()
    );
    // the master takes none; removing one
    assert_eq!(
        err_code(
            &mut h,
            C::AddPlaceholder {
                target: DesignTarget::Master,
                kind: PlaceholderKind::Table,
                transform: tr(0, 0, 100, 100),
            }
        ),
        "invalid_command"
    );
    apply(
        &mut h,
        C::RemovePlaceholder {
            target: DesignTarget::Layout(custom.clone()),
            placeholder: PlaceholderKind::Chart,
            idx: Some(13),
        },
    );
    assert!(!pres(&h)
        .layout(&custom)
        .unwrap()
        .placeholders
        .iter()
        .any(|d| d.kind == PlaceholderKind::Chart));
    // rename the layout: its kind follows the name
    apply(
        &mut h,
        C::RenameLayout {
            layout: custom,
            name: "Numbers".into(),
        },
    );
    assert!(pres(&h)
        .layout(&LayoutKind::Custom("Numbers".into()))
        .is_some());
}

#[test]
fn master_text_change_reaches_slides() {
    let mut h = host();
    // slide 4's title: no own colour
    apply(
        &mut h,
        C::SetMasterPlaceholderProps {
            target: DesignTarget::Master,
            placeholder: PlaceholderKind::Title,
            idx: None,
            patch: PlaceholderPatch {
                run: Some(RunProperties {
                    color: Some(red()),
                    ..RunProperties::default()
                }),
                ..PlaceholderPatch::default()
            },
        },
    );
    let p = pres(&h);
    let slide = &p.slides[1];
    let (_, run) = p.resolve_level(slide, &slide.shapes[0], 0);
    assert_eq!(run.color, Some(red()));
    let back = roundtrip(&h);
    let (_, run) = back.resolve_level(&back.slides[1], &back.slides[1].shapes[0], 0);
    assert_eq!(run.color, Some(red()));
    // a line break in a slide's text survives the round trip
    let mut para = TextParagraph::new();
    para.runs.push(model_show::TextRun::new("a\nb"));
    let mut body = back.slides[1].shapes[1].text().unwrap().clone();
    body.paragraphs = vec![para];
    let shape = pres(&h).slides[1].shapes[1].id;
    apply(&mut h, C::SetTextBody { shape, body });
    let back = roundtrip(&h);
    assert_eq!(
        back.slides[1].shapes[1].text().unwrap().paragraphs[0].text(),
        "a\nb"
    );
}

fn layout_xml(bytes: &[u8], name: &str) -> String {
    use std::io::Cursor;
    let pkg = fmt_ooxml::Package::open(Cursor::new(bytes)).unwrap();
    for i in 1..40 {
        let Ok(part) = fmt_ooxml::PartName::new(format!("/ppt/slideLayouts/slideLayout{i}.xml"))
        else {
            continue;
        };
        if let Some(p) = pkg.part(&part) {
            let xml = String::from_utf8(p.data.clone()).unwrap();
            if xml.contains(&format!(r#"<p:cSld name="{name}">"#)) {
                return xml;
            }
        }
    }
    panic!("no layout {name}");
}
