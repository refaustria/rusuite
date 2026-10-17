//! P8-28: view settings (guides, grid), Set Up Slide Show, hidden shapes
//! and text body properties – commands, undo and the `.pptx` round trip.

use app_common::Host;
use model_show::{
    Autofit, BodyProps, Emu, Guide, GuideOrient, LayoutKind, Presentation, Preset, Shape,
    ShowSettings, SlideRange, TextDirection, Transform, ViewKind, ViewProps,
};
use serde_json::Value as Json;
use show_core::{ShowCommand as C, ShowDocument, ShowHost, ShowPatch};

fn deck() -> Presentation {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    let t = Transform::new(Emu(0), Emu(0), Emu(914_400), Emu(457_200));
    p.add_shape(s, Shape::text_box(t, "Hello")).unwrap();
    p.add_shape(s, Shape::auto(Preset::Rect, t)).unwrap();
    p
}

fn host() -> ShowHost {
    Host::new(ShowDocument::from_presentation(deck()).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

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

fn shape_ids(h: &ShowHost) -> Vec<model_show::NodeId> {
    h.doc().presentation().slides[1]
        .shapes
        .iter()
        .map(|s| s.id)
        .collect()
}

#[test]
fn view_props_are_a_command_and_saved() {
    let mut h = host();
    let view = ViewProps {
        guides: vec![
            Guide {
                orient: GuideOrient::Vertical,
                pos: Emu(6_096_000),
                color: Some("FF0000".into()),
            },
            Guide {
                orient: GuideOrient::Horizontal,
                pos: Emu(1_270_000),
                color: None,
            },
        ],
        show_guides: true,
        show_grid: true,
        snap_to_grid: true,
        grid_spacing: Emu(360_000),
        last_view: ViewKind::SlideSorter,
        ..ViewProps::default()
    };
    let p = apply(&mut h, C::SetViewProps { view: view.clone() });
    assert_eq!(p.view.as_ref(), Some(&view));
    assert!(p.slides.is_empty());
    assert_eq!(reopened(&h).view, view);
    let bad = ViewProps {
        grid_spacing: Emu(1),
        ..ViewProps::default()
    };
    assert!(h.apply(C::SetViewProps { view: bad }).is_err());
}

#[test]
fn show_settings_are_saved() {
    let mut h = host();
    let settings = ShowSettings {
        loop_show: true,
        without_animation: true,
        range: Some(SlideRange { start: 1, end: 2 }),
        use_timings: false,
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
    let bad = ShowSettings {
        range: Some(SlideRange { start: 0, end: 1 }),
        ..ShowSettings::default()
    };
    assert!(h.apply(C::SetShowSettings { settings: bad }).is_err());
}

#[test]
fn hidden_shapes_roundtrip() {
    let mut h = host();
    let ids = shape_ids(&h);
    let p = apply(
        &mut h,
        C::SetShapesHidden {
            shapes: vec![ids[1]],
            hidden: true,
        },
    );
    assert_eq!(p.slides.len(), 1);
    assert!(p.slides[0].shapes[1].hidden);
    let back = reopened(&h);
    let shapes = &back.slides[1].shapes;
    assert!(!shapes[0].hidden);
    assert!(shapes[1].hidden);
}

#[test]
fn body_props_with_shrink_scale_roundtrip() {
    let mut h = host();
    let ids = shape_ids(&h);
    let props = BodyProps {
        autofit: Autofit::Shrink,
        font_scale: 62_500,
        line_reduction: 20_000,
        vert: TextDirection::Rotate90,
        columns: 2,
        column_spacing: Emu(91_440),
        ..BodyProps::default()
    };
    apply(
        &mut h,
        C::SetBodyProps {
            shapes: ids.clone(),
            props,
        },
    );
    let pres = h.doc().presentation();
    for s in &pres.slides[1].shapes {
        assert_eq!(s.text().unwrap().props, props);
    }
    // the rectangle had no text: it got an empty body
    assert_eq!(pres.slides[1].shapes[1].text().unwrap().paragraphs.len(), 1);
    let back = reopened(&h);
    assert_eq!(back.slides[1].shapes[0].text().unwrap().props, props);
    let bad = BodyProps {
        columns: 0,
        ..BodyProps::default()
    };
    assert!(h
        .apply(C::SetBodyProps {
            shapes: ids,
            props: bad
        })
        .is_err());
}
