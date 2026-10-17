//! P8-32 commands: layout rename, placeholders, master text levels,
//! prompts, picture backgrounds, slide size scaling, lock aspect ratio,
//! split cells, `lastView` stamping and the extended `shapePaths` – each
//! with its undo/redo identity and `.pptx` round trip.

use app_common::Host;
use core_model::media::base64_encode;
use core_model::{Color, RunProperties, ThemeColorSlot};
use model_show::{
    Background, Emu, LayoutKind, NodeId, PictureFill, PlaceholderKind, Presentation, Shape,
    SlideSize, TextClass, Transform, ViewKind,
};
use serde_json::{json, Value as Json};
use show_core::{
    dispatch_with, BackgroundTarget, DesignTarget, ShowCommand as C, ShowDocument, ShowHost,
    SlideScale,
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

/// Applies `cmd`, checks undo and redo, leaves it applied; returns the
/// patch.
fn apply(h: &mut ShowHost, cmd: C) -> show_core::ShowPatch {
    let before = json_of(h);
    let env = h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    env.patch
}

fn err_code(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before);
    e.code()
}

/// Title slide (1: 2, 3), Title and Content (4: 5, 6), blank with a
/// rectangle (7: 8) and a table (9).
fn host() -> ShowHost {
    let mut p = Presentation::new();
    p.add_slide(LayoutKind::TitleContent);
    let s = p.add_slide(LayoutKind::Blank);
    p.add_shape(
        s,
        Shape::auto(
            model_show::Preset::Rect,
            tr(1_000_000, 1_000_000, 2_000_000, 1_000_000),
        ),
    )
    .unwrap();
    p.add_shape(s, Shape::table(2, 2, tr(0, 0, 2_000_000, 1_000_000)))
        .unwrap();
    Host::new(ShowDocument::from_presentation(p).unwrap())
}

fn roundtrip(h: &ShowHost) -> Presentation {
    let bytes = h.doc().save_pptx().unwrap();
    fmt_pptx::read(&bytes).unwrap()
}

#[test]
fn rename_layouts() {
    let mut h = host();
    // a standard layout keeps its kind, shows the new name and saves it
    apply(
        &mut h,
        C::RenameLayout {
            layout: LayoutKind::TitleContent,
            name: "Agenda".into(),
        },
    );
    let l = pres(&h).layout(&LayoutKind::TitleContent).unwrap();
    assert_eq!(l.display_name(), "Agenda");
    let back = roundtrip(&h);
    assert_eq!(
        back.layout(&LayoutKind::TitleContent)
            .unwrap()
            .display_name(),
        "Agenda"
    );
    // back to the standard name: stored as no name
    apply(
        &mut h,
        C::RenameLayout {
            layout: LayoutKind::TitleContent,
            name: "Title and Content".into(),
        },
    );
    assert!(pres(&h)
        .layout(&LayoutKind::TitleContent)
        .unwrap()
        .name
        .is_empty());
    // a custom layout changes its kind; its slides follow
    apply(
        &mut h,
        C::AddLayout {
            name: "Mine".into(),
        },
    );
    let slide = pres(&h).slides[2].id;
    apply(
        &mut h,
        C::SetSlideLayout {
            slide,
            layout: LayoutKind::Custom("Mine".into()),
        },
    );
    let patch = apply(
        &mut h,
        C::RenameLayout {
            layout: LayoutKind::Custom("Mine".into()),
            name: "Ours".into(),
        },
    );
    assert!(patch.layouts.is_some());
    assert_eq!(patch.slides.len(), 1);
    assert_eq!(pres(&h).slides[2].layout, LayoutKind::Custom("Ours".into()));
    assert_eq!(
        err_code(
            &mut h,
            C::RenameLayout {
                layout: LayoutKind::Custom("Ours".into()),
                name: String::new(),
            }
        ),
        "invalid_command"
    );
}

#[test]
fn add_and_remove_placeholders() {
    let mut h = host();
    let target = DesignTarget::Layout(LayoutKind::TitleOnly);
    apply(
        &mut h,
        C::AddPlaceholder {
            target: target.clone(),
            kind: PlaceholderKind::Picture,
            transform: tr(100, 200, 3_000_000, 2_000_000),
            text_only: false,
        },
    );
    let l = pres(&h).layout(&LayoutKind::TitleOnly).unwrap();
    let pic = l
        .placeholders
        .iter()
        .find(|d| d.kind == PlaceholderKind::Picture)
        .unwrap();
    assert_eq!(pic.idx, 13);
    assert_eq!(pic.transform, tr(100, 200, 3_000_000, 2_000_000));
    // a second title is refused; the master takes one placeholder per kind
    assert_eq!(
        err_code(
            &mut h,
            C::AddPlaceholder {
                target: target.clone(),
                kind: PlaceholderKind::Title,
                transform: tr(0, 0, 10, 10),
                text_only: false,
            }
        ),
        "invalid_command"
    );
    assert_eq!(
        err_code(
            &mut h,
            C::AddPlaceholder {
                target: DesignTarget::Master,
                kind: PlaceholderKind::Body,
                transform: tr(0, 0, 10, 10),
                text_only: false,
            }
        ),
        "invalid_command"
    );
    // saved and read back
    let back = roundtrip(&h);
    assert!(back
        .layout(&LayoutKind::TitleOnly)
        .unwrap()
        .placeholders
        .iter()
        .any(|d| d.kind == PlaceholderKind::Picture && d.idx == 13));
    apply(
        &mut h,
        C::RemovePlaceholder {
            target,
            placeholder: PlaceholderKind::Picture,
            idx: Some(13),
        },
    );
    assert!(!pres(&h)
        .layout(&LayoutKind::TitleOnly)
        .unwrap()
        .placeholders
        .iter()
        .any(|d| d.kind == PlaceholderKind::Picture));
    // the master's footer can go and come back
    apply(
        &mut h,
        C::RemovePlaceholder {
            target: DesignTarget::Master,
            placeholder: PlaceholderKind::Footer,
            idx: None,
        },
    );
    apply(
        &mut h,
        C::AddPlaceholder {
            target: DesignTarget::Master,
            kind: PlaceholderKind::Footer,
            transform: tr(0, 6_000_000, 4_000_000, 300_000),
            text_only: false,
        },
    );
}

#[test]
fn master_text_levels() {
    let mut h = host();
    let red = Color::theme(ThemeColorSlot::Accent2);
    let run = RunProperties {
        color: Some(red),
        ..RunProperties::default()
    };
    apply(
        &mut h,
        C::SetMasterTextStyle {
            which: TextClass::Body,
            level: 1,
            run: Some(run.clone()),
            paragraph: None,
            margin_left: None,
            indent: None,
        },
    );
    assert_eq!(
        pres(&h)
            .master
            .text_styles
            .level(TextClass::Body, 1)
            .run
            .color,
        Some(red)
    );
    // a slide's level-2 body paragraph resolves to it
    let slide = &pres(&h).slides[1];
    let body = slide
        .shapes
        .iter()
        .find(|s| s.placeholder == Some(PlaceholderKind::Body))
        .unwrap();
    let (_, r) = pres(&h).resolve_level(slide, body, 1);
    assert_eq!(r.color, Some(red));
    // written as lvl2pPr and read back
    let back = roundtrip(&h);
    assert_eq!(
        back.master.text_styles.level(TextClass::Body, 1).run.color,
        Some(red)
    );
    // level 1 goes through the master placeholder (layouts follow)
    apply(
        &mut h,
        C::SetMasterTextStyle {
            which: TextClass::Title,
            level: 0,
            run: Some(run),
            paragraph: None,
            margin_left: None,
            indent: None,
        },
    );
    let m = &pres(&h).master;
    assert_eq!(
        m.placeholder_for(PlaceholderKind::Title)
            .unwrap()
            .run_defaults
            .color,
        Some(red)
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetMasterTextStyle {
                which: TextClass::Other,
                level: 9,
                run: None,
                paragraph: None,
                margin_left: None,
                indent: None,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn custom_prompts() {
    let mut h = host();
    let target = DesignTarget::Layout(LayoutKind::TitleContent);
    apply(
        &mut h,
        C::SetPlaceholderPrompt {
            target: target.clone(),
            placeholder: PlaceholderKind::Title,
            idx: None,
            prompt: Some("Name the topic".into()),
        },
    );
    let back = roundtrip(&h);
    let l = back.layout(&LayoutKind::TitleContent).unwrap();
    assert_eq!(l.placeholders[0].prompt.as_deref(), Some("Name the topic"));
    // the master body: one paragraph per level
    apply(
        &mut h,
        C::SetPlaceholderPrompt {
            target: DesignTarget::Master,
            placeholder: PlaceholderKind::Body,
            idx: None,
            prompt: Some("First\nSecond".into()),
        },
    );
    let bytes = h.doc().save_pptx().unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    assert_eq!(
        back.master
            .placeholder_for(PlaceholderKind::Body)
            .unwrap()
            .prompt
            .as_deref(),
        Some("First\nSecond")
    );
    assert_eq!(
        err_code(
            &mut h,
            C::SetPlaceholderPrompt {
                target,
                placeholder: PlaceholderKind::SlideNumber,
                idx: None,
                prompt: Some("x".into()),
            }
        ),
        "invalid_command"
    );
}

#[test]
fn picture_backgrounds() {
    let mut h = host();
    let slide = pres(&h).slides[0].id;
    let png = base64_encode(b"\x89PNG\r\n\x1a\nbackground");
    let media_before = pres(&h).media.len();
    apply(
        &mut h,
        C::SetBackgroundPicture {
            target: BackgroundTarget::Slides(vec![slide]),
            content_type: "image/png".into(),
            bytes_base64: png.clone(),
            tile: true,
            transparency: 0.25,
        },
    );
    assert_eq!(pres(&h).media.len(), media_before + 1);
    let Some(Background::Picture(pf)) = pres(&h).slides[0].background else {
        panic!("picture background expected");
    };
    assert!(pf.tile && (pf.transparency - 0.25).abs() < 1e-9);
    // the master takes one too; both are written as a:blipFill
    apply(
        &mut h,
        C::SetBackgroundPicture {
            target: BackgroundTarget::Master,
            content_type: "image/png".into(),
            bytes_base64: png,
            tile: false,
            transparency: 0.0,
        },
    );
    let back = roundtrip(&h);
    let Some(Background::Picture(b)) = back.slides[0].background else {
        panic!("picture background lost");
    };
    assert!(b.tile && (b.transparency - 0.25).abs() < 1e-6);
    assert!(matches!(
        back.master.background,
        Background::Picture(PictureFill { tile: false, .. })
    ));
    assert_eq!(
        back.media.get(b.media).unwrap().data,
        b"\x89PNG\r\n\x1a\nbackground"
    );
    // changing tile / transparency of the existing picture
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Slides(vec![slide]),
            fill: Some(Background::Picture(PictureFill { tile: false, ..pf })),
            hide_master_shapes: None,
        },
    );
    // a picture that is not in the media store is refused
    assert_eq!(
        err_code(
            &mut h,
            C::SetBackground {
                target: BackgroundTarget::Master,
                fill: Some(Background::Picture(PictureFill::new(
                    core_model::media::MediaId(999)
                ))),
                hide_master_shapes: None,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn slide_size_fit_and_maximize() {
    let mut h = host();
    let rect = |h: &ShowHost| pres(h).slides[2].shapes[0].transform;
    let before = rect(&h);
    // 16:9 → 4:3, Ensure Fit: the smaller ratio (width 0.75), about the centre
    apply(
        &mut h,
        C::SetSlideSize {
            size: SlideSize::standard(),
            scale: SlideScale::Fit,
        },
    );
    let w = SlideSize::standard().width.0 as f64 / SlideSize::widescreen().width.0 as f64;
    let after = rect(&h);
    assert_eq!(after.w, Emu((before.w.0 as f64 * w).round() as i64));
    assert_eq!(after.h, Emu((before.h.0 as f64 * w).round() as i64));
    let cx = |t: Transform, size: SlideSize| {
        t.x.0 as f64 + t.w.0 as f64 / 2.0 - size.width.0 as f64 / 2.0
    };
    let k = cx(after, SlideSize::standard()) / cx(before, SlideSize::widescreen());
    assert!((k - w).abs() < 1e-3, "{k}");
    h.undo().unwrap().unwrap();
    // Maximize: the larger ratio (height 1.0 → shapes keep their size)
    apply(
        &mut h,
        C::SetSlideSize {
            size: SlideSize::standard(),
            scale: SlideScale::Maximize,
        },
    );
    assert_eq!(rect(&h).w, before.w);
    // the table's grid scales with its frame
    let t = pres(&h).slides[2].shapes[1].table_data().unwrap();
    assert_eq!(t.width(), pres(&h).slides[2].shapes[1].transform.w);
}

#[test]
fn lock_aspect_and_split_cells() {
    let mut h = host();
    let rect = pres(&h).slides[2].shapes[0].id;
    let table = pres(&h).slides[2].shapes[1].id;
    apply(
        &mut h,
        C::SetLockAspect {
            shapes: vec![rect],
            locked: true,
        },
    );
    let bytes = h.doc().save_pptx().unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    assert!(back.slides[2].shapes[0].lock_aspect);
    assert!(!back.slides[2].shapes[1].lock_aspect);
    apply(
        &mut h,
        C::SplitTableCellGrid {
            shape: table,
            row: 0,
            col: 1,
            rows: 2,
            cols: 2,
        },
    );
    let t = pres(&h).slides[2].shapes[1].table_data().unwrap();
    assert_eq!((t.rows.len(), t.cols.len()), (3, 3));
    assert_eq!(
        err_code(
            &mut h,
            C::SplitTableCellGrid {
                shape: table,
                row: 0,
                col: 0,
                rows: 0,
                cols: 1,
            }
        ),
        "invalid_command"
    );
    let _ = NodeId(0);
}

#[test]
fn save_stamps_the_last_view() {
    let mut h = host();
    let rev = h.revision();
    let saved: Json = serde_json::from_str(&dispatch_with(
        &mut h,
        &json!({"type": "savePptx", "lastView": "slideSorter"}).to_string(),
    ))
    .unwrap();
    let b64 = saved["ok"]["bytesBase64"].as_str().unwrap();
    let bytes = core_model::media::base64_decode(b64).unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    assert_eq!(back.view.last_view, ViewKind::SlideSorter);
    // no undo step, no new revision
    assert_eq!(h.revision(), rev);
    assert!(h.undo().unwrap().is_none());
}

#[test]
fn shape_paths_carry_text_rects_and_handles() {
    let mut h = host();
    let r: Json = serde_json::from_str(&dispatch_with(
        &mut h,
        &json!({"type": "shapePaths", "queries": [
            {"kind": {"kind": "preset", "value": "rightArrow"}, "w": 1_000_000.0, "h": 600_000.0},
            {"kind": {"kind": "preset", "value": "uturnArrow"}, "w": 1_000_000.0, "h": 600_000.0, "adjust": {"adj1": 10_000}},
            {"kind": {"kind": "connector", "value": {"kind": "elbow"}}, "w": 100.0, "h": 50.0}
        ]})
        .to_string(),
    ))
    .unwrap();
    let shapes = r["ok"]["shapes"].as_array().unwrap();
    assert_eq!(
        shapes[0]["textRect"],
        json!({"l": 0.0, "t": 150_000.0, "r": 850_000.0, "b": 450_000.0})
    );
    let handles = shapes[0]["handles"].as_array().unwrap();
    assert_eq!(handles.len(), 2);
    assert_eq!(handles[0]["yAxis"]["adj"], "adj1");
    assert!(!shapes[1]["handles"].as_array().unwrap().is_empty());
    assert!(shapes[2].get("handles").is_none());
    assert_eq!(shapes[2]["textRect"]["r"], 100.0);
}
