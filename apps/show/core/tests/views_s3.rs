//! P9-S3: custom shows, Set Up Slide Show options, backgrounds, guides
//! and the saved view – commands, undo and the `.pptx` round trip.

use app_common::Host;
use model_show::{
    CustomShow, Emu, Hyperlink, LayoutKind, LinkTarget, NodeId, Presentation, Shape, ShowSettings,
    ShowType, Transform,
};
use serde_json::Value as Json;
use show_core::{ShowCommand as C, ShowDocument, ShowHost, ShowPatch};

fn deck() -> Presentation {
    let mut p = Presentation::new();
    for _ in 0..3 {
        let s = p.add_slide(LayoutKind::Blank);
        let t = Transform::new(Emu(0), Emu(0), Emu(914_400), Emu(457_200));
        p.add_shape(s, Shape::text_box(t, "Hello")).unwrap();
    }
    p
}

fn host() -> ShowHost {
    Host::new(ShowDocument::from_presentation(deck()).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

/// Applies `cmd`, checks that undo and redo restore the JSON exactly.
fn apply(h: &mut ShowHost, cmd: C) -> ShowPatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn reopened(h: &ShowHost) -> Presentation {
    let bytes = h.doc().save_pptx().unwrap();
    ShowDocument::open_pptx(&bytes, "x.pptx")
        .unwrap()
        .0
        .into_presentation()
}

fn slide_ids(h: &ShowHost) -> Vec<NodeId> {
    h.doc().presentation().slides.iter().map(|s| s.id).collect()
}

fn show(id: u32, name: &str, slides: Vec<NodeId>) -> CustomShow {
    CustomShow {
        id,
        name: name.into(),
        slide_ids: slides,
    }
}

#[test]
fn custom_shows_are_a_command_and_saved_in_order() {
    let mut h = host();
    let ids = slide_ids(&h);
    let shows = vec![
        show(0, "Short", vec![ids[3], ids[1]]),
        show(5, "Repeat", vec![ids[2], ids[2]]),
    ];
    let p = apply(
        &mut h,
        C::SetCustomShows {
            shows: shows.clone(),
        },
    );
    assert_eq!(p.custom_shows.as_ref(), Some(&shows));
    let back = reopened(&h);
    let new_ids: Vec<NodeId> = back.slides.iter().map(|s| s.id).collect();
    assert_eq!(back.custom_shows.len(), 2);
    assert_eq!(back.custom_shows[0].name, "Short");
    assert_eq!(back.custom_shows[0].slide_ids, vec![new_ids[3], new_ids[1]]);
    assert_eq!(back.custom_shows[1].id, 5);
    assert_eq!(back.custom_shows[1].slide_ids, vec![new_ids[2], new_ids[2]]);
    // the XML: rIds of the slides in show order
    let bytes = h.doc().save_pptx().unwrap();
    let xml = zip_text(&bytes, "ppt/presentation.xml");
    assert!(
        xml.contains(r#"<p:custShow name="Short" id="0"><p:sldLst><p:sld r:id="rId5"/><p:sld r:id="rId3"/></p:sldLst></p:custShow>"#),
        "{xml}"
    );
}

#[test]
fn custom_shows_are_validated() {
    let mut h = host();
    let ids = slide_ids(&h);
    let dup = vec![show(0, "A", vec![]), show(0, "B", vec![])];
    assert!(h.apply(C::SetCustomShows { shows: dup }).is_err());
    let unknown = vec![show(0, "A", vec![NodeId(9999)])];
    assert!(h.apply(C::SetCustomShows { shows: unknown }).is_err());
    let names = vec![show(0, "A", vec![ids[0]]), show(1, "a", vec![])];
    assert!(h.apply(C::SetCustomShows { shows: names }).is_err());
    // Set Up Slide Show cannot name a show that does not exist
    let settings = ShowSettings {
        custom_show: Some(3),
        ..ShowSettings::default()
    };
    assert!(h.apply(C::SetShowSettings { settings }).is_err());
}

#[test]
fn deleting_a_slide_removes_it_from_custom_shows_and_undo_restores() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(0, "S", vec![ids[1], ids[2]])],
    })
    .unwrap();
    let p = apply(&mut h, C::DeleteSlides { ids: vec![ids[1]] });
    assert_eq!(p.custom_shows.unwrap()[0].slide_ids, vec![ids[2]]);
    h.undo().unwrap();
    assert_eq!(
        h.doc().presentation().custom_shows[0].slide_ids,
        vec![ids[1], ids[2]]
    );
}

#[test]
fn removing_the_set_up_show_resets_it() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(2, "S", vec![ids[0]])],
    })
    .unwrap();
    h.apply(C::SetShowSettings {
        settings: ShowSettings {
            custom_show: Some(2),
            ..ShowSettings::default()
        },
    })
    .unwrap();
    let p = apply(&mut h, C::SetCustomShows { shows: vec![] });
    assert_eq!(p.show_settings.unwrap().custom_show, None);
    h.undo().unwrap();
    assert_eq!(h.doc().presentation().show_settings.custom_show, Some(2));
}

#[test]
fn set_up_show_options_round_trip() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(1, "Kiosk loop", vec![ids[2], ids[0]])],
    })
    .unwrap();
    let settings = ShowSettings {
        loop_show: true,
        show_type: ShowType::Kiosk,
        custom_show: Some(1),
        pen_color: Some("0070C0".into()),
        without_animation: true,
        ..ShowSettings::default()
    };
    let p = apply(
        &mut h,
        C::SetShowSettings {
            settings: settings.clone(),
        },
    );
    assert_eq!(p.show_settings, Some(settings.clone()));
    assert_eq!(reopened(&h).show_settings, settings);
    let window = ShowSettings {
        show_type: ShowType::Window,
        show_scrollbar: false,
        ..ShowSettings::default()
    };
    h.apply(C::SetShowSettings {
        settings: window.clone(),
    })
    .unwrap();
    assert_eq!(reopened(&h).show_settings, window);
    let bad = ShowSettings {
        pen_color: Some("#00f".into()),
        ..ShowSettings::default()
    };
    assert!(h.apply(C::SetShowSettings { settings: bad }).is_err());
}

#[test]
fn links_to_custom_shows_round_trip() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(4, "Details", vec![ids[3]])],
    })
    .unwrap();
    let shape = h.doc().presentation().slides[1].shapes[0].id;
    let link = Hyperlink {
        target: LinkTarget::CustomShow {
            id: 4,
            return_after: true,
        },
        tooltip: None,
    };
    h.apply(C::SetClickAction {
        shapes: vec![shape],
        action: Some(link.clone()),
    })
    .unwrap();
    let back = reopened(&h);
    assert_eq!(back.slides[1].shapes[0].click_action, Some(link));
}

/// The text of a part of a package (`name` with a leading `/`).
fn zip_text(bytes: &[u8], name: &str) -> String {
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes)).unwrap();
    let part = pkg
        .part(&fmt_ooxml::PartName::new(format!("/{name}")).unwrap())
        .unwrap();
    String::from_utf8(part.data.clone()).unwrap()
}

// ----- backgrounds, effects, slide size (item 3)

use core_model::{Color, ThemeColorSlot};
use model_show::{
    Background, BgGradient, BgStop, EffectStyle, GradientShape, PatternFill, PictureFill,
    SlideSize, StyleColor, StyleShadow,
};
use show_core::{BackgroundTarget, SlideScale};

fn gradient() -> BgGradient {
    BgGradient {
        stops: vec![
            BgStop {
                pos: 0.0,
                color: Color::theme(ThemeColorSlot::Accent1),
                transparency: 0.0,
            },
            BgStop {
                pos: 0.6,
                color: Color::Theme {
                    slot: ThemeColorSlot::Accent2,
                    tint: 0.4,
                },
                transparency: 0.25,
            },
            BgStop {
                pos: 1.0,
                color: Color::Rgb(core_model::Rgb::new(0x10, 0x20, 0x30)),
                transparency: 0.0,
            },
        ],
        angle_deg: 45.0,
        shape: GradientShape::Linear,
    }
}

#[test]
fn gradient_backgrounds_round_trip_on_slides_and_the_master() {
    let mut h = host();
    let ids = slide_ids(&h);
    let g = Background::Gradient(gradient());
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Slides(vec![ids[1]]),
            fill: Some(g.clone()),
            hide_master_shapes: None,
        },
    );
    let radial = Background::Gradient(BgGradient {
        shape: GradientShape::Circle,
        angle_deg: 0.0,
        ..gradient()
    });
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Master,
            fill: Some(radial.clone()),
            hide_master_shapes: None,
        },
    );
    let back = reopened(&h);
    assert_eq!(back.slides[1].background, Some(g));
    assert_eq!(back.master.background, radial);
    // one stop is no gradient
    let bad = Background::Gradient(BgGradient {
        stops: gradient().stops[..1].to_vec(),
        ..gradient()
    });
    assert!(h
        .apply(C::SetBackground {
            target: BackgroundTarget::Master,
            fill: Some(bad),
            hide_master_shapes: None,
        })
        .is_err());
}

#[test]
fn pattern_and_picture_backgrounds_round_trip() {
    let mut h = host();
    let ids = slide_ids(&h);
    let pattern = Background::Pattern(PatternFill {
        preset: "smCheck".into(),
        fg: Color::theme(ThemeColorSlot::Accent1),
        bg: Color::theme(ThemeColorSlot::Light1),
    });
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Slides(vec![ids[2]]),
            fill: Some(pattern.clone()),
            hide_master_shapes: Some(true),
        },
    );
    assert!(h
        .apply(C::SetBackground {
            target: BackgroundTarget::Slides(vec![ids[2]]),
            fill: Some(Background::Pattern(PatternFill {
                preset: "nonsense".into(),
                fg: Color::Auto,
                bg: Color::Auto,
            })),
            hide_master_shapes: None,
        })
        .is_err());
    // a tiled texture with offset and scale, a stretched picture with offsets
    h.apply(C::SetBackgroundPicture {
        target: BackgroundTarget::Slides(vec![ids[1]]),
        content_type: "image/png".into(),
        bytes_base64: core_model::media::base64_encode(b"\x89PNG\r\n\x1a\nbg"),
        tile: true,
        transparency: 0.0,
    })
    .unwrap();
    let Some(Background::Picture(pf)) = h.doc().presentation().slides[1].background.clone() else {
        panic!("no picture background");
    };
    let tiled = Background::Picture(PictureFill {
        tile_offset: [91_440.0, -45_720.0],
        tile_scale: [0.5, 0.75],
        transparency: 0.3,
        ..pf
    });
    let stretched = Background::Picture(PictureFill {
        tile: false,
        offsets: [0.1, 0.0, -0.05, 0.2],
        ..pf
    });
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Slides(vec![ids[1]]),
            fill: Some(tiled),
            hide_master_shapes: None,
        },
    );
    h.apply(C::SetBackground {
        target: BackgroundTarget::Layout(LayoutKind::Blank),
        fill: Some(stretched),
        hide_master_shapes: None,
    })
    .unwrap();
    let back = reopened(&h);
    assert_eq!(back.slides[2].background, Some(pattern));
    assert!(!back.slides[2].show_master_shapes);
    let Some(Background::Picture(t)) = &back.slides[1].background else {
        panic!("tiled picture lost");
    };
    assert!(t.tile);
    assert_eq!(t.tile_offset, [91_440.0, -45_720.0]);
    assert_eq!(t.tile_scale, [0.5, 0.75]);
    assert!((t.transparency - 0.3).abs() < 1e-6);
    let blank = back.layout(&LayoutKind::Blank).unwrap();
    let Some(Background::Picture(s)) = &blank.background else {
        panic!("stretched picture lost");
    };
    assert_eq!(s.offsets, [0.1, 0.0, -0.05, 0.2]);
}

fn shadow(blur: i64) -> EffectStyle {
    EffectStyle {
        shadow: Some(StyleShadow {
            blur: Emu(blur),
            distance: Emu(38_100),
            direction_deg: 90.0,
            color: StyleColor::rgb(
                core_model::Rgb::BLACK,
                &[model_show::ColorMod::Alpha(40_000)],
            ),
        }),
    }
}

#[test]
fn effect_styles_apply_to_shapes_by_reference() {
    let mut h = host();
    let p = h.doc().presentation();
    // the Office format scheme: subtle and moderate have no shadow
    assert!(p.theme.effect_style(1).unwrap().shadow.is_none());
    assert!(p.theme.effect_style(0).is_none());
    let styles = vec![EffectStyle::default(), shadow(50_800), shadow(101_600)];
    let patch = apply(
        &mut h,
        C::SetThemeEffects {
            name: "Soft Shadows".into(),
            effect_styles: styles.clone(),
        },
    );
    let theme = patch.theme.unwrap();
    assert_eq!(theme.format.name, "Soft Shadows");
    assert_eq!(theme.effect_style(3), Some(&styles[2]));
    // past the end: the last style
    assert_eq!(theme.effect_style(9), Some(&styles[2]));
    assert!(h
        .apply(C::SetThemeEffects {
            name: "x".into(),
            effect_styles: vec![]
        })
        .is_err());
    // a shape's effectRef survives the round trip and resolves in the theme
    let mut pres = h.doc().presentation().clone();
    pres.slides[1].shapes[0].effect_ref = 2;
    let h2: ShowHost = Host::new(ShowDocument::from_presentation(pres).unwrap());
    let back = reopened(&h2);
    let s = &back.slides[1].shapes[0];
    assert_eq!(s.effect_ref, 2);
    assert_eq!(back.theme.format.name, "Soft Shadows");
    assert_eq!(back.theme.effect_style(s.effect_ref), Some(&styles[1]));
}

#[test]
fn ensure_fit_scales_master_and_layouts_like_the_slides() {
    let mut h = host();
    let before = h.doc().presentation().clone();
    let title =
        |p: &Presentation| p.layout(&LayoutKind::TitleContent).unwrap().placeholders[0].transform;
    let old = title(&before);
    apply(
        &mut h,
        C::SetSlideSize {
            size: SlideSize::standard(),
            scale: SlideScale::Fit,
        },
    );
    let p = h.doc().presentation();
    // 16:9 → 4:3: Ensure Fit = the width ratio 0.75, centred
    let k = 9_144_000.0 / 12_192_000.0;
    let t = title(p);
    assert_eq!(t.w.0, (old.w.0 as f64 * k).round() as i64);
    assert_eq!(t.h.0, (old.h.0 as f64 * k).round() as i64);
    let cy = 6_858_000.0 / 2.0;
    assert_eq!(t.y.0, (cy + (old.y.0 as f64 - cy) * k).round() as i64);
    let mt = p.master.placeholders[0].transform;
    assert_eq!(
        mt.w.0,
        (before.master.placeholders[0].transform.w.0 as f64 * k).round() as i64
    );
    // Maximize: the height ratio 1.0, the width overflows evenly
    let mut h = host();
    h.apply(C::SetSlideSize {
        size: SlideSize::standard(),
        scale: SlideScale::Maximize,
    })
    .unwrap();
    let t = title(h.doc().presentation());
    assert_eq!(t.w, old.w);
    assert_eq!(t.x.0, old.x.0 - (12_192_000 - 9_144_000) / 2);
}

// ----- guides and the saved view (item 4)

use model_show::{Guide, GuideOrient, ViewKind, ViewProps};
use show_core::DesignTarget;

fn guide(orient: GuideOrient, pos: i64) -> Guide {
    Guide {
        orient,
        pos: Emu(pos),
        color: None,
    }
}

#[test]
fn layout_and_master_guides_are_commands_and_saved_in_p15() {
    let mut h = host();
    let master = vec![guide(GuideOrient::Horizontal, 3_429_000)];
    let layout = vec![
        guide(GuideOrient::Vertical, 914_400),
        Guide {
            color: Some("00B050".into()),
            ..guide(GuideOrient::Vertical, 11_277_600)
        },
    ];
    apply(
        &mut h,
        C::SetDesignGuides {
            target: DesignTarget::Master,
            guides: master.clone(),
        },
    );
    let p = apply(
        &mut h,
        C::SetDesignGuides {
            target: DesignTarget::Layout(LayoutKind::TitleContent),
            guides: layout.clone(),
        },
    );
    assert!(p.layouts.is_some(), "a design patch");
    assert!(h
        .apply(C::SetDesignGuides {
            target: DesignTarget::Layout(LayoutKind::Custom("nope".into())),
            guides: vec![],
        })
        .is_err());
    let bytes = h.doc().save_pptx().unwrap();
    let layout_xml = zip_text(&bytes, "ppt/slideLayouts/slideLayout2.xml");
    assert!(
        layout_xml.contains("{DCECCB84-F9BA-43D5-87BE-67443E8EF086}")
            && layout_xml.contains("<p15:sldGuideLst"),
        "{layout_xml}"
    );
    let master_xml = zip_text(&bytes, "ppt/slideMasters/slideMaster1.xml");
    assert!(
        master_xml.contains(r#"<p15:guide id="1" orient="horz" pos="2160""#),
        "{master_xml}"
    );
    let back = reopened(&h);
    assert_eq!(back.master.guides, master);
    assert_eq!(
        back.layout(&LayoutKind::TitleContent).unwrap().guides,
        layout
    );
}

#[test]
fn notes_guides_round_trip_in_presentation_xml() {
    let mut h = host();
    let view = ViewProps {
        notes_guides: vec![guide(GuideOrient::Horizontal, 4_572_000)],
        ..ViewProps::default()
    };
    apply(&mut h, C::SetViewProps { view: view.clone() });
    let bytes = h.doc().save_pptx().unwrap();
    assert!(zip_text(&bytes, "ppt/presentation.xml").contains("<p15:notesGuideLst"));
    assert_eq!(reopened(&h).view.notes_guides, view.notes_guides);
}

#[test]
fn the_window_state_is_stamped_on_save_and_read_back() {
    let mut h = host();
    let req = r#"{"type":"savePptx","lastView":"slideSorter","viewState":{"zoom":150,"sorterZoom":60,"restoredLeft":25000,"restoredTop":100000}}"#;
    let out: serde_json::Value =
        serde_json::from_str(&show_core::dispatch_with(&mut h, req)).unwrap();
    let b64 = out["ok"]["bytesBase64"].as_str().unwrap();
    let bytes = core_model::media::base64_decode(b64).unwrap();
    // no undo step, not dirty
    assert!(!h.is_dirty());
    let back = ShowDocument::open_pptx(&bytes, "x.pptx")
        .unwrap()
        .0
        .into_presentation();
    assert_eq!(back.view.last_view, ViewKind::SlideSorter);
    assert_eq!(back.view.zoom, Some(150));
    assert_eq!(back.view.sorter_zoom, 60);
    assert_eq!(back.view.restored_left, 25_000);
    assert_eq!(back.view.restored_top, 100_000);
    // fit again
    let req = r#"{"type":"savePptx","viewState":{"sorterZoom":5000}}"#;
    let out: serde_json::Value =
        serde_json::from_str(&show_core::dispatch_with(&mut h, req)).unwrap();
    let bytes =
        core_model::media::base64_decode(out["ok"]["bytesBase64"].as_str().unwrap()).unwrap();
    let back = ShowDocument::open_pptx(&bytes, "x.pptx")
        .unwrap()
        .0
        .into_presentation();
    assert_eq!(back.view.zoom, None);
    assert_eq!(back.view.sorter_zoom, 400, "clamped");
}

#[test]
fn lock_aspect_ratio_is_saved_as_no_change_aspect() {
    let mut h = host();
    let shape = h.doc().presentation().slides[1].shapes[0].id;
    h.apply(C::SetLockAspect {
        shapes: vec![shape],
        locked: true,
    })
    .unwrap();
    let bytes = h.doc().save_pptx().unwrap();
    assert!(zip_text(&bytes, "ppt/slides/slide2.xml").contains(r#"noChangeAspect="1""#));
    assert!(reopened(&h).slides[1].shapes[0].lock_aspect);
}

#[test]
fn the_reference_deck_reads_custom_show_guides_and_backgrounds() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../testdata/pptx/provisional-34-views-design.pptx"
    );
    let bytes = std::fs::read(path).unwrap();
    let (doc, warnings) = ShowDocument::open_pptx(&bytes, "deck.pptx").unwrap();
    let p = doc.into_presentation();
    assert_eq!(p.slides.len(), 4);
    assert_eq!(p.custom_shows.len(), 1, "{warnings:?}");
    let ids: Vec<NodeId> = p.slides.iter().map(|s| s.id).collect();
    assert_eq!(p.custom_shows[0].name, "Short");
    assert_eq!(p.custom_shows[0].slide_ids, vec![ids[3], ids[0]]);
    assert_eq!(p.show_settings.custom_show, Some(0));
    assert_eq!(p.show_settings.pen_color.as_deref(), Some("0070C0"));
    assert!(p.show_settings.loop_show);
    assert_eq!(p.master.guides.len(), 2);
    assert!(p.layouts.iter().any(|l| l.guides.len() == 2));
    assert!(
        matches!(p.slides[1].background, Some(Background::Gradient(ref g)) if g.stops.len() == 2 && (g.angle_deg - 90.0).abs() < 1e-9)
    );
    assert!(
        matches!(p.slides[2].background, Some(Background::Pattern(ref pf)) if pf.preset == "smCheck")
    );
    // and back: our file keeps them
    let h: ShowHost = Host::new(ShowDocument::from_presentation(p.clone()).unwrap());
    let back = reopened(&h);
    assert_eq!(back.custom_shows.len(), 1);
    assert_eq!(back.master.guides, p.master.guides);
    assert_eq!(back.slides[1].background, p.slides[1].background);
    assert_eq!(back.slides[2].background, p.slides[2].background);
}
